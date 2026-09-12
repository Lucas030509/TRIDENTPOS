/**
 * TRIDENTPOS Edge Offline IAM Test Support
 *
 * TEST DOUBLE & TEST SUPPORT ONLY:
 * This module is strictly isolated inside the test boundary for unit/integration tests.
 * It is NEVER exported by the production package (@trident/edge) or package exports.
 * Conforms to QI-010-01.
 */

import { EdgeDatabaseService } from '../db/edge-database.js';
import { IamPersistence } from '../db/iam-persistence.js';
import { EdgeSecureStore } from '../enrollment/secure-store.js';
import { TrustedTimeManager } from '../enrollment/trusted-time.js';
import { OfflineIamService } from './offline-iam-service.js';
import type { CachedUserInput, CachedUserRecord } from './types.js';

export type { CachedUserInput, CachedUserRecord };

export const kInternalTestToken = Symbol('kInternalTestToken');
export const kGetTestInternals = Symbol('kGetTestInternals');

export interface TestOfflineIamServiceOptions {
  readonly edgeDb: EdgeDatabaseService;
  readonly secureStore: EdgeSecureStore;
  readonly trustedTimeManager: TrustedTimeManager;
  readonly edgeId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly persistence?: IamPersistence;
  readonly logger?: (msg: string) => void;
}

/**
 * Creates an OfflineIamService instance for testing with internal test token.
 */
export function createTestOfflineIamService(
  options: TestOfflineIamServiceOptions,
): OfflineIamService {
  return Reflect.construct(OfflineIamService, [
    {
      edgeDb: options.edgeDb,
      secureStore: options.secureStore,
      trustedTimeManager: options.trustedTimeManager,
      edgeId: options.edgeId,
      organizationId: options.organizationId,
      branchId: options.branchId,
      logger: options.logger,
    },
    kInternalTestToken,
    options.persistence,
  ]);
}

import { LockoutManager } from './lockout-manager.js';

/**
 * Creates an isolated test IamPersistence instance.
 */
export function createTestIamPersistence(edgeDb: EdgeDatabaseService): IamPersistence {
  return new IamPersistence(edgeDb);
}

/**
 * Retrieves internal persistence and lockoutManager for test-only assertions.
 */
export function getTestInternals(service: OfflineIamService): {
  persistence: IamPersistence;
  lockoutManager: LockoutManager;
} {
  const serviceWithInternals = service as unknown as Record<
    symbol,
    (token: symbol) => { persistence: IamPersistence; lockoutManager: LockoutManager }
  >;
  const accessor = serviceWithInternals[kGetTestInternals];
  if (typeof accessor !== 'function') {
    throw new Error('Test internals accessor not available on service');
  }
  return accessor.call(service, kInternalTestToken);
}
