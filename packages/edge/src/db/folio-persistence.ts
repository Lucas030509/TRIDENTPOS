/**
 * TRIDENTPOS Internal Edge Folio Lease Persistence Layer
 * Strictly module-internal to @trident/edge.
 * Manages SQLite WAL persistence for local_folio_leases per DATA_MODEL.md Sec. 3,
 * SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3, and WP-011.
 */

import type Database from 'better-sqlite3';
import { EdgeDatabaseService } from './edge-database.js';
import { getTestNativeDatabase } from './test-access.js';

export type FolioType = 'TICKET' | 'CORTE_X' | 'CORTE_Z' | 'FACTURA';
export type LocalLeaseStatus = 'ACTIVE' | 'EXHAUSTED' | 'REVOKED';

export const VALID_FOLIO_TYPES: ReadonlySet<string> = new Set([
  'TICKET',
  'CORTE_X',
  'CORTE_Z',
  'FACTURA',
]);

export interface LocalFolioLeaseRecord {
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly currentFolio: number;
  readonly status: LocalLeaseStatus;
}

export interface SetActiveLeaseInput {
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly currentFolio?: number;
}

export class FolioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolioError';
  }
}

export class FolioLeaseUnavailableError extends FolioError {
  readonly code = 'LEASE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'FolioLeaseUnavailableError';
  }
}

export class FolioLeaseExhaustedError extends FolioError {
  readonly code = 'LEASE_EXHAUSTED';
  constructor(message: string) {
    super(message);
    this.name = 'FolioLeaseExhaustedError';
  }
}

export class FolioLeaseRevokedError extends FolioError {
  readonly code = 'LEASE_REVOKED';
  constructor(message: string) {
    super(message);
    this.name = 'FolioLeaseRevokedError';
  }
}

export class FolioPersistence {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #nativeDb: Database.Database;

  // Test-only fault injection flags
  #simulateConsumeFailure = false;

  constructor(edgeDb: EdgeDatabaseService) {
    this.#edgeDb = edgeDb;
    this.#nativeDb = getTestNativeDatabase(edgeDb);
    this.#initializeSchema();
  }

  public setSimulateConsumeFailure(fail: boolean): void {
    this.#simulateConsumeFailure = fail;
  }

