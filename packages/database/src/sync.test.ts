import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from './connection.js';
import { migrateUp } from './runner.js';
import { SyncCheckpointRepository } from './sync/checkpoint-repository.js';
import { SyncTelemetryRepository } from './sync/telemetry-repository.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-013 Cloud Sync Repositories & RLS Suite', () => {
  const pool = getPool();
  const checkpointRepo = new SyncCheckpointRepository();
  const telemetryRepo = new SyncTelemetryRepository();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchA1Id = crypto.randomUUID();
  const branchB1Id = crypto.randomUUID();

  before(async () => {
    // Ensure migrations are current
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM sync_telemetry WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM sync_checkpoints WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');

        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP013 Org A', 'Org A', 'TAX-WP013-A-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'WP013 Org B', 'Org B', 'TAX-WP013-B-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchA1Id}', '${tenantAId}', 'BR-013-A1', 'Branch 013 A1'),
          ('${branchB1Id}', '${tenantBId}', 'BR-013-B1', 'Branch 013 B1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trident_wp013_app') THEN
            CREATE ROLE trident_wp013_app NOSUPERUSER NOBYPASSRLS NOINHERIT;
          END IF;
        END
        $$;

        GRANT USAGE ON SCHEMA public TO trident_wp013_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO trident_wp013_app;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO trident_wp013_app;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM sync_telemetry WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM sync_checkpoints WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');

        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trident_wp013_app') THEN
            EXECUTE 'DROP OWNED BY trident_wp013_app';
            EXECUTE 'DROP ROLE trident_wp013_app';
          END IF;
        END
        $$;
      `);
    } finally {
      client.release();
    }
  });

  it('WP013-DB-01: SyncCheckpointRepository upserts and retrieves checkpoint', async () => {
    const now = new Date().toISOString();
    const created = await checkpointRepo.upsertCheckpoint(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'INGESTION',
      lastSyncedSequence: 42,
      lastSnapshotVersion: 0,
      lastSyncTimestamp: now,
      metadata: { stationId: 'st-01' },
    });

    assert.ok(created.id);
    assert.equal(created.organizationId, tenantAId);
    assert.equal(created.branchId, branchA1Id);
    assert.equal(created.lastSyncedSequence, 42);

    const retrieved = await checkpointRepo.getCheckpoint(
      pool,
      tenantAId,
      branchA1Id,
      'OUTBOX_INGESTION',
    );
    assert.ok(retrieved);
    assert.equal(retrieved.id, created.id);
    assert.equal(retrieved.lastSyncedSequence, 42);
    assert.deepEqual(retrieved.metadata, { stationId: 'st-01' });
  });

  it('WP013-DB-02: SyncCheckpointRepository updates existing checkpoint monotonically', async () => {
    const updatedTimestamp = new Date().toISOString();
    const updated = await checkpointRepo.upsertCheckpoint(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'INGESTION',
      lastSyncedSequence: 84,
      lastSnapshotVersion: 5,
      lastSyncTimestamp: updatedTimestamp,
      metadata: { stationId: 'st-01', batchCount: 2 },
    });

    assert.equal(updated.lastSyncedSequence, 84);
    assert.equal(updated.lastSnapshotVersion, 5);

    const retrieved = await checkpointRepo.getCheckpoint(
      pool,
      tenantAId,
      branchA1Id,
      'OUTBOX_INGESTION',
    );
    assert.ok(retrieved);
    assert.equal(retrieved.lastSyncedSequence, 84);
    assert.equal(retrieved.lastSnapshotVersion, 5);
  });

  it('WP013-DB-06: Checkpoint sequence regression 84 -> 40 is rejected fail-closed', async () => {
    await assert.rejects(
      async () => {
        await checkpointRepo.upsertCheckpoint(pool, {
          organizationId: tenantAId,
          branchId: branchA1Id,
          streamType: 'OUTBOX_INGESTION',
          checkpointType: 'INGESTION',
          lastSyncedSequence: 40, // Regressing from 84 to 40
          lastSnapshotVersion: 5,
          lastSyncTimestamp: new Date().toISOString(),
          metadata: {},
        });
      },
      (err: Error) => {
        return err.message.includes('CHECKPOINT_REGRESSION_REJECTED') && err.message.includes('40');
      },
    );

    // Verify current persisted checkpoint remains untouched at 84
    const current = await checkpointRepo.getCheckpoint(
      pool,
      tenantAId,
      branchA1Id,
      'OUTBOX_INGESTION',
    );
    assert.ok(current);
    assert.equal(current.lastSyncedSequence, 84);
  });

  it('WP013-DB-07: Checkpoint snapshot version regression 5 -> 3 is rejected fail-closed', async () => {
    await assert.rejects(
      async () => {
        await checkpointRepo.upsertCheckpoint(pool, {
          organizationId: tenantAId,
          branchId: branchA1Id,
          streamType: 'OUTBOX_INGESTION',
          checkpointType: 'INGESTION',
          lastSyncedSequence: 90, // Valid advance
          lastSnapshotVersion: 3, // Regressing from 5 to 3
          lastSyncTimestamp: new Date().toISOString(),
          metadata: {},
        });
      },
      (err: Error) => {
        return err.message.includes('CHECKPOINT_REGRESSION_REJECTED') && err.message.includes('3');
      },
    );

    // Verify current persisted checkpoint remains untouched at 84 / 5
    const current = await checkpointRepo.getCheckpoint(
      pool,
      tenantAId,
      branchA1Id,
      'OUTBOX_INGESTION',
    );
    assert.ok(current);
    assert.equal(current.lastSnapshotVersion, 5);
  });

  it('WP013-DB-08: Equal checkpoint values remain idempotently acceptable', async () => {
    const res = await checkpointRepo.upsertCheckpoint(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'INGESTION',
      lastSyncedSequence: 84, // Equal
      lastSnapshotVersion: 5, // Equal
      lastSyncTimestamp: new Date().toISOString(),
      metadata: { idempotent: true },
    });

    assert.equal(res.lastSyncedSequence, 84);
    assert.equal(res.lastSnapshotVersion, 5);
  });

  it('WP013-DB-03: SyncCheckpointRepository respects branch foreign key constraint', async () => {
    const nonExistentBranch = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await checkpointRepo.upsertCheckpoint(pool, {
          organizationId: tenantAId,
          branchId: nonExistentBranch,
          streamType: 'TEST_STREAM',
          checkpointType: 'TEST',
          lastSyncedSequence: 1,
          lastSnapshotVersion: 0,
          lastSyncTimestamp: new Date().toISOString(),
          metadata: {},
        });
      },
      (err: Error) => {
        return err.message.includes('foreign key constraint');
      },
    );
  });

  it('WP013-DB-04: SyncTelemetryRepository records telemetry and queries by branch and organization', async () => {
    const event1 = await telemetryRepo.recordTelemetry(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      eventType: 'WAN_DISCONNECTED',
      durationMs: null,
      recordsCount: 0,
      details: { reason: 'offline' },
    });
    assert.ok(event1.id);
    assert.equal(event1.eventType, 'WAN_DISCONNECTED');

    const event2 = await telemetryRepo.recordTelemetry(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      eventType: 'OUTBOX_DRAINED',
      durationMs: 150,
      recordsCount: 5,
      details: { flushed: 5 },
    });
    assert.ok(event2.id);
    assert.equal(event2.durationMs, 150);
    assert.equal(event2.recordsCount, 5);

    // Query branch telemetry
    const branchEvents = await telemetryRepo.queryTelemetry(pool, tenantAId, branchA1Id, 10);
    assert.ok(branchEvents.length >= 2);

    // Query org telemetry
    const orgEvents = await telemetryRepo.queryTelemetry(pool, tenantAId, undefined, 10);
    assert.ok(orgEvents.length >= 2);
  });

  it('WP013-DB-05: RLS enforces tenant isolation on sync_checkpoints and sync_telemetry', async () => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE trident_wp013_app;');

      // Set session org to tenant B
      await client.query(`SELECT set_config('app.current_organization_id', '${tenantBId}', false)`);

      // Tenant B should not see Tenant A's checkpoint
      const checkRes = await client.query(
        'SELECT * FROM sync_checkpoints WHERE organization_id = $1',
        [tenantAId],
      );
      assert.equal(checkRes.rows.length, 0);

      // Tenant B should not see Tenant A's telemetry
      const telemRes = await client.query(
        'SELECT * FROM sync_telemetry WHERE organization_id = $1',
        [tenantAId],
      );
      assert.equal(telemRes.rows.length, 0);

      // Switch to Tenant A
      await client.query(`SELECT set_config('app.current_organization_id', '${tenantAId}', false)`);
      const checkA = await client.query(
        'SELECT * FROM sync_checkpoints WHERE organization_id = $1',
        [tenantAId],
      );
      assert.ok(checkA.rows.length > 0);
    } finally {
      await client.query('RESET ROLE;');
      await client.query(`SELECT set_config('app.current_organization_id', '', false)`);
      client.release();
    }
  });

  // =========================================================================
  // R2-04: Concurrent PostgreSQL Checkpoint Monotonicity
  // Exercises real overlap/concurrency using at least TWO independent
  // PostgreSQL connections. Proves that lower updates never overwrite higher
  // updates at the SQL level for sequence and snapshot versions.
  // =========================================================================
  it('WP013-DB-09: Concurrent PostgreSQL Checkpoint Monotonicity across independent connections', async () => {
    // 1. Establish canonical checkpoint baseline: sequence 100, snapshot 10
    const baseline = await checkpointRepo.upsertCheckpoint(pool, {
      organizationId: tenantAId,
      branchId: branchA1Id,
      streamType: 'CONCURRENT_TEST_STREAM',
      checkpointType: 'UPSTREAM_SYNC',
      lastSyncedSequence: 100,
      lastSnapshotVersion: 10,
      lastSyncTimestamp: new Date().toISOString(),
      metadata: { stage: 'baseline' },
    });
    assert.equal(baseline.lastSyncedSequence, 100);
    assert.equal(baseline.lastSnapshotVersion, 10);

    // 2. Open TWO independent PostgreSQL connections
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      // 3 & 4. Connection A attempts higher checkpoint (150, 15).
      // Connection B concurrently attempts lower/stale checkpoint (80, 8).
      // Both execute against PostgreSQL's atomic ON CONFLICT DO UPDATE WHERE ...
      const upsertSql = `
        INSERT INTO sync_checkpoints (
          organization_id, branch_id, stream_type, checkpoint_type,
          last_synced_sequence, last_snapshot_version, last_sync_timestamp, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (organization_id, branch_id, stream_type)
        DO UPDATE SET
          checkpoint_type = EXCLUDED.checkpoint_type,
          last_synced_sequence = EXCLUDED.last_synced_sequence,
          last_snapshot_version = EXCLUDED.last_snapshot_version,
          last_sync_timestamp = EXCLUDED.last_sync_timestamp,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        WHERE EXCLUDED.last_synced_sequence >= sync_checkpoints.last_synced_sequence
          AND EXCLUDED.last_snapshot_version >= sync_checkpoints.last_snapshot_version
        RETURNING last_synced_sequence, last_snapshot_version;
      `;

      // Run real overlapping concurrent executions
      const [resA, resB] = await Promise.all([
        clientA.query(upsertSql, [
          tenantAId,
          branchA1Id,
          'CONCURRENT_TEST_STREAM',
          'UPSTREAM_SYNC',
          150,
          15,
          new Date().toISOString(),
          JSON.stringify({ worker: 'clientA' }),
        ]),
        clientB.query(upsertSql, [
          tenantAId,
          branchA1Id,
          'CONCURRENT_TEST_STREAM',
          'UPSTREAM_SYNC',
          80,
          8,
          new Date().toISOString(),
          JSON.stringify({ worker: 'clientB' }),
        ]),
      ]);

      // Connection A with higher values must return the updated row
      assert.equal(resA.rows.length, 1);
      assert.equal(Number(resA.rows[0].last_synced_sequence), 150);
      assert.equal(Number(resA.rows[0].last_snapshot_version), 15);

      // Connection B with stale/lower values must produce 0 row mutations
      assert.equal(
        resB.rows.length,
        0,
        'Stale lower checkpoint update must produce zero row mutations',
      );

      // 5 & 6. Verify final persisted authority in PostgreSQL MUST be the highest monotonic value
      const verified = await pool.query(
        `SELECT last_synced_sequence, last_snapshot_version, metadata FROM sync_checkpoints 
         WHERE organization_id = $1 AND branch_id = $2 AND stream_type = $3`,
        [tenantAId, branchA1Id, 'CONCURRENT_TEST_STREAM'],
      );
      assert.equal(verified.rows.length, 1);
      assert.equal(Number(verified.rows[0].last_synced_sequence), 150);
      assert.equal(Number(verified.rows[0].last_snapshot_version), 15);
      assert.equal(verified.rows[0].metadata.worker, 'clientA');

      // 7. Demonstrate the same SQL-level protection for snapshot version:
      // Even if sequence is higher (160), if snapshot version regresses (9 < 15), it must be rejected
      const mixedRegressionRes = await clientB.query(upsertSql, [
        tenantAId,
        branchA1Id,
        'CONCURRENT_TEST_STREAM',
        'UPSTREAM_SYNC',
        160,
        9, // regressed from 15
        new Date().toISOString(),
        JSON.stringify({ worker: 'clientB-regressed-snapshot' }),
      ]);
      assert.equal(
        mixedRegressionRes.rows.length,
        0,
        'Snapshot version regression must fail closed in SQL',
      );

      // Verify DB remains untouched at (150, 15)
      const afterMixed = await pool.query(
        `SELECT last_synced_sequence, last_snapshot_version FROM sync_checkpoints 
         WHERE organization_id = $1 AND branch_id = $2 AND stream_type = $3`,
        [tenantAId, branchA1Id, 'CONCURRENT_TEST_STREAM'],
      );
      assert.equal(Number(afterMixed.rows[0].last_synced_sequence), 150);
      assert.equal(Number(afterMixed.rows[0].last_snapshot_version), 15);
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});
