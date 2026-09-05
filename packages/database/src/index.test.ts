import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type pg from 'pg';
import { SignJWT, generateKeyPair } from 'jose';
import { getPool, closePool, checkConnection } from './connection.js';
import { migrateUp, migrateDown, getMigrationStatus, DEFAULT_MIGRATIONS_DIR } from './runner.js';
import { computeChecksum } from './checksum.js';
import { loadMigrationFiles } from './parser.js';
import { setTenantContext } from './tenant.js';
import {
  authenticateTenantPrincipal,
  provisionBranchPinCredential,
  rotateBranchPinCredential,
  revokeBranchPinCredential,
} from './iam.js';
import { createAuditLogger } from './audit.js';
import {
  ARGON2ID_FROZEN_BASELINE,
  GENESIS_PREVIOUS_RECORD_HASH,
  REDACTED_MARKER,
} from '@trident/core';

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
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations, _migrations CASCADE;
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

  const wp004SuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp004-suite-'));
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${baselineId}_baseline_infrastructure.sql`),
    path.join(wp004SuiteDir, `${baselineId}_baseline_infrastructure.sql`),
  );
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${wp004Id}_tenant_rls_foundation.sql`),
    path.join(wp004SuiteDir, `${wp004Id}_tenant_rls_foundation.sql`),
  );

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // Rollback safety
      }
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Reset role safety
      }
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
      // Ensure clean state before running migrateUp on wp004SuiteDir
      await client.query(`
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id IN ('${wp004Id}', '20260904180000');
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
      // Apply zero-to-latest migrations up to WP-004 on isolated wp004SuiteDir
      await migrateUp(pool, { migrationsDir: wp004SuiteDir });
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
      fs.rmSync(wp004SuiteDir, { recursive: true, force: true });
    }
  });

  it('WP004-T01: WP-003 -> WP-004 migration applies', async () => {
    const statuses = await getMigrationStatus(pool, { migrationsDir: wp004SuiteDir });
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
      try {
        await client.query('DROP TABLE IF EXISTS test_composite_ref CASCADE;');
      } catch {
        // Cleanup safety
      }
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
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Reset role safety
      }
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
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto, "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
      `);
    } finally {
      client.release();
    }

    const res = await migrateUp(pool, { migrationsDir: wp004SuiteDir });
    assert.equal(res.alreadyUpToDate, false);
    assert.ok(res.applied.includes(`${baselineId}_baseline_infrastructure`));
    assert.ok(res.applied.includes(`${wp004Id}_tenant_rls_foundation`));

    const status = await getMigrationStatus(pool, { migrationsDir: wp004SuiteDir });
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
    const downResult = await migrateDown(pool, {
      migrationsDir: wp004SuiteDir,
      allowDestructiveDown: true,
    });
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
    const upRes = await migrateUp(pool, { migrationsDir: wp004SuiteDir });
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

