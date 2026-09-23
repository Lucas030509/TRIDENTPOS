# ACR-2026-020 — WP-021 PAC RECONCILIATION & FISCAL SUCCESS CONTRACT

**Status:** PROPOSED / FROZEN CANDIDATE R3 — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-22  
**Scope:** WP-021 — Fiscal Invoicing Engine  
**Canonical Governance Base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Governing Framework:** EAAF v1.3.0 @ `167cea36c09c1031c763971ff790db2e0d0f7362`  
**Parent Governance:** ACR-2026-019 — DONE / CANONICAL  
**Superseded Frozen Candidate R2:** `b015c61da8f0ff26c40268a7e4d406888346b9f9`  
**Data R2 Gate:** HOLD  
**Data R2 Evidence:** `7358b0b680eca7118aa9c4760a7cd6437c881dce`  
**R3 Remediation Purpose:** Remediation of `ACR020-R2-DATA-BLK-01` (Fiscal backup / PITR / restore recovery contract) and `ACR020-R2-DATA-BLK-02` (Migration preservation invariants for fiscal operation history and outbox state), incorporating `ACR020-R2-DATA-ADV-01` (Retention and purge policy authority binding) and `ACR020-R2-DATA-ADV-02` (Tenant-scoped recovery lookups in evidence requirements).  
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
- safe cancellation;
- durable retry;
- process restart recovery;
- Cloud backup and PITR disaster recovery without duplicate fiscal dispatch;
- lossless schema migration and tenant isolation preservation;
- duplicate-stamp and duplicate-cancellation prevention;
- authoritative reconciliation for all fiscal operations;
- valid fiscal success and cancellation confirmation;
- safe crash and restore recovery.

---

## 2. Why This ACR Is Required

WP-021 R2 materially improves fiscal safety, but independent inspection identified unresolved RC4 hazards:

1. CSD metadata can still fall back to synthetic certificate values when the configured fiscal certificate is incomplete.
2. `RECONCILIATION_REQUIRED` currently returns to `IN_FLIGHT` and may call `timbrar()` again without first obtaining an authoritative provider result.
3. A PAC response labeled `STAMPED` can be accepted even when required fiscal evidence is missing.
4. The current mock provides deterministic replay behavior that is not yet guaranteed by any real PAC provider contract.
5. Cancellation is also an external fiscal effect with legal consequences and requires equivalent operation-specific idempotency, reconciliation, and ambiguity discipline (`ACR020-R1-INT-BLK-01`, `ACR020-R1-INT-BLK-02`).
6. Provider capability declarations must have immutable contractual provenance to prevent unfounded claims of replay or idempotency support (`ACR020-R1-INT-ADV-01`).
7. Fiscal recovery contracts must explicitly govern Cloud backup / PITR / disaster recovery where external PAC success predates the restored local database state (`ACR020-R2-DATA-BLK-01`).
8. Schema migrations affecting fiscal operation tables must enforce strict preservation invariants across forward migrations and non-production rollbacks to prevent loss or resetting of ambiguous operations, request hashes, or outbox correlations (`ACR020-R2-DATA-BLK-02`).

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
- durable `FacturaFiscalEmitida` and `FacturaFiscalCancelada` event publication.

### 3.2 PAC owns

The external PAC/provider is authoritative for:

- whether a submitted CFDI was accepted/rejected;
- fiscal UUID returned by certification;
- certified/stamped XML;
- PAC/SAT fiscal response metadata available under the provider contract;
- provider-side cancellation outcome and acknowledgment;
- provider-side status/reconciliation response.

### 3.3 No dual authority

A local timeout, socket close, process crash, database restore, or missing HTTP response does not prove that the PAC did not perform the fiscal operation (stamping or cancellation).

TRIDENTPOS MUST NOT convert transport or persistence uncertainty into a fiscal conclusion.

---

## 4. Provider Capability Declaration & Contractual Provenance

Every production PAC adapter SHALL expose an immutable capability declaration established from an approved provider contract.

