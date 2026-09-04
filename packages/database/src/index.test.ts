import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getPool, closePool, checkConnection } from './connection.js';
import { migrateUp, migrateDown, getMigrationStatus, DEFAULT_MIGRATIONS_DIR } from './runner.js';
import { computeChecksum } from './checksum.js';

describe('TRIDENTPOS WP-003 PostgreSQL Migration Engine Integration Suite', () => {
  const pool = getPool();

  before(async () => {
    // Reset public schema objects to ensure clean baseline
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto CASCADE;
        DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool(pool);
  });

  it('WP003-T01: PostgreSQL 16 connectivity', async () => {
    const info = await checkConnection(pool);
    assert.equal(info.connected, true, 'Should report connected: true');
    assert.match(info.version, /PostgreSQL 16/i, 'PostgreSQL engine must be version 16');
    assert.ok(
      info.serverVersionNum >= 160000 && info.serverVersionNum < 170000,
      `Expected PostgreSQL 16.x serverVersionNum, got: ${info.serverVersionNum}`,
    );
  });

  it('WP003-T02: required extension migration applies', async () => {
    const result = await migrateUp(pool);
    assert.equal(result.alreadyUpToDate, false);
    assert.ok(result.applied.includes('0001_baseline_infrastructure'));

    const extensions = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto') ORDER BY extname;`,
    );
    const names = extensions.rows.map((r) => r.extname);
    assert.ok(names.includes('uuid-ossp'), 'uuid-ossp extension must be created');
    assert.ok(names.includes('pgcrypto'), 'pgcrypto extension must be created');
  });

  it('WP003-T03: _migrations tracking created', async () => {
    const tableCheck = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = '_migrations';`,
    );
    assert.equal(tableCheck.rows.length, 1, '_migrations table must exist');

    const columnsCheck = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '_migrations';`,
    );
    const cols = columnsCheck.rows.map((c) => c.column_name);
    assert.ok(cols.includes('id'), 'Column id must exist');
    assert.ok(cols.includes('name'), 'Column name must exist');
    assert.ok(cols.includes('checksum'), 'Column checksum must exist');
    assert.ok(cols.includes('applied_at'), 'Column applied_at must exist');
    assert.ok(cols.includes('execution_order'), 'Column execution_order must exist');
  });

  it('WP003-T04: migration applies once', async () => {
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*) FROM _migrations WHERE id = '0001';`,
    );
    assert.equal(parseInt(rows.rows[0]?.count || '0', 10), 1);
  });

  it('WP003-T05: re-running migration is idempotent/no duplicate execution', async () => {
    const secondRun = await migrateUp(pool);
    assert.equal(secondRun.alreadyUpToDate, true);
    assert.equal(secondRun.applied.length, 0);

    const rows = await pool.query<{ count: string }>(`SELECT count(*) FROM _migrations;`);
    assert.equal(parseInt(rows.rows[0]?.count || '0', 10), 1);
  });

  it('WP003-T06: checksum recorded', async () => {
    const baselineFile = path.resolve(DEFAULT_MIGRATIONS_DIR, '0001_baseline_infrastructure.sql');
    const expectedChecksum = computeChecksum(fs.readFileSync(baselineFile, 'utf8'));

    const row = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM _migrations WHERE id = '0001';`,
    );
    assert.equal(row.rows[0]?.checksum, expectedChecksum);
    assert.equal(expectedChecksum.length, 64, 'Checksum must be 64-char hex SHA-256');
  });

  it('WP003-T07: modified applied migration checksum mismatch detected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t07-'));
    const testTable = '_migrations_test_drift';

    try {
      const migFile = path.join(tempDir, '0001_drift_test.sql');
      fs.writeFileSync(
        migFile,
        '-- Up\nCREATE TABLE test_drift (id int);\n-- Down\nDROP TABLE test_drift;\n',
        'utf8',
      );

      // Apply initial migration
      const res = await migrateUp(pool, {
        migrationsDir: tempDir,
        tableName: testTable,
      });
      assert.equal(res.applied.length, 1);

      // Mutate file content without updating ledger to simulate tampering/drift
      fs.writeFileSync(
        migFile,
        '-- Up\nCREATE TABLE test_drift (id int, tampered int);\n-- Down\nDROP TABLE test_drift;\n',
        'utf8',
      );

      // Second run must fail loudly
      await assert.rejects(
        async () => {
          await migrateUp(pool, {
            migrationsDir: tempDir,
            tableName: testTable,
          });
        },
        (err: Error) => {
          assert.match(err.message, /Migration drift detected: Checksum mismatch/);
          return true;
        },
      );
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_drift, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T08: migration failure rolls transaction back', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t08-'));
    const testTable = '_migrations_test_rollback';

    try {
      fs.writeFileSync(
        path.join(tempDir, '0001_good.sql'),
        '-- Up\nCREATE TABLE test_good_tbl (id int);\n-- Down\nDROP TABLE test_good_tbl;\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, '0002_bad.sql'),
        '-- Up\nCREATE TABLE test_bad_tbl (id int);\nINVALID SQL STATEMENT FAILS TRANSACTION;\n-- Down\nDROP TABLE test_bad_tbl;\n',
        'utf8',
      );

      await assert.rejects(
        async () => {
          await migrateUp(pool, {
            migrationsDir: tempDir,
            tableName: testTable,
          });
        },
        (err: Error) => {
          assert.match(err.message, /Migration failed for '0002_bad.sql'/);
          return true;
        },
      );

      // Verify 0001 committed
      const goodCheck = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_good_tbl';`,
      );
      assert.equal(goodCheck.rows.length, 1);

      // Verify 0002 rolled back completely (no partial table created)
      const badCheck = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_bad_tbl';`,
      );
      assert.equal(badCheck.rows.length, 0, 'test_bad_tbl must not exist due to rollback');

      // Verify ledger does not record 0002
      const ledgerCheck = await pool.query<{ id: string }>(
        `SELECT id FROM ${testTable} WHERE id = '0002';`,
      );
      assert.equal(ledgerCheck.rows.length, 0);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_good_tbl, test_bad_tbl, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T09: subsequent valid migration applies in order', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t09-'));
    const testTable = '_migrations_test_order';

    try {
      fs.writeFileSync(
        path.join(tempDir, '0001_first.sql'),
        '-- Up\nCREATE TABLE test_seq_1 (id int);\n-- Down\nDROP TABLE test_seq_1;\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, '0002_second.sql'),
        '-- Up\nCREATE TABLE test_seq_2 (id int);\n-- Down\nDROP TABLE test_seq_2;\n',
        'utf8',
      );

      const res = await migrateUp(pool, {
        migrationsDir: tempDir,
        tableName: testTable,
      });
      assert.equal(res.applied.length, 2);

      const rows = await pool.query<{ id: string; execution_order: number }>(
        `SELECT id, execution_order FROM ${testTable} ORDER BY execution_order ASC;`,
      );
      assert.equal(rows.rows[0]?.id, '0001');
      assert.equal(rows.rows[0]?.execution_order, 1);
      assert.equal(rows.rows[1]?.id, '0002');
      assert.equal(rows.rows[1]?.execution_order, 2);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_seq_1, test_seq_2, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T10: non-production down-step works', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t10-'));
    const testTable = '_migrations_test_down';

    try {
      fs.writeFileSync(
        path.join(tempDir, '0001_revertible.sql'),
        '-- Up\nCREATE TABLE test_rev_tbl (id int);\n-- Down\nDROP TABLE test_rev_tbl;\n',
        'utf8',
      );

      await migrateUp(pool, {
        migrationsDir: tempDir,
        tableName: testTable,
      });

      // Assert table exists
      const before = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_rev_tbl';`,
      );
      assert.equal(before.rows.length, 1);

      // Perform controlled down migration
      const revRes = await migrateDown(pool, {
        migrationsDir: tempDir,
        tableName: testTable,
        allowDestructiveDown: true,
      });
      assert.equal(revRes.reverted, '0001_revertible');

      // Assert table dropped and ledger record deleted
      const after = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_rev_tbl';`,
      );
      assert.equal(after.rows.length, 0);

      const ledger = await pool.query(`SELECT * FROM ${testTable};`);
      assert.equal(ledger.rows.length, 0);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_rev_tbl, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T11: production destructive down is rejected', async () => {
    const originalEnv = process.env['NODE_ENV'];

    try {
      // Test refusal in production environment
      process.env['NODE_ENV'] = 'production';
      await assert.rejects(
        async () => {
          await migrateDown(pool, { allowDestructiveDown: true });
        },
        (err: Error) => {
          assert.match(err.message, /Destructive down migration rejected/);
          return true;
        },
      );

      // Test refusal when allowDestructiveDown is false
      process.env['NODE_ENV'] = 'development';
      await assert.rejects(
        async () => {
          await migrateDown(pool, { allowDestructiveDown: false });
        },
        (err: Error) => {
          assert.match(err.message, /Destructive down migration rejected/);
          return true;
        },
      );
    } finally {
      process.env['NODE_ENV'] = originalEnv;
    }
  });

  it('WP003-T12: clean database can migrate from zero to latest', async () => {
    // Drop all objects
    await pool.query(`
      DROP TABLE IF EXISTS _migrations CASCADE;
      DROP EXTENSION IF EXISTS pgcrypto CASCADE;
      DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
    `);

    const result = await migrateUp(pool);
    assert.equal(result.alreadyUpToDate, false);
    assert.ok(result.applied.includes('0001_baseline_infrastructure'));

    const statuses = await getMigrationStatus(pool);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0]?.applied, true);
    assert.equal(statuses[0]?.checksumMatches, true);
  });

  it('WP003-T13: up → down → up cycle works in test environment', async () => {
    // 1. Revert down
    const downRes = await migrateDown(pool, { allowDestructiveDown: true });
    assert.equal(downRes.reverted, '0001_baseline_infrastructure');

    const extAfterDown = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto');`,
    );
    assert.equal(extAfterDown.rows.length, 0, 'Extensions should be dropped after down');

    // 2. Migrate forward again
    const upRes = await migrateUp(pool);
    assert.equal(upRes.alreadyUpToDate, false);
    assert.ok(upRes.applied.includes('0001_baseline_infrastructure'));

    const extAfterUp = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto');`,
    );
    assert.equal(extAfterUp.rows.length, 2, 'Extensions should exist after up');
  });

  it('WP003-T14: no domain/WP-004 tables created', async () => {
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
    `;
    const res = await pool.query<{ table_name: string }>(query);
    const tables = res.rows.map((r) => r.table_name);

    // Only _migrations infrastructure table should exist
    assert.deepEqual(
      tables,
      ['_migrations'],
      `Only _migrations should exist, found: ${tables.join(', ')}`,
    );

    // Explicit domain table absence verification
    const forbidden = [
      'organizations',
      'branches',
      'organization_memberships',
      'users',
      'roles',
      'permissions',
      'accounts',
      'cuentas',
      'mesas',
      'kds_ordenes',
      'kardex_movimientos',
      'folio_leases',
    ];

    for (const table of forbidden) {
      assert.ok(!tables.includes(table), `Domain table '${table}' must NOT exist in WP-003`);
    }
  });
});
