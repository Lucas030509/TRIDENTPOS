# ACR-2026-018 — WP-019 PROCUREMENT CONTRACT, DATA & INVENTORY AUTHORITY RECONCILIATION

**Status:** PROPOSED / PENDING GOVERNANCE REVIEW  
**Scope:** WP-019 only  
**Canonical Base:** `94826363f3c31fbda5a27388e3ce9d954c13bc64`  
**Protected PO Questions:** 9/9 remain OPEN  
**Primary Open Question:** `OQ-SSOT-05` remains OPEN

---

## 1. Problem Statement

WP-019 currently contains three cross-document contradictions that must be reconciled before implementation:

1. `IMPLEMENTATION_PLAN.md` states physical receiving "updates Kárdex and weighted average cost upon reception confirmation", while the approved Functional Architecture and Module Catalog define Procurement as the authority for suppliers/orders/receipts only and require Inventory effects to occur through the durable event `RecepcionCompraRegistrada`.

2. WP-019 lists line-level objects `orden_compra_partidas` and `recepcion_partidas`, but the frozen `DATA_MODEL.md` only materializes `suppliers`, `purchase_orders`, and `purchase_receipts`, which is insufficient to represent ordered/received ingredient quantities and unit costs.

3. WP-019 acceptance criteria require supervisor authorization when unit-cost variance exceeds a threshold, but no canonical threshold or policy source exists. No numeric threshold may be invented.

This ACR reconciles those contradictions without closing any Product Owner decision.

---

## 2. Canonical Authority Boundaries

### 2.1 Procurement owns

Procurement is the sole authority for:

- suppliers;
- supplier-item commercial catalog/quotes if materialized by WP-019;
- purchase orders;
- purchase-order line items;
- goods receipts;
- goods-receipt line items;
- procurement lifecycle/status;
- procurement price-variance authorization state;
- durable emission of procurement integration events.

### 2.2 Inventory owns

Inventory remains the sole authority for:

- warehouses;
- ingredients;
- `stock_ledger`;
- current stock derived from ledger;
- inventory movement sequencing;
- weighted-average inventory cost authority.

Procurement MUST NOT directly INSERT/UPDATE:

- `stock_ledger`;
- `ingredients.current_average_cost`;
- any mutable inventory balance.

### 2.3 Finance owns

Finance remains the sole authority for accounts payable and financial liability.

WP-019 MUST NOT create or mutate `accounts_payable`.

---

## 3. Canonical Receiving Integration

The canonical integration event is:

`RecepcionCompraRegistrada`

Procurement must emit it durably through the existing:

`cloud_integration_outbox`

inside the SAME PostgreSQL transaction that confirms the receipt.

The event is the only WP-019 handoff authority for Inventory/Finance.

Minimum deterministic payload:

- `recepcionId`
- `organizationId`
- `branchId`
- `supplierId`
- `purchaseOrderId` nullable only if canonical standalone receipt mode permits it
- `warehouseId`
- `receiptNumber`
- `invoiceReference` nullable
- `receivedAt`
- `paymentTerms`
- `items[]`
  - `ingredientId`
  - `orderedQuantity`
  - `previouslyReceivedQuantity`
  - `receivedQuantity`
  - `acceptedUnitCost`
  - `lineAmount`
- `totalAmount`
- correlation/idempotency metadata.

No Inventory or Finance write is performed synchronously by Procurement.

---

## 4. Inventory Consumer Handoff

WP-019 may define/emit the contract needed for Inventory to consume `RecepcionCompraRegistrada`, but WP-019 MUST NOT change Inventory authority.

If WP-018 does not yet contain a canonical receipt consumer, WP-019 may add the minimal Inventory-side event-consumer composition ONLY if explicitly treated as integration plumbing and independently reviewed.

Preferred decomposition:

- Procurement confirms receipt + durable outbox event.
- Inventory subscriber consumes event idempotently and appends canonical `COMPRA` ledger movements.
- Inventory recomputes weighted-average cost under Inventory-owned logic/transaction authority.

No dual-master stock update.

If implementing the Inventory subscriber would expand WP-019 beyond the governed scope or require a new cost algorithm not already canonical, STOP and return:

`HOLD — INVENTORY RECEIPT CONSUMER ARCHITECTURE EXPANSION REQUIRED`

