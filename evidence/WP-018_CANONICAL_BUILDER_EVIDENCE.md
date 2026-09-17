# TRIDENTPOS — WP-018 CANONICAL BUILDER EVIDENCE

## 1. Canonical Identification & Lineage
* **Work Package**: WP-018 — Real-Time Kárdex, Waste Tracking & KDS Depletion Service
* **Governing Specification**: `ACR-2026-017` / `ACR-2026-017_CURRENT_STATE.md`
* **Canonical Base SHA**: `ea409360dca4e1f133f516a45eb06890e480c253` (`origin/main`)
* **Base Verification**: PASS (exact match with canonical baseline)
* **Implementation Branch**: `feat/wp-018-kardex-kds-depletion-canonical`
* **Role**: `13_Backend_Developer` (BUILDER ONLY)
* **Governance Enforcement**: Builder Only mode active. Antigravity does not open PRs, merge, self-approve, or alter governing documentation.

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
* **Database Package**: `@trident/database` (`packages/database`)
  * Hosts SQL migration `20260905000000_inventory_kardex_kds_depletion.sql` and PostgreSQL integration tests
* **Dependency Graph Enforcement**: PASS (`npm run graph:check` — 44/44 tests passing)

---

## 3. Database Migration & Schema Ownership
* **Migration File**: `packages/database/migrations/20260905000000_inventory_kardex_kds_depletion.sql`
* **Physical Tables Created**:
  1. `stock_ledger`
  2. `inventory_waste_records`
  3. `inventory_quarantine_records`
* **Derived Stock Balance Guarantee**:
  * Mutable `stock_actual` Created: NO (Derived balance is computed via `COALESCE(SUM(quantity_delta), 0.0000)` from `stock_ledger`)
  * Read-only View: `v_ingredient_current_stock`
* **Append-Only & Immutability Enforcement**:
  * Trigger `trg_stock_ledger_immutable`: Blocks any `UPDATE` or `DELETE` on `stock_ledger` (fail-closed PostgreSQL exception: `stock_ledger entries are strictly append-only and immutable`).
  * Idempotency Constraint: Unique `uq_stock_ledger_idempotency` on `(organization_id, branch_id, reference_type, reference_id, ingredient_id)`.
  * Movement Sequence Constraint: Unique `uq_stock_ledger_seq` on `(organization_id, branch_id, warehouse_id, ingredient_id, sequence_num)`.
  * Non-Zero Delta Constraint: `chk_stock_ledger_nonzero_delta` (`quantity_delta <> 0`).
  * Movement Types: `chk_stock_ledger_movement_type` restricts to canonical set (`COMPRA`, `VENTA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_POSITIVO`, `AJUSTE_NEGATIVO`, `TRANSFERENCIA_ENTRADA`, `TRANSFERENCIA_SALIDA`, `PRODUCCION_ENTRADA`, `PRODUCCION_SALIDA`).
* **Waste Integrity Trigger**:
  * Trigger `trg_waste_record_integrity`: Enforces that any linked `stock_ledger` record has `movement_type = 'MERMA'` and `quantity_delta < 0`.
* **Quarantine Enforcement**:
  * Status Constraint: `chk_inventory_quarantine_status` (`PENDING`, `REPLAYED`, `REJECTED`).
  * Unique Source Event: `uq_inventory_quarantine_event` on `(organization_id, source_event_type, source_event_id)`.
* **Row-Level Security (RLS)**:
  * `ENABLE ROW LEVEL SECURITY` on all 3 tables: YES
  * `FORCE ROW LEVEL SECURITY` on all 3 tables: YES
  * Fail-closed tenant context via `current_app_org_id()`: YES
  * Unauthenticated default-deny verified: YES (0 visible rows)
* **Down Migration Policy**:
  * Clean `DROP TABLE IF EXISTS` without `CASCADE` in reverse dependency order (`inventory_waste_records` -> `inventory_quarantine_records` -> `stock_ledger` -> `v_ingredient_current_stock`).
  * Successfully verified in `WP018-DOWN-01` without affecting Platform Core or WP-017 tables.

---

## 4. Domain & Service Capabilities

### A. Pure Domain (`@trident/inventory`)
* **Numerics**: Exact scale-4 arithmetic functions (`negateScale4`, `absScale4`) built on `@trident/core`.
* **Validation**:
  * `validateWasteCommand`: Validates reason, positive quantity delta (auto-negated), scale-4 string format, and evidence URL.
  * `validateMovementType`: Validates canonical movement type strings.
  * `aggregateIngredientQuantities`: Deterministically merges item-level gross ingredient demands with exact decimal sums.
* **Errors**: Type-safe domain errors (`InvalidWasteCommandError`, `InvalidMovementTypeError`, `InvalidQuantityDeltaError`, `ModifierQuarantineError`).

