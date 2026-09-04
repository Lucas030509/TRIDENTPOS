import test from 'node:test';
import assert from 'node:assert/strict';
import { getSyncPackageInfo, SYNC_PACKAGE_NAME, SYNC_PACKAGE_VERSION } from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

test('@trident/sync package info returns expected metadata and dependency', () => {
  const info = getSyncPackageInfo();
  assert.equal(info.name, SYNC_PACKAGE_NAME);
  assert.equal(info.version, SYNC_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});
