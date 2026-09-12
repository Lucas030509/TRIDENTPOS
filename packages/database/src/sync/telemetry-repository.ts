/**
 * TRIDENTPOS Cloud Sync Telemetry Repository (WP-013)
 * Manages persistence for sync_telemetry table.
 */

import type pg from 'pg';
import type { SyncTelemetryEvent, SyncTelemetryEventType } from '@trident/core';

export class SyncTelemetryRepository {
  public async recordTelemetry(
    client: pg.PoolClient | pg.Pool,
    event: SyncTelemetryEvent,
  ): Promise<SyncTelemetryEvent> {
    const query = `
      INSERT INTO sync_telemetry (
        organization_id,
        branch_id,
        event_type,
        duration_ms,
        records_count,
        details,
        occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
      RETURNING
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        event_type AS "eventType",
        duration_ms AS "durationMs",
        records_count AS "recordsCount",
        details,
        occurred_at AS "occurredAt";
    `;

    const res = await client.query<{
      id: string;
      organizationId: string;
      branchId: string;
      eventType: SyncTelemetryEventType;
      durationMs: number | null;
      recordsCount: number;
      details: Record<string, unknown>;
      occurredAt: Date;
    }>(query, [
      event.organizationId,
      event.branchId,
      event.eventType,
      event.durationMs ?? null,
      event.recordsCount,
      JSON.stringify(event.details ?? {}),
      event.occurredAt ?? null,
    ]);

    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to record sync telemetry event');
    }

    return {
      ...row,
      durationMs: row.durationMs !== null ? Number(row.durationMs) : null,
      recordsCount: Number(row.recordsCount),
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    };
  }

  public async queryTelemetry(
    client: pg.PoolClient | pg.Pool,
    orgId: string,
    branchId?: string,
    limit = 50,
  ): Promise<SyncTelemetryEvent[]> {
    let query: string;
    let params: unknown[];

    if (branchId) {
      query = `
        SELECT
          id,
          organization_id AS "organizationId",
          branch_id AS "branchId",
          event_type AS "eventType",
          duration_ms AS "durationMs",
          records_count AS "recordsCount",
          details,
          occurred_at AS "occurredAt"
        FROM sync_telemetry
        WHERE organization_id = $1 AND branch_id = $2
        ORDER BY occurred_at DESC
        LIMIT $3;
      `;
      params = [orgId, branchId, limit];
    } else {
      query = `
        SELECT
          id,
          organization_id AS "organizationId",
          branch_id AS "branchId",
          event_type AS "eventType",
          duration_ms AS "durationMs",
          records_count AS "recordsCount",
          details,
          occurred_at AS "occurredAt"
        FROM sync_telemetry
        WHERE organization_id = $1
        ORDER BY occurred_at DESC
        LIMIT $2;
      `;
      params = [orgId, limit];
    }

    const res = await client.query<{
      id: string;
      organizationId: string;
      branchId: string;
      eventType: SyncTelemetryEventType;
      durationMs: number | null;
      recordsCount: number;
      details: Record<string, unknown>;
      occurredAt: Date;
    }>(query, params);

    return res.rows.map((row) => ({
      ...row,
      durationMs: row.durationMs !== null ? Number(row.durationMs) : null,
      recordsCount: Number(row.recordsCount),
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    }));
  }
}
