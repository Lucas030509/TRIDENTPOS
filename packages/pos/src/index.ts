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
