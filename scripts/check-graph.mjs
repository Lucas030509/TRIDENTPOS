import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

export function loadWorkspaces(dir = packagesDir) {
  if (!fs.existsSync(dir)) {
    console.error('Error: packages directory does not exist:', dir);
    process.exit(1);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const workspaces = new Map();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgJsonPath = path.join(dir, entry.name, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          workspaces.set(pkgJson.name, {
            dir: entry.name,
            pkgJson,
          });
        } catch (err) {
          console.error(`Error parsing ${pkgJsonPath}:`, err.message);
          process.exit(1);
        }
      }
    }
  }

  return workspaces;
}

/**
 * Builds runtime dependency adjacency from production dependencies and peerDependencies.
 */
export function buildRuntimeAdjacencyList(workspaces) {
  const adj = new Map();

  for (const [pkgName, { pkgJson }] of workspaces.entries()) {
    const deps = new Set();
    const runtimeDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.peerDependencies,
    };

    for (const depName of Object.keys(runtimeDeps)) {
      if (workspaces.has(depName)) {
        deps.add(depName);
      }
    }

    adj.set(pkgName, Array.from(deps));
  }

  return adj;
}

/**
 * Alias for buildRuntimeAdjacencyList to maintain compatibility.
 */
export const buildAdjacencyList = buildRuntimeAdjacencyList;

/**
 * Builds test/dev dependency adjacency from internal devDependencies.
 */
export function buildTestDevAdjacencyList(workspaces) {
  const adj = new Map();

  for (const [pkgName, { pkgJson }] of workspaces.entries()) {
    const deps = new Set();
    const devDeps = {
      ...pkgJson.devDependencies,
    };

    for (const depName of Object.keys(devDeps)) {
      if (workspaces.has(depName)) {
        deps.add(depName);
      }
    }

    adj.set(pkgName, Array.from(deps));
  }

  return adj;
}

export function detectCycles(adj) {
  const visited = new Map(); // 0 = unvisited, 1 = visiting, 2 = visited
  const parent = new Map();
  const cycles = [];

  for (const node of adj.keys()) {
    visited.set(node, 0);
  }

  function dfs(u, pathStack) {
    visited.set(u, 1);
    pathStack.push(u);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (visited.get(v) === 1) {
        // Cycle detected
        const cycleStartIndex = pathStack.indexOf(v);
        const cycle = pathStack.slice(cycleStartIndex).concat(v);
        cycles.push(cycle);
      } else if (visited.get(v) === 0) {
        dfs(v, pathStack);
      }
    }

    pathStack.pop();
    visited.set(u, 2);
  }

  for (const node of adj.keys()) {
    if (visited.get(node) === 0) {
      dfs(node, []);
    }
  }

  return cycles;
}

export const ALLOWED_INTERNAL_DEPENDENCIES = {
  '@trident/core': [],
  '@trident/database': ['@trident/core'],
  '@trident/pos': ['@trident/core'],
  '@trident/sync': ['@trident/core'],
  '@trident/ui': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
};

export const ALLOWED_TEST_INTERNAL_DEPENDENCIES = {
  '@trident/core': [],
  '@trident/database': ['@trident/core'],
  '@trident/pos': ['@trident/core'],
  '@trident/sync': ['@trident/core', '@trident/edge'],
  '@trident/ui': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
};

/**
 * Validates runtime manifest dependency rules against ALLOWED_INTERNAL_DEPENDENCIES.
 */
export function checkArchitecturalRules(adj) {
  const violations = [];

  for (const [pkgName, deps] of adj.entries()) {
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES[pkgName];
    if (allowed === undefined) {
      violations.push(
        `Architectural violation: Unrecognized internal package '${pkgName}' has no defined dependency policy.`,
      );
      continue;
    }

    for (const dep of deps) {
      if (!allowed.includes(dep)) {
        violations.push(
          `Architectural boundary violation: Package '${pkgName}' is not permitted to depend on internal package '${dep}'. Permitted internal dependencies: [${allowed.map((d) => `'${d}'`).join(', ')}]`,
        );
      }
    }
  }

  return violations;
}

