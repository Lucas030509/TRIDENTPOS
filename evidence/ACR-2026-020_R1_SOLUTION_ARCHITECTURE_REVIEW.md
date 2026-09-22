# ACR-2026-020 R1 — INDEPENDENT SOLUTION ARCHITECTURE REVIEW

**Gate:** `SOLUTION ARCHITECTURE GATE`
**Reviewer role:** `01_Solution_Architect`
**Review mode:** Independent semantic review; no implementation, candidate, or `main` mutation
**Repository:** `Lucas030509/TRIDENTPOS`
**Candidate branch reviewed:** `governance/acr-2026-020-wp021-pac-reconciliation-r1`
**Exact Frozen Candidate R1:** `2b71ed748c9ae542533b91b23be51159a6ab81c8`
**Candidate artifact:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`
**Canonical governance base:** `0c46307e09fe77383320a86b6daff86d2983e9af`
**Quick Integrity evidence:** `c84d70701b29e054852ac2420530a2946972d640`
**Governing EAAF:** `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362`
**EAAF version:** `1.3.0`
**Risk class:** `RC4 — CRITICAL`
**Observed WP-021 R2 subject:** `2d9cd149120c60b4d30778d0583344196bd210b7`
**Observed WP-021 state:** `HOLD / UNAPPROVED`
**Review timestamp:** `2026-09-22T20:04:50Z`

## 1. Scope and independence

This record evaluates only the semantic sufficiency of the exact Frozen Candidate at the Solution Architecture gate. It does not approve WP-021 R2, authorize WP-021 R3, select a PAC, close a Product Owner question, or perform the Integration, Data, Security, QA, or Code Review gates.

The reviewer did not author ACR-2026-020, the observed WP-021 R2 implementation, or the Frozen Candidate. The review was performed against the exact subject SHA; no moving branch tip was substituted.

## 2. Subject binding / pre-flight

**Result: PASS.**

Independent checks:

- Candidate branch tip resolves to `2b71ed748c9ae542533b91b23be51159a6ab81c8`.
- `main` resolves to `0c46307e09fe77383320a86b6daff86d2983e9af`.
- The candidate is exactly one commit ahead of the canonical base and zero commits behind it.
- The base-to-candidate delta is exactly one file: `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`.
- The delta is documentation-only and is `+708 / -0`.
- Quick Integrity commit `c84d70701b29e054852ac2420530a2946972d640` has parent `2b71ed748c9ae542533b91b23be51159a6ab81c8` and records the same subject binding.

The candidate remained unchanged during review. The evidence branch was created directly from the Frozen Candidate.

## 3. Authoritative inputs inspected

The following inputs at `main@0c46307e09fe77383320a86b6daff86d2983e9af` were inspected as applicable to this gate:

- `FUNCTIONAL_ARCHITECTURE.md`
- `SOLUTION_ARCHITECTURE.md`
- `IMPLEMENTATION_PLAN.md`
- `MODULE_CATALOG.md`
- `CAPABILITY_MAP.md`
- `PRODUCT_SCOPE.md`
- `PRODUCT_DECISIONS.md`
- `OPEN_QUESTIONS.md`
- `ARCHITECTURE_RISKS.md`
- `DATA_ARCHITECTURE_RISKS.md`
- `SYNC_AND_OFFLINE_ARCHITECTURE.md`
- `ADR/ADR-001-modular-monolith-bounded-contexts.md`
- `ADR/ADR-002-cloud-branch-data-authority-by-topology.md`
- `ADR/ADR-004-embedded-database-sqlite-durability.md`
- `ADR/ADR-007-durable-cloud-integration-events.md`
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md`
- `project-manifest.json`

The exact EAAF v1.3.0 pin is bound by the candidate, `project-manifest.json`, and Quick Integrity evidence. The gate obligations used here are the pinned `01_Solution_Architect` / `SOLUTION_ARCHITECTURE_GATE` review directives supplied with this activation. No alternate EAAF version was substituted.

The observed R2 subject was inspected only as implementation context and remediation-target evidence. It was not treated as architectural authority or implementation conformance evidence. Observed implementation conformance is therefore not declared by this record.

## 4. System context and authority boundaries

**Result: PASS.**

The candidate explicitly separates:

- Billing as owner of fiscal intent, semantic idempotency identity, immutable request hash, durable local operation lifecycle, CSD readiness, pre-stamp XML, and validated local finalization.
- The PAC/provider as authority for acceptance/rejection, fiscal UUID, certified/stamped XML, provider metadata, cancellation outcome, and provider reconciliation outcome.
- Local fiscal intent/state from external fiscal outcome; transport uncertainty is not a fiscal conclusion.
- Authoritative stamped result from pre-stamp material; pre-stamp XML can never become stamped XML.
- Technical recovery/reconciliation from Product Owner business policy; `OQ-ARCH-02` is explicitly preserved.

The canonical solution architecture and ADR-013 identify the authorized composition roots, with cloud cross-context orchestration in `@trident/cloud-server`; the candidate does not authorize a Billing-to-infrastructure runtime dependency. PAC behavior remains behind a provider-neutral adapter capability contract. The candidate's local finalization rule establishes the local transaction boundary: fiscal operation, invoice state, validated result, and `FacturaFiscalEmitida` outbox event commit together; the external PAC call remains outside that local transaction and is recovered through reconciliation.

No dual-authority path capable of producing contradictory fiscal truth was found.

## 5. Modular architecture conformance

**Result: PASS.**

The candidate is compatible with `MODULAR BY DESIGN — INTEGRATED BY CONTRACT`:

- Billing remains the Billing bounded context and owns fiscal operation semantics.
- All business modules remain dependent on Platform Core rather than on one another at runtime.
- PAC interaction is an external capability/adapter concern and does not require a Billing dependency on database, Edge, POS, Finance, Inventory, or another business package.
- Cross-context orchestration is reserved for the authorized composition layer defined by the canonical solution architecture and ADR-013.
- No physical cross-context foreign key is authorized.
- Fiscal recovery is not allowed to create hidden runtime coupling with POS, Finance, Inventory, or TRIDENTPOS.

The candidate preserves the existing boundaries and explicitly makes any required schema change a governed RC4 change. No architecture-by-implementation or package-boundary exception is introduced.

## 6. Failure and recovery analysis

The candidate fails safe and converges without inventing external truth for the required cases:

| Case | Architectural treatment | Result |
|---|---|---|
| PAC stamps, response is lost | Durable operation becomes `RECONCILIATION_REQUIRED`; no local `STAMPED`; reconcile before dispatch | PASS |
| Timeout before outcome is known | Timeout is ambiguous, never proof of failure | PASS |
| Crash after dispatch | Preserve operation identity/reference and reconcile after restart | PASS |
| PAC success before local finalization | Validate returned/reconciled fiscal evidence and finalize existing operation atomically | PASS |
| Restart with `IN_FLIGHT` | Treat prior attempt as potentially ambiguous and reconcile; do not blindly retry | PASS |
| Restart with `RECONCILIATION_REQUIRED` | Reconciliation remains the next action; no blind redispatch | PASS |
| `STAMPED_CONFIRMED` | Finalize existing operation without another stamp request | PASS |
| `NOT_FOUND_CONFIRMED` | Redispatch only under explicit provider safe-replay contract | PASS |
| `PENDING` | Remain `RECONCILIATION_REQUIRED` | PASS |
| `UNKNOWN` | Remain `RECONCILIATION_REQUIRED` | PASS |
| `STAMPED` without XML | Cannot become `SUCCEEDED`; reconcile or terminally fail only when definitive | PASS |
| UUID inconsistent with XML | Success is forbidden; result is internally inconsistent | PASS |
| Two concurrent workers | Durable attempt ownership is required; uniqueness alone is insufficient | PASS |
| Local finalization failure | Recover existing external result; no duplicate dispatch | PASS |
| Ambiguous cancellation | Never infer cancellation failure or success from transport | PASS |
| `PENDING_APPROVAL` cancellation | Remains distinct from final `CANCELLED` | PASS |
| No authoritative provider lookup | Capability unavailable; production path remains blocked, not guessed | PASS |
| No provider replay/idempotency guarantee | `AUTO_REDISPATCH = FORBIDDEN` | PASS |
| Incomplete/inconsistent CSD | Fail closed before PAC invocation | PASS |
| Restart with pending reconciliation | Durable state remains recoverable and operation identity is preserved | PASS |

