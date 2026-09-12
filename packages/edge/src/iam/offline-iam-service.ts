/**
 * TRIDENTPOS Edge Offline IAM & Floor PIN Authentication Engine
 * Conforms to IAM_SECURITY_MODEL.md Sec. 3, 4, SECURITY_ARCHITECTURE.md Sec. 3, and WP-010.
 *
 * Core Guarantees:
 * 1. Plaintext PIN accepted only transiently in memory, NEVER persisted or logged.
 * 2. RFC 9106 baseline Argon2id PIN verification.
 * 3. Atomic progressive delay and 5-minute lockout at 5th failure.
 * 4. 12-hour session tokens strictly bound to enrolled station identity.
 * 5. Clock rollback protection inherited from TrustedTimeManager.
 * 6. Expired, revoked, or corrupt cached credentials fail closed.
 */

import crypto from 'node:crypto';
import { isValidUuid, validatePinFormat, verifyBranchPin } from '@trident/core';
import { EdgeDatabaseService } from '../db/edge-database.js';
import { IamPersistence } from '../db/iam-persistence.js';
import { EdgeSecureStore } from '../enrollment/secure-store.js';
import { TrustedTimeManager } from '../enrollment/trusted-time.js';
import { LockoutManager } from './lockout-manager.js';
import {
  computeSessionTokenHash,
  SESSION_TOKEN_TTL_SECONDS,
  signFloorSessionToken,
  verifyFloorSessionToken,
} from './session-token.js';
import {
  CachedUserInput,
  CachedUserRecord,
  OfflineIamError,
  PinAuthRequest,
  PinAuthSuccessResponse,
  StationSessionRecord,
  SupervisorUnlockRequest,
  SupervisorUnlockResponse,
} from './types.js';

export interface OfflineIamServiceOptions {
  readonly edgeDb: EdgeDatabaseService;
  readonly secureStore: EdgeSecureStore;
  readonly trustedTimeManager: TrustedTimeManager;
  readonly edgeId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly persistence?: IamPersistence;
  readonly lockoutManager?: LockoutManager;
  readonly logger?: (msg: string) => void;
}

export class OfflineIamService {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #secureStore: EdgeSecureStore;
  readonly #trustedTimeManager: TrustedTimeManager;
  readonly #edgeId: string;
  readonly #organizationId: string;
  readonly #branchId: string;
  readonly #persistence: IamPersistence;
  readonly #lockoutManager: LockoutManager;
  readonly #logger?: (msg: string) => void;

  constructor(options: OfflineIamServiceOptions) {
    this.#edgeDb = options.edgeDb;
    this.#secureStore = options.secureStore;
    this.#trustedTimeManager = options.trustedTimeManager;
    this.#edgeId = options.edgeId;
    this.#organizationId = options.organizationId;
    this.#branchId = options.branchId;
    this.#logger = options.logger;

    this.#persistence = options.persistence ?? new IamPersistence(this.#edgeDb);
    this.#lockoutManager = options.lockoutManager ?? new LockoutManager(this.#persistence);

    this.#ensureHmacKey();
  }