Capabilities MUST be declared and evaluated **independently per fiscal operation type** (`STAMP` vs `CANCEL`). A capability established for stamping does NOT imply or grant that capability for cancellation, nor vice versa.

Minimum logical capability model:

```text
providerName
contractProvenance {
  contractIdentifier
  contractVersion
  evidenceUriOrReference
  evidenceDigestOrHash
  effectivePeriod
  guaranteeScopeOrLimitations
}

supportsStampIdempotencyKey
supportsCancellationIdempotencyKey

supportsAuthoritativeStampLookup
supportsAuthoritativeCancellationLookup

supportsSafeStampReplayAfterConfirmedNotFound
supportsSafeCancellationReplayAfterConfirmedNotFound

stampLookupKeyType
cancellationLookupKeyType
```

Names are conceptual; implementation naming may vary as long as semantics remain exact and independent.

### 4.1 Strict Fail-Closed & Provenance Rules

1. **Operation Independence (`ACR020-R1-INT-BLK-01`):** `supportsStampIdempotencyKey` and `supportsCancellationIdempotencyKey` are distinct declarations. Likewise, lookup capabilities (`supportsAuthoritativeStampLookup`, `supportsAuthoritativeCancellationLookup`) and safe-replay capabilities (`supportsSafeStampReplayAfterConfirmedNotFound`, `supportsSafeCancellationReplayAfterConfirmedNotFound`) are independently evaluated per operation type.
2. **Contractual Provenance (`ACR020-R1-INT-ADV-01`):** Every capability declared `true` in a production adapter MUST be bound to identifiable contractual evidence recorded in `contractProvenance` (e.g., contract identifier, version, evidence reference/URI, digest/hash, validity window, semantic limitations). A capability declared without approved contractual evidence MUST fail closed / be rejected during adapter initialization/validation.
3. **No Inference or Defaults:** Any capability not explicitly established by an approved provider contract MUST strictly default to `false / unavailable`.
4. **Mocks Excluded:** The adapter MUST NOT declare a capability merely because a test mock supports it. Mocks cannot establish production provider capabilities.

---

## 5. Fiscal Operation Identity

Every fiscal operation has a durable local operation identity.

Minimum identity:

- `operationId`
- `organizationId`
- `branchId`
- `invoiceId`
- fiscal UUID being operated on (for cancellation, the specific stamped UUID target)
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

Allowed only after authoritative fiscal success evidence (for stamping) or authoritative cancellation confirmation (for cancellation) passes validation.

### 6.2 FAILED_TERMINAL

Allowed only for a definitive provider/application rejection for which repeating the same request cannot legitimately produce the intended success without a new governed operation.

### 6.3 RETRYABLE_CONFIRMED

Allowed only when it is proven under §8 that repeating the provider request for that specific operation type cannot duplicate an already-completed fiscal operation.

Examples:

- failure occurred before dispatch;
- provider authoritatively reports not found/not accepted and the approved provider contract declares replay safe for that operation type;
- provider contract guarantees idempotent replay for that operation type with the exact same provider idempotency key and immutable fiscal request.

A generic timeout is NOT enough.

### 6.4 RECONCILIATION_REQUIRED

Used whenever the external outcome is ambiguous.

Examples:

- timeout after possible dispatch;
- socket drop after request transmission;
- process crash after outbound call but before durable local commit;
- database restored from backup/PITR where external dispatch occurred after the restored snapshot;
- response cannot be authenticated/validated;
- provider returned a transient/unknown status;
- provider success or cancellation response was incomplete.

This state MUST NOT automatically redispatch the fiscal command unless §8 safe replay conditions have been proven for that operation type.

---

## 7. Ambiguous Stamp Outcome Contract

When a stamp attempt becomes ambiguous:

1. persist `RECONCILIATION_REQUIRED`;
2. preserve the original immutable request hash and provider reference/idempotency key;
3. do not mark invoice `STAMPED`;
4. do not emit `FacturaFiscalEmitida`;
5. on retry/restart/restore, perform authoritative reconciliation before any new `timbrar()` call unless provider-guaranteed idempotent stamp replay applies.

