# WP-019 R1 — QUICK INTEGRITY

**Frozen Subject:** `78124431054bab2efe33329951f46afc38663f75`
**Canonical Base:** `10e5f284508738336f89e1d3361fc9a7bb2311dc`
**Verdict:** HOLD

## Lineage / Scope

PASS:
- exact direct child of canonical main;
- ahead 1 / behind 0;
- merge-base exact canonical main;
- recovered remote branch tip equals Frozen Subject;
- no PR exists;
- no governing documents changed;
- Procurement package boundary is physically present and runtime-depends only on @trident/core.

## Blockers

### QI-BLK-019-01 — Builder evidence is materially inaccurate

`evidence/WP-019_CANONICAL_BUILDER_EVIDENCE.md` claims schema constraints/candidate keys that do not exist in the actual migration, including:
- `uq_suppliers_org_tax_id`
- `uq_purchase_orders_org_number`
- `uq_purchase_receipts_org_number`
- `fk_suppliers_org`

The migration instead contains, among others:
- `uq_suppliers_org_id`
- `uq_suppliers_org_code`
- `uq_purchase_orders_org_branch_number`
- `uq_purchase_receipts_org_branch_number`

Evidence must describe physical facts exactly.

### QI-BLK-019-02 — Mandatory concurrency evidence is incomplete

The governed WP-019 work order required a real PostgreSQL test proving that two DISTINCT concurrent partial receipts cannot over-receive the same PO/item.

Current cloud tests include concurrent SAME receipt-number idempotency, but no distinct-receipt over-receipt race test.

### QI-BLK-019-03 — Receipt idempotency identity collision is not fail-closed

`confirmPurchaseReceipt()` looks up an existing receipt by:
`(organization_id, branch_id, receipt_number)`

and immediately returns `DUPLICATE_ACCEPTED` without proving the existing receipt belongs to the same:
- purchaseOrderId
- supplierId
- warehouseId
- canonical receipt payload/line identity

A caller reusing the same receipt number for a different purchase order can be treated as a successful duplicate of an unrelated receipt.

### QI-BLK-019-04 — Duplicate result reconstructs non-authoritative event data

On duplicate receipt return, the reconstructed `RecepcionCompraRegistradaPayload` injects:
- `orderedQuantity = 0.0000`
- `previouslyReceivedQuantity = 0.0000`
- `remainingQuantity = 0.0000`
- `paymentTerms` from the retry command rather than durable original state

This is not a deterministic prior-result reconstruction.

## Result

WP-019 R1 is NOT authorized for Specialist Review / PR Gate.

Remediate as R2 from the exact R1 Frozen Subject without modifying R1.
