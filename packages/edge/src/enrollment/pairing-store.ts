/**
 * TRIDENTPOS One-Time Pairing Token Store & Station Credentials Persistence
 * Governed by WP-008 durability invariants, ADR-004, and WP-009 acceptance criteria.
 */

import { EdgeDatabaseService } from '../db/edge-database.js';
import { hashSha256, timingSafeSecretCompare } from './crypto.js';
import { EnrollmentError, PairingPayload, StationCredentials, StationType } from './types.js';

export interface ClockProvider {
  nowSeconds(): number;
}

export const SystemClock: ClockProvider = Object.freeze({
  nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  },
});

export interface ConsumePairingParams {
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly branchId: string;
  readonly edgeId: string;
  readonly stationId: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly stationPublicKey: string;
  readonly stationToken: string;
}

export class OneTimePairingStore {
  readonly #dbService: EdgeDatabaseService;
  readonly #clock: ClockProvider;

  constructor(dbService: EdgeDatabaseService, clock: ClockProvider = SystemClock) {
    this.#dbService = dbService;
    this.#clock = clock;
    this.#initSchema();
  }

  #initSchema(): void {
    this.#dbService.transaction(() => {
      this.#dbService.exec(`
        CREATE TABLE IF NOT EXISTS enrollment_tokens (
          pairing_id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL,
          edge_id TEXT NOT NULL,
          pairing_secret_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER NULL,
          station_id TEXT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_branch ON enrollment_tokens (branch_id);

        CREATE TABLE IF NOT EXISTS station_credentials (
          station_id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL,
          station_code TEXT NOT NULL,
          station_type TEXT NOT NULL,
          station_public_key TEXT NOT NULL,
          station_token_hash TEXT NOT NULL,
          enrolled_at INTEGER NOT NULL,
          is_revoked INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_station_credentials_branch ON station_credentials (branch_id);
      `);
    });
  }

  /**
   * Stores a freshly generated one-time pairing payload in the database.
   * Secret is stored as a SHA-256 hash to ensure zero plaintext secret exposure at rest.
   */
  public storePairingToken(payload: PairingPayload): void {
    const secretHash = hashSha256(payload.pairingSecret);
    const createdAt = this.#clock.nowSeconds();

    this.#dbService.transaction(() => {
      this.#dbService.run(
        `INSERT INTO enrollment_tokens (
          pairing_id, branch_id, edge_id, pairing_secret_hash, expires_at, consumed_at, station_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        [
          payload.pairingId,
          payload.branchId,
          payload.edgeId,
          secretHash,
          payload.expiresAt,
          createdAt,
        ],
      );
    });
  }

  /**
   * Atomically verifies and consumes a pairing token, registering the station credentials.
   * Fails closed if expired, already consumed, secret mismatch, context mismatch, or race conflict.
   */
  public consumePairingToken(params: ConsumePairingParams): StationCredentials {
    const now = this.#clock.nowSeconds();
    const candidateSecretHash = hashSha256(params.pairingSecret);

    return this.#dbService.transaction(() => {
      // 1. Fetch token record
      const rows = this.#dbService.query<{
        pairing_id: string;
        branch_id: string;
        edge_id: string;
        pairing_secret_hash: string;
        expires_at: number;
        consumed_at: number | null;
        station_id: string | null;
      }>(
        `SELECT pairing_id, branch_id, edge_id, pairing_secret_hash, expires_at, consumed_at, station_id
         FROM enrollment_tokens
         WHERE pairing_id = ?`,
        [params.pairingId],
      );

      const token = rows[0];
      if (!token) {
        throw new EnrollmentError(
          'TOKEN_NOT_FOUND',
          `Pairing token '${params.pairingId}' does not exist`,
        );
      }

      // 2. Check consumption status
      if (token.consumed_at !== null) {
        throw new EnrollmentError(
          'TOKEN_ALREADY_CONSUMED',
          `Pairing token '${params.pairingId}' was already consumed at timestamp ${token.consumed_at}`,
        );
      }

      // 3. Check expiration
      if (now >= token.expires_at) {
        throw new EnrollmentError(
          'TOKEN_EXPIRED',
          `Pairing token '${params.pairingId}' expired at ${token.expires_at} (current time: ${now})`,
        );
      }

      // 4. Verify secret in constant-time
      const isSecretValid = timingSafeSecretCompare(token.pairing_secret_hash, candidateSecretHash);
      if (!isSecretValid) {
        throw new EnrollmentError('INVALID_SECRET', 'Provided pairing secret does not match');
      }

      // 5. Verify branch and edge context binding
      if (token.branch_id !== params.branchId) {
        throw new EnrollmentError(
          'CONTEXT_MISMATCH',
          `Branch mismatch: token issued for branch '${token.branch_id}', received '${params.branchId}'`,
        );
      }

      if (token.edge_id !== params.edgeId) {
        throw new EnrollmentError(
          'CONTEXT_MISMATCH',
          `Edge mismatch: token issued for edge '${token.edge_id}', received '${params.edgeId}'`,
        );
      }

      // 6. Atomic one-time update (CAS guard: WHERE consumed_at IS NULL)
      const updateResult = this.#dbService.run(
        `UPDATE enrollment_tokens
         SET consumed_at = ?, station_id = ?
         WHERE pairing_id = ? AND consumed_at IS NULL`,
        [now, params.stationId, params.pairingId],
      );

      if (updateResult.changes !== 1) {
        throw new EnrollmentError(
          'CONCURRENT_CONSUMPTION_CONFLICT',
          `Simultaneous consumption race detected on token '${params.pairingId}'. Operation aborted.`,
        );
      }

      // 7. Store station credentials
      const tokenHash = hashSha256(params.stationToken);
      this.#dbService.run(
        `INSERT INTO station_credentials (
          station_id, branch_id, station_code, station_type, station_public_key, station_token_hash, enrolled_at, is_revoked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          params.stationId,
          params.branchId,
          params.stationCode,
          params.stationType,
          params.stationPublicKey,
          tokenHash,
          now,
        ],
      );

      return Object.freeze({
        stationId: params.stationId,
        branchId: params.branchId,
        stationCode: params.stationCode,
        stationType: params.stationType,
        stationPublicKey: params.stationPublicKey,
        stationTokenHash: tokenHash,
        enrolledAt: now,
        isRevoked: false,
      });
    });
  }

  /**
   * Retrieves station credentials by stationId.
   */
  public getStationCredentials(stationId: string): StationCredentials | null {
    const rows = this.#dbService.query<{
      station_id: string;
      branch_id: string;
      station_code: string;
      station_type: StationType;
      station_public_key: string;
      station_token_hash: string;
      enrolled_at: number;
      is_revoked: number;
    }>(
      `SELECT station_id, branch_id, station_code, station_type, station_public_key, station_token_hash, enrolled_at, is_revoked
       FROM station_credentials
       WHERE station_id = ?`,
      [stationId],
    );

    const r = rows[0];
    if (!r) {
      return null;
    }

    return Object.freeze({
      stationId: r.station_id,
      branchId: r.branch_id,
      stationCode: r.station_code,
      stationType: r.station_type,
      stationPublicKey: r.station_public_key,
      stationTokenHash: r.station_token_hash,
      enrolledAt: r.enrolled_at,
      isRevoked: r.is_revoked !== 0,
    });
  }

  /**
   * Checks whether a pairing token exists and if it is consumed.
   */
  public getTokenState(pairingId: string): {
    exists: boolean;
    isConsumed: boolean;
    isExpired: boolean;
  } {
    const rows = this.#dbService.query<{
      expires_at: number;
      consumed_at: number | null;
    }>(`SELECT expires_at, consumed_at FROM enrollment_tokens WHERE pairing_id = ?`, [pairingId]);

    const row = rows[0];
    if (!row) {
      return { exists: false, isConsumed: false, isExpired: false };
    }

    const now = this.#clock.nowSeconds();
    return {
      exists: true,
      isConsumed: row.consumed_at !== null,
      isExpired: now >= row.expires_at,
    };
  }
}
