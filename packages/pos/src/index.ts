/**
 * @trident/pos
 * POS package scaffolding
 */

import { CORE_PACKAGE_NAME } from '@trident/core';

export const POS_PACKAGE_NAME = '@trident/pos';
export const POS_PACKAGE_VERSION = '0.1.0';

export interface PosPackageInfo {
  name: string;
  version: string;
  coreDependency: string;
}

export function getPosPackageInfo(): PosPackageInfo {
  return {
    name: POS_PACKAGE_NAME,
    version: POS_PACKAGE_VERSION,
    coreDependency: CORE_PACKAGE_NAME,
  };
}
export * from './types.js';
export * from './errors.js';
export * from './policies.js';
export * from './ports.js';
export * from './dining-service.js';

// Re-export Kitchen Display System (KDS) domain model (WP-015)
export * from './kds-types.js';
export * from './kds-ports.js';
export * from './kds-service.js';
