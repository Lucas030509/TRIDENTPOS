# ACR-2026-017 R2 — COORDINATOR SYNTHESIS

**Frozen Subject:** `33a64cb5bdbfdcaf0aace7adca1cd88c9b43edc3`  
**Canonical Base:** `bfc3f9ba36f2c8c413639cdd50eaea0f4ac19cd6`  
**Quick Integrity:** PASS — `a92a3bc66e987859d81092337fc26fcc02a4eff0`  
**Solution Review:** PASS — `814faf9dff46108c724ab35c2944e5d20d2630b7`  
**Data Review:** PASS — `016bf839a8ec5771fb00a57a2073ceb8d8b78bf1`  
**Code Consistency Review:** PASS — `e555f0045b9259091ad8f3ac7ca102f569c51f2f`  
**Verdict:** `PASS — READY FOR PRODUCT OWNER APPROVAL`

## Reconciled Decisions

1. `stock_ledger` is the sole authoritative append-only Kárdex movement SoR.
2. `stock_actual` is a derived read model only, never an independently writable authority.
3. `inventory_waste_records` carries mandatory waste evidence and is atomically linked tenant-safely to one MERMA movement.
4. KDS and waste retries are explicitly idempotent using stable event/command identifiers plus unique constraints.
5. Current balances remain mathematically reconstructable from the ledger; `balance_after` is immutable audit snapshot only.
6. Concurrent movements must serialize per organization/branch/warehouse/ingredient and maintain monotonic sequence numbers.
7. Negative stock is allowed as truthful inventory state and triggers a non-blocking operational alert; it does not roll back restaurant sale/KDS completion.
8. `OrdenProduccionConfirmadaEnKDS` follows the existing Edge outbox/sync → Cloud durable event → Inventory consumer path.
9. Successful depletion atomically persists stock movements and durable `InventarioDescontadoPorReceta` outbox event.
10. `OQ-SSOT-07` remains OPEN. Modifier-bearing events with unresolved recipe semantics are durably deferred/replayable and create zero partial stock movement.
11. `OQ-SSOT-05` remains OPEN. No replenishment algorithm is selected.
12. WP-018 extends the WP-017 package topology; no new cross-context runtime dependency is authorized.

## Review Advisories Incorporated

- Waste→ledger semantic linkage must prove the referenced ledger row is a matching negative MERMA movement, not merely satisfy an FK.
- Existing canonical transaction/migration helpers must be reused; parallel infrastructure abstractions are prohibited.
- Operational alert delivery vendor/channel is outside WP-018.
- Stale wording in older governing docs should receive a future governance-hygiene rewrite, but once merged ACR-2026-017 has explicit overlay priority over conflicting WP-018 clauses.

## Protected Product Owner State

9/9 protected decisions remain OPEN.

No reviewer selected modifier semantics, replenishment policy, photo provider, inventory valuation policy, UI behavior or external ERP reconciliation policy.

## Gate Result

No blockers remain in R2.

The exact subject eligible for Product Owner approval is:

`33a64cb5bdbfdcaf0aace7adca1cd88c9b43edc3`

Approval of any other SHA does not authorize merge.

After explicit Product Owner approval: PR Gate → PR → required CI/Security → Merge Authorization → Merge → Post-Merge validation → CANONICAL → WP-018 Builder start.

Evidence-only sidecar; never merge into candidate or main.