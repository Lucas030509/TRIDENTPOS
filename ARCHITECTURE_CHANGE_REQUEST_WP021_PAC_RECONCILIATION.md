# ACR-2026-020 — WP-021 PAC RECONCILIATION & FISCAL SUCCESS CONTRACT

**Status:** FROZEN CANDIDATE R5 — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-24  
**Scope:** WP-021 — Fiscal Invoicing Engine  
**Canonical Governance Base:** 0c46307e09fe77383320a86b6daff86d2983e9af  
**Governing Framework:** EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362  
**Parent Governance:** ACR-2026-019 — DONE / CANONICAL  
**Superseded Frozen Candidate R4:** 2b6ac104554bcd585f96bc0606528c1d7142b218  
**R4 Quick Integrity Evidence:** 8d5d588ff5d05b3ca753a884d80c5918523e5db7 — PASS (mechanical preflight only)  
**R4 Solution Architecture Evidence:** 871453289b67c0240c57f79f6659151d7f5aadcf — PASS with advisory; historical exact-subject review  
**R4 Integration Evidence:** 098c59d842c310180e2ad99974a41a6dd458a981 — HOLD; blockers ACR020-R4-INT-BLK-01 and ACR020-R4-INT-BLK-02  
**R4 Review Cycle Reset Authority:** 5b7e7f2d0fb09268a6ef5c0509d158c4877ab7a0  
**R5 Scoped Review Cycle Authority:** db6e2992ed6aadc2242d870046a656c2d178a25e (evidence/ACR-2026-020_R5_REVIEW_CYCLE_RESET.md)  
**R5 Architecture-Reopen Exception Use:** 71e0fd5b01d9a284600fafa674dccaa9b29a681 (one R5-only exception; global budgets unchanged)  
**R5 Remediation Purpose:** Resolve ACR020-R4-INT-BLK-01 (fiscal event contract versioning and compatibility) and ACR020-R4-INT-BLK-02 (use-time capability provenance scope and validity enforcement), and specify consumer effect/inbox restore-domain acceptance required to close the R4 advisory without selecting a provider or changing global budgets.  
**Observed WP-021 R2 Subject:** 2d9cd149120c60b4d30778d0583344196bd210b7  
**Risk Class:** RC4 — CRITICAL  
**Primary Review Domains:** Solution Architecture, Integration, Data, Security, QA, Code Review  
**Protected Product Owner Question:** OQ-ARCH-02 remains OPEN

## 1. Purpose

WP-021 requires a provider-neutral fiscal integration contract that prevents duplicate or false fiscal state when a PAC request has an ambiguous outcome.

This ACR does not select a PAC vendor, invent provider-specific APIs, close `OQ-ARCH-02`, or authorize automatic fiscal batch scheduling.

It defines the minimum architecture and safety invariants that any future PAC adapter must satisfy before TRIDENTPOS can claim:

- safe fiscal stamping;
- safe cancellation;
- durable retry;
- process restart recovery;
- Cloud backup and PITR disaster recovery without duplicate fiscal dispatch or duplicate downstream semantic effects;
- at-least-once outbox delivery with stable semantic event identity and consumer idempotency;
- lossless schema migration and tenant isolation preservation;
- duplicate-stamp and duplicate-cancellation prevention;
- authoritative reconciliation for all fiscal operations;
- valid fiscal success and cancellation confirmation;
- safe crash and restore recovery.

---

## 2. Why This ACR Is Required

WP-021 R2 materially improves fiscal safety, but independent inspection identified unresolved RC4 hazards:

1. CSD metadata can still fall back to synthetic certificate values when the configured fiscal certificate is incomplete.
2. RECONCILIATION_REQUIRED currently returns to IN_FLIGHT and may call timbrar() again without first obtaining an authoritative provider result.
3. A PAC response labeled STAMPED can be accepted even when required fiscal evidence is missing.
4. The current mock provides deterministic replay behavior that is not yet guaranteed by any real PAC provider contract.
5. Cancellation is also an external fiscal effect with legal consequences and requires equivalent operation-specific idempotency, reconciliation, and ambiguity discipline (ACR020-R1-INT-BLK-01, ACR020-R1-INT-BLK-02).
6. Provider capability declarations must have immutable contractual provenance to prevent unfounded claims of replay or idempotency support (ACR020-R1-INT-ADV-01).
7. Fiscal recovery contracts must explicitly govern Cloud backup / PITR disaster recovery, harmonizing authoritative reconciliation with proven Rule A idempotent replay (ACR020-R2-DATA-BLK-01, ACR020-R3-SA-BLK-01).
8. Outbox delivery across disaster recovery must not assume producer-only deduplication; it requires at-least-once transport delivery, stable semantic event identity, and transactionally coupled consumer idempotency ledgers (ACR020-R3-SA-BLK-02).
9. Schema migrations affecting fiscal operation tables must enforce strict preservation invariants across forward migrations and non-production rollbacks to prevent loss or resetting of ambiguous operations, request hashes, or outbox correlations (ACR020-R2-DATA-BLK-02, ACR020-R3-SA-ADV-02).
10. Fiscal event payloads need an explicit version and compatibility contract so producer and consumer changes cannot silently reinterpret or drop required fiscal facts (ACR020-R4-INT-BLK-01).
11. A capability's contractual provenance must be current, integrity-valid, and scoped to the exact provider, operation, and recovery condition at the time of use; missing, stale, revoked, ambiguous, or unverifiable evidence must make that capability unavailable (ACR020-R4-INT-BLK-02).
12. Consumer inbox deduplication must remain consistent with consumer business effects across local recovery and producer PITR replay; retention or restore boundaries that cannot prove that consistency remain blocked.
13. Consumer-only restoration after a previously acknowledged event must recover missing effects through a durable replay or reconciliation source, or remain blocked.
14. Contractual capability evidence must authenticate its approval, bind approval to a canonical evidence digest and exact scope, and validate current signed revocation state before use.

The canonical Implementation Plan already states:

- PAC Web Services (PROVIDER CONTRACT PENDING);
- PAC timeout handling must avoid duplicate stamp requests;
- SEC-VAL-10 requires PAC contract validation.

Therefore provider behavior cannot be inferred from tests or mocks.

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
- deterministic `semanticEventId` generation (§14.1);
- durable `FacturaFiscalEmitida` and `FacturaFiscalCancelada` outbox event publication.

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

Capabilities MUST be declared and evaluated **independently per fiscal operation type** (`STAMP` vs `CANCEL`). A capability established for stamping does NOT imply or grant that capability for cancellation, nor vice versa (`ACR020-R3-SA-ADV-01`).

Minimum logical capability model:

```text
providerName
contractProvenance {
  providerName
  contractIdentifier
  contractVersion
  evidenceUriOrReference
  evidenceMediaType
  evidenceByteLength
  evidenceDigestAlgorithm = SHA-256
  evidenceDigest
  approvalAuthorityId
  approvalKeyId
  approvalAttestation
  approvedScope {
    organizationId or explicit GLOBAL scope
    operationType
    capability
    recoveryCondition
  }
  effectiveFrom
  effectiveUntil
  revocationAuthorityId
  revocationKeyId
  revocationSequence
  revocationStatus
  revocationAttestation
  revocationSnapshotIssuedAt
  revocationSnapshotValidUntil
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

1. **Operation Independence (ACR020-R1-INT-BLK-01, ACR020-R3-SA-ADV-01):** STAMP and CANCEL idempotency, lookup, and safe-replay capabilities are independent and evaluated only for the exact operation type.
2. **Exact Evidence Digest:** The provenance record MUST identify the exact immutable evidence object, media type, byte length, digest algorithm, and digest. The digest MUST be SHA-256 over the exact byte sequence retrieved from the evidence reference; no text normalization or reserialization is performed. A missing or changed byte sequence, media-type/length mismatch, or digest mismatch fails closed.
3. **Authenticated Approval:** Each capability approval MUST include a digital attestation signed by an approval authority whose key is authorized for capability approval and whose permitted scope is in a protected, audited, organization-controlled trust registry independent of the PAC/provider. The attestation MUST bind the exact evidence digest to provider, contract identifier/version, operation type, capability, recovery condition, organization scope (or explicit global scope), validity interval, and authority identity. A provider-issued contract may establish evidence origin but is not itself approval authority. An untrusted or out-of-scope approver, invalid signature, missing attestation, or unverifiable trust-registry entry makes the capability unavailable.
4. **Authoritative Revocation State:** Before each capability use, the adapter MUST obtain authenticated current status from the organization-controlled approval/revocation registry, including a monotonic sequence, signing key identity, signed issued-at / valid-until bounds, and attestation. The adapter MUST enforce the configured maximum status age from Security governance and reject revoked or superseded evidence. It MUST fail closed if the registry is unavailable, status is stale/expired, the sequence rolls back, the signing key is invalid, or freshness cannot be proven. Cached capability or revocation state MUST NOT substitute for a current registry check.
5. **Exact Scope and Tenant Binding:** Every approval MUST cover the exact provider, contract version, operation, capability, and recovery condition. Tenant scope MUST be either an explicitly approved global scope or the exact organizationId in the request. Any mismatch, not-yet-effective or expired interval, ambiguity, contradiction, supersession, revocation, digest/signature failure, missing field, or unverifiable evidence MUST resolve to false / unavailable before lookup, replay, or dispatch.
6. **No Stale Positive Cache:** A previously validated true value MUST NOT remain usable after expiry, revocation, key invalidation, supersession, or a change of operation/recovery/tenant scope. Validation MUST be repeated at use against current trust and revocation state.
7. **No Inference or Defaults:** Any capability not established by current, authenticated, approved provider-contract evidence MUST default to false / unavailable.
8. **Mocks Excluded:** The adapter MUST NOT declare a capability merely because a test mock supports it. Mocks cannot establish production provider capabilities.

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
5. on retry/restart/restore, evaluate recovery under §8 and §9.2 before any new `timbrar()` call.

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

The implementation must be safe across process restarts, node crashes, and database restoration (Cloud PITR / backup restore) for all fiscal operations (`ACR020-R2-DATA-BLK-01`, `ACR020-R3-SA-BLK-01`).

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
→ reconcile with PAC/provider (or execute Rule A idempotent replay where proven)
→ if stamped, validate authoritative fiscal result
→ atomically finalize existing operation + invoice + outbox
→ NO second fiscal stamp
```

