/**
 * TRIDENTPOS Cloud Sync Checkpoint Repository (WP-013)
 * Manages persistence for sync_checkpoints table.
 */

import type pg from 'pg';
import type { SyncCheckpointRecord } from '@trident/core';

export class SyncCheckpointRepository {
  public async upsertCheckpoint(
    client: pg.PoolClient | pg.Pool,
    checkpoint: Omit<SyncCheckpointRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SyncCheckpointRecord> {
    const query = `
      INSERT INTO sync_checkpoints (
        organization_id,
        branch_id,
        stream_type,
        checkpoint_type,
        last_synced_sequence,
        last_snapshot_version,
        last_sync_timestamp,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (organization_id, branch_id, stream_type)
      DO UPDATE SET
        checkpoint_type = EXCLUDED.checkpoint_type,
        last_synced_sequence = EXCLUDED.last_synced_sequence,
        last_snapshot_version = EXCLUDED.last_snapshot_version,
        last_sync_timestamp = EXCLUDED.last_sync_timestamp,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        stream_type AS "streamType",
        checkpoint_type AS "checkpointType",
        last_synced_sequence AS "lastSyncedSequence",
        last_snapshot_version AS "lastSnapshotVersion",
        last_sync_timestamp AS "lastSyncTimestamp",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;

    const res = await client.query<SyncCheckpointRecord>(query, [
      checkpoint.organizationId,
      checkpoint.branchId,
      checkpoint.streamType,
      checkpoint.checkpointType,
      checkpoint.lastSyncedSequence,
      checkpoint.lastSnapshotVersion,
      checkpoint.lastSyncTimestamp,
      JSON.stringify(checkpoint.metadata ?? {}),
    ]);

    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to upsert sync checkpoint');
    }

    return {
      ...row,
      lastSyncedSequence: Number(row.lastSyncedSequence),
      lastSnapshotVersion: Number(row.lastSnapshotVersion),
    };
  }

  public async getCheckpoint(
    client: pg.PoolClient | pg.Pool,
    orgId: string,
    branchId: string,
    streamType: string,
  ): Promise<SyncCheckpointRecord | null> {
    const query = `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        stream_type AS "streamType",
        checkpoint_type AS "checkpointType",
        last_synced_sequence AS "lastSyncedSequence",
        last_snapshot_version AS "lastSnapshotVersion",
        last_sync_timestamp AS "lastSyncTimestamp",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM sync_checkpoints
      WHERE organization_id = $1 AND branch_id = $2 AND stream_type = $3;
    `;

    const res = await client.query<SyncCheckpointRecord>(query, [orgId, branchId, streamType]);
    const row = res.rows[0];
    if (!row) return null;

    return {
      ...row,
      lastSyncedSequence: Number(row.lastSyncedSequence),
      lastSnapshotVersion: Number(row.lastSnapshotVersion),
    };
  }
}
