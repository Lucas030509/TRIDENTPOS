# WP-019 R2 — CODE REVIEW

**Frozen Subject:** `f139cc5e374aaec270e1038f26ffeffec460e2a3`
**Reviewer:** 11_Code_Reviewer
**Verdict:** HOLD
**Blockers:** 1
**Advisories:** 0

## Confirmed R2 fixes

- Stable identity conflicts fail closed.
- Line-level semantic conflicts fail closed.
- Retry paymentTerms is not treated as historical authority.
- Placeholder duplicate quantities removed.
- Distinct receipt concurrency race covered with real PostgreSQL.
- Failed conflicts create no new receipt/items/outbox.
- Missing prior outbox event fails closed.

## CR-BLK-019-R2-01 — Ambiguous canonical prior-event cardinality

Duplicate reconstruction queries:

`cloud_integration_outbox`

by exact receipt aggregate identity and checks only:

`rows.length === 0`

The canonical outbox schema has NO UNIQUE constraint enforcing one row for:
- organization_id
- branch_id
- event_type
- aggregate_type
- aggregate_id

Therefore, if two matching outbox rows exist due to corruption, manual repair, or historical duplication, the code silently selects `rows[0]`. Without ORDER BY or cardinality validation this is nondeterministic and violates the R2 requirement that prior-event reconstruction be authoritative and fail-closed.

### Required remediation

For the exact prior-event lookup:

- require `rows.length === 1`;
- if `rows.length !== 1`, throw `RECEIPT_OUTBOX_INTEGRITY_ERROR`;
- add a real PostgreSQL test inserting/creating two matching canonical outbox rows for one receipt and proving duplicate confirmation fails closed;
- do NOT add a new outbox-wide UNIQUE constraint in WP-019 unless separately governed, because that changes shared WP-012 infrastructure semantics.

No other code blocker identified.

**Code Review: HOLD — R3 surgical remediation required.**
