# TRIDENTPOS — WP-019 CANONICAL BUILDER EVIDENCE (R2)

## 1. Canonical Identification & Lineage
* **Work Package**: WP-019 — Procurement, Supplier Management & Physical Receiving
* **Governing Specification**: `ARCHITECTURE_CHANGE_REQUEST_WP019_PROCUREMENT_RECONCILIATION.md` (ACR-2026-018)
* **Canonical Base SHA**: `10e5f284508738336f89e1d3361fc9a7bb2311dc` (`origin/main`)
* **Base Verification**: PASS (exact match with canonical baseline)
* **R1 Frozen Subject**: `78124431054bab2efe33329951f46afc38663f75` (immutable baseline for R2)
* **Implementation Branch**: `feat/wp-019-procurement-supplier-receiving-r2`
* **Role**: `13_Backend_Developer` (BUILDER ONLY)
* **Governance Enforcement**: Builder Only mode active. Antigravity does not open PRs, merge, self-approve, or alter governing documentation.

---

## 2. Package Topology & Boundaries
* **Pure Domain Package**: `@trident/procurement` (`packages/procurement`)
  * Runtime Dependencies: `@trident/core` ONLY
  * Dependency on `@trident/pos`: NO
  * Dependency on `@trident/edge`: NO
  * Dependency on `@trident/database`: NO
  * Dependency on `@trident/inventory`: NO
* **Cloud Composition Root**: `@trident/cloud-server` (`packages/cloud-server`)
  * Runtime Dependencies: `@trident/core`, `@trident/database`, `@trident/inventory`, `@trident/procurement`
  * Dependency on `@trident/pos`: NO
* **Database Package**: `@trident/database` (`packages/database`)
  * Hosts SQL migration `20260905010000_procurement_supplier_receiving.sql` and PostgreSQL integration tests
* **Dependency Graph Enforcement**: PASS (`npm run graph:check` — 44/44 tests passing)

---

## 3. Database Migration & Actual Schema Constraints
* **Migration File**: `packages/database/migrations/20260905010000_procurement_supplier_receiving.sql`
* **Physical Tables Created**:
  1. `suppliers`
  2. `purchase_orders`
  3. `purchase_order_items`
  4. `purchase_receipts`
  5. `purchase_receipt_items`
