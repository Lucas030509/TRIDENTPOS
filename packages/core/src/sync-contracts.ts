/**
 * TRIDENTPOS Sync & Transactional Outbox Contracts
 * Strictly conforms to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 2
 * - ADR-006 (Transactional Outbox Local & Ingested Idempotency)
 * - ADR-007 (Durable Cloud Integration Events)
 * - EAAF v1.2.0 WP-012
 */

// ---------------------------------------------------------------------------
// Idempotency Key & Identity Definitions
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
 * Derives the canonical deterministic logical idempotency key:
 * orgId : branchId : aggregateType : aggregateId : action : clientOpId
 */
export function formatIdempotencyKey(
  partsOrOrgId: IdempotencyKeyComponents | string,
  branchId?: string,
  aggregateType?: string,
  aggregateId?: string,
  action?: string,
  clientOpId?: string,
): string {
  if (typeof partsOrOrgId === 'object' && partsOrOrgId !== null) {
    const p = partsOrOrgId;
    if (
      !p.orgId ||
      !p.branchId ||
      !p.aggregateType ||
      !p.aggregateId ||
      !p.action ||
      !p.clientOpId
    ) {
      throw new Error('All idempotency key components must be non-empty strings');
    }
    return `${p.orgId}:${p.branchId}:${p.aggregateType}:${p.aggregateId}:${p.action}:${p.clientOpId}`;
  }

  if (!partsOrOrgId || !branchId || !aggregateType || !aggregateId || !action || !clientOpId) {
    throw new Error('All idempotency key components must be non-empty strings');
  }
  return `${partsOrOrgId}:${branchId}:${aggregateType}:${aggregateId}:${action}:${clientOpId}`;
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
// Cloud Transaction Receipt Contract (ADR-006 Sec. 5)
// ---------------------------------------------------------------------------

export interface CloudTransactionReceipt {
  readonly receiptId: string;
  readonly appliedAt: string; // ISO 8601
  readonly serverSignature: string; // Opaque server verification token
  readonly clientOpId?: string;
  readonly aggregateSequenceNumber?: number;
}

export function createCloudReceipt(
  receiptId: string,
  serverSignature: string,
  clientOpId?: string,
  aggregateSequenceNumber?: number,
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
    r.serverSignature.length > 0
  );
}

// ---------------------------------------------------------------------------
// Edge Outbox Models (DATA_MODEL.md Sec. 3)
// ---------------------------------------------------------------------------

export type EdgeOutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'SYNCED' | 'FAILED';

export interface EdgeOutboxRecord {
  readonly id: string; // UUIDv4
  readonly clientOpId: string; // UUIDv4
  readonly idempotencyKey: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateSequenceNumber: number;
  readonly action: string;
  readonly payloadJson: string;
  readonly status: EdgeOutboxStatus;
  readonly retryCount: number;
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
// Canonical Backoff Policy
// ---------------------------------------------------------------------------

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
