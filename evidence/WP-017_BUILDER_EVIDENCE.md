# WP-017 BUILDER EVIDENCE REPORT (S17)

**Work Package:** WP-017 Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine  
**Bounded Context:** Inventory / Operations  
**Candidate Subject:** Candidate S17 — exact immutable SHA recorded below upon commit creation  
**Canonical Base M14:** `38062575ceed063c8f03af5a5c473d140dd264df` (ACR-2026-013 canonical base)  
**Implementation Branch:** `feature/wp-017-inventory-recipes`  
**Date:** 2026-09-13  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Governance Authority:** `COORDINATOR_PROMPT_WP017_START.md`, `DATA_MODEL.md` Sec 2.3, `ADR-012`, `ADR-013`, `MODULE_CATALOG.md`  

---

## 1. Executive Summary

Work Package WP-017 implements the core domain and physical database foundation for TRIDENTPOS inventory cataloging, multi-warehouse management, and recursive recipe explosion.

All requirements outlined in the architectural specifications and coordinator directives were implemented cleanly:
1. **Physical PostgreSQL Schema:** Authored migration `20260904230000_inventory_catalog_and_recipes.sql` defining canonical tables `warehouses`, `ingredients`, `recipes`, and `recipe_items`. Confirmed that NO duplicate Spanish tables (`almacenes`, `insumos`, `recetas`, `subrecetas`) exist.
2. **Tenant-Safe Integrity:** All tables use composite candidate keys `(organization_id, id)` and composite foreign keys enforcing that child entities cannot reference resources in different tenant organizations fail-closed.
3. **Mutual Exclusivity Constraint:** `recipe_items` implements check constraint `chk_recipe_items_exclusive_source`, strictly requiring `((ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL))`.
4. **Row-Level Security (RLS) & FORCE RLS:** Full PostgreSQL RLS and FORCE RLS enabled across all 4 tables with default-deny policies parameterized through `current_app_org_id()`. Tested and proven against an unprivileged database role (`NOSUPERUSER NOBYPASSRLS`).
5. **Pure Domain Package `@trident/inventory`:** Scoped strictly to `@trident/inventory -> [@trident/core]`. Zero imports of `@trident/pos` or `@trident/edge`. Zero circular dependencies. Verified by `scripts/check-graph.mjs`.
6. **Scale-4 Fixed-Point Arithmetic:** Scoped scale-4 arithmetic engine (`DECIMAL(12,4)` via bigint operations with commercial Half Away From Zero rounding). Zero floating-point arithmetic drift; zero competing project-wide `Money` class.
7. **Recursive Recipe Explosion:** Implemented `RecipeEngine.explodeIngredients()` with proportional subrecipe yield scaling, deterministic duplicate ingredient aggregation, and cycle detection.
8. **Cycle Detection:** Built-in cycle detection guarding both direct (`A -> A`) and indirect (`A -> B -> C -> A`) recursive subrecipe graphs, throwing explicit `CycleDetectedError`.
9. **Theoretical Costing:** Implemented `RecipeEngine.calculateRecipeCost()` calculating batch cost and unit cost using current average ingredient cost and recursive subrecipe costing, with zero-divisor protection (`ZeroDivisorError`) and zero-cost ingredient support.
10. **Neutral Modifier Hook:** Implemented `ModifierRecipeResolver` contract under OQ-SSOT-07 pending PO decision, containing zero hardcoded heuristics or default deductions.

---

## 2. Git Lineage & Boundary Compliance

- **Canonical Base M14:** `38062575ceed063c8f03af5a5c473d140dd264df`
- **Merge-Base:** `git merge-base feature/wp-017-inventory-recipes 38062575ceed063c8f03af5a5c473d140dd264df` -> `38062575ceed063c8f03af5a5c473d140dd264df` (clean direct child branch)
- **Branch:** `feature/wp-017-inventory-recipes`
- **History Invariants:** Zero force-push, zero rebase, linear commit history.

---

## 3. Inventory of Changed Files

Total changed files: 17

