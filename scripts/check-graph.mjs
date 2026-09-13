import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

function loadWorkspaces() {
  if (!fs.existsSync(packagesDir)) {
    console.error('Error: packages directory does not exist:', packagesDir);
    process.exit(1);
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const workspaces = new Map();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json');
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

function buildAdjacencyList(workspaces) {
  const adj = new Map();

  for (const [pkgName, { pkgJson }] of workspaces.entries()) {
    const deps = new Set();
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
      ...pkgJson.peerDependencies,
    };

    for (const depName of Object.keys(allDeps)) {
      if (workspaces.has(depName)) {
        deps.add(depName);
      }
    }

    adj.set(pkgName, Array.from(deps));
  }

  return adj;
}

function detectCycles(adj) {
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

    // 1. Boundary check: must be permitted by ALLOWED_INTERNAL_DEPENDENCIES
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

export const ALLOWED_TEST_INTERNAL_DEPENDENCIES = {
  '@trident/core': [],
  '@trident/database': ['@trident/core'],
  '@trident/pos': ['@trident/core'],
  '@trident/sync': ['@trident/core', '@trident/edge'],
  '@trident/ui': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
};

function isTestFile(filePath) {
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
function scanWorkspaceSourceImports(workspaces) {
  const violations = [];

  for (const [pkgName, { dir, pkgJson }] of workspaces.entries()) {
    const pkgDir = path.join(packagesDir, dir);
    const files = getSourceFiles(pkgDir);

    for (const filePath of files) {
      const isTest = isTestFile(filePath);
      const allowed = isTest
        ? ALLOWED_TEST_INTERNAL_DEPENDENCIES[pkgName] || []
        : ALLOWED_INTERNAL_DEPENDENCIES[pkgName] || [];

      // For production source, dependencies must be declared in dependencies/peerDependencies
      // For test files, dependencies can be declared in dependencies/devDependencies/peerDependencies
      // OR in permitted test-only cross-workspace fixtures
      const declaredDeps = new Set([
        ...Object.keys(pkgJson.dependencies || {}),
        ...Object.keys(pkgJson.peerDependencies || {}),
        ...(isTest ? Object.keys(pkgJson.devDependencies || {}) : []),
        ...(isTest ? ALLOWED_TEST_INTERNAL_DEPENDENCIES[pkgName] || [] : []),
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

  const adj = buildAdjacencyList(workspaces);
  console.log('Package Dependency Adjacency:');
  for (const [name, deps] of adj.entries()) {
    const depStr = deps.length > 0 ? deps.join(', ') : '(none)';
    console.log(`  ${name} -> ${depStr}`);
  }
  console.log('');

  // 1. Check for cycles
  const cycles = detectCycles(adj);
  if (cycles.length > 0) {
    console.error('ERROR: Circular dependency detected in monorepo packages!');
    for (const cycle of cycles) {
      console.error(`  Cycle path: ${cycle.join(' -> ')}`);
    }
    process.exit(1);
  }

  // 2. Check manifest architectural boundary rules
  const manifestViolations = checkArchitecturalRules(adj);
  if (manifestViolations.length > 0) {
    console.error('ERROR: Architectural boundary rule violations detected in manifests:');
    for (const violation of manifestViolations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  // 3. Check source and test files for hidden/undeclared internal imports
  console.log('Scanning package source and test files for internal imports...');
  const sourceViolations = scanWorkspaceSourceImports(workspaces);
  if (sourceViolations.length > 0) {
    console.error('ERROR: Undeclared or illegal internal source imports detected:');
    for (const violation of sourceViolations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  console.log('SUCCESS: No circular dependencies detected.');
  console.log('SUCCESS: All manifest dependency boundary rules satisfied.');
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
