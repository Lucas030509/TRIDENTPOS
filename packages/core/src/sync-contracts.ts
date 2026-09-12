/**
 * TRIDENTPOS Sync & Transactional Outbox Contracts
 * Strictly conforms to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 2
 * - ADR-006 (Transactional Outbox Local & Ingested Idempotency)
 * - ADR-007 (Durable Cloud Integration Events)
 * - EAAF v1.2.0 WP-012 / S12-R1
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Idempotency Key & Identity Definitions (QI-012-01: Collision-Safe Encoding)
// ---------------------------------------------------------------------------

export interface AuthContext {
  readonly organizationId: string;
  readonly branchId: string;
}

export interface IdempotencyKeyComponents {
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly action: string;
  readonly clientOpId: string;
}

/**
 * Returns an unambiguous, collision-safe canonical JSON array string
 * over all 6 logical components of the operation tuple:
 * [orgId, branchId, aggregateType, aggregateId, action, clientOpId]
 */
export function canonicalizeIdempotencyPayload(parts: IdempotencyKeyComponents): string {
  if (
    !parts.orgId ||
    !parts.branchId ||
    !parts.aggregateType ||
    !parts.aggregateId ||
    !parts.action ||
    !parts.clientOpId
  ) {
    throw new Error('All idempotency key components must be non-empty strings');
  }

  return JSON.stringify([
    parts.orgId,
    parts.branchId,
    parts.aggregateType,
    parts.aggregateId,
    parts.action,
    parts.clientOpId,
  ]);
}

/**
 * Derives the canonical deterministic logical idempotency key:
 * SHA-256 hex digest over the unambiguous canonical representation.
 */
export function formatIdempotencyKey(
  partsOrOrgId: IdempotencyKeyComponents | string,
  branchId?: string,
  aggregateType?: string,
  aggregateId?: string,
  action?: string,
  clientOpId?: string,
): string {
  const p: IdempotencyKeyComponents =
    typeof partsOrOrgId === 'object' && partsOrOrgId !== null
      ? partsOrOrgId
      : {
          orgId: partsOrOrgId,
          branchId: branchId!,
          aggregateType: aggregateType!,
          aggregateId: aggregateId!,
          action: action!,
          clientOpId: clientOpId!,
        };

  const canonical = canonicalizeIdempotencyPayload(p);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidClientOpId(clientOpId: unknown): clientOpId is string {
  return typeof clientOpId === 'string' && UUID_V4_REGEX.test(clientOpId);
}

export function isValidUuidV4(val: unknown): val is string {
  return typeof val === 'string' && UUID_V4_REGEX.test(val);
}

// ---------------------------------------------------------------------------
// Structured ACK Lifecycle States (SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 2.3)
// ---------------------------------------------------------------------------

export type SyncAckStatus =
  | 'RECEIVED'
  | 'DURABLY_STORED'
  | 'APPLIED'
  | 'DUPLICATE_ACCEPTED'
  | 'REJECTED'
  | 'REQUIRES_RECONCILIATION';

export const VALID_SYNC_ACK_STATUSES: ReadonlySet<SyncAckStatus> = new Set([
  'RECEIVED',
  'DURABLY_STORED',
  'APPLIED',
  'DUPLICATE_ACCEPTED',
  'REJECTED',
  'REQUIRES_RECONCILIATION',
]);

// ---------------------------------------------------------------------------
// Cloud Transaction Receipt Contract & Trust Provider Boundary (QI-012-02)
// ---------------------------------------------------------------------------

export interface CloudTransactionReceipt {
  readonly receiptId: string;
  readonly appliedAt: string; // ISO 8601
  readonly serverSignature: string; // Opaque server verification token
  readonly clientOpId: string;
  readonly aggregateSequenceNumber: number;
}

export interface ReceiptIssuanceContext {
  readonly organizationId: string;
  readonly branchId: string;
  readonly clientOpId: string;
  readonly aggregateSequenceNumber: number;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly action?: string;
}

export interface CloudReceiptIssuer {
  issueReceipt(
    context: ReceiptIssuanceContext,
  ): Promise<CloudTransactionReceipt> | CloudTransactionReceipt;
}

export interface CloudReceiptVerifier {
  verifyReceipt(
    receipt: CloudTransactionReceipt,
    expectedContext: ReceiptIssuanceContext,
  ): Promise<boolean> | boolean;
}

export function createCloudReceipt(
  receiptId: string,
  serverSignature: string,
  clientOpId: string,
  aggregateSequenceNumber: number,
): CloudTransactionReceipt {
  return {
    receiptId,
    appliedAt: new Date().toISOString(),
    serverSignature,
    clientOpId,
    aggregateSequenceNumber,
  };
}

export function isValidCloudReceipt(receipt: unknown): receipt is CloudTransactionReceipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
  return (
    typeof r.receiptId === 'string' &&
    r.receiptId.length > 0 &&
    typeof r.appliedAt === 'string' &&
    r.appliedAt.length > 0 &&
    typeof r.serverSignature === 'string' &&
    r.serverSignature.length > 0 &&
    typeof r.clientOpId === 'string' &&
    isValidUuidV4(r.clientOpId) &&
    typeof r.aggregateSequenceNumber === 'number' &&
    Number.isSafeInteger(r.aggregateSequenceNumber) &&
    r.aggregateSequenceNumber >= 1
  );
}

