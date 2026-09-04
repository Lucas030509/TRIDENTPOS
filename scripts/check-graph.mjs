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

const ALLOWED_INTERNAL_DEPENDENCIES = {
  '@trident/core': [],
  '@trident/pos': ['@trident/core'],
  '@trident/sync': ['@trident/core'],
  '@trident/ui': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
};

function checkArchitecturalRules(adj) {
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

function run() {
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

  // 2. Check architectural boundary rules
  const violations = checkArchitecturalRules(adj);
  if (violations.length > 0) {
    console.error('ERROR: Architectural boundary rule violations detected:');
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }

  console.log('SUCCESS: No circular dependencies detected.');
  console.log('SUCCESS: All architectural package boundary rules satisfied.');
  console.log('Dependency graph check PASSED.\n');
  process.exit(0);
}

run();