Restart MUST NOT erase operation history or reset semantic idempotency identity.

### 9.2 Fiscal Backup / PITR / Restore Recovery Contract (`ACR020-R2-DATA-BLK-01`, `ACR020-R3-SA-BLK-01`)

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

Required recovery decision contract after database restore:

```text
load same durable semantic operation
→ preserve tenant / branch / operation / request identity
→ evaluate applicable provider capabilities under approved contract
```

#### Path A — Authoritative lookup available
If the approved provider contract establishes authoritative lookup for this operation type (`supportsAuthoritativeStampLookup` or `supportsAuthoritativeCancellationLookup`):
1. Perform authoritative reconciliation;
2. Apply normalized outcome (`STAMPED_CONFIRMED`, `CANCELLATION_CONFIRMED`, `REJECTED_CONFIRMED`, `NOT_FOUND_CONFIRMED`, `PENDING`, `UNKNOWN`);
3. Finalize locally, remain unresolved, or evaluate safe replay under §8. Reconciliation is preferred when supported.

#### Path B — Lookup unavailable but Rule A idempotent replay is proven (`ACR020-R3-SA-BLK-01`)
If authoritative lookup is unavailable/false, but the approved provider contract explicitly guarantees idempotent replay for the exact operation type under §8.1 Rule A:
Controlled replay MAY occur ONLY when all of the following remain identical and preserved:
- Same provider;
- Same operation type (`STAMP` or `CANCEL`);
- Same `operationId`;
- Same `semanticIdempotencyKey`;
- Same immutable `requestHash`;
- Same signed fiscal payload / target fiscal UUID;
- Applicable operation-specific idempotency capability = `true`;
- Approved contractual provenance supports the guarantee.

This is NOT a blind retry; it is the governed §8.1 Rule A safe-replay path.

#### Path C — Neither safe capability is proven
If neither authoritative lookup nor operation-specific idempotent replay is contractually proven:
```text
RECONCILIATION_REQUIRED
+
BLOCKED BY CONTRACT
+
AUTO_REDISPATCH = FORBIDDEN
```
The operation remains blocked for authorized human/operational reconciliation. Creating a new semantic operation identity is strictly FORBIDDEN.

#### Mandatory Validation Invariants After Restore
1. **Result Validation Mandatory:** A successful replay transport response under Path B MUST NOT bypass the authoritative fiscal result validation contract (§13 for stamping, §15.3 for cancellation). Idempotent replay proves transport safety, not result validity.
2. **Ambiguity Preservation:** Restoration MUST preserve durable fiscal operation identity. Restoration MUST NOT transform `RECONCILIATION_REQUIRED` into `PENDING`, `READY`, or any state permitting an unproven fresh external dispatch.
3. **No Inference from Restored Absences:** Local absence of `STAMPED`, `CANCELLED`, fiscal UUID, stamped XML, or outbox records in the restored database point MUST NOT be interpreted as proof that the PAC did not execute the operation.
4. **Tenant-Scoped Recovery (`ACR020-R2-DATA-ADV-02`):** Restore and recovery workflows remain strictly tenant-isolated under RLS + `FORCE RLS`. Lookups from one tenant MUST NOT read, reconcile, claim, or finalize another tenant's fiscal records.
5. **Mock Limitation:** Mock tests cannot prove real PAC lookup or replay capabilities (`BLOCKED BY CONTRACT`).

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

## 14. Atomic Local Finalization & Outbox Delivery Contract

