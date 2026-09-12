/**
 * TRIDENTPOS Edge Sync Persistence Layer (ADR-006, SYNC_AND_OFFLINE Sec. 4 & 5, WP-013)
 * Strictly module-internal to @trident/edge.
 * Manages SQLite persistence for:
 * 1. edge_sync_checkpoints (upstream outbox sequence & downstream catalog snapshot)
 * 2. edge_sync_telemetry (local telemetry buffer)
 * 3. catalog_staging & catalog_entities (atomic staging & checksum-verified activation)
 */

import crypto from 'node:crypto';
import {
  CatalogDeltaResponse,
  ERROR_CODE_DELTA_CHECKSUM_MISMATCH,
  SyncCheckpointRecord,
  SyncTelemetryEvent,
  SyncTelemetryEventType,
  computeCatalogDeltaChecksum,
} from '@trident/core';
import { EdgeDatabaseService } from './edge-database.js';
import { getInternalOutboxAdapter, type InternalOutboxAdapter } from './internal-outbox-adapter.js';

export class EdgeSyncPersistence {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #adapter: InternalOutboxAdapter;

  constructor(edgeDb: EdgeDatabaseService) {
    this.#edgeDb = edgeDb;
    this.#adapter = getInternalOutboxAdapter(edgeDb);
    this.#initializeSchema();
  }

