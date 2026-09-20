# WP-020 R3 — CODE REVIEW

**Frozen Subject:** `28bedeedeb0206055d84bc7e71e48301cdf9b9ce`
**Reviewer:** 11_Code_Reviewer
**Verdict:** HOLD
**Blockers:** 1
**Advisories:** 1

## Confirmed

- AP/AR/cash idempotency conflicts fail closed.
- Real PostgreSQL concurrency paths use database uniqueness/locking.
- Cross-context Procurement FKs removed.
- Exact scale-4 arithmetic preserved.
- No direct Procurement/POS/CRM writes found.
- PaymentTerms resolver is neutral.
- Corte Z integration is not falsely claimed.

## CR-BLK-020-R3-01 — AP/AR settlements are destructive balance mutations without durable payment transaction history

`applyAccountsPayablePayment()`:
- locks AP;
- calculates new balance/status;
- directly UPDATEs accounts_payable.

`settleReceivable()`:
- locks AR;
- calculates new balance/status;
- directly UPDATEs accounts_receivable.

No durable payment/settlement transaction record is created.

WP-020 governing plan explicitly defines rollback as:
**Reverse payment transaction.**

The Builder Work Order also required corrections to be compensating rather than destructive and required HOLD if this needed a new financial transaction/ledger model.

Current implementation cannot:
- identify which individual payment changed the balance;
- reverse one specific payment deterministically;
- prove payment idempotency;
- audit payment references/dates;
- rebuild balance from transaction history.

Therefore payment application cannot be accepted as canonical merely because the final balance is mathematically correct.

### Required remediation

Do NOT invent a full accounting ledger/chart of accounts.

Introduce the smallest Finance-owned immutable settlement transaction model sufficient for WP-020, for example:
- accounts_payable_payments
- accounts_receivable_settlements

Each transaction should have:
- id
- organization_id
- branch_id
- parent AP/AR id
- amount exact DECIMAL(12,4)
- occurred/payment date
- external/reference idempotency key
- reversal_of_transaction_id nullable
- transaction kind APPLY | REVERSAL (or equally minimal neutral names)
- created_at

Requirements:
- append-only;
- tenant-safe internal FKs;
- stable idempotency key;
- APPLY and REVERSAL are compensating records;
- parent balance/status update and transaction insert occur atomically in one tenant transaction;
- reversal cannot exceed/reverse more than the original net applied amount;
- same payment/reversal retry is idempotent;
- balance after history must equal parent balance;
- tests cover concurrent same payment/reversal;
- no accounting journal or bank execution semantics.

If adding these minimal transaction objects conflicts with frozen data authority or requires wider accounting policy, STOP with:
`HOLD — AP/AR PAYMENT DATA MODEL EXPANSION REQUIRES ARCHITECTURE APPROVAL`

## Advisory

`ScheduledPaymentStatus = EXECUTED` may imply bank/payment execution semantics even though WP-020 says scheduling intent only. If no execution command exists, consider neutralizing to a status that does not imply external settlement, or document that EXECUTED only means converted into a Finance settlement transaction, not bank execution.

**Code Review: HOLD — R4 payment transaction remediation required.**
