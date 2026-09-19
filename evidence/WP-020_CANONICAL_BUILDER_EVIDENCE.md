# WP-020 CANONICAL BUILDER EVIDENCE (R2 REMEDIATION)

## Work Package Information
- **Work Package:** WP-020 — Finance, Accounts Payable / Receivable & Cash Reconciliation
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Base SHA:** `16b41e3d471eeaf5a5d439f448626de05c318b1e`
- **R1 Frozen Subject SHA:** `c762e2522c3e4845611614e9c27e414a8e532199`
- **R2 Branch:** `feat/wp-020-finance-ap-ar-reconciliation-r2`
- **Direct Parent:** R1 Frozen Subject (`c762e2522c3e4845611614e9c27e414a8e532199`)
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
  5. `cash_reconciliations` — Finance-side reconciliation between closing facts and cash expenses.

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

## 4. Accounts Payable Lifecycle & Neutral Payment Terms Resolver
- **Creation Trigger:** Consumes canonical `RecepcionCompraRegistradaPayload` event emitted by WP-019.
- **Initial Values:** `total_amount = event.totalAmount`, `balance_due = event.totalAmount`.
- **Payment Terms Neutralization (R2 Blocker 1 Resolution):**
  - Removed all hardcoded commercial payment terms string parsers (`NET_30`, `CONTADO`, `CASH`, etc.) from production domain code.
  - Introduced neutral contract interface `PaymentTermsDueDateResolver` with context `PaymentTermsDueDateResolverContext`.
  - When processing purchase receipts, if no resolver or explicit due date is provided, fails closed with `PaymentTermsResolverRequiredError` (`PAYMENT_TERMS_RESOLVER_REQUIRED`).
  - In unit and composition tests, an explicit test resolver is injected and labeled `TEST ONLY — NOT PRODUCT OWNER / CANONICAL PAYMENT TERMS POLICY`.