1. `packages/database/migrations/20260904230000_inventory_catalog_and_recipes.sql`:
   - Canonical DDL creating `warehouses`, `ingredients`, `recipes`, `recipe_items`.
   - Composite keys, composite foreign keys, XOR check constraint on `recipe_items`.
   - `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all 4 tables.
   - Default-deny tenant isolation policies using `current_app_org_id()`.
2. `packages/database/package.json`:
   - Added `dist/inventory.test.js` to test script.
3. `packages/database/src/inventory.test.ts`:
   - Comprehensive integration test suite verifying physical existence, constraint validation, composite FK cross-tenant rejection, and RLS default-deny with unprivileged role.
4. `packages/database/src/index.test.ts`:
   - Added teardown drop statements for the 4 inventory tables in migration integration test suite.
5. `packages/database/src/outbox.test.ts`:
   - Added teardown drop statements for the 4 inventory tables in `outbox.test.ts`.
6. `packages/database/src/sync.test.ts`:
   - Added `prepClient` organization check to ensure clean migration state before suite execution.
7. `packages/inventory/package.json`:
   - Package manifest for `@trident/inventory`, depending only on `@trident/core`.
8. `packages/inventory/tsconfig.json`:
   - TypeScript project configuration referencing `tsconfig.base.json`.
9. `packages/inventory/src/index.ts`:
   - Public package entry point exporting domain types, errors, resolver contract, numerics, and `RecipeEngine`.
10. `packages/inventory/src/types.ts`:
    - Domain types: `Warehouse`, `Ingredient`, `Recipe`, `RecipeItem`, `ExplodedIngredient`, `RecipeCostCalculationResult`.
11. `packages/inventory/src/errors.ts`:
    - Domain errors: `InventoryDomainError`, `CycleDetectedError`, `InvalidRecipeItemError`, `ZeroDivisorError`, `RecipeNotFoundError`.
12. `packages/inventory/src/modifier-resolver.ts`:
    - Neutral `ModifierRecipeResolver` contract under OQ-SSOT-07.
13. `packages/inventory/src/numerics.ts`:
    - Scale-4 fixed-point arithmetic (`DECIMAL(12,4)` via bigint operations with Half Away From Zero rounding).
14. `packages/inventory/src/recipe-engine.ts`:
    - Recursive recipe explosion (`explodeIngredients`) and theoretical costing (`calculateRecipeCost`).
15. `packages/inventory/src/index.test.ts`:
    - Comprehensive unit test suite (16 tests) covering fixed-point math, single-level explosion, nested subrecipes, duplicate aggregation, cycle detection, yield scaling, and costing.
16. `package-lock.json`:
    - Linked `@trident/inventory` into workspace dependency graph.
17. `evidence/WP-017_BUILDER_EVIDENCE.md`:
    - This evidence document.

---

## 4. Architectural & Security Validation

### 4.1 Dependency Graph Enforcement
`npm run graph:check` results:
```
Discovered 7 workspace packages:
  - @trident/core (packages/core)
  - @trident/database (packages/database)
  - @trident/edge (packages/edge)
  - @trident/inventory (packages/inventory)
  - @trident/pos (packages/pos)
  - @trident/sync (packages/sync)
  - @trident/ui (packages/ui)

Package Runtime Dependency Adjacency:
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
- **WP017-DB-01:** Proves canonical tables `warehouses`, `ingredients`, `recipes`, `recipe_items` exist in `information_schema.tables`, and proves that `almacenes`, `insumos`, `recetas`, `subrecetas` do NOT exist.
- **WP017-DB-02:** Queries `pg_class` and proves `relrowsecurity = true` AND `relforcerowsecurity = true` on all 4 tables.
- **WP017-DB-03:** Verifies XOR mutual exclusivity check `chk_recipe_items_exclusive_source`:
  - Setting both `ingredient_id` and `sub_recipe_id` non-null -> REJECTED.
  - Setting both NULL -> REJECTED.
  - Setting only `ingredient_id` -> ACCEPTED.
  - Setting only `sub_recipe_id` -> ACCEPTED.
- **WP017-DB-04:** Verifies composite foreign key cross-tenant isolation:
  - Tenant A attempting to reference Tenant B's ingredient -> REJECTED by `fk_recipe_items_ingredient`.
  - Tenant A attempting to reference Tenant B's subrecipe -> REJECTED by `fk_recipe_items_sub_recipe`.
- **WP017-DB-05:** Verifies real RLS under unprivileged role `trident_wp017_test_role` (`NOSUPERUSER NOBYPASSRLS`):
  - Without tenant context: SELECT on all 4 tables returns 0 rows (default-deny).
  - With Tenant A context: Tenant A queries return Tenant A rows; Tenant B rows are invisible.
  - Context switch to Tenant B: Tenant A rows return 0 rows.

### 4.3 Recursive Explosion & Costing Engine (`packages/inventory/src/index.test.ts`)
- Fixed-point scale-4 arithmetic with Half Away From Zero rounding.
- Single-level and nested subrecipe explosion with proportional yield multiplier.
- Deterministic duplicate ingredient aggregation across multi-level branches.
- Direct recursion detection (`A -> A`) throwing `CycleDetectedError`.
- Indirect recursion detection (`A -> B -> C -> A`) throwing `CycleDetectedError`.
- Zero-divisor protection on recipe yield (`ZeroDivisorError`).
- Theoretical batch and unit cost calculations with current average costs and recursive subrecipes.
- Zero-cost ingredient handling (`'0.0000'`).
- Neutral `ModifierRecipeResolver` contract validation.

---

## 5. Monorepo Verification Summary

| Step | Command | Result |
|---|---|---|
| Prettier Format Check | `npm run format:check` | PASS (All matched files use Prettier style) |
| ESLint Check | `npm run lint` | PASS (0 errors across 7 workspaces) |
| TypeScript Typecheck | `npm run typecheck` | PASS (0 errors across 7 workspaces) |
| Architectural Graph | `npm run graph:check` | PASS (44 tests, 0 failures, 0 cycles) |
| Clean & Build | `npm run clean && npm run build` | PASS (All 7 packages built cleanly from scratch) |
| Complete Test Suite | `npx turbo run test --force && npm run test:integration` | PASS (602 tests passed, 0 failed, 0 cancelled, 0 skipped) |

Monorepo test breakdown:
- `@trident/core`: 52 tests PASS
- `@trident/pos`: 1 test PASS
- `@trident/ui`: 1 test PASS
- `@trident/inventory`: 16 tests PASS
- `@trident/database`: 235 tests PASS
- `@trident/edge`: 165 tests PASS (155 Node tests + 10 real Electron runtime tests)
- `@trident/sync`: 88 tests PASS
- `scripts/check-graph`: 44 tests PASS
- `tests/integration`: 1 test PASS
- **Total: 602 tests passing, 0 failures, 0 regressions.**

---

## 6. Conclusion & Status

Work Package WP-017 is fully implemented, strictly tested against both pure domain unit requirements and real PostgreSQL database engine constraints, and completely verified against the monorepo test harness.

**Status:** `IMPLEMENTED / READY FOR COORDINATOR QUICK INTEGRITY`