  #ensureHmacKey(): void {
    if (!this.#secureStore.hasSecret('station_token_hmac_key')) {
      const key = crypto.randomBytes(32);
      this.#secureStore.storeSecret('station_token_hmac_key', key);
    }
  }

  #getPrimaryHmacKey(): Buffer {
    return this.#secureStore.loadSecret('station_token_hmac_key');
  }

  #getPreviousHmacKey(): Buffer | null {
    if (this.#secureStore.hasSecret('station_token_hmac_key_previous')) {
      try {
        return this.#secureStore.loadSecret('station_token_hmac_key_previous');
      } catch {
        return null;
      }
    }
    return null;
  }

  #parseTimestampSeconds(val: string | number): number {
    if (typeof val === 'number') {
      return val > 1e11 ? Math.floor(val / 1000) : Math.floor(val);
    }
    // Check if numeric string
    if (/^\d+$/.test(val)) {
      const num = Number(val);
      return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    }
    // Parse ISO string
    const parsed = Date.parse(val);
    if (isNaN(parsed)) {
      throw new OfflineIamError('CREDENTIAL_CORRUPT', `Invalid timestamp format: ${val}`);
    }
    return Math.floor(parsed / 1000);
  }

  // -------------------------------------------------------------------------
  // PIN Authentication Core Flow
  // -------------------------------------------------------------------------

  public async authenticateWithPin(request: PinAuthRequest): Promise<PinAuthSuccessResponse> {
    // 1. Input Validation (UUID syntax)
    if (!request.stationId || !isValidUuid(request.stationId)) {
      throw new OfflineIamError('INVALID_INPUT', 'Malformed or missing stationId UUID');
    }
    if (!request.userId || !isValidUuid(request.userId)) {
      throw new OfflineIamError('INVALID_INPUT', 'Malformed or missing userId UUID');
    }

    // 2. Clock Rollback & Trusted Time Enforcement
    if (this.#trustedTimeManager.isLocked()) {
      throw new OfflineIamError(
        'CLOCK_ROLLBACK_LOCKED',
        'Authentication blocked: system is CLOCK_ROLLBACK_LOCKED',
      );
    }

    let now: number;
    try {
      now = this.#trustedTimeManager.getTrustedEffectiveTime();
    } catch (err) {
      throw new OfflineIamError('CLOCK_ROLLBACK_LOCKED', (err as Error).message);
    }

    // 3. Station Identity Verification (Bound strictly to enrolled device)
    const station = this.#persistence.getStationCredential(request.stationId);
    if (!station) {
      throw new OfflineIamError('STATION_NOT_FOUND', 'Station is not enrolled or recognized');
    }
    if (station.isRevoked === 1) {
      throw new OfflineIamError('STATION_REVOKED', 'Station identity has been revoked');
    }
    if (station.branchId !== this.#branchId || station.organizationId !== this.#organizationId) {
      throw new OfflineIamError(
        'STATION_NOT_FOUND',
        'Station does not belong to this branch context',
      );
    }

    // 4. Station Lockout Verification (Fail closed if locked)
    const lockoutCheck = this.#lockoutManager.checkLockout(request.stationId, now);
    if (lockoutCheck.isLocked) {
      throw new OfflineIamError(
        'STATION_LOCKED',
        `Station is locked due to repeated failed attempts. Try again in ${lockoutCheck.remainingSeconds} seconds`,
        lockoutCheck.remainingSeconds,
      );
    }

    // 5. PIN Format Validation
    const pinValidation = validatePinFormat(request.pin);
    if (!pinValidation.ok) {
      throw new OfflineIamError('INVALID_PIN_FORMAT', pinValidation.error.message);
    }

    // 5. Cached User Lookup & Invalidation / Integrity Checks
    const user = this.#persistence.getCachedUser(request.userId);
    if (!user) {
      // Record failure on station to protect against enumeration attacks
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError('USER_NOT_CACHED', 'User credentials not found in offline cache');
    }

    if (user.organizationId !== this.#organizationId) {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError('USER_NOT_CACHED', 'User does not belong to this organization');
    }

    if (user.isRevoked === 1) {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError('USER_REVOKED', 'Cached user account has been revoked');
    }

    // Parse and validate cache expiration
    let expiresAtSec: number;
    let issuedAtSec: number;
    try {
      expiresAtSec = this.#parseTimestampSeconds(user.expiresAt);
      issuedAtSec = this.#parseTimestampSeconds(user.issuedAt);
    } catch {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError('CREDENTIAL_CORRUPT', 'Malformed cache credential timestamps');
    }

    if (expiresAtSec <= now) {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError(
        'CREDENTIAL_EXPIRED',
        `Cached credentials expired at ${expiresAtSec} (current trusted time: ${now})`,
      );
    }

    if (issuedAtSec > now + 300) {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError(
        'CREDENTIAL_FUTURE_TIMESTAMP',
        `Cached credential issuedAt is in the future (${issuedAtSec} > ${now})`,
      );
    }

    if (!user.pinHash || !user.pinHash.startsWith('$argon2id$')) {
      this.#lockoutManager.recordFailure(request.stationId, now);
      throw new OfflineIamError(
        'CREDENTIAL_CORRUPT',
        'Corrupted cached PIN hash: non-Argon2id format',
      );
    }

    // 6. Argon2id PIN Verification
    const verifyResult = await verifyBranchPin(user.pinHash, request.pin);
    const pinMatches = verifyResult.ok && verifyResult.value === true;

    if (!pinMatches) {
      // Failed attempt: update lockout state
      const failureEval = this.#lockoutManager.recordFailure(request.stationId, now);

      // Trigger audit event if lockout occurred
      if (failureEval.isNewLockout) {
        this.#persistence.appendAuditEvent({
          eventId: crypto.randomUUID(),
          organizationId: this.#organizationId,
          branchId: this.#branchId,
          edgeId: this.#edgeId,
          stationId: request.stationId,
          eventType: 'PinBruteForceAttemptDetected',
          severity: 'CRITICAL',
          action: 'STATION_LOCKOUT',
          metadata: {
            stationId: request.stationId,
            consecutiveFailures: failureEval.consecutiveFailures,
            lockedUntil: failureEval.lockedUntil,
          },
          createdAt: now,
        });
      }

      // Enforce progressive delay if applicable
      if (failureEval.delayMs > 0) {
        await new Promise((res) => setTimeout(res, failureEval.delayMs));
      }

      if (failureEval.isLocked) {
        throw new OfflineIamError(
          'STATION_LOCKED',
          `Station locked due to repeated failed PIN attempts. Remaining: ${failureEval.remainingSeconds}s`,
          failureEval.remainingSeconds,
        );
      }

      throw new OfflineIamError('AUTHENTICATION_FAILED', 'Invalid PIN credentials');
    }

    // 7. Successful Authentication Flow
    // Reset lockout counters on success
    this.#lockoutManager.recordSuccess(request.stationId, now);

    let roles: string[];
    try {
      roles = JSON.parse(user.rolesJson);
      if (!Array.isArray(roles)) roles = ['STAFF'];
    } catch {
      roles = ['STAFF'];
    }

    // Determine active role
    let activeRole = roles[0] ?? 'STAFF';
    if (request.activeRole && roles.includes(request.activeRole)) {
      activeRole = request.activeRole;
    }

    const sessionId = crypto.randomUUID();
    const sessionExpiresAt = now + SESSION_TOKEN_TTL_SECONDS;

    const tokenClaims = {
      sub: user.userId,
      station_id: request.stationId,
      org_id: this.#organizationId,
      branch_id: this.#branchId,
      session_id: sessionId,
      roles,
      active_role: activeRole,
      iat: now,
      exp: sessionExpiresAt,
    };

    const primaryKey = this.#getPrimaryHmacKey();
    const sessionToken = signFloorSessionToken(tokenClaims, primaryKey);
    const sessionTokenHash = computeSessionTokenHash(sessionToken);

    // 8. Atomic Session & Audit Commitment in SQLite WAL
    const { session } = this.#persistence.createSessionWithAudit(
      {
        sessionId,
        sessionTokenHash,
        stationId: request.stationId,
        userId: user.userId,
        organizationId: this.#organizationId,
        branchId: this.#branchId,
        roles,
        activeRole,
        issuedAt: now,
        expiresAt: sessionExpiresAt,
        createdAt: now,
      },
      {
        eventId: crypto.randomUUID(),
        edgeId: this.#edgeId,
        eventType: 'FloorUserAuthenticated',
        severity: 'INFO',
        action: 'LOGIN_SUCCESS',
        metadata: {
          sessionId,
          stationId: request.stationId,
          userId: user.userId,
          activeRole,
        },
      },
    );

    return {
      success: true,
      token: sessionToken,
      session: {
        sessionId: session.sessionId,
        stationId: session.stationId,
        userId: session.userId,
        organizationId: session.organizationId,
        branchId: session.branchId,
        roles,
        activeRole: session.activeRole,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Session Token Verification
  // -------------------------------------------------------------------------

  public verifySession(sessionToken: string, stationId: string): StationSessionRecord {
    let now: number;
    try {
      now = this.#trustedTimeManager.getTrustedEffectiveTime();
    } catch (err) {
      throw new OfflineIamError('CLOCK_ROLLBACK_LOCKED', (err as Error).message);
    }

    const primaryKey = this.#getPrimaryHmacKey();
    const previousKey = this.#getPreviousHmacKey();

    const claims = verifyFloorSessionToken(sessionToken, primaryKey, previousKey, now);

    // Strict Station-Session Binding: must match expected stationId
    if (claims.station_id !== stationId) {
      throw new OfflineIamError(
        'SESSION_STATION_MISMATCH',
        `Session station mismatch: token bound to '${claims.station_id}', presented by '${stationId}'`,
      );
    }

    const tokenHash = computeSessionTokenHash(sessionToken);
    const sessionRecord = this.#persistence.getStationSessionByTokenHash(tokenHash);
    if (!sessionRecord) {
      throw new OfflineIamError('SESSION_NOT_FOUND', 'Active session record not found');
    }

    if (sessionRecord.isRevoked === 1) {
      throw new OfflineIamError('SESSION_REVOKED', 'Session has been revoked');
    }

    if (sessionRecord.expiresAt <= now) {
      throw new OfflineIamError('SESSION_EXPIRED', 'Session has expired');
    }

    return sessionRecord;
  }

  public revokeSession(sessionId: string): void {
    const now = this.#trustedTimeManager.getTrustedEffectiveTime();
    this.#persistence.revokeStationSession(sessionId, now);
  }

  // -------------------------------------------------------------------------
  // Supervisor Unlock Override Flow
  // -------------------------------------------------------------------------

  public async supervisorUnlockStation(
    request: SupervisorUnlockRequest,
  ): Promise<SupervisorUnlockResponse> {
    if (!request.stationId || !isValidUuid(request.stationId)) {
      throw new OfflineIamError('INVALID_INPUT', 'Malformed or missing stationId UUID');
    }
    if (!request.supervisorUserId || !isValidUuid(request.supervisorUserId)) {
      throw new OfflineIamError('INVALID_INPUT', 'Malformed or missing supervisorUserId UUID');
    }

    const now = this.#trustedTimeManager.getTrustedEffectiveTime();

    const supervisor = this.#persistence.getCachedUser(request.supervisorUserId);
    if (!supervisor || supervisor.isRevoked === 1) {
      throw new OfflineIamError(
        'AUTHENTICATION_FAILED',
        'Supervisor not found or revoked in offline cache',
      );
    }

    let roles: string[];
    try {
      roles = JSON.parse(supervisor.rolesJson);
    } catch {
      roles = [];
    }

    const isSupervisor =
      roles.includes('SUPERVISOR') || roles.includes('ADMIN') || roles.includes('MANAGER');
    if (!isSupervisor) {
      throw new OfflineIamError(
        'INSUFFICIENT_PERMISSIONS',
        'User lacks supervisor privileges required for lockout unlock',
      );
    }

    const verifyResult = await verifyBranchPin(supervisor.pinHash, request.supervisorPin);
    if (!verifyResult.ok || !verifyResult.value) {
      throw new OfflineIamError('AUTHENTICATION_FAILED', 'Invalid supervisor PIN');
    }

    // Unlock station
    this.#lockoutManager.unlock(request.stationId, now);

    // Append supervisor audit record
    this.#persistence.appendAuditEvent({
      eventId: crypto.randomUUID(),
      organizationId: this.#organizationId,
      branchId: this.#branchId,
      edgeId: this.#edgeId,
      stationId: request.stationId,
      eventType: 'StationUnlockedBySupervisor',
      severity: 'WARN',
      action: 'SUPERVISOR_UNLOCK',
      metadata: {
        stationId: request.stationId,
        unlockedByUserId: request.supervisorUserId,
        reason: request.reason,
      },
      createdAt: now,
    });

    return {
      success: true,
      stationId: request.stationId,
      unlockedByUserId: request.supervisorUserId,
      unlockedAt: now,
    };
  }

  // -------------------------------------------------------------------------
  // Cache Administration
  // -------------------------------------------------------------------------

  public cacheUser(user: CachedUserInput): void {
    this.#persistence.upsertCachedUser(user);
  }

  public invalidateUser(userId: string): void {
    this.#persistence.invalidateCachedUser(userId);
  }

  public getCachedUser(userId: string): CachedUserRecord | null {
    return this.#persistence.getCachedUser(userId);
  }

  public getPersistence(): IamPersistence {
    return this.#persistence;
  }

  public getLockoutManager(): LockoutManager {
    return this.#lockoutManager;
  }
}