/**
 * Validates test/dev manifest dependency rules against ALLOWED_TEST_INTERNAL_DEPENDENCIES.
 */
export function checkTestArchitecturalRules(testDevAdj) {
  const violations = [];

  for (const [pkgName, deps] of testDevAdj.entries()) {
    const allowed = ALLOWED_TEST_INTERNAL_DEPENDENCIES[pkgName];
    if (allowed === undefined) {
      violations.push(
        `Architectural test violation: Unrecognized internal package '${pkgName}' has no defined test dependency policy.`,
      );
      continue;
    }

    for (const dep of deps) {
      if (!allowed.includes(dep)) {
        violations.push(
          `Architectural test boundary violation: Package '${pkgName}' is not permitted to declare test/dev dependency on internal package '${dep}'. Permitted test internal dependencies: [${allowed.map((d) => `'${d}'`).join(', ')}]`,
        );
      }
    }
  }

  return violations;
}

const TRIDENT_IMPORT_REGEX =
  /(?:import\s+(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\s*\(\s*|require\s*\(\s*)['"](@trident\/[^'"/]+)(?:\/[^'"]+)?['"]/g;

/**
 * Recursively find all source and test files in directory.
 */
function getSourceFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') {
        continue;
      }
      files.push(...getSourceFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

/**
 * Scan a single source text for internal @trident/* imports and validate against allowed policy and manifest.
 *
 * Requirements:
 * - PERMITTED: importedPkg must exist in allowedDeps.
 * - DECLARED: importedPkg must exist in declaredDeps.
 * Both conditions must pass independently.
 */
export function checkSourceFileImports(content, relativePath, pkgName, allowedDeps, declaredDeps) {
  const violations = [];
  const regex = new RegExp(TRIDENT_IMPORT_REGEX.source, 'g');
  let match;

  while ((match = regex.exec(content)) !== null) {
    const importedPkg = match[1];
    if (importedPkg === pkgName) {
      continue; // Self-import
    }

    // 1. Boundary check: must be permitted by policy
    if (!allowedDeps.includes(importedPkg)) {
      violations.push({
        type: 'ARCHITECTURAL_BOUNDARY_VIOLATION',
        file: relativePath,
        pkgName,
        importedPkg,
        message: `Architectural boundary source violation: File '${relativePath}' in package '${pkgName}' imports '${importedPkg}', which is not permitted by architecture policy. Permitted internal dependencies: [${allowedDeps.map((d) => `'${d}'`).join(', ')}]`,
      });
    }

    // 2. Declaration check: must be declared in package.json
    if (!declaredDeps.has(importedPkg)) {
      violations.push({
        type: 'UNDECLARED_DEPENDENCY_VIOLATION',
        file: relativePath,
        pkgName,
        importedPkg,
        message: `Undeclared internal dependency violation: File '${relativePath}' in package '${pkgName}' imports '${importedPkg}', but '${importedPkg}' is not declared in package manifest.`,
      });
    }
  }

  return violations;
}

export function isTestFile(filePath) {
  const base = path.basename(filePath);
  return (
    base.includes('.test.') ||
    base.includes('.spec.') ||
    filePath.includes('/tests/') ||
    filePath.includes('/test/')
  );
}

/**
 * Scan all workspace packages for internal import violations in source and tests.
 */
export function scanWorkspaceSourceImports(workspaces) {
  const violations = [];

  for (const [pkgName, { dir, pkgJson }] of workspaces.entries()) {
    const pkgDir = path.join(packagesDir, dir);
    const files = getSourceFiles(pkgDir);

    for (const filePath of files) {
      const isTest = isTestFile(filePath);
      const allowed = isTest
        ? ALLOWED_TEST_INTERNAL_DEPENDENCIES[pkgName] || []
        : ALLOWED_INTERNAL_DEPENDENCIES[pkgName] || [];

      // For production source:
      // - allowed dependencies: ALLOWED_INTERNAL_DEPENDENCIES[pkgName]
      // - declared dependencies: ONLY dependencies + peerDependencies
      // For test files:
      // - allowed dependencies: ALLOWED_TEST_INTERNAL_DEPENDENCIES[pkgName]
      // - declared dependencies: dependencies + peerDependencies + devDependencies
      // CRITICAL: PERMITTED ≠ DECLARED. Allowed dependencies are NEVER injected into declaredDeps.
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

      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);
      const fileViolations = checkSourceFileImports(
        content,
        relativePath,
        pkgName,
        allowed,
        declaredDeps,
      );
      for (const v of fileViolations) {
        violations.push(v.message);
      }
    }
  }

  return violations;
}

export function run() {
  console.log('=== TRIDENTPOS Monorepo Dependency Graph Validation ===\n');

  const workspaces = loadWorkspaces();
  console.log(`Discovered ${workspaces.size} workspace packages:`);
  for (const [name, { dir }] of workspaces.entries()) {
    console.log(`  - ${name} (packages/${dir})`);
  }
  console.log('');

  // 1. Build and validate runtime dependency adjacency
  const runtimeAdj = buildRuntimeAdjacencyList(workspaces);
  console.log('Package Runtime Dependency Adjacency:');
  for (const [name, deps] of runtimeAdj.entries()) {
    const depStr = deps.length > 0 ? deps.join(', ') : '(none)';
    console.log(`  ${name} -> ${depStr}`);
  }
  console.log('');

  // 2. Build and validate test/dev dependency adjacency
  const testDevAdj = buildTestDevAdjacencyList(workspaces);
  console.log('Package Test/Dev Internal Dependency Adjacency:');
  for (const [name, deps] of testDevAdj.entries()) {
    const depStr = deps.length > 0 ? deps.join(', ') : '(none)';
    console.log(`  ${name} -> ${depStr}`);
  }
  console.log('');

  // 3. Check for cycles in runtime dependency graph
  const cycles = detectCycles(runtimeAdj);
  if (cycles.length > 0) {
    console.error('ERROR: Circular dependency detected in monorepo runtime packages!');
    for (const cycle of cycles) {
      console.error(`  Cycle path: ${cycle.join(' -> ')}`);
    }
    process.exit(1);
  }

  // 4. Check runtime manifest architectural boundary rules
  const manifestViolations = checkArchitecturalRules(runtimeAdj);
  if (manifestViolations.length > 0) {
    console.error('ERROR: Architectural boundary rule violations detected in runtime manifests:');
    for (const violation of manifestViolations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  // 5. Check test/dev manifest architectural boundary rules
  const testManifestViolations = checkTestArchitecturalRules(testDevAdj);
  if (testManifestViolations.length > 0) {
    console.error('ERROR: Architectural boundary rule violations detected in test/dev manifests:');
    for (const violation of testManifestViolations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  // 6. Check source and test files for hidden/undeclared internal imports
  console.log('Scanning package source and test files for internal imports...');
  const sourceViolations = scanWorkspaceSourceImports(workspaces);
  if (sourceViolations.length > 0) {
    console.error('ERROR: Undeclared or illegal internal source imports detected:');
    for (const violation of sourceViolations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  console.log('SUCCESS: No circular dependencies detected in runtime graph.');
  console.log('SUCCESS: All runtime manifest dependency boundary rules satisfied.');
  console.log('SUCCESS: All test/dev manifest dependency boundary rules satisfied.');
  console.log(
    'SUCCESS: All source and test internal imports strictly conform to architectural policy.',
  );
  console.log('Dependency graph check PASSED.\n');
  process.exit(0);
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run();
}
