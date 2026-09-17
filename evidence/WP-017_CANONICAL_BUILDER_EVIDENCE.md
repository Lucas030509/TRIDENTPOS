# TRIDENTPOS — WP-017 CANONICAL BUILDER EVIDENCE

## 1. Canonical Identification & Lineage
* **Work Package**: WP-017 — Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine
* **Canonical Base SHA**: `083b05fde1d39a82b998abb18cb5fcc1ee8facbd` (`origin/main`)
* **Base Verification**: PASS (exact match with canonical baseline)
* **Implementation Branch**: `feat/wp-017-inventory-catalog-recipes-canonical`
* **Historical Non-Canonical Branch**: `feature/wp-017-inventory-recipes` (`20398d68de7ecb8017df1731ee5fa5e1c7a66098`)
* **Historical Candidate Used As Base**: NO (strictly branched fresh from canonical `main` at `083b05fde1d39a82b998abb18cb5fcc1ee8facbd`)
* **Historical Branch Modified**: NO

---

## 2. Package Topology & Boundaries
* **Pure Domain Package**: `@trident/inventory` (`packages/inventory`)
  * Runtime Dependencies: `@trident/core` ONLY
  * Dependency on `@trident/pos`: NO
  * Dependency on `@trident/edge`: NO
  * Dependency on `@trident/database`: NO
* **Cloud Composition Root**: `@trident/cloud-server` (`packages/cloud-server`)
  * Runtime Dependencies: `@trident/core`, `@trident/database`, `@trident/inventory`
  * Dependency on `@trident/pos`: NO
* **Dependency Graph Enforcement**: PASS (`npm run graph:check` — 44/44 tests passing)

---

## 3. Database Migration & Schema Ownership
* **Migration File**: `packages/database/migrations/20260904230000_inventory_catalog_and_recipes.sql`
* **Physical Tables Created**:
  1. `warehouses`
  2. `ingredients`
  3. `recipes`
  4. `recipe_items`
* **Platform Core Ownership Guarantee**:
  * `products` Created By WP-017: NO
  * `categories` Created By WP-017: NO
  * Platform Core Migration `20260904223000_platform_core_master_catalog.sql` Modified: NO
* **Foreign Key to Platform Core**:
  * `recipes.product_id` references `products(organization_id, id)` via composite FK `fk_recipes_product`
  * Intermediate subrecipes allow `product_id IS NULL`
* **Row-Level Security (RLS)**:
  * `ENABLE ROW LEVEL SECURITY` on all 4 tables: YES
  * `FORCE ROW LEVEL SECURITY` on all 4 tables: YES
  * Fail-closed tenant context via `current_app_org_id()`: YES
  * Unauthenticated default-deny verified: YES (0 visible rows)
* **Integrity Constraints**:
  * Exclusive Source XOR on `recipe_items`: `(ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL)`
  * Delete Cascade Policy: RESTRICT (`ON DELETE NO ACTION` / `RESTRICT` on all recipe relationships to prevent unauthorized cascading loss)
  * Scale-4 Precision: `DECIMAL(12,4)` with exact numeric bounds `[-99999999.9999, +99999999.9999]`

---

## 4. Domain Engine Capabilities
* **Recursive Explosion (`explodeIngredients`)**:
  * Flattens multi-level subrecipe DAGs to raw base materials deterministically
  * Proportional yield scaling: `(consumed_quantity / yield_quantity) * ingredient_quantity`
  * Duplicate ingredient aggregation across disparate branches: YES
  * Cycle Detection: Deterministic fail-closed `CycleDetectedError` on direct (A -> A) and indirect (A -> B -> C -> A) cycles
  * Zero Yield: Deterministic fail-closed `ZeroDivisorError`
* **Theoretical Costing (`calculateRecipeCost`)**:
  * Calculates theoretical batch cost and unit cost (`totalCost / yieldQuantity`)
  * Zero-cost ingredients (`0.0000`) fully supported without falsy coercion bugs
  * Missing ingredient cost data fails closed with `InvalidRecipeItemError`