Authoritative stamp reconciliation returns one of the logical outcomes:

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

Redispatch is allowed only if the provider contract explicitly states that this result proves the original stamp operation was not completed and that replay is safe (`supportsSafeStampReplayAfterConfirmedNotFound == true`).

### PENDING / UNKNOWN

Remain `RECONCILIATION_REQUIRED`.

No blind redispatch.

---

## 8. Operation-Specific Safe Replay Rule

A fiscal operation (`STAMP` or `CANCEL`) may be redispatched after an ambiguous outcome only if safe replay is explicitly proven for that specific operation type under an approved provider contract (`ACR020-R1-INT-BLK-01`).

Conceptually:

```text
safeReplay(operationType) =
  providerContractGuaranteesIdempotentReplay(operationType)
  OR
  (
    authoritativeNotFound(operationType)
    AND
    providerContractGuaranteesReplaySafeAfterNotFound(operationType)
  )
```

### 8.1 Rule A — Provider Idempotency Guarantee (per operation type)

The approved PAC contract explicitly guarantees that replaying the exact same semantic request with the exact same provider idempotency key cannot create a second fiscal certification or duplicate cancellation action.

Required:

- same provider;
- same operation type (`STAMP` or `CANCEL`);
- `supportsStampIdempotencyKey == true` (for `STAMP`) or `supportsCancellationIdempotencyKey == true` (for `CANCEL`);
- same semantic idempotency key;
- same request hash;
- same signed fiscal payload / target fiscal UUID identity.

### 8.2 Rule B — Authoritative Not-Found Reconciliation & Safe Replay (per operation type)

1. The provider authoritatively confirms the original operation of that type does not exist / was not accepted (`NOT_FOUND_CONFIRMED`); AND
2. The approved PAC contract explicitly declares replay safe from that state (`supportsSafeStampReplayAfterConfirmedNotFound == true` for `STAMP`, or `supportsSafeCancellationReplayAfterConfirmedNotFound == true` for `CANCEL`).

### 8.3 Invariant: No Cross-Operation Replay Inference

- A stamp replay guarantee MUST NOT authorize cancellation replay.
- A cancellation replay guarantee MUST NOT authorize stamp replay.
- If neither Rule A nor Rule B is proven for the specific operation type:

`AUTO_REDISPATCH = FORBIDDEN`

and the operation remains blocked in `RECONCILIATION_REQUIRED` for authorized operational/human reconciliation.

---

## 9. Crash, Process Restart, and Backup/PITR Disaster Recovery Contracts

The implementation must be safe across process restarts, node crashes, and database restoration (Cloud PITR / backup restore) for all fiscal operations (`ACR020-R2-DATA-BLK-01`).

### 9.1 Process Restart / Crash Recovery

Critical stamping scenario:

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

### 9.2 Fiscal Backup / PITR / Restore Recovery Contract (`ACR020-R2-DATA-BLK-01`)

Disaster recovery and tenant restoration introduce the hazard where an external PAC effect occurred after the database snapshot point represented in the restored database.

Governed scenario:

```text
T0: fiscal operation persisted in local database (e.g. IN_FLIGHT or RECONCILIATION_REQUIRED)
T1: TRIDENTPOS dispatches STAMP or CANCEL request to PAC
T2: PAC successfully completes the external fiscal effect (e.g. certifies CFDI or registers cancellation)
T3: local finalization transaction is not durably available in the restored snapshot
T4: Cloud database is restored using backup / Point-in-Time Recovery (PITR) or tenant restoration
T5: restored TRIDENTPOS wakes up and encounters the unfinalized/ambiguous fiscal operation
```

Required recovery invariants after database restore:

1. **Identity & Scope Preservation:** Restoration MUST preserve durable fiscal operation identity (`operationId`, `organizationId`, `branchId`, `invoiceId`, target fiscal `UUID`, `operationType`, `semanticIdempotencyKey`, `requestHash`, `providerName`, and provider references).
2. **Ambiguity Preservation:** A restored operation that was in-flight or ambiguous MUST remain `RECONCILIATION_REQUIRED`. Restoration MUST NOT transform `RECONCILIATION_REQUIRED` into `PENDING`, `READY`, or any state that permits an unproven fresh external dispatch.
3. **No Inference from Restored Absences:** Local absence of `STAMPED`, `CANCELLED`, fiscal UUID, stamped XML, or outbox records in the restored database point MUST NOT be interpreted as proof that the PAC did not execute the operation.
4. **Authoritative Reconciliation First:** Before any local state transition or redispatch, TRIDENTPOS MUST perform authoritative reconciliation with the provider.
5. **Atomic Event & State Consistency:** If the PAC authoritatively confirms success (`STAMPED_CONFIRMED` or `CANCELLATION_CONFIRMED`), TRIDENTPOS MUST atomically finalize the existing restored operation, transition invoice state, and emit the durable outbox event.
6. **No Duplicate Events:** A restored system MUST NOT publish duplicate semantic events (`FacturaFiscalEmitida` / `FacturaFiscalCancelada`) for operations already finalized prior to restore. Outbox publication must check durable deduplication.
7. **Tenant-Scoped Recovery (`ACR020-R2-DATA-ADV-02`):** Restore and recovery workflows remain strictly tenant-isolated under RLS + `FORCE RLS`. An operation ID, provider reference, fiscal UUID, or invoice ID from one tenant MUST NOT allow another tenant to read, reconcile, claim, or finalize that operation.
8. **Mock Limitation:** Mock tests may validate the restore/reconciliation state machine logic but cannot prove real PAC provider capabilities (`BLOCKED BY CONTRACT`).

---

## 10. Concurrency and Single-Dispatch Safety

Concurrent callers must not create parallel fiscal dispatches for the same logical operation (stamping or cancellation).

At most one dispatcher may own an operation attempt at a time.

Implementation may use:

- row locking;
- durable lease;
- compare-and-swap state transition;
- equivalent transaction-safe mechanism.

Required invariant:

**one semantic fiscal operation cannot produce two simultaneous uncontrolled outbound PAC requests.**

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

## 15. Cancellation Contract & Reconciliation Lifecycle

Cancellation is an external fiscal effect with legal and accounting consequences; it follows strict ambiguity discipline equivalent to stamping (`ACR020-R1-INT-BLK-02`).

### 15.1 Cancellation Operation Identity & Durability

Every cancellation command MUST have a durable local operation identity (§5):

- `operationId`;
- `organizationId`;
- `branchId`;
- `invoiceId`;
- target fiscal UUID being cancelled;
- `operationType = CANCEL`;
- `semanticIdempotencyKey`;
- immutable `requestHash`;
- `providerName`;
- provider/client reference when available;
- attempt count;
- current state;
- last deterministic provider outcome;
- timestamps.

Recovery MUST continue the original semantic cancellation operation. Creating a new operation identity to bypass an unresolved or ambiguous cancellation is strictly FORBIDDEN.

### 15.2 Normalized Cancellation Reconciliation Outcomes

When a cancellation attempt is interrupted, times out, or returns an ambiguous response:

1. persist `RECONCILIATION_REQUIRED`;
2. preserve original immutable request hash and provider/idempotency reference;
3. do NOT mark invoice `CANCELLED`;
4. do NOT emit authoritative `FacturaFiscalCancelada` event;
5. on retry/restart/restore, perform authoritative cancellation reconciliation before any new cancellation dispatch unless provider-guaranteed idempotent cancellation replay applies (§8).

Authoritative cancellation reconciliation maps provider-specific responses into one of five normalized logical outcomes:

```text
CANCELLATION_CONFIRMED
PENDING_APPROVAL
REJECTED_CONFIRMED
NOT_FOUND_CONFIRMED
UNKNOWN
```

