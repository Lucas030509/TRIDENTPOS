/**
 * TRIDENTPOS WP-006: Tamper-Evident SHA-256 Audit Hash Chain & Checkpoints
 * SSOT Reference: SECURITY_LOGGING_AND_MONITORING.md Sec 3.3, DATA_MODEL.md Sec 2.1
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './canonicalize.js';
import type { AuditLogEventRecord, CheckpointMetadata } from './audit-contracts.js';

export const GENESIS_PREVIOUS_RECORD_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';
export const GENESIS_SEQUENCE_NUMBER = 1;

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Computes standard SHA-256 digest returning a lowercase 64-char hexadecimal string.
 */
export function computeSha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').toLowerCase();
}

export interface CanonicalAuditPayloadInput {
  organizationId: string;
  branchId: string | null;
  sequenceNumber: number | string | bigint;
  clientTimestamp: string | null;
  serverTimestamp: string;
  eventType: string;
  action: string;
  entityName: string;
  entityId: string | null;
  actorId: string | null;
  stationId: string | null;
  redactedMetadata: Record<string, unknown>;
  previousRecordHash: string;
}

/**
 * Serializes the canonical audit record payload using deterministic RFC 8785 (JCS).
 */
export function buildCanonicalAuditPayload(input: CanonicalAuditPayloadInput): string {
  const payload = {
    action: input.action,
    actorId: input.actorId ?? null,
    branchId: input.branchId ?? null,
    clientTimestamp: input.clientTimestamp ?? null,
    entityId: input.entityId ?? null,
    entityName: input.entityName,
    eventType: input.eventType,
    organizationId: input.organizationId,
    previousRecordHash: input.previousRecordHash,
    redactedMetadata: input.redactedMetadata ?? {},
    sequenceNumber: Number(input.sequenceNumber),
    serverTimestamp: input.serverTimestamp,
    stationId: input.stationId ?? null,
  };

  return canonicalize(payload);
}

/**
 * Computes the authoritative SHA-256 record hash for an audit log event.
 */
export function computeAuditRecordHash(input: CanonicalAuditPayloadInput): string {
  const canonicalString = buildCanonicalAuditPayload(input);
  return computeSha256Hex(canonicalString);
}

/**
 * Verifies that a record hash matches its payload.
 */
export function verifyRecordHash(record: AuditLogEventRecord): boolean {
  if (!SHA256_HEX_REGEX.test(record.recordHash)) {
    return false;
  }
  const expectedHash = computeAuditRecordHash({
    organizationId: record.organizationId,
    branchId: record.branchId,
    sequenceNumber: record.sequenceNumber,
    clientTimestamp: record.clientTimestamp,
    serverTimestamp: record.serverTimestamp,
    eventType: record.eventType,
    action: record.action,
    entityName: record.entityName,
    entityId: record.entityId,
    actorId: record.actorId,
    stationId: record.stationId,
    redactedMetadata: record.metadata,
    previousRecordHash: record.previousRecordHash,
  });
  return record.recordHash === expectedHash;
}

export type ChainIntegrityErrorCode =
  | 'WRONG_PREVIOUS_HASH'
  | 'WRONG_RECORD_HASH'
  | 'SEQUENCE_GAP'
  | 'DUPLICATE_SEQUENCE'
  | 'REORDERED_EVENTS'
  | 'MALFORMED_HASH'
  | 'WRONG_STREAM_BINDING'
  | 'PAYLOAD_MODIFIED';

export interface ChainVerificationResult {
  valid: boolean;
  errorCode?: ChainIntegrityErrorCode;
  details?: string;
  failedIndex?: number;
  failedRecordId?: string;
}

/**
 * Pure verification primitive: verifies the cryptographic continuity of an audit event chain.
 * Fails closed on any corruption, tampering, reordering, or gap.
 */