The contract does not promise distributed exactly-once external effect. It defines local atomic finalization plus provider-contract-dependent reconciliation, which is the correct architecture for the PAC/local-DB boundary.

## 7. State model review

**Result: PASS.**

The states have distinct semantics:

- `PENDING` and `READY` represent pre-dispatch preparation/readiness.
- `IN_FLIGHT` represents an active or not-yet-resolved attempt.
- `SUCCEEDED` requires validated authoritative fiscal evidence.
- `FAILED_TERMINAL` requires definitive rejection/failure semantics.
- `RETRYABLE_CONFIRMED` requires proof that replay cannot duplicate an external fiscal effect.
- `RECONCILIATION_REQUIRED` represents external ambiguity and prohibits blind redispatch.

The candidate explicitly prevents ambiguous outcomes from becoming fiscal success or from entering retry merely because the process restarted, the DB rolled back, a local UUID is absent, or a transport error occurred. `PENDING`/`UNKNOWN` reconciliation cannot enter success or dispatch without an authoritative result.

## 8. Safe replay architecture

**Result: PASS.**

Rules A and B are sufficiently normative:

- Rule A requires the approved provider contract to guarantee idempotent replay for the same provider, semantic identity, request hash, signed payload identity, and provider idempotency key.
- Rule B requires authoritative not-found/non-acceptance plus an approved provider declaration that replay is safe from that state.
- Without A or B, automatic redispatch is forbidden.

The candidate explicitly rejects mocks, HTTP status, timeout category, process restart, local absence of success, local rollback, and an idempotency key by itself as proof of safe replay. This closes the principal duplicate-stamp attack paths.

## 9. Crash consistency and transaction boundary

**Result: PASS.**

The candidate correctly models the PAC call and local DB as a distributed consistency boundary. It does not imply atomicity across the external provider. After validated success, the local transaction atomically finalizes the operation, authoritative UUID, stamped XML/metadata, invoice state, and durable outbox event. If the transaction fails after external success, the existing operation is recovered through authoritative reconciliation rather than redispatched blindly.

Existing ADR-007 and the canonical solution architecture provide the durable outbox convention; the candidate applies that convention to fiscal finalization without changing its authority model.

## 10. Concurrency and single-dispatch ownership

**Result: PASS.**

The candidate requires that one semantic fiscal operation have at most one dispatcher owner for an attempt and explicitly permits durable lease, row-lock/CAS, or an equivalent transaction-safe ownership mechanism. It also states that local uniqueness alone is insufficient. This is an architecture-level requirement, while the exact mechanism and runtime proof remain implementation and later specialist-gate concerns.

Recovery preserves the same semantic idempotency key, immutable request hash, operation identity, and provider reference. Restart cannot reset the identity or create a second semantic operation to conceal an ambiguous first attempt.

## 11. Data authority — solution-level assessment

**Result: PASS at solution level; physical validation delegated.**

The candidate assigns authority coherently:

| Concern | Authority |
|---|---|
| Fiscal operation intent | Billing |
| Semantic identity and request hash | Billing, durably preserved |
| Operation lifecycle | Billing durable operation store |
| Provider outcome | PAC/provider under approved contract |
| Stamped XML and fiscal UUID | PAC/provider is source of authoritative result; Billing stores it only after validation |
| Invoice lifecycle | Billing |
| Cancellation result | PAC/provider under approved contract, then Billing finalization |
| Audit/recovery metadata | Billing durable operation/audit model without secrets |

The model avoids dual writers and preserves enough identity/reference data to recover after restart. RLS, FORCE RLS, composite tenant relationships, physical schema, migration safety, and implementation-level data authority remain for `03_Data_Architect`.

## 12. CSD and secret architecture — solution-level assessment

**Result: PASS at solution level; detailed validation delegated.**

The candidate requires an approved vault/reference for private-key retrieval, prohibits persistence and emission of private key material, requires certificate/private-key coherence, forbids synthetic production metadata and test fallbacks, and fails closed when the CSD set is incomplete or invalid. It deliberately avoids asserting unproved memory-zeroization guarantees.

Detailed vault implementation, cryptographic validation, logging/redaction, RLS bypass resistance, and security evidence remain for `08_Security_Architect`.