  #initializeSchema(): void {
    this.#adapter.exec(`
      CREATE TABLE IF NOT EXISTS edge_sync_checkpoints (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        stream_type TEXT NOT NULL UNIQUE,
        checkpoint_type TEXT NOT NULL,
        last_synced_sequence INTEGER NOT NULL DEFAULT 0,
        last_snapshot_version INTEGER NOT NULL DEFAULT 0,
        last_sync_timestamp TEXT NOT NULL,
        metadata TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edge_sync_telemetry (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        duration_ms INTEGER,
        records_count INTEGER NOT NULL DEFAULT 0,
        details TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_edge_sync_telemetry_occurred ON edge_sync_telemetry (occurred_at);

      CREATE TABLE IF NOT EXISTS catalog_staging (
        id TEXT PRIMARY KEY,
        snapshot_version INTEGER NOT NULL,
        delta_version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        staged_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'STAGED'
      );

      CREATE TABLE IF NOT EXISTS catalog_entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
    `);
  }

  public upsertCheckpoint(checkpoint: SyncCheckpointRecord): void {
    const existing = this.getCheckpoint(checkpoint.streamType);
    if (existing) {
      if (checkpoint.lastSyncedSequence < existing.lastSyncedSequence) {
        throw new Error(
          `CHECKPOINT_REGRESSION_REJECTED: Incoming lastSyncedSequence (${checkpoint.lastSyncedSequence}) < current (${existing.lastSyncedSequence}) for stream '${checkpoint.streamType}'`,
        );
      }
      if (checkpoint.lastSnapshotVersion < existing.lastSnapshotVersion) {
        throw new Error(
          `CHECKPOINT_REGRESSION_REJECTED: Incoming lastSnapshotVersion (${checkpoint.lastSnapshotVersion}) < current (${existing.lastSnapshotVersion}) for stream '${checkpoint.streamType}'`,
        );
      }
    }

    const id = checkpoint.id || crypto.randomUUID();
    const metadataStr = JSON.stringify(checkpoint.metadata ?? {});
    const now = new Date().toISOString();

    const stmt = this.#adapter.prepare(`
      INSERT INTO edge_sync_checkpoints (
        id,
        organization_id,
        branch_id,
        stream_type,
        checkpoint_type,
        last_synced_sequence,
        last_snapshot_version,
        last_sync_timestamp,
        metadata,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (stream_type) DO UPDATE SET
        checkpoint_type = excluded.checkpoint_type,
        last_synced_sequence = excluded.last_synced_sequence,
        last_snapshot_version = excluded.last_snapshot_version,
        last_sync_timestamp = excluded.last_sync_timestamp,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
      WHERE excluded.last_synced_sequence >= edge_sync_checkpoints.last_synced_sequence
        AND excluded.last_snapshot_version >= edge_sync_checkpoints.last_snapshot_version;
    `);

    const info = stmt.run(
      id,
      checkpoint.organizationId,
      checkpoint.branchId,
      checkpoint.streamType,
      checkpoint.checkpointType,
      checkpoint.lastSyncedSequence,
      checkpoint.lastSnapshotVersion,
      checkpoint.lastSyncTimestamp || now,
      metadataStr,
      now,
    );

    if (info.changes === 0 && existing) {
      throw new Error(
        `CHECKPOINT_REGRESSION_REJECTED: Concurrency conflict or sequence regression detected for stream '${checkpoint.streamType}'`,
      );
    }
  }

  public getCheckpoint(streamType: string): SyncCheckpointRecord | null {
    const stmt = this.#adapter.prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        stream_type AS streamType,
        checkpoint_type AS checkpointType,
        last_synced_sequence AS lastSyncedSequence,
        last_snapshot_version AS lastSnapshotVersion,
        last_sync_timestamp AS lastSyncTimestamp,
        metadata,
        updated_at AS updatedAt
      FROM edge_sync_checkpoints
      WHERE stream_type = ?;
    `);

    const row = stmt.get(streamType) as
      | {
          id: string;
          organizationId: string;
          branchId: string;
          streamType: string;
          checkpointType: string;
          lastSyncedSequence: number;
          lastSnapshotVersion: number;
          lastSyncTimestamp: string;
          metadata: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  public recordTelemetry(event: SyncTelemetryEvent): void {
    const id = event.id || crypto.randomUUID();
    const detailsStr = JSON.stringify(event.details ?? {});
    const occurredAt = event.occurredAt || new Date().toISOString();

    const stmt = this.#adapter.prepare(`
      INSERT INTO edge_sync_telemetry (
        id,
        organization_id,
        branch_id,
        event_type,
        duration_ms,
        records_count,
        details,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);

    stmt.run(
      id,
      event.organizationId,
      event.branchId,
      event.eventType,
      event.durationMs ?? null,
      event.recordsCount,
      detailsStr,
      occurredAt,
    );
  }

  public getRecentTelemetry(limit = 50): SyncTelemetryEvent[] {
    const stmt = this.#adapter.prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        event_type AS eventType,
        duration_ms AS durationMs,
        records_count AS recordsCount,
        details,
        occurred_at AS occurredAt
      FROM edge_sync_telemetry
      ORDER BY occurred_at DESC
      LIMIT ?;
    `);

    const rows = stmt.all(limit) as Array<{
      id: string;
      organizationId: string;
      branchId: string;
      eventType: SyncTelemetryEventType;
      durationMs: number | null;
      recordsCount: number;
      details: string;
      occurredAt: string;
    }>;

    return rows.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : undefined,
    }));
  }

  /**
   * Applies a downstream catalog delta response atomically.
   * Conforms to SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 4:
   * 1. Validates checksum across entities
   * 2. Persists into staging table
   * 3. Activates entities into catalog_entities inside runInTransaction()
   * 4. Updates checkpoint with new snapshotVersion
   */
  public applyCatalogDelta(
    orgId: string,
    branchId: string,
    delta: CatalogDeltaResponse,
  ): { success: boolean; appliedCount: number; newSnapshotVersion: number } {
    // 1. Verify Checksum
    const expectedChecksum = computeCatalogDeltaChecksum(delta.entities);
    if (delta.checksum !== expectedChecksum) {
      throw new Error(
        `${ERROR_CODE_DELTA_CHECKSUM_MISMATCH}: Received checksum ${delta.checksum} does not match computed ${expectedChecksum}`,
      );
    }

    // 2. Atomic Staging & Activation
    return this.#edgeDb.runInTransaction(() => {
      const now = new Date().toISOString();
      const stageStmt = this.#adapter.prepare(`
        INSERT INTO catalog_staging (
          id,
          snapshot_version,
          delta_version,
          checksum,
          entity_type,
          entity_id,
          action,
          payload,
          staged_at,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVATED');
      `);

      const upsertEntityStmt = this.#adapter.prepare(`
        INSERT INTO catalog_entities (
          entity_type,
          entity_id,
          version,
          payload,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (entity_type, entity_id) DO UPDATE SET
          version = excluded.version,
          payload = excluded.payload,
          updated_at = excluded.updated_at;
      `);

      const deleteEntityStmt = this.#adapter.prepare(`
        DELETE FROM catalog_entities
        WHERE entity_type = ? AND entity_id = ?;
      `);

      for (const entity of delta.entities) {
        const stageId = crypto.randomUUID();
        const payloadStr = JSON.stringify(entity.data);

        stageStmt.run(
          stageId,
          delta.snapshotVersion,
          delta.deltaVersion,
          delta.checksum,
          entity.entityType,
          entity.entityId,
          entity.action,
          payloadStr,
          now,
        );

        if (entity.action === 'DELETE') {
          deleteEntityStmt.run(entity.entityType, entity.entityId);
        } else {
          upsertEntityStmt.run(entity.entityType, entity.entityId, entity.version, payloadStr, now);
        }
      }

      // Update checkpoint
      this.upsertCheckpoint({
        id: crypto.randomUUID(),
        organizationId: orgId,
        branchId: branchId,
        streamType: 'CATALOG_DELTA',
        checkpointType: 'DOWNSTREAM_SNAPSHOT',
        lastSyncedSequence: 0,
        lastSnapshotVersion: delta.snapshotVersion,
        lastSyncTimestamp: now,
        metadata: {
          deltaVersion: delta.deltaVersion,
          entitiesCount: delta.entities.length,
          checksum: delta.checksum,
        },
      });

      return {
        success: true,
        appliedCount: delta.entities.length,
        newSnapshotVersion: delta.snapshotVersion,
      };
    });
  }

  public getCatalogEntity(entityType: string, entityId: string): Record<string, unknown> | null {
    const stmt = this.#adapter.prepare(`
      SELECT payload
      FROM catalog_entities
      WHERE entity_type = ? AND entity_id = ?;
    `);

    const row = stmt.get(entityType, entityId) as { payload: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload);
  }

  public listCatalogEntities(entityType: string): Record<string, unknown>[] {
    const stmt = this.#adapter.prepare(`
      SELECT payload
      FROM catalog_entities
      WHERE entity_type = ?
      ORDER BY entity_id ASC;
    `);

    const rows = stmt.all(entityType) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload));
  }
}