// ---------------------------------------------------------------------------
// Edge Outbox Models (DATA_MODEL.md Sec. 3)
// ---------------------------------------------------------------------------

export type EdgeOutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'SYNCED' | 'FAILED';

export interface EdgeOutboxRecord {
  readonly id: string; // UUIDv4
  readonly organizationId: string;
  readonly branchId: string;
  readonly clientOpId: string; // UUIDv4
  readonly idempotencyKey: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateSequenceNumber: number;
  readonly action: string;
  readonly payloadJson: string;
  readonly status: EdgeOutboxStatus;
  readonly retryCount: number;
  readonly lastError: string | null;
  readonly cloudReceiptToken: string | null;
  readonly cloudReceiptSignature: string | null;
  readonly createdAt: string;
  readonly syncedAt: string | null;
}

// ---------------------------------------------------------------------------
// Sync Batch DTOs (Public Ingestion Contract)
// ---------------------------------------------------------------------------

export interface SyncEventDTO {
  readonly organizationId?: string;
  readonly branchId?: string;
  readonly clientOpId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateSequenceNumber: number;
  readonly action: string;
  readonly payload: unknown;
  readonly occurredAt?: string;
  readonly createdAt?: string;
}

export interface SyncBatchDTO {
  readonly batchId?: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly events: readonly SyncEventDTO[];
  readonly createdAt?: string;
}

export interface SequenceGapInterval {
  readonly expectedSequence: number;
  readonly incomingSequence: number;
  readonly missingStart: number;
  readonly missingEnd: number;
}

export interface SyncEventAckDTO {
  readonly clientOpId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateSequenceNumber: number;
  readonly status: SyncAckStatus;
  readonly receipt?: CloudTransactionReceipt;
  readonly gapInterval?: SequenceGapInterval;
  readonly cachedResponse?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface SyncBatchAckDTO {
  readonly batchId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly results: readonly SyncEventAckDTO[];
}

// ---------------------------------------------------------------------------
// Canonical Backoff Policy & Retry Rules (QI-012-03)
// ---------------------------------------------------------------------------

export const CANONICAL_MAX_RETRIES = 5;

export interface BackoffPolicy {
  getDelayMs(retryCount: number): number;
  calculateDelay?(retryCount: number): number;
}

export interface ExponentialBackoffOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier?: number;
  readonly deterministic?: boolean; // For reproducible test execution
}