* **Actual Physical Constraints Present in Schema**:
  * `suppliers`:
    * `chk_suppliers_code_nonempty`: `CHECK (length(trim(code)) > 0)`
    * `chk_suppliers_trade_name_nonempty`: `CHECK (length(trim(trade_name)) > 0)`
    * `chk_suppliers_tax_id_nonempty`: `CHECK (length(trim(tax_id)) > 0)`
    * `chk_suppliers_credit_days_nonnegative`: `CHECK (credit_days >= 0)`
    * `uq_suppliers_org_id`: `UNIQUE (organization_id, id)`
    * `uq_suppliers_org_code`: `UNIQUE (organization_id, code)`
    * Foreign Key: `organization_id` REFERENCES `organizations(id)`
  * `purchase_orders`:
    * `chk_purchase_orders_number_nonempty`: `CHECK (length(trim(order_number)) > 0)`
    * `chk_purchase_orders_status`: `CHECK (status IN ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'))`
    * `chk_purchase_orders_total_nonnegative`: `CHECK (total_amount >= 0.0000)`
    * `uq_purchase_orders_org_id`: `UNIQUE (organization_id, id)`
    * `uq_purchase_orders_org_branch_number`: `UNIQUE (organization_id, branch_id, order_number)`
    * `fk_purchase_orders_branch`: `FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
    * `fk_purchase_orders_supplier`: `FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id)`
  * `purchase_order_items`:
    * `chk_po_items_qty_positive`: `CHECK (ordered_quantity > 0.0000)`
    * `chk_po_items_cost_nonnegative`: `CHECK (unit_cost >= 0.0000)`
    * `chk_po_items_amount_nonnegative`: `CHECK (line_amount >= 0.0000)`
    * `uq_purchase_order_items_org_id`: `UNIQUE (organization_id, id)`
    * `fk_po_items_po`: `FOREIGN KEY (organization_id, purchase_order_id) REFERENCES purchase_orders(organization_id, id)`
    * `fk_po_items_ingredient`: `FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id)`
  * `purchase_receipts`:
    * `chk_purchase_receipts_number_nonempty`: `CHECK (length(trim(receipt_number)) > 0)`
    * `chk_purchase_receipts_status`: `CHECK (status IN ('CONFIRMED', 'CANCELLED'))`
    * `chk_purchase_receipts_total_nonnegative`: `CHECK (total_amount >= 0.0000)`
    * `uq_purchase_receipts_org_id`: `UNIQUE (organization_id, id)`
    * `uq_purchase_receipts_org_branch_number`: `UNIQUE (organization_id, branch_id, receipt_number)`
    * `fk_purchase_receipts_branch`: `FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
    * `fk_purchase_receipts_po`: `FOREIGN KEY (organization_id, purchase_order_id) REFERENCES purchase_orders(organization_id, id)`
    * `fk_purchase_receipts_supplier`: `FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id)`
    * `fk_purchase_receipts_warehouse`: `FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses(organization_id, id)`
  * `purchase_receipt_items`:
    * `chk_receipt_items_qty_positive`: `CHECK (received_quantity > 0.0000)`
    * `chk_receipt_items_cost_nonnegative`: `CHECK (accepted_unit_cost >= 0.0000)`
    * `chk_receipt_items_amount_nonnegative`: `CHECK (line_amount >= 0.0000)`
    * `uq_purchase_receipt_items_org_id`: `UNIQUE (organization_id, id)`
    * `fk_receipt_items_receipt`: `FOREIGN KEY (organization_id, purchase_receipt_id) REFERENCES purchase_receipts(organization_id, id)`
    * `fk_receipt_items_po_item`: `FOREIGN KEY (organization_id, purchase_order_item_id) REFERENCES purchase_order_items(organization_id, id)`
    * `fk_receipt_items_ingredient`: `FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id)`
* **Row-Level Security (RLS)**:
  * `ENABLE ROW LEVEL SECURITY` on all 5 tables: YES
  * `FORCE ROW LEVEL SECURITY` on all 5 tables: YES
  * Fail-closed tenant context via `organization_id = current_app_org_id()`: YES
  * Unauthenticated default-deny verified: YES (0 visible rows)
* **Down Migration Policy**:
  * Clean `DROP TABLE IF EXISTS` without `CASCADE` in reverse dependency order (`purchase_receipt_items` -> `purchase_receipts` -> `purchase_order_items` -> `purchase_orders` -> `suppliers`).
  * Verified in `WP019-DOWN-01` without affecting WP-018, WP-017, or Platform Core tables.

---

## 4. R2 Remediation: Idempotency, Line Revalidation & Authoritative Reconstruction

### A. Stable Identity Revalidation (Blocker 2 Resolution)
When an existing receipt matches `(organization_id, branch_id, receipt_number)`:
* Revalidates `existingReceipt.purchase_order_id === command.purchaseOrderId`
* Revalidates `existingReceipt.supplier_id === command.supplierId`
* Revalidates `existingReceipt.warehouse_id === command.warehouseId`
* If any stable field differs: **FAILS CLOSED** with `ReceiptIdempotencyConflictError` (`RECEIPT_IDEMPOTENCY_CONFLICT`).

### B. Line-Level Order-Independent Revalidation
* Verifies item array lengths match: `existingItems.length === command.items.length`
* Deterministically sorts both item lists by `(purchaseOrderItemId, ingredientId)`
* Compares exact line-level fields:
  * `purchaseOrderItemId`
  * `ingredientId`
  * `receivedQuantity` (exact Scale-4 string comparison via `parseDecimal12x4`)
  * `acceptedUnitCost` (exact Scale-4 string comparison via `parseDecimal12x4`)