### B. Cloud Server Composition (`@trident/cloud-server`)
* **Transaction & Concurrency Management**:
  * Wraps operations in `withTenantTransaction(this.pool, organizationId, callback)` from `@trident/database`.
  * Employs PostgreSQL advisory transaction locks (`pg_advisory_xact_lock(hashtext(...))`) per warehouse/ingredient to serialize sequence numbers and prevent concurrency anomalies.
* **`getCurrentStock(organizationId, branchId, warehouseId, ingredientId)`**:
  * Computes derived stock sum from immutable ledger entries.
  * Returns `0.0000` for uninitialized aggregates.
* **`registerWaste(command)`**:
  * Validates waste parameters.
  * Atomically inserts append-only `MERMA` movement in `stock_ledger` and metadata record in `inventory_waste_records`.
  * Evaluates post-movement derived balance and returns `NegativeStockSignal` if balance drops below `0.0000`.
  * Idempotent execution on `commandId` (subsequent calls return existing waste record and balance).
* **`onKdsOrderProduced(event, modifierResolver)`**:
  * Reconciles KDS order production into gross ingredient deductions (`CONSUMO_KDS`).
  * Explodes recipes via `@trident/inventory` `RecipeEngine.explodeIngredients` with subrecipe yield scaling.
  * Checks for modifier items; if modifiers are present and no `modifierResolver` is supplied, quarantines the event in `inventory_quarantine_records` and fails closed.
  * Deducts aggregated gross ingredient quantities via atomic `stock_ledger` entries.
  * Enqueues transactional outbox event `InventarioDescontadoPorReceta` via existing `CloudIntegrationOutboxService` (`cloud_integration_outbox`).
  * Guarantees idempotency on duplicate `orderId`: returns `DUPLICATE_ACCEPTED` with 0 new deductions.
* **`replayQuarantinedDepletion(quarantineId, organizationId, resolver)`**:
  * Replays quarantined events with custom modifier resolvers.
  * Atomically executes KDS depletion and marks quarantine record status `REPLAYED`.
* **`getQuarantineRecords(organizationId, filter)`**:
  * Lists tenant quarantine records with optional status filtering under strict RLS.

---

## 5. Protected Product Owner Decisions (9/9 OPEN)
* `OQ-SSOT-01` (CancellationPolicy): OPEN
* `OQ-SSOT-02` (TransferValidationRule): OPEN
* `OQ-SSOT-03` (CxC / Credit): OPEN
* `OQ-SSOT-04` (Total Void UI): OPEN
* `OQ-SSOT-05` (Replenishment Suggestion / Algorithm): OPEN (Protected — No automated reordering assumptions built)
* `OQ-SSOT-06` (BillSplitProrationStrategy): OPEN
* `OQ-SSOT-07` (ModifierRecipeResolver Semantics): OPEN (Protected — Modifier-bearing KDS events quarantined by default unless resolver injected)
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
* `@trident/inventory`: 27 passed / 0 failed (22 WP-017 + 5 WP-018 domain tests)
* `@trident/cloud-server`: 16 passed / 0 failed (7 WP-017 + 9 WP-018 composition tests)
* `@trident/pos`: 38 passed / 0 failed
* `@trident/core`: 25 passed / 0 failed
* `@trident/edge`: 168 passed / 0 failed
* `@trident/pos-edge-runtime`: 25 passed / 0 failed
* `@trident/sync`: 40 passed / 0 failed
* `@trident/ui`: 1 passed / 0 failed

### G. PostgreSQL Integration Tests (`@trident/database`)
* Result: 286 passed / 0 failed (including 13 WP-017 + 14 WP-018 database integration tests covering WP018-DB-01..13, RLS, Force RLS, immutability, foreign keys, and WP018-DOWN-01 non-destructive rollback)
* Cross-Package Integration Suite (`tests/integration/`): 1 passed / 0 failed

### H. Electron Runtime Tests (`npm run --prefix packages/edge test:electron`)
* Result: 10 passed / 0 failed

---

## 7. Changed Files Inventory

### WP-018 Files (13 Files Total)
1. `evidence/WP-018_CANONICAL_BUILDER_EVIDENCE.md` [NEW]
2. `packages/database/migrations/20260905000000_inventory_kardex_kds_depletion.sql` [NEW]
3. `packages/database/src/index.test.ts` [MODIFY]
4. `packages/database/src/inventory.test.ts` [MODIFY]
5. `packages/database/src/outbox.test.ts` [MODIFY]
6. `packages/inventory/src/errors.ts` [MODIFY]
7. `packages/inventory/src/index.test.ts` [MODIFY]
8. `packages/inventory/src/index.ts` [MODIFY]
9. `packages/inventory/src/kardex-domain.ts` [NEW]
10. `packages/inventory/src/numerics.ts` [MODIFY]
11. `packages/inventory/src/types.ts` [MODIFY]
12. `packages/cloud-server/src/index.test.ts` [MODIFY]
13. `packages/cloud-server/src/index.ts` [MODIFY]

* **Effective Builder Evidence Files**: 1
* **Unauthorized Files**: 0
* **Governing Documents Modified**: NO
* **PR Created**: NO
* **Merge Executed**: NO
