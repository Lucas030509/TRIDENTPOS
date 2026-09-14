# WP-017 BUILDER EVIDENCE REPORT (S17-R1)

**Work Package:** WP-017 Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine  
**Bounded Context:** Inventory / Operations  
**Candidate Subject:** Candidate S17-R1 — exact immutable SHA recorded upon commit creation  
**Canonical Base M14:** `38062575ceed063c8f03af5a5c473d140dd264df` (ACR-2026-013 canonical base)  
**Parent Candidate Commit:** `b32e1fb4abc6d4bce5b39aa0eee4baf97ee509eb` (S17 candidate)  
**Implementation Branch:** `feature/wp-017-inventory-recipes`  
**Date:** 2026-09-13  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Governance Authority:** `COORDINATOR_PROMPT_WP017_START.md`, `DATA_MODEL.md` Sec 2.2 & 2.3, `SECURITY_ARCHITECTURE.md` Sec 6.2, `ADR-012`, `ADR-013`, `MODULE_CATALOG.md`  

---

## 1. Executive Summary & Remediation Actions (S17-R1)

Candidate S17-R1 addresses all four blockers (`QI-017-01` through `QI-017-04`) identified during coordinator inspection of WP-017:

1. **QI-017-01 — Data Model Conformance & Integrity:**
   - Authored canonical `products` table per `DATA_MODEL.md` Sec 2.2 with `(organization_id, id)` candidate key and PostgreSQL RLS.
   - Restored composite foreign key `CONSTRAINT fk_recipes_product FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)`.
   - Removed unauthorized `CASCADE` on `fk_recipe_items_recipe` (restoring strict standard RESTRICT behavior per `DATA_MODEL.md` line 456).
   - Removed unauthorized `DEFAULT 0.0000` on `unit_cost_snapshot` (`DECIMAL(12,4) NOT NULL` per `DATA_MODEL.md` line 453).
   - Added tests `WP017-DB-06`, `WP017-DB-07`, and `WP017-DB-08` verifying composite FK cross-tenant isolation, not-null snapshot constraint, and delete restrict.

2. **QI-017-02 — Canonical Composition Root (`packages/cloud-server/`):**
   - Created workspace package `@trident/cloud-server` with production dependencies `@trident/core`, `@trident/database`, `@trident/inventory`. Zero dependency on `@trident/pos`.
   - Implemented `PostgresCloudInventoryService` wiring pure `RecipeEngine` with PostgreSQL database queries under strict tenant context.
   - Included required documentation header: `// HTTP route naming: NOT FROZEN / NOT INVENTED BY BUILDER`.
   - Added 4 integration tests in `packages/cloud-server/src/index.test.ts` testing subrecipe explosion, costing, cross-tenant RLS isolation, and architectural dependency rules.

3. **QI-017-03 — Fail-Closed Numerics & Elimination of Silent Defaults:**
   - Changed regex in `numerics.ts` to strict fail-closed `/^-?\d+\.\d{4}$/`.
   - Enforced `DECIMAL(12,4)` exact boundary limits `[-99999999.9999, +99999999.9999]`.
   - Eliminated silent defaults `|| '1.0000'` and `|| '0.0000'` in `RecipeEngine`. Throws `ZeroDivisorError` on missing/empty yield, and throws `InvalidRecipeItemError` on missing/undefined cost while allowing valid exact `'0.0000'` ingredients.
   - Added unit tests in `packages/inventory/src/index.test.ts` verifying rejection of non-4-decimal strings, boundary checks, and fail-closed behavior on missing costs/yields.

4. **QI-017-04 — Test Count Arithmetic & Monorepo Cleanliness:**
   - Executed `npm ci` cleanly linking `@trident/cloud-server`.
   - Reconciled exact package test counts across all workspace packages and integration test suites.

---

## 2. Git Lineage & Boundary Compliance

- **Canonical Base M14:** `38062575ceed063c8f03af5a5c473d140dd264df`
- **S17 Candidate Commit:** `b32e1fb4abc6d4bce5b39aa0eee4baf97ee509eb`
- **Merge-Base with Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df`
- **Branch:** `feature/wp-017-inventory-recipes`
- **History Invariants:** Zero force-push, zero rebase, linear commit history.

---

## 3. Inventory of Changed Files in S17-R1

Total changed files: 8
1. `packages/database/migrations/20260904230000_inventory_catalog_and_recipes.sql` (added `products` table with RLS, restored `fk_recipes_product`, removed `CASCADE`, removed `DEFAULT 0.0000`)
2. `packages/database/src/index.test.ts` (added `products` to migration teardown drop list)
3. `packages/database/src/inventory.test.ts` (added `products` teardown, explicit `unit_cost_snapshot`, and tests `WP017-DB-06`, `WP017-DB-07`, `WP017-DB-08`)
4. `packages/inventory/src/numerics.ts` (strict regex `^-?\d+\.\d{4}$`, DECIMAL(12,4) bounds)
5. `packages/inventory/src/recipe-engine.ts` (eliminated silent defaults `|| '1.0000'` and `|| '0.0000'`)
6. `packages/inventory/src/index.test.ts` (added strict numeric tests and fail-closed tests)
7. `packages/cloud-server/` (created workspace package: `package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`)
8. `package-lock.json` (linked `@trident/cloud-server` in lockfile)

---

## 4. Architectural & Security Validation

### 4.1 Dependency Graph Enforcement
`npm run graph:check` output:
```
=== TRIDENTPOS Monorepo Dependency Graph Validation ===

