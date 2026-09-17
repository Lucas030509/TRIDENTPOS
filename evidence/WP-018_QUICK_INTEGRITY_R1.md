# TRIDENTPOS — WP-018 QUICK INTEGRITY R1

## Subject
- Frozen Subject: `9ac332c0468173f073752ab981bde924e760cf4c`
- Candidate branch: `feat/wp-018-kardex-kds-depletion-canonical`
- Canonical base: `ea409360dca4e1f133f516a45eb06890e480c253`
- Reviewer: ChatGPT Governance / Quick Integrity
- Verdict: **HOLD — REMEDIATION REQUIRED**

## Lineage / Scope Checks
- Remote candidate tip equals Frozen Subject: PASS.
- Frozen Subject has sole parent `ea409360dca4e1f133f516a45eb06890e480c253`: PASS.
- Effective diff: 1 commit, 13 files: PASS.
- Governing documents changed: NO.
- Open PR for candidate branch: NO.
- GitHub Actions runs for exact Frozen Subject: NONE. Builder test results are local Builder evidence and are not independently confirmed by branch CI at this gate.

## Blocking Findings

### QI-BLK-018-01 — Resolver-present unresolved modifier can incorrectly deplete base recipe
`PostgresCloudInventoryService.onKdsOrderProduced()` only quarantines modifier-bearing events when no resolver object is supplied. When a resolver is supplied but `resolveModifierImpact()` returns `null`, the implementation silently continues with the already-added base recipe ingredient depletion.

This violates ACR-2026-017 §10: unresolved modifier-bearing depletion must be durably quarantined/replayable and commit **zero stock movement** until the complete recipe result is deterministic.

Required remediation:
- Treat `null`/unresolved impact for any selected modifier as incomplete resolution.
- Abort the complete event depletion before any ledger insert/outbox effect.
- Persist/quarantine the event idempotently with `MODIFIER_RECIPE_RESOLUTION_PENDING` (or canonical equivalent).
- Add a test proving resolver-present-but-null => QUARANTINED + zero stock movement + zero outbox business effect.

### QI-BLK-018-02 — `removedIngredients` from authorized ModifierRecipeResolver is ignored
The resolver contract returns both `additionalIngredients` and `removedIngredients`, but the implementation only applies additions and explicitly comments that removed ingredients "can be handled" later.

ACR-2026-017 requires the deterministic resolver result to be consumed; the Builder may not partially apply modifier effects.

Required remediation:
- Correctly apply the full authorized resolver output without inventing PO semantics.
- If the current contract is insufficient to apply `removedIngredients` deterministically, STOP and return `HOLD — MODIFIER CONTRACT ARCHITECTURE CONFLICT` rather than guessing.
- Add tests covering removal/substitution-impact handling or explicit architecture HOLD if impossible under the frozen contract.

### QI-BLK-018-03 — Quarantine replay is not transactionally atomic with reconciliation status
`replayQuarantinedDepletion()` opens an outer tenant transaction, locks the quarantine row, then calls public `onKdsOrderProduced()`, which opens and commits a separate tenant transaction. Only afterward does the outer transaction update the quarantine row to `REPLAYED`.

A failure in the outer transaction after the inner depletion commits can leave stock/outbox effects durable while the quarantine remains `PENDING`. This breaks deterministic reconciliation of the pending record and can require a later duplicate replay to heal metadata.

Required remediation:
- Refactor the normal depletion logic to a transaction-client scoped internal method.
- Replay must execute depletion + outbox + quarantine transition under one authoritative transaction when applying a quarantined event, while preserving normal idempotency.
- Add a controlled failure test proving no state where depletion commits but quarantine remains incorrectly pending due to replay transaction split.

### QI-BLK-018-04 — Builder evidence contains materially false schema/contract claims
The single required Builder evidence file does not describe the Frozen Subject accurately. Examples:
- Claims a read-only `v_ingredient_current_stock` view exists; the WP-018 migration creates no such view.
- Claims idempotency columns `(reference_type, reference_id, ingredient_id)`; actual constraint is `(organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)`.
- Claims sequence column `sequence_num`; actual column is `movement_sequence_number`.
- Claims a movement-type set containing `VENTA`, split AJUSTE/TRANSFERENCIA/PRODUCCION values; actual canonical SQL/domain set is `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`.
- Claims quarantine constraint names/shape (`chk_inventory_quarantine_status`, `uq_inventory_quarantine_event`, `source_event_type`) that do not match the migration (`chk_quarantine_records_status`, `uq_quarantine_records_source`, no `source_event_type`).
- Claims Down cleanup includes `v_ingredient_current_stock`; no such WP-018 object exists.

The implementation SQL/domain movement set itself matches ACR-2026-017; the blocker is evidence truthfulness. False evidence cannot pass governance.

Required remediation:
- Replace the Builder evidence with exact facts from the remediated candidate.
- Do not claim objects, columns, constraints, tests, or runtime results that are not present/executed.
- Keep exactly one Builder evidence file.

## Verified Positive Findings
- `main` remained exactly `ea409360dca4e1f133f516a45eb06890e480c253` during Quick Integrity.
- Candidate tip is exactly `9ac332c0468173f073752ab981bde924e760cf4c`.
- Candidate is one direct child commit of canonical base.
- 13 effective changed files; no governing document changed.
- Migration physically creates `stock_ledger`, `inventory_waste_records`, `inventory_quarantine_records`.
- No writable `stock_actual` table is created.
- SQL and domain use the canonical movement set: `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`.
- `stock_ledger` has RLS + FORCE RLS, tenant-safe composite FKs, candidate key, per-aggregate sequence uniqueness, non-zero delta check, KDS/waste idempotency uniqueness, and DB UPDATE/DELETE rejection trigger.
- Waste evidence has tenant-safe branch/warehouse/ingredient/ledger links and a DB semantic trigger enforcing linked negative `MERMA` movement consistency.
- Existing `cloud_integration_outbox` is reused through `CloudIntegrationOutboxService.enqueue(client, ...)`, preserving caller transaction atomicity for normal KDS depletion.
- `@trident/inventory` canonical movement types remain correct and isolated from database/pos/edge dependencies in inspected code.
- No PR exists for the Builder branch.

## Gate Decision
**HOLD — REMEDIATION REQUIRED**

Do not start independent Data Review or Code Review on Frozen Subject `9ac332c0468173f073752ab981bde924e760cf4c`.

Required next candidate: **WP-018 R2**, created as a new immutable Frozen Subject after remediation. Do not amend or force-push R1.