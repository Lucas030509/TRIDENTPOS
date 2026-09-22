# ACR-2026-020 — WP-021 PAC RECONCILIATION & FISCAL SUCCESS CONTRACT

**Status:** PROPOSED / FROZEN CANDIDATE R1 — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-22  
**Scope:** WP-021 — Fiscal Invoicing Engine  
**Canonical Governance Base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Governing Framework:** EAAF v1.3.0 @ `167cea36c09c1031c763971ff790db2e0d0f7362`  
**Parent Governance:** ACR-2026-019 — DONE / CANONICAL  
**ACR-2026-019 Canonical Migration Merge:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**ACR-2026-019 Post-Merge Evidence:** `bc7ddad3cf3425b7c8cb8e7ca10d20693ad3a6f7`  
**Observed WP-021 R2 Subject:** `2d9cd149120c60b4d30778d0583344196bd210b7`  
**Risk Class:** RC4 — CRITICAL  
**Primary Review Domains:** Solution Architecture, Integration, Data, Security, QA, Code Review  
**Protected Product Owner Question:** `OQ-ARCH-02` remains OPEN

---

## 1. Purpose

WP-021 requires a provider-neutral fiscal integration contract that prevents duplicate or false fiscal state when a PAC request has an ambiguous outcome.

This ACR does not select a PAC vendor, invent provider-specific APIs, close `OQ-ARCH-02`, or authorize automatic fiscal batch scheduling.

It defines the minimum architecture and safety invariants that any future PAC adapter must satisfy before TRIDENTPOS can claim:

- safe fiscal stamping;
- durable retry;
- restart recovery;
- duplicate-stamp prevention;
- authoritative reconciliation;
- valid fiscal success;
- safe cancellation recovery.

---

## 2. Why This ACR Is Required

WP-021 R2 materially improves fiscal safety, but independent inspection identified unresolved RC4 hazards:

1. CSD metadata can still fall back to synthetic certificate values when the configured fiscal certificate is incomplete.
2. `RECONCILIATION_REQUIRED` currently returns to `IN_FLIGHT` and may call `timbrar()` again without first obtaining an authoritative provider result.
3. A PAC response labeled `STAMPED` can be accepted even when required fiscal evidence is missing.
4. The current mock provides deterministic replay behavior that is not yet guaranteed by any real PAC provider contract.
5. Cancellation is also an external fiscal effect and requires the same ambiguity discipline.

The canonical Implementation Plan already states:

- `PAC Web Services (PROVIDER CONTRACT PENDING)`;
- PAC timeout handling must avoid duplicate stamp requests;
- `SEC-VAL-10` requires PAC contract validation.

Therefore provider behavior cannot be inferred from tests or mocks.

---

## 3. Authority Boundaries

### 3.1 Billing owns

Billing is authoritative for:

- fiscal invoice lifecycle;
- fiscal operation intent;
- semantic idempotency identity;
- request hash;
- local durable fiscal operation state;
- CSD readiness validation;
- signed pre-stamp XML;
- authoritative storage of successful fiscal result after validation;
- durable `FacturaFiscalEmitida` / cancellation event publication.

### 3.2 PAC owns

The external PAC/provider is authoritative for:

- whether a submitted CFDI was accepted/rejected;
- fiscal UUID returned by certification;
- certified/stamped XML;
- PAC/SAT fiscal response metadata available under the provider contract;
- provider-side cancellation outcome;
- provider-side status/reconciliation response.

### 3.3 No dual authority

A local timeout, socket close, process crash, or missing HTTP response does not prove that the PAC did not perform the fiscal operation.

TRIDENTPOS MUST NOT convert transport uncertainty into a fiscal conclusion.

---

## 4. Provider Capability Declaration

Every production PAC adapter SHALL expose an immutable capability declaration established from an approved provider contract.

Minimum logical capabilities:

```text
providerName
supportsStampIdempotencyKey
supportsAuthoritativeStampLookup
supportsAuthoritativeCancellationLookup
supportsSafeReplayAfterConfirmedNotFound
stampLookupKeyType
cancellationLookupKeyType
```

Names are conceptual; implementation naming may vary.

The adapter MUST NOT declare a capability merely because the mock supports it.

If the approved provider documentation/contract does not establish a capability, it is `false / unavailable`.

---

## 5. Fiscal Operation Identity

