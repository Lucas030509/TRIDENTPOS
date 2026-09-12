/**
 * TRIDENTPOS Edge Offline IAM & Floor PIN Authentication Engine
 * Public entrypoint for IAM sub-package conforming to EAAF v1.2.0.
 */

export { OfflineIamService } from './offline-iam-service.js';
export type { OfflineIamServiceOptions } from './offline-iam-service.js';

export { LockoutManager, LOCKOUT_POLICY } from './lockout-manager.js';
export type { FailureEvaluation } from './lockout-manager.js';

export { EdgeAuthRouter } from './auth-router.js';
export type { HttpResponse } from './auth-router.js';

export {
  signFloorSessionToken,
  verifyFloorSessionToken,
  computeSessionTokenHash,
  SESSION_TOKEN_TTL_SECONDS,
} from './session-token.js';
export type { FloorSessionTokenClaims } from './session-token.js';

export { IamPersistence } from '../db/iam-persistence.js';
export type { StationCredentialInfo } from '../db/iam-persistence.js';

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
