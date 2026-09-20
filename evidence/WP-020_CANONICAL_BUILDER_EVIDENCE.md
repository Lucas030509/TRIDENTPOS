# WP-020 CANONICAL BUILDER EVIDENCE (R4 PAYMENT TRANSACTION REMEDIATION)

## Work Package Information
- **Work Package:** WP-020 — Finance, Accounts Payable / Receivable & Cash Reconciliation
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Base SHA:** `16b41e3d471eeaf5a5d439f448626de05c318b1e`
- **R1 Frozen Subject SHA:** `c762e2522c3e4845611614e9c27e414a8e532199`
- **R2 Frozen Subject SHA:** `fa2ea8d09ba4c3ec02e1ec0d15d1d5442d7a5ef0`
- **R3 Frozen Subject SHA:** `28bedeedeb0206055d84bc7e71e48301cdf9b9ce`
- **R4 Branch:** `feat/wp-020-finance-ap-ar-reconciliation-r4`
- **Direct Parent:** R3 Frozen Subject (`28bedeedeb0206055d84bc7e71e48301cdf9b9ce`)
- **WP-019 Status:** CANONICAL / VERIFIED (PR #55 merged at `16b41e3d471eeaf5a5d439f448626de05c318b1e`)

---

## 1. Package Topology & Dependency Boundaries
- **Package Created:** `packages/finance` (`@trident/finance`)
- **Pure Domain Runtime Dependencies:** `@trident/core` ONLY.
- **Unauthorized Runtime Dependencies:** 0 (Zero dependencies on `@trident/procurement`, `@trident/pos`, `@trident/inventory`, `@trident/database`, `@trident/cloud-server`, `@trident/crm`, `@trident/billing`).
- **Composition Layer:** Cross-context integration is strictly contained in `packages/cloud-server` (`@trident/cloud-server`), which orchestrates `@trident/finance`, `@trident/database`, and outbox events.

---

## 2. R4 Payment Transaction Remediation (Settlement History & Compensating Reversals)
- **Architectural Principle:** Immutable, Append-Only Operational Settlement History with Compensating Reversals.
- **Problem Resolved:** In R3, AP/AR balance mutations directly changed `balance_due` without persisting durable immutable transaction history or providing compensating reversal capabilities.
- **Tables Created:**
  1. `accounts_payable_payments` (Finance-owned immutable AP payment transactions & reversals).
  2. `accounts_receivable_settlements` (Finance-owned immutable AR settlement transactions & reversals).
- **Append-Only Database Triggers:**
  - `trg_ap_payments_immutable`: `BEFORE UPDATE OR DELETE ON accounts_payable_payments EXECUTE FUNCTION trg_finance_payments_append_only()`
  - `trg_ar_settlements_immutable`: `BEFORE UPDATE OR DELETE ON accounts_receivable_settlements EXECUTE FUNCTION trg_finance_payments_append_only()`
  - Enforced at PostgreSQL database engine level: any direct SQL `UPDATE` or `DELETE` is rejected with `P0001` error.
- **Transaction Kinds Governed:**
  - `APPLY`: Decreases `balance_due` on parent entity.
  - `REVERSAL`: Compensating transaction referencing original `APPLY` row (`reversal_of_transaction_id`), increasing `balance_due` on parent entity.
  - Zero arbitrary transaction kinds (no `REFUND`, `VOID`, `BANK_TRANSFER`, `CHECK`, `SPEI`).
- **Mandatory Stable Idempotency References:**
  - `reference_id VARCHAR(100) NOT NULL` with `UNIQUE (organization_id, reference_id)`.
  - Mutating service commands fail closed if reference is missing (`PaymentReferenceRequiredError` / `SettlementReferenceRequiredError`).
  - Same reference retry returns `DUPLICATE_ACCEPTED` with deterministic prior transaction and parent entity state.
  - Conflicting retry (same reference, different facts) fails closed with `PaymentIdempotencyConflictError` / `SettlementIdempotencyConflictError`.
- **Atomic Balance & Settlement Transaction Mutation:**
  - Executed inside a single tenant transaction (`withTenantTransaction`).
  - Acquires `FOR UPDATE` lock on parent AP/AR row.
  - Validates balance, inserts immutable transaction row, recalculates new balance and deterministic lifecycle status via pure domain function, updates parent row, and commits.
  - Failure at any step rolls back both transaction row and parent balance.
- **Compensating Reversal Semantics:**
  - Full reversal referencing original `APPLY` row via `reversal_of_transaction_id`.
  - Appends new `REVERSAL` transaction row; never deletes or updates the original `APPLY` row.
  - Restores parent `balance_due` exactly and deterministically recalculates status (`PAID -> PARTIAL/PENDING`, `PARTIAL -> PENDING`).
  - Over-reversal (attempting to reverse an already reversed transaction) fails closed with `PaymentAlreadyReversedError` / `SettlementAlreadyReversedError`.
- **Balance-History Invariant:**
  - `AP balance_due == total_amount - sum(APPLY amounts) + sum(REVERSAL amounts)`
  - `AR balance_due == total_amount - sum(APPLY amounts) + sum(REVERSAL amounts)`
  - Verified explicitly by tests across multiple payment and reversal sequences.
- **No Accounting Journal / General Ledger:**
  - Zero double-entry ledger accounts, chart of accounts, journal entries, or debits/credits.
  - Operational Finance settlement history only.
- **Scheduled Payment EXECUTED Semantics:**
  - `ScheduledPaymentStatus = EXECUTED` strictly means: converted/applied into a Finance settlement transaction.
  - Does NOT mean external bank execution, ACH, SPEI, or third-party payment provider confirmation.

---

## 3. R3 Persistence Boundary Decoupling (Preserved)
- Cross-context physical FKs from `accounts_payable` to `suppliers` and `purchase_receipts` remain **REMOVED**.
- External aggregate identities `supplier_id` and `purchase_receipt_id` remain **PRESERVED** as UUID fields.
- Platform Core FK `(organization_id, branch_id) REFERENCES branches(organization_id, id)` remains **PRESERVED**.
- Finance-internal FK `scheduled_payments -> accounts_payable(organization_id, id)` remains **PRESERVED**.
- Zero queries from Finance service to Procurement tables.

---

## 4. Database Migration & Schema
- **Migration File:** `packages/database/migrations/20260905020000_finance_ap_ar_cash_reconciliation.sql`
- **Tables Created (Exact 7):**
  1. `accounts_payable` — AP liability aggregate.
  2. `accounts_payable_payments` — Immutable append-only AP payment transactions and reversals.
  3. `scheduled_payments` — Payment scheduling intent.
  4. `accounts_receivable` — AR receivable aggregate.
  5. `accounts_receivable_settlements` — Immutable append-only AR settlement transactions and reversals.
  6. `branch_operating_expenses` — Branch petty cash/operating expenses.
  7. `cash_reconciliations` — Daily cash variance reconciliations.

### RLS & Security Hardening
- `ENABLE ROW LEVEL SECURITY` on all 7 tables.
- `FORCE ROW LEVEL SECURITY` on all 7 tables.
- Fail-closed tenant isolation policy: `organization_id = current_app_org_id()`.
- Composite tenant-safe candidate keys: `UNIQUE (organization_id, id)`.
- Composite tenant-safe foreign keys:
  - `(organization_id, accounts_payable_id) REFERENCES accounts_payable(organization_id, id)`
  - `(organization_id, reversal_of_transaction_id) REFERENCES accounts_payable_payments(organization_id, id)`
  - `(organization_id, accounts_receivable_id) REFERENCES accounts_receivable(organization_id, id)`
  - `(organization_id, reversal_of_transaction_id) REFERENCES accounts_receivable_settlements(organization_id, id)`

### Down Migration Clean Rollback
- Down migration cleanly drops triggers, functions, and all 7 tables with `CASCADE`.
- Tested in `WP019-DOWN-01`, `R4-DB-11`, and `R4-DB-12`: all predecessor tables (Platform Core, Outbox, Sync, Recipes, Kárdex, Procurement) survive cleanly.

---

## 5. Financial Arithmetic & Exact Scale-4 Enforcement
- Authoritative monetary storage: `DECIMAL(12,4)` in PostgreSQL.
- Domain representation: Exact fixed-point integer basis ($10^4$ scale, 1 cent = 100 base units).
- Numeric parsing/formatting: `parseExactScale4` / `formatExactScale4` rejecting scientific notation, exceeding decimal places, and NaN.
- Prohibited and Absent: `Number(decimal)`, `parseFloat`, floating-point multiplication, epsilon tolerance.

---

## 6. Accounts Payable Lifecycle & Neutral Payment Terms Resolver
- Consumes canonical `RecepcionCompraRegistradaPayload` event emitted by WP-019.
- Neutral contract interface `PaymentTermsDueDateResolver` with context `PaymentTermsDueDateResolverContext`.
- When processing purchase receipts, if no resolver or explicit due date is provided, fails closed with `PaymentTermsResolverRequiredError` (`PAYMENT_TERMS_RESOLVER_REQUIRED`).
- AP Semantic Idempotency Revalidation: `organization_id + purchase_receipt_id` revalidates branch, supplier, total, and dueDate.

---

## 7. Accounts Receivable & Credit Limit Validator
- **OQ-SSOT-03 Protection:**
  - Status: **OPEN** (Protected Product Owner Open Question).
  - `CreditLimitValidator`: **CONTRACT ONLY** interface in `@trident/finance`.
  - Fail-Closed Behavior: When credit check is required and no authorized `CreditLimitValidator` is supplied, throws `CreditPolicyRequiredError` (`CREDIT_POLICY_REQUIRED`).
- AR Semantic Idempotency Revalidation: `organization_id + reference_account_id` revalidates branch, customer, total, and dueDate.

---

## 8. Cash Reconciliation & Corte Z Contract Neutralization
- Operating expenses: `branch_operating_expenses` records branch cash outflows with receipt attachment reference.
- POS cash ownership boundary: POS owns `turnos_caja`, `movimientos_efectivo`, `corte_x`, and `corte_z`. Finance performs **0** POS table mutations.
- Corte Z physical contract inspection: POS -> Finance Corte Z integration is **BLOCKED BY CONTRACT**.
- Cash Reconciliation Core: pure financial domain calculator accepting neutral `CashClosingFacts`.
- Reconciliation Engine: `variance = actualCash - expectedCash`, `hasVariance = variance !== 0n`.
- Cash Reconciliation Semantic Idempotency Revalidation: `organization_id + source_cut_id` revalidates branch, date, expected cash, and actual cash.

---

## 9. Verification & Test Matrix

### Package Test Summary
| Test Suite | File | Tests | Pass | Fail | Status |
|------------|------|-------|------|------|--------|
| Finance Domain | `packages/finance/src/index.test.ts` | 15 | 15 | 0 | PASS |
| Database Integration | `packages/database/src/finance.test.ts` + all DB suites | 320 | 320 | 0 | PASS |
| Cloud Server Integration | `packages/cloud-server/src/index.test.ts` | 112 | 112 | 0 | PASS |
| Cross-Package E2E | `tests/integration/wp013-sync-e2e.test.mjs` | 1 | 1 | 0 | PASS |
| Dependency Graph | `scripts/check-graph.test.mjs` | 44 | 44 | 0 | PASS |
| Electron Runtime | `packages/edge/src/electron.test.ts` | 10 | 10 | 0 | PASS |

### R4 Specific Database Tests (`packages/database/src/finance.test.ts`)
- **R4-DB-01:** `accounts_payable_payments` table exists with all required columns.
- **R4-DB-02:** `accounts_receivable_settlements` table exists with all required columns.
- **R4-DB-03:** RLS and FORCE RLS enabled on both settlement tables.
- **R4-DB-04:** Tenant-safe composite FK `(organization_id, accounts_payable_id) -> accounts_payable(organization_id, id)`.
- **R4-DB-05:** Tenant-safe composite FK `(organization_id, accounts_receivable_id) -> accounts_receivable(organization_id, id)`.
- **R4-DB-06:** Stable AP payment reference uniqueness per tenant `(organization_id, reference_id)`.
- **R4-DB-07:** Stable AR settlement reference uniqueness per tenant `(organization_id, reference_id)`.
- **R4-DB-08:** Reversal self-referencing composite FK stays tenant-safe.
- **R4-DB-09:** Transaction kind CHECK strictly enforces `APPLY` and `REVERSAL` only.
- **R4-DB-10:** Positive amount CHECK strictly enforces `amount > 0.0000`.
- **R4-DB-IMMUTABLE:** Append-only triggers reject SQL `UPDATE` and `DELETE` at DB engine level.
- **R4-DB-11 & R4-DB-12:** WP-020 rollback removes settlement tables and predecessors survive.

### R4 Specific Cloud Tests (`packages/cloud-server/src/index.test.ts`)
- **R4-REF-01:** Missing AP payment reference fails closed (`PaymentReferenceRequiredError`).
- **R4-REF-02:** Missing AR settlement reference fails closed (`SettlementReferenceRequiredError`).
- **R4-AP-01:** Payment creates APPLY transaction and reduces balance atomically.
- **R4-AP-02:** Same payment reference retry is idempotent (`DUPLICATE_ACCEPTED`).
- **R4-AP-03:** Concurrent same payment reference produces exactly one APPLY row and one balance reduction.
- **R4-AP-04:** Two different valid concurrent payments serialize cleanly (`400 + 600 = 1000 balance -> 0`).
- **R4-AP-05:** Concurrent overpayment race (`700 + 700` on 1000 balance) prevents second payment from making balance negative.
- **R4-AP-06 / R4-AP-07 / R4-AP-11:** Full reversal creates `REVERSAL` row, restores exact balance, and leaves original `APPLY` row unchanged.
- **R4-AP-08:** Same reversal reference retry is idempotent (`DUPLICATE_ACCEPTED`).
- **R4-AP-09:** Concurrent same reversal produces exactly one `REVERSAL` row and one balance restoration.
- **R4-AP-10:** Over-reversal fails closed (`PaymentAlreadyReversedError`).
- **R4-AP-12:** Balance equals transaction-history invariant across multi-step mutations.
- **R4-AR-01..12:** Full equivalent test suite for Accounts Receivable settlements and reversals.
- **R4-TX-01:** Forced error during transaction preparation leaves zero payment rows persisted and parent balance unchanged.

---

## 10. Boundary & Policy Integrity
- **Governing Documents Modified:** NO (0 files modified in governance directories).
- **Protected Open Questions:** 9/9 OPEN preserved (`OQ-SSOT-03` strictly open).
- **UI Created:** NO (0 UI files).
- **HTTP Server Created:** NO (0 HTTP server files).
- **Pull Request Created:** NO.
- **Merge Executed:** NO.
