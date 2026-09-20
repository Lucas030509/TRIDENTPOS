# WP-020 CANONICAL BUILDER EVIDENCE (R3 PERSISTENCE-BOUNDARY REMEDIATION)

## Work Package Information
- **Work Package:** WP-020 — Finance, Accounts Payable / Receivable & Cash Reconciliation
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Base SHA:** `16b41e3d471eeaf5a5d439f448626de05c318b1e`
- **R1 Frozen Subject SHA:** `c762e2522c3e4845611614e9c27e414a8e532199`
- **R2 Frozen Subject SHA:** `fa2ea8d09ba4c3ec02e1ec0d15d1d5442d7a5ef0`
- **R3 Branch:** `feat/wp-020-finance-ap-ar-reconciliation-r3`
- **Direct Parent:** R2 Frozen Subject (`fa2ea8d09ba4c3ec02e1ec0d15d1d5442d7a5ef0`)
- **WP-019 Status:** CANONICAL / VERIFIED (PR #55 merged at `16b41e3d471eeaf5a5d439f448626de05c318b1e`)

---

## 1. Package Topology & Dependency Boundaries
- **Package Created:** `packages/finance` (`@trident/finance`)
- **Pure Domain Runtime Dependencies:** `@trident/core` ONLY.
- **Unauthorized Runtime Dependencies:** 0 (Zero dependencies on `@trident/procurement`, `@trident/pos`, `@trident/inventory`, `@trident/database`, `@trident/cloud-server`, `@trident/crm`, `@trident/billing`).
- **Composition Layer:** Cross-context integration is strictly contained in `packages/cloud-server` (`@trident/cloud-server`), which orchestrates `@trident/finance`, `@trident/database`, and outbox events.

---

## 2. R3 Persistence Boundary Remediation (Decoupling from Procurement)
- **Architectural Principle:** Modular by Design — Integrated by Contract.
- **Problem Resolved:** In R1/R2, `accounts_payable` contained physical foreign keys (`fk_ap_supplier` and `fk_ap_purchase_receipt`) pointing to Procurement tables (`suppliers`, `purchase_receipts`). This violated modular standalone deployment and context autonomy boundaries.
- **Cross-Context FKs Removed:**
  - `fk_ap_supplier` (FOREIGN KEY referencing `suppliers`) — **REMOVED**.
  - `fk_ap_purchase_receipt` (FOREIGN KEY referencing `purchase_receipts`) — **REMOVED**.
- **External Aggregate Identities Preserved:**
  - `supplier_id UUID NOT NULL` — **PRESERVED** as Finance-side external aggregate identifier carried by integration event.
  - `purchase_receipt_id UUID NOT NULL` — **PRESERVED** as Finance-side external aggregate identifier carried by integration event.
- **Idempotency Identity Preserved:**
  - `uq_ap_org_receipt`: `UNIQUE (organization_id, purchase_receipt_id)` — **PRESERVED** (AP event idempotency identity).
- **Platform Core Foreign Keys Preserved:**
  - `fk_ap_branch`: `FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)` — **PRESERVED** (Branch belongs to Platform Core).
- **Finance Internal Foreign Keys Preserved:**
  - Composite tenant-safe FK from `scheduled_payments` to `accounts_payable(organization_id, id)` — **PRESERVED**.
- **Standalone/Selective Deployment Boundary:**
  - Finance persistence schema can be migrated, created, and operated standalone without requiring Procurement tables.
- **Source Inspection & Zero Query Guarantee:**
  - `PostgresFinanceService` performs **0** `SELECT` queries on `suppliers`.
  - `PostgresFinanceService` performs **0** `SELECT` queries on `purchase_receipts`.
  - `PostgresFinanceService` performs **0** writes/mutations to Procurement tables.

---

## 3. Database Migration & Schema
- **Migration File:** `packages/database/migrations/20260905020000_finance_ap_ar_cash_reconciliation.sql`
- **Tables Created:**
  1. `accounts_payable` — Accounts payable liabilities created from procurement receiving events.
  2. `scheduled_payments` — Payment scheduling intent linked to accounts payable.
  3. `accounts_receivable` — Accounts receivable charges and customer credit tracking.
  4. `branch_operating_expenses` — Branch-level operating expenses with receipt attachment references.
  5. `cash_reconciliations` — Finance-owned daily cash variance reconciliation from Corte Z facts.

### RLS & Security Hardening
- `ENABLE ROW LEVEL SECURITY` executed on all 5 tables.
- `FORCE ROW LEVEL SECURITY` executed on all 5 tables.
- Fail-closed tenant isolation policy: `organization_id = current_app_org_id()`.
- Composite tenant-safe candidate keys: `UNIQUE (organization_id, id)`.
- Composite tenant-safe foreign keys: `FOREIGN KEY (organization_id, accounts_payable_id) REFERENCES accounts_payable(organization_id, id)`.

### Idempotency Constraints
- `uq_ap_org_receipt`: `UNIQUE (organization_id, purchase_receipt_id)`
- `uq_ar_org_reference`: `UNIQUE (organization_id, reference_account_id)`
- `uq_cash_rec_org_source_cut`: `UNIQUE (organization_id, source_cut_id)`

---

## 4. Financial Arithmetic & Exact Scale-4 Enforcement
- Authoritative monetary storage: `DECIMAL(12,4)` in PostgreSQL.
- Domain representation: Exact fixed-point integer basis ($10^4$ scale, 1 cent = 100 base units).
- Numeric parsing/formatting: `parseExactScale4` / `formatExactScale4` rejecting scientific notation, exceeding decimal places, and NaN.
- Prohibited and Absent: `Number(decimal)`, `parseFloat`, floating-point multiplication, epsilon tolerance.

---

## 5. Accounts Payable Lifecycle & Neutral Payment Terms Resolver
- **Creation Trigger:** Consumes canonical `RecepcionCompraRegistradaPayload` event emitted by WP-019.
- **Initial Values:** `total_amount = event.totalAmount`, `balance_due = event.totalAmount`.
- **Payment Terms Neutralization (R2 & R3 Preserved):**
  - Removed all hardcoded commercial payment terms string parsers (`NET_30`, `CONTADO`, `CASH`, etc.) from production domain code.
  - Neutral contract interface `PaymentTermsDueDateResolver` with context `PaymentTermsDueDateResolverContext`.
  - When processing purchase receipts, if no resolver or explicit due date is provided, fails closed with `PaymentTermsResolverRequiredError` (`PAYMENT_TERMS_RESOLVER_REQUIRED`).
  - `ProcessPurchaseReceiptOptions.dueDate`, if provided, is strictly an **EXTERNALLY RESOLVED FACT** (not a Finance product default policy).
- **AP Semantic Idempotency Revalidation (R2 & R3 Preserved):**
  - Stable identity: `organization_id + purchase_receipt_id`.
  - When an existing AP row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `supplierId` match
    - `totalAmount` exact scale-4 match
    - `dueDate` match
  - If any business fact conflicts, fails closed with `APIdempotencyConflictError` (`AP_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 6. Scheduled Payments
- **Table:** `scheduled_payments`.
- **Purpose:** Payment scheduling intent only; zero third-party payment gateways, bank transfers, SPEI, or ACH.

---

## 7. Accounts Receivable & Credit Limit Validator
- **Table:** `accounts_receivable`.
- **States:** `PENDING`, `PAID`, `OVERDUE`, `DEFAULTED`.
- **Customer Master Boundary:** Finance stores `customerId` as an external reference only; zero CRM customer master tables or mutations.
- **OQ-SSOT-03 Protection:**
  - Status: **OPEN** (Protected Product Owner Open Question).
  - `CreditLimitValidator`: **CONTRACT ONLY** interface in `@trident/finance`.
  - Default credit policies / hardcoded thresholds / manager PIN overrides: **NONE**.
  - Fail-Closed Behavior: When credit check is required and no authorized `CreditLimitValidator` is supplied, throws `CreditPolicyRequiredError` (`CREDIT_POLICY_REQUIRED`).
- **AR Semantic Idempotency Revalidation (R2 & R3 Preserved):**
  - Stable identity: `organization_id + reference_account_id`.
  - When an existing AR row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `customerId` match
    - `totalAmount` exact scale-4 match
    - `dueDate` match
  - If any business fact conflicts, fails closed with `ARIdempotencyConflictError` (`AR_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 8. Cash Reconciliation & Corte Z Contract Neutralization
- **Operating Expenses:** `branch_operating_expenses` records branch cash outflows with receipt attachment URL / reference string.
- **POS Cash Ownership Boundary:** POS owns `turnos_caja`, `movimientos_efectivo`, `corte_x`, and `corte_z`. Finance performs **0** POS table mutations.
- **Corte Z Physical Contract Inspection:**
  - **CorteZ Contract Sufficient:** `NO`.
  - **POS -> Finance Corte Z Integration:** `BLOCKED BY CONTRACT`.
  - **Cash Reconciliation Core:** `IMPLEMENTED` as a pure financial domain calculator accepting neutral `CashClosingFacts`.
  - `CashClosingFacts` (`CashReconciliationSource`) provides neutral `expectedCash` and `actualCash` facts.
- **Reconciliation Engine:**
  - `variance = actualCash - expectedCash`
  - `hasVariance = variance !== 0n`
  - Zero variance produces `hasVariance = false`; non-zero variance produces `hasVariance = true`.
- **Cash Reconciliation Semantic Idempotency Revalidation:**
  - Stable identity: `organization_id + source_cut_id`.
  - When an existing reconciliation row is found (or after `ON CONFLICT DO NOTHING`), Finance revalidates semantic equivalence:
    - `branchId` match
    - `operationalDate` match
    - `expectedCash` exact scale-4 match
    - `actualCash` exact scale-4 match
  - If any business fact conflicts, fails closed with `CashReconciliationIdempotencyConflictError` (`CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT`).
  - Only identical retries return `DUPLICATE_ACCEPTED`.

---

## 9. Verification & Test Matrix

### Package Test Summary
| Test Suite | File | Tests | Pass | Fail | Status |
|------------|------|-------|------|------|--------|
| Finance Domain | `packages/finance/src/index.test.ts` | 14 | 14 | 0 | PASS |
| Database Integration | `packages/database/src/finance.test.ts` + all DB suites | 309 | 309 | 0 | PASS |
| Cloud Server Integration | `packages/cloud-server/src/index.test.ts` | 89 | 89 | 0 | PASS |
| Cross-Package E2E | `tests/integration/wp013-sync-e2e.test.mjs` | 1 | 1 | 0 | PASS |
| Dependency Graph | `scripts/check-graph.test.mjs` | 44 | 44 | 0 | PASS |
| Electron Runtime | `packages/edge/src/electron.test.ts` | 10 | 10 | 0 | PASS |

### R3 Specific Tests
- **R3-DB-01:** PostgreSQL catalog constraints on `accounts_payable`:
  - Foreign key to `branches`: **PRESENT**
  - Foreign key to `suppliers`: **ABSENT**
  - Foreign key to `purchase_receipts`: **ABSENT**
  - Foreign key to `purchase_orders`: **ABSENT**
  - Foreign key to `purchase_order_items`: **ABSENT**
- **R3-CLOUD-01 (WP020-CLOUD-01):** Event-driven AP creation with external aggregate identities:
  - Consumes `RecepcionCompraRegistrada` event.
  - Stores `supplier_id` and `purchase_receipt_id` as pure external aggregate references.
  - Ingestion succeeds with synthetic IDs not present in Procurement tables.
  - Zero SQL queries to `suppliers` or `purchase_receipts` in Finance service.

---

## 10. Boundary & Policy Integrity
- **Governing Documents Modified:** NO (0 files modified in governance directories).
- **Protected Open Questions:** 9/9 OPEN preserved (`OQ-SSOT-03` strictly open).
- **UI Created:** NO (0 UI files).
- **HTTP Server Created:** NO (0 HTTP server files).
- **Pull Request Created:** NO.
- **Merge Executed:** NO.
