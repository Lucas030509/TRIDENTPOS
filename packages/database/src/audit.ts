/**
 * TRIDENTPOS WP-006: Cloud Audit Trail & Security Telemetry Persistence
 * Architecture Baselines: DATA_MODEL.md Sec 2.1, SECURITY_LOGGING_AND_MONITORING.md,
 *                         ACR-2026-007, ACR-2026-008
 */

import type pg from 'pg';
import {
  type AuditEventInput,
  type SecurityTelemetryInput,
  type IAuditLogger,
  type AuditLogEventRecord,
  type CheckpointMetadata,
  GENESIS_PREVIOUS_RECORD_HASH,
  GENESIS_SEQUENCE_NUMBER,
  computeAuditRecordHash,
  redactSensitiveData,
  createCloudCheckpoint,
  verifyAuditHashChain,
} from '@trident/core';
import { withTenantTransaction } from './tenant.js';

export interface AuditStreamHead {
  sequenceNumber: number;
  recordHash: string;
}

export class CloudAuditLogger implements IAuditLogger {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Atomically records an audit event into the tamper-evident SHA-256 hash-chained log.
   * Concurrency-safe: Serializes stream access using transaction-scoped PostgreSQL advisory locks.
   */
  async logAuditEvent(event: AuditEventInput): Promise<string> {
    const orgId = event.organizationId;
    const branchId = event.branchId ?? null;

    return withTenantTransaction(this.pool, orgId, async (client) => {
      // 1. Serialize access to the specific audit stream (orgId, branchId)
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext(coalesce($2::text, 'CORPORATE')));",
        [orgId, branchId],
      );

      // 2. Query prior chain head for this stream
      const headResult = await client.query<{
        sequence_number: string;
        record_hash: string;
      }>(
        `SELECT sequence_number, record_hash
         FROM audit_log_events
         WHERE organization_id = $1
           AND branch_id IS NOT DISTINCT FROM $2
         ORDER BY sequence_number DESC
         LIMIT 1;`,
        [orgId, branchId],
      );

      let sequenceNumber: number;
      let previousRecordHash: string;

      if (headResult.rows.length === 0) {
        sequenceNumber = GENESIS_SEQUENCE_NUMBER;
        previousRecordHash = GENESIS_PREVIOUS_RECORD_HASH;
      } else {
        const head = headResult.rows[0]!;
        sequenceNumber = parseInt(head.sequence_number, 10) + 1;
        previousRecordHash = head.record_hash;
      }

      // 3. Redact metadata BEFORE hash computation and persistence
      const sanitizedMetadata = redactSensitiveData(event.metadata ?? {});

      // 4. Freeze server timestamp authoritative value
      const serverDate = new Date();
      const serverTimestamp = serverDate.toISOString();

      const clientTimestamp = event.clientTimestamp
        ? event.clientTimestamp instanceof Date
          ? event.clientTimestamp.toISOString()
          : new Date(event.clientTimestamp).toISOString()
        : null;

      // 5. Compute deterministic SHA-256 record hash
      const recordHash = computeAuditRecordHash({
        organizationId: orgId,
        branchId,
        sequenceNumber,
        clientTimestamp,
        serverTimestamp,
        eventType: event.eventType,
        action: event.action,
        entityName: event.entityName,
        entityId: event.entityId ?? null,
        actorId: event.actorId ?? null,
        stationId: event.stationId ?? null,
        redactedMetadata: sanitizedMetadata,
        previousRecordHash,
      });

      // 6. Insert audit record
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO audit_log_events (
           organization_id, branch_id, actor_id, station_id,
           event_type, severity, action, entity_name, entity_id,
           client_timestamp, server_timestamp, sequence_number,
           previous_record_hash, record_hash, source, request_id,
           metadata
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12,
           $13, $14, $15, $16,
           $17
         ) RETURNING id;`,
        [
          orgId,
          branchId,
          event.actorId ?? null,
          event.stationId ?? null,
          event.eventType,
          event.severity ?? 'INFO',
          event.action,
          event.entityName,
          event.entityId ?? null,
          clientTimestamp,
          serverTimestamp,
          sequenceNumber,
          previousRecordHash,
          recordHash,
          event.source,
          event.requestId ?? null,
          JSON.stringify(sanitizedMetadata),
        ],
      );

      return insertResult.rows[0]!.id;
    });
  }

  /**
   * Records a security telemetry event with pre-persistence redaction and tenant validation.
   */
  async logSecurityTelemetryEvent(event: SecurityTelemetryInput): Promise<string> {
    const orgId = event.organizationId;
    const branchId = event.branchId ?? null;

    return withTenantTransaction(this.pool, orgId, async (client) => {
      const sanitizedDetails = redactSensitiveData(event.details ?? {});
      const timestamp = event.timestamp
        ? event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : new Date(event.timestamp).toISOString()
        : new Date().toISOString();

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO security_telemetry_events (
           organization_id, branch_id, station_id, actor_id,
           rule_code, severity, category, details,
           action_taken, source, request_id, timestamp
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12
         ) RETURNING id;`,
        [
          orgId,
          branchId,
          event.stationId ?? null,
          event.actorId ?? null,
          event.ruleCode,
          event.severity,
          event.category,
          JSON.stringify(sanitizedDetails),
          event.actionTaken,
          event.source,
          event.requestId ?? null,
          timestamp,
        ],
      );