Provider-specific PAC/SAT status strings MUST NOT be invented in TRIDENTPOS; the PAC adapter maps provider responses to these logical outcomes strictly according to the approved provider contract.

#### CANCELLATION_CONFIRMED

Finalize the existing local cancellation operation without redispatch. Transition local invoice to `CANCELLED` and emit durable `FacturaFiscalCancelada` event ONLY after validating authoritative cancellation success evidence (§15.3).

#### PENDING_APPROVAL

Non-final state (e.g. awaiting receptor acceptance).  
**Mandatory Invariant:** `PENDING_APPROVAL != CANCELLED`.  
The operation remains in a non-final pending state. TRIDENTPOS MUST NOT mark the invoice `CANCELLED` or emit final cancellation outbox events while in `PENDING_APPROVAL`.

#### REJECTED_CONFIRMED

Persist terminal failure (`FAILED_TERMINAL`) only when the approved provider contract establishes definitive rejection (e.g., rejection by receptor or SAT cancellation rules).

#### NOT_FOUND_CONFIRMED

Indicates the cancellation request was not found by the provider. `NOT_FOUND_CONFIRMED` does NOT itself authorize redispatch. Redispatch is permitted ONLY if `supportsSafeCancellationReplayAfterConfirmedNotFound == true` under the approved contract (§8.2). Otherwise:

`AUTO_REDISPATCH = FORBIDDEN`

#### UNKNOWN

Ambiguity persists (e.g. timeout during lookup). Remain `RECONCILIATION_REQUIRED`. No blind redispatch.

### 15.3 Authoritative Cancellation Success Evidence

Before local transition to final `CANCELLED`, TRIDENTPOS MUST validate the authoritative cancellation result.

Minimum required evidence:

- authoritative outcome equivalent to `CANCELLATION_CONFIRMED`;
- correlation to the original cancellation `operationId`;
- correlation to the correct fiscal `invoiceId` and target fiscal `UUID`;
- known provider identity from the configured adapter;
- same immutable semantic idempotency key and request hash;
- provider transaction/acknowledgment reference where required by the approved contract;
- internal consistency of the provider cancellation response.

If evidence is incomplete, mismatched, or ambiguous:

`CANCELLED = FORBIDDEN`

The operation remains `RECONCILIATION_REQUIRED` (or `FAILED_TERMINAL` if definitively rejected).

### 15.4 Cancellation Crash Recovery & Atomic Finalization

Process crash scenario:

```text
TRIDENTPOS dispatches cancellation
PAC/SAT completes cancellation
response or local DB transaction fails
process restarts
```

Required recovery:

```text
load same cancellation operation
→ preserve original identity and request hash
→ perform authoritative cancellation reconciliation
→ validate authoritative cancellation evidence
→ atomically finalize existing operation (SUCCEEDED) + invoice (CANCELLED) + outbox (FacturaFiscalCancelada)
→ NO second blind cancellation request
```

Local DB transaction failure after external PAC success does NOT prove the PAC did not cancel the invoice. Authoritative reconciliation is mandatory.

---

## 16. Retry and Reconciliation Worker vs OQ-ARCH-02

This ACR permits a technical recovery worker for already-created explicit fiscal operations (stamping and cancellation).

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

Until an approved real PAC contract establishes the capabilities required in §§4, 7, 8 and 15:

- production `UnavailablePacConnector` remains fail-closed;
- mocks remain test-only;
- authoritative stamp and cancellation lookups cannot be claimed;
- stamp and cancellation replay safety cannot be claimed;
- provider idempotency (stamping or cancellation) cannot be claimed;
- provider-specific cancellation status semantics cannot be claimed;
- no provider-specific URL, credentials, status values, retry policy, or SLA may be invented.

If implementation reaches a point where provider semantics are required and unavailable:

`BLOCKED BY CONTRACT`

not guessed behavior.

---