describe('TRIDENTPOS WP-005 Cloud IAM & Administrative Authentication Suite', () => {
  const pool = getPool();
  const testRole = 'trident_test_app';
  const baselineId = '20260904160000';
  const wp004Id = '20260904170000';
  const wp005Id = '20260904180000';

  const wp005SuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp005-suite-'));
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${baselineId}_baseline_infrastructure.sql`),
    path.join(wp005SuiteDir, `${baselineId}_baseline_infrastructure.sql`),
  );
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${wp004Id}_tenant_rls_foundation.sql`),
    path.join(wp005SuiteDir, `${wp004Id}_tenant_rls_foundation.sql`),
  );
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIR, `${wp005Id}_cloud_iam_auth.sql`),
    path.join(wp005SuiteDir, `${wp005Id}_cloud_iam_auth.sql`),
  );

  const tenantAId = '11111111-1111-1111-1111-111111111111';
  const tenantBId = '22222222-2222-2222-2222-222222222222';
  const branchA1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchA2Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  const branchB1Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // Verified Supabase subject UUIDs (jwt.sub)
  const userA1Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'; // Active Admin Tenant A
  const userA2Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6e'; // Inactive Tenant A
  const userB1Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6f'; // Active Tenant B
  const userB2Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb70'; // Active Tenant B (Same email as User A1)

  const roleAdminAId = '33333333-3333-3333-3333-333333333331';
  const roleWaiterAId = '33333333-3333-3333-3333-333333333332';
  const roleInactiveAId = '33333333-3333-3333-3333-333333333333';
  const roleAdminBId = '33333333-3333-3333-3333-333333333334';

  const credA1Id = '44444444-4444-4444-4444-444444444441';
  const credB1Id = '44444444-4444-4444-4444-444444444442';

  const testIssuer = 'https://auth.tridentpos.test';
  const testAudience = 'https://api.tridentpos.test';

  let rsaPublicKey: Parameters<typeof authenticateTenantPrincipal>[2]['key'];
  let rsaPrivateKey: Parameters<SignJWT['sign']>[0];
  let roguePrivateKey: Parameters<SignJWT['sign']>[0];

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // Rollback safety
      }
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Reset role safety
      }
      client.release();
    }
  }

  async function seedWp005Data(): Promise<void> {
    const client = await pool.connect();
    try {
      // 1. Seed base tenant infrastructure (organizations & branches)
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Tenant A Legal Name', 'Tenant A Trade', 'TAX-ORG-A'),
          ('${tenantBId}', 'Tenant B Legal Name', 'Tenant B Trade', 'TAX-ORG-B')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchA1Id}', '${tenantAId}', 'BR-A1', 'Branch A Primary'),
          ('${branchA2Id}', '${tenantAId}', 'BR-A2', 'Branch A Secondary'),
          ('${branchB1Id}', '${tenantBId}', 'BR-B1', 'Branch B Primary')
        ON CONFLICT (id) DO NOTHING;
      `);

      // 2. Seed Users
      await client.query(`
        INSERT INTO users (id, organization_id, email, full_name, is_active)
        VALUES
          ('${userA1Id}', '${tenantAId}', 'admin@tenant-a.com', 'Admin Tenant A', TRUE),
          ('${userA2Id}', '${tenantAId}', 'inactive@tenant-a.com', 'Inactive Tenant A', FALSE),
          ('${userB1Id}', '${tenantBId}', 'admin@tenant-b.com', 'Admin Tenant B', TRUE),
          ('${userB2Id}', '${tenantBId}', 'admin@tenant-a.com', 'User B2 Matching Email', TRUE)
        ON CONFLICT (id) DO NOTHING;
      `);

      // 3. Seed Roles
      await client.query(`
        INSERT INTO roles (id, organization_id, code, name, permissions, is_active)
        VALUES
          ('${roleAdminAId}', '${tenantAId}', 'ROLE_ADMIN', 'Administrator', '["comanda.iniciar", "comanda.enviar", "caja.cobrar", "corte.emitir_x"]', TRUE),
          ('${roleWaiterAId}', '${tenantAId}', 'ROLE_WAITER', 'Mesero', '["comanda.iniciar"]', TRUE),
          ('${roleInactiveAId}', '${tenantAId}', 'ROLE_INACTIVE', 'Inactive Role', '["comanda.iniciar", "corte.emitir_z"]', FALSE),
          ('${roleAdminBId}', '${tenantBId}', 'ROLE_ADMIN_B', 'Admin B', '["catalogo.administrar"]', TRUE)
        ON CONFLICT (id) DO NOTHING;
      `);

      // 4. Seed User Roles
      await client.query(`
        INSERT INTO user_roles (organization_id, user_id, branch_id, role_id)
        VALUES
          ('${tenantAId}', '${userA1Id}', '${branchA1Id}', '${roleAdminAId}'),
          ('${tenantAId}', '${userA1Id}', '${branchA2Id}', '${roleWaiterAId}'),
          ('${tenantAId}', '${userA2Id}', '${branchA1Id}', '${roleInactiveAId}'),
          ('${tenantBId}', '${userB1Id}', '${branchB1Id}', '${roleAdminBId}')
        ON CONFLICT (organization_id, user_id, branch_id, role_id) DO NOTHING;
      `);

      // 5. Seed User Branch Credentials (Argon2id hashes)
      // PIN 1234 for A1:
      const hashA1 =
        '$argon2id$v=19$m=65536,t=3,p=4$qg88Vq1o7w/o7E0dG00Zsw$K9c0VzN840dK3nEwh3+e81m5qK2UqX3s1+5sK2X4e1s';
      // PIN 5678 for B1:
      const hashB1 =
        '$argon2id$v=19$m=65536,t=3,p=4$v7a9b0c1d2e3f4g5h6i7jw$L8b1WzM731cL2mDvg2-d70l4pJ1TpW2r0-4rJ1W3d0r';

      await client.query(`
        INSERT INTO user_branch_credentials (id, organization_id, user_id, branch_id, pin_hash, credential_version, is_revoked)
        VALUES
          ('${credA1Id}', '${tenantAId}', '${userA1Id}', '${branchA1Id}', '${hashA1}', 1, FALSE),
          ('${credB1Id}', '${tenantBId}', '${userB1Id}', '${branchB1Id}', '${hashB1}', 1, FALSE)
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  }

  async function createTestJwt(options: {
    sub?: string;
    iss?: string;
    aud?: string;
    exp?: string | number;
    nbf?: number;
    claims?: Record<string, unknown>;
    signingKey?: Parameters<SignJWT['sign']>[0];
  }): Promise<string> {
    const signer = new SignJWT(options.claims ?? {})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(options.iss ?? testIssuer)
      .setAudience(options.aud ?? testAudience)
      .setIssuedAt();

    if (options.sub !== undefined) {
      signer.setSubject(options.sub);
    }
    if (options.exp !== undefined) {
      signer.setExpirationTime(options.exp);
    } else {
      signer.setExpirationTime('15m');
    }
    if (options.nbf !== undefined) {
      signer.setNotBefore(options.nbf);
    }

    return await signer.sign(options.signingKey ?? rsaPrivateKey);
  }

  before(async () => {
    // Generate real cryptographic keys for tests
    const mainKeys = await generateKeyPair('RS256');
    rsaPublicKey = mainKeys.publicKey;
    rsaPrivateKey = mainKeys.privateKey;

    const rogueKeys = await generateKeyPair('RS256');
    roguePrivateKey = rogueKeys.privateKey;

    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id IN ('${wp004Id}', '${wp005Id}');
      `);
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
      // Apply all migrations up to WP-005 on wp005SuiteDir
      await migrateUp(pool, { migrationsDir: wp005SuiteDir });

      // Grant least-privilege permissions to test role (DML only, no TRUNCATE/REFERENCES/TRIGGER)
      await client.query(`
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE roles TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_roles TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_branch_credentials TO ${testRole};
        GRANT EXECUTE ON FUNCTION current_app_org_id() TO ${testRole};
      `);
      await seedWp005Data();
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id IN ('${wp004Id}', '${wp005Id}');
        DROP OWNED BY ${testRole};
        DROP ROLE ${testRole};
      `);
    } finally {
      client.release();
      fs.rmSync(wp005SuiteDir, { recursive: true, force: true });
    }
  });

  it('WP005-T01: WP-005 migration applies after canonical WP-004', async () => {
    const statuses = await getMigrationStatus(pool, { migrationsDir: wp005SuiteDir });
    const appliedIds = statuses.filter((s) => s.applied).map((s) => s.id);
    assert.ok(appliedIds.includes(baselineId), 'WP-003 baseline must be applied');
    assert.ok(appliedIds.includes(wp004Id), 'WP-004 foundation must be applied');
    assert.ok(appliedIds.includes(wp005Id), 'WP-005 Cloud IAM migration must be applied');
  });

  interface ColumnInfo {
    column_name: string;
    data_type: string;
    is_nullable: string;
  }

  it('WP005-T02: users schema exact', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(cols.rows.map((r) => [r.column_name, r]));

    assert.equal(colMap.get('id')?.data_type, 'uuid');
    assert.equal(colMap.get('id')?.is_nullable, 'NO');
    assert.equal(colMap.get('organization_id')?.data_type, 'uuid');
    assert.equal(colMap.get('organization_id')?.is_nullable, 'NO');
    assert.equal(colMap.get('email')?.is_nullable, 'NO');
    assert.equal(colMap.get('full_name')?.is_nullable, 'NO');
    assert.equal(colMap.get('is_active')?.data_type, 'boolean');
    assert.equal(colMap.get('is_active')?.is_nullable, 'NO');
    assert.equal(colMap.get('created_at')?.is_nullable, 'NO');
    assert.equal(colMap.get('updated_at')?.is_nullable, 'NO');

    const uqCheck = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'u';
    `);
    const conNames = uqCheck.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_users_org_email'));
    assert.ok(conNames.includes('uq_users_org_id'));
  });

  it('WP005-T03: roles schema exact', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'roles'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(cols.rows.map((r) => [r.column_name, r]));

    assert.equal(colMap.get('id')?.data_type, 'uuid');
    assert.equal(colMap.get('id')?.is_nullable, 'NO');
    assert.equal(colMap.get('organization_id')?.data_type, 'uuid');
    assert.equal(colMap.get('organization_id')?.is_nullable, 'NO');
    assert.equal(colMap.get('code')?.is_nullable, 'NO');
    assert.equal(colMap.get('name')?.is_nullable, 'NO');
    assert.equal(colMap.get('permissions')?.data_type, 'jsonb');
    assert.equal(colMap.get('permissions')?.is_nullable, 'NO');
    assert.equal(colMap.get('is_active')?.data_type, 'boolean');
    assert.equal(colMap.get('is_active')?.is_nullable, 'NO');

    const uqCheck = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'roles'::regclass AND contype = 'u';
    `);
    const conNames = uqCheck.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_roles_org_code'));
    assert.ok(conNames.includes('uq_roles_org_id'));
  });

  it('WP005-T04: user_roles schema exact', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_roles'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(cols.rows.map((r) => [r.column_name, r]));

    assert.equal(colMap.get('organization_id')?.data_type, 'uuid');
    assert.equal(colMap.get('user_id')?.data_type, 'uuid');
    assert.equal(colMap.get('branch_id')?.data_type, 'uuid');
    assert.equal(colMap.get('role_id')?.data_type, 'uuid');

    // Verify composite primary key
    const pkCheck = await pool.query<{ conname: string; contype: string }>(`
      SELECT conname, contype FROM pg_constraint
      WHERE conrelid = 'user_roles'::regclass AND contype = 'p';
    `);
    assert.equal(pkCheck.rows.length, 1);

    // Verify composite foreign keys
    const fkCheck = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'user_roles'::regclass AND contype = 'f';
    `);
    const fkNames = fkCheck.rows.map((r) => r.conname);
    assert.ok(fkNames.includes('fk_user_roles_user'));
    assert.ok(fkNames.includes('fk_user_roles_branch'));
    assert.ok(fkNames.includes('fk_user_roles_role'));
  });

  it('WP005-T05: user_branch_credentials schema exact', async () => {
    const cols = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_branch_credentials'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map<string, ColumnInfo>(cols.rows.map((r) => [r.column_name, r]));

    assert.equal(colMap.get('id')?.data_type, 'uuid');
    assert.equal(colMap.get('organization_id')?.data_type, 'uuid');
    assert.equal(colMap.get('user_id')?.data_type, 'uuid');
    assert.equal(colMap.get('branch_id')?.data_type, 'uuid');
    assert.equal(colMap.get('pin_hash')?.is_nullable, 'NO');
    assert.equal(colMap.get('credential_version')?.data_type, 'integer');
    assert.equal(colMap.get('is_revoked')?.data_type, 'boolean');
    assert.equal(colMap.get('updated_at')?.is_nullable, 'NO');

    const conCheck = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'user_branch_credentials'::regclass;
    `);
    const conNames = conCheck.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_user_branch_cred'));
    assert.ok(conNames.includes('uq_user_branch_cred_org_id'));
    assert.ok(conNames.includes('fk_user_branch_cred_user'));
    assert.ok(conNames.includes('fk_user_branch_cred_branch'));
  });

  it('WP005-T06: permissions table DOES NOT exist', async () => {
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'permissions';
    `);
    assert.equal(res.rows.length, 0, 'permissions table must not exist');
  });

  it('WP005-T07: role_permissions table DOES NOT exist', async () => {
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'role_permissions';
    `);
    assert.equal(res.rows.length, 0, 'role_permissions table must not exist');
  });

  it('WP005-T08: users composite tenant identity exists', async () => {
    const res = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND conname = 'uq_users_org_id';
    `);
    assert.equal(res.rows.length, 1);
  });

  it('WP005-T09: roles composite tenant identity exists', async () => {
    const res = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'roles'::regclass AND conname = 'uq_roles_org_id';
    `);
    assert.equal(res.rows.length, 1);
  });

  it('WP005-T10: cross-tenant user_roles FK rejected', async () => {
    // Attempt to assign Tenant B user to Tenant A branch/role under Tenant A organization
    await assert.rejects(
      pool.query(`
        INSERT INTO user_roles (organization_id, user_id, branch_id, role_id)
        VALUES ('${tenantAId}', '${userB1Id}', '${branchA1Id}', '${roleAdminAId}');
      `),
      (err: unknown) => {
        const pgErr = err as { code?: string };
        assert.equal(
          pgErr.code,
          '23503',
          'Cross-tenant FK must be rejected with foreign_key_violation',
        );
        return true;
      },
    );
  });

  it('WP005-T11: cross-tenant credential FK rejected', async () => {
    // Attempt to create credential in Tenant A referencing Tenant B branch
    await assert.rejects(
      pool.query(`
        INSERT INTO user_branch_credentials (organization_id, user_id, branch_id, pin_hash)
        VALUES ('${tenantAId}', '${userA1Id}', '${branchB1Id}', '$argon2id$v=19$dummy');
      `),
      (err: unknown) => {
        const pgErr = err as { code?: string };
        assert.equal(pgErr.code, '23503', 'Cross-tenant credential FK must be rejected');
        return true;
      },
    );
  });

  it('WP005-T12: RLS enabled all four tables', async () => {
    const res = await pool.query<{ relname: string; relrowsecurity: boolean }>(`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('users', 'roles', 'user_roles', 'user_branch_credentials');
    `);
    assert.equal(res.rows.length, 4);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
    }
  });

  it('WP005-T13: FORCE RLS all four tables', async () => {
    const res = await pool.query<{ relname: string; relforcerowsecurity: boolean }>(`
      SELECT relname, relforcerowsecurity FROM pg_class
      WHERE relname IN ('users', 'roles', 'user_roles', 'user_branch_credentials');
    `);
    assert.equal(res.rows.length, 4);
    for (const row of res.rows) {
      assert.equal(row.relforcerowsecurity, true, `FORCE RLS must be enabled on ${row.relname}`);
    }
  });

  it('WP005-T14: no tenant context returns zero rows', async () => {
    await asTestRole(async (client) => {
      const u = await client.query('SELECT * FROM users;');
      assert.equal(u.rows.length, 0);

      const r = await client.query('SELECT * FROM roles;');
      assert.equal(r.rows.length, 0);

      const ur = await client.query('SELECT * FROM user_roles;');
      assert.equal(ur.rows.length, 0);

      const ubc = await client.query('SELECT * FROM user_branch_credentials;');
      assert.equal(ubc.rows.length, 0);
    });
  });

  it('WP005-T15: Tenant A cannot read Tenant B users', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const allUsers = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM users;',
      );
      assert.ok(allUsers.rows.length > 0);
      assert.ok(allUsers.rows.every((row) => row.organization_id === tenantAId));

      const bUser = await client.query('SELECT * FROM users WHERE id = $1;', [userB1Id]);
      assert.equal(bUser.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP005-T16: Tenant A cannot read Tenant B roles', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const allRoles = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM roles;',
      );
      assert.ok(allRoles.rows.length > 0);
      assert.ok(allRoles.rows.every((row) => row.organization_id === tenantAId));

      const bRole = await client.query('SELECT * FROM roles WHERE id = $1;', [roleAdminBId]);
      assert.equal(bRole.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP005-T17: Tenant A cannot read Tenant B user_roles', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const ur = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM user_roles;',
      );
      assert.ok(ur.rows.length > 0);
      assert.ok(ur.rows.every((row) => row.organization_id === tenantAId));

      const bUr = await client.query('SELECT * FROM user_roles WHERE user_id = $1;', [userB1Id]);
      assert.equal(bUr.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP005-T18: Tenant A cannot read Tenant B credentials', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const ubc = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM user_branch_credentials;',
      );
      assert.ok(ubc.rows.length > 0);
      assert.ok(ubc.rows.every((row) => row.organization_id === tenantAId));

      const bCred = await client.query('SELECT * FROM user_branch_credentials WHERE id = $1;', [
        credB1Id,
      ]);
      assert.equal(bCred.rows.length, 0);

      await client.query('COMMIT;');
    });
  });

  it('WP005-T19: valid signed JWT accepted', async () => {
    const token = await createTestJwt({ sub: userA1Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, true);
    if (authResult.ok) {
      assert.equal(authResult.value.userId, userA1Id);
      assert.equal(authResult.value.organizationId, tenantAId);
      assert.equal(authResult.value.branchId, branchA1Id);
      assert.ok(authResult.value.permissions.includes('comanda.iniciar'));
      assert.ok(authResult.value.permissions.includes('caja.cobrar'));
    }
  });

  it('WP005-T20: invalid signature rejected', async () => {
    const token = await createTestJwt({ sub: userA1Id, signingKey: roguePrivateKey });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T21: expired JWT rejected', async () => {
    const token = await createTestJwt({
      sub: userA1Id,
      exp: Math.floor(Date.now() / 1000) - 100,
    });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T22: future nbf rejected', async () => {
    const token = await createTestJwt({
      sub: userA1Id,
      nbf: Math.floor(Date.now() / 1000) + 3600,
    });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T23: wrong issuer rejected', async () => {
    const token = await createTestJwt({
      sub: userA1Id,
      iss: 'https://rogue.example.com',
    });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T24: wrong audience rejected', async () => {
    const token = await createTestJwt({
      sub: userA1Id,
      aud: 'https://other-service.example.com',
    });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T25: missing subject rejected', async () => {
    const token = await createTestJwt({
      claims: { email: 'admin@tenant-a.com' },
    });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T26: alg-none / algorithm confusion rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: testIssuer,
        aud: testAudience,
        sub: userA1Id,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');
    const unsignedToken = `${header}.${payload}.`;

    const authResult = await authenticateTenantPrincipal(
      pool,
      { token: unsignedToken, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'INVALID_JWT');
    }
  });

  it('WP005-T27: jwt.sub maps directly to users.id', async () => {
    const token = await createTestJwt({ sub: userA1Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, true);
    if (authResult.ok) {
      assert.equal(authResult.value.userId, userA1Id);
      // Double check in database that user exists with exactly this ID
      const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1;', [userA1Id]);
      assert.equal(userRes.rows[0]?.id, userA1Id);
    }
  });

  it('WP005-T28: email-only authentication lookup not used', async () => {
    // Attempting to pass an unknown subject UUID with a valid email payload
    const fakeSub = '00000000-0000-0000-0000-000000000000';
    const token = await createTestJwt({
      sub: fakeSub,
      claims: { email: 'admin@tenant-a.com' },
    });

    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'USER_NOT_FOUND_OR_INACTIVE');
    }
  });

  it('WP005-T29: inactive user rejected', async () => {
    const token = await createTestJwt({ sub: userA2Id }); // User A2 is is_active = FALSE
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'USER_NOT_FOUND_OR_INACTIVE');
    }
  });

  it('WP005-T30: Tenant A JWT + Tenant B requested org rejected', async () => {
    const token = await createTestJwt({ sub: userA1Id }); // User A1 belongs to Tenant A
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantBId, candidateBranchId: branchB1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'USER_NOT_FOUND_OR_INACTIVE');
    }
  });

  it('WP005-T31: same email in different tenant does not alter identity binding', async () => {
    // User A1 and User B2 share email 'admin@tenant-a.com', but have distinct subject UUIDs
    const token = await createTestJwt({ sub: userA1Id });

    // Requesting Tenant B context with User A1's token
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantBId },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    // Must be rejected because identity is strictly bound to jwt.sub, not email!
    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'USER_NOT_FOUND_OR_INACTIVE');
    }
  });

  it('WP005-T32: valid branch role permission allowed', async () => {
    const token = await createTestJwt({ sub: userA1Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, true);
    if (authResult.ok) {
      assert.ok(authResult.value.permissions.includes('caja.cobrar'));
    }
  });

  it('WP005-T33: missing permission denied', async () => {
    // User A1 on Branch A2 has Waiter role (only comanda.iniciar)
    const token = await createTestJwt({ sub: userA1Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA2Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, true);
    if (authResult.ok) {
      assert.ok(authResult.value.permissions.includes('comanda.iniciar'));
      assert.equal(authResult.value.permissions.includes('caja.cobrar'), false);
      assert.equal(authResult.value.permissions.includes('corte.emitir_z'), false);
    }
  });

  it('WP005-T34: inactive role denied', async () => {
    // User A2 has roleInactiveAId which is inactive
    const token = await createTestJwt({ sub: userA2Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    // Inactive user/role rejected
    assert.equal(authResult.ok, false);
  });

  it('WP005-T35: wrong branch denied', async () => {
    // User A1 requesting Branch B1 (belonging to Tenant B)
    const token = await createTestJwt({ sub: userA1Id });
    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchB1Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, false);
    if (!authResult.ok) {
      assert.equal(authResult.error.code, 'BRANCH_AUTHORIZATION_FAILED');
    }
  });

  it('WP005-T36: client-supplied role/permission ignored', async () => {
    // Client injects forged claims in token payload
    const token = await createTestJwt({
      sub: userA1Id,
      claims: {
        role: 'SUPER_ADMIN',
        roles: ['GLOBAL_ROOT'],
        permissions: ['*:*'],
        isAdmin: true,
      },
    });

    const authResult = await authenticateTenantPrincipal(
      pool,
      { token, candidateOrganizationId: tenantAId, candidateBranchId: branchA2Id },
      { issuer: testIssuer, audience: testAudience, key: rsaPublicKey },
    );

    assert.equal(authResult.ok, true);
    if (authResult.ok) {
      // Must only contain database-evaluated Waiter permissions for Branch A2
      assert.deepEqual(authResult.value.permissions, ['comanda.iniciar']);
      assert.equal(authResult.value.permissions.includes('*:*'), false);
    }
  });

  it('WP005-T37: Argon2id PIN hash generated', async () => {
    const client = await pool.connect();
    try {
      const testUserId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88';
      await client.query(`
        INSERT INTO users (id, organization_id, email, full_name)
        VALUES ('${testUserId}', '${tenantAId}', 'pin-test@tenant-a.com', 'PIN User')
        ON CONFLICT (id) DO NOTHING;
      `);

      const provRes = await provisionBranchPinCredential(client, {
        organizationId: tenantAId,
        userId: testUserId,
        branchId: branchA1Id,
        pin: '9876',
      });

      assert.equal(provRes.ok, true);
      if (provRes.ok) {
        assert.equal(provRes.value.credentialVersion, 1);
      }
    } finally {
      client.release();
    }
  });

  it('WP005-T38: Argon2 parameters match frozen baseline', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{ pin_hash: string }>(`
        SELECT pin_hash FROM user_branch_credentials
        WHERE user_id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88';
      `);

      assert.ok(res.rows.length > 0);
      const hash = res.rows[0]?.pin_hash ?? '';
      assert.ok(hash.startsWith('$argon2id$v=19$'));
      assert.ok(hash.includes(`m=${ARGON2ID_FROZEN_BASELINE.memoryCost}`));
      assert.ok(hash.includes(`t=${ARGON2ID_FROZEN_BASELINE.timeCost}`));
      assert.ok(hash.includes(`p=${ARGON2ID_FROZEN_BASELINE.parallelism}`));
    } finally {
      client.release();
    }
  });

  it('WP005-T39: PIN rotation increments credential_version atomically', async () => {
    const client = await pool.connect();
    try {
      const rotateRes = await rotateBranchPinCredential(client, {
        organizationId: tenantAId,
        userId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88',
        branchId: branchA1Id,
        newPin: '5432',
      });

      assert.equal(rotateRes.ok, true);
      if (rotateRes.ok) {
        assert.equal(rotateRes.value.credentialVersion, 2);
      }

      const verifyCheck = await client.query<{ credential_version: number; is_revoked: boolean }>(`
        SELECT credential_version, is_revoked FROM user_branch_credentials
        WHERE user_id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88';
      `);
      assert.equal(verifyCheck.rows[0]?.credential_version, 2);
      assert.equal(verifyCheck.rows[0]?.is_revoked, false);
    } finally {
      client.release();
    }
  });

  it('WP005-T40: revoked credential state persists correctly', async () => {
    const client = await pool.connect();
    try {
      const revokeRes = await revokeBranchPinCredential(client, {
        organizationId: tenantAId,
        userId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88',
        branchId: branchA1Id,
      });

      assert.equal(revokeRes.ok, true);

      const check = await client.query<{ is_revoked: boolean }>(`
        SELECT is_revoked FROM user_branch_credentials
        WHERE user_id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb88';
      `);
      assert.equal(check.rows[0]?.is_revoked, true);
    } finally {
      client.release();
    }
  });

  it('WP005-T41: plaintext PIN never persisted', async () => {
    const res = await pool.query<{ pin_hash: string }>(`
      SELECT pin_hash FROM user_branch_credentials;
    `);
    for (const row of res.rows) {
      assert.ok(row.pin_hash.startsWith('$argon2id$'));
      assert.equal(row.pin_hash.includes('1234'), false);
      assert.equal(row.pin_hash.includes('5432'), false);
      assert.equal(row.pin_hash.includes('9876'), false);
    }
  });

  it('WP005-T42: connection reuse does not leak tenant context', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      await client.query('COMMIT;');

      const freshContext = await client.query<{ current_app_org_id: string }>(
        'SELECT current_app_org_id();',
      );
      assert.equal(freshContext.rows[0]?.current_app_org_id, null);
    } finally {
      client.release();
    }
  });

  it('WP005-T43: normal app test role NOBYPASSRLS / NOSUPERUSER', async () => {
    const roleCheck = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${testRole}';
    `);
    assert.equal(roleCheck.rows.length, 1);
    assert.equal(roleCheck.rows[0]?.rolsuper, false);
    assert.equal(roleCheck.rows[0]?.rolbypassrls, false);
  });

  it('WP005-T44: zero-to-latest WP-003 + WP-004 + WP-005 migration', async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto, "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
      `);
    } finally {
      client.release();
    }

    const upRes = await migrateUp(pool, { migrationsDir: wp005SuiteDir });
    assert.equal(upRes.alreadyUpToDate, false);
    assert.ok(upRes.applied.includes(`${baselineId}_baseline_infrastructure`));
    assert.ok(upRes.applied.includes(`${wp004Id}_tenant_rls_foundation`));
    assert.ok(upRes.applied.includes(`${wp005Id}_cloud_iam_auth`));

    const status = await getMigrationStatus(pool, { migrationsDir: wp005SuiteDir });
    assert.equal(status.length, 3);
    assert.ok(status.every((s) => s.applied && s.checksumMatches));
  });

  it('WP005-T45: controlled non-production WP-005 down returns to WP-004 state', async () => {
    const downResult = await migrateDown(pool, {
      migrationsDir: wp005SuiteDir,
      allowDestructiveDown: true,
    });
    assert.equal(downResult.reverted, `${wp005Id}_cloud_iam_auth`);

    // Verify WP-005 tables are dropped
    const checkWp005 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users', 'roles', 'user_roles', 'user_branch_credentials');
    `);
    assert.equal(checkWp005.rows.length, 0);

    // Verify WP-004 tables remain intact
    const checkWp004 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('organizations', 'branches');
    `);
    assert.equal(checkWp004.rows.length, 2);
  });

  it('WP005-T46: up → down → up succeeds', async () => {
    // Re-apply WP-005
    const upRes = await migrateUp(pool, { migrationsDir: wp005SuiteDir });
    assert.ok(upRes.applied.includes(`${wp005Id}_cloud_iam_auth`));

    // Verify WP-005 tables exist again
    const checkWp005 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users', 'roles', 'user_roles', 'user_branch_credentials');
    `);
    assert.equal(checkWp005.rows.length, 4);
  });

  it('WP005-T47: WP-003 and WP-004 migration checksums unchanged', async () => {
    const ledger = await pool.query<{ id: string; checksum: string }>(
      `
      SELECT id, checksum FROM _migrations WHERE id IN ($1, $2) ORDER BY id;
    `,
      [baselineId, wp004Id],
    );

    assert.equal(ledger.rows.length, 2);

    const baselineFile = path.join(
      DEFAULT_MIGRATIONS_DIR,
      `${baselineId}_baseline_infrastructure.sql`,
    );
    const wp004File = path.join(DEFAULT_MIGRATIONS_DIR, `${wp004Id}_tenant_rls_foundation.sql`);

    const expectedBaselineChecksum = computeChecksum(fs.readFileSync(baselineFile, 'utf8'));
    const expectedWp004Checksum = computeChecksum(fs.readFileSync(wp004File, 'utf8'));

    assert.equal(ledger.rows[0]?.checksum, expectedBaselineChecksum);
    assert.equal(ledger.rows[1]?.checksum, expectedWp004Checksum);
  });
});

describe('TRIDENTPOS WP-006 Tamper-Evident Security Logging & Cloud Audit Trail Suite', () => {
  const pool = getPool();
  const testRole = 'trident_test_app';
  const baselineId = '20260904160000';
  const wp004Id = '20260904170000';
  const wp005Id = '20260904180000';
  const wp006Id = '20260904190000';

  const tenantAId = '11111111-1111-1111-1111-111111111111';
  const tenantBId = '22222222-2222-2222-2222-222222222222';
  const branchA1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchA2Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  const branchB1Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const userA1Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const userB1Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6f';

  const stationA1Id = '55555555-5555-5555-5555-555555555551';
  const stationA2Id = '55555555-5555-5555-5555-555555555552';
  const stationB1Id = '55555555-5555-5555-5555-555555555553';

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // Rollback safety
      }
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Reset role safety
      }
      client.release();
    }
  }

  async function seedWp006Data(): Promise<void> {
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
          ('${branchA1Id}', '${tenantAId}', 'BR-A1', 'Branch A Primary'),
          ('${branchA2Id}', '${tenantAId}', 'BR-A2', 'Branch A Secondary'),
          ('${branchB1Id}', '${tenantBId}', 'BR-B1', 'Branch B Primary')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO users (id, organization_id, email, full_name, is_active)
        VALUES
          ('${userA1Id}', '${tenantAId}', 'admin@tenant-a.com', 'Admin Tenant A', TRUE),
          ('${userB1Id}', '${tenantBId}', 'admin@tenant-b.com', 'Admin Tenant B', TRUE)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO stations (id, organization_id, branch_id, code, station_type, is_authorized)
        VALUES
          ('${stationA1Id}', '${tenantAId}', '${branchA1Id}', 'POS-01', 'POS', TRUE),
          ('${stationA2Id}', '${tenantAId}', '${branchA1Id}', 'KDS-01', 'KDS', TRUE),
          ('${stationB1Id}', '${tenantBId}', '${branchB1Id}', 'POS-01', 'POS', TRUE)
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  }

  before(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS security_telemetry_events, audit_log_events, stations, user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto, "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
        DROP FUNCTION IF EXISTS trg_audit_log_append_only() CASCADE;

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

      await migrateUp(pool);

      await client.query(`
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations, branches, users, roles, user_roles, user_branch_credentials, stations TO ${testRole};
        GRANT SELECT, INSERT ON TABLE audit_log_events, security_telemetry_events TO ${testRole};
        GRANT EXECUTE ON FUNCTION current_app_org_id() TO ${testRole};
      `);

      await seedWp006Data();
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS security_telemetry_events, audit_log_events, stations, user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations CASCADE;
        DELETE FROM _migrations WHERE id = '${wp006Id}';
        DROP OWNED BY ${testRole};
        DROP ROLE ${testRole};
      `);
    } finally {
      client.release();
      await closePool(pool);
    }
  });

  it('WP006-T01: migration applies after canonical WP-005 migration', async () => {
    const statuses = await getMigrationStatus(pool);
    const appliedIds = statuses.filter((s) => s.applied).map((s) => s.id);
    assert.ok(appliedIds.includes(baselineId));
    assert.ok(appliedIds.includes(wp004Id));
    assert.ok(appliedIds.includes(wp005Id));
    assert.ok(appliedIds.includes(wp006Id), 'WP-006 migration must be applied');
  });

  it('WP006-T02: stations schema exact', async () => {
    const cols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stations'
      ORDER BY ordinal_position;
    `);
    const colMap = new Map(cols.rows.map((r) => [r.column_name, r]));
    assert.ok(colMap.has('id') && colMap.get('id')?.data_type === 'uuid');
    assert.ok(colMap.has('organization_id') && colMap.get('organization_id')?.is_nullable === 'NO');
    assert.ok(colMap.has('branch_id') && colMap.get('branch_id')?.is_nullable === 'NO');
    assert.ok(colMap.has('code') && colMap.get('code')?.is_nullable === 'NO');
    assert.ok(colMap.has('station_type') && colMap.get('station_type')?.is_nullable === 'NO');
    assert.ok(
      colMap.has('public_key_fingerprint') &&
        colMap.get('public_key_fingerprint')?.is_nullable === 'YES',
    );
    assert.ok(colMap.has('is_authorized') && colMap.get('is_authorized')?.is_nullable === 'NO');

    const constraints = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'stations'::regclass;
    `);
    const conNames = constraints.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_stations_org_branch_code'));
    assert.ok(conNames.includes('uq_stations_org_branch_id'));
    assert.ok(conNames.includes('uq_stations_org_id'));
    assert.ok(conNames.includes('fk_stations_branch'));
  });

  it('WP006-T03: audit_log_events schema exact', async () => {
    const cols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_log_events';
    `);
    const colMap = new Map(cols.rows.map((r) => [r.column_name, r]));
    const expected = [
      'id',
      'organization_id',
      'branch_id',
      'actor_id',
      'station_id',
      'event_type',
      'severity',
      'action',
      'entity_name',
      'entity_id',
      'client_timestamp',
      'server_timestamp',
      'sequence_number',
      'previous_record_hash',
      'record_hash',
      'source',
      'request_id',
      'metadata',
      'created_at',
    ];
    for (const c of expected) {
      assert.ok(colMap.has(c), `Column ${c} must exist in audit_log_events`);
    }

    const constraints = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'audit_log_events'::regclass;
    `);
    const conNames = constraints.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_audit_log_events_org_id'));
    assert.ok(conNames.includes('uq_audit_log_events_seq'));
    assert.ok(conNames.includes('uq_audit_log_events_hash'));
    assert.ok(conNames.includes('fk_audit_log_events_branch'));
    assert.ok(conNames.includes('fk_audit_log_events_actor'));
    assert.ok(conNames.includes('fk_audit_log_events_station'));
  });

  it('WP006-T04: security_telemetry_events schema exact', async () => {
    const cols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'security_telemetry_events';
    `);
    const colMap = new Map(cols.rows.map((r) => [r.column_name, r]));
    const expected = [
      'id',
      'organization_id',
      'branch_id',
      'station_id',
      'actor_id',
      'rule_code',
      'severity',
      'category',
      'details',
      'action_taken',
      'source',
      'request_id',
      'timestamp',
      'created_at',
    ];
    for (const c of expected) {
      assert.ok(colMap.has(c), `Column ${c} must exist in security_telemetry_events`);
    }

    const constraints = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'security_telemetry_events'::regclass;
    `);
    const conNames = constraints.rows.map((r) => r.conname);
    assert.ok(conNames.includes('uq_sec_telemetry_org_id'));
    assert.ok(conNames.includes('fk_sec_telemetry_branch'));
    assert.ok(conNames.includes('fk_sec_telemetry_actor'));
    assert.ok(conNames.includes('fk_sec_telemetry_station'));
  });

  it('WP006-T05: stations RLS enabled', async () => {
    const res = await pool.query<{ rowsecurity: boolean }>(`
      SELECT rowsecurity FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'stations';
    `);
    assert.equal(res.rows[0]?.rowsecurity, true);
  });

  it('WP006-T06: stations FORCE RLS enabled', async () => {
    const res = await pool.query<{ relforcerowsecurity: boolean }>(`
      SELECT relforcerowsecurity FROM pg_class WHERE relname = 'stations';
    `);
    assert.equal(res.rows[0]?.relforcerowsecurity, true);
  });

  it('WP006-T07: audit RLS enabled + forced', async () => {
    const res = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'audit_log_events';
    `);
    assert.equal(res.rows[0]?.relrowsecurity, true);
    assert.equal(res.rows[0]?.relforcerowsecurity, true);
  });

  it('WP006-T08: telemetry RLS enabled + forced', async () => {
    const res = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'security_telemetry_events';
    `);
    assert.equal(res.rows[0]?.relrowsecurity, true);
    assert.equal(res.rows[0]?.relforcerowsecurity, true);
  });

  it('WP006-T09: no tenant context default-deny', async () => {
    await asTestRole(async (client) => {
      const resStations = await client.query('SELECT * FROM stations;');
      assert.equal(resStations.rows.length, 0);

      const resAudit = await client.query('SELECT * FROM audit_log_events;');
      assert.equal(resAudit.rows.length, 0);

      const resTelemetry = await client.query('SELECT * FROM security_telemetry_events;');
      assert.equal(resTelemetry.rows.length, 0);
    });
  });

  it('WP006-T10: Tenant A cannot read Tenant B stations', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const res = await client.query<{ id: string }>('SELECT id FROM stations;');
      const ids = res.rows.map((r) => r.id);
      assert.ok(ids.includes(stationA1Id));
      assert.ok(ids.includes(stationA2Id));
      assert.ok(!ids.includes(stationB1Id));
    });
  });

  it('WP006-T11: Tenant A cannot write Tenant B stations', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await assert.rejects(
        client.query(`
          INSERT INTO stations (id, organization_id, branch_id, code, station_type)
          VALUES ('55555555-5555-5555-5555-555555555599', '${tenantBId}', '${branchB1Id}', 'POS-X', 'POS');
        `),
        /row-level security/i,
      );
    });
  });

  it('WP006-T12: Tenant A cannot read Tenant B audit events', async () => {
    const logger = createAuditLogger(pool);
    // Seed an event for Tenant B
    await logger.logAuditEvent({
      organizationId: tenantBId,
      branchId: branchB1Id,
      eventType: 'test.b',
      action: 'ACTION_B',
      entityName: 'test',
      source: 'CLOUD',
    });

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const res = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM audit_log_events;',
      );
      for (const row of res.rows) {
        assert.equal(row.organization_id, tenantAId);
        assert.notEqual(row.organization_id, tenantBId);
      }
    });
  });

  it('WP006-T13: Tenant A cannot write Tenant B audit events', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await assert.rejects(
        client.query(`
          INSERT INTO audit_log_events (
            organization_id, branch_id, event_type, action, entity_name,
            sequence_number, previous_record_hash, record_hash
          ) VALUES (
            '${tenantBId}', '${branchB1Id}', 'test.malicious', 'MALICIOUS', 'test',
            99, '${GENESIS_PREVIOUS_RECORD_HASH}', '${'0'.repeat(64)}'
          );
        `),
        /row-level security/i,
      );
    });
  });

  it('WP006-T14: Tenant A cannot read Tenant B telemetry', async () => {
    const logger = createAuditLogger(pool);
    await logger.logSecurityTelemetryEvent({
      organizationId: tenantBId,
      branchId: branchB1Id,
      ruleCode: 'RLS_VIOLATION_ATTEMPT',
      severity: 'HIGH',
      category: 'AUTHORIZATION',
      details: { probe: 'test' },
      actionTaken: 'BLOCK',
      source: 'CLOUD',
    });

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const res = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM security_telemetry_events;',
      );
      for (const row of res.rows) {
        assert.equal(row.organization_id, tenantAId);
        assert.notEqual(row.organization_id, tenantBId);
      }
    });
  });

  it('WP006-T15: Tenant A cannot write Tenant B telemetry', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await assert.rejects(
        client.query(`
          INSERT INTO security_telemetry_events (
            organization_id, branch_id, rule_code, severity, category,
            details, action_taken, source
          ) VALUES (
            '${tenantBId}', '${branchB1Id}', 'RLS_VIOLATION_ATTEMPT', 'CRITICAL', 'AUTHORIZATION',
            '{}', 'BLOCK', 'CLOUD'
          );
        `),
        /row-level security/i,
      );
    });
  });

  it('WP006-T16: cross-tenant branch reference rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`
          INSERT INTO stations (organization_id, branch_id, code, station_type)
          VALUES ('${tenantAId}', '${branchB1Id}', 'POS-CROSS', 'POS');
        `),
        /violates foreign key constraint/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T17: cross-tenant actor reference rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`
          INSERT INTO audit_log_events (
            organization_id, branch_id, actor_id, event_type, action, entity_name,
            sequence_number, previous_record_hash, record_hash
          ) VALUES (
            '${tenantAId}', '${branchA1Id}', '${userB1Id}', 'auth.login', 'LOGIN', 'user',
            999, '${GENESIS_PREVIOUS_RECORD_HASH}', '${'b'.repeat(64)}'
          );
        `),
        /violates foreign key constraint/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T18: cross-tenant station reference rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`
          INSERT INTO audit_log_events (
            organization_id, branch_id, station_id, event_type, action, entity_name,
            sequence_number, previous_record_hash, record_hash
          ) VALUES (
            '${tenantAId}', '${branchA1Id}', '${stationB1Id}', 'pos.order', 'CREATE', 'order',
            998, '${GENESIS_PREVIOUS_RECORD_HASH}', '${'c'.repeat(64)}'
          );
        `),
        /violates foreign key constraint/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T19: UPDATE audit_log_events rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`UPDATE audit_log_events SET action = 'MUTATED';`),
        /Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T20: DELETE audit_log_events rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`DELETE FROM audit_log_events;`),
        /Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T21: UPDATE security_telemetry_events rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`UPDATE security_telemetry_events SET action_taken = 'MUTATED';`),
        /Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T22: DELETE security_telemetry_events rejected', async () => {
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`DELETE FROM security_telemetry_events;`),
        /Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T23: application principal cannot TRUNCATE audit_log_events', async () => {
    await asTestRole(async (client) => {
      await assert.rejects(
        client.query('TRUNCATE TABLE audit_log_events;'),
        /permission denied for table audit_log_events/i,
      );
    });
  });

  it('WP006-T24: application principal cannot TRUNCATE security_telemetry_events', async () => {
    await asTestRole(async (client) => {
      await assert.rejects(
        client.query('TRUNCATE TABLE security_telemetry_events;'),
        /permission denied for table security_telemetry_events/i,
      );
    });
  });

  it('WP006-T25: audit parent FKs contain zero SET NULL semantics', async () => {
    const res = await pool.query<{ constraint_name: string; delete_rule: string }>(`
      SELECT constraint_name, delete_rule
      FROM information_schema.referential_constraints
      WHERE constraint_name IN (
        'fk_audit_log_events_branch',
        'fk_audit_log_events_actor',
        'fk_audit_log_events_station',
        'fk_sec_telemetry_branch',
        'fk_sec_telemetry_actor',
        'fk_sec_telemetry_station'
      );
    `);
    assert.equal(res.rows.length, 6, 'Must inspect all 6 audit/telemetry FK constraints');
    for (const r of res.rows) {
      assert.notEqual(r.delete_rule, 'SET NULL', `${r.constraint_name} must NOT use SET NULL`);
      assert.ok(
        r.delete_rule === 'RESTRICT' || r.delete_rule === 'NO ACTION',
        `${r.constraint_name} must use immutable RESTRICT/NO ACTION semantics`,
      );
    }
  });

  it('WP006-T26: audit parent FKs contain zero CASCADE semantics', async () => {
    const res = await pool.query<{ constraint_name: string; delete_rule: string }>(`
      SELECT constraint_name, delete_rule
      FROM information_schema.referential_constraints
      WHERE constraint_name IN (
        'fk_audit_log_events_branch',
        'fk_audit_log_events_actor',
        'fk_audit_log_events_station',
        'fk_sec_telemetry_branch',
        'fk_sec_telemetry_actor',
        'fk_sec_telemetry_station'
      );
    `);
    for (const r of res.rows) {
      assert.notEqual(r.delete_rule, 'CASCADE', `${r.constraint_name} must NOT use CASCADE`);
    }
  });

  it('WP006-T27: referenced branch physical deletion rejected', async () => {
    const logger = createAuditLogger(pool);
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: branchA2Id,
      eventType: 'branch.op',
      action: 'TEST',
      entityName: 'branch',
      source: 'CLOUD',
    });

    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`DELETE FROM branches WHERE id = '${branchA2Id}';`),
        /violates foreign key constraint "fk_audit_log_events_branch"/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T28: branch soft deactivation succeeds', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE branches SET is_active = false WHERE id = '${branchA2Id}' RETURNING is_active;`,
      );
      assert.equal(res.rows[0]?.is_active, false);
    } finally {
      client.release();
    }
  });

  it('WP006-T29: audit event remains field-for-field unchanged after branch deactivation', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{
        branch_id: string;
        event_type: string;
        action: string;
        sequence_number: string;
        previous_record_hash: string;
        record_hash: string;
      }>(`
        SELECT branch_id, event_type, action, sequence_number, previous_record_hash, record_hash
        FROM audit_log_events
        WHERE organization_id = '${tenantAId}' AND branch_id = '${branchA2Id}'
        ORDER BY sequence_number DESC LIMIT 1;
      `);
      assert.equal(res.rows[0]?.branch_id, branchA2Id);
      assert.equal(res.rows[0]?.event_type, 'branch.op');
      assert.equal(res.rows[0]?.action, 'TEST');
    } finally {
      client.release();
    }
  });

  it('WP006-T30: referenced user physical deletion rejected', async () => {
    const logger = createAuditLogger(pool);
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: branchA1Id,
      actorId: userA1Id,
      eventType: 'user.op',
      action: 'TEST',
      entityName: 'user',
      source: 'CLOUD',
    });

    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`DELETE FROM users WHERE id = '${userA1Id}';`),
        /violates foreign key constraint "fk_audit_log_events_actor"/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T31: user soft deactivation succeeds', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE users SET is_active = false WHERE id = '${userA1Id}' RETURNING is_active;`,
      );
      assert.equal(res.rows[0]?.is_active, false);
    } finally {
      client.release();
    }
  });

  it('WP006-T32: audit event remains unchanged after user deactivation', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{ actor_id: string; event_type: string }>(`
        SELECT actor_id, event_type FROM audit_log_events
        WHERE organization_id = '${tenantAId}' AND actor_id = '${userA1Id}'
        LIMIT 1;
      `);
      assert.equal(res.rows[0]?.actor_id, userA1Id);
      assert.equal(res.rows[0]?.event_type, 'user.op');
    } finally {
      client.release();
    }
  });

  it('WP006-T33: referenced station physical deletion rejected', async () => {
    const logger = createAuditLogger(pool);
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: branchA1Id,
      stationId: stationA2Id,
      eventType: 'station.op',
      action: 'TEST',
      entityName: 'station',
      source: 'CLOUD',
    });

    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(`DELETE FROM stations WHERE id = '${stationA2Id}';`),
        /violates foreign key constraint "fk_audit_log_events_station"/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP006-T34: station soft deauthorization succeeds', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE stations SET is_authorized = false WHERE id = '${stationA2Id}' RETURNING is_authorized;`,
      );
      assert.equal(res.rows[0]?.is_authorized, false);
    } finally {
      client.release();
    }
  });

  it('WP006-T35: audit event remains unchanged after station deauthorization', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{ station_id: string; event_type: string }>(`
        SELECT station_id, event_type FROM audit_log_events
        WHERE organization_id = '${tenantAId}' AND station_id = '${stationA2Id}'
        LIMIT 1;
      `);
      assert.equal(res.rows[0]?.station_id, stationA2Id);
      assert.equal(res.rows[0]?.event_type, 'station.op');
    } finally {
      client.release();
    }
  });

  it('WP006-T36: no audit/telemetry row cascade-deleted', async () => {
    const client = await pool.connect();
    try {
      const auditCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM audit_log_events;',
      );
      const telemetryCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM security_telemetry_events;',
      );
      assert.ok(parseInt(auditCount.rows[0]?.count || '0', 10) > 0);
      assert.ok(parseInt(telemetryCount.rows[0]?.count || '0', 10) > 0);
    } finally {
      client.release();
    }
  });

  it('WP006-T46: plaintext prohibited value never reaches persistence mock/test sink', async () => {
    const logger = createAuditLogger(pool);
    const eventId = await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: branchA1Id,
      eventType: 'auth.attempt',
      action: 'LOGIN',
      entityName: 'auth',
      source: 'CLOUD',
      metadata: {
        password: 'RawPasswordPlaintext!',
        pin: '9876',
        pin_hash: 'raw_hash_to_redact',
        apiKey: 'secret_api_key_value',
      },
    });

    const client = await pool.connect();
    try {
      const res = await client.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_log_events WHERE id = $1;`,
        [eventId],
      );
      const meta = res.rows[0]?.metadata || {};
      assert.equal(meta['password'], REDACTED_MARKER);
      assert.equal(meta['pin'], REDACTED_MARKER);
      assert.equal(meta['pin_hash'], REDACTED_MARKER);
      assert.equal(meta['apiKey'], REDACTED_MARKER);
      const rawJson = JSON.stringify(meta);
      assert.ok(!rawJson.includes('RawPasswordPlaintext!'));
      assert.ok(!rawJson.includes('9876'));
    } finally {
      client.release();
    }
  });

  it('WP006-T47: plaintext prohibited value never reaches observability test sink', async () => {
    const logger = createAuditLogger(pool);
    const telemetryId = await logger.logSecurityTelemetryEvent({
      organizationId: tenantAId,
      branchId: branchA1Id,
      ruleCode: 'PIN_BRUTE_FORCE',
      severity: 'HIGH',
      category: 'AUTHENTICATION',
      details: {
        password: 'sensitive_input',
        email: 'victim@customer.com',
        phone: '+52 55 1234 5678',
      },
      actionTaken: 'STATION_TEMPORARY_BLOCK',
      source: 'CLOUD',
    });

    const client = await pool.connect();
    try {
      const res = await client.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM security_telemetry_events WHERE id = $1;`,
        [telemetryId],
      );
      const det = res.rows[0]?.details || {};
      assert.equal(det['password'], REDACTED_MARKER);
      assert.equal(det['email'], 'v***@customer.com');
      assert.equal(det['phone'], '******5678');
    } finally {
      client.release();
    }
  });

  it('WP006-T54: sequence strictly increments', async () => {
    const logger = createAuditLogger(pool);
    // Use a clean branch for sequence test
    const seqBranchId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03';
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${seqBranchId}', '${tenantAId}', 'BR-A3', 'Branch Sequence Test')
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }

    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: seqBranchId,
      eventType: 'seq.one',
      action: 'ACT_1',
      entityName: 'seq',
      source: 'CLOUD',
    });
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: seqBranchId,
      eventType: 'seq.two',
      action: 'ACT_2',
      entityName: 'seq',
      source: 'CLOUD',
    });
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: seqBranchId,
      eventType: 'seq.three',
      action: 'ACT_3',
      entityName: 'seq',
      source: 'CLOUD',
    });

    const events = await logger.getAuditTrailSlice(tenantAId, seqBranchId);
    assert.equal(events.length, 3);
    assert.equal(events[0]?.sequenceNumber, 1);
    assert.equal(events[0]?.previousRecordHash, GENESIS_PREVIOUS_RECORD_HASH);
    assert.equal(events[1]?.sequenceNumber, 2);
    assert.equal(events[1]?.previousRecordHash, events[0]?.recordHash);
    assert.equal(events[2]?.sequenceNumber, 3);
    assert.equal(events[2]?.previousRecordHash, events[1]?.recordHash);
  });

  it('WP006-T55: two concurrent writes to same stream remain contiguous', async () => {
    const logger = createAuditLogger(pool);
    const concurrentBranchId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04';
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${concurrentBranchId}', '${tenantAId}', 'BR-A4', 'Branch Concurrent Test')
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }

    // Launch concurrent writes to the same audit stream
    await Promise.all([
      logger.logAuditEvent({
        organizationId: tenantAId,
        branchId: concurrentBranchId,
        eventType: 'concurrent.a',
        action: 'CONCURRENT_A',
        entityName: 'test',
        source: 'CLOUD',
      }),
      logger.logAuditEvent({
        organizationId: tenantAId,
        branchId: concurrentBranchId,
        eventType: 'concurrent.b',
        action: 'CONCURRENT_B',
        entityName: 'test',
        source: 'CLOUD',
      }),
    ]);

    const events = await logger.getAuditTrailSlice(tenantAId, concurrentBranchId);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.sequenceNumber, 1);
    assert.equal(events[1]?.sequenceNumber, 2);
    assert.equal(events[1]?.previousRecordHash, events[0]?.recordHash);

    const chainCheck = await logger.verifyStreamChain(tenantAId, concurrentBranchId);
    assert.equal(chainCheck.valid, true);
    assert.equal(chainCheck.eventCount, 2);
  });

  it('WP006-T56: corporate NULL-branch stream remains unique/contiguous', async () => {
    const logger = createAuditLogger(pool);
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: null, // Corporate HQ stream
      eventType: 'corp.event1',
      action: 'CORP_ACTION',
      entityName: 'org',
      source: 'CLOUD',
    });
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: null,
      eventType: 'corp.event2',
      action: 'CORP_ACTION',
      entityName: 'org',
      source: 'CLOUD',
    });

    const corpEvents = await logger.getAuditTrailSlice(tenantAId, null);
    assert.equal(corpEvents.length, 2);
    assert.equal(corpEvents[0]?.sequenceNumber, 1);
    assert.equal(corpEvents[0]?.branchId, null);
    assert.equal(corpEvents[1]?.sequenceNumber, 2);
    assert.equal(corpEvents[1]?.previousRecordHash, corpEvents[0]?.recordHash);
  });

  it('WP006-T57: cross-branch streams have independent sequences', async () => {
    const logger = createAuditLogger(pool);
    const indBranch1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05';
    const indBranch2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06';
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${indBranch1}', '${tenantAId}', 'BR-A5', 'Branch Ind 1'),
          ('${indBranch2}', '${tenantAId}', 'BR-A6', 'Branch Ind 2')
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }

    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: indBranch1,
      eventType: 'stream.b1',
      action: 'ACT',
      entityName: 'item',
      source: 'CLOUD',
    });
    await logger.logAuditEvent({
      organizationId: tenantAId,
      branchId: indBranch2,
      eventType: 'stream.b2',
      action: 'ACT',
      entityName: 'item',
      source: 'CLOUD',
    });

    const b1Events = await logger.getAuditTrailSlice(tenantAId, indBranch1);
    const b2Events = await logger.getAuditTrailSlice(tenantAId, indBranch2);
    assert.equal(b1Events[0]?.sequenceNumber, 1);
    assert.equal(b2Events[0]?.sequenceNumber, 1);
  });

  it('WP006-T67: zero-to-latest migration succeeds', async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS security_telemetry_events, audit_log_events, stations, user_branch_credentials, user_roles, roles, users, test_composite_ref, branches, organizations, _migrations CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto, "uuid-ossp" CASCADE;
        DROP FUNCTION IF EXISTS current_app_org_id() CASCADE;
        DROP FUNCTION IF EXISTS trg_audit_log_append_only() CASCADE;
      `);
    } finally {
      client.release();
    }

    const upRes = await migrateUp(pool);
    assert.equal(upRes.alreadyUpToDate, false);
    assert.ok(upRes.applied.includes(`${baselineId}_baseline_infrastructure`));
    assert.ok(upRes.applied.includes(`${wp004Id}_tenant_rls_foundation`));
    assert.ok(upRes.applied.includes(`${wp005Id}_cloud_iam_auth`));
    assert.ok(upRes.applied.includes(`${wp006Id}_cloud_audit_trail`));

    const status = await getMigrationStatus(pool);
    assert.equal(status.length, 4);
    assert.ok(status.every((s) => s.applied && s.checksumMatches));
  });

  it('WP006-T68: WP-003/WP-004/WP-005 migration checksums unchanged', async () => {
    const ledger = await pool.query<{ id: string; checksum: string }>(
      `SELECT id, checksum FROM _migrations WHERE id IN ($1, $2, $3) ORDER BY id;`,
      [baselineId, wp004Id, wp005Id],
    );
    assert.equal(ledger.rows.length, 3);

    const f1 = path.join(DEFAULT_MIGRATIONS_DIR, `${baselineId}_baseline_infrastructure.sql`);
    const f2 = path.join(DEFAULT_MIGRATIONS_DIR, `${wp004Id}_tenant_rls_foundation.sql`);
    const f3 = path.join(DEFAULT_MIGRATIONS_DIR, `${wp005Id}_cloud_iam_auth.sql`);

    assert.equal(ledger.rows[0]?.checksum, computeChecksum(fs.readFileSync(f1, 'utf8')));
    assert.equal(ledger.rows[1]?.checksum, computeChecksum(fs.readFileSync(f2, 'utf8')));
    assert.equal(ledger.rows[2]?.checksum, computeChecksum(fs.readFileSync(f3, 'utf8')));
  });

  it('WP006-T69: controlled non-production down returns to WP-005 state', async () => {
    const downResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.equal(downResult.reverted, `${wp006Id}_cloud_audit_trail`);

    // Verify WP-006 tables are dropped
    const checkWp006 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('stations', 'audit_log_events', 'security_telemetry_events');
    `);
    assert.equal(checkWp006.rows.length, 0);

    // Verify WP-005 tables remain intact
    const checkWp005 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users', 'roles', 'user_roles', 'user_branch_credentials');
    `);
    assert.equal(checkWp005.rows.length, 4);
  });

  it('WP006-T70: up → down → up succeeds', async () => {
    const upRes = await migrateUp(pool);
    assert.ok(upRes.applied.includes(`${wp006Id}_cloud_audit_trail`));

    const checkWp006 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('stations', 'audit_log_events', 'security_telemetry_events');
    `);
    assert.equal(checkWp006.rows.length, 3);
  });

  it('WP006-T71: stations exists before audit FKs are created', async () => {
    const constraints = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'audit_log_events'::regclass AND conname = 'fk_audit_log_events_station';
    `);
    assert.equal(constraints.rows.length, 1);

    const stationsTable = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'stations';
    `);
    assert.equal(stationsTable.rows.length, 1);
  });
});
