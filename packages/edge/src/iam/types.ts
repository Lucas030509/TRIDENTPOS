/**
 * TRIDENTPOS Edge Offline IAM Domain Types & Errors
 * Conforms to IAM_SECURITY_MODEL.md Sec. 3, 4 and SECURITY_ARCHITECTURE.md Sec. 3.
 */

export interface CachedUserRecord {
  readonly userId: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly pinHash: string;
  readonly rolesJson: string;
  readonly credentialVersion: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly isRevoked: number;
}

export interface CachedUserInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly pinHash: string;
  readonly roles: string[];
  readonly credentialVersion: number;
  readonly issuedAt: string | number;
  readonly expiresAt: string | number;
  readonly isRevoked?: number;
}

export interface StationSessionRecord {
  readonly sessionId: string;
  readonly sessionTokenHash: string;
  readonly stationId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly rolesJson: string;
  readonly activeRole: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly isRevoked: number;
  readonly revokedAt: number | null;
  readonly createdAt: number;
}

export interface StationLockoutStateRecord {
  readonly stationId: string;
  readonly consecutiveFailures: number;
  readonly lockedUntil: number | null;
  readonly lastFailedAt: number | null;
  readonly updatedAt: number;
}

export interface PinAuthRequest {
  readonly stationId: string;
  readonly userId: string;
  readonly pin: string;
  readonly activeRole?: string;
}

export interface PinAuthSuccessResponse {
  readonly success: true;
  readonly token: string;
  readonly session: {
    readonly sessionId: string;
    readonly stationId: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly branchId: string;
    readonly roles: string[];
    readonly activeRole: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
  };
}

export interface SupervisorUnlockRequest {
  readonly stationId: string;
  readonly supervisorUserId: string;
  readonly supervisorPin: string;
  readonly reason: string;
}

export interface SupervisorUnlockResponse {
  readonly success: true;
  readonly stationId: string;
  readonly unlockedByUserId: string;
  readonly unlockedAt: number;
}

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

export type OfflineIamErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PIN_FORMAT'
  | 'STATION_NOT_FOUND'
  | 'STATION_REVOKED'
  | 'STATION_LOCKED'
  | 'USER_NOT_CACHED'
  | 'USER_REVOKED'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_CORRUPT'
  | 'CREDENTIAL_FUTURE_TIMESTAMP'
  | 'AUTHENTICATION_FAILED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'SESSION_STATION_MISMATCH'
  | 'CLOCK_ROLLBACK_LOCKED'
  | 'INTERNAL_ERROR';

export class OfflineIamError extends Error {
  public readonly code: OfflineIamErrorCode;
  public readonly retryAfterSeconds?: number;

  constructor(code: OfflineIamErrorCode, message: string, retryAfterSeconds?: number) {
    super(`OFFLINE_IAM_ERROR [${code}]: ${message}`);
    this.name = 'OfflineIamError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
