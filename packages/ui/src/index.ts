/**
 * @trident/ui
 * UI component foundation package scaffolding
 */

import { CORE_PACKAGE_NAME } from '@trident/core';

export const UI_PACKAGE_NAME = '@trident/ui';
export const UI_PACKAGE_VERSION = '0.1.0';

export interface UiPackageInfo {
  name: string;
  version: string;
  coreDependency: string;
}

export function getUiPackageInfo(): UiPackageInfo {
  return {
    name: UI_PACKAGE_NAME,
    version: UI_PACKAGE_VERSION,
    coreDependency: CORE_PACKAGE_NAME,
  };
}
