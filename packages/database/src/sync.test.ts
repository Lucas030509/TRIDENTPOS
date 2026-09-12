import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

import { getPool } from './connection.js';
import { migrateUp } from './runner.js';
import { SyncCheckpointRepository } from './sync/checkpoint-repository.js';
import { SyncTelemetryRepository } from './sync/telemetry-repository.js';

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

    const retrieved = await checkpointRepo.getCheckpoint(pool, tenantAId, branchA1Id, 'OUTBOX_INGESTION');
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

    const retrieved = await checkpointRepo.getCheckpoint(pool, tenantAId, branchA1Id, 'OUTBOX_INGESTION');
    assert.ok(retrieved);
    assert.equal(retrieved.lastSyncedSequence, 84);
    assert.equal(retrieved.lastSnapshotVersion, 5);
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
});
