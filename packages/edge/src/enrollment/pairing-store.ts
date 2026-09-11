/**
 * TRIDENTPOS Edge Pairing Store and Station Token Signer
 * Implements HMAC key management (exact 32 bytes CSPRNG), token signing before DB transaction,
 * and atomic station enrollment per ACR-2026-011, IAM_SECURITY_MODEL.md Sec. 4 & 5,
 * and QI-IAM-04 (persistent active and previous HMAC verification key across process restarts).
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

interface HmacKeyMetadata {
  activeKeyVersion: number;
  previousKeyVersion: number | null;
  previousKeyExpiresAt: number | null;
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

  #activeHmacKey!: Buffer;
  #activeKeyVersion = 1;
  #previousHmacKey: Buffer | null = null;
  #previousKeyVersion: number | null = null;
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

    this.#loadOrInitializeHmacKeys();
  }

  #loadOrInitializeHmacKeys(): void {
    const activeKeySecret = 'station_token_hmac_active_key';
    const previousKeySecret = 'station_token_hmac_previous_key';
    const metadataSecret = 'station_token_hmac_metadata';

    if (this.#secureStore.hasSecret(activeKeySecret)) {
      this.#activeHmacKey = this.#secureStore.loadSecret(activeKeySecret);
      validateHmacKeyLength(this.#activeHmacKey);

      if (this.#secureStore.hasSecret(metadataSecret)) {
        try {
          const meta = JSON.parse(
            this.#secureStore.loadSecret(metadataSecret).toString('utf8'),
          ) as HmacKeyMetadata;
          this.#activeKeyVersion =
            typeof meta.activeKeyVersion === 'number' ? meta.activeKeyVersion : 1;

          let effectiveTime: number;
          try {
            effectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
          } catch {
            effectiveTime = Math.floor(Date.now() / 1000);
          }

          if (
            meta.previousKeyExpiresAt !== null &&
            typeof meta.previousKeyExpiresAt === 'number' &&
            effectiveTime <= meta.previousKeyExpiresAt
          ) {
            if (this.#secureStore.hasSecret(previousKeySecret)) {
              this.#previousHmacKey = this.#secureStore.loadSecret(previousKeySecret);
              validateHmacKeyLength(this.#previousHmacKey);
              this.#previousHmacKeyExpiresAt = meta.previousKeyExpiresAt;
              this.#previousKeyVersion = meta.previousKeyVersion;
            }
          } else {
            // Expired or none: securely purge previous key
            if (this.#secureStore.hasSecret(previousKeySecret)) {
              this.#secureStore.deleteSecret(previousKeySecret);
            }
            this.#previousHmacKey = null;
            this.#previousHmacKeyExpiresAt = null;
            this.#previousKeyVersion = null;
            this.#saveMetadata();
          }
        } catch {
          this.#activeKeyVersion = 1;
        }
      }
      return;
    }

    // Fresh first bootstrap: generate initial exact 32-byte key
    const newKey = crypto.randomBytes(32);
    validateHmacKeyLength(newKey);
    this.#activeHmacKey = newKey;
    this.#activeKeyVersion = 1;
    this.#previousHmacKey = null;
    this.#previousHmacKeyExpiresAt = null;
    this.#previousKeyVersion = null;

    this.#secureStore.storeSecret(activeKeySecret, newKey);
    this.#saveMetadata();
  }

  #saveMetadata(): void {
    const payload: HmacKeyMetadata = {
      activeKeyVersion: this.#activeKeyVersion,
      previousKeyVersion: this.#previousKeyVersion,
      previousKeyExpiresAt: this.#previousHmacKeyExpiresAt,
    };
    this.#secureStore.storeSecret(
      'station_token_hmac_metadata',
      Buffer.from(JSON.stringify(payload), 'utf8'),
    );
  }

  public getActiveKeyVersion(): number {
    return this.#activeKeyVersion;
  }

  public getPreviousKeyVersion(): number | null {
    return this.#previousKeyVersion;
  }

  public getPreviousKeyExpiresAt(): number | null {
    return this.#previousHmacKeyExpiresAt;
  }

  /**
   * Rotates the station token HMAC key with 12-hour grace period retention for previous key.
   * Both active and previous keys, along with version and expiry metadata, are persisted in EdgeSecureStore.
   * Supervised emergency invalidation purges previous key immediately from memory and storage.
   */
  public rotateHmacKey(options: { emergencyImmediateInvalidation?: boolean } = {}): void {
    const effectiveTime = this.#trustedTimeManager.getTrustedEffectiveTime();
    const newKey = crypto.randomBytes(32);
    validateHmacKeyLength(newKey);

    const previousKeySecret = 'station_token_hmac_previous_key';

    if (options.emergencyImmediateInvalidation) {
      this.#previousHmacKey = null;
      this.#previousHmacKeyExpiresAt = null;
      this.#previousKeyVersion = null;
      if (this.#secureStore.hasSecret(previousKeySecret)) {
        this.#secureStore.deleteSecret(previousKeySecret);
      }
    } else {
      this.#previousHmacKey = this.#activeHmacKey;
      this.#previousKeyVersion = this.#activeKeyVersion;
      this.#previousHmacKeyExpiresAt = effectiveTime + 43200; // 12 hours
      this.#secureStore.storeSecret(previousKeySecret, this.#previousHmacKey);
    }

    this.#activeHmacKey = newKey;
    this.#activeKeyVersion += 1;
    this.#secureStore.storeSecret('station_token_hmac_active_key', newKey);
    this.#saveMetadata();
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
        // Expired previous key securely purged
        this.#previousHmacKey = null;
        this.#previousHmacKeyExpiresAt = null;
        this.#previousKeyVersion = null;
        if (this.#secureStore.hasSecret('station_token_hmac_previous_key')) {
          this.#secureStore.deleteSecret('station_token_hmac_previous_key');
        }
        this.#saveMetadata();
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
