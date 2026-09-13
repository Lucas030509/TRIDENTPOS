# WP-013 BUILDER EVIDENCE REPORT (S13-R4)

**Work Package:** WP-013 Bidirectional Synchronization Service & WAN Reconnection Protocol  
**Bounded Context:** Platform Core / Sync  
**Remediation Candidate Subject:** Candidate S13-R4 — exact immutable SHA to be recorded after commit creation  
**Parent S13-R3:** `4f0e398954a7d7070d491ded0f169f516b10cd69`  
**Ancestor S13-R2:** `d17d823db3b85542d444067d3cbcecd84f67a3d2`  
**Ancestor S13-R1:** `8c02aa4cb943d364f828f9482e6a5d5cb907030b`  
**Original Implementation S13:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`  
**Parent Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`  
**Direct Lineage:** `M12` (`719b1ff`) -> `S13` (`bd1b85c`) -> `S13-R1` (`8c02aa4`) -> `S13-R2` (`d17d823`) -> `S13-R3` (`4f0e398`) -> `S13-R4`  
**Date:** 2026-09-13  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Implementation Branch:** `feature/wp-013-bidirectional-sync-reconnection`  
**Governance Authority:** `WP-013 S13-R4 DEPENDENCY GATE FINAL REMEDIATION`, `SYNC_AND_OFFLINE_ARCHITECTURE.md` Sec. 4 & 5, `ADR-002`, `ADR-005`, `ADR-006`  

---

## 1. Executive Summary & S13-R4 Dependency Gate Remediation

Following the Coordinator Quick Integrity verdict (`S13-R3 QUICK INTEGRITY = HOLD`), candidate `S13-R4` was constructed as an immutable direct child of `S13-R3 = 4f0e398954a7d7070d491ded0f169f516b10cd69`. No history rewrite, rebase, squash, or force-push occurred.

### Summary of Resolved R4 Requirements:
1. **BLOCKER R4-01 Resolved (Undeclared Test Dependencies Fail Closed):**
   - Eliminated false-negative in `scripts/check-graph.mjs` where entries from `ALLOWED_TEST_INTERNAL_DEPENDENCIES` were injected into `declaredDeps`.
   - Enforced canonical invariant: `PERMITTED ≠ DECLARED`. Both conditions must independently pass.
   - Any internal dependency imported in a test file that is not explicitly declared in `package.json` manifest (`dependencies`, `peerDependencies`, or `devDependencies`) strictly fails closed with `UNDECLARED_DEPENDENCY_VIOLATION`.
2. **Explicit Test/Dev Declarations for `@trident/sync`:**
   - Declared `@trident/edge: "*"` under `devDependencies` in `packages/sync/package.json`.
   - Declared external test dependency `"jose": "5.9.6"` under `devDependencies` in `packages/sync/package.json`.
   - Production runtime `dependencies` of `@trident/sync` remain strictly confined to `@trident/core: "*"` and `ws: "^8.21.3"`.
3. **Architectural Separation of Runtime and Test/Dev Dependency Graphs:**
   - `buildRuntimeAdjacencyList`: Evaluates production `dependencies` and `peerDependencies`. Validated against `ALLOWED_INTERNAL_DEPENDENCIES`.
   - `buildTestDevAdjacencyList`: Evaluates internal `devDependencies`. Validated against `ALLOWED_TEST_INTERNAL_DEPENDENCIES`.
   - Canonical runtime architecture is strictly preserved:
     ```text
     @trident/core     -> []
     @trident/database -> [@trident/core]
     @trident/pos      -> [@trident/core]
     @trident/sync     -> [@trident/core]
     @trident/ui       -> [@trident/core]
     @trident/edge     -> [@trident/core]
     ```
4. **Build Graph Determinism from Clean State:**
   - Added `"clean": { "cache": false }` task to `turbo.json`.
   - Cleaned all packages (`npm run clean`), verified `dist/` removal, and recompiled full dependency chain from scratch (`npx turbo run build --force`).
   - Proved `@trident/sync` test compilation resolves `@trident/edge` deterministically via topological build graph.