After validated authoritative success, one tenant transaction must atomically persist:

1. fiscal operation `SUCCEEDED`;
2. authoritative fiscal UUID;
3. stamped XML and governed fiscal metadata;
4. invoice lifecycle transition to `STAMPED`;
5. durable `FacturaFiscalEmitida` outbox event with deterministic `semanticEventId` (§14.1).

If this DB transaction fails after external PAC success:

- the local operation must remain recoverable through authoritative reconciliation or proven Rule A replay;
- restart must finalize the existing provider result;
- no blind redispatch.

### 14.1 Stable Semantic Event Identity & At-Least-Once Delivery (`ACR020-R3-SA-BLK-02`)

Fiscal events are published through an outbox mechanism to notify downstream bounded contexts (e.g. Accounting, Orders, Analytics).

#### Delivery Guarantee
- Transport delivery is **AT LEAST ONCE**.
- TRIDENTPOS does NOT claim global transport exactly-once delivery.
- Instead, TRIDENTPOS guarantees **no duplicate semantic application by conforming consumers** via deterministic semantic event identity and consumer idempotency ledgers.

#### Stable Semantic Event Identity
Every fiscal outbox event MUST carry a deterministic `semanticEventId` derived from the immutable fiscal operation identity:

```text
semanticEventId = deterministic_identity(
  organizationId,
  operationId,
  eventKind
)
```

Where `eventKind` distinguishes at minimum `FacturaFiscalEmitida` and `FacturaFiscalCancelada`.

Properties of `semanticEventId`:
- **Deterministic:** Recreating an outbox row during PITR recovery or retry produces the exact same `semanticEventId`.
- **Tenant-Scoped:** Bound to `organization_id`.
- **Kind-Differentiated:** Stamping and cancellation for the same invoice cannot collide.
- **Durable:** Stable across retries, node restarts, PITR recovery, outbox recreation, and schema migrations.

### 14.2 Consumer Idempotency / Inbox Contract (ACR020-R3-SA-BLK-02)

Any TRIDENTPOS bounded context or conforming subscriber consuming fiscal events MUST implement transactional idempotent processing:

receive event  
→ validate tenant + semanticEventId + eventKind + eventContractVersion  
→ begin local consumer transaction  
→ check durable consumer inbox / idempotency ledger  
→ if semanticEventId already recorded: acknowledge and exit as a no-op  
→ otherwise apply the business mutation, insert semanticEventId into the local inbox, and commit both atomically

#### Consumer Architecture Invariants

1. **Transactional Coupling:** The consumer business effect and inbox deduplication record MUST commit in the same consumer-local transaction.
2. **Modular Boundaries:** Consumers own their local inbox tables. No shared database state, cross-context foreign keys, or consumer queries to Billing private tables are permitted. Logical isolation is required; separate physical databases are not.
3. **Same Restore Domain:** When a consumer effect and inbox share a restore domain, recovery MUST restore or reconcile them together. If the restore rolls both back consistently, the missing event effect MUST be recovered by replay from a durable event source; a consistent rollback alone does not prove the effect remains applied.
4. **Consumer-Only Restore After Acknowledgment:** After a consumer-only restore, the consumer MUST reconcile the restored interval against a durable producer outbox/event replay source and request redelivery of every event whose effect could have been rolled back, even if transport acknowledgment was previously recorded. Replay MUST preserve eventContractVersion, payload, eventKind, and semanticEventId. The source MUST support redelivery independent of prior acknowledgment.
5. **Separate Producer and Consumer Restore Domains:** The durable replay source MUST retain event identity, version, and payload through the maximum approved consumer restore / replay horizon. If the horizon or retention cannot be established, or prior-acknowledged events cannot be replayed, consumer recovery remains blocked until the missing effects are reconciled.
6. **Non-Transactional External Effects:** If consumer processing invokes an external system whose effect cannot share the consumer-local transaction, that sink MUST provide durable idempotency keyed by semanticEventId or an equivalent deterministic identity. Otherwise the integration is BLOCKED BY CONTRACT.
7. **Producer PITR Replay:** Producer Cloud PITR may re-emit an event with the same semanticEventId. Consumers MUST apply the restore-domain and source-retention rules above before claiming duplicate-safe delivery.
8. **Non-Conforming / External Consumers:** Protection against duplicate semantic application for third-party systems that do not satisfy this contract is BLOCKED BY CONTRACT until an explicit integration adapter with deduplication guarantees is approved.

### 14.3 Fiscal Event Contract Versioning and Compatibility (ACR020-R4-INT-BLK-01)

Billing owns the fiscal event contract. Every published fiscal event MUST carry an eventContractVersion in major.minor form, separately from semanticEventId. Version 1.0 is the initial example.

