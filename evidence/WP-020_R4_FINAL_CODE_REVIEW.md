# WP-020 R4 — FINAL CODE RE-REVIEW

**Frozen Subject:** `3001bb5807592bea86a35a90436df0c0a1520260`
**Reviewer:** 11_Code_Reviewer
**Verdict:** HOLD
**Blockers:** 2
**Advisories:** 1

## Confirmed

- Durable AP payment and AR settlement history added.
- Transaction tables are append-only with database triggers.
- Parent balance update and transaction insert are atomic.
- Full compensating reversal exists and original APPLY rows remain immutable.
- Same-reference concurrency and overpayment races are covered.
- Balance-history invariants are covered.
- No general ledger, chart of accounts, or bank execution semantics introduced.

## CR-BLK-020-R4-01 — AR branch identity is not enforced consistently

`settleReceivable()` accepts `command.branchId`, but after loading the AR it does not fail closed when the command branch differs from the durable AR branch. The inserted settlement uses `currentAr.branchId`, effectively ignoring the caller's conflicting branch.

AR idempotency checks for an existing settlement also do not compare `branch_id` to `command.branchId`.

`reverseAccountsReceivableSettlement()` has the same issue: duplicate-reversal identity does not compare branch, and the operation may accept a command carrying a mismatched branch while using the durable AR branch internally.

Required:
- validate `currentAr.branchId === command.branchId` for APPLY and REVERSAL;
- include branch in existing/concurrent idempotency semantic comparisons;
- add tests proving wrong-branch APPLY and REVERSAL fail closed with zero mutation.

## CR-BLK-020-R4-02 — Explicit transaction dates are omitted from idempotency semantic identity

AP APPLY, AR APPLY, AP REVERSAL and AR REVERSAL persist explicit payment/settlement/reversal dates when supplied.

However, same-reference duplicate checks compare parent/type/amount (and some branch facts) but not the explicit persisted date.

Therefore the same reference can be retried with a different explicit audit date and still return `DUPLICATE_ACCEPTED`.

Required:
- when an explicit date was supplied, normalize and compare it against durable transaction date;
- same reference + different explicit date must fail closed with the appropriate idempotency conflict;
- when the original call relied on server NOW and a retry also omits the date, exact duplicate behavior may remain accepted;
- do not require clients to predict server-generated timestamps.

## Advisory

The WP-020 down migration uses `CASCADE` on Finance-owned tables. It currently drops only WP-020 objects in tests, but deterministic reverse dependency order without CASCADE is safer and more consistent with prior migration hygiene. Prefer removing CASCADE if no internal dependency requires it.

**Final Code Re-Review: HOLD — R5 surgical identity remediation required.**
