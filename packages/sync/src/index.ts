/**
 * @trident/sync
 * Sync engine package scaffolding
 */

import { CORE_PACKAGE_NAME } from '@trident/core';

export const SYNC_PACKAGE_NAME = '@trident/sync';
export const SYNC_PACKAGE_VERSION = '0.1.0';

export interface SyncPackageInfo {
  name: string;
  version: string;
  coreDependency: string;
}

export function getSyncPackageInfo(): SyncPackageInfo {
  return {
    name: SYNC_PACKAGE_NAME,
    version: SYNC_PACKAGE_VERSION,
    coreDependency: CORE_PACKAGE_NAME,
  };
}
