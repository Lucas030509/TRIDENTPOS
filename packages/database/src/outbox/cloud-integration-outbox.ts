/**
 * TRIDENTPOS Cloud Integration Outbox Service (ADR-007)
 * Implements:
 * - Transaction-atomic event enqueuing inside existing PostgreSQL client/transaction
 * - Worker claiming with atomic CTE and FOR UPDATE SKIP LOCKED
 * - CAS claim ownership tracking preventing stale worker overrides
 * - Exponential backoff retry scheduling (max 5 retries, 6 failed delivery attempts total)
 * - DLQ routing upon retry exhaustion or non-retryable failure
 * - DLQ and outbox backlog monitoring queries
 */

import type pg from 'pg';
import { BackoffPolicy, CANONICAL_MAX_RETRIES, ERROR_CODE_STALE_CLAIM } from '@trident/core';
import type {
  CloudIntegrationDLQRecord,
  CloudIntegrationOutboxRecord,
  EnqueueIntegrationEventInput,
} from './types.js';

export class CloudIntegrationOutboxService {
  /**
   * Enqueues an integration event within the caller's authoritative transaction.
   * INVARIANT: Domain mutation + integration event MUST commit in the same transaction.
   * QI-012-03: Max retries is frozen to canonical 5.
   */
  public async enqueue(
    client: pg.PoolClient,
    input: EnqueueIntegrationEventInput,
  ): Promise<CloudIntegrationOutboxRecord> {
    if (input.maxRetries !== undefined && input.maxRetries !== CANONICAL_MAX_RETRIES) {
      throw new Error(
        `Invalid maxRetries ${input.maxRetries}: must be canonical ${CANONICAL_MAX_RETRIES} (WP-012)`,
      );
    }
    const maxRetries = CANONICAL_MAX_RETRIES;

    const query = `
      INSERT INTO cloud_integration_outbox (
        organization_id,
        branch_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload,
        status,
        retry_count,
        delivery_attempts,
        max_retries,
        next_retry_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 0, 0, $7, NOW())
      RETURNING
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        status,
        retry_count AS "retryCount",
        delivery_attempts AS "deliveryAttempts",
        max_retries AS "maxRetries",
        next_retry_at AS "nextRetryAt",
        last_error AS "lastError",
        lock_id AS "lockId",
        locked_at AS "lockedAt",
        created_at AS "createdAt",
        published_at AS "publishedAt";
    `;

    const res = await client.query<CloudIntegrationOutboxRecord>(query, [
      input.organizationId,
      input.branchId ?? null,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      maxRetries,
    ]);

    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to insert cloud integration outbox event');
    }
    return row;
  }

  /**
   * Discovers and claims a batch of pending/retryable integration events.
   * Multi-instance safe: Uses an atomic SQL CTE with FOR UPDATE SKIP LOCKED
   * to guarantee claim atomicity and prevent race conditions.
   */
  public async claimBatch(
    client: pg.PoolClient,
    workerId: string,
    limit = 10,
  ): Promise<CloudIntegrationOutboxRecord[]> {
    const atomicCteQuery = `
      WITH candidates AS (
        SELECT id
        FROM cloud_integration_outbox
        WHERE status IN ('PENDING', 'PROCESSING')
          AND next_retry_at <= NOW()
          AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '2 minutes')
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE cloud_integration_outbox o
      SET
        status = 'PROCESSING',
        lock_id = $2,
        locked_at = NOW()
      FROM candidates
      WHERE o.id = candidates.id
      RETURNING
        o.id,
        o.organization_id AS "organizationId",
        o.branch_id AS "branchId",
        o.event_type AS "eventType",
        o.aggregate_type AS "aggregateType",
        o.aggregate_id AS "aggregateId",
        o.payload,
        o.status,
        o.retry_count AS "retryCount",
        o.delivery_attempts AS "deliveryAttempts",
        o.max_retries AS "maxRetries",
        o.next_retry_at AS "nextRetryAt",
        o.last_error AS "lastError",
        o.lock_id AS "lockId",
        o.locked_at AS "lockedAt",
        o.created_at AS "createdAt",
        o.published_at AS "publishedAt";
    `;

    const res = await client.query<CloudIntegrationOutboxRecord>(atomicCteQuery, [limit, workerId]);
    return res.rows;
  }

  /**
   * Marks an integration event as successfully dispatched and published.
   * QI-012-05: Enforces CAS claim ownership. A worker cannot complete
   * a row it does not currently hold an active claim on.
   */
  public async completeEvent(client: pg.PoolClient, id: string, claimToken: string): Promise<void> {
    const res = await client.query(
      `
      UPDATE cloud_integration_outbox
      SET
        status = 'PUBLISHED',
        published_at = NOW(),
        lock_id = NULL
      WHERE id = $1
        AND status = 'PROCESSING'
        AND lock_id = $2;
      `,
      [id, claimToken],
    );

    if (res.rowCount === 0) {
      throw new Error(
        `${ERROR_CODE_STALE_CLAIM}: Worker does not own active claim for event ${id}`,
      );
    }
  }

  /**
   * Handles failure for an integration event.
   * QI-012-03: Canonical retry policy is initial attempt + 5 retries = 6 failed delivery attempts before DLQ.
   * QI-012-05: Enforces CAS claim ownership. Stale workers cannot fail a row owned by another worker.
   */
  public async handleFailure(
    client: pg.PoolClient,
    id: string,
    claimToken: string,
    error: Error,
    backoffPolicy: BackoffPolicy,
    isNonRetryable = false,
  ): Promise<{ routedToDlq: boolean; newRetryCount: number; deliveryAttempts: number }> {
    const fetchQuery = `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        status,
        lock_id AS "lockId",
        retry_count AS "retryCount",
        delivery_attempts AS "deliveryAttempts",
        max_retries AS "maxRetries"
      FROM cloud_integration_outbox
      WHERE id = $1
      FOR UPDATE;
    `;

    const fetchRes = await client.query<{
      id: string;
      organizationId: string;
      branchId: string | null;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: unknown;
      status: string;
      lockId: string | null;
      retryCount: number;
      deliveryAttempts: number;
      maxRetries: number;
    }>(fetchQuery, [id]);

    const row = fetchRes.rows[0];
    if (!row) {
      throw new Error(`Cloud outbox event ${id} not found`);
    }

    if (row.status !== 'PROCESSING' || row.lockId !== claimToken) {
      throw new Error(
        `${ERROR_CODE_STALE_CLAIM}: Worker does not own active claim for event ${id}`,
      );
    }

    const newDeliveryAttempts = row.deliveryAttempts + 1;
    // Initial failure (attempt 1) consumes 0 retries (it is the initial attempt).
    // Subsequent failures (attempts 2..6) consume retries 1..5.
    const newRetryCount = Math.max(0, newDeliveryAttempts - 1);
    // After retry #5 fails (i.e. delivery attempt 6), row moves to DLQ.
    const shouldRouteToDlq = isNonRetryable || newDeliveryAttempts > row.maxRetries;

    if (shouldRouteToDlq) {
      // Insert into DLQ preserving full provenance, error codes, trace, and branch identity
      await client.query(
        `
        INSERT INTO cloud_integration_dlq (
          organization_id,
          branch_id,
          originating_outbox_id,
          event_type,
          aggregate_type,
          aggregate_id,
          raw_payload,
          error_code,
          error_message,
          error_trace,
          retry_count,
          context
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
        `,
        [
          row.organizationId,
          row.branchId,
          row.id,
          row.eventType,
          row.aggregateType,
          row.aggregateId,
          JSON.stringify(row.payload),
          isNonRetryable ? 'NON_RETRYABLE_ERROR' : 'RETRY_EXHAUSTED',
          error.message,
          error.stack ?? null,
          newRetryCount,
          JSON.stringify({
            branchId: row.branchId,
            deliveryAttempts: newDeliveryAttempts,
            failedAt: new Date().toISOString(),
          }),
        ],
      );

      // CAS update outbox row to DLQ terminal status
      const updateRes = await client.query(
        `
        UPDATE cloud_integration_outbox
        SET
          status = 'DLQ',
          last_error = $2,
          retry_count = $3,
          delivery_attempts = $4,
          lock_id = NULL
        WHERE id = $1
          AND status = 'PROCESSING'
          AND lock_id = $5;
        `,
        [id, error.message, newRetryCount, newDeliveryAttempts, claimToken],
      );

      if (updateRes.rowCount === 0) {
        throw new Error(
          `${ERROR_CODE_STALE_CLAIM}: Lost claim during DLQ transition for event ${id}`,
        );
      }

      return { routedToDlq: true, newRetryCount, deliveryAttempts: newDeliveryAttempts };
    }

    // Exponential backoff calculation using retry count (0 on initial failure, 1 on retry 1, etc.)
    const delayMs = backoffPolicy.calculateDelay
      ? backoffPolicy.calculateDelay(newRetryCount)
      : backoffPolicy.getDelayMs(newRetryCount);

    const updateRes = await client.query(
      `
      UPDATE cloud_integration_outbox
      SET
        status = 'PENDING',
        retry_count = $2,
        delivery_attempts = $3,
        next_retry_at = NOW() + ($4 || ' milliseconds')::interval,
        last_error = $5,
        lock_id = NULL,
        locked_at = NULL
      WHERE id = $1
        AND status = 'PROCESSING'
        AND lock_id = $6;
      `,
      [id, newRetryCount, newDeliveryAttempts, delayMs, error.message, claimToken],
    );

    if (updateRes.rowCount === 0) {
      throw new Error(
        `${ERROR_CODE_STALE_CLAIM}: Lost claim during retry transition for event ${id}`,
      );
    }

    return { routedToDlq: false, newRetryCount, deliveryAttempts: newDeliveryAttempts };
  }

  /**
   * Retrieves items from the Dead Letter Queue for inspection.
   */
  public async queryDLQ(
    client: pg.PoolClient,
    organizationId: string,
    limit = 50,
  ): Promise<CloudIntegrationDLQRecord[]> {
    const res = await client.query<CloudIntegrationDLQRecord>(
      `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        originating_outbox_id AS "originatingOutboxId",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        raw_payload AS "rawPayload",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        error_trace AS "errorTrace",
        retry_count AS "retryCount",
        context,
        moved_to_dlq_at AS "movedToDlqAt"
      FROM cloud_integration_dlq
      WHERE organization_id = $1
      ORDER BY moved_to_dlq_at DESC
      LIMIT $2;
      `,
      [organizationId, limit],
    );
    return res.rows;
  }

  /**
   * Returns current pending/processing backlog count for alerting.
   */
  public async getOutboxBacklogCount(
    client: pg.PoolClient,
    organizationId: string,
  ): Promise<number> {
    const res = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM cloud_integration_outbox
      WHERE organization_id = $1 AND status IN ('PENDING', 'PROCESSING');
      `,
      [organizationId],
    );
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }

  /**
   * Returns current DLQ count for alerting.
   */
  public async getDLQBacklogCount(client: pg.PoolClient, organizationId: string): Promise<number> {
    const res = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM cloud_integration_dlq
      WHERE organization_id = $1;
      `,
      [organizationId],
    );
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }
}
