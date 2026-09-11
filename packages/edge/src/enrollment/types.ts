/**
 * TRIDENTPOS Edge Enrollment Type Definitions and Error Hierarchy
 * Conforms to ACR-2026-011, DATA_MODEL.md Sec. 3, SECRETS_AND_KEY_MANAGEMENT.md Sec. 4,
 * and SECURITY_ARCHITECTURE.md Sec. 3.2.
 */

export interface EnrollmentQRPayload {
  readonly branchId: string;
  readonly edgeId: string;
  readonly edgePublicKeyFingerprint: string;
  readonly pairingId: string;
  readonly expiresAt: number; // Strictly UNIX epoch seconds
  readonly pairingSecret: string;
}

export interface StationEnrollmentRequest {
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly stationPublicKey: string;
  readonly stationId: string;
  readonly stationCode: string;
  readonly stationType: string; // Canonical schema: station_type TEXT NOT NULL
  readonly organizationId: string;
  readonly branchId: string;
  readonly edgeId: string;
}

export interface StationEnrollmentResponse {
  readonly success: boolean;
  readonly stationToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number; // 43200 seconds (12 hours)
  readonly issuedAt: number; // Unix epoch seconds
  readonly stationId: string;
}

export interface StationPinRecord {
  readonly branchId: string;
  readonly edgeId: string;
  readonly edgePublicKeyFingerprint: string;
  readonly pinnedAt: number; // Unix epoch seconds
}

export interface EdgeSecurityAuditRecord {
  readonly eventId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly edgeId: string;
  readonly stationId: string | null;
  readonly eventType: string; // e.g. 'TerminalEnrolada', 'ClockRollbackDetected'
  readonly severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  readonly action: string; // e.g. 'ENROLLMENT_SUCCESS', 'CLOCK_ROLLBACK_LOCK'
  readonly sequenceNumber: number;
  readonly previousRecordHash: string;
  readonly recordHash: string;
  readonly metadataJson: string;
  readonly createdAt: number; // Unix epoch seconds
}

export interface TrustedTimeAnchorRecord {
  readonly id: number;
  readonly lastKnownCloudTime: number; // Unix epoch seconds
  readonly localWallTimeAtLastCloudSync: number; // Unix epoch seconds
  readonly anchorVersion: number;
  readonly updatedAt: number; // Unix epoch seconds
  readonly integrityTag: string;
}

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

export class EnrollmentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnrollmentError';
  }
}

export class EnrollmentSecurityError extends EnrollmentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnrollmentSecurityError';
  }
}

export class EnrollmentContextMismatchError extends EnrollmentSecurityError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnrollmentContextMismatchError';
  }
}

export class EnrollmentExpiredError extends EnrollmentSecurityError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnrollmentExpiredError';
  }
}

export class EnrollmentAlreadyConsumedError extends EnrollmentSecurityError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnrollmentAlreadyConsumedError';
  }
}

export class StationPinStoreError extends EnrollmentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StationPinStoreError';
  }
}

export class EdgeSecureStoreError extends EnrollmentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EdgeSecureStoreError';
  }
}

export class EdgeTlsKeyMissingOrCorruptedError extends EdgeSecureStoreError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EdgeTlsKeyMissingOrCorruptedError';
  }
}

export class ClockRollbackLockError extends EnrollmentSecurityError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClockRollbackLockError';
  }
}