* **Numerics**:
  * Exact scale-4 fixed-point integer arithmetic building on `@trident/core`
  * No IEEE-754 floating point drift
* **Modifier Resolver**:
  * `ModifierRecipeResolver` contract defined as a neutral extensibility interface only
  * Contains ZERO concrete business logic or policy assumptions

---

## 5. Protected Product Owner Decisions (9/9 OPEN)
* `OQ-SSOT-01` (CancellationPolicy): OPEN
* `OQ-SSOT-02` (TransferValidationRule): OPEN
* `OQ-SSOT-03` (CxC / Credit): OPEN
* `OQ-SSOT-04` (Total Void UI): OPEN
* `OQ-SSOT-05` (Replenishment Suggestion): OPEN
* `OQ-SSOT-06` (BillSplitProrationStrategy): OPEN
* `OQ-SSOT-07` (ModifierRecipeResolver Semantics): OPEN
* `OQ-ARCH-01` (Cashier assignment model): OPEN
* `OQ-ARCH-02` (Fiscal stamping timing): OPEN

---

## 6. Verification & Test Execution Evidence

### A. Prettier Code Formatting (`npm run format:check`)
* Result: PASS (All matched files use Prettier code style)

### B. ESLint (`npm run lint`)
* Result: PASS across all 9 workspace packages (0 errors)

### C. TypeScript Typecheck (`npm run typecheck`)
* Result: PASS across all 14 turbo tasks (0 errors)

### D. Architecture Dependency Graph (`npm run graph:check`)
* Result: PASS (44/44 tests passed, 0 failed)

### E. Turbo Build (`npm run build`)
* Result: PASS across all 9 workspace packages

### F. Unit & Domain Tests
* `@trident/inventory`: 22 passed / 0 failed
* `@trident/cloud-server`: 4 passed / 0 failed
* `@trident/pos`: 38 passed / 0 failed
* `@trident/core`: 25 passed / 0 failed
* `@trident/edge`: 168 passed / 0 failed
* `@trident/pos-edge-runtime`: 25 passed / 0 failed
* `@trident/sync`: 40 passed / 0 failed
* `@trident/ui`: 1 passed / 0 failed

### G. PostgreSQL Integration Tests (`@trident/database`)
* Result: 271 passed / 0 failed (including 11 WP-017 inventory database integration tests)
* Cross-Package Integration Suite (`tests/integration/`): 1 passed / 0 failed

### H. Electron Runtime Tests (`npm run --prefix packages/edge test:electron`)
* Result: 10 passed / 0 failed

### I. Environment Limitations
* NONE. Real PostgreSQL and Electron binaries executed locally.

---

## 7. Changed Files Inventory (20 Files Total)
1. `evidence/WP-017_CANONICAL_BUILDER_EVIDENCE.md` [NEW]
2. `package-lock.json` [MODIFY]
3. `packages/cloud-server/package.json` [NEW]
4. `packages/cloud-server/src/index.test.ts` [NEW]
5. `packages/cloud-server/src/index.ts` [NEW]
6. `packages/cloud-server/tsconfig.json` [NEW]
7. `packages/database/migrations/20260904230000_inventory_catalog_and_recipes.sql` [NEW]
8. `packages/database/package.json` [MODIFY]
9. `packages/database/src/index.test.ts` [MODIFY]
10. `packages/database/src/inventory.test.ts` [NEW]
11. `packages/inventory/package.json` [NEW]
12. `packages/inventory/src/errors.ts` [NEW]
13. `packages/inventory/src/index.test.ts` [NEW]
14. `packages/inventory/src/index.ts` [NEW]
15. `packages/inventory/src/modifier-resolver.ts` [NEW]
16. `packages/inventory/src/numerics.ts` [NEW]
17. `packages/inventory/src/recipe-engine.ts` [NEW]
18. `packages/inventory/src/types.ts` [NEW]
19. `packages/inventory/tsconfig.json` [NEW]
20. `turbo.json` [MODIFY]

* **Changed File Count Including Evidence**: 20
* **Unauthorized Files**: 0
* **Governing Documents Modified**: NO
* **PR Created**: NO
* **Merge Executed**: NO