export function verifyAuditHashChain(
  records: AuditLogEventRecord[],
  expectedStartPreviousHash: string = GENESIS_PREVIOUS_RECORD_HASH,
): ChainVerificationResult {
  if (records.length === 0) {
    return { valid: true };
  }

  const first = records[0]!;
  const expectedOrgId = first.organizationId;
  const expectedBranchId = first.branchId;

  let previousHash = expectedStartPreviousHash;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const seq = Number(record.sequenceNumber);

    // Stream binding check
    if (record.organizationId !== expectedOrgId || record.branchId !== expectedBranchId) {
      return {
        valid: false,
        errorCode: 'WRONG_STREAM_BINDING',
        details: `Record at index ${i} has mismatched stream binding (org: ${record.organizationId}, branch: ${record.branchId})`,
        failedIndex: i,
        failedRecordId: record.id,
      };
    }

    // Malformed hash check
    if (!SHA256_HEX_REGEX.test(record.recordHash)) {
      return {
        valid: false,
        errorCode: 'MALFORMED_HASH',
        details: `Record at index ${i} has malformed record_hash '${record.recordHash}'`,
        failedIndex: i,
        failedRecordId: record.id,
      };
    }
    if (!SHA256_HEX_REGEX.test(record.previousRecordHash)) {
      return {
        valid: false,
        errorCode: 'MALFORMED_HASH',
        details: `Record at index ${i} has malformed previous_record_hash '${record.previousRecordHash}'`,
        failedIndex: i,
        failedRecordId: record.id,
      };
    }

    // Sequence checks
    if (i > 0) {
      const prevSeq = Number(records[i - 1]!.sequenceNumber);
      if (seq === prevSeq) {
        return {
          valid: false,
          errorCode: 'DUPLICATE_SEQUENCE',
          details: `Duplicate sequence number ${seq} at index ${i}`,
          failedIndex: i,
          failedRecordId: record.id,
        };
      }
      if (seq < prevSeq) {
        return {
          valid: false,
          errorCode: 'REORDERED_EVENTS',
          details: `Reordered events: sequence decreased from ${prevSeq} to ${seq} at index ${i}`,
          failedIndex: i,
          failedRecordId: record.id,
        };
      }
      if (seq !== prevSeq + 1) {
        return {
          valid: false,
          errorCode: 'SEQUENCE_GAP',
          details: `Sequence gap: expected ${prevSeq + 1}, found ${seq} at index ${i}`,
          failedIndex: i,
          failedRecordId: record.id,
        };
      }
    }

    // Chaining check
    if (record.previousRecordHash !== previousHash) {
      return {
        valid: false,
        errorCode: 'WRONG_PREVIOUS_HASH',
        details: `Hash chain break at index ${i}: record.previous_record_hash '${record.previousRecordHash}' != expected '${previousHash}'`,
        failedIndex: i,
        failedRecordId: record.id,
      };
    }

    // Payload integrity / self-hash check
    if (!verifyRecordHash(record)) {
      return {
        valid: false,
        errorCode: 'PAYLOAD_MODIFIED',
        details: `Payload modification detected at index ${i}: hash does not match canonical payload`,
        failedIndex: i,
        failedRecordId: record.id,
      };
    }

    previousHash = record.recordHash;
  }

  return { valid: true };
}

/**
 * Creates a Cloud Checkpoint descriptor from a contiguous slice of audit records.
 */
export function createCloudCheckpoint(
  records: AuditLogEventRecord[],
  sourceStream: string,
): CheckpointMetadata {
  if (records.length === 0) {
    throw new Error('Cannot create checkpoint from empty record slice');
  }

  const first = records[0]!;
  const last = records[records.length - 1]!;

  return {
    start_sequence_number: first.sequenceNumber,
    end_sequence_number: last.sequenceNumber,
    start_record_hash: first.recordHash,
    checkpoint_record_hash: last.recordHash,
    event_count: records.length,
    source_stream: sourceStream,
  };
}

/**
 * Verifies that a record slice matches a Cloud Checkpoint descriptor.
 */
export function verifyCloudCheckpoint(
  checkpoint: CheckpointMetadata,
  records: AuditLogEventRecord[],
): boolean {
  if (records.length === 0 || records.length !== checkpoint.event_count) {
    return false;
  }

  const first = records[0]!;
  const last = records[records.length - 1]!;

  if (
    Number(first.sequenceNumber) !== Number(checkpoint.start_sequence_number) ||
    Number(last.sequenceNumber) !== Number(checkpoint.end_sequence_number) ||
    first.recordHash !== checkpoint.start_record_hash ||
    last.recordHash !== checkpoint.checkpoint_record_hash
  ) {
    return false;
  }

  const chainResult = verifyAuditHashChain(records, first.previousRecordHash);
  return chainResult.valid;
}