5. **Comprehensive Regression Test Suite for Checker Gate (`scripts/check-graph.test.mjs`):**
   - **TEST-01:** Architecture-permitted test dependency AND declared devDependency (`@trident/sync test -> @trident/edge`) -> `PASS`.
   - **TEST-02:** Architecture-permitted test dependency BUT NOT declared (manifest missing `@trident/edge`) -> `FAIL — UNDECLARED_DEPENDENCY_VIOLATION`.
   - **TEST-03:** Declared devDependency but forbidden by test policy -> `FAIL — ARCHITECTURAL_BOUNDARY_VIOLATION` (manifest + source).
   - **TEST-04:** Runtime production source importing test-only dependency (`@trident/sync -> @trident/edge` in production) -> `FAIL`.
   - **TEST-05:** Protected database test case (`@trident/database test -> @trident/sync`) -> `FAIL`.
   - **TEST-06:** Dynamic imports obey exact same rules -> `FAIL` when undeclared or unauthorized.
   - **Scanner Composition Test:** Proves allowed test dependencies are never injected into declared dependencies at the workspace scanner level.
   - All 10 checker regression tests passing.
6. **Preserved All R3 / R2 Fixes:**
   - Relocated neutral repository E2E test `tests/integration/wp013-sync-e2e.test.mjs` (`WP013-E2E-01`).
   - True automatic WAN reconnect on socket closure (`WP013-T08`).
   - Production RS256 JWT WebSocket authentication (`WP013-T07`).
   - Strict control-plane claim typing (`isControlPlane === true`).
   - Concurrent PostgreSQL checkpoint monotonicity (`WP013-DB-09`).
   - Symmetric ±20% jitter bounds (`WP013-T06`).
   - Database package has zero illegal dependencies and clean compiler config.

---

## 2. Git Lineage & Immutable Candidate Invariants

- **Canonical Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`
- **Initial S13 Subject:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`
- **Candidate S13-R1:** `8c02aa4cb943d364f828f9482e6a5d5cb907030b`
- **Candidate S13-R2:** `d17d823db3b85542d444067d3cbcecd84f67a3d2`
- **Candidate S13-R3:** `4f0e398954a7d7070d491ded0f169f516b10cd69`
- **Candidate S13-R4:** Direct child of `S13-R3` (`4f0e398954a7d7070d491ded0f169f516b10cd69`)
- **Linear Descent:** `M12` -> `S13` -> `S13-R1` -> `S13-R2` -> `S13-R3` -> `S13-R4`
- **Branch:** `feature/wp-013-bidirectional-sync-reconnection`
- **No Force-Push / No History Rewrite:** Strictly preserved.

---

## 3. S13-R4 Remediation Changes

Changed files in S13-R4:
1. `packages/sync/package.json`:
   - Added `"@trident/edge": "*"` to `devDependencies`.
   - Added `"jose": "5.9.6"` to `devDependencies`.
   - Production `dependencies` remain strictly: `"@trident/core": "*"` and `"ws": "^8.21.3"`.
2. `scripts/check-graph.mjs`:
   - Separated runtime adjacency (`buildRuntimeAdjacencyList`) from test/dev adjacency (`buildTestDevAdjacencyList`).
   - Added `checkTestArchitecturalRules` to validate declared devDependencies against `ALLOWED_TEST_INTERNAL_DEPENDENCIES`.
   - Fixed `scanWorkspaceSourceImports` to remove injection of allowed dependencies into `declaredDeps`.
3. `scripts/check-graph.test.mjs`:
   - Added TEST-01 through TEST-06 and scanner policy composition test (10 tests total).
4. `turbo.json`:
   - Added `"clean": { "cache": false }` task.
