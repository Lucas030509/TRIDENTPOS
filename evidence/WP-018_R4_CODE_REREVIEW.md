# WP-018 R4 — INDEPENDENT CODE RE-REVIEW

**Frozen Subject:** `b3bb62cf28c127d0243ce69471315d98f6e20d4d`
**Verdict:** HOLD — R5 MINIMAL REMEDIATION REQUIRED
**Blockers:** 1

## CR-BLK-018-R4-01 — Source lock identity is derived from mutable pre-read payload

R4 correctly standardizes lock order, but replay derives:
- branchId
- warehouseId
- sourceOrderId

from a NON-LOCKING pre-read payload before acquiring the source-event advisory lock.

After the advisory lock, replay performs the authoritative `SELECT ... FOR UPDATE` and uses the second payload for depletion, but it does not verify that the locked payload still maps to the SAME source-lock identity.

This matters because normal unresolved redelivery uses:

`ON CONFLICT (organization_id, branch_id, source_event_id) DO UPDATE SET payload = EXCLUDED.payload ...`

Therefore the quarantine payload is mutable while PENDING.

Possible race:
1. Replay pre-reads payload A (warehouse A) and plans lock key A.
2. A redelivery for the same `source_event_id` updates the quarantine payload to B (warehouse B) under source lock B and commits.
3. Replay acquires stale source lock A.
4. Replay locks the row and reads authoritative payload B.
5. Replay executes payload B while holding source lock A.
6. Another normal delivery for B can concurrently hold source lock B, defeating source-event serialization and pushing correctness back onto uniqueness exceptions.

### Required remediation

Use a source-event lock identity composed ONLY of immutable quarantine/source identity available before row mutation, preferably:

`organizationId + branchId + sourceEventId/orderId`

Do not include mutable payload fields such as warehouseId in the source-event serialization key.

Normal delivery and replay must use the SAME stable key derivation.

Then the replay pre-read needs only:
- organization_id
- branch_id
- source_event_id

to acquire the source lock.

After acquiring it:
- lock row FOR UPDATE;
- use the locked payload as authoritative;
- execute depletion;
- reconcile REPLAYED.

Alternatively, if warehouse must remain in the key, the code must prove/revalidate pre-read and locked-read identity equality and restart safely without ever acquiring a second source lock after the row lock. The stable-key approach is preferred.

### Required concurrency test

Add a real PostgreSQL test where a PENDING quarantine payload is updated/redelivered between replay pre-read and locked read. Verify:
- both paths serialize on the same source lock;
- no uniqueness exception;
- no duplicate ledger/outbox effect;
- final quarantine state deterministic.

No schema or product-semantics changes are required.
