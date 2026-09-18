# WP-018 R3 — INDEPENDENT CODE RE-REVIEW

**Frozen Subject:** `62920d5bf018a64748ee5fd408917e5a22049fd7`
**Verdict:** HOLD — R4 SURGICAL REMEDIATION REQUIRED
**Blockers:** 1
**Advisories:** 1

## CR-BLK-018-R3-01 — Lock-order inversion can deadlock replay vs source redelivery

R3 introduces a source-event advisory lock inside `applyKdsDepletionWithClient()`.

Normal source-event path:
1. acquire source-event advisory lock;
2. check applied movements;
3. if unresolved/no resolver, UPSERT `inventory_quarantine_records`, potentially taking the quarantine row lock.

Replay path currently:
1. `SELECT ... inventory_quarantine_records ... FOR UPDATE` (row lock first);
2. call `applyKdsDepletionWithClient()`;
3. helper then waits for source-event advisory lock.

Deadlock interleaving:
- Tx A replay holds quarantine row lock, waits for advisory lock.
- Tx B redelivery holds advisory lock, attempts quarantine UPSERT and waits for Tx A row lock.
- PostgreSQL deadlock detector must abort one transaction.

This violates deterministic replay/redelivery concurrency.

### Required remediation

Enforce one global lock order for the same KDS source event. Preferred:
1. read quarantine payload without row lock solely to identify the source event/warehouse;
2. acquire source-event advisory lock;
3. re-read/re-lock quarantine row `FOR UPDATE` and revalidate it;
4. execute depletion using an internal helper that assumes the source-event lock is already held (do not reacquire);
5. reconcile quarantine and commit in the same tenant transaction.

Alternatively, refactor to a single internal orchestration where BOTH normal delivery and replay always acquire source-event lock before quarantine row locks.

Add a real PostgreSQL concurrency test running replay and source redelivery concurrently for the same quarantined event. It must complete without deadlock, preserve one depletion/outbox effect, and end in a deterministic quarantine state.

## Advisory

`R3-CLOUD-01` runtime assertion sees the protected method because TypeScript visibility is compile-time. The actual acceptance evidence is the `protected` declaration plus absence from `CloudInventoryCompositionService`; consider making the test compile-time/type-oriented or document its intent more precisely.

No PR until the blocker is remediated.