Every fiscal operation has a durable local operation identity.

Minimum identity:

- `operationId`
- `organizationId`
- `branchId`
- `invoiceId`
- `operationType` = `STAMP` or `CANCEL`
- `semanticIdempotencyKey`
- `requestHash`
- `providerName`
- provider/client reference when available
- attempt count
- current state
- last deterministic provider outcome
- timestamps

The semantic idempotency key identifies one intended fiscal operation.

The request hash protects against reuse of the same idempotency identity with different fiscal semantics.

Conflicting reuse MUST fail closed.

---

## 6. Provider-Neutral State Model

The canonical logical operation lifecycle is:

```text
PENDING
  ↓
READY
  ↓
IN_FLIGHT
  ├──→ SUCCEEDED
  ├──→ FAILED_TERMINAL
  ├──→ RETRYABLE_CONFIRMED
  └──→ RECONCILIATION_REQUIRED
```

### 6.1 SUCCEEDED

Allowed only after authoritative fiscal success evidence passes validation.

### 6.2 FAILED_TERMINAL

Allowed only for a definitive provider/application rejection for which repeating the same request cannot legitimately produce the intended success without a new governed operation.

### 6.3 RETRYABLE_CONFIRMED

Allowed only when it is known that repeating the provider request cannot duplicate an already-completed fiscal operation.

Examples:

- failure occurred before dispatch;
- provider authoritatively reports not found/not accepted and the approved provider contract declares replay safe;
- provider contract guarantees idempotent replay for the exact same provider idempotency key and immutable fiscal request.

A generic timeout is NOT enough.

### 6.4 RECONCILIATION_REQUIRED

Used whenever the external outcome is ambiguous.

Examples:

- timeout after possible dispatch;
- socket drop after request transmission;
- process crash after outbound call but before durable local success commit;
- response cannot be authenticated/validated;
- provider returned a transient/unknown status;
- provider success response was incomplete.

This state MUST NOT automatically redispatch the fiscal command unless §8 safe replay conditions have been proven.

---

## 7. Ambiguous Stamp Outcome Contract

When a stamp attempt becomes ambiguous:

1. persist `RECONCILIATION_REQUIRED`;
2. preserve the original immutable request hash and provider reference/idempotency key;
3. do not mark invoice `STAMPED`;
4. do not emit `FacturaFiscalEmitida`;
5. on retry/restart, perform authoritative reconciliation before any new `timbrar()` call unless provider-guaranteed idempotent replay applies.

Authoritative reconciliation returns one of the logical outcomes:

```text
STAMPED_CONFIRMED
REJECTED_CONFIRMED
NOT_FOUND_CONFIRMED
PENDING
UNKNOWN
```

### STAMPED_CONFIRMED

Finalize the existing local operation without redispatch.

### REJECTED_CONFIRMED

Persist terminal failure if provider semantics establish final rejection.

### NOT_FOUND_CONFIRMED

Redispatch is allowed only if the provider contract explicitly states that this result proves the original operation was not completed and that replay is safe.

### PENDING / UNKNOWN

Remain `RECONCILIATION_REQUIRED`.

No blind redispatch.

---

## 8. Safe Replay Rule

A fiscal operation may be redispatched after an ambiguous outcome only if at least one of these is true:

### Rule A — Provider idempotency guarantee

The approved PAC contract guarantees that replaying the exact same semantic request with the exact same provider idempotency key cannot create a second fiscal certification.

Required:

- same provider;
- same semantic idempotency key;
- same request hash;
- same signed fiscal payload identity.

### Rule B — Authoritative not-found reconciliation

The provider authoritatively confirms the original operation does not exist / was not accepted, and its approved contract declares replay safe from that state.

If neither Rule A nor Rule B is proven:

`AUTO_REDISPATCH = FORBIDDEN`

and the operation remains blocked for authorized operational reconciliation.

---

## 9. Crash/Restart Recovery

The implementation must be safe across process restart.

Critical scenario:

```text
TRIDENTPOS sends stamp
PAC completes stamp
connection/process fails before local DB finalization
process restarts
```

Required recovery:

```text
load durable operation
→ detect ambiguous/in-flight prior attempt
→ reconcile with PAC/provider
→ if stamped, validate authoritative fiscal result
→ atomically finalize existing operation + invoice + outbox
→ NO second fiscal stamp
```