## 18. Data Requirements, Retention Governance & Migration Preservation Contract

The durable fiscal operation store must support the governed state model across all schema migrations, disaster recovery, and operational lifecycles (`ACR020-R2-DATA-BLK-02`).

The existing R2 `fiscal_stamping_operations` may be retained and extended, generalized into a provider-operation store, or partitioned into dedicated stamping and cancellation stores through a governed migration, provided that all semantic preservation invariants are strictly satisfied.

Any schema change is RC4 because tenant isolation, accounting compliance, and fiscal records are affected.

### 18.1 Required Data Attributes & Constraints

Every persisted fiscal operation record MUST maintain:

- `organization_id`;
- `branch_id`;
- `invoice_id`;
- target fiscal `uuid` where applicable (mandatory for cancellation);
- `operation_type` (`STAMP` or `CANCEL`);
- `semantic_idempotency_key` (unique within tenant scope);
- `request_hash` (immutable hash of signed payload/command);
- `provider_name`;
- `provider_reference` / external transaction reference where supported;
- `state` (governed enum: `PENDING`, `READY`, `IN_FLIGHT`, `SUCCEEDED`, `FAILED_TERMINAL`, `RETRYABLE_CONFIRMED`, `RECONCILIATION_REQUIRED`);
- `attempt_count`;
- `reconciliation_status` / outcome category;
- authoritative external `fiscal_uuid` and certified `stamped_xml` (for stamp success);
- authoritative cancellation outcome metadata (for cancellation success);
- `contract_provenance_ref` (§4);
- timestamps (`created_at`, `updated_at`, `last_attempted_at`, `reconciled_at`).

Mandatory database invariants:
- Strict multi-tenant isolation with RLS + `FORCE RLS`;
- Zero cross-context physical foreign keys (`FK count = 0`).

### 18.2 Forward Migration Preservation Invariants (`ACR020-R2-DATA-BLK-02`)

For every populated predecessor fiscal operation record, forward migrations MUST preserve or losslessly transform all operational, identity, and outbox correlation fields:

1. **Identity & Hash Invariance:** Migration MUST NOT reset, regenerate, or alter `operation_id`, `semantic_idempotency_key`, `request_hash`, `organization_id`, `branch_id`, or `invoice_id`.
2. **Ambiguity Protection:** Unresolved operations (`IN_FLIGHT`, `RECONCILIATION_REQUIRED`) MUST retain their exact ambiguity status. Migration MUST NOT reset attempt counts, erase provider references, or convert `RECONCILIATION_REQUIRED` into `PENDING`, `READY`, or a retryable state that would permit automatic redispatch.
3. **Authoritative Truth Protection:** Finalized records (`SUCCEEDED`, `FAILED_TERMINAL`) MUST retain their authoritative evidence. Certified `stamped_xml` MUST NEVER be replaced with pre-stamp XML. `PENDING_APPROVAL` MUST NEVER be converted into `CANCELLED`.
4. **Outbox History Correlation:** Migration MUST preserve the 1:1 relationship between finalized operations and published outbox events (`FacturaFiscalEmitida`, `FacturaFiscalCancelada`). No pending operation may gain a false event, and no schema split may produce duplicate events.
5. **Fail-Closed on Lossy Migration:** If lossless transformation of any existing fiscal record cannot be mathematically or structurally proven, the migration MUST fail closed and block execution.

### 18.3 Non-Production Rollback / Down Migration Contract

Authorized non-production down migrations MUST refuse destructive loss of fiscal truth:
- If a predecessor schema cannot represent a newer fiscal state, field, or cancellation record losslessly, the down migration MUST fail closed and refuse execution.
- Destructive production rollback is strictly FORBIDDEN; recovery must proceed forward via governed remediation.

### 18.4 Populated Predecessor Migration Evidence Requirement

