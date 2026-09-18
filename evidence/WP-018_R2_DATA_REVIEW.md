# WP-018 R2 — INDEPENDENT DATA ARCHITECT REVIEW

**Frozen Subject:** `931743b5e46b2796b4adca5b72a0f65f20773fa6`
**Reviewer:** 03_Data_Architect
**Verdict:** PASS
**Blockers:** 0
**Advisories:** 2

## Verified

- `stock_ledger` is the sole authoritative movement SoR; no writable `stock_actual`.
- Canonical movement set is exactly COMPRA, CONSUMO_KDS, MERMA, AJUSTE_FISICO, TRANSFERENCIA.
- DECIMAL(12,4), non-zero deltas, immutable balance snapshots and sequence uniqueness are enforced.
- Candidate key `(organization_id,id)` exists.
- Branch, warehouse and ingredient references are tenant-safe composite FKs.
- RLS and FORCE RLS are enabled on all WP-018 tables with fail-closed tenant policy.
- UPDATE/DELETE append-only enforcement is DB-level.
- KDS and waste idempotency constraints are materialized.
- Waste evidence is tenant-safe and DB trigger validates linked movement is a negative MERMA with matching aggregate identity.
- Quarantine persistence is durable, RLS-protected and idempotent by tenant/branch/source event.
- Rollback is ownership-bounded and preserves WP-017/WP-012 predecessors.

## Advisories

1. PostgreSQL advisory locking uses a 32-bit `hashtext` key; collisions are correctness-safe but may create unnecessary cross-aggregate contention. Monitor if cardinality grows significantly.
2. Future schema evolution should keep quarantine source-event identity aligned with the governed integration envelope; no additional event-type field is required by the current ACR.

**Next:** Code Review remains authoritative for application-transaction/idempotent retry behavior.
