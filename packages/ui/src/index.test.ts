import test from 'node:test';
import assert from 'node:assert/strict';
import { getUiPackageInfo, UI_PACKAGE_NAME, UI_PACKAGE_VERSION } from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

test('@trident/ui package info returns expected metadata and dependency', () => {
  const info = getUiPackageInfo();
  assert.equal(info.name, UI_PACKAGE_NAME);
  assert.equal(info.version, UI_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});