- **AP Semantic Idempotency Revalidation (R2):**
  - Stable identity: `organization_id + purchase_receipt_id`.
  - When an existing AP row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `supplierId` match
    - `totalAmount` exact scale-4 match
    - `dueDate` match
  - If any business fact conflicts, fails closed with `APIdempotencyConflictError` (`AP_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 5. Scheduled Payments
- **Table:** `scheduled_payments`.
- **Purpose:** Payment scheduling intent only; zero third-party payment gateways, bank transfers, SPEI, or ACH.

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
- **AR Semantic Idempotency Revalidation (R2):**
  - Stable identity: `organization_id + reference_account_id`.
  - When an existing AR row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `customerId` match
    - `totalAmount` exact scale-4 match
    - `dueDate` match
  - If any business fact conflicts, fails closed with `ARIdempotencyConflictError` (`AR_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 7. Cash Reconciliation & Corte Z Contract Neutralization
- **Operating Expenses:** `branch_operating_expenses` records branch cash outflows with receipt attachment URL / reference string.
- **POS Cash Ownership Boundary:** POS owns `turnos_caja`, `movimientos_efectivo`, `corte_x`, and `corte_z`. Finance performs **0** POS table mutations.
- **Corte Z Physical Contract Inspection (R2 Blocker 2 Resolution):**
  - Inspection of `@trident/pos`, `@trident/pos-edge-runtime`, and core packages confirmed that NO physical canonical `CorteZGenerado` event contract exists in the repository.
  - **CorteZ Contract Sufficient:** `NO`.
  - **POS -> Finance Corte Z Integration:** `BLOCKED BY CONTRACT`.
  - **Cash Reconciliation Core:** `IMPLEMENTED` as a pure financial domain calculator accepting neutral `CashClosingFacts`.
  - Local fabricated `CorteZGeneradoEvent` renamed/neutralized to `CashClosingFacts` (`CashReconciliationSource`).
- **Correction of Operating Expense Derivation Claim:**
  - Removed false claim that Finance derives expected cash by reading POS drawer facts and subtracting expenses.
  - Accurately states that Finance reconciliation receives already-resolved `expectedCash` and `actualCash` facts via `CashClosingFacts`.
- **Reconciliation Engine:**
  - `variance = actualCash - expectedCash`
  - `hasVariance = variance !== 0n`
  - Zero variance produces `hasVariance = false`; non-zero variance produces `hasVariance = true`.
- **Cash Reconciliation Semantic Idempotency Revalidation (R2):**
  - Stable identity: `organization_id + source_cut_id`.
  - When an existing reconciliation row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `operationalDate` match
    - `expectedCash` exact scale-4 match
    - `actualCash` exact scale-4 match
  - If any business fact conflicts, fails closed with `CashReconciliationIdempotencyConflictError` (`CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 8. Verification & Test Matrix

### Package Test Summary
| Test Suite | File | Tests | Pass | Fail | Status |
|------------|------|-------|------|------|--------|
| Finance Domain | `packages/finance/src/index.test.ts` | 14 | 14 | 0 | PASS |
| Database Integration | `packages/database/src/finance.test.ts` + all DB suites | 308 | 308 | 0 | PASS |
| Cloud Server Integration | `packages/cloud-server/src/index.test.ts` | 89 | 89 | 0 | PASS |
| Cross-Package E2E | `tests/integration/wp013-sync-e2e.test.mjs` | 1 | 1 | 0 | PASS |
| Dependency Graph | `scripts/check-graph.test.mjs` | 44 | 44 | 0 | PASS |
| Electron Runtime | `packages/edge/src/electron.test.ts` | 10 | 10 | 0 | PASS |

### R2 Mandatory Surgical Test Suite
- **AP Idempotency & Conflict Tests:**
  - `R2-AP-01`: Exact retry -> `DUPLICATE_ACCEPTED`.
  - `R2-AP-02`: Same receipt ID + different branch -> fail closed (`APIdempotencyConflictError`).
  - `R2-AP-03`: Same receipt ID + different supplier -> fail closed (`APIdempotencyConflictError`).
  - `R2-AP-04`: Same receipt ID + different total -> fail closed (`APIdempotencyConflictError`).
  - `R2-AP-05`: Same receipt ID + different resolved due date -> fail closed (`APIdempotencyConflictError`).
  - `R2-AP-06`: Concurrent exact retry produces exactly one AP row.
- **AR Idempotency & Conflict Tests:**
  - `R2-AR-01`: Exact retry -> `DUPLICATE_ACCEPTED`.
  - `R2-AR-02`: Same reference + different customer -> fail closed (`ARIdempotencyConflictError`).
  - `R2-AR-03`: Same reference + different branch -> fail closed (`ARIdempotencyConflictError`).
  - `R2-AR-04`: Same reference + different amount -> fail closed (`ARIdempotencyConflictError`).
  - `R2-AR-05`: Same reference + different due date -> fail closed (`ARIdempotencyConflictError`).
  - `R2-AR-06`: Concurrent exact retry produces exactly one AR row.
- **Cash Reconciliation Idempotency & Conflict Tests:**
  - `R2-CASH-01`: Exact retry -> `DUPLICATE_ACCEPTED`.
  - `R2-CASH-02`: Same cut + different branch -> fail closed (`CashReconciliationIdempotencyConflictError`).
  - `R2-CASH-03`: Same cut + different operational date -> fail closed (`CashReconciliationIdempotencyConflictError`).
  - `R2-CASH-04`: Same cut + different expected cash -> fail closed (`CashReconciliationIdempotencyConflictError`).
  - `R2-CASH-05`: Same cut + different actual cash -> fail closed (`CashReconciliationIdempotencyConflictError`).
  - `R2-CASH-06`: Concurrent exact retry produces exactly one reconciliation row.

---

## 9. Boundary & Policy Integrity
- **Governing Documents Modified:** NO (0 files modified in governance directories).
- **Protected Open Questions:** 9/9 OPEN preserved (`OQ-SSOT-03` strictly open).
- **UI Created:** NO (0 UI files).
- **HTTP Server Created:** NO (0 HTTP server files).
- **Pull Request Created:** NO.
- **Merge Executed:** NO.
