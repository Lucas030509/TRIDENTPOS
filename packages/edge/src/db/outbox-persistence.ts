/**
 * TRIDENTPOS Edge Outbox Queue Persistence Layer (ADR-006)
 * Strictly module-internal to @trident/edge.
 * Manages SQLite WAL persistence for outbox_queue per ADR-006,
 * SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2, and WP-012.
 */

import crypto from 'node:crypto';
import {
  CloudReceiptVerifier,
  ReceiptIssuanceContext,
  SyncEventAckDTO,
  isValidCloudReceipt,
  isValidUuidV4,
} from '@trident/core';
import { EdgeDatabaseService } from './edge-database.js';

export interface EdgeOutboxRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly action: string;
  readonly clientOpId: string;
  readonly aggregateSequenceNumber: number;
  readonly payload: unknown;
  readonly status: 'PENDING' | 'SYNCED' | 'FAILED';
  readonly receiptToken: string | null;
  readonly receiptVerifiedAt: string | null;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly syncedAt: string | null;
  readonly lastError: string | null;
}

export interface EnqueueOutboxInput {
  readonly id?: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly action: string;
  readonly clientOpId: string;
  readonly aggregateSequenceNumber: number;
  readonly payload: unknown;
}

export class EdgeOutboxPersistence {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #verifier: CloudReceiptVerifier | null;

  constructor(edgeDb: EdgeDatabaseService, verifier?: CloudReceiptVerifier | null) {
    this.#edgeDb = edgeDb;
    this.#verifier = verifier ?? null;
    this.#initializeSchema();
  }