5. `evidence/WP-013_BUILDER_EVIDENCE.md`:
   - Updated evidence for S13-R4 candidate.

---

## 4. Evidence of Architectural Boundary Integrity

### 4.1 Runtime Dependency Graph
```
Package Runtime Dependency Adjacency:
  @trident/core -> (none)
  @trident/database -> @trident/core
  @trident/edge -> @trident/core
  @trident/pos -> @trident/core
  @trident/sync -> @trident/core
  @trident/ui -> @trident/core
```
`@trident/sync` depends at runtime exclusively on `@trident/core`.

### 4.2 Test/Dev Dependency Graph
```
Package Test/Dev Internal Dependency Adjacency:
  @trident/core -> (none)
  @trident/database -> (none)
  @trident/edge -> (none)
  @trident/pos -> (none)
  @trident/sync -> @trident/edge
  @trident/ui -> (none)
```
`@trident/sync` declares `@trident/edge` solely in `devDependencies` for its integration test suite.

### 4.3 Graph Checker Output (`npm run graph:check`)
```
> tridentpos@0.1.0 graph:check
> node scripts/check-graph.mjs && node --test scripts/check-graph.test.mjs

=== TRIDENTPOS Monorepo Dependency Graph Validation ===

Discovered 6 workspace packages:
  - @trident/core (packages/core)
  - @trident/database (packages/database)
  - @trident/edge (packages/edge)
  - @trident/pos (packages/pos)
  - @trident/sync (packages/sync)
  - @trident/ui (packages/ui)

Package Runtime Dependency Adjacency:
  @trident/core -> (none)
  @trident/database -> @trident/core
  @trident/edge -> @trident/core
  @trident/pos -> @trident/core
  @trident/sync -> @trident/core
  @trident/ui -> @trident/core

Package Test/Dev Internal Dependency Adjacency:
  @trident/core -> (none)
  @trident/database -> (none)
  @trident/edge -> (none)
  @trident/pos -> (none)
  @trident/sync -> @trident/edge
  @trident/ui -> (none)

Scanning package source and test files for internal imports...
SUCCESS: No circular dependencies detected in runtime graph.
SUCCESS: All runtime manifest dependency boundary rules satisfied.
SUCCESS: All test/dev manifest dependency boundary rules satisfied.
SUCCESS: All source and test internal imports strictly conform to architectural policy.
Dependency graph check PASSED.

▶ Dependency Graph Architectural Integrity Checker
  ✔ TEST-01: PASS when test dependency is permitted by policy AND declared in devDependencies (@trident/sync test -> @trident/edge) (0.992333ms)
  ✔ TEST-02: FAIL with UNDECLARED_DEPENDENCY_VIOLATION when test dependency is permitted by policy but missing from manifest (0.161958ms)
  ✔ TEST-03: FAIL with ARCHITECTURAL_BOUNDARY_VIOLATION when test dependency is declared in manifest but forbidden by policy (0.241584ms)
  ✔ TEST-04: FAIL when production source attempts to import test-only dependency (@trident/sync -> @trident/edge in production) (0.115417ms)
  ✔ TEST-05: FAIL when @trident/database tests attempt to import @trident/sync (0.157084ms)
  ✔ TEST-06: FAIL when dynamic import is undeclared or unauthorized (0.164167ms)
  ✔ Workspace Scanner Policy Composition: proves allowed test dependencies are NOT injected into declared dependencies (0.172208ms)
  ✔ preserves canonical runtime ALLOWED_INTERNAL_DEPENDENCIES mapping strictly (0.626542ms)
  ✔ preserves canonical test ALLOWED_TEST_INTERNAL_DEPENDENCIES mapping strictly (0.250083ms)
  ✔ verifies runtime and test adjacency builder separation (0.4635ms)
✔ Dependency Graph Architectural Integrity Checker (4.540542ms)
ℹ tests 10
ℹ suites 1
ℹ pass 10
ℹ fail 0
```

---