      return insertResult.rows[0]!.id;
    });
  }

  /**
   * Retrieves a contiguous slice of audit events for stream verification.
   */
  async getAuditTrailSlice(
    organizationId: string,
    branchId: string | null,
    startSeq?: number,
    endSeq?: number,
  ): Promise<AuditLogEventRecord[]> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      let query = `
        SELECT id, organization_id, branch_id, actor_id, station_id,
               event_type, severity, action, entity_name, entity_id,
               client_timestamp, server_timestamp, sequence_number,
               previous_record_hash, record_hash, source, request_id,
               metadata, created_at
        FROM audit_log_events
        WHERE organization_id = $1
          AND branch_id IS NOT DISTINCT FROM $2
      `;
      const params: unknown[] = [organizationId, branchId];

      if (startSeq !== undefined) {
        params.push(startSeq);
        query += ` AND sequence_number >= $${params.length}`;
      }
      if (endSeq !== undefined) {
        params.push(endSeq);
        query += ` AND sequence_number <= $${params.length}`;
      }

      query += ' ORDER BY sequence_number ASC;';

      const result = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string | null;
        actor_id: string | null;
        station_id: string | null;
        event_type: string;
        severity: AuditLogEventRecord['severity'];
        action: string;
        entity_name: string;
        entity_id: string | null;
        client_timestamp: Date | null;
        server_timestamp: Date;
        sequence_number: string;
        previous_record_hash: string;
        record_hash: string;
        source: AuditLogEventRecord['source'];
        request_id: string | null;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(query, params);

      return result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        actorId: row.actor_id,
        stationId: row.station_id,
        eventType: row.event_type,
        severity: row.severity,
        action: row.action,
        entityName: row.entity_name,
        entityId: row.entity_id,
        clientTimestamp: row.client_timestamp ? row.client_timestamp.toISOString() : null,
        serverTimestamp: row.server_timestamp.toISOString(),
        sequenceNumber: parseInt(row.sequence_number, 10),
        previousRecordHash: row.previous_record_hash,
        recordHash: row.record_hash,
        source: row.source,
        requestId: row.request_id,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  /**
   * Verifies the Cloud audit hash chain for an audit stream directly from database.
   */
  async verifyStreamChain(
    organizationId: string,
    branchId: string | null,
  ): Promise<{ valid: boolean; eventCount: number; error?: string }> {
    const records = await this.getAuditTrailSlice(organizationId, branchId);
    if (records.length === 0) {
      return { valid: true, eventCount: 0 };
    }
    const result = verifyAuditHashChain(records, GENESIS_PREVIOUS_RECORD_HASH);
    if (!result.valid) {
      return {
        valid: false,
        eventCount: records.length,
        error: `${result.errorCode}: ${result.details}`,
      };
    }
    return { valid: true, eventCount: records.length };
  }

  /**
   * Generates a Cloud Checkpoint metadata structure for a given stream range.
   */
  async generateStreamCheckpoint(
    organizationId: string,
    branchId: string | null,
    startSeq?: number,
    endSeq?: number,
  ): Promise<CheckpointMetadata> {
    const records = await this.getAuditTrailSlice(organizationId, branchId, startSeq, endSeq);
    const sourceStream = branchId ? `${organizationId}:${branchId}` : `${organizationId}:CORPORATE`;
    return createCloudCheckpoint(records, sourceStream);
  }
}

/**
 * Factory to create a CloudAuditLogger instance.
 */
export function createAuditLogger(pool: pg.Pool): CloudAuditLogger {
  return new CloudAuditLogger(pool);
}