## 13. Authoritative fiscal success

**Result: PASS.**

`provider status = STAMPED` is explicitly insufficient. Local fiscal success requires, at minimum:

- non-empty fiscal UUID;
- certified/stamped XML from the PAC or authoritative reconciliation path;
- parseable XML;
- Timbre Fiscal Digital identity in the stamped XML;
- UUID consistency between XML and accepted provider result;
- known provider identity;
- correlation to the same operation/request identity.

Pre-stamp XML fallback is expressly prohibited. Incomplete or contradictory evidence cannot become `SUCCEEDED`; it remains reconciliation-required or terminal only when the provider contract makes the outcome definitive.

## 14. Cancellation architecture

**Result: PASS.**

Cancellation is modeled as a durable external side effect with semantic identity, immutable request identity, provider reference, lifecycle state, authoritative validation, and equivalent ambiguity/reconciliation discipline. Timeout does not mean cancellation failure. Ambiguous cancellation cannot become `CANCELLED`; `PENDING_APPROVAL` remains distinct from final cancellation. The candidate intentionally leaves the business cancellation policy and provider-specific status semantics outside this ACR.

## 15. OQ-ARCH-02 protection

**Result: PASS.**

The exact canonical `OPEN_QUESTIONS.md` keeps `OQ-ARCH-02` OPEN. The candidate authorizes technical recovery for already-created explicit fiscal operations only. It does not authorize automatic selection of unclaimed tickets, factura global creation, period-end stamping, monthly scheduling, or any other business policy decision.

## 16. Provider contract boundary

**Result: PASS.**

The candidate defines architecture-level capabilities an adapter must declare but does not fabricate a PAC, endpoint, credential, schema, URL, status mapping, SLA, lookup guarantee, or replay guarantee. Missing provider semantics remain `BLOCKED BY CONTRACT`. Mocks are explicitly test-only and cannot establish production behavior.

## 17. Quality attributes

**Result: PASS at solution level; specialist evidence delegated where applicable.**

| Attribute | Solution-level disposition |
|---|---|
| Correctness / consistency | Authoritative result validation; no dual fiscal authority |
| Recoverability / restart safety | Durable operation identity and reconciliation-first recovery |
| Durability | Durable state plus atomic local finalization/outbox |
| Idempotency | Immutable semantic key and request hash; provider contract required for replay |
| Concurrency safety | Durable single-dispatch ownership requirement |
| Tenant isolation | Tenant/branch requirements, RLS + FORCE RLS; physical proof delegated |
| Security boundaries | Vault reference, no private-key persistence, fail-closed CSD |
| Auditability / diagnosability | Operation, provider, attempt, state, outcome, error and timestamps without secrets |
| Extensibility | Provider-neutral capability and adapter boundary |
| Failure containment | Unknown/pending/ambiguous results remain blocked and reconcilable |

No numeric quality score was assigned.

## 18. ADR completeness assessment

**Result: PASS for this gate; no pre-canonicalization ADR blocker identified.**

The candidate is itself the governed architecture change record for the durable fiscal operation state machine, authoritative reconciliation, provider capability declaration, safe replay, distributed PAC/local-DB boundary, and single-dispatch ownership. Existing canonical architecture records provide the surrounding authority:

- `ADR-001` — modular monolith and bounded-context isolation;
- `ADR-002` — data authority by topology;
- `ADR-007` — durable cloud integration outbox;
- `ADR-013` — package topology and composition roots;
- `IMPLEMENTATION_PLAN.md` / WP-021 — Billing ownership and provider-contract-pending boundary.

No existing ADR contradicts the candidate, and the candidate contains sufficient durable normative detail to be canonicalized as an ACR. A future ADR may be useful to consolidate the fiscal protocol after provider selection, but that is not a blocker to this Solution Architecture Gate and must not invent provider behavior prematurely.

## 19. Observed WP-021 R2 and architecture drift

The observed R2 subject `2d9cd149120c60b4d30778d0583344196bd210b7` was used only to verify that the candidate describes a coherent remediation target: synthetic CSD fallback, mock-dependent replay, incomplete success evidence, and ambiguous crash/reconciliation behavior are addressed by the candidate's stated invariants.

