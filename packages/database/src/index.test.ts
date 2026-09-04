import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type pg from 'pg';
import { getPool, closePool, checkConnection } from './connection.js';
import { migrateUp, migrateDown, getMigrationStatus, DEFAULT_MIGRATIONS_DIR } from './runner.js';
import { computeChecksum } from './checksum.js';
import { loadMigrationFiles } from './parser.js';
import { setTenantContext } from './tenant.js';

describe('TRIDENTPOS WP-003 PostgreSQL Migration Engine Integration Suite', () => {
  const pool = getPool();
  const baselineId = '20260904160000';
  const baselineSuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-baseline-suite-'));
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${baselineId}_baseline_infrastructure.sql`),
    path.join(baselineSuiteDir, `${baselineId}_baseline_infrastructure.sql`),
  );

  before(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS test_composite_ref, branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto CASCADE;
        DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    fs.rmSync(baselineSuiteDir, { recursive: true, force: true });
  });

  it('WP003-T01: PostgreSQL 16 connectivity', async () => {
    const info = await checkConnection(pool);
    assert.equal(info.connected, true);
    assert.match(info.version, /PostgreSQL 16/i);
    assert.ok(info.serverVersionNum >= 160000 && info.serverVersionNum < 170000);
  });

  it('WP003-T02: required extension migration applies', async () => {
    const result = await migrateUp(pool, { migrationsDir: baselineSuiteDir });
    assert.equal(result.alreadyUpToDate, false);
    assert.ok(result.applied.includes(`${baselineId}_baseline_infrastructure`));

    const extensions = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto') ORDER BY extname;`,
    );
    const names = extensions.rows.map((r) => r.extname);
    assert.ok(names.includes('uuid-ossp'));
    assert.ok(names.includes('pgcrypto'));
  });

  it('WP003-T03: _migrations tracking created', async () => {
    const tableCheck = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = '_migrations';`,
    );
    assert.equal(tableCheck.rows.length, 1);

    const columnsCheck = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '_migrations';`,
    );
    const cols = columnsCheck.rows.map((c) => c.column_name);
    for (const column of ['id', 'name', 'checksum', 'applied_at', 'execution_order']) {
      assert.ok(cols.includes(column), `Column ${column} must exist`);
    }
  });

  it('WP003-T04: migration applies once', async () => {
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*) FROM _migrations WHERE id = $1;`,
      [baselineId],
    );
    assert.equal(parseInt(rows.rows[0]?.count || '0', 10), 1);
  });

  it('WP003-T05: re-running migration is idempotent/no duplicate execution', async () => {
    const secondRun = await migrateUp(pool, { migrationsDir: baselineSuiteDir });
    assert.equal(secondRun.alreadyUpToDate, true);
    assert.equal(secondRun.applied.length, 0);
    const rows = await pool.query<{ count: string }>(`SELECT count(*) FROM _migrations;`);
    assert.equal(parseInt(rows.rows[0]?.count || '0', 10), 1);
  });

  it('WP003-T06: checksum recorded', async () => {
    const baselineFile = path.resolve(
      DEFAULT_MIGRATIONS_DIR,
      `${baselineId}_baseline_infrastructure.sql`,
    );
    const expectedChecksum = computeChecksum(fs.readFileSync(baselineFile, 'utf8'));
    const row = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM _migrations WHERE id = $1;`,
      [baselineId],
    );
    assert.equal(row.rows[0]?.checksum, expectedChecksum);
    assert.equal(expectedChecksum.length, 64);
  });

  it('WP003-T07: modified applied migration checksum mismatch detected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t07-'));
    const testTable = '_migrations_test_drift';
    const migFile = path.join(tempDir, '20260904160100_drift_test.sql');
    try {
      fs.writeFileSync(
        migFile,
        '-- Up\nCREATE TABLE test_drift (id int);\n-- Down\nDROP TABLE test_drift;\n',
      );
      await migrateUp(pool, { migrationsDir: tempDir, tableName: testTable });
      fs.writeFileSync(
        migFile,
        '-- Up\nCREATE TABLE test_drift (id int, tampered int);\n-- Down\nDROP TABLE test_drift;\n',
      );
      await assert.rejects(
        migrateUp(pool, { migrationsDir: tempDir, tableName: testTable }),
        /Migration drift detected: Checksum mismatch/,
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
        path.join(tempDir, '20260904160200_good.sql'),
        '-- Up\nCREATE TABLE test_good_tbl (id int);\n-- Down\nDROP TABLE test_good_tbl;\n',
      );
      fs.writeFileSync(
        path.join(tempDir, '20260904160300_bad.sql'),
        '-- Up\nCREATE TABLE test_bad_tbl (id int);\nINVALID SQL STATEMENT FAILS TRANSACTION;\n-- Down\nDROP TABLE test_bad_tbl;\n',
      );
      await assert.rejects(
        migrateUp(pool, { migrationsDir: tempDir, tableName: testTable }),
        /Migration failed for '20260904160300_bad.sql'/,
      );
      const goodCheck = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_good_tbl';`,
      );
      assert.equal(goodCheck.rows.length, 1);
      const badCheck = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_bad_tbl';`,
      );
      assert.equal(badCheck.rows.length, 0);
      const ledgerCheck = await pool.query(
        `SELECT id FROM ${testTable} WHERE id = '20260904160300';`,
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
        path.join(tempDir, '20260904160400_first.sql'),
        '-- Up\nCREATE TABLE test_seq_1 (id int);\n-- Down\nDROP TABLE test_seq_1;\n',
      );
      fs.writeFileSync(
        path.join(tempDir, '20260904160500_second.sql'),
        '-- Up\nCREATE TABLE test_seq_2 (id int);\n-- Down\nDROP TABLE test_seq_2;\n',
      );
      const res = await migrateUp(pool, { migrationsDir: tempDir, tableName: testTable });
      assert.equal(res.applied.length, 2);
      const rows = await pool.query<{ id: string; execution_order: number }>(
        `SELECT id, execution_order FROM ${testTable} ORDER BY execution_order ASC;`,
      );
      assert.equal(rows.rows[0]?.id, '20260904160400');
      assert.equal(rows.rows[0]?.execution_order, 1);
      assert.equal(rows.rows[1]?.id, '20260904160500');
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
        path.join(tempDir, '20260904160600_revertible.sql'),
        '-- Up\nCREATE TABLE test_rev_tbl (id int);\n-- Down\nDROP TABLE test_rev_tbl;\n',
      );
      await migrateUp(pool, { migrationsDir: tempDir, tableName: testTable });
      const revRes = await migrateDown(pool, {
        migrationsDir: tempDir,
        tableName: testTable,
        allowDestructiveDown: true,
      });
      assert.equal(revRes.reverted, '20260904160600_revertible');
      const after = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'test_rev_tbl';`,
      );
      assert.equal(after.rows.length, 0);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_rev_tbl, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T11: production destructive down is rejected', async () => {
    const originalEnv = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      await assert.rejects(migrateDown(pool, { allowDestructiveDown: true }), /rejected/);
      process.env['NODE_ENV'] = 'development';
      await assert.rejects(migrateDown(pool, { allowDestructiveDown: false }), /rejected/);
    } finally {
      process.env['NODE_ENV'] = originalEnv;
    }
  });

  it('WP003-T12: clean database can migrate from zero to latest', async () => {
    await pool.query(`
      DROP TABLE IF EXISTS _migrations CASCADE;
      DROP EXTENSION IF EXISTS pgcrypto CASCADE;
      DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
    `);
    const result = await migrateUp(pool, { migrationsDir: baselineSuiteDir });
    assert.equal(result.alreadyUpToDate, false);
    assert.ok(result.applied.includes(`${baselineId}_baseline_infrastructure`));
    const statuses = await getMigrationStatus(pool, { migrationsDir: baselineSuiteDir });
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0]?.applied, true);
    assert.equal(statuses[0]?.checksumMatches, true);
  });

  it('WP003-T13: up → down → up cycle works in test environment', async () => {
    const downRes = await migrateDown(pool, {
      allowDestructiveDown: true,
      migrationsDir: baselineSuiteDir,
    });
    assert.equal(downRes.reverted, `${baselineId}_baseline_infrastructure`);
    const extAfterDown = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto');`,
    );
    assert.equal(extAfterDown.rows.length, 0);
    const upRes = await migrateUp(pool, { migrationsDir: baselineSuiteDir });
    assert.ok(upRes.applied.includes(`${baselineId}_baseline_infrastructure`));
  });

  it('WP003-T14: no domain/WP-004 tables created', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const tables = res.rows.map((r) => r.table_name).sort();
    assert.deepEqual(tables, ['_migrations']);
    for (const table of [
      'organizations',
      'branches',
      'organization_memberships',
      'users',
      'roles',
    ]) {
      assert.ok(!tables.includes(table));
    }
  });

  it('WP003-T15: frozen Cloud migration filename convention is enforced', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t15-'));
    try {
      fs.writeFileSync(path.join(tempDir, '0001_invalid.sql'), '-- Up\nSELECT 1;\n');
      assert.throws(() => loadMigrationFiles(tempDir), /YYYYMMDDHHMMSS/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T16: duplicate timestamp IDs are rejected', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t16-'));
    try {
      fs.writeFileSync(path.join(tempDir, '20260904160700_a.sql'), '-- Up\nSELECT 1;\n');
      fs.writeFileSync(path.join(tempDir, '20260904160700_b.sql'), '-- Up\nSELECT 1;\n');
      assert.throws(() => loadMigrationFiles(tempDir), /Duplicate migration timestamp/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T17: retroactive migration insertion is rejected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t17-'));
    const testTable = '_migrations_test_retroactive';
    try {
      fs.writeFileSync(
        path.join(tempDir, '20260904160900_first.sql'),
        '-- Up\nCREATE TABLE test_retro_first (id int);\n-- Down\nDROP TABLE test_retro_first;\n',
      );
      await migrateUp(pool, { migrationsDir: tempDir, tableName: testTable });
      fs.writeFileSync(
        path.join(tempDir, '20260904160800_inserted_earlier.sql'),
        '-- Up\nCREATE TABLE test_retro_earlier (id int);\n-- Down\nDROP TABLE test_retro_earlier;\n',
      );
      await assert.rejects(
        migrateUp(pool, { migrationsDir: tempDir, tableName: testTable }),
        /Migration order drift detected/,
      );
    } finally {
      await pool.query(
        `DROP TABLE IF EXISTS test_retro_first, test_retro_earlier, ${testTable} CASCADE;`,
      );
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP003-T18: concurrent migration runners serialize on advisory lock', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp003-t18-'));
    const testTable = '_migrations_test_concurrent';
    try {
      fs.writeFileSync(
        path.join(tempDir, '20260904161000_concurrent.sql'),
        '-- Up\nCREATE TABLE test_concurrent (id int);\n-- Down\nDROP TABLE test_concurrent;\n',
      );
      const results = await Promise.all([
        migrateUp(pool, { migrationsDir: tempDir, tableName: testTable }),
        migrateUp(pool, { migrationsDir: tempDir, tableName: testTable }),
      ]);
      assert.equal(results[0].applied.length + results[1].applied.length, 1);
      const ledger = await pool.query<{ count: string }>(`SELECT count(*) FROM ${testTable};`);
      assert.equal(parseInt(ledger.rows[0]?.count || '0', 10), 1);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS test_concurrent, ${testTable} CASCADE;`);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('TRIDENTPOS WP-004 Organization & Branch Multi-Tenant RLS Foundation Suite', () => {
  const pool = getPool();
  const testRole = 'trident_test_app';
  const baselineId = '20260904160000';
  const wp004Id = '20260904170000';

  const tenantAId = '11111111-1111-1111-1111-111111111111';
  const tenantBId = '22222222-2222-2222-2222-222222222222';
  const branchAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK;').catch(() => {});
      await client.query('RESET ROLE;').catch(() => {});
      client.release();
    }
  }

  async function seedTestData(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Tenant A Legal Name', 'Tenant A Trade', 'TAX-ORG-A'),
          ('${tenantBId}', 'Tenant B Legal Name', 'Tenant B Trade', 'TAX-ORG-B')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-A1', 'Branch A Primary'),
          ('${branchBId}', '${tenantBId}', 'BR-B1', 'Branch B Primary')
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  }

  before(async () => {
    const client = await pool.connect();
    try {
      // Ensure clean state before running migrateUp on DEFAULT_MIGRATIONS_DIR
      await client.query(`
        DROP TABLE IF EXISTS test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id = '${wp004Id}';
      `);
      // Ensure test role exists with NOSUPERUSER and NOBYPASSRLS
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            EXECUTE 'DROP OWNED BY ${testRole}';
            EXECUTE 'DROP ROLE ${testRole}';
          END IF;
        END
        $$;
        CREATE ROLE ${testRole} NOSUPERUSER NOBYPASSRLS NOINHERIT;
      `);
      // Apply zero-to-latest migrations up to WP-004 on real DEFAULT_MIGRATIONS_DIR
      await migrateUp(pool);
      // Grant least-privilege permissions to test role (DML only, no TRUNCATE/REFERENCES/TRIGGER)
      await client.query(`
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches TO ${testRole};
        GRANT EXECUTE ON FUNCTION current_app_org_id() TO ${testRole};
      `);
      await seedTestData();
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id = '${wp004Id}';
        DROP OWNED BY ${testRole};
        DROP ROLE ${testRole};
      `);
    } finally {
      client.release();
      await closePool(pool);
    }
  });

  it('WP004-T01: WP-003 -> WP-004 migration applies', async () => {
    const statuses = await getMigrationStatus(pool);
    const appliedIds = statuses.filter((s) => s.applied).map((s) => s.id);
    assert.ok(appliedIds.includes(baselineId), 'WP-003 baseline must be applied');
    assert.ok(appliedIds.includes(wp004Id), 'WP-004 tenant RLS migration must be applied');
  });

  interface ColumnInfo {
    column_name: string;
    data_type: string;
    is_nullable: string;
  }

  it('WP004-T02: organizations schema matches frozen Data Model', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(
      cols.rows.map((r: ColumnInfo) => [r.column_name, r]),
    );
    assert.ok(colMap.has('id'), 'id column must exist');
    assert.equal(colMap.get('id')?.data_type, 'uuid');
    assert.equal(colMap.get('id')?.is_nullable, 'NO');

    assert.ok(colMap.has('legal_name'), 'legal_name column must exist');
    assert.equal(colMap.get('legal_name')?.is_nullable, 'NO');

    assert.ok(colMap.has('trade_name'), 'trade_name column must exist');
    assert.equal(colMap.get('trade_name')?.is_nullable, 'NO');

    assert.ok(colMap.has('tax_id'), 'tax_id column must exist');
    assert.equal(colMap.get('tax_id')?.is_nullable, 'NO');

    assert.ok(colMap.has('is_active'), 'is_active column must exist');
    assert.equal(colMap.get('is_active')?.data_type, 'boolean');
    assert.equal(colMap.get('is_active')?.is_nullable, 'NO');

    assert.ok(colMap.has('created_at'), 'created_at column must exist');
    assert.equal(colMap.get('created_at')?.is_nullable, 'NO');

    assert.ok(colMap.has('updated_at'), 'updated_at column must exist');
    assert.equal(colMap.get('updated_at')?.is_nullable, 'NO');

    // Verify tax_id unique constraint
    const uqCheck = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'organizations'::regclass AND contype = 'u';
    `);
    const constraints = uqCheck.rows.map((r: { conname: string }) => r.conname);
    assert.ok(constraints.includes('uq_organizations_tax_id'));
  });

  it('WP004-T03: branches schema matches frozen Data Model', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'branches'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(
      cols.rows.map((r: ColumnInfo) => [r.column_name, r]),
    );
    assert.ok(colMap.has('id'), 'id column must exist');
    assert.equal(colMap.get('id')?.data_type, 'uuid');

    assert.ok(colMap.has('organization_id'), 'organization_id column must exist');
    assert.equal(colMap.get('organization_id')?.data_type, 'uuid');
    assert.equal(colMap.get('organization_id')?.is_nullable, 'NO');

    assert.ok(colMap.has('code'), 'code column must exist');
    assert.equal(colMap.get('code')?.is_nullable, 'NO');

    assert.ok(colMap.has('name'), 'name column must exist');
    assert.equal(colMap.get('name')?.is_nullable, 'NO');

    assert.ok(colMap.has('timezone'), 'timezone column must exist');
    assert.equal(colMap.get('timezone')?.is_nullable, 'NO');

    assert.ok(colMap.has('address'), 'address column must exist');
    assert.equal(colMap.get('address')?.data_type, 'jsonb');
    assert.equal(colMap.get('address')?.is_nullable, 'NO');

    assert.ok(colMap.has('is_active'), 'is_active column must exist');
    assert.equal(colMap.get('is_active')?.data_type, 'boolean');

    // Verify constraints: FK to organizations, unique (organization_id, code), composite (organization_id, id)
    const conCheck = await pool.query<{ conname: string; contype: string }>(`
      SELECT conname, contype FROM pg_constraint
      WHERE conrelid = 'branches'::regclass;
    `);
    const conNames = conCheck.rows.map((r: { conname: string; contype: string }) => r.conname);
    assert.ok(conNames.includes('uq_branches_org_code'), 'uq_branches_org_code must exist');
    assert.ok(conNames.includes('uq_branches_org_id'), 'uq_branches_org_id must exist');
  });

  it('WP004-T04: current_app_org_id() returns Tenant A in Tenant A transaction', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const res = await client.query<{ current_app_org_id: string }>(
        'SELECT current_app_org_id();',
      );
      assert.equal(res.rows[0]?.current_app_org_id, tenantAId);
      await client.query('COMMIT;');
    });
  });

  it('WP004-T05: current_app_org_id() returns Tenant B in Tenant B transaction', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const res = await client.query<{ current_app_org_id: string }>(
        'SELECT current_app_org_id();',
      );
      assert.equal(res.rows[0]?.current_app_org_id, tenantBId);
      await client.query('COMMIT;');
    });
  });

  it('WP004-T06: no tenant context = default-deny reads', async () => {
    await asTestRole(async (client) => {
      const orgs = await client.query('SELECT * FROM organizations;');
      assert.equal(orgs.rows.length, 0, 'No organizations visible without tenant context');

      const branches = await client.query('SELECT * FROM branches;');
      assert.equal(branches.rows.length, 0, 'No branches visible without tenant context');
    });
  });

  it('WP004-T07: Tenant A cannot SELECT Tenant B organization', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      // All orgs visible under Tenant A context must only be Tenant A
      const orgs = await client.query<{ id: string }>('SELECT id FROM organizations;');
      assert.equal(orgs.rows.length, 1);
      assert.equal(orgs.rows[0]?.id, tenantAId);

      // Explicit query for Tenant B returns zero rows
      const targetB = await client.query('SELECT * FROM organizations WHERE id = $1;', [tenantBId]);
      assert.equal(targetB.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP004-T08: Tenant A cannot SELECT Tenant B branch', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const branches = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM branches;',
      );
      assert.equal(branches.rows.length, 1);
      assert.equal(branches.rows[0]?.id, branchAId);
      assert.equal(branches.rows[0]?.organization_id, tenantAId);

      const targetB = await client.query('SELECT * FROM branches WHERE organization_id = $1;', [
        tenantBId,
      ]);
      assert.equal(targetB.rows.length, 0);

      const targetBranchB = await client.query('SELECT * FROM branches WHERE id = $1;', [
        branchBId,
      ]);
      assert.equal(targetBranchB.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP004-T09: Tenant B cannot SELECT Tenant A data', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);

      const orgs = await client.query<{ id: string }>('SELECT id FROM organizations;');
      assert.equal(orgs.rows.length, 1);
      assert.equal(orgs.rows[0]?.id, tenantBId);

      const branches = await client.query<{ id: string }>(
        'SELECT id FROM branches WHERE organization_id = $1;',
        [tenantAId],
      );
      assert.equal(branches.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP004-T10: Tenant A cannot INSERT branch for Tenant B', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      // Cross-tenant insert attempt must be rejected by WITH CHECK policy
      await assert.rejects(
        client.query(`
          INSERT INTO branches (id, organization_id, code, name)
          VALUES (gen_random_uuid(), '${tenantBId}', 'BR-ATTACK', 'Malicious Branch');
        `),
        /row-level security policy/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP004-T11: Tenant A cannot UPDATE branch into Tenant B scope', async () => {
    await asTestRole(async (client) => {
      // Subtest 1: Attempt to transfer Tenant A branch to Tenant B fails WITH CHECK
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      await assert.rejects(
        client.query(`UPDATE branches SET organization_id = $1 WHERE id = $2;`, [
          tenantBId,
          branchAId,
        ]),
        /row-level security policy/,
      );
      await client.query('ROLLBACK;');

      // Subtest 2: Attempt to update Tenant B branch targets zero rows (invisible to A)
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const res = await client.query(`UPDATE branches SET name = 'Attacked' WHERE id = $1;`, [
        branchBId,
      ]);
      assert.equal(res.rowCount, 0);
      await client.query('ROLLBACK;');
    });
  });

  it('WP004-T12: Tenant A cannot DELETE Tenant B branch', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const res = await client.query(`DELETE FROM branches WHERE id = $1;`, [branchBId]);
      assert.equal(res.rowCount, 0);

      await client.query('COMMIT;');
    });

    // Verify Tenant B branch still exists intact
    const check = await pool.query(`SELECT id FROM branches WHERE id = $1;`, [branchBId]);
    assert.equal(check.rows.length, 1);
  });

  it('WP004-T13: normal test role is NOSUPERUSER', async () => {
    const roleCheck = await pool.query<{ rolsuper: boolean }>(
      `SELECT rolsuper FROM pg_roles WHERE rolname = $1;`,
      [testRole],
    );
    assert.equal(roleCheck.rows.length, 1);
    assert.equal(roleCheck.rows[0]?.rolsuper, false);
  });

  it('WP004-T14: normal test role is NOBYPASSRLS', async () => {
    const roleCheck = await pool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = $1;`,
      [testRole],
    );
    assert.equal(roleCheck.rows.length, 1);
    assert.equal(roleCheck.rows[0]?.rolbypassrls, false);
  });

  it('WP004-T15: RLS enabled on organizations', async () => {
    const res = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'organizations';`,
    );
    assert.equal(res.rows[0]?.relrowsecurity, true);
  });

  it('WP004-T16: FORCE RLS enabled on organizations', async () => {
    const res = await pool.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'organizations';`,
    );
    assert.equal(res.rows[0]?.relforcerowsecurity, true);
  });

  it('WP004-T17: RLS enabled on branches', async () => {
    const res = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'branches';`,
    );
    assert.equal(res.rows[0]?.relrowsecurity, true);
  });

  it('WP004-T18: FORCE RLS enabled on branches', async () => {
    const res = await pool.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'branches';`,
    );
    assert.equal(res.rows[0]?.relforcerowsecurity, true);
  });

  it('WP004-T19: composite branch identity constraint exists and rejects invalid tenant-scoped references', async () => {
    const client = await pool.connect();
    try {
      // Create a test table referencing composite (organization_id, id)
      await client.query(`
        DROP TABLE IF EXISTS test_composite_ref CASCADE;
        CREATE TABLE test_composite_ref (
          id SERIAL PRIMARY KEY,
          org_id UUID NOT NULL,
          branch_id UUID NOT NULL,
          FOREIGN KEY (org_id, branch_id) REFERENCES branches (organization_id, id)
        );
      `);

      // Valid reference for Tenant A branch
      await client.query(`
        INSERT INTO test_composite_ref (org_id, branch_id)
        VALUES ('${tenantAId}', '${branchAId}');
      `);

      // Cross-tenant reference: Tenant A org_id paired with Tenant B branch_id must fail foreign key check
      await assert.rejects(
        client.query(`
          INSERT INTO test_composite_ref (org_id, branch_id)
          VALUES ('${tenantAId}', '${branchBId}');
        `),
        /foreign key constraint/,
      );
    } finally {
      await client.query('DROP TABLE IF EXISTS test_composite_ref CASCADE;').catch(() => {});
      client.release();
    }
  });

  it('WP004-T20: SET LOCAL / set_config(..., true) disappears after transaction end', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const inTx = await client.query<{ current_app_org_id: string }>(
        'SELECT current_app_org_id();',
      );
      assert.equal(inTx.rows[0]?.current_app_org_id, tenantAId);
      await client.query('COMMIT;');

      // Immediately after COMMIT on the same client, context is cleared
      const postCommit = await client.query<{ current_app_org_id: string | null }>(
        'SELECT current_app_org_id();',
      );
      assert.equal(postCommit.rows[0]?.current_app_org_id, null);
    });
  });

  it('WP004-T21: reused pooled connection does NOT inherit prior tenant context', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);

      // Transaction 1: Tenant A
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const resA = await client.query<{ id: string }>('SELECT id FROM organizations;');
      assert.equal(resA.rows[0]?.id, tenantAId);
      await client.query('COMMIT;');

      // Between transactions on the exact same physical client connection:
      // Without setting context, queries must return zero rows (default deny)
      const resNone = await client.query('SELECT * FROM organizations;');
      assert.equal(resNone.rows.length, 0);

      // Transaction 2: Tenant B
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const resB = await client.query<{ id: string }>('SELECT id FROM organizations;');
      assert.equal(resB.rows[0]?.id, tenantBId);
      await client.query('COMMIT;');
    } finally {
      await client.query('RESET ROLE;').catch(() => {});
      client.release();
    }
  });

  it('WP004-T22: malformed tenant context fails closed', async () => {
    await asTestRole(async (client) => {
      const malformedPayloads = [
        'invalid-uuid-string',
        "' OR 1=1 --",
        '   ',
        '00000000-0000-0000-0000-000000000000',
      ];

      for (const payload of malformedPayloads) {
        await client.query('BEGIN;');
        await setTenantContext(client, payload);

        const orgRes = await client.query('SELECT * FROM organizations;');
        assert.equal(
          orgRes.rows.length,
          0,
          `Payload "${payload}" must produce zero rows in organizations`,
        );

        const branchRes = await client.query('SELECT * FROM branches;');
        assert.equal(
          branchRes.rows.length,
          0,
          `Payload "${payload}" must produce zero rows in branches`,
        );

        await client.query('ROLLBACK;');
      }
    });
  });

  it('WP004-T23: fresh DB migrates WP-003 + WP-004 zero-to-latest', async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto, "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
      `);
    } finally {
      client.release();
    }

    const res = await migrateUp(pool);
    assert.equal(res.alreadyUpToDate, false);
    assert.ok(res.applied.includes(`${baselineId}_baseline_infrastructure`));
    assert.ok(res.applied.includes(`${wp004Id}_tenant_rls_foundation`));

    const status = await getMigrationStatus(pool);
    assert.equal(status.length, 2);
    assert.ok(status.every((s) => s.applied && s.checksumMatches));

    // Re-seed data for subsequent tests
    await seedTestData();
    const grantClient = await pool.connect();
    try {
      await grantClient.query(`
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches TO ${testRole};
        GRANT EXECUTE ON FUNCTION current_app_org_id() TO ${testRole};
      `);
    } finally {
      grantClient.release();
    }
  });

  it('WP004-T24: non-production down returns to canonical WP-003 schema state', async () => {
    const downResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.equal(downResult.reverted, `${wp004Id}_tenant_rls_foundation`);

    // Verify WP-004 tables and functions are dropped
    const tablesCheck = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('organizations', 'branches');
    `);
    assert.equal(tablesCheck.rows.length, 0);

    const fnCheck = await pool.query(`
      SELECT proname FROM pg_proc WHERE proname = 'current_app_org_id';
    `);
    assert.equal(fnCheck.rows.length, 0);

    // Verify WP-003 ledger remains intact
    const ledger = await pool.query<{ id: string }>(`SELECT id FROM _migrations;`);
    assert.deepEqual(
      ledger.rows.map((r: { id: string }) => r.id),
      [baselineId],
    );
  });

  it('WP004-T25: up → down → up works', async () => {
    // Re-apply WP-004
    const upRes = await migrateUp(pool);
    assert.ok(upRes.applied.includes(`${wp004Id}_tenant_rls_foundation`));

    // Seed test data and verify functionality restored
    await seedTestData();
    const client = await pool.connect();
    try {
      await client.query(`
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches TO ${testRole};
        GRANT EXECUTE ON FUNCTION current_app_org_id() TO ${testRole};
      `);
    } finally {
      client.release();
    }

    await asTestRole(async (testClient) => {
      await testClient.query('BEGIN;');
      await setTenantContext(testClient, tenantAId);
      const orgs = await testClient.query('SELECT * FROM organizations;');
      assert.equal(orgs.rows.length, 1);
      await testClient.query('COMMIT;');
    });
  });

  it('WP004-T26: WP-003 migration checksum remains unchanged', async () => {
    const ledger = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM _migrations WHERE id = $1;`,
      [baselineId],
    );
    assert.equal(ledger.rows.length, 1);
    const baselineFile = path.join(
      DEFAULT_MIGRATIONS_DIR,
      `${baselineId}_baseline_infrastructure.sql`,
    );
    const expectedChecksum = computeChecksum(fs.readFileSync(baselineFile, 'utf8'));
    assert.equal(ledger.rows[0]?.checksum, expectedChecksum);
  });

  it('WP004-T27: organization_memberships DOES NOT EXIST', async () => {
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organization_memberships';
    `);
    assert.equal(res.rows.length, 0, 'organization_memberships must not exist');
  });

  it('WP004-T28: WP-005 tables are NOT prematurely introduced by WP-004', async () => {
    const wp005Tables = [
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'user_roles',
      'user_branch_credentials',
    ];
    const res = await pool.query<{ table_name: string }>(
      `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[]);
    `,
      [wp005Tables],
    );
    assert.equal(
      res.rows.length,
      0,
      `No WP-005 tables may exist, found: ${res.rows.map((r: { table_name: string }) => r.table_name).join(', ')}`,
    );
  });

  it('WP004-T29: Least-privilege application role cannot TRUNCATE tenant tables', async () => {
    // 1. Minimum privilege verification via catalog introspection
    const privRes = await pool.query<{
      org_truncate: boolean;
      branch_truncate: boolean;
      org_references: boolean;
      branch_references: boolean;
      org_trigger: boolean;
      branch_trigger: boolean;
      org_select: boolean;
      branch_select: boolean;
    }>(`
      SELECT
        has_table_privilege('${testRole}', 'organizations', 'TRUNCATE') AS org_truncate,
        has_table_privilege('${testRole}', 'branches', 'TRUNCATE') AS branch_truncate,
        has_table_privilege('${testRole}', 'organizations', 'REFERENCES') AS org_references,
        has_table_privilege('${testRole}', 'branches', 'REFERENCES') AS branch_references,
        has_table_privilege('${testRole}', 'organizations', 'TRIGGER') AS org_trigger,
        has_table_privilege('${testRole}', 'branches', 'TRIGGER') AS branch_trigger,
        has_table_privilege('${testRole}', 'organizations', 'SELECT') AS org_select,
        has_table_privilege('${testRole}', 'branches', 'SELECT') AS branch_select;
    `);

    assert.equal(
      privRes.rows[0]?.org_truncate,
      false,
      'trident_test_app must not have TRUNCATE on organizations',
    );
    assert.equal(
      privRes.rows[0]?.branch_truncate,
      false,
      'trident_test_app must not have TRUNCATE on branches',
    );
    assert.equal(
      privRes.rows[0]?.org_references,
      false,
      'trident_test_app must not have REFERENCES on organizations',
    );
    assert.equal(
      privRes.rows[0]?.branch_references,
      false,
      'trident_test_app must not have REFERENCES on branches',
    );
    assert.equal(
      privRes.rows[0]?.org_trigger,
      false,
      'trident_test_app must not have TRIGGER on organizations',
    );
    assert.equal(
      privRes.rows[0]?.branch_trigger,
      false,
      'trident_test_app must not have TRIGGER on branches',
    );
    assert.equal(
      privRes.rows[0]?.org_select,
      true,
      'trident_test_app must retain SELECT on organizations',
    );
    assert.equal(
      privRes.rows[0]?.branch_select,
      true,
      'trident_test_app must retain SELECT on branches',
    );

    // 2. Reject TRUNCATE attempts via PostgreSQL permission enforcement (not relying on RLS)
    await asTestRole(async (client) => {
      await assert.rejects(client.query('TRUNCATE organizations;'), (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        assert.equal(pgErr.code, '42501', 'Must be rejected with 42501 permission_denied');
        assert.match(pgErr.message ?? '', /permission denied for table organizations/i);
        return true;
      });

      await assert.rejects(client.query('TRUNCATE branches;'), (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        assert.equal(pgErr.code, '42501', 'Must be rejected with 42501 permission_denied');
        assert.match(pgErr.message ?? '', /permission denied for table branches/i);
        return true;
      });
    });
  });
});
