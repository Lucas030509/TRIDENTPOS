# ACR-2026-020 R4 — Independent Solution Architecture Review

**Reviewer:** `01_Solution_Architect`  
**Repository:** `Lucas030509/TRIDENTPOS`  
**Canonical base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Candidate branch:** `governance/acr-2026-020-wp021-pac-reconciliation-r4`  
**Exact Frozen Candidate R4:** `2b6ac104554bcd585f96bc0606528c1d7142b218`  
**Artifact:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`  
**Governing EAAF:** `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362` (`1.3.0`)  
**Risk:** `RC4 — CRITICAL`  
**R4 review reset:** `5b7e7f2d0fb09268a6ef5c0509d158c4877ab7a0` — `RESET_AUTHORIZED — ACR-2026-020 R4 ONLY`  
**Quick Integrity R4 evidence:** `8d5d588ff5d05b3ca753a884d80c5918523e5db7` — PASS  
**Historical Solution Architecture R3 evidence:** `d6ae04c140044a3dd1b9e1d7dd377024d5e9cb5a` — HOLD, historical only  
**Historical Integration Architecture R2 evidence:** `d702aa6f78c87510d266173a91fa653df73ecb32` — PASS, compatibility input only  
**Historical Data Architecture R2 evidence:** `7358b0b680eca7118aa9c4760a7cd6437c881dce` — HOLD, historical only  
**Superseded Frozen Candidate R3:** `3be54b042044ea5f5ee483afffbe27588e965bd3`  
**Timestamp:** `2026-09-23T01:53:06.984Z`

## 1. Scope and exact-subject pre-flight

This is an independent, exact-subject Solution Architecture revalidation of R4. R3's Solution Architecture HOLD and its findings are historical context; they are not carried forward as a verdict on R4. The review assesses architecture semantics in the R4 artifact. It does not assess implementation conformance, runtime behavior, completed tests, Data, Security, QA, Code Review, Product Owner approval, merge authorization, or Builder authorization.

The pinned EAAF v1.3 Solution Architecture gate requires explicit system boundaries, topology and quality attributes; complete failure/recovery/data-authority decisions; and no unproved guarantee or silent authority change. Only PASS advances.

Pre-flight evidence:

- R3 → R4 compares as exactly 1 commit ahead / 0 behind, with one changed file: `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`, `+202 / -110`.
- The candidate subject and R4 Quick Integrity evidence bind to `2b6ac104554bcd585f96bc0606528c1d7142b218`.
- Quick Integrity R4 records the candidate branch tip at the exact R4 SHA and `main` at `0c46307e09fe77383320a86b6daff86d2983e9af`.
- Quick Integrity verifies the scoped reset evidence `5b7e7f2d0fb09268a6ef5c0509d158c4877ab7a0`; reset scope is R4 only, R5 is not authorized, and Builder counters are unchanged.
- The ACR delta does not alter runtime, database migrations, dependencies, lockfiles, workflows, `project-manifest.json`, or `OPEN_QUESTIONS.md`.

## 2. R4 delta and R3 blockers revalidated

Reviewed the exact R4 artifact, especially §§3–10, §§14–18, the 74-test matrix in §20, reset and circuit-breaker governance in §22, review sequence in §23, and non-decisions in §24.

### R3 blocker `ACR020-R3-SA-BLK-01`: restore recovery / Rule A consistency

R4 §§7–9.2 now harmonize restart and PITR recovery:

- Recovery loads the same durable semantic operation and evaluates operation-specific capabilities.
- Where authoritative lookup is available, it reconciles first and applies the normalized provider-neutral result.
- Where lookup is unavailable, controlled replay is permitted only through the same contract-proven, operation-specific Rule A idempotency path, preserving provider, operation type, operation ID, semantic key, immutable request hash, payload or target UUID, and approved provenance.
- Where neither safe path is proven, the operation remains `RECONCILIATION_REQUIRED` / `BLOCKED BY CONTRACT`; `AUTO_REDISPATCH = FORBIDDEN`.
- Replay transport success cannot bypass authoritative stamp/cancellation result validation. Restored absence of local fiscal results cannot prove that PAC did not execute the operation.

This removes the R3 conflict between the general safe-replay rule and restore recovery. It does not claim exactly-once PAC behavior and does not authorize a new semantic operation to evade ambiguity.

### R3 blocker `ACR020-R3-SA-BLK-02`: duplicate semantic effects after producer PITR

R4 §§14.1–14.2 defines at-least-once delivery, explicitly disclaims global exactly-once transport, and supplies:

- deterministic `semanticEventId` from tenant organization, immutable fiscal operation identity, and event kind;
- stable identity across retry, restart, PITR outbox reconstruction, and migrations;
- consumer-owned inbox/idempotency ledgers;
- atomic coupling of each consumer business mutation with its inbox marker in the consumer's local transaction;
- duplicate delivery as a NO-OP for conforming consumers; and
- `BLOCKED BY CONTRACT` for external/non-conforming consumers until a compatible deduplication contract exists.

This resolves the R3 producer-PITR gap at the semantic contract level without shared database state, cross-context foreign keys, or Billing private-table access. It gives no false guarantee for non-conforming subscribers.

### Consumer-local restore boundary

The contract couples a consumer's business effect and inbox marker in one local transaction. Under a restore of that consumer's transactional data boundary, the two records therefore roll back or recover together; replay is either needed for the restored business state or absorbed by the restored inbox. The R4 matrix does not name a consumer-local PITR/tenant-restore case separately. This is an evidence-precision advisory, provided future restore procedures preserve the stated local transaction boundary; no permitted R4 semantic path otherwise authorizes independently restoring the effect and inbox.

## 3. Authority, topology, and boundaries

| Concern | R4 authority/boundary | Assessment |
|---|---|---|
| Fiscal intent, operation identity, semantic idempotency, immutable request hash, local lifecycle, validated local finalization, invoice state, and outbox event identity/publication | Billing | Clear bounded-context ownership; local persistence does not become external fiscal truth. |
| External stamp/cancellation result, fiscal UUID, certified XML, and provider reconciliation | PAC/provider under an approved contract | Provider remains authoritative; timeout, crash, restore, rollback, and missing local records do not prove provider non-execution. |
| Consumer effect and inbox/idempotency marker | Each consumer, in its local transaction | Consumer-owned idempotency preserves modular boundaries; no Billing private data access is required. |
| Cloud modules and durable events | Existing modular monolith / Cloud PostgreSQL contract | R4 adds event identity and consumer idempotency semantics without requiring physical cross-context coupling. |
| Edge/offline operation and provider boundary | Existing Edge authority and approved adapter contract | R4 does not grant Edge authority to manufacture PAC success or add a provider-specific dependency. |

R4 preserves `MODULAR BY DESIGN — INTEGRATED BY CONTRACT`. It does not require Billing → private DB coupling, Billing → POS/Finance/Inventory runtime dependencies, cross-context physical FKs, or PAC adapter mutation of unrelated bounded contexts.

## 4. Data, migration, and restore compatibility

R4 retains the R3 Data remediation at semantic level:

- restore preserves tenant, branch, operation, request, provider, and ambiguity identity; it does not infer non-execution from restored absences;
- tenant-scoped recovery remains required under RLS + `FORCE RLS`;
- populated forward migration preserves identifiers, hashes, ambiguity, authoritative stamp/cancellation results, provider provenance, attempts, and outbox/event correlation;
- lossy mappings and destructive non-production down migrations fail closed; destructive production rollback is forbidden;
- the migration fixture includes operation-specific `RETRYABLE_CONFIRMED` proof and provenance; and
- retention and purge timing remain bound to future approved Product Owner/Legal authority.

No new authority, cross-context coupling, provider dependency, or data-retention rule is introduced.

## 5. Provider neutrality and non-decisions

R4 keeps stamp/cancel idempotency, lookup, and safe-replay capabilities independent. Unsupported capabilities remain `false / unavailable`; contractual provenance establishes evidence traceability but is not itself provider behavior. Mocks remain unable to prove production capability.

Provider semantics remain `PENDING / BLOCKED BY CONTRACT` where unavailable. R4 does not select a PAC, invent provider APIs/status strings/credentials/SLA, authorize factura-global scheduling or automatic period-end stamping, define cancellation business policy, or close `OQ-ARCH-02`.

## 6. Test/evidence architecture

The R4 matrix requires 74 tests. At architecture level it makes restore paths, operation-specific capability non-inference, incomplete result rejection, event identity stability, producer PITR redelivery, consumer duplicate NO-OP, atomic consumer effect+inbox, tenant isolation, migration preservation, and governance constraints objectively testable.

This is a requirement for future implementation evidence only. No implementation test or production provider behavior is claimed as passing. The consumer-local restore evidence detail is recorded below as advisory.

## 7. Findings

### Blockers: 0

No blocking Solution Architecture deficiency was identified in the exact R4 semantic contract. The two R3 blockers are resolved as described in §2.

### Advisory `ACR020-R4-SA-ADV-01` — Make consumer-local restore consistency explicit in evidence

Add a consumer-local PITR/tenant-restore acceptance case showing that the consumer's business mutation and inbox marker are recovered within the same consumer boundary, and that any producer replay is either applied to the restored state once or absorbed as a duplicate NO-OP. Keep the test within the consumer-owned transaction/recovery boundary and preserve the no-shared-state, no-cross-context-FK rule. This advisory does not require a specific physical database topology, PAC selection, or cross-context coupling.

## 8. Governance state and verdict

- Provider contract: `PENDING`; unproven provider-dependent semantics remain `BLOCKED BY CONTRACT`.
- Review reset: `RESET_AUTHORIZED — ACR-2026-020 R4 ONLY`; automatic R5 is `NOT AUTHORIZED`.
- WP-021: `HOLD / UNAPPROVED`.
- WP-021 Circuit Breaker: `NORMAL — AT LIMIT`; Builder R1/R2 consumed, future Builder R3 remains the third/default-final iteration, same-blocker recurrence `1 / max 1`; no counter reset or Builder authorization results from this review.
- `OQ-ARCH-02`: `OPEN`.
- Blockers: `0`.
- Advisories: `1`.

# SOLUTION ARCHITECTURE GATE = PASS

This PASS applies exclusively to Frozen Candidate R4 `2b6ac104554bcd585f96bc0606528c1d7142b218`. It does not establish implementation conformance, Product Owner approval, merge authorization, or WP-021 Builder R3 authorization.

## 9. Handoff

`NEXT AUTHORIZED GATE: 07_Integration_Architect — ACR-2026-020 R4 EXACT-SUBJECT REVALIDATION`

Do not advance to later gates in this activation. R5 remains unauthorized.