Restart MUST NOT erase operation history or reset semantic idempotency identity.

---

## 10. Concurrency and Single-Dispatch Safety

Concurrent callers must not create parallel fiscal dispatches for the same logical operation.

At most one dispatcher may own an operation attempt at a time.

Implementation may use:

- row locking;
- durable lease;
- compare-and-swap state transition;
- equivalent transaction-safe mechanism.

Required invariant:

**one semantic fiscal operation cannot produce two simultaneous uncontrolled outbound PAC stamp requests.**

Local uniqueness alone is insufficient if multiple processes can both dispatch after reading the same state.

---

## 11. CSD Completeness and Fail-Closed Signing

No synthetic production CSD metadata is permitted.

Before provider dispatch, TRIDENTPOS must have a complete and internally coherent fiscal signing set.

Minimum required material:

- CSD certificate;
- certificate number, either explicitly present or deterministically derived from the actual certificate;
- private key obtained from approved secure vault by reference;
- certificate/private-key cryptographic match;
- certificate validity sufficient for the operation according to the implemented validation rules.

Forbidden production fallbacks include:

- hard-coded certificate number;
- placeholder certificate Base64;
- mock seal;
- test private key;
- test certificate;
- plaintext private key command input;
- default secret values.

Missing, malformed, expired where validation applies, or mismatched material must fail closed before PAC invocation.

---

## 12. Secret Handling

CSD private key material:

- may exist only in the minimum in-memory scope required for signing;
- must not be persisted in relational tables;
- must not be serialized in DTOs;
- must not be emitted in outbox events;
- must not be logged;
- must not be placed in source, plaintext config, browser storage, renderer state, or generic application caches.

The implementation may state that private key material is not intentionally persisted or exposed.

It MUST NOT claim guaranteed immediate memory zeroization unless the runtime/implementation actually provides and verifies such a guarantee.

---

## 13. Authoritative Fiscal Success Contract

A provider response labeled `STAMPED` is not sufficient by itself.

Before local transition to `SUCCEEDED` / invoice `STAMPED`, TRIDENTPOS must validate the authoritative fiscal result.

Minimum stamp success evidence:

- non-empty fiscal UUID;
- certified/stamped XML returned by the PAC or authoritative reconciliation path;
- stamped XML is parseable;
- authoritative Timbre Fiscal Digital identity exists in the returned stamped XML;
- UUID in the stamped XML matches the accepted provider result UUID;
- provider identity is known from the configured adapter;
- response is associated with the same local fiscal operation/request identity.

Where the approved provider contract supplies additional mandatory fields such as timestamp, SAT seal/certificate data, or transaction reference, the adapter must validate them according to that contract.

Forbidden:

```text
stampResult.status == STAMPED
+
missing stampedXml
→ fallback to pre-stamp XML
```

Pre-stamp XML can never be persisted as authoritative stamped XML.

If success evidence is incomplete or internally inconsistent:

`SUCCEEDED = FORBIDDEN`

The operation becomes `RECONCILIATION_REQUIRED` or terminal error only if the provider contract makes the result definitive.

---

## 14. Atomic Local Finalization

After validated authoritative success, one tenant transaction must atomically persist:

1. fiscal operation `SUCCEEDED`;
2. authoritative fiscal UUID;
3. stamped XML and governed fiscal metadata;
4. invoice lifecycle transition to `STAMPED`;
5. durable `FacturaFiscalEmitida` outbox event.

If this DB transaction fails after external PAC success:

- the local operation must remain recoverable through authoritative reconciliation;
- restart must finalize the existing provider result;
- no blind redispatch.

---

## 15. Cancellation Contract

Cancellation is also an external fiscal effect and follows equivalent ambiguity rules.

A cancellation command must have:

- durable semantic idempotency;
- immutable request identity;
- provider reference where available;
- durable operation state;
- authoritative result validation.

Transport timeout does not prove cancellation failure.

After ambiguous cancellation:

- do not mark invoice `CANCELLED`;
- do not emit authoritative cancellation event;
- reconcile first;
- redispatch only under provider-proven safe replay rules.

A `PENDING_APPROVAL` or equivalent SAT/PAC state must remain distinct from final `CANCELLED`.

---

## 16. Retry and Reconciliation Worker vs OQ-ARCH-02

