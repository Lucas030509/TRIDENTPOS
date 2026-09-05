/**
 * TRIDENTPOS WP-006: Audit & Security Telemetry Contracts
 * SSOT Reference: SECURITY_LOGGING_AND_MONITORING.md Sec 3.2, DATA_MODEL.md Sec 2.1
 */

export type AuditEventSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type AuditEventSource = 'CLOUD' | 'EDGE_POS' | 'EDGE_KDS' | 'SYSTEM';

export interface AuditEventInput {
  organizationId: string; // Canonical tenant UUID
  branchId?: string | null; // Branch UUID (NULL for corporate / HQ stream)
  actorId?: string | null; // Actor user UUID (NULL for system events)
  stationId?: string | null; // Station / POS terminal UUID (NULL for cloud backend)
  eventType: string; // E.g. 'auth.login.success', 'order.created'
  action: string; // Action performed: 'CREATE', 'UPDATE', 'DELETE', 'AUTHORIZE', etc.
  entityName: string; // Target entity name: 'order', 'user', 'station', etc.
  entityId?: string | null; // Target entity UUID / ID
  severity?: AuditEventSeverity; // Default: 'INFO'
  source: AuditEventSource; // 'CLOUD' | 'EDGE_POS' | 'EDGE_KDS' | 'SYSTEM'
  requestId?: string | null; // HTTP / RPC request correlation ID
  metadata?: Record<string, unknown>; // Unstructured context attributes (redacted before persistence)
  clientTimestamp?: Date | string | null; // Client capture timestamp
}

export type SecurityTelemetryRuleCode =
  | 'PIN_BRUTE_FORCE'
  | 'LEASE_REVOKED_ACCESS'
  | 'DELIVERY_WEBHOOK_INVALID_SIGNATURE'
  | 'RLS_VIOLATION_ATTEMPT'
  | 'AUDIT_HASH_CHAIN_BREAK'
  | 'CLOCK_ROLLBACK_DETECTED'
  | string;

export type SecurityTelemetrySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SecurityTelemetryCategory =
  'AUTHENTICATION' | 'AUTHORIZATION' | 'INTEGRITY' | 'NETWORK' | 'TIMING';
export type SecurityTelemetrySource = 'CLOUD' | 'EDGE_POS' | 'EDGE_SERVER' | 'SYSTEM';

export interface SecurityTelemetryInput {
  organizationId: string;
  branchId?: string | null;
  stationId?: string | null;
  actorId?: string | null;
  ruleCode: SecurityTelemetryRuleCode;
  severity: SecurityTelemetrySeverity;
  category: SecurityTelemetryCategory;
  details: Record<string, unknown>; // Structured telemetry attributes (redacted before persistence)
  actionTaken: string; // E.g. 'STATION_TEMPORARY_BLOCK', 'REJECT_403_FORBIDDEN'
  source: SecurityTelemetrySource;
  requestId?: string | null;
  timestamp?: Date | string | null;
}

export interface IAuditLogger {
  logAuditEvent(event: AuditEventInput): Promise<string>;
  logSecurityTelemetryEvent(event: SecurityTelemetryInput): Promise<string>;
}

export interface AuditLogEventRecord {
  id: string;
  organizationId: string;
  branchId: string | null;
  actorId: string | null;
  stationId: string | null;
  eventType: string;
  severity: AuditEventSeverity;
  action: string;
  entityName: string;
  entityId: string | null;
  clientTimestamp: string | null;
  serverTimestamp: string;
  sequenceNumber: number | string;
  previousRecordHash: string;
  recordHash: string;
  source: AuditEventSource;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SecurityTelemetryRecord {
  id: string;
  organizationId: string;
  branchId: string | null;
  stationId: string | null;
  actorId: string | null;
  ruleCode: string;
  severity: SecurityTelemetrySeverity;
  category: SecurityTelemetryCategory;
  details: Record<string, unknown>;
  actionTaken: string;
  source: SecurityTelemetrySource;
  requestId: string | null;
  timestamp: string;
  createdAt: string;
}

export interface CheckpointMetadata {
  start_sequence_number: number | string;
  end_sequence_number: number | string;
  start_record_hash: string;
  checkpoint_record_hash: string;
  event_count: number;
  source_stream: string;
}