Discovered 8 workspace packages:
  - @trident/cloud-server (packages/cloud-server)
  - @trident/core (packages/core)
  - @trident/database (packages/database)
  - @trident/edge (packages/edge)
  - @trident/inventory (packages/inventory)
  - @trident/pos (packages/pos)
  - @trident/sync (packages/sync)
  - @trident/ui (packages/ui)

Package Runtime Dependency Adjacency:
  @trident/cloud-server -> @trident/core, @trident/database, @trident/inventory
  @trident/core -> (none)
  @trident/database -> @trident/core
  @trident/edge -> @trident/core
  @trident/inventory -> @trident/core
  @trident/pos -> @trident/core
  @trident/sync -> @trident/core
  @trident/ui -> @trident/core

SUCCESS: No circular dependencies detected in runtime graph.
SUCCESS: All runtime manifest dependency boundary rules satisfied.
SUCCESS: All test/dev manifest dependency boundary rules satisfied.
SUCCESS: All source and test internal imports strictly conform to architectural policy.
Dependency graph check PASSED. (44 tests, 0 failures)
```

### 4.2 Row-Level Security & XOR Constraint Verification (`packages/database/src/inventory.test.ts`)
- **WP017-DB-01:** Proves canonical tables `warehouses`, `ingredients`, `recipes`, `recipe_items`, `products` exist in `information_schema.tables`, and proves duplicate Spanish tables do NOT exist.
- **WP017-DB-02:** Queries `pg_class` and proves `relrowsecurity = true` AND `relforcerowsecurity = true` on all canonical tables.
- **WP017-DB-03:** Verifies XOR mutual exclusivity check `chk_recipe_items_exclusive_source`.
- **WP017-DB-04:** Verifies composite foreign key cross-tenant isolation fail-closed.
- **WP017-DB-05:** Verifies real RLS under unprivileged role `trident_wp017_test_role` (`NOSUPERUSER NOBYPASSRLS`).
- **WP017-DB-06:** Verifies composite foreign key `fk_recipes_product` enforcing same-tenant products, allowing null `product_id` for subrecipes, and rejecting cross-tenant and nonexistent products fail-closed.
- **WP017-DB-07:** Verifies `unit_cost_snapshot` cannot be omitted or null (no unauthorized defaults).
- **WP017-DB-08:** Verifies `fk_recipe_items_recipe` restricts recipe deletion when child recipe_items exist (no unauthorized CASCADE).

### 4.3 Cloud Server Composition Root (`packages/cloud-server/src/index.test.ts`)
- **WP017-CLOUD-01:** Architectural assertion proving zero dependency on `@trident/pos` in manifests and source code.
- **WP017-CLOUD-02:** Proves recursive subrecipe explosion against real PostgreSQL tables with proportional yield scaling.
- **WP017-CLOUD-03:** Proves theoretical costing using live PostgreSQL `current_average_cost` queries.
- **WP017-CLOUD-04:** Proves cross-tenant RLS isolation fails closed against unauthorized tenant access.

---

## 5. Monorepo Verification Summary

| Step | Command | Result |
|---|---|---|
| Clean Install | `npm ci` | PASS (0 vulnerabilities) |
| Prettier Format Check | `npm run format:check` | PASS (All matched files use Prettier style) |
| ESLint Check | `npm run lint` | PASS (0 errors across 8 workspaces) |
| TypeScript Typecheck | `npm run typecheck` | PASS (0 errors across 8 workspaces) |
| Architectural Graph | `npm run graph:check` | PASS (44 tests, 0 failures, 0 cycles) |
| Clean & Build | `npm run clean && npm run build` | PASS (All 8 packages built cleanly from scratch) |
| Complete Test Suite | `npm test` | PASS (518 workspace tests + 1 integration test = 519 tests, 0 failures, 0 skipped) |

### Reconciled Monorepo Test Breakdown:
- `@trident/core`: 49 tests PASS
- `@trident/pos`: 1 test PASS
- `@trident/ui`: 1 test PASS
- `@trident/inventory`: 20 tests PASS
- `@trident/database`: 238 tests PASS
- `@trident/edge`: 165 tests PASS (155 Node unit + 10 real Electron runtime tests)
- `@trident/sync`: 40 tests PASS
- `@trident/cloud-server`: 4 tests PASS
- `tests/integration`: 1 test PASS
- `scripts/check-graph`: 44 tests PASS
- **Total: 563 tests passing (518 workspace + 1 E2E + 44 graph), 0 failures, 0 skipped.**

---

## 6. Conclusion & Status

Work Package WP-017 Candidate S17-R1 successfully remediates all findings `QI-017-01`, `QI-017-02`, `QI-017-03`, and `QI-017-04`. All database constraints, RLS policies, numeric engine boundaries, composition root services, and dependency graphs pass with zero errors.

**Status:** `REMEDIATED / READY FOR COORDINATOR QUICK INTEGRITY REVIEW`