Migration validation MUST be executed and proven against **populated predecessor test fixtures**, not empty tables. Test datasets must contain representative records for:
- Unresolved STAMP (`IN_FLIGHT`, `RECONCILIATION_REQUIRED`);
- Succeeded STAMP with certified XML and outbox correlation;
- Unresolved CANCEL;
- Cancellation in `PENDING_APPROVAL`;
- Succeeded CANCEL with outbox correlation;
- Terminal failure (`FAILED_TERMINAL`);
- Multi-tenant and multi-branch configurations.

### 18.5 Retention and Purge Policy Authority Binding (`ACR020-R2-DATA-ADV-01`)

Fiscal operation records, reconciliation logs, and cryptographic audit trails MUST remain durable according to an approved retention authority:
- Exact statutory retention periods and purge schedules are NOT decided in this ACR and MUST NOT be invented by the Builder.
- Production deletion/purge behaviors MUST be governed by explicit future Product Owner / Legal authority (e.g. `HDG-DATA`), while preserving all ongoing reconciliation, dispute, and tax compliance obligations.

### 18.6 Multi-Tenant Recovery Lookups Evidence Requirement (`ACR020-R2-DATA-ADV-02`)

Implementation evidence must include explicit negative tests proving that recovery and reconciliation lookups (`operation_id`, `semantic_idempotency_key`, `provider_reference`, fiscal `uuid`) are strictly tenant-scoped under RLS and cannot read, claim, reconcile, or finalize records belonging to another tenant.

---

## 19. Observability and Audit

Fiscal recovery must be diagnosable without leaking secrets.

At minimum record/audit:

- operation ID;
- organization/branch;
- invoice ID;
- provider name;
- operation type (`STAMP` or `CANCEL`);
- contract provenance references/identifiers (§4);
- state transitions;
- attempt number;
- reconciliation outcome category;
- disaster recovery / PITR restore correlation where applicable;
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

R3 implementation evidence must include at minimum the following **57 tests**:

### Core Stamping, Signing & Security Tests (1–24)
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
15. stamp reconciliation `PENDING/UNKNOWN` does not redispatch.
16. stamp `NOT_FOUND_CONFIRMED` without provider safe-replay capability does not redispatch.
17. stamp `NOT_FOUND_CONFIRMED` with explicit safe-replay capability can redispatch exactly once under controlled ownership.
18. provider-idempotent stamp replay path preserves same semantic key and request hash.
19. conflicting stamp idempotency-key reuse fails closed.
20. retry after local stamp success returns prior result without PAC call.
21. crash after provider stamp success but before local commit is recoverable without duplicate fiscal effect.
22. concurrent callers cannot produce uncontrolled duplicate outbound stamp requests.
23. stamp operation/invoice/outbox local finalization is atomic.
24. private key absent from DB, DTOs, outbox and logs under test observability.

### Cancellation, Capability & Provenance Tests (25–36)
25. cancellation idempotency unsupported → no automatic redispatch.
26. cancellation `NOT_FOUND_CONFIRMED` without safe-replay capability → no redispatch.
27. cancellation `NOT_FOUND_CONFIRMED` with explicitly proven applicable safe-replay capability → controlled replay allowed.
28. cancellation `PENDING_APPROVAL` is not treated as final `CANCELLED` (`PENDING_APPROVAL != CANCELLED`).
29. cancellation `UNKNOWN` remains unresolved / no blind redispatch.
30. authoritative cancellation confirmation finalizes the same operation locally.
31. cancellation result correlated to wrong invoice/UUID/operation is rejected.
32. conflicting cancellation idempotency-key reuse fails closed.
33. retry after local cancellation success returns prior result without PAC call.
34. crash after provider cancellation success but before local commit is recoverable without duplicate cancellation.
35. mock cancellation idempotency/replay behavior does not establish production replay capability.
36. capability declared true without required approved contractual provenance fails validation / is rejected fail-closed.

