import test from 'node:test';
import assert from 'node:assert/strict';
import { getPosPackageInfo, POS_PACKAGE_NAME, POS_PACKAGE_VERSION } from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

test('@trident/pos package info returns expected metadata and dependency', () => {
  const info = getPosPackageInfo();
  assert.equal(info.name, POS_PACKAGE_NAME);
  assert.equal(info.version, POS_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});
