import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSourceFileImports,
  checkArchitecturalRules,
  ALLOWED_INTERNAL_DEPENDENCIES,
  ALLOWED_TEST_INTERNAL_DEPENDENCIES,
} from './check-graph.mjs';

describe('Dependency Graph Architectural Integrity Checker', () => {
  it('permits legal imports conforming to canonical policy (@trident/database -> @trident/core)', () => {
    const code = `
      import { createId, TenantId } from '@trident/core';
      import type { CoreEvent } from '@trident/core';
    `;
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES['@trident/database'];
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/database/src/index.ts',
      '@trident/database',
      allowed,
      declared,
    );

    assert.equal(violations.length, 0, 'Legal imports must produce zero violations');
  });

  it('fails closed when @trident/database imports @trident/sync (static import)', () => {
    const code = `
      import { CloudWebSocketSyncGateway } from '@trident/sync';
      import { createId } from '@trident/core';
    `;
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES['@trident/database'];
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/database/src/sync.test.ts',
      '@trident/database',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, 'Illegal import must produce violations');
    const boundaryViolations = violations.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/sync',
    );
    assert.equal(
      boundaryViolations.length,
      1,
      'Must detect architectural boundary violation for @trident/sync in @trident/database',
    );
  });

  it('fails closed when @trident/database imports @trident/edge (dynamic import)', () => {
    const code = `
      export async function loadEdge() {
        const edge = await import('@trident/edge');
        return edge;
      }
    `;
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES['@trident/database'];
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/database/src/sync.test.ts',
      '@trident/database',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, 'Illegal dynamic import must produce violations');
    const boundaryViolations = violations.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/edge',
    );
    assert.equal(
      boundaryViolations.length,
      1,
      'Must detect architectural boundary violation for dynamic import of @trident/edge in @trident/database',
    );
  });

  it('fails closed when a workspace imports an undeclared internal dependency', () => {
    const code = `
      import { createId } from '@trident/core';
    `;
    const allowed = ['@trident/core'];
    const declared = new Set(); // empty declared dependencies

    const violations = checkSourceFileImports(
      code,
      'packages/custom/src/index.ts',
      '@trident/custom',
      allowed,
      declared,
    );

    const undeclaredViolations = violations.filter(
      (v) => v.type === 'UNDECLARED_DEPENDENCY_VIOLATION' && v.importedPkg === '@trident/core',
    );
    assert.equal(
      undeclaredViolations.length,
      1,
      'Must detect undeclared internal dependency violation',
    );
  });

  it('preserves canonical ALLOWED_INTERNAL_DEPENDENCIES mapping strictly', () => {
    assert.deepEqual(ALLOWED_INTERNAL_DEPENDENCIES, {
      '@trident/core': [],
      '@trident/database': ['@trident/core'],
      '@trident/pos': ['@trident/core'],
      '@trident/sync': ['@trident/core'],
      '@trident/ui': ['@trident/core'],
      '@trident/edge': ['@trident/core'],
    });
  });

  it('strictly restricts @trident/database in test dependency policy to @trident/core only', () => {
    assert.deepEqual(
      ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/database'],
      ['@trident/core'],
      '@trident/database must never allow @trident/sync or @trident/edge even in test files',
    );
  });

  it('fails closed on architectural boundary violation in manifest adjacency', () => {
    const invalidAdj = new Map([
      ['@trident/database', ['@trident/core', '@trident/sync']],
      ['@trident/core', []],
    ]);

    const violations = checkArchitecturalRules(invalidAdj);
    assert.ok(violations.length > 0, 'Must produce violation for illegal manifest dependency');
    assert.match(
      violations[0],
      /Package '@trident\/database' is not permitted to depend on internal package '@trident\/sync'/,
    );
  });
});