---

## 5. Procurement Physical Model Reconciliation

WP-019 SHALL materialize the missing line-level data required by its frozen scope.

Canonical physical objects:

### 5.1 suppliers

Use canonical English physical naming consistent with current Data Model.

Required tenant-safe candidate key:

`UNIQUE (organization_id, id)`

Required commercial uniqueness:

`UNIQUE (organization_id, code)`

### 5.2 purchase_orders

Required fields include:

- id
- organization_id
- branch_id
- supplier_id
- order_number
- status
- total_amount DECIMAL(12,4)
- created_at
- updated_at where repository convention requires

Tenant-safe composite FKs are mandatory.

### 5.3 purchase_order_items

Required fields include:

- id
- organization_id
- purchase_order_id
- ingredient_id
- ordered_quantity DECIMAL(12,4)
- unit_cost DECIMAL(12,4)
- line_amount DECIMAL(12,4)
- created_at

Required:
- `UNIQUE (organization_id, id)`
- tenant-safe FK to purchase order
- tenant-safe FK to ingredient
- quantity > 0
- unit_cost >= 0

### 5.4 purchase_receipts

Required fields include canonical Data Model fields plus lifecycle timestamps/status needed by WP-019.

### 5.5 purchase_receipt_items

Required fields include:

- id
- organization_id
- purchase_receipt_id
- purchase_order_item_id nullable only if standalone receipt is canonically allowed
- ingredient_id
- received_quantity DECIMAL(12,4)
- accepted_unit_cost DECIMAL(12,4)
- line_amount DECIMAL(12,4)
- created_at

Required tenant-safe FKs and positive received quantity.

---

## 6. Purchase Order Lifecycle

The canonical WP-019 lifecycle is normalized as:

`DRAFT → SENT → PARTIAL → RECEIVED`

with terminal:

`CANCELLED`

Rules:

- `DRAFT`: editable procurement document; no stock effect.
- `SENT`: issued to supplier; no stock effect.
- `PARTIAL`: at least one accepted receipt exists and ordered quantities are not fully received.
- `RECEIVED`: all governed line quantities are fully received.
- `CANCELLED`: terminal procurement cancellation; no destructive inventory reversal is implied.

A purchase order itself never changes stock and never creates AP.

Receipt confirmation is the business event boundary.

Repeated confirmation of the same receipt must be idempotent.

---

## 7. Partial Receiving

For each purchase-order item track deterministically:

- ordered quantity;
- total previously received quantity;
- current receipt quantity;
- cumulative received quantity;
- remaining quantity.

Default implementation MUST NOT silently over-receive beyond ordered quantity.

If over-receipt is not explicitly governed by a frozen Product Owner rule, reject it as:

`OVER_RECEIPT_NOT_AUTHORIZED`

This is a fail-closed integrity rule, not a replenishment policy.

A partial receipt transitions order to `PARTIAL`.

A complete receipt transitions order to `RECEIVED`.

---

## 8. Exact Numerics

All procurement quantities and monetary amounts use canonical fixed-point scale 4.

PostgreSQL:

`DECIMAL(12,4)`

TypeScript/domain:

reuse canonical fixed-point helpers.

Forbidden for authoritative arithmetic:

- `Number(decimalString)`
- `parseFloat`
- binary floating-point financial/quantity arithmetic.

Line amount:

`received_quantity × accepted_unit_cost`

using canonical exact arithmetic.

Order/receipt totals must equal exact sum of governed line amounts.

---

## 9. Price Variance Authorization — Neutral Policy

No canonical numeric variance threshold exists.

WP-019 MUST NOT invent:

- percentage threshold;
- currency threshold;
- default tolerance;
- supplier-specific fallback.

Define a neutral contract such as:

`PurchasePriceVarianceAuthorizationPolicy`

or equivalent.

It receives at minimum:

- supplierId
- ingredientId
- orderedUnitCost
- receivedUnitCost
- organization/branch context
- actor/authorization context if present.

It returns a deterministic authorization disposition.

### 9.1 No policy available

If:

`receivedUnitCost == orderedUnitCost`

receipt may proceed without variance authorization.

If:

`receivedUnitCost != orderedUnitCost`

