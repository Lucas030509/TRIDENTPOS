/**
 * TRIDENTPOS Edge Enrollment Local Persistence
 * Owned internally by Edge Database Subsystem per DATA_AUTHORITY_MATRIX.md Topology 1.
 * Exposes strictly typed, narrow operations. Zero arbitrary SQL capability.
 */

import type Database from 'better-sqlite3';
import type { EdgeDatabaseService } from './edge-database.js';

export interface EnrollmentTokenRecord {
  readonly pairingId: string;
  readonly branchId: string;
  readonly edgeId: string;
  readonly secretHash: string;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
  readonly createdAt: number;
}

export interface StationCredentialsRecord {
  readonly stationId: string;
  readonly stationCode: string;
  readonly stationType: string;
  readonly stationPublicKey: string;
  readonly stationTokenHash: string;
  readonly enrolledAt: number;
  readonly isRevoked: boolean;
}

export class EnrollmentPersistence {
  readonly #db: Database.Database;
  readonly #service: EdgeDatabaseService;

  constructor(service: EdgeDatabaseService, db: Database.Database) {
    this.#service = service;
    this.#db = db;
    this.initializeSchema();
  }

  public initializeSchema(): void {
    this.#service.runInTransaction(() => {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS enrollment_tokens (
          pairing_id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL,
          edge_id TEXT NOT NULL,
          secret_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS station_credentials (
          station_id TEXT PRIMARY KEY,
          station_code TEXT NOT NULL,
          station_type TEXT NOT NULL,
          station_public_key TEXT NOT NULL,
          station_token_hash TEXT NOT NULL,
          enrolled_at INTEGER NOT NULL,
          is_revoked INTEGER NOT NULL DEFAULT 0
        );
      `);
    });
  }

  public insertPairingToken(token: EnrollmentTokenRecord): void {
    this.#service.runInTransaction(() => {
      this.#db
        .prepare(
          `INSERT INTO enrollment_tokens (pairing_id, branch_id, edge_id, secret_hash, expires_at, consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          token.pairingId,
          token.branchId,
          token.edgeId,
          token.secretHash,
          token.expiresAt,
          token.consumedAt,
          token.createdAt,
        );
    });
  }

  public findPairingToken(pairingId: string): EnrollmentTokenRecord | null {
    const row = this.#db
      .prepare(
        `SELECT pairing_id, branch_id, edge_id, secret_hash, expires_at, consumed_at, created_at
         FROM enrollment_tokens WHERE pairing_id = ?`,
      )
      .get(pairingId) as
      | {
          pairing_id: string;
          branch_id: string;
          edge_id: string;
          secret_hash: string;
          expires_at: number;
          consumed_at: number | null;
          created_at: number;
        }
      | undefined;

    if (!row) return null;

    return {
      pairingId: row.pairing_id,
      branchId: row.branch_id,
      edgeId: row.edge_id,
      secretHash: row.secret_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
    };
  }

  public consumePairingTokenAtomic(pairingId: string, consumedAt: number): boolean {
    return this.#service.runInTransaction(() => {
      const result = this.#db
        .prepare(
          `UPDATE enrollment_tokens
           SET consumed_at = ?
           WHERE pairing_id = ? AND consumed_at IS NULL`,
        )
        .run(consumedAt, pairingId);

      return result.changes === 1;
    });
  }

  public insertStationCredentials(creds: StationCredentialsRecord): void {
    this.#service.runInTransaction(() => {
      this.#db
        .prepare(
          `INSERT INTO station_credentials (station_id, station_code, station_type, station_public_key, station_token_hash, enrolled_at, is_revoked)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          creds.stationId,
          creds.stationCode,
          creds.stationType,
          creds.stationPublicKey,
          creds.stationTokenHash,
          creds.enrolledAt,
          creds.isRevoked ? 1 : 0,
        );
    });
  }

  public findStationCredentials(stationId: string): StationCredentialsRecord | null {
    const row = this.#db
      .prepare(
        `SELECT station_id, station_code, station_type, station_public_key, station_token_hash, enrolled_at, is_revoked
         FROM station_credentials WHERE station_id = ?`,
      )
      .get(stationId) as
      | {
          station_id: string;
          station_code: string;
          station_type: string;
          station_public_key: string;
          station_token_hash: string;
          enrolled_at: number;
          is_revoked: number;
        }
      | undefined;

    if (!row) return null;

    return {
      stationId: row.station_id,
      stationCode: row.station_code,
      stationType: row.station_type,
      stationPublicKey: row.station_public_key,
      stationTokenHash: row.station_token_hash,
      enrolledAt: row.enrolled_at,
      isRevoked: row.is_revoked === 1,
    };
  }
}