This ACR permits a technical recovery worker for already-created explicit fiscal operations.

It does NOT authorize:

- automatically selecting unclaimed folios;
- automatically creating a factura global;
- automatically initiating period-end fiscal stamping;
- monthly fiscal scheduler behavior.

Therefore:

`OQ-ARCH-02 = OPEN`

Technical retry/reconciliation of an already-requested operation is not the same business decision as automatic period-end invoice creation.

---

## 17. Provider Contract Pending Behavior

Until an approved real PAC contract establishes the capabilities required in §§4, 7 and 8:

- production `UnavailablePacConnector` remains fail-closed;
- mocks remain test-only;
- no mock idempotency behavior may be treated as production evidence;
- no provider-specific URL, credentials, status values, retry policy, or SLA may be invented.

If implementation reaches a point where provider semantics are required and unavailable:

`BLOCKED BY CONTRACT`

not guessed behavior.

---

## 18. Data Requirements

The durable fiscal operation store must support the governed state model.

The existing R2 `fiscal_stamping_operations` may be retained and extended if it can satisfy the contract without semantic contradiction.

If cancellation requires the same durability model, implementation may:

- generalize the table into a provider-operation abstraction through a governed migration; or
- introduce a cancellation-specific durable operation table.

The Builder may not choose a broader data redesign merely for convenience.

Any schema change is RC4 because tenant isolation and fiscal records are affected.

Required:

- `organization_id`;
- `branch_id`;
- tenant-safe relationships;
- RLS + FORCE RLS;
- semantic idempotency uniqueness;
- request hash;
- durable state;
- attempt count;
- provider identity/reference where supported;
- reconciliation timestamps/status;
- authoritative external UUID/result reference after success;
- created/updated timestamps.

No cross-context physical FK may be introduced.

---

## 19. Observability and Audit

Fiscal recovery must be diagnosable without leaking secrets.

At minimum record/audit:

- operation ID;
- organization/branch;
- invoice ID;
- provider name;
- operation type;
- state transitions;
- attempt number;
- reconciliation outcome category;
- external non-secret reference where permitted;
- error classification;
- timestamps.

Never log:

- private key;
- private key password;
- PAC secret/password/token;
- complete confidential credential payload.

---

## 20. Required R3 Tests

R3 implementation evidence must include at minimum:

1. default PAC unavailable → fail closed.
2. missing vault reference → fail closed before PAC call.
3. missing private key → fail closed before PAC call.
4. missing certificate → fail closed before PAC call.
5. missing certificate number with no valid derivation → fail closed.
6. private key/certificate mismatch → fail closed.
7. no hard-coded/mock certificate fallback exists in production path.
8. complete validated PAC stamp result → one `SUCCEEDED` operation + one `STAMPED` invoice + one outbox event.
9. `STAMPED` with missing UUID → not success.
10. `STAMPED` with missing certified XML → not success.
11. certified XML UUID mismatch → not success.
12. timeout/connection loss after possible dispatch → `RECONCILIATION_REQUIRED`.
13. restart from `RECONCILIATION_REQUIRED` performs reconciliation before redispatch.
14. authoritative reconciliation `STAMPED_CONFIRMED` finalizes locally without second stamp request.
15. reconciliation `PENDING/UNKNOWN` does not redispatch.
16. `NOT_FOUND_CONFIRMED` without provider safe-replay capability does not redispatch.
17. `NOT_FOUND_CONFIRMED` with explicit safe-replay capability can redispatch exactly once under controlled ownership.
18. provider-idempotent replay path preserves same semantic key and request hash.
19. conflicting idempotency-key reuse fails closed.
20. retry after local success returns prior result without PAC call.
21. crash after provider success but before local commit is recoverable without duplicate fiscal effect.
22. concurrent callers cannot produce uncontrolled duplicate outbound requests.
23. operation/invoice/outbox local finalization is atomic.
24. private key absent from DB, DTOs, outbox and logs under test observability.
25. cancellation ambiguity remains non-final until authoritative resolution.
26. cancellation `PENDING_APPROVAL` is not treated as final `CANCELLED`.
27. no automatic factura-global scheduler exists.
28. `OQ-ARCH-02` remains OPEN.
29. RLS/FORCE RLS tenant isolation remains PASS.
30. cross-context physical FK count remains zero.
31. forward migration and authorized non-production down migration preserve predecessor WPs.
32. full regression, graph, format, lint, typecheck and build pass.