and no authorized policy is available:

do NOT invent a threshold.

Return/persist a fail-closed state equivalent to:

`PRICE_VARIANCE_POLICY_REQUIRED`

and do not confirm the receipt.

### 9.2 Policy available

An injected authorized policy may determine whether:

- no supervisor authorization is required;
- supervisor authorization is required;
- receipt is rejected.

Tests may inject deterministic TEST policies.

TEST policy behavior MUST be labeled:

`TEST ONLY — NOT PRODUCT OWNER POLICY`

No threshold becomes canonical through tests.

---

## 10. ReplenishmentSuggestionProvider

WP-019 SHALL define the neutral interface:

`ReplenishmentSuggestionProvider`

or canonical equivalent.

It MUST NOT implement a concrete replenishment algorithm.

`OQ-SSOT-05` remains OPEN.

No default:

- min/max;
- reorder point;
- consumption-average;
- lead-time formula;
- forecast.

If no provider is configured, suggestion generation is unavailable rather than guessed.

---

## 11. RLS & Tenant Integrity

All WP-019 tables MUST use:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- fail-closed `current_app_org_id()` policy.

All cross-table relationships must use tenant-safe composite FKs where candidate keys exist.

A UUID from another tenant must never satisfy a Procurement relation.

---

## 12. Idempotency

Receipt confirmation MUST have a stable idempotency identity.

At minimum, prevent duplicate durable business effect for the same canonical receipt.

Retry must produce:

- one confirmed receipt;
- one set of receipt lines;
- one `RecepcionCompraRegistrada` outbox event;
- deterministic prior-result / duplicate-accepted behavior.

No duplicate Inventory `COMPRA` movement may be caused by a Procurement event retry.

---

## 13. Cancellation / Return Boundary

WP-019 rollback text "Cancel PO or generate goods return movement" is normalized as follows:

- Unreceived PO: may be cancelled according to lifecycle.
- Confirmed physical receipt: MUST NOT be destructively deleted or silently cancelled to undo inventory.
- A post-receipt physical return requires a new compensating business flow/event and is NOT automatically implemented by WP-019 unless explicitly frozen elsewhere.

Do not invent supplier-return business semantics.

---

## 14. Finance Boundary

WP-020 consumes `RecepcionCompraRegistrada` to create AP.

WP-019 does not create AP.

Payment terms may be carried as event data for downstream Finance.

Finance remains optional by Capability Contract.

---

## 15. API Surface

The Implementation Plan mentions:

- `POST /compras/ordenes`
- `POST /compras/recepciones`

These paths may be exposed only if consistent with the current Cloud API/composition conventions.

The domain/application contracts are authoritative; HTTP transport must not become the business-rule authority.

No UI is included in WP-019.

---

## 16. Required Acceptance Evidence

WP-019 implementation must prove at minimum:

1. Supplier tenant isolation.
2. PO lifecycle DRAFT → SENT → PARTIAL → RECEIVED.
3. Cancel unreceived PO.
4. Partial receipt exact remaining quantity.
5. Over-receipt fail-closed.
6. Exact scale-4 totals.
7. Price variance with equal price requires no policy.
8. Price variance with unequal price + no policy fails closed.
9. Injected TEST authorization policy can require supervisor authorization.
10. Test policy explicitly not Product Owner policy.
11. Receipt confirmation and `RecepcionCompraRegistrada` outbox enqueue are atomic.
12. Receipt retry is idempotent.
13. Procurement does not write `stock_ledger`.
14. Procurement does not write `ingredients.current_average_cost`.
15. Procurement does not write `accounts_payable`.
16. ReplenishmentSuggestionProvider is contract-only.
17. `OQ-SSOT-05` remains OPEN.
18. 9/9 protected PO questions remain OPEN.
19. Migration rollback in non-production removes only WP-019 objects and preserves Platform Core, WP-017, WP-018 and existing outbox.
20. Real PostgreSQL RLS/cross-tenant tests pass.

---

## 17. Governance Effect

This ACR changes no Product Owner business decision.

It reconciles technical authority and missing implementation contracts required to implement the already-approved WP-019 without violating Modular-by-Design / Integrated-by-Contract.

Until approved and canonical:

**WP-019 BUILDER START = HOLD**
