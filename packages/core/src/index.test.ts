import test from 'node:test';
import assert from 'node:assert/strict';
import { getCorePackageInfo, CORE_PACKAGE_NAME, CORE_PACKAGE_VERSION, ok, err } from './index.js';

test('@trident/core package info returns expected metadata', () => {
  const info = getCorePackageInfo();
  assert.equal(info.name, CORE_PACKAGE_NAME);
  assert.equal(info.version, CORE_PACKAGE_VERSION);
  assert.equal(info.initialized, true);
});

test('@trident/core Result type utility works as expected', () => {
  const success = ok('data');
  assert.equal(success.ok, true);
  if (success.ok) {
    assert.equal(success.value, 'data');
  }

  const failure = err(new Error('fail'));
  assert.equal(failure.ok, false);
  if (!failure.ok) {
    assert.equal(failure.error.message, 'fail');
  }
});
