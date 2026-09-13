# ACR-2026-013 GRAPH ENFORCEMENT BUILDER EVIDENCE

**Document ID:** `EVIDENCE-ACR-2026-013-GRAPH-ENFORCEMENT`  
**Author Role:** `18_DevOps_Engineer` (Implementation Builder — Architecture Enforcement)  
**Date:** `2026-09-13`  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Canonical Base:** `dceb4cf90fb75c7b32c90a86a616a341a5288ba3` (Merged `ACR-2026-013` / PR #38 on `main`)  
**Implementation Branch:** `chore/acr-2026-013-graph-enforcement`  
**Parent SHA:** `dceb4cf90fb75c7b32c90a86a616a341a5288ba3`  

---

## 1. Executive Summary

In accordance with `COORDINATOR_PROMPT_ACR2026013_GRAPH_ENFORCEMENT.md`, this report documents the formal implementation of the monorepo graph policy enforcement required by `ADR-013` and `ACR-2026-013`.

The graph checker (`scripts/check-graph.mjs`) and its comprehensive regression test suite (`scripts/check-graph.test.mjs`) have been upgraded to enforce:
1. Four-layer monorepo package taxonomy across 17 registered packages.
2. Business domain purity (Layer 2 packages depend solely on `@trident/core`).
3. Technical infrastructure isolation (Layer 3 packages depend solely on `@trident/core`).
4. Strict composition root allowlists (`@trident/pos-edge-runtime` and `@trident/cloud-server`).
5. Fail-closed rejection of unknown internal packages.
6. Cycle detection preserving DAG properties across multi-inward composition roots.
7. Test-only vs runtime dependency separation.

---

## 2. Changed Files Inventory

Only graph enforcement scripts and this evidence document were modified. Zero product runtime code, zero manifests, and zero package scaffolds were created or modified.

1. [`scripts/check-graph.mjs`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/scripts/check-graph.mjs):
   - Replaced 6-package baseline mappings with canonical 17-package 4-layer taxonomy in `ALLOWED_INTERNAL_DEPENDENCIES` and `ALLOWED_TEST_INTERNAL_DEPENDENCIES`.
   - Updated `buildRuntimeAdjacencyList` and `buildTestDevAdjacencyList` to capture undeclared internal `@trident/*` dependencies for fail-closed boundary checking.
   - Enhanced `detectCycles` to initialize leaf dependencies, preventing cycle escape.
   - Hardened `checkArchitecturalRules`, `checkTestArchitecturalRules`, `checkSourceFileImports`, and `scanWorkspaceSourceImports` against unknown packages.
2. [`scripts/check-graph.test.mjs`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/scripts/check-graph.test.mjs):
   - Expanded test suite from 10 tests to 44 tests across 6 describe suites.
   - Added complete Allowed Relations matrix (14 assertions).
   - Added complete Forbidden Relations matrix (11 negative assertions).
   - Added Test-Only Separation assertions.
   - Added Fail-Closed Unknown Package enforcement assertions.
   - Added Cycle Detection and Diamond DAG assertions.
3. [`evidence/ACR-2026-013_GRAPH_ENFORCEMENT_BUILDER_EVIDENCE.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/evidence/ACR-2026-013_GRAPH_ENFORCEMENT_BUILDER_EVIDENCE.md):
   - This evidence artifact.

---

## 3. Package Registry Before vs After

### Before (`M13` Baseline — 6 packages)
- Kernel: `@trident/core`
- Infrastructure: `@trident/database`, `@trident/edge`, `@trident/sync`, `@trident/ui`
- Domain: `@trident/pos`
- Composition roots: *None*

### After (`ACR-2026-013` Canonical — 17 packages)
- **Layer 1 (Kernel):**
  - `@trident/core` $\to$ `[]`
- **Layer 2 (Pure Business Domains — `@trident/core` only):**
  - `@trident/pos` $\to$ `['@trident/core']`
  - `@trident/inventory` $\to$ `['@trident/core']`
  - `@trident/procurement` $\to$ `['@trident/core']`
  - `@trident/finance` $\to$ `['@trident/core']`
  - `@trident/billing` $\to$ `['@trident/core']`
  - `@trident/crm` $\to$ `['@trident/core']`
  - `@trident/delivery` $\to$ `['@trident/core']`
  - `@trident/loyalty` $\to$ `['@trident/core']`
  - `@trident/analytics` $\to$ `['@trident/core']`
  - `@trident/integrations` $\to$ `['@trident/core']`
- **Layer 3 (Technical Infrastructure Adapters — `@trident/core` only):**
  - `@trident/database` $\to$ `['@trident/core']`
  - `@trident/edge` $\to$ `['@trident/core']`
  - `@trident/sync` $\to$ `['@trident/core']`
  - `@trident/ui` $\to$ `['@trident/core']`
- **Layer 4 (Application Composition Roots — Explicit wiring allowlists):**
  - `@trident/pos-edge-runtime` $\to$ `['@trident/core', '@trident/pos', '@trident/edge']`
  - `@trident/cloud-server` $\to$ `['@trident/core', '@trident/database', '@trident/pos', '@trident/inventory', '@trident/procurement', '@trident/finance', '@trident/billing', '@trident/crm', '@trident/delivery', '@trident/loyalty', '@trident/analytics', '@trident/integrations', '@trident/sync']`

### Test-Only Dependency Exceptions
- `@trident/sync` (in tests only): `['@trident/core', '@trident/edge']`
- All other 16 packages: Exactly identical to runtime allowed dependencies.

---

## 4. Verification of Graph Rules Matrix

| Category | Relation | Policy Rule | Result in Test Suite |
|---|---|---|---|
| **Allowed** | `@trident/core` $\to$ `[]` | No internal dependencies | PASS |
| **Allowed** | `@trident/pos` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/inventory` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/finance` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/database` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/edge` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/sync` $\to$ `@trident/core` | Kernel dependency only | PASS |
| **Allowed** | `@trident/pos-edge-runtime` $\to$ `@trident/core` | Composition root wiring | PASS |
| **Allowed** | `@trident/pos-edge-runtime` $\to$ `@trident/pos` | Composition root wiring | PASS |
| **Allowed** | `@trident/pos-edge-runtime` $\to$ `@trident/edge` | Composition root wiring | PASS |
| **Allowed** | `@trident/cloud-server` $\to$ `@trident/core` | Composition root wiring | PASS |
| **Allowed** | `@trident/cloud-server` $\to$ `@trident/database` | Composition root wiring | PASS |
| **Allowed** | `@trident/cloud-server` $\to$ `@trident/inventory` | Composition root wiring | PASS |
| **Allowed** | `@trident/cloud-server` $\to$ `@trident/finance` | Composition root wiring | PASS |
| **Forbidden** | `@trident/pos` $\to$ `@trident/edge` | Domain $\to$ Infrastructure violation | FAIL closed (PASS test) |
| **Forbidden** | `@trident/pos` $\to$ `@trident/inventory` | Domain $\to$ Domain cross-import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/inventory` $\to$ `@trident/pos` | Domain $\to$ Domain cross-import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/inventory` $\to$ `@trident/database` | Domain $\to$ Infrastructure violation | FAIL closed (PASS test) |
| **Forbidden** | `@trident/finance` $\to$ `@trident/pos` | Domain $\to$ Domain cross-import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/procurement` $\to$ `@trident/inventory` | Domain $\to$ Domain cross-import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/edge` $\to$ `@trident/pos` | Infrastructure $\to$ Domain reverse import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/database` $\to$ `@trident/inventory` | Infrastructure $\to$ Domain reverse import | FAIL closed (PASS test) |
| **Forbidden** | `@trident/rogue-domain` $\to$ `@trident/core` | Unrecognized package violation | FAIL closed (PASS test) |
| **Forbidden** | `@trident/pos` $\to$ `@trident/unknown-domain` | Unregistered dependency violation | FAIL closed (PASS test) |
| **Forbidden** | `@trident/rogue-a` $\to$ `@trident/rogue-b` | Unrecognized package violation | FAIL closed (PASS test) |
| **Test-Only** | `@trident/sync` test $\to$ `@trident/edge` | Allowed in test policy | PASS |
| **Test-Only** | `@trident/sync` runtime $\to$ `@trident/edge` | Forbidden in runtime policy | FAIL closed (PASS test) |
| **Cycles** | `@trident/core` $\leftrightarrow$ `@trident/pos` | Direct cycle | Detected & Rejected |
| **Cycles** | Diamond DAG (composition root to 3 nodes) | Valid DAG pattern | Zero False Positives |
| **Cycles** | Composition root circular cycle | Direct/indirect cycle | Detected & Rejected |

---

## 5. Regression Baseline & Final Gate Results

### Pre-Implementation Baseline:
- `npm ci`: Clean install
- `npm run format:check`: PASS
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm run graph:check`: PASS (10/10 tests)
- `npm run build`: PASS
- `npm test`: PASS (497/497 unit/runtime tests + 1 integration test = 498 total)

### Post-Implementation Final Regression:
- `npm run format:check`: PASS
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm run graph:check`: PASS (44/44 graph integrity tests)
- `npm run clean`: PASS
- `npm run build`: PASS
- `npm test`: PASS (497/497 unit/runtime tests + 1 integration test = 498 total)
- **Total Combined Tests Executed:** 497 package tests + 1 cross-package integration test + 44 graph integrity tests = **542 tests passed, 0 failed, 0 skipped**.

---

## 6. Prohibitions & Governance Invariants Adherence

- **Product runtime code added/modified:** NO (0 lines)
- **Database migrations added/modified:** NO (0 files)
- **Package manifests / lockfile modified:** NO (0 changes)
- **Package scaffolds created:** NO (0 empty packages created; recognition is policy-only)
- **Architecture documents modified:** NO (0 changes)
- **Product Owner decisions changed:** NO (9/9 remain `PENDING PO DECISION`)
- **WP-014 resumed:** NO
- **WP-017 started:** NO
- **Merge executed:** NO

---

## 7. Informational Advisories

- `ARCH-ADV-013-01`: OPEN / NON-BLOCKING FOR THIS TASK / MUST BE REMEDIATED BEFORE WP-016 START.
- `GOV-ADV-013-02`: OPEN / OUT OF SCOPE (governance header metadata cleanup).
