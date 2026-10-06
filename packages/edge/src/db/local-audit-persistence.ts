/**
 * TRIDENTPOS Internal Edge Local Audit Trail Persistence Layer (ADR-004 / ADR-006 / Gate B)
 * Strictly module-internal to @trident/edge.
 * Manages SQLite persistence for local_audit_trail across edge modules (Caja, IAM, POS).
 */

import crypto from 'node:crypto';
import type { EdgeDatabaseService } from './edge-database.js';

export interface LocalAuditTrailRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorId: string;
  readonly stationId: string;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly detailsJson: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly isSynced: number;
}

export interface RecordLocalAuditInput {
  readonly id?: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorId: string;
  readonly stationId: string;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly details: unknown;
  readonly reason?: string | null;
  readonly createdAt?: string;
}

export class LocalAuditTrailPersistence {
  readonly #edgeDb: EdgeDatabaseService;

  constructor(edgeDb: EdgeDatabaseService) {
    this.#edgeDb = edgeDb;
    this.#initializeSchema();
  }

  #initializeSchema(): void {
    this.#edgeDb.executeSchema(`
      CREATE TABLE IF NOT EXISTS local_audit_trail (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        action TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        details_json TEXT NOT NULL,
        reason TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        is_synced INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_local_audit_tenant ON local_audit_trail (organization_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_local_audit_aggregate ON local_audit_trail (aggregate_type, aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_local_audit_action ON local_audit_trail (action);
    `);
  }

  public recordAudit(input: RecordLocalAuditInput): LocalAuditTrailRecord {
    const id = input.id ?? crypto.randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const detailsJson =
      typeof input.details === 'string' ? input.details : JSON.stringify(input.details);
    const reason = input.reason ?? null;

    this.#edgeDb.executeMutation(
      `INSERT INTO local_audit_trail (
        id, organization_id, branch_id, actor_id, station_id, action,
        aggregate_type, aggregate_id, details_json, reason, created_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
      id,
      input.organizationId,
      input.branchId,
      input.actorId,
      input.stationId,
      input.action,
      input.aggregateType,
      input.aggregateId,
      detailsJson,
      reason,
      createdAt,
    );

    return {
      id,
      organizationId: input.organizationId,
      branchId: input.branchId,
      actorId: input.actorId,
      stationId: input.stationId,
      action: input.action,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      detailsJson,
      reason,
      createdAt,
      isSynced: 0,
    };
  }

  public listAuditEvents(filter?: {
    organizationId?: string;
    branchId?: string;
    aggregateType?: string;
    aggregateId?: string;
    action?: string;
  }): readonly LocalAuditTrailRecord[] {
    let query = `SELECT id, organization_id AS organizationId, branch_id AS branchId,
                        actor_id AS actorId, station_id AS stationId, action,
                        aggregate_type AS aggregateType, aggregate_id AS aggregateId,
                        details_json AS detailsJson, reason, created_at AS createdAt,
                        is_synced AS isSynced
                 FROM local_audit_trail WHERE 1=1`;
    const params: unknown[] = [];

    if (filter?.organizationId) {
      query += ` AND organization_id = ?`;
      params.push(filter.organizationId);
    }
    if (filter?.branchId) {
      query += ` AND branch_id = ?`;
      params.push(filter.branchId);
    }
    if (filter?.aggregateType) {
      query += ` AND aggregate_type = ?`;
      params.push(filter.aggregateType);
    }
    if (filter?.aggregateId) {
      query += ` AND aggregate_id = ?`;
      params.push(filter.aggregateId);
    }
    if (filter?.action) {
      query += ` AND action = ?`;
      params.push(filter.action);
    }

    query += ` ORDER BY created_at ASC;`;

    return this.#edgeDb.queryRowsSafe<LocalAuditTrailRecord>(query, ...params);
  }
}