### Backup / PITR / Disaster Recovery Tests (37–42) (`ACR020-R2-DATA-BLK-01`)
37. Cloud PITR/restore before local finalization after possible provider STAMP success → authoritative reconciliation before redispatch.
38. Cloud PITR/restore before local finalization after possible provider CANCEL success → authoritative reconciliation before redispatch.
39. Restored ambiguous operation preserves operation identity, request hash, provider correlation, and tenant scope without state reset.
40. Restore cannot duplicate final fiscal outbox events or publish events from unfinalized/ambiguous states.
41. Restore cannot transform unresolved `RECONCILIATION_REQUIRED` into fresh `PENDING`/`READY` retry state.
42. Cross-tenant restore and recovery lookups fail closed under RLS (tenant A cannot read, reconcile, claim, or finalize tenant B's fiscal records).

### Populated Schema Migration Preservation Tests (43–51) (`ACR020-R2-DATA-BLK-02`)
43. Populated unresolved STAMP survives forward migration semantically unchanged (preserves idempotency key, request hash, state).
44. Populated successful STAMP preserves UUID, stamped XML, metadata, and outbox correlation without XML degradation.
45. Populated unresolved CANCEL survives forward migration semantically unchanged.
46. Populated `PENDING_APPROVAL` remains non-final through forward migration (`PENDING_APPROVAL != CANCELLED`).
47. Populated successful CANCEL preserves authoritative result, UUID, and outbox correlation.
48. Conflicting or lossy migration mapping fails closed / blocks migration.
49. Migration preserves tenant and branch isolation with RLS / FORCE RLS intact.
50. Authorized non-production down migration refuses destructive loss of fiscal truth / fails closed on lossy data.
51. Migration against populated multi-tenant predecessor records preserves provider references, attempt counts, and audit trails across multiple tenants.

### Governance, Boundaries & Multi-Tenant Lookup Tests (52–57)
52. no automatic factura-global scheduler exists.
53. `OQ-ARCH-02` remains OPEN.
54. RLS/FORCE RLS tenant isolation remains PASS.
55. cross-context physical FK count remains zero.
56. multi-tenant recovery lookups (`operation_id`, `semantic_idempotency_key`, `provider_reference`, invoice `uuid`) strictly isolate tenant boundaries (`ACR020-R2-DATA-ADV-02`).
57. full regression, graph, format, lint, typecheck and build pass.

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
- crash/restart/restore/concurrency behavior: minimum E4 where the claim depends on runtime behavior;
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
- statutory data retention periods or automated purge intervals;
- tax policy;
- customer self-invoicing UX;
- Product Owner open questions.

---

## 25. R3 Authorized Scope After Canonicalization

When this ACR becomes canonical, R3 may remediate only the governed blockers and necessary supporting tests/migration changes.

Primary R3 objectives:

1. remove remaining synthetic CSD certificate metadata fallbacks;
2. enforce complete/validated CSD readiness;
3. implement provider-capability-aware reconciliation for both stamping and cancellation;
4. prevent blind redispatch after ambiguous PAC outcome;
5. validate authoritative fiscal success before local `STAMPED` and authoritative cancellation evidence before local `CANCELLED`;
6. make restart/crash recovery and Cloud backup/PITR recovery real rather than mock-dependent;
7. implement populated predecessor schema migration preservation and lossless data mapping;
8. harden concurrent single-dispatch semantics;
9. enforce `PENDING_APPROVAL != CANCELLED`;
10. preserve `OQ-ARCH-02`;
11. preserve module/data/security boundaries.

No architecture-by-implementation.

---

## 26. Governance Effect

This document is now a FROZEN CANDIDATE R3 on canonical base `0c46307e09fe77383320a86b6daff86d2983e9af` under EAAF v1.3.0 (`167cea36c09c1031c763971ff790db2e0d0f7362`), superseding Frozen Candidate R2 `b015c61da8f0ff26c40268a7e4d406888346b9f9` following Data R2 HOLD remediation.

Before WP-021 R3 implementation may be authorized, this ACR candidate must complete all independent review gates (§23), obtain Product Owner approval on the exact frozen subject, and merge canonically to `main`.

WP-021 remains:

**HOLD**