Tests using mocks must explicitly distinguish:

- test simulation evidence;
- provider-contract evidence.

A mock cannot prove production provider replay semantics.

---

## 21. Evidence Levels

For R3:

- source/static claims: minimum E1;
- domain/unit behavior: minimum E2;
- DB + adapter integration: minimum E3;
- crash/restart/concurrency behavior: minimum E4 where the claim depends on runtime behavior;
- real provider/PAC certification is not claimable until provider integration evidence exists.

No PASS may rely only on Builder prose.

---

## 22. Circuit Breaker Budget for R3

Under canonical EAAF v1.3 governance (migrated under ACR-2026-019), apply the standard EAAF v1.3 execution budget.

Canonical EAAF project budget:

```text
max_builder_iterations = 3
max_review_cycles = 3
max_same_blocker_recurrence = 1
max_same_cause_ci_failures = 2
max_architecture_reopens = 1
```

Current WP-021 history entering this ACR:

- Builder iteration R1: consumed;
- Builder iteration R2: consumed;
- Proposed R3: third and final default Builder iteration (`max_builder_iterations = 3`).

Crash/reconciliation blocker recurrence:

- First occurrence: R1;
- Recurrence after R2 remediation: 1;
- Configured maximum recurrence: `max_same_blocker_recurrence = 1`.

Therefore, entering R3:

`CIRCUIT BREAKER = NORMAL — AT LIMIT`

If WP-021 R3 reproduces the same semantic crash/reconciliation blocker:

- `same_blocker_recurrence = 2`;
- `2 > 1` (configured limit is exceeded);
- `CIRCUIT_BREAKER_OPEN`;
- No autonomous R4 iteration;
- No Builder self-reset;
- Human Decision / authorized reset is required.

A different new blocker follows its own distinct fingerprint and counter.

---

## 23. Independent Review Gates

Before R3 Builder authorization, this ACR requires:

1. Quick Integrity on exact frozen subject.
2. Agent 01 — Solution Architect review.
3. Agent 07 — Integration Architect review.
4. Agent 03 — Data Architect review.
5. Agent 08 — Security Architect review.
6. Agent 09 — QA Test Architect review of required evidence.
7. Agent 11 — Code/Repository consistency review.
8. Coordinator synthesis.
9. Product Owner approval of exact frozen subject.
10. PR Gate.
11. exact-head CI/security.
12. merge authorization.
13. merge.
14. post-merge validation.
15. `DONE / CANONICAL`.

Only then may WP-021 R3 Builder start.

---

## 24. Explicit Non-Decisions

This ACR does NOT decide:

- PAC vendor;
- PAC endpoint;
- PAC credentials;
- provider-specific request/response schema;
- commercial SLA;
- fiscal stamping timing;
- automatic factura-global scheduling;
- cancellation business policy beyond technical outcome safety;
- tax policy;
- customer self-invoicing UX;
- Product Owner open questions.

---

## 25. R3 Authorized Scope After Canonicalization

When this ACR becomes canonical, R3 may remediate only the governed blockers and necessary supporting tests/migration changes.

Primary R3 objectives:

1. remove remaining synthetic CSD certificate metadata fallbacks;
2. enforce complete/validated CSD readiness;
3. implement provider-capability-aware reconciliation;
4. prevent blind redispatch after ambiguous PAC outcome;
5. validate authoritative fiscal success before local `STAMPED`;
6. make restart/crash recovery real rather than mock-dependent;
7. harden concurrent single-dispatch semantics;
8. apply equivalent ambiguity safety to cancellation where required;
9. preserve `OQ-ARCH-02`;
10. preserve module/data/security boundaries.

No architecture-by-implementation.

---

## 26. Governance Effect

This document is now a FROZEN CANDIDATE R1 on canonical base `0c46307e09fe77383320a86b6daff86d2983e9af` under EAAF v1.3.0 (`167cea36c09c1031c763971ff790db2e0d0f7362`), following the canonicalization of ACR-2026-019.

Before WP-021 R3 implementation may be authorized, this ACR candidate must complete all independent review gates (§23), obtain Product Owner approval on the exact frozen subject, and merge canonically to `main`.

WP-021 remains:

**HOLD**
