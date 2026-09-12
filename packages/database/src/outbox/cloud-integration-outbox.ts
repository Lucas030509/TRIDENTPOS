/**
 * TRIDENTPOS Cloud Integration Outbox Service (ADR-007)
 * Implements:
 * - Transaction-atomic event enqueuing inside existing PostgreSQL client/transaction
 * - Worker claiming with FOR UPDATE SKIP LOCKED
 * - Exponential backoff retry scheduling (max 5 retries)
 * - DLQ routing upon retry exhaustion or non-retryable failure
 * - DLQ and outbox backlog monitoring queries
 */

import type pg from 'pg';
import type { BackoffPolicy } from '@trident/core';
import type {
  CloudIntegrationDLQRecord,
  CloudIntegrationOutboxRecord,
  EnqueueIntegrationEventInput,
} from './types.js';

export class CloudIntegrationOutboxService {
  /**
   * Enqueues an integration event within the caller's authoritative transaction.
   * INVARIANT: Domain mutation + integration event MUST commit in the same transaction.
   */
  public async enqueue(
    client: pg.PoolClient,
    input: EnqueueIntegrationEventInput,
  ): Promise<CloudIntegrationOutboxRecord> {
    const maxRetries = input.maxRetries ?? 5;
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
        max_retries,
        next_retry_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 0, $7, NOW())
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
   * Multi-instance safe: Uses FOR UPDATE SKIP LOCKED to prevent duplicate processing.
   */
  public async claimBatch(
    client: pg.PoolClient,
    workerId: string,
    limit = 10,
  ): Promise<CloudIntegrationOutboxRecord[]> {
    const selectQuery = `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        status,
        retry_count AS "retryCount",
        max_retries AS "maxRetries",
        next_retry_at AS "nextRetryAt",
        last_error AS "lastError",
        lock_id AS "lockId",
        locked_at AS "lockedAt",
        created_at AS "createdAt",
        published_at AS "publishedAt"
      FROM cloud_integration_outbox
      WHERE status IN ('PENDING', 'PROCESSING')
        AND next_retry_at <= NOW()
        AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '2 minutes')
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED;
    `;

    const selectRes = await client.query<CloudIntegrationOutboxRecord>(selectQuery, [limit]);
    if (selectRes.rows.length === 0) {
      return [];
    }

    const ids = selectRes.rows.map((r) => r.id);
    const updateQuery = `
      UPDATE cloud_integration_outbox
      SET
        status = 'PROCESSING',
        lock_id = $1,
        locked_at = NOW()
      WHERE id = ANY($2::uuid[])
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
        max_retries AS "maxRetries",
        next_retry_at AS "nextRetryAt",
        last_error AS "lastError",
        lock_id AS "lockId",
        locked_at AS "lockedAt",
        created_at AS "createdAt",
        published_at AS "publishedAt";
    `;

    const updateRes = await client.query<CloudIntegrationOutboxRecord>(updateQuery, [
      workerId,
      ids,
    ]);
    return updateRes.rows;
  }

  /**
   * Marks an integration event as successfully dispatched and published.
   */
  public async completeEvent(client: pg.PoolClient, id: string): Promise<void> {
    await client.query(
      `
      UPDATE cloud_integration_outbox
      SET
        status = 'PUBLISHED',
        published_at = NOW(),
        lock_id = NULL
      WHERE id = $1;
      `,
      [id],
    );
  }

  /**
   * Handles failure for an integration event.
   * If non-retryable OR retryCount >= maxRetries: routes to CloudIntegrationDLQ.
   * Otherwise: increments retryCount, applies exponential backoff, returns to PENDING.
   */
  public async handleFailure(
    client: pg.PoolClient,
    id: string,
    error: Error,
    backoffPolicy: BackoffPolicy,
    isNonRetryable = false,
  ): Promise<{ routedToDlq: boolean; newRetryCount: number }> {
    const fetchQuery = `
      SELECT
        id,
        organization_id AS "organizationId",
        branch_id AS "branchId",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        retry_count AS "retryCount",
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
      retryCount: number;
      maxRetries: number;
    }>(fetchQuery, [id]);

    const row = fetchRes.rows[0];
    if (!row) {
      throw new Error(`Cloud outbox event ${id} not found`);
    }
    const newRetryCount = row.retryCount + 1;
    const shouldRouteToDlq = isNonRetryable || newRetryCount >= row.maxRetries;

    if (shouldRouteToDlq) {
      // Insert into DLQ preserving full provenance, error codes, and trace
      await client.query(
        `
        INSERT INTO cloud_integration_dlq (
          organization_id,
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
        `,
        [
          row.organizationId,
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
            failedAt: new Date().toISOString(),
          }),
        ],
      );

      // Update outbox row to DLQ terminal status
      await client.query(
        `
        UPDATE cloud_integration_outbox
        SET
          status = 'DLQ',
          last_error = $2,
          lock_id = NULL
        WHERE id = $1;
        `,
        [id, error.message],
      );

      return { routedToDlq: true, newRetryCount };
    }

    // Exponential backoff calculation
    const delayMs = backoffPolicy.calculateDelay
      ? backoffPolicy.calculateDelay(newRetryCount)
      : backoffPolicy.getDelayMs(newRetryCount);
    await client.query(
      `
      UPDATE cloud_integration_outbox
      SET
        status = 'PENDING',
        retry_count = $2,
        next_retry_at = NOW() + ($3 || ' milliseconds')::interval,
        last_error = $4,
        lock_id = NULL
      WHERE id = $1;
      `,
      [id, newRetryCount, delayMs, error.message],
    );

    return { routedToDlq: false, newRetryCount };
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