Contract rules:

1. **Version syntax:** major.minor MUST consist of two canonical non-negative base-10 integers separated by one dot, with no signs, whitespace, leading zeroes (except the value zero), prerelease label, or build metadata. Both components are required. A missing or malformed version is invalid.
2. **Minor version:** Additive changes that preserve the meaning of existing fields and add only optional fields increment the minor version. Consumers that support the same major MUST tolerate and ignore unknown optional fields.
3. **Major version:** A breaking change, changed field meaning, changed event semantics, or newly required field increments the major version. Consumers declare supported major versions and required fields.
4. **Compatibility before publication:** Before publishing to a required subscriber, the producer MUST establish that the subscriber supports the event's major version and every required field. If support is unknown or incompatible, publication to that subscriber is blocked and surfaced for governed remediation.
5. **Consumer validation:** A consumer MUST validate the version and required fields before any business mutation. An unknown major version, missing required payload field, unsupported required field, or invalid/missing version is rejected or quarantined with no business mutation. Unknown optional fields under a supported major are ignored.
6. **Durable retry identity:** The outbox MUST persist version and payload as immutable event data. Retry, outbox recreation, schema migration, and PITR recovery MUST preserve the original semantic meaning and compatible version for the same logical event.
7. **Identity separation:** eventContractVersion MUST NOT participate in semanticEventId; a contract upgrade cannot turn a replay of the same fiscal event into a new semantic effect.
8. **Provider neutrality:** This contract does not select a broker, PAC vendor, subscriber product, or provider-specific schema.
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
5. on retry/restart/restore, evaluate recovery under §8 and §9.2 before any new cancellation dispatch.

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