export class ExponentialBackoffPolicy implements BackoffPolicy {
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #multiplier: number;
  readonly #deterministic: boolean;

  constructor(options: ExponentialBackoffOptions) {
    this.#baseDelayMs = options.baseDelayMs;
    this.#maxDelayMs = options.maxDelayMs;
    this.#multiplier = options.multiplier ?? 2;
    this.#deterministic = options.deterministic ?? false;
  }

  public getDelayMs(retryCount: number): number {
    if (retryCount <= 0) return 0;
    const exponential = this.#baseDelayMs * Math.pow(this.#multiplier, retryCount - 1);
    const capped = Math.min(exponential, this.#maxDelayMs);
    if (this.#deterministic) {
      return capped;
    }
    // Subtle jitter within 10%
    const jitter = capped * 0.1 * Math.random();
    return Math.min(capped + jitter, this.#maxDelayMs);
  }

  public calculateDelay(retryCount: number): number {
    return this.getDelayMs(retryCount);
  }
}

// ---------------------------------------------------------------------------
// Canonical Constants & Error Codes
// ---------------------------------------------------------------------------

export const MAX_SYNC_RETRIES = 5;
export const OUTBOX_BACKLOG_ALERT_THRESHOLD = 100;
export const GREENFIELD_INITIAL_AGGREGATE_SEQUENCE = 1;

export const ERROR_CODE_DUPLICATE_OPERATION = 'DUPLICATE_OPERATION';
export const ERROR_CODE_IDEMPOTENCY_COLLISION = 'IDEMPOTENCY_COLLISION';
export const ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH = 'ORGANIZATION_BRANCH_MISMATCH';
export const ERROR_CODE_INVALID_SEQUENCE = 'INVALID_SEQUENCE';
export const ERROR_CODE_SEQUENCE_GAP = 'SEQUENCE_GAP';
export const ERROR_CODE_STALE_SEQUENCE = 'STALE_SEQUENCE';
export const ERROR_CODE_MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED';
export const ERROR_CODE_INVALID_SYNC_PAYLOAD = 'INVALID_SYNC_PAYLOAD';
export const ERROR_CODE_NON_RETRYABLE_ERROR = 'NON_RETRYABLE_ERROR';
export const ERROR_CODE_OUTBOX_DISPATCH_FAILED = 'OUTBOX_DISPATCH_FAILED';
export const ERROR_CODE_STALE_CLAIM = 'STALE_CLAIM';
export const ERROR_CODE_SYNC_KILL_SWITCH_ENGAGED = 'SYNC_KILL_SWITCH_ENGAGED';
export const ERROR_CODE_DELTA_CHECKSUM_MISMATCH = 'DELTA_CHECKSUM_MISMATCH';
export const ERROR_CODE_SYNC_STREAM_DISCONNECTED = 'SYNC_STREAM_DISCONNECTED';
export const ERROR_CODE_MALFORMED_STREAM_MESSAGE = 'MALFORMED_STREAM_MESSAGE';

// ---------------------------------------------------------------------------
// WP-013: Bidirectional WebSocket Sync Stream Framing (ADR-005 / Sec. 4)
// ---------------------------------------------------------------------------

export type SyncStreamMessageType =
  | 'UPSTREAM_BATCH'
  | 'UPSTREAM_ACK'
  | 'DOWNSTREAM_DELTA_REQUEST'
  | 'DOWNSTREAM_DELTA_RESPONSE'
  | 'HEARTBEAT_PING'
  | 'HEARTBEAT_PONG'
  | 'SYNC_STATUS'
  | 'KILL_SWITCH_COMMAND'
  | 'SYNC_ERROR';

export interface SyncStreamMessage<T = unknown> {
  readonly messageId: string;
  readonly type: SyncStreamMessageType;
  readonly organizationId: string;
  readonly branchId: string;
  readonly timestamp: string;
  readonly payload: T;
}

export function createSyncStreamMessage<T>(
  type: SyncStreamMessageType,
  organizationId: string,
  branchId: string,
  payload: T,
  messageId?: string,
): SyncStreamMessage<T> {
  return {
    messageId: messageId ?? crypto.randomUUID(),
    type,
    organizationId,
    branchId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function isValidSyncStreamMessage(msg: unknown): msg is SyncStreamMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.messageId === 'string' &&
    isValidUuidV4(m.messageId) &&
    typeof m.type === 'string' &&
    typeof m.organizationId === 'string' &&
    isValidUuidV4(m.organizationId) &&
    typeof m.branchId === 'string' &&
    isValidUuidV4(m.branchId) &&
    typeof m.timestamp === 'string' &&
    'payload' in m
  );
}

// ---------------------------------------------------------------------------
// WP-013: Delta-Pull Protocol for Catalog Updates (SYNC_AND_OFFLINE Sec. 4)
// ---------------------------------------------------------------------------

export interface CatalogDeltaEntity {
  readonly entityType: string;
  readonly entityId: string;
  readonly action: 'UPSERT' | 'DELETE';
  readonly data: Record<string, unknown>;
  readonly version: number;
}

export interface CatalogDeltaRequest {
  readonly sinceSnapshotVersion: number;
  readonly categories?: readonly string[];
}

export interface CatalogDeltaResponse {
  readonly snapshotVersion: number;
  readonly deltaVersion: number;
  readonly checksum: string; // SHA-256 over canonical entities
  readonly entities: readonly CatalogDeltaEntity[];
  readonly hasMore: boolean;
}

export function computeCatalogDeltaChecksum(entities: readonly CatalogDeltaEntity[]): string {
  const sorted = [...entities].sort((a, b) => {
    const keyA = `${a.entityType}:${a.entityId}:${a.version}`;
    const keyB = `${b.entityType}:${b.entityId}:${b.version}`;
    return keyA.localeCompare(keyB);
  });
  const canonical = JSON.stringify(
    sorted.map((e) => [e.entityType, e.entityId, e.action, e.version, e.data]),
  );
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// WP-013: Sync Checkpoints & Telemetry Data Objects
// ---------------------------------------------------------------------------

export interface SyncCheckpointRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly streamType: string; // 'OUTBOX_INGESTION' | 'CATALOG_DELTA'
  readonly checkpointType: string;
  readonly lastSyncedSequence: number;
  readonly lastSnapshotVersion: number;
  readonly lastSyncTimestamp: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type SyncTelemetryEventType =
  | 'WAN_DISCONNECTED'
  | 'WAN_RECONNECTED'
  | 'OUTBOX_DRAINED'
  | 'DELTA_PULLED'
  | 'SYNC_ERROR'
  | 'HEARTBEAT_FAILED'
  | 'KILL_SWITCH_ENGAGED'
  | 'KILL_SWITCH_DISENGAGED';

export interface SyncTelemetryEvent {
  readonly id?: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly eventType: SyncTelemetryEventType;
  readonly durationMs?: number | null;
  readonly recordsCount: number;
  readonly details?: Record<string, unknown>;
  readonly occurredAt?: string;
}

// ---------------------------------------------------------------------------
// WP-013: Feature Flag / Kill Switch & Connection Lifecycle
// ---------------------------------------------------------------------------

export interface SyncEngineKillSwitch {
  readonly enabled: boolean; // true = sync active; false = kill switch engaged (sync halted)
  readonly reason?: string | null;
  readonly updatedAt: string;
  readonly updatedBy?: string | null;
}

export type SyncConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISABLED';

export interface SyncReconnectConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly maxReconnectAttempts?: number;
}

export const DEFAULT_SYNC_RECONNECT_CONFIG: SyncReconnectConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  heartbeatIntervalMs: 5000, // 5 seconds per ADR-005
  heartbeatTimeoutMs: 10000,
};

