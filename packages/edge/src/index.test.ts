import test from 'node:test';
import assert from 'node:assert/strict';
import { getEdgePackageInfo, EDGE_PACKAGE_NAME, EDGE_PACKAGE_VERSION } from './index.js';
import { CORE_PACKAGE_NAME } from '@trident/core';

test('@trident/edge package info returns expected metadata and dependency', () => {
  const info = getEdgePackageInfo();
  assert.equal(info.name, EDGE_PACKAGE_NAME);
  assert.equal(info.version, EDGE_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});