This review does not declare R2 conformant, does not approve it, and does not authorize R3. The observed implementation review is not treated as complete architecture-generation evidence; no observed implementation PASS is derived from it.

## 20. Circuit Breaker / R3 boundary

**Result: PASS for continuity; counters unchanged.**

The candidate and Quick Integrity evidence preserve:

- Builder R1 consumed;
- Builder R2 consumed;
- proposed R3 as the third/default-final Builder iteration;
- same crash/reconciliation blocker recurrence = `1`;
- configured maximum recurrence = `1`;
- current state = `NORMAL — AT LIMIT`.

This review does not reset or alter any counter. If the same blocker recurs in R3, recurrence becomes `2 > 1`, the Circuit Breaker opens, no autonomous R4 is allowed, and an authorized Human Decision/reset is required.

## 21. Anti-false-PASS attack results

No viable unsafe interpretation was found for the required attacks:

- timeout or socket loss → cannot be resent without reconciliation or proven provider replay safety;
- mock behavior → cannot establish production idempotency;
- local rollback or missing local UUID → cannot prove external non-stamping;
- `IN_FLIGHT` after restart → cannot be converted directly to retry;
- missing certified XML or inconsistent UUID → cannot become success;
- pre-stamp XML → cannot be stored as stamped XML;
- concurrent workers → durable single-dispatch ownership is required;
- recovery → cannot reset identity or create a second semantic operation;
- ambiguous cancellation → cannot become final cancellation;
- `PENDING_APPROVAL` → cannot equal `CANCELLED`;
- provider choice/capability invention → forbidden and `BLOCKED BY CONTRACT` applies;
- `OQ-ARCH-02` → remains OPEN;
- module boundaries → no runtime dependency or physical cross-context FK is authorized;
- Circuit Breaker history → cannot be reset;
- WP-021 R3 → cannot start before all §23 reviews, synthesis, Product Owner approval, PR/CI/merge/post-merge controls, and canonicalization.

## 22. Findings

### Blocking findings

None.

### Advisories

None material to the Solution Architecture Gate. The following are explicitly delegated rather than silently converted into PASS: provider-specific lookup/replay semantics, physical schema/RLS/migration proof, secret and cryptographic controls, runtime crash/concurrency evidence, integration behavior, QA evidence, and repository/code conformance.

## 23. Residual risks and delegated gates

The principal residual risks are provider-contract availability and future implementation misinterpretation. They are controlled by the candidate's `BLOCKED BY CONTRACT` rule, required evidence levels, and independent downstream gates. This PASS must not be read as PAC production readiness or implementation approval.

Required next reviews remain:

1. `07_Integration_Architect` — independent integration review;
2. `03_Data_Architect` — data authority, schema, RLS and migration review;
3. `08_Security_Architect` — CSD, vault, cryptographic and secret review;
4. `09_QA_Test_Architect` — required R3 evidence review;
5. `11_Code_Reviewer` — repository/code consistency review;
6. Coordinator synthesis, Product Owner approval, PR Gate, exact-head CI/security, merge authorization, merge, post-merge validation, and only then WP-021 R3 authorization.

## 24. Final Solution Architecture Gate result

# PASS

This PASS applies exclusively to Frozen Candidate `2b71ed748c9ae542533b91b23be51159a6ab81c8`.

It does not mean ACR-2026-020 is canonical, WP-021 R2 is approved, WP-021 R3 is authorized, PAC integration is production-ready, Product Owner approval exists, or any later gate has passed.

**NEXT AUTHORIZED GATE: `07_Integration_Architect` — INDEPENDENT REVIEW OF ACR-2026-020 R1**

## 25. Final handoff summary

1. **Exact Frozen Candidate reviewed:** `2b71ed748c9ae542533b91b23be51159a6ab81c8`
2. **Quick Integrity evidence used:** `c84d70701b29e054852ac2420530a2946972d640`
3. **Solution Architecture evidence commit SHA:** populated by the immutable sidecar commit containing this file
4. **Final gate verdict:** `PASS`
5. **Blocker/advisory count:** `0 / 0`
6. **Circuit Breaker state:** `NORMAL — AT LIMIT`
7. **`OQ-ARCH-02` state:** `OPEN`
8. **Next authorized gate:** `07_Integration_Architect` — independent review of ACR-2026-020 R1
