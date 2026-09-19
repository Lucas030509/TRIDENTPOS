# WP-020 R1 — QUICK INTEGRITY

**Frozen Subject:** `c762e2522c3e4845611614e9c27e414a8e532199`
**Canonical Base:** `16b41e3d471eeaf5a5d439f448626de05c318b1e`
**Verdict:** HOLD

## Lineage / Scope

PASS:
- exact direct child of canonical main;
- ahead 1 / behind 0;
- merge-base exact canonical main;
- remote branch tip equals Frozen Subject;
- no PR exists;
- no governing documents changed;
- @trident/finance runtime dependency is only @trident/core;
- migration/RLS/FORCE RLS and Finance-owned tables are physically present.

## Blockers

### QI-BLK-020-01 — Payment-terms semantics were invented

`parseCreditDaysFromPaymentTerms()` declares formats such as:
- NET_XX
- CREDIT_XX
- XX_DAYS
- CONTADO
- CASH
- IMMEDIATE

as "governed formats".

Canonical Procurement/WP-019 only carries `paymentTerms: string | null`; the frozen architecture does not define these encodings as canonical product semantics.

WP-020 must not invent a parser contract and call it governed.

Required direction:
- either consume an actually frozen deterministic credit-days field/contract;
- or HOLD AP due-date derivation behind an explicit neutral resolver;
- do not infer commercial terms from arbitrary string formats.

### QI-BLK-020-02 — CorteZGenerado contract is locally invented inside Finance

`@trident/finance` defines its own `CorteZGeneradoEvent` with:
- expectedCash
- actualCash
- operationalDate
- optional corteZId/sourceCutId/folio

The repository does not physically expose a canonical POS `CorteZGenerado` payload contract proving these fields are authoritative.

Tests pass by constructing the Finance-local type, not by consuming a canonical TRIDENTPOS contract.

The Builder report says "CorteZ Contract Sufficient: YES", but that is not substantiated.

Required direction:
- inspect canonical WP-016/TRIDENTPOS artifacts;
- consume/reuse an existing canonical closing contract if present;
- if absent/insufficient, represent reconciliation input as a neutral Finance adapter contract and mark actual POS→Finance integration unavailable, rather than claiming canonical CorteZ consumption.

### QI-BLK-020-03 — AP duplicate identity is not semantically revalidated

AP idempotency uses `(organization_id, purchase_receipt_id)` and immediately returns `DUPLICATE_ACCEPTED`.

It does not verify an incoming retry matches durable:
- branch_id
- supplier_id
- total_amount
- derived due_date / canonical terms basis

A conflicting event with the same receipt ID can be accepted as a benign duplicate.

### QI-BLK-020-04 — AR duplicate identity is not semantically revalidated

AR idempotency uses `(organization_id, reference_account_id)` and immediately returns `DUPLICATE_ACCEPTED`.

It does not verify:
- branch_id
- customer_id
- total_amount
- due_date

Same reference with conflicting business payload must fail closed.

### QI-BLK-020-05 — Cash reconciliation duplicate identity is not semantically revalidated

Cash reconciliation uses `(organization_id, source_cut_id)` and returns `DUPLICATE_ACCEPTED` without comparing:
- branch_id
- operational_date
- expected_cash
- actual_cash

Same cut identity with changed financial facts must fail closed.

## Additional Evidence Accuracy Issue

Builder evidence states:
`expectedCash = cut.totalSalesCash - branchCashExpenses`

but implemented `reconcileCashFromCorteZ()` simply accepts `event.expectedCash` and `event.actualCash`; it does not derive expected cash from expenses.

Evidence must describe implementation facts exactly.

## Result

WP-020 R1 is NOT authorized for Specialist Review / PR Gate.

Remediate as R2 from exact R1 Frozen Subject without modifying R1.
