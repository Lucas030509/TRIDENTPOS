/**
 * TRIDENTPOS Edge Enrollment & Trust Bootstrap Protocol Types
 * Governed by SECURITY_ARCHITECTURE.md Sec. 3 (R2F-01), IAM_SECURITY_MODEL.md Sec. 5, and WP-009.
 */

export interface PairingPayload {
  /** Target branch unique identifier (UUID) */
  readonly branchId: string;
  /** Edge host node identifier */
  readonly edgeId: string;
  /** SHA-256 fingerprint of the legitimate Edge TLS public certificate (format: "SHA256:HEX...") */
  readonly edgePublicKeyFingerprint: string;
  /** Unique one-time pairing identifier (UUID) */
  readonly pairingId: string;
  /** Expiration UNIX epoch timestamp (seconds). Maximum 10 minutes (600s) from generation. */
  readonly expiresAt: number;
  /** CSPRNG-generated 256-bit secret (never logged or exposed before TLS verification) */
  readonly pairingSecret: string;
}

export interface PairingPayloadInput {
  readonly branchId: string;
  readonly edgeId: string;
  readonly edgePublicKeyFingerprint: string;
  readonly pairingId?: string;
  readonly ttlSeconds?: number;
  readonly pairingSecret?: string;
}

export type StationType = 'POS' | 'KDS' | 'COMANDERO' | 'DISPLAY';

export interface EnrollmentRequest {
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly stationPublicKey: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly stationId?: string;
}

export interface EnrollmentResponse {
  readonly status: 'ENROLLED';
  readonly stationId: string;
  readonly stationToken: string;
  readonly edgePublicKeyFingerprint: string;
  readonly enrolledAt: number;
}

export interface StationCredentials {
  readonly stationId: string;
  readonly branchId: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly stationPublicKey: string;
  readonly stationTokenHash: string;
  readonly enrolledAt: number;
  readonly isRevoked: boolean;
}

export interface StationTokenClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
  readonly branchId: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly iat: number;
  readonly exp: number;
}

export interface EnrollmentAuditEvent {
  readonly event: 'TerminalEnrolada';
  readonly organizationId?: string;
  readonly branchId: string;
  readonly edgeId: string;
  readonly stationId: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly pairingId: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly timestamp: number;
  readonly failureReason?: string;
}

export interface MdnsCandidate {
  readonly host: string;
  readonly port: number;
  readonly edgeId: string;
  readonly branchId?: string;
  readonly serviceName: string;
}

export type EnrollmentErrorCode =
  | 'INVALID_PAIRING_PAYLOAD'
  | 'FINGERPRINT_MISMATCH'
  | 'SECRET_DISCLOSURE_PREVENTED'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_CONSUMED'
  | 'INVALID_SECRET'
  | 'CONTEXT_MISMATCH'
  | 'CONCURRENT_CONSUMPTION_CONFLICT'
  | 'STATION_TOKEN_SIGNING_FAILED'
  | 'CERTIFICATE_PIN_MISMATCH'
  | 'MALFORMED_REQUEST'
  | 'PAYLOAD_OVERSIZED'
  | 'TLS_CONNECTION_FAILED';

export class EnrollmentError extends Error {
  public readonly code: EnrollmentErrorCode;

  constructor(code: EnrollmentErrorCode, message: string) {
    super(`[ENROLLMENT_ERROR:${code}] ${message}`);
    this.name = 'EnrollmentError';
    this.code = code;
  }
}