## 5. Complete Monorepo Regression Test Results

Full monorepo regression suite executed across all 6 packages plus repository-level integration tests:

| Component / Layer | Test Suites | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| `@trident/core` | 8 | 49 | 49 | 0 | 0 |
| `@trident/database` (Cloud & PostgreSQL 16) | 7 | 230 | 230 | 0 | 0 |
| `@trident/sync` (Gateway, Client, Router, Ingestion) | 5 | 40 | 40 | 0 | 0 |
| `@trident/edge` (Unit & SQLite) | 2 | 155 | 155 | 0 | 0 |
| `@trident/edge` (Actual Electron Runtime) | 1 | 10 | 10 | 0 | 0 |
| `@trident/pos` | 1 | 1 | 1 | 0 | 0 |
| `@trident/ui` | 1 | 1 | 1 | 0 | 0 |
| Repository Integration (`tests/integration/wp013-sync-e2e.test.mjs`) | 1 | 1 | 1 | 0 | 0 |
| Architecture Checker (`scripts/check-graph.test.mjs`) | 1 | 10 | 10 | 0 | 0 |
| **TOTAL** | **27** | **497** | **497** | **0** | **0** |

- **Format Check:** `npm run format:check` PASSED (All matched files use Prettier code style).
- **Lint:** `npm run lint` PASSED (0 errors across all 6 packages).
- **Clean:** `npm run clean` PASSED (all packages cleaned).
- **Build:** `npm run build` PASSED (All 6 packages compiled cleanly from scratch).
- **Typecheck:** `npm run typecheck` PASSED (0 errors across all 6 packages).
- **Dependency Graph:** `npm run graph:check` PASSED (0 boundary violations, 0 circular dependencies, 10/10 integrity tests passed).
- **Full Test Suite:** `npm test` PASSED (Turbo package tests + repository integration tests passed).
- **Acceptance Tests Skipped:** Strictly 0 skipped acceptance tests.

---

## 6. Security Validation Debt Disposition

### 6.1 SEC-VAL-09 Disposition
- **Governed Status:** `OPEN / PARTIAL`
- **Builder Proposed Status:** `SEC-VAL-09 EVIDENCE COMPLETE — PROPOSED FOR INDEPENDENT EVALUATION`
  *(Preserved strictly for independent specialist review and Coordinator evaluation; not marked closed).*

### 6.2 Preserved Security Debts
- **`SEC-VAL-03`:** `OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED` (Preserved untouched).
- **`SEC-VAL-08`:** `OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED` (Preserved untouched).
- **`SEC-VAL-02`:** `CLOSED` (Preserved).
- **`SEC-VAL-04`:** `CLOSED` (Preserved).

---

## 7. Product Owner Decision Protection

All nine Product Owner open questions remain strictly `PENDING PO DECISION`:
- `OQ-SSOT-01`: PENDING PO DECISION
- `OQ-SSOT-02`: PENDING PO DECISION
- `OQ-SSOT-03`: PENDING PO DECISION
- `OQ-SSOT-04`: PENDING PO DECISION
- `OQ-SSOT-05`: PENDING PO DECISION
- `OQ-SSOT-06`: PENDING PO DECISION
- `OQ-SSOT-07`: PENDING PO DECISION
- `OQ-ARCH-01`: PENDING PO DECISION
- `OQ-ARCH-02`: PENDING PO DECISION

---

## 8. WP-014 Boundary Invariant Confirmation

WP-014 remains completely unauthorized and untouched:
- No dining domain models.
- No tables (`mesas`).
- No restaurant checks (`cuentas`).
- No restaurant OCC logic.
- No kitchen display service (`KDS`).
- No cash management or inventory domains.
Synthetic aggregate names only used in test fixtures (`ORDER`).

---

## 9. Final Builder Status

**Status:** `WP-013 S13-R4 IMPLEMENTED — READY FOR COORDINATOR QUICK INTEGRITY`
