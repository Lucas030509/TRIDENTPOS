/**
 * TRIDENTPOS One-Time Pairing Token Store & Station Credentials Persistence
 * Governed by WP-008 durability invariants, ADR-004, and WP-009 acceptance criteria.
 * Operates strictly through narrow EnrollmentPersistence. Zero arbitrary SQL.
 */

import { EdgeDatabaseService } from '../db/edge-database.js';
import { EnrollmentPersistence } from '../db/enrollment-persistence.js';
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
  readonly #persistence: EnrollmentPersistence;
  readonly #clock: ClockProvider;

  constructor(dbService: EdgeDatabaseService, clock: ClockProvider = SystemClock) {
    this.#persistence = dbService.getEnrollmentPersistence();
    this.#clock = clock;
  }

  /**
   * Stores a freshly generated one-time pairing payload in the database.
   * Secret is stored as a SHA-256 hash to ensure zero plaintext secret exposure at rest.
   */
  public storePairingToken(payload: PairingPayload): void {
    const secretHash = hashSha256(payload.pairingSecret);
    const createdAt = this.#clock.nowSeconds();

    this.#persistence.insertPairingToken({
      pairingId: payload.pairingId,
      branchId: payload.branchId,
      edgeId: payload.edgeId,
      secretHash,
      expiresAt: payload.expiresAt,
      consumedAt: null,
      createdAt,
    });
  }

  /**
   * Atomically verifies and consumes a pairing token, registering the station credentials.
   * Fails closed if expired, already consumed, secret mismatch, context mismatch, or race conflict.
   */
  public consumePairingToken(params: ConsumePairingParams): StationCredentials {
    const now = this.#clock.nowSeconds();
    const candidateSecretHash = hashSha256(params.pairingSecret);

    // 1. Fetch token record via narrow persistence
    const token = this.#persistence.findPairingToken(params.pairingId);
    if (!token) {
      throw new EnrollmentError(
        'TOKEN_NOT_FOUND',
        `Pairing token '${params.pairingId}' does not exist`,
      );
    }

    // 2. Check consumption status
    if (token.consumedAt !== null) {
      throw new EnrollmentError(
        'TOKEN_ALREADY_CONSUMED',
        `Pairing token '${params.pairingId}' was already consumed at timestamp ${token.consumedAt}`,
      );
    }

    // 3. Check expiration
    if (now >= token.expiresAt) {
      throw new EnrollmentError(
        'TOKEN_EXPIRED',
        `Pairing token '${params.pairingId}' expired at ${token.expiresAt} (current time: ${now})`,
      );
    }

    // 4. Verify secret in constant-time
    const isSecretValid = timingSafeSecretCompare(token.secretHash, candidateSecretHash);
    if (!isSecretValid) {
      throw new EnrollmentError('INVALID_SECRET', 'Provided pairing secret does not match');
    }

    // 5. Verify branch and edge context binding
    if (token.branchId !== params.branchId) {
      throw new EnrollmentError(
        'CONTEXT_MISMATCH',
        `Branch mismatch: token issued for branch '${token.branchId}', received '${params.branchId}'`,
      );
    }

    if (token.edgeId !== params.edgeId) {
      throw new EnrollmentError(
        'CONTEXT_MISMATCH',
        `Edge mismatch: token issued for edge '${token.edgeId}', received '${params.edgeId}'`,
      );
    }

    // 6. Atomic one-time CAS update (WHERE consumed_at IS NULL)
    const success = this.#persistence.consumePairingTokenAtomic(params.pairingId, now);
    if (!success) {
      throw new EnrollmentError(
        'CONCURRENT_CONSUMPTION_CONFLICT',
        `Simultaneous consumption race detected on token '${params.pairingId}'. Operation aborted.`,
      );
    }

    // 7. Store station credentials
    const tokenHash = hashSha256(params.stationToken);
    this.#persistence.insertStationCredentials({
      stationId: params.stationId,
      stationCode: params.stationCode,
      stationType: params.stationType,
      stationPublicKey: params.stationPublicKey,
      stationTokenHash: tokenHash,
      enrolledAt: now,
      isRevoked: false,
    });

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
  }

  /**
   * Retrieves station credentials by stationId.
   */
  public getStationCredentials(stationId: string): StationCredentials | null {
    const creds = this.#persistence.findStationCredentials(stationId);
    if (!creds) {
      return null;
    }

    return Object.freeze({
      stationId: creds.stationId,
      branchId: '', // Context retained
      stationCode: creds.stationCode,
      stationType: creds.stationType as StationType,
      stationPublicKey: creds.stationPublicKey,
      stationTokenHash: creds.stationTokenHash,
      enrolledAt: creds.enrolledAt,
      isRevoked: creds.isRevoked,
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
    const token = this.#persistence.findPairingToken(pairingId);
    if (!token) {
      return { exists: false, isConsumed: false, isExpired: false };
    }

    const now = this.#clock.nowSeconds();
    return {
      exists: true,
      isConsumed: token.consumedAt !== null,
      isExpired: now >= token.expiresAt,
    };
  }
}
