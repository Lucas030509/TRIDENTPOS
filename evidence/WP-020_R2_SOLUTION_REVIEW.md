# WP-020 R2 — SOLUTION ARCHITECT REVIEW

**Frozen Subject:** `fa2ea8d09ba4c3ec02e1ec0d15d1d5442d7a5ef0`
**Reviewer:** 01_Solution_Architect
**Verdict:** HOLD
**Blockers:** 1
**Advisories:** 1

## Confirmed

- @trident/finance remains runtime-dependent only on @trident/core.
- Payment-term semantics are neutralized behind a resolver contract.
- POS→Finance Corte Z integration is honestly marked BLOCKED BY CONTRACT.
- Finance core cash reconciliation is independent of POS.
- AP/AR/reconciliation retries now perform semantic revalidation.
- OQ-SSOT-03 remains OPEN.

## SA-BLK-020-R2-01 — Finance persistence is physically coupled to Procurement

The WP-020 migration defines:

- `fk_ap_supplier FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(...)`
- `fk_ap_purchase_receipt FOREIGN KEY (organization_id, purchase_receipt_id) REFERENCES purchase_receipts(...)`

This makes Finance deployment/runtime data persistence depend physically on Procurement tables.

That conflicts with canonical architecture:
- MODULAR BY DESIGN — INTEGRATED BY CONTRACT;
- Finance and Procurement are separate bounded contexts;
- Procurement emits `RecepcionCompraRegistrada`;
- Finance consumes the event and owns AP;
- modules must remain usable in standalone/selective deployments;
- cross-context identifiers should remain external aggregate references unless a governed shared-core relationship exists.

The event is the integration authority. Finance must not require Procurement tables to exist merely to persist AP.

### Required remediation

In the unmerged WP-020 migration:
- keep `supplier_id` and `purchase_receipt_id` as required external identity fields;
- REMOVE Finance→Procurement foreign keys;
- retain Finance-owned unique/idempotency constraints, especially `UNIQUE (organization_id, purchase_receipt_id)`;
- retain branch tenant-safe FK because Branch is Platform Core;
- add DB tests proving AP can be inserted from a valid event identity without a physical Procurement FK dependency;
- update evidence accurately.

Do not remove Procurement event semantics or idempotency.

## Advisory SA-ADV-020-R2-01

`ProcessPurchaseReceiptOptions.dueDate` permits an explicitly resolved due date to be supplied without a resolver. This can be acceptable as an adapter-provided resolved fact, but evidence should state it is an externally resolved input and not a Finance product policy. Do not claim Finance derives it canonically.

**Solution Architect: HOLD — R3 surgical persistence-boundary remediation required.**