  #initializeSchema(): void {
    this.#edgeDb.exec(`
      CREATE TABLE IF NOT EXISTS outbox_queue (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        action TEXT NOT NULL,
        client_op_id TEXT NOT NULL UNIQUE,
        aggregate_sequence_number INTEGER NOT NULL CHECK (aggregate_sequence_number >= 1),
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        receipt_token TEXT,
        receipt_verified_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced_at TEXT,
        last_error TEXT,
        CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'SYNCED', 'FAILED'))
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_queue_status ON outbox_queue (status);
      CREATE INDEX IF NOT EXISTS idx_outbox_queue_stream ON outbox_queue (aggregate_type, aggregate_id, aggregate_sequence_number);
    `);
  }

  /**
   * Enqueues an outbox event.
   * Can be called inside an active transaction boundary.
   */
  public enqueue(input: EnqueueOutboxInput): EdgeOutboxRecord {
    if (!isValidUuidV4(input.clientOpId)) {
      throw new Error('clientOpId must be a valid UUIDv4');
    }
    if (!Number.isSafeInteger(input.aggregateSequenceNumber) || input.aggregateSequenceNumber < 1) {
      throw new Error('aggregateSequenceNumber must be a safe positive integer >= 1');
    }

    const id = input.id ?? crypto.randomUUID();
    const payloadStr = JSON.stringify(input.payload);

    const stmt = this.#edgeDb.prepare(`
      INSERT INTO outbox_queue (
        id,
        organization_id,
        branch_id,
        aggregate_type,
        aggregate_id,
        action,
        client_op_id,
        aggregate_sequence_number,
        payload,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      RETURNING
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        aggregate_type AS aggregateType,
        aggregate_id AS aggregateId,
        action,
        client_op_id AS clientOpId,
        aggregate_sequence_number AS aggregateSequenceNumber,
        payload,
        status,
        receipt_token AS receiptToken,
        receipt_verified_at AS receiptVerifiedAt,
        retry_count AS retryCount,
        created_at AS createdAt,
        synced_at AS syncedAt,
        last_error AS lastError;
    `);

    const row = stmt.get(
      id,
      input.organizationId,
      input.branchId,
      input.aggregateType,
      input.aggregateId,
      input.action,
      input.clientOpId,
      input.aggregateSequenceNumber,
      payloadStr,
    ) as EdgeOutboxRecord;

    return {
      ...row,
      payload: JSON.parse(row.payload as string),
    };
  }

  /**
   * Atomically executes a domain mutation function alongside outbox enqueues.
   * If either fails, the entire transaction rolls back cleanly.
   */
  public executeWithOutbox<T>(mutationFn: () => T, events: EnqueueOutboxInput[]): T {
    return this.#edgeDb.runInTransaction(() => {
      const result = mutationFn();
      for (const event of events) {
        this.enqueue(event);
      }
      return result;
    });
  }

  /**
   * Marks an outbox record as SYNCED.
   * GOVERNED INVARIANT (Sec 7.5 & QI-012-02):
   * An Edge outbox row may become SYNCED only when:
   * 1. ACK status is APPLIED or DUPLICATE_ACCEPTED
   * 2. ACK carries valid Cloud receipt material (not empty, safe positive sequence)
   * 3. CloudReceiptVerifier is configured and verifies serverSignature cryptographically/determinstically
   * 4. Receipt clientOpId matches outbox row clientOpId
   * 5. Receipt aggregateSequenceNumber matches outbox row aggregateSequenceNumber
   * If verifier missing, signature forged, or receipt invalid: MUST NOT mark SYNCED (fails closed).
   */
  public markSynced(
    id: string,
    ack: SyncEventAckDTO,
    customVerifier?: CloudReceiptVerifier,
  ): boolean {
    const fetchStmt = this.#edgeDb.prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        client_op_id AS clientOpId,
        aggregate_sequence_number AS aggregateSequenceNumber,
        status
      FROM outbox_queue
      WHERE id = ?;
    `);

    const row = fetchStmt.get(id) as
      | {
          id: string;
          organizationId: string;
          branchId: string;
          clientOpId: string;
          aggregateSequenceNumber: number;
          status: string;
        }
      | undefined;

    if (!row) {
      return false;
    }

    const isTerminalStatus = ack.status === 'APPLIED' || ack.status === 'DUPLICATE_ACCEPTED';
    if (!isTerminalStatus) {
      return false;
    }

    const receipt = ack.receipt;
    if (!receipt || !isValidCloudReceipt(receipt)) {
      return false;
    }

    if (
      receipt.clientOpId !== row.clientOpId ||
      receipt.aggregateSequenceNumber !== row.aggregateSequenceNumber
    ) {
      return false;
    }

    const verifier = customVerifier ?? this.#verifier;
    if (!verifier) {
      // QI-012-02: Missing CloudReceiptVerifier fails closed
      return false;
    }

    const context: ReceiptIssuanceContext = {
      organizationId: row.organizationId,
      branchId: row.branchId,
      clientOpId: row.clientOpId,
      aggregateSequenceNumber: row.aggregateSequenceNumber,
    };

    const verificationResult = verifier.verifyReceipt(receipt, context);
    const isVerified = typeof verificationResult === 'boolean' ? verificationResult : false;

    if (!isVerified) {
      // QI-012-02: Forged or invalid signature rejected
      return false;
    }

    return this.#edgeDb.runInTransaction(() => {
      const updateStmt = this.#edgeDb.prepare(`
        UPDATE outbox_queue
        SET
          status = 'SYNCED',
          receipt_token = ?,
          receipt_verified_at = ?,
          synced_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ?;
      `);

      const res = updateStmt.run(receipt.serverSignature, receipt.appliedAt, id);
      return res.changes > 0;
    });
  }

  /**
   * Retrieves pending outbox events for synchronization.
   */
  public getPendingEvents(limit = 100): EdgeOutboxRecord[] {
    const stmt = this.#edgeDb.prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        aggregate_type AS aggregateType,
        aggregate_id AS aggregateId,
        action,
        client_op_id AS clientOpId,
        aggregate_sequence_number AS aggregateSequenceNumber,
        payload,
        status,
        receipt_token AS receiptToken,
        receipt_verified_at AS receiptVerifiedAt,
        retry_count AS retryCount,
        created_at AS createdAt,
        synced_at AS syncedAt,
        last_error AS lastError
      FROM outbox_queue
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ?;
    `);

    const rows = stmt.all(limit) as EdgeOutboxRecord[];
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload as string),
    }));
  }

  /**
   * Returns current pending outbox backlog count.
   */
  public getBacklogCount(): number {
    const stmt = this.#edgeDb.prepare(`
      SELECT COUNT(*) AS count
      FROM outbox_queue
      WHERE status = 'PENDING';
    `);

    const res = stmt.get() as { count: number };
    return res.count;
  }

  /**
   * Evaluates the backlog alert condition (> 100 pending events).
   * Alert triggers if and only if backlog > 100.
   */
  public checkBacklogAlert(onAlert?: (count: number) => void): {
    count: number;
    alertTriggered: boolean;
  } {
    const count = this.getBacklogCount();
    const alertTriggered = count > 100;
    if (alertTriggered && onAlert) {
      onAlert(count);
    }
    return { count, alertTriggered };
  }

  /**
   * Helper to retrieve record by ID (for tests).
   */
  public getById(id: string): EdgeOutboxRecord | undefined {
    const stmt = this.#edgeDb.prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        branch_id AS branchId,
        aggregate_type AS aggregateType,
        aggregate_id AS aggregateId,
        action,
        client_op_id AS clientOpId,
        aggregate_sequence_number AS aggregateSequenceNumber,
        payload,
        status,
        receipt_token AS receiptToken,
        receipt_verified_at AS receiptVerifiedAt,
        retry_count AS retryCount,
        created_at AS createdAt,
        synced_at AS syncedAt,
        last_error AS lastError
      FROM outbox_queue
      WHERE id = ?;
    `);

    const row = stmt.get(id) as EdgeOutboxRecord | undefined;
    if (!row) return undefined;
    return {
      ...row,
      payload: JSON.parse(row.payload as string),
    };
  }
}
