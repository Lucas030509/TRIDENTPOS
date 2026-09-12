/**
 * TRIDENTPOS Edge Enrollment & Trust Bootstrap
 * Public package entrypoint conforming to Gate B, ACR-2026-011, and QI-SEC-02.
 * Internal persistence, secure store backends, and raw key handles are strictly encapsulated.
 */

export { EdgeEnrollmentServer } from './enrollment-server.js';
export type { EdgeEnrollmentServerOptions } from './enrollment-server.js';

export { StationEnrollmentClient } from './station-client.js';
export type { StationEnrollmentClientOptions } from './station-client.js';

export { StationPinStore } from './secure-store.js';
export type { StationPinStoreOptions } from './secure-store.js';

export { EdgeMdnsAdvertiser, EdgeMdnsBrowser } from './mdns-discovery.js';
export type { EdgeMdnsAdvertiserOptions } from './mdns-discovery.js';

export type {
  EnrollmentQRPayload,
  StationEnrollmentRequest,
  StationEnrollmentResponse,
  StationPinRecord,
  EdgeSecurityAuditRecord,
} from './types.js';

export {
  EnrollmentError,
  EnrollmentSecurityError,
  EnrollmentContextMismatchError,
  EnrollmentExpiredError,
  EnrollmentAlreadyConsumedError,
  ClockRollbackLockError,
  StationPinStoreError,
} from './types.js';

export type { StationTokenClaims } from './crypto.js';

export {
  computeCertificateFingerprint,
  generatePairingId,
  generatePairingSecret,
  timingSafeSecretCompare,
  redactSensitiveData,
} from './crypto.js';
