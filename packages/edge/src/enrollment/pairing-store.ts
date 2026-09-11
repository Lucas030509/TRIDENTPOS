/**
 * TRIDENTPOS Edge Pairing Store and Station Token Signer
 * Implements HMAC key management (exact 32 bytes CSPRNG), token signing before DB transaction,
 * and atomic station enrollment per ACR-2026-011 and IAM_SECURITY_MODEL.md Sec. 4 & 5.
 */

import crypto from 'node:crypto';
import { EdgeSecureStore } from './secure-store.js';
import { TrustedTimeManager } from './trusted-time.js';
import { EnrollmentPersistence } from '../db/enrollment-persistence.js';
import {
  generatePairingId,
  generatePairingSecret,
  hashSha256,
  signStationToken,
  validateHmacKeyLength,
  verifyStationToken,
  StationTokenClaims,
} from './crypto.js';
import {
  EnrollmentQRPayload,
  StationEnrollmentRequest,
  StationEnrollmentResponse,
} from './types.js';

export interface EdgePairingStoreOptions {
  readonly organizationId: string;
  readonly branchId: string;
  readonly edgeId: string;
  readonly edgePublicKeyFingerprint: string;
  readonly secureStore: EdgeSecureStore;
  readonly persistence: EnrollmentPersistence;
  readonly trustedTimeManager: TrustedTimeManager;
  readonly defaultPairingTtlSeconds?: number;
}

export class EdgePairingStore {
  readonly #organizationId: string;
  readonly #branchId: string;
  readonly #edgeId: string;
  readonly #edgePublicKeyFingerprint: string;
  readonly #secureStore: EdgeSecureStore;
  readonly #persistence: EnrollmentPersistence;
  readonly #trustedTimeManager: TrustedTimeManager;
  readonly #defaultTtlSeconds: number;

  #activeHmacKey: Buffer;
  #previousHmacKey: Buffer | null = null;
  #previousHmacKeyExpiresAt: number | null = null;

  constructor(options: EdgePairingStoreOptions) {
    this.#organizationId = options.organizationId;
    this.#branchId = options.branchId;
    this.#edgeId = options.edgeId;
    this.#edgePublicKeyFingerprint = options.edgePublicKeyFingerprint;
    this.#secureStore = options.secureStore;
    this.#persistence = options.persistence;
    this.#trustedTimeManager = options.trustedTimeManager;
    this.#defaultTtlSeconds = Math.min(options.defaultPairingTtlSeconds ?? 600, 600);

    this.#activeHmacKey = this.#loadOrGenerateHmacKey();
  }

  #loadOrGenerateHmacKey(): Buffer {
    const keyName = 'station_token_hmac_key';
    if (this.#secureStore.hasSecret(keyName)) {
      const key = this.#secureStore.loadSecret(keyName);
      validateHmacKeyLength(key);
      return key;
    }

    // Generate fresh exact 32-byte key
    const newKey = crypto.randomBytes(32);
    validateHmacKeyLength(newKey);
    this.#secureStore.storeSecret(keyName, newKey);
    return newKey;
  }

  /**
   * Rotates the station token HMAC key with 12-hour grace period retention for previous key.
   * Supervised emergency invalidation can purge previous key immediately.
   */
  public rotateHmacKey(options: { emergencyImmediateInvalidation?: boolean } = {}): void {
    const effectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
    const newKey = crypto.randomBytes(32);
    validateHmacKeyLength(newKey);

    if (options.emergencyImmediateInvalidation) {
      this.#previousHmacKey = null;
      this.#previousHmacKeyExpiresAt = null;
    } else {
      this.#previousHmacKey = this.#activeHmacKey;
      this.#previousHmacKeyExpiresAt = effectiveTime + 43200; // 12 hours
    }

    this.#activeHmacKey = newKey;
    this.#secureStore.storeSecret('station_token_hmac_key', newKey);
  }

  /**
   * Internal verification of station token using active and retained previous keys.
   */
  public verifyStationToken(token: string): StationTokenClaims {
    const effectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
    let prevKeyToUse: Buffer | null = null;

    if (this.#previousHmacKey && this.#previousHmacKeyExpiresAt !== null) {
      if (effectiveTime <= this.#previousHmacKeyExpiresAt) {
        prevKeyToUse = this.#previousHmacKey;
      } else {
        // Expired previous key purged
        this.#previousHmacKey = null;
        this.#previousHmacKeyExpiresAt = null;
      }
    }

    return verifyStationToken(token, this.#activeHmacKey, prevKeyToUse, effectiveTime);
  }

  /**
   * Generates a new ephemeral QR pairing payload.
   * Conforms to: { branchId, edgeId, edgePublicKeyFingerprint, pairingId, expiresAt, pairingSecret }.
   * Timestamps strictly in UNIX epoch seconds.
   */
  public createPairingPayload(customTtlSeconds?: number): EnrollmentQRPayload {
    const trustedEffectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
    const ttl = Math.min(customTtlSeconds ?? this.#defaultTtlSeconds, 600);
    const expiresAt = trustedEffectiveTime + ttl;

    const pairingId = generatePairingId();
    const pairingSecret = generatePairingSecret();
    const secretHash = hashSha256(pairingSecret);

    this.#persistence.savePairingToken({
      pairingId,
      organizationId: this.#organizationId,
      branchId: this.#branchId,
      edgeId: this.#edgeId,
      secretHash,
      expiresAt,
      createdAt: trustedEffectiveTime,
    });

    return {
      branchId: this.#branchId,
      edgeId: this.#edgeId,
      edgePublicKeyFingerprint: this.#edgePublicKeyFingerprint,
      pairingId,
      expiresAt,
      pairingSecret,
    };
  }

  /**
   * Enrolls a station:
   * 1. Evaluates trusted time (fails closed if clock rollback detected).
   * 2. Builds and signs Station Token (HS256, 12h TTL) in memory BEFORE database transaction.
   * 3. Executes atomic SQLite WAL transaction: CAS token consumption + credential insertion + forensic audit.
   * 4. Returns StationEnrollmentResponse.
   */
  public enrollStation(request: StationEnrollmentRequest): StationEnrollmentResponse {
    const trustedEffectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
    const tokenLifetimeSeconds = 43200; // 12 hours
    const tokenExpiresAt = trustedEffectiveTime + tokenLifetimeSeconds;

    // 1. Prepare and sign Station Token in memory PRE-TRANSACTION
    const claims: StationTokenClaims = {
      sub: request.stationId,
      org_id: request.organizationId,
      branch_id: request.branchId,
      edge_id: request.edgeId,
      station_code: request.stationCode,
      station_type: request.stationType,
      iat: trustedEffectiveTime,
      exp: tokenExpiresAt,
    };

    // If signing fails (e.g. invalid key length), throws before any DB interaction
    const stationToken = signStationToken(claims, this.#activeHmacKey);

    // 2. Execute atomic database transaction (DATA-INV-WP009-01)
    const auditEventId = crypto.randomUUID();
    this.#persistence.executeAtomicEnrollment(request, trustedEffectiveTime, auditEventId);

    // 3. Return response
    return {
      success: true,
      stationToken,
      tokenType: 'Bearer',
      expiresIn: tokenLifetimeSeconds,
      issuedAt: trustedEffectiveTime,
      stationId: request.stationId,
    };
  }
}