* If any line detail differs: **FAILS CLOSED** with `ReceiptIdempotencyConflictError`.

### C. Authoritative Prior-Event Reconstruction from Durable Outbox (Blocker 3 Resolution)
* On `DUPLICATE_ACCEPTED`, the returned `eventPayload` is reconstructed strictly from the durable `cloud_integration_outbox` row corresponding to the receipt (`event_type = 'RecepcionCompraRegistrada'`).
* **Zero placeholder quantities**: Returns the actual committed `orderedQuantity`, `previouslyReceivedQuantity`, and `remainingQuantity`.
* **Retry payment terms ignored as authority**: The original committed `paymentTerms` from the historical outbox payload is preserved and returned.
* **Missing Outbox Row**: If the outbox row is missing, **FAILS CLOSED** with `ReceiptOutboxIntegrityError` (`RECEIPT_OUTBOX_INTEGRITY_ERROR`).

### D. Distinct-Receipt Concurrency & Over-Receipt Prevention (Blocker 4 Resolution)
* Concurrency test `R2-CLOUD-05`:
  * PO Item ordered quantity: `10.0000`.
  * Receipt A: `receiptNumber = 'REC-R2-CONC-DIST-A'`, `receivedQuantity = '6.0000'`.
  * Receipt B: `receiptNumber = 'REC-R2-CONC-DIST-B'`, `receivedQuantity = '6.0000'`.
  * Executed simultaneously with `Promise.allSettled()`.
  * Result: Exactly one receipt applies (`status = 'APPLIED'`), and the competing receipt is rejected fail-closed with `OverReceiptNotAuthorizedError` (`OVER_RECEIPT_NOT_AUTHORIZED`).
  * Cumulative received quantity in database is exactly `6.0000` (<= `10.0000`), never `12.0000`.
  * Exactly 1 outbox event for the applied receipt, 0 outbox events for the rejected receipt.
  * Zero deadlocks.

---

## 5. Domain Invariants & Authority Boundaries
* **Strict Scale-4 Decimal Arithmetic**: All quantities, costs, and amounts use integer string Scale-4 arithmetic (`DECIMAL(12, 4)` / `10000` base). Zero floating-point arithmetic.
* **Direct Stock / AP Writes**: ZERO direct writes to `stock_ledger`, `current_average_cost`, or `accounts_payable` from procurement. Verified in `WP019-CLOUD-09`.
* **Open Questions**: `OQ-SSOT-05` (Replenishment algorithm) remains **OPEN**; neutral `ReplenishmentSuggestionProvider` contract interface provided.

---

## 6. Verification & Test Evidence Matrix

| Suite | Tests Total | Tests Passed | Status |
| :--- | :--- | :--- | :--- |
| **@trident/procurement Unit Tests** | 11 | 11 | **PASS** |
| **@trident/database Integration Suite** | 295 (9 WP-019) | 295 | **PASS** |
| **@trident/cloud-server Integration Suite** | 47 (16 WP-019 / R2) | 47 | **PASS** |
| **Monorepo Dependency Graph (`graph:check`)** | 44 | 44 | **PASS** |
| **Cross-Package Integration E2E (`test:integration`)** | 2 | 2 | **PASS** |
| **Electron Hardened Runtime (`test:electron`)** | 10 | 10 | **PASS** |
| **Prettier & ESLint (`format:check`, `lint`)** | Clean | Clean | **PASS** |
| **TypeScript Typecheck (`typecheck`)** | 10 packages | 10 packages | **PASS** |

---

## 7. Conclusion & Readiness
All blockers identified in R1 Quick Integrity are surgically resolved. WP-019 R2 is fully verified and ready for independent review.
