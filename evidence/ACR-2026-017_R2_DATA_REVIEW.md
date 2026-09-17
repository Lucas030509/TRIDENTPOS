# ACR-2026-017 R2 — DATA ARCHITECT REVIEW

**Reviewer Role:** `03_Data_Architect`  
**Frozen Subject:** `33a64cb5bdbfdcaf0aace7adca1cd88c9b43edc3`  
**Canonical Base:** `bfc3f9ba36f2c8c413639cdd50eaea0f4ac19cd6`  
**Verdict:** `PASS`

## Findings

1. **Single quantity authority:** PASS. `stock_ledger.quantity_delta` is the only authoritative stock history. Current stock is derived; `balance_after` is an immutable audit snapshot only.
2. **Tenant-safe integrity:** PASS. R2 requires `(organization_id,id)` candidate key and composite tenant-safe FKs for branch, warehouse, ingredient, ledger linkage and optional actor linkage.
3. **RLS:** PASS. `ENABLE RLS`, `FORCE RLS`, fail-closed organization policies are mandatory for all WP-018-owned tables.
4. **Append-only enforcement:** PASS. UPDATE and DELETE must be rejected at DB level; corrections use counter-movements.
5. **Sequence/concurrency:** PASS. Per aggregate movement sequence plus transaction-scoped serialization is sufficient to prove monotonic ordering and exact cumulative balance under concurrency.
6. **KDS replay idempotency:** PASS. Stable event/order reference plus unique `(org, branch, warehouse, ingredient, movement_type, reference_event_id)` prevents duplicate aggregated ingredient depletion.
7. **Waste idempotency:** PASS after R2 remediation. Stable `commandId`, ledger `reference_event_id`, `UNIQUE (organization_id, command_id)` on waste evidence and ledger uniqueness prevent duplicate MERMA application.
8. **Waste-to-ledger linkage:** PASS after R2 remediation. `(organization_id, stock_ledger_id)` references `stock_ledger(organization_id,id)` and one-to-one uniqueness prevents evidence duplication.
9. **Waste semantic integrity:** PASS. MERMA movement and evidence commit atomically; same tenant/branch/warehouse/ingredient and negative quantity are explicitly required.
10. **Negative stock:** PASS. Ledger remains truthful even below zero; alerting is separate from quantity authority and does not create a hidden mutable stock balance.
11. **Modifier uncertainty:** PASS. Zero partial stock movement is committed when complete modifier recipe resolution is unavailable; event remains durable and replayable.
12. **Rollback:** PASS. Non-production rollback must preserve WP-017 tables/data; production correction is forward-fix/application rollback plus compensating movements.

## Blockers

None.

## Advisories

- The Builder should implement a deterministic database-side or transactionally verified check that `inventory_waste_records.stock_ledger_id` refers to a MERMA row with negative delta and matching dimensional keys; a plain FK alone is insufficient. R2 already makes this a binding invariant/test obligation.
- The concrete alert persistence shape may be reused from an existing operational telemetry primitive if available; it must not become another stock authority.

## Final Verdict

`PASS — ACR-2026-017 R2 defines sufficient data authority, tenant isolation, idempotency, append-only invariants and concurrency obligations for WP-018 implementation.`

Evidence-only sidecar; never merge into candidate or main.