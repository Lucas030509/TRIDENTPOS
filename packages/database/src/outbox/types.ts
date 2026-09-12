/**
 * TRIDENTPOS Cloud Transactional Outbox & Ingested Idempotency Types
 * Conforms strictly to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - ADR-006 & ADR-007
 */

import type pg from 'pg';
import type { CloudTransactionReceipt, SyncAckStatus, SyncEventDTO } from '@trident/core';

export interface IngestedIdempotencyRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly action: string;
  readonly clientOpId: string;
  readonly idempotencyKey: string;
  readonly aggregateSequenceNumber: number;
  readonly status: SyncAckStatus;
  readonly responsePayload: unknown;
  readonly receiptToken: string;
  readonly createdAt: Date;
}

export interface AggregateSequenceRecord {
  readonly organizationId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly currentSequenceNumber: number;
  readonly updatedAt: Date;
}

export interface ReorderingBufferRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateSequenceNumber: number;
  readonly action: string;
  readonly clientOpId: string;
  readonly idempotencyKey: string;
  readonly eventPayload: unknown;
  readonly status: 'BUFFERED' | 'DRAINED';
  readonly receivedAt: Date;
  readonly drainedAt: Date | null;
}

export interface CloudIntegrationOutboxRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DLQ';
  readonly retryCount: number;
  readonly deliveryAttempts: number;
  readonly maxRetries: number;
  readonly nextRetryAt: Date;
  readonly lastError: string | null;
  readonly lockId: string | null;
  readonly lockedAt: Date | null;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export interface CloudIntegrationDLQRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly originatingOutboxId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly rawPayload: unknown;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly errorTrace: string | null;
  readonly retryCount: number;
  readonly context: Record<string, unknown>;
  readonly movedToDlqAt: Date;
}

export interface EnqueueIntegrationEventInput {
  readonly organizationId: string;
  readonly branchId?: string | null;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly maxRetries?: number;
}

export type DomainMutationHandler<TInput = unknown, TOutput = unknown> = (
  client: pg.PoolClient,
  payload: TInput,
  event: SyncEventDTO,
) => Promise<TOutput>;

export interface ProcessEventResult {
  readonly status: SyncAckStatus;
  readonly receipt: CloudTransactionReceipt | null;
  readonly responsePayload: unknown;
  readonly gapInterval?: { from: number; to: number };
  readonly drainedCount?: number;
  readonly wasDuplicate?: boolean;
}
