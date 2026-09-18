# WP-018 R2 — INDEPENDENT CODE REVIEW

**Frozen Subject:** `931743b5e46b2796b4adca5b72a0f65f20773fa6`
**Reviewer:** 11_Code_Reviewer
**Verdict:** HOLD — R3 REQUIRED
**Blockers:** 3
**Advisories:** 2

## CR-BLK-018-01 — Transaction-scoped helper is publicly callable

`PostgresCloudInventoryService.applyKdsDepletionWithClient(client,...)` is declared `public`.

The method requires a transaction-scoped `pg.PoolClient` and does not establish `withTenantTransaction()` itself. The governing work order requires all public WP-018 application operations to own their tenant transaction boundary and forbids callers from manually managing BEGIN/setTenantContext.

The helper must be private/non-public implementation detail (or otherwise made inaccessible as an application API) while remaining reusable by public `onKdsOrderProduced()` and `replayQuarantinedDepletion()`.

## CR-BLK-018-02 — Applied modifier event can be re-quarantined by a duplicate retry

In `applyKdsDepletionWithClient`, the branch:

`hasModifiers && !customResolver`

runs BEFORE the existing-CONSumo_KDS idempotency check.

Sequence:
1. Event is quarantined.
2. Authorized replay applies ledger/outbox and marks quarantine REPLAYED.
3. Same source event is delivered again without a resolver.
4. Code upserts the same quarantine row and forces `status='PENDING'` before checking the already-applied ledger.

This resurrects completed quarantine state and returns QUARANTINED for an already-applied event.

Required: durable applied-event/idempotency detection must precede unresolved-modifier quarantine, or equivalent logic must ensure an already-applied order can never be reverted to PENDING by source replay.

## CR-BLK-018-03 — Idempotent retry result is not deterministic

`registerWaste()` duplicate path reconstructs the existing movement/record but always returns `negativeStockAlert: null`, even when the original movement produced a negative-stock signal.

Likewise the KDS duplicate path returns `negativeStockAlerts: []` rather than reconstructing the original deterministic result.

The WP-018 work order requires same-command retry to produce the same deterministic prior result / duplicate-accepted behavior, not merely prevent duplicate rows.

Required: reconstruct negative-stock classification from immutable `balance_after` (and original created timestamp) on duplicate reads, and return a truthful prior-result representation. KDS duplicate response must likewise preserve the original negative-stock information, preferably from immutable movements/outbox payload, without creating a new effect.

## Advisories

1. Duplicate KDS lookup should constrain the outbox query by `event_type='InventarioDescontadoPorReceta'` as well as aggregate identity to avoid future ambiguous matches.
2. `applyKdsDepletionWithClient` naming/comment correctly indicates internal intent; R3 should make the language-level visibility match that intent.

No PR may be opened until these blockers are remediated and independently rechecked.
