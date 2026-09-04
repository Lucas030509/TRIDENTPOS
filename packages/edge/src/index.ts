/**
 * @trident/edge
 * Edge host runtime package scaffolding
 */

import { CORE_PACKAGE_NAME } from '@trident/core';

export const EDGE_PACKAGE_NAME = '@trident/edge';
export const EDGE_PACKAGE_VERSION = '0.1.0';

export interface EdgePackageInfo {
  name: string;
  version: string;
  coreDependency: string;
}

export function getEdgePackageInfo(): EdgePackageInfo {
  return {
    name: EDGE_PACKAGE_NAME,
    version: EDGE_PACKAGE_VERSION,
    coreDependency: CORE_PACKAGE_NAME,
  };
}
