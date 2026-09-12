/**
 * TRIDENTPOS Cloud Ingested Idempotency & Aggregate Sequencing Engine
 * Conforms strictly to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - ADR-006 (Ingested Idempotency, Causal Aggregate Sequencing, Gap Buffering)
 * - COORDINATOR_PROMPT_WP012_START.md & COORDINATOR_PROMPT_WP012_S12-R1_REMEDIATION.md
 */

import type pg from 'pg';
import {
  AuthContext,
  CloudReceiptIssuer,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_SEQUENCE_GAP,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  ReceiptIssuanceContext,
  SyncEventDTO,
  formatIdempotencyKey,
  isValidUuidV4,
} from '@trident/core';
import type { DomainMutationHandler, ProcessEventResult, ReorderingBufferRecord } from './types.js';

export class IngestedIdempotencyEngine {
  readonly #issuer: CloudReceiptIssuer;

  constructor(issuer: CloudReceiptIssuer) {
    if (!issuer || typeof issuer.issueReceipt !== 'function') {
      const err = new TypeError('IngestedIdempotencyEngine requires a valid CloudReceiptIssuer');
      (err as any).code = 'ERR_INVALID_ARG_TYPE';
      throw err;
    }
    this.#issuer = issuer;
  }

  /**
   * Processes a single sync event within an authoritative PostgreSQL client transaction.
   * Enforces:
   * 1. Multi-instance concurrency via aggregate advisory transaction lock
   * 2. Authoritative AuthContext tenant/branch fencing
   * 3. Safe positive integer validation on aggregateSequenceNumber
   * 4. Collision-safe idempotency key generation & defense-in-depth logical tuple verification
   * 5. Greenfield causal sequence starting at 1
   * 6. Sequence gap detection and durable buffering in reordering_buffer_queue
   * 7. Contiguous draining of buffered events when the missing sequence arrives
   * 8. Receipt issuance through trusted CloudReceiptIssuer boundary
   */
  public async processEvent(
    client: pg.PoolClient,
    auth: AuthContext,
    event: SyncEventDTO,
    handler: DomainMutationHandler,
  ): Promise<ProcessEventResult> {
    // 1. Authoritative AuthContext validation (Pattern B)
    if (event.organizationId && event.organizationId !== auth.organizationId) {
      throw new Error(
        `Payload organizationId does not match authenticated context: ${ERROR_CODE_UNAUTHORIZED_TENANT}`,
      );
    }
    if (event.branchId && event.branchId !== auth.branchId) {
      throw new Error(
        `Payload branchId does not match authenticated context: ${ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH}`,
      );
    }
    if (!isValidUuidV4(event.clientOpId)) {
      throw new Error('clientOpId must be a valid UUIDv4');
    }
    if (!Number.isSafeInteger(event.aggregateSequenceNumber) || event.aggregateSequenceNumber < 1) {
      throw new Error('aggregateSequenceNumber must be a safe positive integer >= 1');
    }

    const orgId = auth.organizationId;
    const branchId = auth.branchId;
    const idempotencyKey = formatIdempotencyKey(
      orgId,
      branchId,
      event.aggregateType,
      event.aggregateId,
      event.action,
      event.clientOpId,
    );

    // 2. Multi-instance concurrency serialization:
    // Advisory transaction lock scoped to (tenant, aggregate_stream).
    // Serializes concurrent requests for the exact same aggregate stream across all DB connections.
    const lockKey = `${branchId}:${event.aggregateType}:${event.aggregateId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));', [
      orgId,
      lockKey,
    ]);

    // 3. Check for duplicate in ingested_idempotency_log
    // QI-012-01: Explicit defense-in-depth comparison of persisted logical components
    const existingLogRes = await client.query<{
      branch_id: string;
      aggregate_type: string;
      aggregate_id: string;
      action: string;
      client_op_id: string;
      status: string;
      response_payload: unknown;
      receipt_payload: unknown;
      receipt_token: string;
      aggregate_sequence_number: string;
      created_at: Date;
    }>(
      `
      SELECT
        branch_id,
        aggregate_type,
        aggregate_id,
        action,
        client_op_id,
        status,
        response_payload,
        receipt_payload,
        receipt_token,
        aggregate_sequence_number,
        created_at
      FROM ingested_idempotency_log
      WHERE organization_id = $1 AND idempotency_key = $2;
      `,
      [orgId, idempotencyKey],
    );

    if (existingLogRes.rows.length > 0 && existingLogRes.rows[0]) {
      const existing = existingLogRes.rows[0];

      // QI-012-01: Verify that every component of the logical tuple strictly matches
      if (
        existing.branch_id !== branchId ||
        existing.aggregate_type !== event.aggregateType ||
        existing.aggregate_id !== event.aggregateId ||
        existing.action !== event.action ||
        existing.client_op_id !== event.clientOpId
      ) {
        throw new Error(
          'IDEMPOTENCY_COLLISION: Idempotency key matched but logical tuple components differ',
        );
      }

      // QI-012-02 (part C): Return exact persisted original receipt verbatim without invoking issuer
      return {
        status: 'DUPLICATE_ACCEPTED',
        receipt: existing.receipt_payload as any,
        responsePayload: existing.response_payload,
        wasDuplicate: true,
      };
    }

    // 4. Retrieve or initialize aggregate sequence
    const seqRes = await client.query<{ current_sequence_number: string }>(
      `
      SELECT current_sequence_number
      FROM aggregate_sequences
      WHERE organization_id = $1 AND branch_id = $2 AND aggregate_type = $3 AND aggregate_id = $4
      FOR UPDATE;
      `,
      [orgId, branchId, event.aggregateType, event.aggregateId],
    );

    const currentSequence =
      seqRes.rows.length > 0 && seqRes.rows[0]
        ? parseInt(seqRes.rows[0].current_sequence_number, 10)
        : 0;
    const expectedSequence = currentSequence + 1;
    const incomingSequence = event.aggregateSequenceNumber;

    const issuanceContext: ReceiptIssuanceContext = {
      organizationId: orgId,
      branchId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      action: event.action,
      clientOpId: event.clientOpId,
      aggregateSequenceNumber: incomingSequence,
    };

    // 5. Causal Sequence Evaluation
    // Case A: incoming < expectedSequence => Stale sequence
    if (incomingSequence < expectedSequence) {
      // Sequence already consumed. Produce ZERO new mutations.
      const receipt = await Promise.resolve(this.#issuer.issueReceipt(issuanceContext));
      return {
        status: 'DUPLICATE_ACCEPTED',
        receipt,
        responsePayload: { message: 'Sequence already consumed' },
        wasDuplicate: true,
      };
    }

    // Case B: incoming > expectedSequence => GAP!
    if (incomingSequence > expectedSequence) {
      const gapInterval = { from: expectedSequence, to: incomingSequence - 1 };

      // Persist into reordering_buffer_queue without applying to domain state
      await client.query(
        `
        INSERT INTO reordering_buffer_queue (
          organization_id,
          branch_id,
          aggregate_type,
          aggregate_id,
          aggregate_sequence_number,
          action,
          client_op_id,
          idempotency_key,
          event_payload,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BUFFERED')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
        `,
        [
          orgId,
          branchId,
          event.aggregateType,
          event.aggregateId,
          incomingSequence,
          event.action,
          event.clientOpId,
          idempotencyKey,
          JSON.stringify(event.payload),
        ],
      );

      return {
        status: 'REQUIRES_RECONCILIATION',
        receipt: null,
        responsePayload: {
          status: 'REQUIRES_RECONCILIATION',
          error: ERROR_CODE_SEQUENCE_GAP,
          gapInterval,
        },
        gapInterval,
        wasDuplicate: false,
      };
    }

    // Case C: incoming === expectedSequence => Contiguous! Eligible to apply
    const mutationResult = await handler(client, event.payload, event);

    // Update aggregate sequence
    await client.query(
      `
      INSERT INTO aggregate_sequences (
        organization_id,
        branch_id,
        aggregate_type,
        aggregate_id,
        current_sequence_number,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (organization_id, branch_id, aggregate_type, aggregate_id)
      DO UPDATE SET
        current_sequence_number = EXCLUDED.current_sequence_number,
        updated_at = NOW();
      `,
      [orgId, branchId, event.aggregateType, event.aggregateId, incomingSequence],
    );

    // Generate Cloud receipt via trusted CloudReceiptIssuer
    const receipt = await Promise.resolve(this.#issuer.issueReceipt(issuanceContext));

    // Persist into ingested_idempotency_log
    await client.query(
      `
      INSERT INTO ingested_idempotency_log (
        organization_id,
        branch_id,
        aggregate_type,
        aggregate_id,
        action,
        client_op_id,
        idempotency_key,
        aggregate_sequence_number,
        status,
        response_payload,
        receipt_payload,
        receipt_token
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPLIED', $9, $10, $11);
      `,
      [
        orgId,
        branchId,
        event.aggregateType,
        event.aggregateId,
        event.action,
        event.clientOpId,
        idempotencyKey,
        incomingSequence,
        JSON.stringify(mutationResult),
        JSON.stringify(receipt),
        receipt.receiptId,
      ],
    );

    // 6. Contiguous Draining: Check reordering_buffer_queue for next sequences
    let currentSeq = incomingSequence;
    let drainedCount = 0;
    let draining = true;

    while (draining) {
      const nextSeq = currentSeq + 1;
      const bufferRes = await client.query<{
        id: string;
        action: string;
        client_op_id: string;
        idempotency_key: string;
        event_payload: unknown;
      }>(
        `
        SELECT id, action, client_op_id, idempotency_key, event_payload
        FROM reordering_buffer_queue
        WHERE organization_id = $1
          AND branch_id = $2
          AND aggregate_type = $3
          AND aggregate_id = $4
          AND aggregate_sequence_number = $5
          AND status = 'BUFFERED'
        FOR UPDATE;
        `,
        [orgId, branchId, event.aggregateType, event.aggregateId, nextSeq],
      );

      if (bufferRes.rows.length === 0 || !bufferRes.rows[0]) {
        draining = false;
        break;
      }

      const bufferedItem = bufferRes.rows[0];
      const bufferedEvent: SyncEventDTO = {
        organizationId: orgId,
        branchId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        action: bufferedItem.action,
        clientOpId: bufferedItem.client_op_id,
        aggregateSequenceNumber: nextSeq,
        payload: bufferedItem.event_payload,
        createdAt: new Date().toISOString(),
      };

      // Apply buffered mutation in strict causal sequence order
      const drainedResult = await handler(client, bufferedEvent.payload, bufferedEvent);

      // Advance sequence in aggregate_sequences
      await client.query(
        `
        UPDATE aggregate_sequences
        SET current_sequence_number = $5, updated_at = NOW()
        WHERE organization_id = $1 AND branch_id = $2 AND aggregate_type = $3 AND aggregate_id = $4;
        `,
        [orgId, branchId, event.aggregateType, event.aggregateId, nextSeq],
      );

      const drainedContext: ReceiptIssuanceContext = {
        organizationId: orgId,
        branchId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        action: bufferedEvent.action,
        clientOpId: bufferedEvent.clientOpId,
        aggregateSequenceNumber: nextSeq,
      };

      const drainedReceipt = await Promise.resolve(this.#issuer.issueReceipt(drainedContext));

      // Record in idempotency log
      await client.query(
        `
        INSERT INTO ingested_idempotency_log (
          organization_id,
          branch_id,
          aggregate_type,
          aggregate_id,
          action,
          client_op_id,
          idempotency_key,
          aggregate_sequence_number,
          status,
          response_payload,
          receipt_payload,
          receipt_token
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPLIED', $9, $10, $11);
        `,
        [
          orgId,
          branchId,
          bufferedEvent.aggregateType,
          bufferedEvent.aggregateId,
          bufferedEvent.action,
          bufferedEvent.clientOpId,
          bufferedItem.idempotency_key,
          nextSeq,
          JSON.stringify(drainedResult),
          JSON.stringify(drainedReceipt),
          drainedReceipt.receiptId,
        ],
      );

      // Mark buffer row as DRAINED
      await client.query(
        `
        UPDATE reordering_buffer_queue
        SET status = 'DRAINED', drained_at = NOW()
        WHERE id = $1;
        `,
        [bufferedItem.id],
      );

      currentSeq = nextSeq;
      drainedCount++;
    }

    return {
      status: 'APPLIED',
      receipt,
      responsePayload: mutationResult,
      drainedCount,
      wasDuplicate: false,
    };
  }

  /**
   * Directly inspects the reordering buffer for a given aggregate stream.
   */
  public async getBufferedEvents(
    client: pg.PoolClient,
    orgId: string,
    branchId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<ReorderingBufferRecord[]> {
    const res = await client.query<ReorderingBufferRecord>(
      `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        aggregate_sequence_number AS "aggregateSequenceNumber",
        action,
        client_op_id AS "clientOpId",
        idempotency_key AS "idempotencyKey",
        event_payload AS "eventPayload",
        status,
        received_at AS "receivedAt",
        drained_at AS "drainedAt"
      FROM reordering_buffer_queue
      WHERE organization_id = $1 AND branch_id = $2 AND aggregate_type = $3 AND aggregate_id = $4
      ORDER BY aggregate_sequence_number ASC;
      `,
      [orgId, branchId, aggregateType, aggregateId],
    );
    return res.rows.map((row) => ({
      ...row,
      aggregateSequenceNumber: Number(row.aggregateSequenceNumber),
    }));
  }
}