Finalize the existing local cancellation operation without redispatch. Transition local invoice to `CANCELLED` and emit durable `FacturaFiscalCancelada` event with deterministic `semanticEventId` ONLY after validating authoritative cancellation success evidence (§15.3).

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
→ evaluate recovery under §8 and §9.2 (authoritative lookup or proven Rule A replay)
→ validate authoritative cancellation evidence
→ atomically finalize existing operation (SUCCEEDED) + invoice (CANCELLED) + outbox (FacturaFiscalCancelada with semanticEventId)
→ NO second blind cancellation request
```

Local DB transaction failure after external PAC success does NOT prove the PAC did not cancel the invoice.

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

The durable fiscal operation store must support the governed state model across all schema migrations, disaster recovery, and operational lifecycles (`ACR020-R2-DATA-BLK-02`, `ACR020-R3-SA-ADV-02`).

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
4. **Outbox & Event Identity Correlation:** Migration MUST preserve the relationship between finalized operations and outbox events, including deterministic preservation or reconstruction of `semanticEventId`. No pending operation may gain a false event, and no schema split may produce duplicate events.
5. **Fail-Closed on Lossy Migration:** If lossless transformation of any existing fiscal record cannot be mathematically or structurally proven, the migration MUST fail closed and block execution.

### 18.3 Non-Production Rollback / Down Migration Contract

Authorized non-production down migrations MUST refuse destructive loss of fiscal truth:
- If a predecessor schema cannot represent a newer fiscal state, field, or cancellation record losslessly, the down migration MUST fail closed and refuse execution.
- Destructive production rollback is strictly FORBIDDEN; recovery must proceed forward via governed remediation.

### 18.4 Populated Predecessor Migration Evidence Requirement (`ACR020-R2-DATA-BLK-02`, `ACR020-R3-SA-ADV-02`)

Migration validation MUST be executed and proven against **populated predecessor test fixtures**, not empty tables. Test datasets must contain representative records for:
- Unresolved STAMP (`IN_FLIGHT`, `RECONCILIATION_REQUIRED`);
- Succeeded STAMP with certified XML and outbox correlation;
- Unresolved CANCEL;
- Cancellation in `PENDING_APPROVAL`;
- Succeeded CANCEL with outbox correlation;
- `RETRYABLE_CONFIRMED` preserving operation-specific replay proof and provenance (`ACR020-R3-SA-ADV-02`);
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
- `semanticEventId` (§14.1);
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

## 20. Required R5 Tests

WP-021 implementation evidence must include at minimum the following **92 tests**. These are requirements for a future implementation and are not claims that the tests or implementation have passed.

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

### Backup / PITR / Disaster Recovery & Rule A Harmonization Tests (37–44) (`ACR020-R2-DATA-BLK-01`, `ACR020-R3-SA-BLK-01`)
37. Cloud PITR/restore with authoritative stamp lookup supported → authoritative reconciliation before redispatch.
38. Cloud PITR/restore with authoritative cancellation lookup supported → authoritative reconciliation before redispatch.
39. Cloud PITR/restore with stamp lookup unsupported but approved stamp idempotency proven → exactly one controlled Rule A replay allowed preserving key/hash/payload.
40. Cloud PITR/restore with cancellation lookup unsupported but approved cancellation idempotency proven → exactly one controlled Rule A replay allowed.
41. Cloud PITR/restore with neither lookup nor idempotency proven → remains `RECONCILIATION_REQUIRED` / `AUTO_REDISPATCH = FORBIDDEN` / `BLOCKED BY CONTRACT`.
42. Rule A replay transport success with incomplete/invalid fiscal evidence → does not finalize local success.
43. Restored ambiguous operation preserves operation identity, request hash, provider correlation, and tenant scope without state reset.
44. Restore cannot transform unresolved `RECONCILIATION_REQUIRED` into fresh `PENDING`/`READY` retry state.

### Stable Event Identity, Outbox & Consumer Idempotency Tests (45–54) (`ACR020-R3-SA-BLK-02`)
45. `semanticEventId` is deterministically identical before and after outbox row recreation.
46. Producer outbox event delivered to consumer, producer restores via PITR before outbox commit; recovery re-emits identical `semanticEventId`.
47. Conforming consumer receiving duplicate delivery of already-applied `semanticEventId` absorbs duplicate as a NO-OP.
48. Consumer business mutation and inbox deduplication record commit atomically in single local transaction.
49. `FacturaFiscalEmitida` and `FacturaFiscalCancelada` for same invoice/operation generate distinct, non-colliding `semanticEventId`s.
50. Multi-tenant event delivery isolation: consumer inbox rejects or isolates events across tenant boundaries.
51. Schema migration preserves or deterministically reconstructs `semanticEventId` without producing duplicate events.
52. Third-party / non-conforming consumer integration without inbox idempotency contract is classified `BLOCKED BY CONTRACT`.
53. Producer PITR recovery does not emit duplicate semantic events for already-finalized local operations.
54. Cross-tenant restore and recovery lookups fail closed under RLS (tenant A cannot read, reconcile, claim, or finalize tenant B's fiscal records).

### Populated Schema Migration Preservation Tests (55–64) (`ACR020-R2-DATA-BLK-02`, `ACR020-R3-SA-ADV-02`)
55. Populated unresolved STAMP survives forward migration semantically unchanged (preserves idempotency key, request hash, state).
56. Populated successful STAMP preserves UUID, stamped XML, metadata, and outbox correlation without XML degradation.
57. Populated unresolved CANCEL survives forward migration semantically unchanged.
58. Populated `PENDING_APPROVAL` remains non-final through forward migration (`PENDING_APPROVAL != CANCELLED`).
59. Populated successful CANCEL preserves authoritative result, UUID, and outbox correlation.
60. Populated `RETRYABLE_CONFIRMED` fixture preserves operation-specific replay proof, request hash, and provenance or fails closed (`ACR020-R3-SA-ADV-02`).
61. Conflicting or lossy migration mapping fails closed / blocks migration.
62. Migration preserves tenant and branch isolation with RLS / FORCE RLS intact.
63. Authorized non-production down migration refuses destructive loss of fiscal truth / fails closed on lossy data.
64. Migration against populated multi-tenant predecessor records preserves provider references, attempt counts, and audit trails across multiple tenants.

### Pairwise Capability Non-Inference Tests (65–70) (`ACR020-R3-SA-ADV-01`)
65. `supportsStampIdempotencyKey == true` and `supportsCancellationIdempotencyKey == false` → cancellation replay forbidden.
66. `supportsCancellationIdempotencyKey == true` and `supportsStampIdempotencyKey == false` → stamp replay forbidden.
67. `supportsAuthoritativeStampLookup == true` and `supportsAuthoritativeCancellationLookup == false` → cancellation lookup forbidden.
68. `supportsAuthoritativeCancellationLookup == true` and `supportsAuthoritativeStampLookup == false` → stamp lookup forbidden.
69. `supportsSafeStampReplayAfterConfirmedNotFound == true` and `supportsSafeCancellationReplayAfterConfirmedNotFound == false` → cancellation replay after not-found forbidden.
70. `supportsSafeCancellationReplayAfterConfirmedNotFound == true` and `supportsSafeStampReplayAfterConfirmedNotFound == false` → stamp replay after not-found forbidden.

### Governance, Boundaries & Multi-Tenant Lookup Tests (71–74)
71. no automatic factura-global scheduler exists.
72. `OQ-ARCH-02` remains OPEN.
73. multi-tenant recovery lookups (`operation_id`, `semantic_idempotency_key`, `provider_reference`, invoice `uuid`) strictly isolate tenant boundaries under RLS + `FORCE RLS` (`ACR020-R2-DATA-ADV-02`).
74. full regression, graph, format, lint, typecheck and build pass.

### R5 Event Contract Versioning Tests (75–80)
75. eventContractVersion follows the specified canonical major.minor syntax and remains distinct from semanticEventId.
76. additive optional fields increment minor version and remain consumable by a same-major consumer that ignores unknown optional fields.
77. changed field meaning, breaking semantics, or a newly required field increments the major version.
78. unknown major, missing or malformed version, unsupported required field, or missing required payload field is rejected or quarantined before any business mutation.
79. a required subscriber with unknown or incompatible supported-major / required-field declaration blocks publication to that subscriber.
80. retry, outbox recreation, migration, and PITR preserve the persisted event version and semantic payload for the same logical event.

### R5 Capability Provenance Trust and Validity Tests (81–87)
81. a currently valid authenticated approval attestation from a trusted authority binds the evidence digest to the exact provider, contract, operation, capability, recovery condition, and approved tenant/global scope.
82. unknown or unauthorized approval authority, invalid signature, missing or changed evidence bytes, media-type/length mismatch, or digest mismatch makes the capability unavailable before lookup, replay, or dispatch.
83. missing, unapproved, ambiguous, contradictory, or unverifiable provenance makes the capability unavailable.
84. expired, revoked, or superseded evidence fails closed at use time, including after a previously positive cache entry.
85. provider, contract-version, operation, capability, recovery-condition, or tenant-scope mismatch makes the requested capability unavailable.
86. missing or invalid validity bounds, unavailable or stale revocation status, invalid status signature/key, excessive status age, or rollback of its monotonic sequence makes the capability unavailable.
87. table-driven capability validation proves each STAMP/CANCEL capability is authorized only for its evidenced operation and recovery condition.

### R5 Consumer Restore-Domain Consistency Tests (88–92)
88. effect and inbox within one restore domain are restored together, then replay/reconciliation from the durable source restores any rolled-back effect without duplicate semantic application.
89. tenant restore omitting or inconsistently restoring affected effect/inbox state is blocked pending explicit reconciliation.
90. replay source retains event identity, version, and payload through the approved consumer restore horizon; unknown/insufficient retention or unavailable source blocks recovery.
91. consumer-only restore after prior transport acknowledgment requests redelivery from the durable source for the restored interval and restores each semantic effect once.
92. a non-transactional downstream effect uses durable idempotency keyed by semanticEventId, or the integration is classified BLOCKED BY CONTRACT.

Tests using mocks must explicitly distinguish:

- test simulation evidence;
- provider-contract evidence.

A mock cannot prove production provider replay semantics.

---

## 21. Evidence Levels

For a future WP-021 implementation authorized after R5:

- source/static claims: minimum E1;
- domain/unit behavior: minimum E2;
- DB + adapter integration: minimum E3;
- crash/restart/restore/concurrency behavior: minimum E4 where the claim depends on runtime behavior;
- real provider/PAC certification is not claimable until provider integration evidence exists.

No PASS may rely only on Builder prose.

## 22. Circuit Breaker Budget & Review Reset Governance

Canonical EAAF v1.3 budgets in project-manifest.json remain unchanged: max_review_cycles = 3, max_builder_iterations = 3, max_same_blocker_recurrence = 1, and max_architecture_reopens = 1.

### 22.1 Historical R4 Review Cycle Reset

- **Review History Consumed:** R1 (Integration HOLD), R2 (Data HOLD), R3 (Solution HOLD).
- **Reset Authority:** Human decision recorded in 5b7e7f2d0fb09268a6ef5c0509d158c4877ab7a0 (evidence/ACR-2026-020_R4_REVIEW_CYCLE_RESET.md).
- **Scope:** One R4 review cycle only. R4 evidence remains historical and exact-subject.

### 22.2 Scoped R5 Review Cycle and Architecture-Reopen Exception

- **Authority:** Human decision recorded in db6e2992ed6aadc2242d870046a656c2d178a25e (evidence/ACR-2026-020_R5_REVIEW_CYCLE_RESET.md).
- **Review scope:** Exactly one R5 review/remediation cycle is authorized to resolve only ACR020-R4-INT-BLK-01 and ACR020-R4-INT-BLK-02, with supporting consumer restore-domain acceptance in §§14.2 and 20.88–92.
- **Architecture scope:** The single exception for this R5 has been exercised once, as recorded in sidecar 71e0fd5b01d9a284600fafa674dccaa9b29a681, to make the bounded remediations below and obtain final exact-subject review. This does not rewrite or raise max_architecture_reopens or reset any global counter. No additional R5 reopen is authorized.
- **Boundary:** No automatic R6, no new reset, and no claim that this candidate has passed any gate. The R5 authority does not authorize WP-021 Builder R3, PAC selection or capability accreditation, closure of OQ-ARCH-02, or changes to builder or recurrence counters. This is the final authorized R5 review subject; any remaining HOLD stops advancement.

### 22.3 WP-021 Builder Budget (Independent Governance)

- Builder iteration R1: consumed;
- Builder iteration R2: consumed;
- Future proposed R3: third and final default Builder iteration (max_builder_iterations = 3).
- Blocker recurrence: same_blocker_recurrence = 1 of maximum 1; it remains at limit and is not reset here.
- If future WP-021 Builder R3 reproduces the same semantic blocker: same_blocker_recurrence = 2 > 1 → CIRCUIT_BREAKER_OPEN (no autonomous R4).
- ACR authoring and remediation cycles (R1–R5) are governance activities and are NOT counted against WP-021 Builder iterations.

## 23. Independent Review Gates

Before any WP-021 Builder R3 authorization, this R5 candidate requires fresh independent evidence against its exact frozen subject:

1. Quick Integrity on the exact frozen subject.
2. Agent 01 — Solution Architect review.
3. Agent 07 — Integration Architect review.
4. Agent 03 — Data Architect review.
5. Agent 08 — Security Architect review.
6. Agent 09 — QA Test Architect review of required evidence.
7. Agent 11 — Code/Repository consistency review.
8. Coordinator synthesis.
9. Product Owner approval of the exact frozen subject.
10. PR Gate.
11. exact-head CI/security.
12. merge authorization.
13. merge.
14. post-merge validation.
15. DONE / CANONICAL.

R4 reviews and Quick Integrity are historical evidence on the R4 subject and do not satisfy R5 gates. The first R5 Quick Integrity and gate reports bind to subject 06accfe15183336734d1f046655a4e4563dd45b7 only; they are historical for that exact subject and do not satisfy the final reopened R5 gates. Passing this final review would still require separate authorization before WP-021 Builder R3 starts.

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

## 25. WP-021 Implementation Scope After Canonicalization

This section defines the implementation scope if the R5 candidate later becomes canonical and WP-021 Builder R3 is separately authorized. This candidate alone does not authorize implementation.

Primary implementation objectives:

1. remove remaining synthetic CSD certificate metadata fallbacks;
2. enforce complete/validated CSD readiness;
3. implement provider-capability-aware reconciliation for both stamping and cancellation;
4. validate current, approved, integrity-valid, exact-scope capability provenance before use;
5. prevent blind redispatch after ambiguous PAC outcome;
6. validate authoritative fiscal success before local STAMPED and authoritative cancellation evidence before local CANCELLED;
7. make restart/crash recovery and Cloud backup/PITR recovery real rather than mock-dependent, harmonizing with Rule A safe replay;
8. implement at-least-once outbox delivery with deterministic semanticEventId, versioned fiscal event contracts, and compatible consumer validation;
9. implement consumer-local transactional inbox idempotency and restore-domain / replay-horizon consistency;
10. implement populated predecessor schema migration preservation and lossless data mapping;
11. harden concurrent single-dispatch semantics;
12. enforce PENDING_APPROVAL != CANCELLED;
13. preserve OQ-ARCH-02;
14. preserve module/data/security boundaries.

No architecture-by-implementation.

## 26. Governance Effect

This document is a FROZEN CANDIDATE R5 on branch governance/acr-2026-020-wp021-pac-reconciliation-r5, based on Frozen Candidate R4 2b6ac104554bcd585f96bc0606528c1d7142b218 and the canonical governance base 0c46307e09fe77383320a86b6daff86d2983e9af, under EAAF v1.3.0 (167cea36c09c1031c763971ff790db2e0d0f7362). It supersedes Frozen Candidate R4 only for future review; R3 and R4 artifacts and their exact-subject decisions remain unchanged.

The candidate remediates the two R4 Integration blockers and specifies consumer effect/inbox restore-domain acceptance. It records use of the single authorized R5 architecture-reopen exception at 71e0fd5b01d9a284600fafa674dccaa9b29a681. It changes no runtime code, migration, dependency, lockfile, project manifest, or OPEN_QUESTIONS content. The R5 reset authority is limited to the review scope and one exception defined in §22.

Before WP-021 implementation may be authorized, this exact R5 candidate must complete all independent review gates (§23), obtain Product Owner approval on the exact frozen subject, and merge canonically to main. A separate authorization is required before Builder R3 begins.

WP-021 remains:

**HOLD**
