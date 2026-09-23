# ACR-2026-020 R3 — Independent Solution Architecture Review

**Reviewer:** `01_Solution_Architect`  
**Repository:** `Lucas030509/TRIDENTPOS`  
**Canonical base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Candidate branch:** `governance/acr-2026-020-wp021-pac-reconciliation-r3`  
**Exact Frozen Candidate R3:** `3be54b042044ea5f5ee483afffbe27588e965bd3`  
**Artifact:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`  
**Governing EAAF:** `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362` (`1.3.0`)  
**Risk:** `RC4 — CRITICAL`  
**Quick Integrity R3 evidence:** `cf97e0166e8b93a675320841c5b5f6ef8f68da62` (`PASS`)  
**Historical Solution Architecture R2 evidence:** `954e1f25cfe67de8dd709106dca89126df3824e3` (`PASS`, historical only)  
**Integration Architecture R2 evidence:** `d702aa6f78c87510d266173a91fa653df73ecb32` (`PASS`, historical compatibility input)  
**Data Architecture R2 evidence:** `7358b0b680eca7118aa9c4760a7cd6437c881dce` (`HOLD`, remediated in R3)  
**Superseded Frozen Candidate R2:** `b015c61da8f0ff26c40268a7e4d406888346b9f9`  
**Timestamp:** `2026-09-23T01:19:06Z`  

## 1. Scope and exact-subject pre-flight

This is an independent Solution Architecture revalidation of exact Frozen Candidate R3. The R2 PASS is historical context only. This review assesses architecture semantics and does not evaluate implementation conformance, migrations executed, RLS behavior, Security, QA, Code Review, Product Owner approval, or Builder authorization.

The pinned EAAF Solution Architecture Gate requires explicit system context/boundaries/topology/quality attributes, complete failure/recovery/data-authority decisions, and no unproved guarantee or silent SSOT change. Only `PASS` advances.

Pre-flight independently verified:

- R3 candidate branch tip equals `3be54b042044ea5f5ee483afffbe27588e965bd3` (`ahead_by=0`, `behind_by=0`).
- Quick Integrity R3 evidence exists and binds to exact R3; it records Quick Integrity `PASS` only.
- `main` remains exactly `0c46307e09fe77383320a86b6daff86d2983e9af`.
- R2 → R3 is exactly 1 commit ahead / 0 behind; exactly one changed file, `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`, with `+148 / -50`.
- EAAF pin, RC4 classification, Data R2 HOLD reference, and protected `OQ-ARCH-02` agree with the subject.

## 2. R3 delta reviewed

Reviewed the exact R3 artifact, including §§3–18, the 57-test architecture matrix in §20, Circuit Breaker in §22, review gates in §23, non-decisions in §24, and governance effect in §26. R3 adds Cloud backup/PITR and tenant-restore requirements, ambiguity preservation, restore/reconciliation rules, outbox deduplication requirements, migration preservation for populated predecessor fiscal records, fail-closed non-production down migration, retention authority binding, tenant-scoped lookup evidence, and 15 new tests.

The Data R2 remediation is materially present at semantic level:

- §9.2 preserves tenant-scoped operation identity and ambiguous status after restore, forbids inference from missing local data, requires provider reconciliation, and specifies atomic local finalization.
- §§18.1–18.4 define required persisted attributes, forward-migration invariants, populated predecessor fixtures, and lossless/fail-closed migration handling.
- §18.3 refuses lossy non-production down migration and forbids destructive production rollback.
- §18.5 binds future retention/purge to an approved policy/legal authority without inventing periods.
- §18.6 and tests #42/#56 require tenant-scoped recovery lookups.

These provisions remediate the two Data R2 HOLD findings semantically, but the R3 solution contract introduces the blockers below.

## 3. Authority, topology, and boundaries

| Concern | R3 authority/boundary | Assessment |
|---|---|---|
| Fiscal intent, operation/request identity, local lifecycle, validated local finalization, invoice state, and durable outbox publication | Billing | Clear bounded-context ownership. |
| External stamp/cancellation result, UUID, certified XML, and provider reconciliation | PAC/provider under approved contract | External truth remains provider-owned; local restore or absence is not provider evidence. |
| Cloud modules and outbox | Existing modular monolith / PostgreSQL composition | R3 does not introduce private-table coupling or cross-context physical FKs. |
| Edge/offline POS topology | Existing SQLite operational authority | R3 gives Edge no authority to manufacture PAC success; provider-dependent semantics remain fail-closed. |

R3 §§3–4, 9, 14–18 preserve `MODULAR BY DESIGN — INTEGRATED BY CONTRACT`. Canonical `SOLUTION_ARCHITECTURE.md`, `SYNC_AND_OFFLINE_ARCHITECTURE.md`, ADR-002, ADR-004, ADR-007, and ADR-013 remain compatible with the stated Billing/PAC split, Cloud transactional outbox, Edge operational authority, and zero cross-context physical FKs. No Billing-to-private-DB or Billing-to-POS/Finance/Inventory runtime dependency is required.

## 4. Restore, migration, provider, and testability assessment

### Backup/PITR and ambiguity

The restore scenario in §9.2 correctly models external PAC success with local finalization missing from the restored snapshot. It does not treat PITR as a PAC rollback or infer non-execution from absent UUID/XML/outbox data. It preserves the original operation, request hash, provider references, and tenant scope; requires reconciliation; and disallows state reset to a fresh dispatch state. Tests #37–42 cover STAMP/CANCEL restore, identity and ambiguity preservation, event behavior, and tenant isolation.

### Migration and retention

Sections 18.1–18.4 preserve operation/tenant/invoice identity, request hashes, provider references, attempts, ambiguity, authoritative stamp/cancellation results, provenance references, and outbox correlation; populated multi-tenant predecessor fixtures and lossy-mapping refusal are explicit. Down migration is fail-closed where predecessor representation would destroy fiscal truth. Section 18.5 requires durable fiscal/audit history and defers exact purge periods to approved authority. This introduces no runtime coupling and does not invent statutory retention.

### Provider neutrality and Integration compatibility

R3 keeps operation-specific idempotency, lookup and safe-replay capabilities distinct (§§4, 8); provider semantics remain `PENDING / BLOCKED BY CONTRACT`; no API, endpoint, status string, credential, SLA, or replay guarantee is invented. Cancellation outcomes and final-success evidence remain provider-neutral (§15). R3 preserves `PENDING_APPROVAL != CANCELLED`, unresolved `UNKNOWN`, original-operation recovery, and no blind redispatch except as allowed under the approved operation-specific safe-replay contract.

### 57-test matrix

The 57-test matrix objectively covers the new restore, tenant, migration, lossy-down-migration, final-result, and outbox requirements at architecture level. It is a future evidence requirement only; no implementation test is claimed as passing. The matrix does not resolve the rule conflict in Blocker 01 or establish restore-surviving event deduplication in Blocker 02.

## 5. Blocking findings

### `ACR020-R3-SA-BLK-01` — Restore requires authoritative lookup even when the approved idempotent-replay path does not

- **Invariant:** Restore recovery must apply the same operation-specific safe-replay contract as ordinary restart recovery. A proved idempotent replay for the same provider, operation type, semantic key, request hash, and payload is a permitted Rule A path even where authoritative lookup is unavailable; unsupported lookup or replay must remain blocked by contract.
- **Source:** R3 §§7–9.2, especially §9.2 invariant 4; cancellation §15.2 and historical Integration R2 PASS evidence `d702aa6f78c87510d266173a91fa653df73ecb32`.
- **Evidence:** §§7 and 15.2 permit provider-guaranteed idempotent replay as an exception to reconciliation-before-dispatch. §8 Rule A independently authorizes operation-specific idempotent replay. In contrast, §9.2 invariant 4 says authoritative provider reconciliation is mandatory before any local state transition or redispatch, without preserving the Rule A exception. The capability model deliberately separates idempotency from authoritative lookup, so a valid approved contract may prove one without the other.
- **Failure scenario:** A restored ambiguous operation has an approved same-key idempotent replay guarantee but no authoritative lookup capability. Ordinary recovery under §§7–8 can safely use Rule A, while §9.2 forbids that replay until a lookup succeeds. The operation is either permanently blocked despite a proven safe path or implementers choose conflicting interpretations between restore and Integration rules.
- **Architectural impact:** Internal recovery-contract contradiction and incompatibility with the previously approved Integration semantics; recovery behavior is not deterministic for an explicitly supported capability combination. It does not authorize unsafe dispatch, but it leaves the system architecture materially ambiguous at RC4.
- **Required remediation:** Harmonize §9.2 with §§7, 8, and 15.2. Preserve authoritative reconciliation-first where applicable; explicitly allow only the same operation-specific Rule A replay exception when its approved contract proof, provider, operation identity, key, and request hash match. A replay response still cannot bypass authoritative success validation. If neither safe path is proven, retain `RECONCILIATION_REQUIRED` / `BLOCKED BY CONTRACT`. Add restore tests for idempotency proven with lookup unavailable, and for neither capability proven.
- **Human Decision required:** No. This is a contract-consistency issue; no provider selection is required.

### `ACR020-R3-SA-BLK-02` — PITR can roll back the only stated outbox deduplication record

- **Invariant:** Replaying recovery after database restore must not create a second semantic fiscal event or duplicate downstream effect for an event already delivered before the restore point was rolled back.
- **Source:** R3 §9.2 invariants 5–6, §14, §18.2 invariant 4, and §20 tests #37–42; canonical `ADR/ADR-007-durable-cloud-integration-events.md` and `SOLUTION_ARCHITECTURE.md` §3.
- **Evidence:** R3 promises no duplicate `FacturaFiscalEmitida` / `FacturaFiscalCancelada` and says outbox publication must check durable deduplication, while atomic finalization inserts local state and outbox together. However, the described PITR may restore to before that finalization/outbox row. The canonical outbox design specifies PostgreSQL transactional persistence, worker retries, and DLQ, but does not define a stable event identity, a consumer deduplication contract, or dedupe evidence that survives a PITR rollback. Tests #40 and #51 do not cover an event delivered after the chosen restore point and before restoring to the earlier snapshot.
- **Failure scenario:** PAC succeeds; local finalization and outbox event commit; the outbox worker delivers the event; then Cloud is restored to a PITR point before that commit. Recovery reconciles and finalizes the same operation again. The restored database no longer contains the first outbox/dedup record, so “check durable deduplication” in that restored database cannot by itself detect the earlier delivery. A subscriber outside the restored transaction boundary may apply the event twice.
- **Architectural impact:** R3's no-duplicate-event guarantee is unproved across the exact restore timeline it governs. It can duplicate downstream fiscal/accounting effects or event delivery, despite correct PAC reconciliation and local atomicity.
- **Required remediation:** Define a stable semantic event identity tied to tenant, fiscal operation, and event kind, and define idempotent consumer/deduplication behavior for replay after PITR (or narrow the guarantee to a stated transaction boundary and specify how all consumers are rolled back/reconciled). Keep it contract-based across bounded contexts; do not rely solely on dedupe rows in the database snapshot that PITR can erase. Add a test that delivers the event, restores to before its outbox/dedupe record, then recovers the operation and proves no duplicate semantic application/delivery.
- **Human Decision required:** No. This is an event/recovery contract gap.

## 6. Advisories

### `ACR020-R3-SA-ADV-01` — Carry forward pairwise capability non-inference tests

The R2 Solution and Integration reviews recorded advisories to test that stamp idempotency, lookup, and safe-replay flags never authorize cancellation, and cancellation flags never authorize stamping. R3 §§4 and 8 normatively preserve this distinction, but the 57 listed cases still do not name pairwise counterexample tests. Add these to future implementation acceptance evidence. This remains non-blocking at the semantic architecture level because the normative contract is explicit.

### `ACR020-R3-SA-ADV-02` — Add a populated `RETRYABLE_CONFIRMED` migration fixture

The populated predecessor fixture list in §18.4 covers unresolved, successful, pending-approval, terminal-failure, and multi-tenant records, but does not name `RETRYABLE_CONFIRMED`. Include a fixture proving that operation-specific replay proof/provenance is preserved or the state fails closed if it cannot be. The broader lossless-field invariant in §18.2 prevents silent reset; this advisory improves evidence precision.

## 7. Security handoff and governance state

Security review should assess restored sensitive fiscal data, backup encryption/access, tenant-restore authorization, stamped XML confidentiality/integrity, audit evidence and tamper resistance, replay threats, and exclusion of CSD/private-key material from operational storage and logs. These are Security Gate questions; this review does not resolve them.

- Provider contract: `PENDING`; provider-dependent semantics remain `BLOCKED BY CONTRACT` where unavailable.
- WP-021: `HOLD / UNAPPROVED`.
- Circuit Breaker: `NORMAL — AT LIMIT`; Builder R1/R2 consumed, future Builder R3 remains third/default-final; same-blocker recurrence `1`, maximum `1`; no reset or increment from ACR R3 authoring.
- `OQ-ARCH-02`: `OPEN`.
- Blocking findings: `2`.
- Advisories: `2`.

**SOLUTION ARCHITECTURE GATE = HOLD**

This verdict applies only to Frozen Candidate R3 `3be54b042044ea5f5ee483afffbe27588e965bd3`. It does not approve implementation, authorize WP-021 Builder R3, or advance the review sequence.

## 8. Handoff

`NEXT ACTION: Remediate ACR020-R3-SA-BLK-01 and ACR020-R3-SA-BLK-02 in a new frozen candidate, then perform exact-subject Solution Architecture revalidation.`

No Integration review or later gate is authorized by this HOLD. `OQ-ARCH-02` remains open; no PAC selection or Product Owner decision is requested for these technical contract gaps.
