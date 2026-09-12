/**
 * TRIDENTPOS Edge Offline IAM & Floor PIN Authentication Engine
 * Public entrypoint for IAM sub-package conforming to EAAF v1.2.0.
 * Conforms to QI-010-01 (Strict Public IAM Boundary).
 */

export { OfflineIamService } from './offline-iam-service.js';
export type { OfflineIamServiceOptions } from './offline-iam-service.js';

export { EdgeAuthRouter } from './auth-router.js';
export type { HttpResponse } from './auth-router.js';

export { SESSION_TOKEN_TTL_SECONDS } from './session-token.js';
export type { FloorSessionTokenClaims } from './session-token.js';

export { OfflineIamError } from './types.js';
export type {
  CachedUserInput,
  CachedUserRecord,
  OfflineIamErrorCode,
  PinAuthRequest,
  PinAuthSuccessResponse,
  StationLockoutStateRecord,
  StationSessionRecord,
  SupervisorUnlockRequest,
  SupervisorUnlockResponse,
} from './types.js';
