# TRIDENTPOS — WP-018 CANONICAL BUILDER EVIDENCE (R2)

## 1. Canonical Identification & Lineage
* **Work Package**: WP-018 — Real-Time Kárdex, Waste Tracking & KDS Depletion Service
* **Governing Specification**: `ACR-2026-017` / `ACR-2026-017_CURRENT_STATE.md`
* **Canonical Base SHA**: `ea409360dca4e1f133f516a45eb06890e480c253` (`origin/main`)
* **Base Verification**: PASS (exact match with canonical baseline)
* **Implementation Branch**: `feat/wp-018-kardex-kds-depletion-canonical-r2`
* **Historical R1 Frozen Subject**: `9ac332c0468173f073752ab981bde924e760cf4c` (immutable / superseded by R2)
* **Quick Integrity R1 Sidecar**: `review/wp-018-quick-integrity-r1` (`789889d9db4716af30c08b4acf57ed247df7e075`)
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
  * Mutable `stock_actual` Created: NO (Derived balance is computed via application query `COALESCE(SUM(quantity_delta), 0.0000)` from `stock_ledger`)
  * SQL View `v_ingredient_current_stock` Created: NO (balance is an application query over `stock_ledger` per ACR-2026-017 §3.2)
* **Append-Only & Immutability Enforcement**:
  * Trigger `trg_stock_ledger_immutable`: Blocks any `UPDATE` or `DELETE` on `stock_ledger` (fail-closed PostgreSQL exception: `Stock ledger is append-only: UPDATE and DELETE operations are strictly prohibited on stock_ledger`).
  * Candidate Key: `uq_stock_ledger_org_id` on `(organization_id, id)`.
  * Movement Sequence Constraint: `uq_stock_ledger_seq` on `(organization_id, branch_id, warehouse_id, ingredient_id, movement_sequence_number)`.
  * Idempotency Constraint: `uq_stock_ledger_idempotency` on `(organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)`.
  * Non-Zero Delta Constraint: `chk_stock_ledger_quantity_delta_nonzero` (`quantity_delta <> 0.0000`).
  * Movement Types: `chk_stock_ledger_movement_type` restricts to canonical set (`COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`).
  * Composite Tenant FKs: `fk_stock_ledger_branch`, `fk_stock_ledger_warehouse`, `fk_stock_ledger_ingredient`.
* **Waste Integrity & Evidence**:
  * Mandatory Fields Constraints: `chk_waste_records_reason_nonempty` (`length(trim(reason_code)) > 0`), `chk_waste_records_photo_nonempty` (`length(trim(photo_attachment_url)) > 0`).
  * Uniqueness Constraints: `uq_waste_records_org_id` on `(organization_id, id)`, `uq_waste_records_org_cmd` on `(organization_id, command_id)`, `uq_waste_records_org_ledger` on `(organization_id, stock_ledger_id)`.
  * Composite Tenant FKs: `fk_waste_records_branch`, `fk_waste_records_warehouse`, `fk_waste_records_ingredient`, `fk_waste_records_ledger`, `fk_waste_records_actor`.
  * Semantic Trigger `trg_waste_record_integrity`: Enforces that linked `stock_ledger` record has `movement_type = 'MERMA'` and `quantity_delta < 0`.
* **Quarantine Persistence**:
  * Status Constraint: `chk_quarantine_records_status` (`status IN ('PENDING', 'REPLAYED', 'REJECTED')`).
  * Candidate Key: `uq_quarantine_records_org_id` on `(organization_id, id)`.
  * Unique Source Event: `uq_quarantine_records_source` on `(organization_id, branch_id, source_event_id)`.
  * Composite Tenant FK: `fk_quarantine_records_branch`.
* **Row-Level Security (RLS)**:
  * `ENABLE ROW LEVEL SECURITY` on all 3 tables: YES
  * `FORCE ROW LEVEL SECURITY` on all 3 tables: YES
  * Fail-closed tenant context via `organization_id = current_app_org_id()`: YES
  * Unauthenticated default-deny verified: YES (0 visible rows)
* **Down Migration Policy**:
  * Clean `DROP TABLE IF EXISTS` without `CASCADE` in reverse dependency order (`inventory_quarantine_records` -> `inventory_waste_records` -> `stock_ledger`).
  * Successfully verified in `WP018-DOWN-01` without affecting Platform Core, WP-017, or WP-012 tables.

---

## 4. Quick Integrity R2 Remediations & Technical Capabilities

### A. QI-BLK-018-01 Resolution: Complete Modifier Resolution Fails Closed
* In `applyKdsDepletionWithClient()`: When items have `selectedModifiers`, the service upfront validates that all modifiers can be resolved by the injected `ModifierRecipeResolver`.
* If no resolver is provided, OR if `resolveModifierImpact()` returns `null`, `undefined`, or throws for ANY modifier on any item, the execution immediately aborts before inserting any `stock_ledger` row or enqueueing any outbox event.
* The original source event is safely and idempotently saved in `inventory_quarantine_records` with status `PENDING` and reason `MODIFIER_RECIPE_RESOLUTION_PENDING`.
* Verified by tests `WP018-CLOUD-07`, `WP018-CLOUD-10`, and `WP018-CLOUD-11`: 0 stock_ledger movements and 0 outbox entries are produced when any modifier is unresolved.

### B. QI-BLK-018-02 Resolution: Complete `removedIngredients` and `additionalIngredients` Handling
* When all modifiers are resolved by the authorized resolver:
  * `removedIngredients`: For the specific item ordered, any ingredient in `impact.removedIngredients` is excluded from that item's recipe explosion (omitted from deduction).
  * `additionalIngredients`: Gross quantities are scaled by the item's scale factor and added to the gross ingredients list for that item.
* Verified by test `WP018-CLOUD-12`: Ordered burgers with `mod-no-meat` (`removedIngredients: [ingMeatId]`) and `mod-extra-cheese` (`additionalIngredients: [ingCheeseId]`) produce exactly 0 meat deducted, +0.2000 KG cheese deducted, and normal bun deduction.

### C. QI-BLK-018-03 Resolution: Atomic Quarantine Replay Transaction Topology
* Refactored core KDS depletion logic to `applyKdsDepletionWithClient(client, event, resolver)`.
* `replayQuarantinedDepletion()` opens a single authoritative tenant transaction on `client`, locks the quarantine row `FOR UPDATE`, applies the depletion logic on `client`, and transitions the quarantine status to `REPLAYED` on `client`.
* Verified by test `WP018-CLOUD-13`: Controlled failure before transaction commit completely rolls back depletion (0 ledger movements, 0 outbox events) and leaves quarantine safely `PENDING`.
* Verified by test `WP018-CLOUD-14`: Replay retry on an already replayed order returns `DUPLICATE_ACCEPTED` with 0 duplicate movements and 0 duplicate outbox events.

### D. QI-BLK-018-04 Resolution: Truthful Facts-Based Builder Evidence
* All false claims from R1 evidence have been corrected:
  * No `v_ingredient_current_stock` view claimed (balance is an application query).
  * Accurate idempotency constraint columns `(organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)`.
  * Accurate sequence column `movement_sequence_number`.
  * Accurate movement types `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`.
  * Accurate quarantine constraint names `chk_quarantine_records_status`, `uq_quarantine_records_source`.
  * Accurate Down migration table list without non-existent views.

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
* `@trident/cloud-server`: 20 passed / 0 failed (7 WP-017 + 13 WP-018 composition tests including WP018-CLOUD-01..08, WP018-CLOUD-10..14)
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

### WP-018 R2 Files (13 Files Total)
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
