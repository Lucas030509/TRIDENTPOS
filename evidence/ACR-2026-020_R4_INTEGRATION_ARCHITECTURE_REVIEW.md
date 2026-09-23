# ACR-2026-020 R4 — Independent Integration Architecture Review

**Reviewer role:** `07_Integration_Architect` — Independent Integration Architecture Reviewer  
**Repository:** `Lucas030509/TRIDENTPOS`  
**Canonical base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Exact Frozen Candidate R4:** `2b6ac104554bcd585f96bc0606528c1d7142b218`  
**Candidate branch:** `governance/acr-2026-020-wp021-pac-reconciliation-r4`  
**Artifact:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`  
**Governing EAAF:** `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362` (v1.3.0)  
**Risk:** `RC4 — CRITICAL`  
**Review reset evidence:** `5b7e7f2d0fb09268a6ef5c0509d158c4877ab7a0` — `RESET_AUTHORIZED — ACR-2026-020 R4 ONLY`  
**Quick Integrity R4 evidence:** `8d5d588ff5d05b3ca753a884d80c5918523e5db7` — PASS  
**Solution Architecture R4 evidence:** `871453289b67c0240c57f79f6659151d7f5aadcf` — PASS  
**Historical Integration R2 evidence:** `d702aa6f78c87510d266173a91fa653df73ecb32` — PASS (historical compatibility input only)  
**Historical Integration R1 evidence:** `dea99835a04ea3e4f44b3f78909b52983c418f1d` — HOLD  
**Data Architecture R2 evidence:** `7358b0b680eca7118aa9c4760a7cd6437c881dce` — HOLD (historical only)  
**Superseded Frozen Candidate R3:** `3be54b042044ea5f5ee483afffbe27588e965bd3`  
**Evidence backend:** `GIT_SIDECAR`  
**Timestamp:** `2026-09-23T02:02:02.266Z`

## 1. Scope, independence, and exact-subject pre-flight

This is an independent, exact-subject Integration Architecture review of R4, focused on PAC capabilities/provenance, restore replay, cancellation, durable event delivery, semantic event identity, producer/consumer contracts, redelivery, compatibility, and preservation of the previously approved R2 Integration semantics.

R2 Integration PASS is historical evidence only and is not carried forward automatically. This review does not author or remediate the ACR; it does not assess implementation conformance, perform Solution/Data/Security/QA/Code review, select a PAC, close `OQ-ARCH-02`, or authorize WP-021 Builder R3.

Pre-flight independently verified:

- R4 candidate branch equals exact Frozen Candidate R4 `2b6ac104554bcd585f96bc0606528c1d7142b218` (`ahead_by=0`, `behind_by=0`).
- The reset sidecar exists, records explicit authorization for R4 only, and does not reset Builder counters or authorize R5.
- Quick Integrity R4 evidence exists, binds to exact R4, and reports PASS.
- Solution Architecture R4 evidence exists and reports PASS.
- R3 → R4 is exactly 1 commit ahead / 0 behind; exactly one candidate file changed, `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`, with `+202 / -110`.
- `main` equals canonical base `0c46307e09fe77383320a86b6daff86d2983e9af`.
- Review authority remains `RESET_AUTHORIZED — ACR-2026-020 R4 ONLY`; R5 remains `NOT AUTHORIZED`.

The pinned EAAF `gates/INTEGRATION_GATE.md` requires explicit contract ownership, versioning, and compatibility; retry/idempotency/timeout/failure/replay semantics; authority and context boundaries; and Security handoff where applicable. Only PASS advances.

## 2. R2 Integration contract continuity

The R4 artifact retains the R2 Integration PASS semantics:

- Billing owns local fiscal intent, operation identity, request hash, local lifecycle, validated local finalization, and outbox; PAC/provider remains authoritative for external stamp/cancellation outcomes and reconciliation.
- Local timeout, process crash, rollback, PITR, missing response, or absent local fiscal records are not external proof of non-execution.
- STAMP and CANCEL capabilities remain independent; unproven capabilities default to `false / unavailable`; mocks do not establish production capability.
- Rule A and Rule B remain separate and operation-specific. Otherwise `AUTO_REDISPATCH = FORBIDDEN`.
- Cancellation outcomes remain provider-neutral, and final `CANCELLED` requires authoritative correlated evidence. `PENDING_APPROVAL != CANCELLED`; `UNKNOWN` stays unresolved; `NOT_FOUND_CONFIRMED` alone does not authorize replay.
- No exactly-once PAC or transport guarantee is claimed. No Billing/private DB access, shared cross-context inbox, physical cross-context FK, or unrelated context mutation is introduced.

The R1 integration blockers `ACR020-R1-INT-BLK-01` and `ACR020-R1-INT-BLK-02` remain remediated at semantic level.

## 3. R4 restore paths and replay

### Path A — Authoritative lookup available

For the exact operation type, R4 requires authoritative lookup/reconciliation, provider-neutral outcome mapping under approved provider semantics, result validation, then finalization, unresolved status, or safe-replay evaluation. Raw provider statuses cannot become canonical outcomes without approved provider mapping. Reconciliation is preferred when supported.

### Path B — Lookup unavailable, Rule A proven

R4 permits controlled replay only under an approved provider contract that proves idempotent replay for the exact operation type and unchanged provider, operation type, semantic idempotency key, immutable request hash, signed payload or target UUID, and operation-specific capability/provenance. Requiring the same local `operationId` is a local correlation invariant; R4 does not represent `operationId` alone as a provider idempotency primitive. The provider-side idempotency key/guarantee must itself be supported by approved contractual evidence.

Successful replay transport does not equal fiscal success. Stamp success still needs authoritative UUID/certified XML and consistency checks (§13); cancellation still needs authoritative cancellation evidence (§15.3).

### Path C — Neither safe path proven

R4 explicitly retains:

```text
RECONCILIATION_REQUIRED
BLOCKED BY CONTRACT
AUTO_REDISPATCH = FORBIDDEN
```

It prohibits minting a new semantic operation to evade ambiguity.

### Rule A vs. Rule B

Rule A is provider-guaranteed idempotent replay of the exact same request/key. Rule B requires both authoritative `NOT_FOUND_CONFIRMED` and a separate operation-specific contractual safe-after-not-found guarantee. Timeout, socket loss, restart, PITR, local rollback, missing response, or local absence substitutes for neither condition.

## 4. Capability provenance — blocking finding

R4's provenance model names contract identifier, version, evidence reference/digest, effective period, and scope/limitations. Section 4.1 requires approved evidence for a production capability set to true, and §17 keeps unproven provider semantics blocked. However, the contract does not state that capability use must fail closed when the cited evidence is expired, out of scope, ambiguous, or no longer effective; the effective-period and limitations fields are not given a validation/authorization rule. Test #36 covers missing required approved evidence, but not expired or out-of-scope evidence.

This leaves an unsafe permitted interpretation: a persisted `true` capability can still authorize Path A/B or Rule A after its evidence period has expired or its semantic scope does not cover the operation/replay state.

## 5. Event delivery, semantic identity, and consumers

R4 §§14.1–14.2 explicitly state at-least-once transport and disclaim global exactly-once delivery. Correctness is assigned to deterministic event identity and consumer semantic idempotency, not to transport guarantees.

`semanticEventId = deterministic_identity(organizationId, operationId, eventKind)` is stable through retries, outbox reconstruction, PITR, and migration; tenant identity and event kind differentiate organization boundaries and STAMP/CANCEL event kinds. No schema-version input is needed in the semantic identity, which should identify the fiscal effect independently from representation version.

Billing owns event identity and durable outbox publication. It does not read consumer-private state. Conforming consumers verify tenant/event identity, check a consumer-owned inbox, apply business mutation and insert the inbox marker atomically in one local transaction, and treat duplicates as NO-OP. This structurally prevents the effect-without-marker and marker-without-effect crash windows. If both commit and ACK is lost, redelivery is a NO-OP. Producer PITR re-emits the same event identity for conforming consumers. Third-party or non-conforming consumers without a compatible deduplication contract remain `BLOCKED BY CONTRACT`; no protection is inferred from internal mocks/tests.

The consumer-local restore advisory `ACR020-R4-SA-ADV-01` remains non-blocking for this gate: the effect and inbox are coupled in the consumer's local transaction/recovery boundary. Future evidence should prove they remain mutually consistent under consumer-local PITR/tenant restore; no global distributed restore transaction is required.

## 6. Blocking findings

### `ACR020-R4-INT-BLK-01` — Fiscal event contract versioning and compatibility are unspecified

- **Integration invariant:** Every event/message contract must have explicit ownership, versioning, and compatibility rules; semantic identity must remain separate from schema/contract version.
- **Source:** EAAF v1.3 `gates/INTEGRATION_GATE.md`, blocking requirement 1; R4 §§14.1–14.2, 18.2, and tests #45–54; canonical `ADR/ADR-007-durable-cloud-integration-events.md` §§5, 9, 11.
- **Evidence:** R4 defines the Billing producer and consumer ownership, `eventKind`, `semanticEventId`, and consumer inbox behavior, but defines no fiscal event schema/contract version, compatibility policy, unknown-version handling, or rule distinguishing schema evolution from semantic-event identity. Canonical ADR-007 specifies outbox persistence, dispatch/retry/DLQ, and tenant traceability, but does not establish fiscal event schema versioning/compatibility. Tests cover event identity/delivery/idempotency and migration preservation but do not cover event contract compatibility.
- **Failure scenario:** Billing evolves the payload for an already-defined fiscal event while an older consumer remains active or retries an older event. The consumer has no governed way to determine which schema contract applies or whether it is compatible; it may misinterpret/misapply a fiscal accounting effect or repeatedly fail delivery. Including a schema version in event identity would create the opposite risk by treating the same fiscal effect as a new semantic event.
- **Impact:** Cross-context event interoperability and fiscal downstream correctness remain ambiguous at RC4; the integration contract lacks a blocking EAAF requirement.
- **Required remediation:** Define the event contract owner, a schema/contract versioning model, compatibility/consumer behavior for supported versions, and how representation version remains distinct from `semanticEventId`. Add objective compatibility and redelivery tests. Do not require a specific broker, protocol field name, or provider.
- **Human Decision required:** NO. This is a technical event-contract definition; no PAC or Product Owner business decision is required.

### `ACR020-R4-INT-BLK-02` — Capability provenance validity and scope are not fail-closed

- **Integration invariant:** A production capability may authorize lookup or replay only while approved contractual evidence is current, applicable to that operation and replay condition, and unambiguous.
- **Source:** R4 §§4–4.1, 8–9.2, 17, and test #36.
- **Evidence:** R4 requires an approved evidence reference for a capability set to true and records `effectivePeriod` and `guaranteeScopeOrLimitations`, but it does not state that expired, out-of-scope, ambiguous, or no-longer-effective provenance invalidates the capability before the capability is used. Test #36 covers missing approved provenance, not expired or scope-mismatched provenance.
- **Failure scenario:** A stored `supportsCancellationIdempotencyKey = true` declaration cites a contract version whose guarantee expired or does not cover replay after PITR. The adapter still evaluates the capability as true and redispatches the cancellation under Rule A.
- **Impact:** An unsupported operation-specific replay may create a duplicate external fiscal effect at RC4. Recording provenance without enforcing its validity and scope can become false authority.
- **Required remediation:** Make capability use conditional on approved provenance that is current, unambiguous, and applicable to the exact operation and guarantee. Expired, missing, ambiguous, or out-of-scope evidence must fail closed to `false / unavailable`, causing `BLOCKED BY CONTRACT` and forbidding automatic replay unless another applicable safe path is independently proven. Add objective evidence cases for expired, out-of-scope, ambiguous, and valid provenance. No provider selection is required.
- **Human Decision required:** NO. This is a contract-validation rule; capability approval must be backed by approved provider evidence, without inventing provider semantics.

## 7. Advisory

### `ACR020-R4-INT-ADV-01` — Prove consumer-local restore consistency

Add implementation/evidence coverage showing that consumer business state and its inbox marker recover together within that consumer's own restore boundary; on subsequent redelivery, the event is either applied once to the restored state or absorbed as a duplicate NO-OP. This does not require cross-context state or a distributed restore transaction.

## 8. Security handoff

For `08_Security_Architect` consideration: event authenticity/integrity and tenant binding; spoofed/replayed event handling; provider-response authenticity and correlation; contract-provenance integrity/change control; and exposure of signed/certified fiscal payloads and identifiers. This review makes no Security Gate finding.

## 9. Provider, governance, and verdict

- Provider contract: `PENDING`; any unproven lookup, idempotency, safe-after-not-found, status mapping, or cancellation-finality semantics remain `BLOCKED BY CONTRACT`.
- `WP-021 = HOLD / UNAPPROVED`.
- WP-021 Circuit Breaker: `NORMAL — AT LIMIT`; Builder R1/R2 consumed, future Builder R3 remains third/default-final; same-blocker recurrence remains 1/max 1. This review does not reset or spend Builder budget.
- Review reset: `RESET_AUTHORIZED — ACR-2026-020 R4 ONLY`; R5 is `NOT AUTHORIZED`.
- `OQ-ARCH-02 = OPEN`.
- Blocking findings: 2.
- Advisories: 1.

# INTEGRATION GATE = HOLD

This result applies exclusively to exact Frozen Candidate R4 `2b6ac104554bcd585f96bc0606528c1d7142b218`. It does not assess implementation conformance or authorize WP-021 Builder R3.

## 10. Handoff

Advancement stops at this gate. No R5 candidate is authorized by the review reset. No Product Owner decision is required merely to define the missing event contract versioning/compatibility rules or to fail closed on invalid capability provenance.

**NEXT ACTION:** Remediate `ACR020-R4-INT-BLK-01` and `ACR020-R4-INT-BLK-02` through an explicitly authorized governance path. Do not advance to Data Architecture in this activation.