  #initializeSchema(): void {
    this.#nativeDb.exec(`
      CREATE TABLE IF NOT EXISTS local_folio_leases (
        folio_type TEXT PRIMARY KEY,
        epoch_id TEXT NOT NULL,
        fencing_token TEXT NOT NULL,
        range_start INTEGER NOT NULL,
        range_end INTEGER NOT NULL,
        current_folio INTEGER NOT NULL,
        status TEXT NOT NULL,
        CONSTRAINT chk_local_folio_leases_type CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA')),
        CONSTRAINT chk_local_folio_leases_status CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REVOKED')),
        CONSTRAINT chk_local_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start)
      );
    `);
  }

  /**
   * Stores or replaces an authoritative Cloud lease into local SQLite storage.
   * Executed within an explicit SQLite WAL transaction with FULL durability.
   */
  public setActiveLease(input: SetActiveLeaseInput): void {
    if (!VALID_FOLIO_TYPES.has(input.folioType)) {
      throw new FolioError(`Invalid folio type '${input.folioType}'`);
    }
    if (input.rangeStart < 1 || input.rangeEnd < input.rangeStart) {
      throw new FolioError(
        `Invalid folio lease range: [${input.rangeStart}..${input.rangeEnd}]. Must be >= 1 and rangeEnd >= rangeStart.`,
      );
    }
    if (!input.epochId || typeof input.epochId !== 'string') {
      throw new FolioError('Invalid epochId');
    }
    if (!input.fencingToken || typeof input.fencingToken !== 'string') {
      throw new FolioError('Invalid fencingToken');
    }

    const initialFolio =
      input.currentFolio !== undefined ? input.currentFolio : input.rangeStart - 1;

    this.#edgeDb.runInTransaction(
      () => {
        const stmt = this.#nativeDb.prepare(`
          INSERT INTO local_folio_leases (
            folio_type, epoch_id, fencing_token, range_start, range_end, current_folio, status
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
          ON CONFLICT(folio_type) DO UPDATE SET
            epoch_id = excluded.epoch_id,
            fencing_token = excluded.fencing_token,
            range_start = excluded.range_start,
            range_end = excluded.range_end,
            current_folio = excluded.current_folio,
            status = 'ACTIVE';
        `);
        stmt.run(
          input.folioType,
          input.epochId,
          input.fencingToken,
          input.rangeStart,
          input.rangeEnd,
          initialFolio,
        );
      },
      { durabilityMode: 'FULL' },
    );
  }

  /**
   * Retrieves the current local lease record for a folio type, or null if none exists.
   */
  public getLocalLease(folioType: FolioType): LocalFolioLeaseRecord | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT folio_type, epoch_id, fencing_token, range_start, range_end, current_folio, status
      FROM local_folio_leases
      WHERE folio_type = ?;
    `);
    const row = stmt.get(folioType) as
      | {
          folio_type: FolioType;
          epoch_id: string;
          fencing_token: string;
          range_start: number;
          range_end: number;
          current_folio: number;
          status: LocalLeaseStatus;
        }
      | undefined;

    if (!row) return null;

    return {
      folioType: row.folio_type,
      epochId: row.epoch_id,
      fencingToken: row.fencing_token,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      currentFolio: row.current_folio,
      status: row.status,
    };
  }

  /**
   * Atomically consumes the next monotonic folio for the given folio type.
   * Guarantees:
   * - Strict numeric monotonicity: nextFolio > currentFolio.
   * - Strict bounds: rangeStart <= nextFolio <= rangeEnd.
   * - Rejection if status is EXHAUSTED or REVOKED.
   * - Fails closed if lease is missing or exhausted.
   * - Automatic transition to EXHAUSTED when nextFolio === rangeEnd.
   * - Executed within an explicit SQLite WAL transaction with FULL durability.
   */
  public consumeNextFolio(folioType: FolioType): number {
    if (!VALID_FOLIO_TYPES.has(folioType)) {
      throw new FolioError(`Invalid folio type '${folioType}'`);
    }

    return this.#edgeDb.runInTransaction(
      () => {
        const stmt = this.#nativeDb.prepare(`
          SELECT folio_type, epoch_id, fencing_token, range_start, range_end, current_folio, status
          FROM local_folio_leases
          WHERE folio_type = ?;
        `);
        const lease = stmt.get(folioType) as
          | {
              folio_type: FolioType;
              epoch_id: string;
              fencing_token: string;
              range_start: number;
              range_end: number;
              current_folio: number;
              status: LocalLeaseStatus;
            }
          | undefined;

        if (!lease) {
          throw new FolioLeaseUnavailableError(
            `No local folio lease configured for folio type '${folioType}'. Active lease required.`,
          );
        }

        if (lease.status === 'REVOKED') {
          throw new FolioLeaseRevokedError(
            `Local folio lease for '${folioType}' has been revoked (fenced by newer epoch or administrative action).`,
          );
        }

        if (lease.status === 'EXHAUSTED' || lease.current_folio >= lease.range_end) {
          throw new FolioLeaseExhaustedError(
            `Local folio lease for '${folioType}' is EXHAUSTED (range [${lease.range_start}..${lease.range_end}] fully consumed). Separately granted authoritative lease required.`,
          );
        }

        if (this.#simulateConsumeFailure) {
          throw new Error('Injected fault: simulated failure during local folio consumption');
        }

        const nextFolio =
          lease.current_folio < lease.range_start ? lease.range_start : lease.current_folio + 1;

        if (nextFolio > lease.range_end) {
          // Mark EXHAUSTED and reject
          this.#nativeDb
            .prepare(`UPDATE local_folio_leases SET status = 'EXHAUSTED' WHERE folio_type = ?;`)
            .run(folioType);
          throw new FolioLeaseExhaustedError(
            `Local folio lease for '${folioType}' is EXHAUSTED (range [${lease.range_start}..${lease.range_end}] fully consumed). Separately granted authoritative lease required.`,
          );
        }

        const newStatus: LocalLeaseStatus = nextFolio === lease.range_end ? 'EXHAUSTED' : 'ACTIVE';

        const updateStmt = this.#nativeDb.prepare(`
          UPDATE local_folio_leases
          SET current_folio = ?, status = ?
          WHERE folio_type = ?;
        `);
        updateStmt.run(nextFolio, newStatus, folioType);

        return nextFolio;
      },
      { durabilityMode: 'FULL' },
    );
  }

  /**
   * Revokes the local folio lease for the given folio type (e.g. upon receiving HTTP 403 LEASE_REVOKED).
   * Transitions node into forensic read-only mode for this folio type.
   */
  public revokeLease(folioType: FolioType): void {
    this.#edgeDb.runInTransaction(
      () => {
        this.#nativeDb
          .prepare(`UPDATE local_folio_leases SET status = 'REVOKED' WHERE folio_type = ?;`)
          .run(folioType);
      },
      { durabilityMode: 'FULL' },
    );
  }
}
