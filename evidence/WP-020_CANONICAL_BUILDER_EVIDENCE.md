# WP-020 CANONICAL BUILDER EVIDENCE

## Work Package Information
- **Work Package:** WP-020 — Finance, Accounts Payable / Receivable & Cash Reconciliation
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Base SHA:** `16b41e3d471eeaf5a5d439f448626de05c318b1e`
- **Implementation Branch:** `feat/wp-020-finance-ap-ar-reconciliation`
- **Direct Parent:** Canonical `main` (`16b41e3d471eeaf5a5d439f448626de05c318b1e`)
- **WP-019 Status:** CANONICAL / VERIFIED (PR #55 merged at `16b41e3d471eeaf5a5d439f448626de05c318b1e`)

---

## 1. Package Topology & Dependency Boundaries
- **Package Created:** `packages/finance` (`@trident/finance`)
- **Pure Domain Runtime Dependencies:** `@trident/core` ONLY.
- **Unauthorized Runtime Dependencies:** 0 (Zero dependencies on `@trident/procurement`, `@trident/pos`, `@trident/inventory`, `@trident/database`, `@trident/cloud-server`, `@trident/crm`, `@trident/billing`).
- **Composition Layer:** Cross-context integration is strictly contained in `packages/cloud-server` (`@trident/cloud-server`), which orchestrates `@trident/finance`, `@trident/database`, and outbox events.

---

## 2. Database Migration & Schema
- **Migration File:** `packages/database/migrations/20260905020000_finance_ap_ar_cash_reconciliation.sql`
- **Tables Created:**
  1. `accounts_payable` — Accounts payable liabilities created from procurement receiving events.
  2. `scheduled_payments` — Payment scheduling intent linked to accounts payable.
  3. `accounts_receivable` — Accounts receivable charges and customer credit tracking.
  4. `branch_operating_expenses` — Branch-level operating expenses with receipt attachment references.
  5. `cash_reconciliations` — Finance-side reconciliation between POS closing facts and cash expenses.

### RLS & Security Hardening
- `ENABLE ROW LEVEL SECURITY` executed on all 5 tables.
- `FORCE ROW LEVEL SECURITY` executed on all 5 tables.
- Fail-closed tenant isolation policy: `organization_id = current_app_org_id()`.
- Composite tenant-safe candidate keys: `UNIQUE (organization_id, id)`.
- Composite tenant-safe foreign keys: `FOREIGN KEY (organization_id, accounts_payable_id) REFERENCES accounts_payable(organization_id, id)`.

### Idempotency Constraints
- `uq_accounts_payable_receipt`: `UNIQUE (organization_id, purchase_receipt_id)`
- `uq_accounts_receivable_ref`: `UNIQUE (organization_id, reference_account_id)`
- `uq_cash_reconciliations_source_cut`: `UNIQUE (organization_id, source_cut_id)`

---

## 3. Financial Arithmetic & Exact Scale-4 Enforcement
- Authoritative monetary storage: `DECIMAL(12,4)` in PostgreSQL.
- Domain representation: Exact fixed-point integer basis ($10^4$ scale, 1 cent = 100 base units).
- Numeric parsing/formatting: `parseExactScale4` / `formatExactScale4` rejecting scientific notation, exceeding decimal places, and NaN.
- Prohibited and Absent: `Number(decimal)`, `parseFloat`, floating-point multiplication, epsilon tolerance.

---

## 4. Accounts Payable Lifecycle
- **Creation Trigger:** Consumes canonical `RecepcionCompraRegistrada` event emitted by WP-019.
- **Initial Values:** `total_amount = event.totalAmount`, `balance_due = event.totalAmount`.
- **Payment Terms & Due Date:** Derived deterministically from event `paymentTerms` (e.g. `NET_30` -> `receivedAt + 30 days`, `CONTADO` -> `receivedAt + 0 days`).
- **Payment Lifecycle:** `PENDING` -> `PARTIAL` -> `PAID`. Overpayment is rejected fail-closed (`APOverpaymentError`).
- **Concurrent RecepcionCompraRegistrada Delivery:** Tested with real PostgreSQL concurrency; concurrent delivery serializes cleanly and produces exactly one AP row with deterministic `DUPLICATE_ACCEPTED` result.

---

## 5. Scheduled Payments
- **Table:** `scheduled_payments`.
- **Purpose:** Payment scheduling intent only; no third-party payment gateways, bank transfers, SPEI, or ACH.

---

## 6. Accounts Receivable & Credit Limit Validator
- **Table:** `accounts_receivable`.
- **States:** `PENDING`, `PAID`, `OVERDUE`, `DEFAULTED`.
- **Customer Master Boundary:** Finance stores `customerId` as an external reference only; zero CRM customer master tables or mutations.
- **OQ-SSOT-03 Protection:**
  - Status: **OPEN** (Protected Product Owner Open Question).
  - `CreditLimitValidator`: **CONTRACT ONLY** interface in `@trident/finance`.
  - Default credit policies / hardcoded thresholds / manager PIN overrides: **NONE**.
  - Fail-Closed Behavior: When credit check is required and no authorized `CreditLimitValidator` is supplied, throws `CreditPolicyRequiredError` (`CREDIT_POLICY_REQUIRED`).
  - Test policies: Explicitly marked `TEST ONLY — NOT PRODUCT OWNER POLICY`.

---

## 7. Operating Expenses & Cash Reconciliation
- **Operating Expenses:** `branch_operating_expenses` records branch cash outflows with receipt attachment URL / reference string.
- **POS Cash Ownership Boundary:** POS owns `turnos_caja`, `movimientos_efectivo`, `corte_x`, and `corte_z`. Finance performs **0** POS table mutations.
- **Corte Z Event Source:** Consumes canonical `CorteZGenerado` event.
- **Reconciliation Engine:**
  - `expectedCash = cut.totalSalesCash - branchCashExpenses`
  - `variance = actualCash - expectedCash`
  - `hasVariance = variance !== 0n`
- Exact comparison: Zero variance produces `has_variance = false`; any non-zero variance (positive or negative) produces `has_variance = true`.

---

## 8. Verification & Test Matrix

### Package Test Summary
| Test Suite | File | Tests | Pass | Fail | Status |
|------------|------|-------|------|------|--------|
| Finance Domain | `packages/finance/src/index.test.ts` | 14 | 14 | 0 | PASS |
| Database Integration | `packages/database/src/finance.test.ts` + all DB suites | 308 | 308 | 0 | PASS |
| Cloud Server Integration | `packages/cloud-server/src/index.test.ts` | 71 | 71 | 0 | PASS |
| Cross-Package E2E | `tests/integration/wp013-wp012-ingestion.test.mjs` | 1 | 1 | 0 | PASS |
| Dependency Graph | `scripts/check-graph.test.mjs` | 44 | 44 | 0 | PASS |
| Electron Runtime | `packages/edge/src/electron.test.ts` | 10 | 10 | 0 | PASS |

### Database Tests (WP020-DB-01 to WP020-DB-18)
- `WP020-DB-01`: Exact five WP-020 physical tables exist.
- `WP020-DB-02` & `WP020-DB-03`: RLS and FORCE RLS enabled on all 5 tables.
- `WP020-DB-04`: AP tenant isolation & default deny without tenant context.
- `WP020-DB-05`: AR tenant isolation & candidate key uniqueness.
- `WP020-DB-06`: Branch operating expense tenant isolation.
- `WP020-DB-07`: Scheduled payments composite tenant-safe foreign key to AP.
- `WP020-DB-08`: Financial amount check constraints reject negative balances and zero totals.
- `WP020-DB-09` & `WP020-DB-10`: AP and AR check constraints enforce governed lifecycle states.
- `WP020-DB-11`: AP receipt idempotency identity rejects duplicate `purchase_receipt_id`.
- `WP020-DB-12`: AR external-reference idempotency rejects duplicate `reference_account_id`.
- `WP020-DB-13`: Cash reconciliation source cut uniqueness rejects duplicate `source_cut_id`.
- `WP020-DB-14`: Cross-tenant foreign key relationships strictly rejected.
- `WP020-DB-15`, `WP020-DB-16`, `WP020-DB-17`, `WP020-DB-18`: Non-production rollback of WP-020 drops WP-020 objects while preserving WP-019 Procurement tables, WP-018 `stock_ledger`, WP-017 Inventory tables, Platform Core, and Outbox.

### Domain Tests (WP020-DOM-01 to WP020-DOM-14)
- `WP020-DOM-01`: Exact SCALE_4 parse/format.
- `WP020-DOM-02`: AP initial balance.
- `WP020-DOM-03`: AP partial payment.
- `WP020-DOM-04`: AP full settlement.
- `WP020-DOM-05`: AP overpayment rejected.
- `WP020-DOM-06`: AR initial balance.
- `WP020-DOM-07`: AR settlement exact.
- `WP020-DOM-08`: AR overpayment rejected.
- `WP020-DOM-09`: `CreditLimitValidator` is neutral contract.
- `WP020-DOM-10`: Missing required credit policy fails closed.
- `WP020-DOM-11`: TEST credit policy remains explicit test-only.
- `WP020-DOM-12`: Cash variance exactly zero.
- `WP020-DOM-13`: Cash variance positive/non-zero flagged.
- `WP020-DOM-14`: Cash variance negative/non-zero flagged.

### Cloud Server Tests (WP020-CLOUD-01 to WP020-CLOUD-23)
- `WP020-CLOUD-01`: `RecepcionCompraRegistrada` creates AP.
- `WP020-CLOUD-02`: Same receipt retry produces one AP (`DUPLICATE_ACCEPTED`).
- `WP020-CLOUD-03`: Concurrent same receipt event produces one AP.
- `WP020-CLOUD-04`: AP amount equals Procurement event total exactly.
- `WP020-CLOUD-05`: AP due date uses actual governed payment terms.
- `WP020-CLOUD-06`: AP partial settlement.
- `WP020-CLOUD-07`: AP final settlement.
- `WP020-CLOUD-08`: AP overpayment fail-closed.
- `WP020-CLOUD-09`: Transaction failure leaves no partial AP state.
- `WP020-CLOUD-10`: AR external-reference idempotency.
- `WP020-CLOUD-11`: Concurrent AR duplicate produces one charge.
- `WP020-CLOUD-12`: Credit-required operation without policy fail-closed (`CREDIT_POLICY_REQUIRED`).
- `WP020-CLOUD-13`: TEST credit policy injection works.
- `WP020-CLOUD-14`: Operating expense stored with receipt reference.
- `WP020-CLOUD-15`: Operating expense makes zero POS table mutations.
- `WP020-CLOUD-16`: `CorteZ` creates one reconciliation.
- `WP020-CLOUD-17`: `CorteZ` retry idempotent.
- `WP020-CLOUD-18`: Concurrent same `CorteZ` event produces one reconciliation.
- `WP020-CLOUD-19`: Zero variance not flagged.
- `WP020-CLOUD-20`: Non-zero variance flagged.
- `WP020-CLOUD-21`: Finance performs zero Procurement writes.
- `WP020-CLOUD-22`: Finance performs zero POS cash ownership writes.
- `WP020-CLOUD-23`: Finance performs zero CRM customer-master writes.

---

## 9. Boundary & Policy Integrity
- **Governing Documents Modified:** NO (0 files modified in governance directories).
- **Protected Open Questions:** 9/9 OPEN preserved (`OQ-SSOT-03` strictly open).
- **UI Created:** NO (0 UI files).
- **HTTP Server Created:** NO (0 HTTP server files).
- **Pull Request Created:** NO.
- **Merge Executed:** NO.
