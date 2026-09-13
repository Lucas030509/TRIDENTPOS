import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSourceFileImports,
  checkArchitecturalRules,
  checkTestArchitecturalRules,
  buildRuntimeAdjacencyList,
  buildTestDevAdjacencyList,
  isTestFile,
  ALLOWED_INTERNAL_DEPENDENCIES,
  ALLOWED_TEST_INTERNAL_DEPENDENCIES,
} from './check-graph.mjs';

describe('Dependency Graph Architectural Integrity Checker', () => {
  // =========================================================================
  // TEST-01: Architecture-permitted test dependency AND declared devDependency
  // =========================================================================
  it('TEST-01: PASS when test dependency is permitted by policy AND declared in devDependencies (@trident/sync test -> @trident/edge)', () => {
    const code = `
      import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
      import { CloudWebSocketSyncGateway } from '@trident/sync';
    `;
    const allowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/sync']; // ['@trident/core', '@trident/edge']
    const declared = new Set(['@trident/core', '@trident/edge']); // properly declared in devDependencies

    const violations = checkSourceFileImports(
      code,
      'packages/sync/src/stream.test.ts',
      '@trident/sync',
      allowed,
      declared,
    );

    assert.equal(
      violations.length,
      0,
      'Permitted and declared test dependency must produce zero violations',
    );
  });

  // =========================================================================
  // TEST-02: Architecture-permitted test dependency BUT NOT declared
  // =========================================================================
  it('TEST-02: FAIL with UNDECLARED_DEPENDENCY_VIOLATION when test dependency is permitted by policy but missing from manifest', () => {
    const code = `
      import { EdgeDatabaseService } from '@trident/edge';
    `;
    const allowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/sync']; // ['@trident/core', '@trident/edge']
    // Simulating the false-negative incident: @trident/edge omitted from manifest devDependencies
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/sync/src/stream.test.ts',
      '@trident/sync',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, 'Undeclared test dependency must fail closed');
    const undeclared = violations.filter(
      (v) => v.type === 'UNDECLARED_DEPENDENCY_VIOLATION' && v.importedPkg === '@trident/edge',
    );
    assert.equal(
      undeclared.length,
      1,
      'Must detect UNDECLARED_DEPENDENCY_VIOLATION for permitted but undeclared test import',
    );
  });

  // =========================================================================
  // TEST-03: Declared devDependency but forbidden by test policy
  // =========================================================================
  it('TEST-03: FAIL with ARCHITECTURAL_BOUNDARY_VIOLATION when test dependency is declared in manifest but forbidden by policy', () => {
    // 3a. Manifest check
    const invalidTestDevAdj = new Map([
      ['@trident/database', ['@trident/sync']], // forbidden by ALLOWED_TEST_INTERNAL_DEPENDENCIES
    ]);
    const manifestViolations = checkTestArchitecturalRules(invalidTestDevAdj);
    assert.ok(
      manifestViolations.length > 0,
      'Forbidden declared devDependency must fail manifest check',
    );
    assert.match(
      manifestViolations[0],
      /Package '@trident\/database' is not permitted to declare test\/dev dependency on internal package '@trident\/sync'/,
    );

    // 3b. Source check
    const code = `
      import { CloudWebSocketSyncGateway } from '@trident/sync';
    `;
    const allowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/database']; // ['@trident/core']
    const declared = new Set(['@trident/core', '@trident/sync']); // declared in manifest, but forbidden!

    const violations = checkSourceFileImports(
      code,
      'packages/database/src/sync.test.ts',
      '@trident/database',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, 'Forbidden test import must fail source check');
    const boundary = violations.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/sync',
    );
    assert.equal(
      boundary.length,
      1,
      'Must detect ARCHITECTURAL_BOUNDARY_VIOLATION even if declared in devDependencies',
    );
  });

  // =========================================================================
  // TEST-04: Runtime production source: @trident/sync -> @trident/edge
  // =========================================================================
  it('TEST-04: FAIL when production source attempts to import test-only dependency (@trident/sync -> @trident/edge in production)', () => {
    const code = `
      import { EdgeDatabaseService } from '@trident/edge';
    `;
    // In production source, allowed comes strictly from ALLOWED_INTERNAL_DEPENDENCIES
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES['@trident/sync']; // ['@trident/core']
    // In production source, declared comes strictly from runtime dependencies + peerDependencies (NOT devDependencies)
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/sync/src/edge-client.ts',
      '@trident/sync',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, 'Production import of test-only package must fail');
    const boundary = violations.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/edge',
    );
    assert.equal(
      boundary.length,
      1,
      'Must fail closed with ARCHITECTURAL_BOUNDARY_VIOLATION for production import of test dependency',
    );
  });

  // =========================================================================
  // TEST-05: Current protected case: @trident/database test -> @trident/sync
  // =========================================================================
  it('TEST-05: FAIL when @trident/database tests attempt to import @trident/sync', () => {
    const code = `
      import { CloudWebSocketSyncGateway } from '@trident/sync';
    `;
    const allowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/database']; // strictly ['@trident/core']
    const declared = new Set(['@trident/core']);

    const violations = checkSourceFileImports(
      code,
      'packages/database/src/sync.test.ts',
      '@trident/database',
      allowed,
      declared,
    );

    assert.ok(violations.length > 0, '@trident/database must never import @trident/sync');
    const boundary = violations.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/sync',
    );
    assert.equal(
      boundary.length,
      1,
      'Must detect architectural boundary violation for @trident/sync in @trident/database',
    );
  });

  // =========================================================================
  // TEST-06: Dynamic import obeys the same rules
  // =========================================================================
  it('TEST-06: FAIL when dynamic import is undeclared or unauthorized', () => {
    // Case 6a: dynamic import unauthorized by architecture
    const codeUnauthorized = `
      export async function loadSync() {
        return await import('@trident/sync');
      }
    `;
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES['@trident/database']; // ['@trident/core']
    const declared = new Set(['@trident/core']);

    const violationsUnauthorized = checkSourceFileImports(
      codeUnauthorized,
      'packages/database/src/index.ts',
      '@trident/database',
      allowed,
      declared,
    );
    const boundary = violationsUnauthorized.filter(
      (v) => v.type === 'ARCHITECTURAL_BOUNDARY_VIOLATION' && v.importedPkg === '@trident/sync',
    );
    assert.equal(
      boundary.length,
      1,
      'Dynamic import must trigger ARCHITECTURAL_BOUNDARY_VIOLATION',
    );

    // Case 6b: dynamic import permitted but undeclared in manifest
    const codeUndeclared = `
      export async function loadEdge() {
        return await import('@trident/edge');
      }
    `;
    const testAllowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/sync']; // ['@trident/core', '@trident/edge']
    const testDeclared = new Set(['@trident/core']); // @trident/edge missing!

    const violationsUndeclared = checkSourceFileImports(
      codeUndeclared,
      'packages/sync/src/stream.test.ts',
      '@trident/sync',
      testAllowed,
      testDeclared,
    );
    const undeclared = violationsUndeclared.filter(
      (v) => v.type === 'UNDECLARED_DEPENDENCY_VIOLATION' && v.importedPkg === '@trident/edge',
    );
    assert.equal(
      undeclared.length,
      1,
      'Dynamic import must trigger UNDECLARED_DEPENDENCY_VIOLATION',
    );
  });

  // =========================================================================
  // Workspace Scanner Policy Composition Invariant Test
  // =========================================================================
  it('Workspace Scanner Policy Composition: proves allowed test dependencies are NOT injected into declared dependencies', () => {
    // Simulating scanner policy composition:
    // Package has @trident/sync with NO devDependencies in package.json
    const pkgJson = {
      name: '@trident/sync',
      dependencies: { '@trident/core': '*', ws: '^8.21.3' },
      devDependencies: {}, // missing @trident/edge
    };

    const filePath = 'packages/sync/src/stream.test.ts';
    const isTest = isTestFile(filePath);
    assert.equal(isTest, true, 'Test file must be recognized as test');

    const allowed = isTest
      ? ALLOWED_TEST_INTERNAL_DEPENDENCIES['@trident/sync']
      : ALLOWED_INTERNAL_DEPENDENCIES['@trident/sync'];

    // Invariant under test: declaredDeps is derived STRICTLY from manifest
    const declaredDeps = isTest
      ? new Set([
          ...Object.keys(pkgJson.dependencies || {}),
          ...Object.keys(pkgJson.peerDependencies || {}),
          ...Object.keys(pkgJson.devDependencies || {}),
        ])
      : new Set([
          ...Object.keys(pkgJson.dependencies || {}),
          ...Object.keys(pkgJson.peerDependencies || {}),
        ]);

    // Check that declaredDeps does NOT contain @trident/edge
    assert.equal(
      declaredDeps.has('@trident/edge'),
      false,
      'Allowed dependency @trident/edge must NOT be injected into declaredDeps',
    );

    const testCode = `import { EdgeDatabaseService } from '@trident/edge';`;
    const violations = checkSourceFileImports(
      testCode,
      filePath,
      '@trident/sync',
      allowed,
      declaredDeps,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].type, 'UNDECLARED_DEPENDENCY_VIOLATION');
    assert.match(violations[0].message, /is not declared in package manifest/);
  });

  // =========================================================================
  // Canonical Policy Map Preservations
  // =========================================================================
  it('preserves canonical runtime ALLOWED_INTERNAL_DEPENDENCIES mapping strictly', () => {
    assert.deepEqual(ALLOWED_INTERNAL_DEPENDENCIES, {
      '@trident/core': [],
      '@trident/database': ['@trident/core'],
      '@trident/pos': ['@trident/core'],
      '@trident/sync': ['@trident/core'],
      '@trident/ui': ['@trident/core'],
      '@trident/edge': ['@trident/core'],
    });
  });

  it('preserves canonical test ALLOWED_TEST_INTERNAL_DEPENDENCIES mapping strictly', () => {
    assert.deepEqual(ALLOWED_TEST_INTERNAL_DEPENDENCIES, {
      '@trident/core': [],
      '@trident/database': ['@trident/core'],
      '@trident/pos': ['@trident/core'],
      '@trident/sync': ['@trident/core', '@trident/edge'],
      '@trident/ui': ['@trident/core'],
      '@trident/edge': ['@trident/core'],
    });
  });

  it('verifies runtime and test adjacency builder separation', () => {
    const mockWorkspaces = new Map([
      [
        '@trident/sync',
        {
          dir: 'sync',
          pkgJson: {
            name: '@trident/sync',
            dependencies: { '@trident/core': '*' },
            devDependencies: { '@trident/edge': '*' },
          },
        },
      ],
      ['@trident/core', { dir: 'core', pkgJson: { name: '@trident/core', dependencies: {} } }],
      [
        '@trident/edge',
        { dir: 'edge', pkgJson: { name: '@trident/edge', dependencies: { '@trident/core': '*' } } },
      ],
    ]);

    const runtimeAdj = buildRuntimeAdjacencyList(mockWorkspaces);
    assert.deepEqual(runtimeAdj.get('@trident/sync'), ['@trident/core']);

    const testDevAdj = buildTestDevAdjacencyList(mockWorkspaces);
    assert.deepEqual(testDevAdj.get('@trident/sync'), ['@trident/edge']);
  });
});
