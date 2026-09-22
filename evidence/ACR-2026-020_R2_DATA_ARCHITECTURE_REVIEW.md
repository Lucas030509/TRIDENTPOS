# ACR-2026-020 R2 — Independent Data Architecture Review

**Reviewer:** `03_Data_Architect`  
**Repository:** `Lucas030509/TRIDENTPOS`  
**Canonical base:** `0c46307e09fe77383320a86b6daff86d2983e9af`  
**Candidate branch:** `governance/acr-2026-020-wp021-pac-reconciliation-r2`  
**Exact Frozen Candidate R2:** `b015c61da8f0ff26c40268a7e4d406888346b9f9`  
**Artifact:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md`  
**Governing EAAF:** `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362` (`1.3.0`)  
**Risk:** `RC4 — CRITICAL`  
**Quick Integrity R2 evidence:** `8624f40a41aa94bcfe3f385f7a7c32f67b2d4faa`  
**Solution Architecture R2 evidence:** `954e1f25cfe67de8dd709106dca89126df3824e3` (`PASS`)  
**Integration Architecture R2 evidence:** `d702aa6f78c87510d266173a91fa653df73ecb32` (`PASS`)  
**Historical Integration R1 HOLD evidence:** `dea99835a04ea3e4f44b3f78909b52983c418f1d`  
**Observed WP-021 R2 subject:** `2d9cd149120c60b4d30778d0583344196bd210b7`  
**Timestamp:** `2026-09-22T23:38:38Z`  

## 1. Scope, authority, and exact-subject pre-flight

This independent gate reviews the semantic data architecture in the exact Frozen Candidate R2. It is not an implementation, migration, RLS, Security, QA, or Code Review result. The prior Solution and Integration PASS results are evidence context and do not substitute for this Data Architecture review.

The pinned EAAF v1.3.0 Data Architecture Gate requires explicit ownership/authority/integrity; isolation, classification, lifecycle, migration, and recovery; and testable constraints, performance assumptions, and restore validation. Only `PASS` advances.

Pre-flight verified:

- Candidate branch tip is exactly `b015c61da8f0ff26c40268a7e4d406888346b9f9`.
- Quick Integrity evidence exists and binds to R2; its verdict is PASS.
- Solution Architecture R2 and Integration Architecture R2 evidence exist and each records PASS for this exact subject.
- `main` remains exactly `0c46307e09fe77383320a86b6daff86d2983e9af`.
- R1 `2b71ed748c9ae542533b91b23be51159a6ab81c8` → R2 is exactly 1 commit ahead / 0 behind, with only `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md` changed (`+231 / -81`).
- R2's stated scope, EAAF pin, risk, product question, and circuit state agree with this review subject.

## 2. Data authority and topology

| Data | Authority in R2 | Data Architecture assessment |
|---|---|---|
| Fiscal intent, operation identity, semantic idempotency identity, request hash, local lifecycle, attempts, recovery state, validated local result persistence, and event publication | Billing | Clear local authority. A timeout, crash, rollback, or absent local provider result is not external fiscal truth. |
| Actual stamp/cancellation outcome, fiscal UUID, certified XML, provider reconciliation result, and provider acknowledgement/reference | PAC/provider, under an approved provider contract | Clear external authority. R2 does not create a second local source of fiscal truth. |
| Final local invoice state and `FacturaFiscalEmitida` / `FacturaFiscalCancelada` | Billing after authoritative result validation and local atomic finalization | Properly gated on validated evidence. |
| Branch POS operational records | Existing Edge/SQLite authority as defined by canonical topology | R2 does not grant Edge/offline operation authority to manufacture a PAC result or final fiscal success. |

R2 §§3, 6–9, 13–15 and 18 define sufficient semantic ownership for an explicit fiscal operation. The Cloud Billing context in the canonical solution topology is consistent with the proposed durable fiscal operation store. No new cross-context physical foreign key is required; R2 §18 prohibits one. Coordination with POS, Finance, Inventory, Procurement, CRM, Delivery, Loyalty, or Analytics remains through public contracts/durable events.

## 3. Data integrity review

### Identity, idempotency, and operation-specific capability

R2 §5 requires durable operation ID, organization, branch, invoice, target fiscal UUID for cancellation, operation type, semantic idempotency key, immutable request hash, provider identity/reference, attempt count, state, last deterministic provider outcome, and timestamps. Conflicting reuse fails closed. §§4 and 8 keep STAMP and CANCEL capabilities independent; §15 preserves the original cancellation identity and forbids creating a replacement to bypass ambiguity. This is semantically adequate to preserve intent through restart and to distinguish stamp from cancellation.

R2 §18 requires tenant-safe relationships, RLS plus FORCE RLS, and semantic idempotency uniqueness. The model carries tenant/branch identity into recovery and finalization; the architecture does not permit provider reference or fiscal UUID lookup to become a tenant bypass. R2 §20 includes RLS/FORCE RLS, cross-context FK, conflicting-key, wrong invoice/UUID/operation, and migration tests. These are architecture requirements, not evidence that a physical implementation conforms.

### Stamp and cancellation results; lifecycle state

R2 §§6–7, 13–15 distinguish local lifecycle from normalized external outcomes and require authoritative reconciliation for success. Stamp success requires coherent UUID, stamped XML/TFD, provider and originating operation/request correlation. Pre-stamp XML cannot stand in for certified XML. Cancellation outcomes distinguish `CANCELLATION_CONFIRMED`, `PENDING_APPROVAL`, `REJECTED_CONFIRMED`, `NOT_FOUND_CONFIRMED`, and `UNKNOWN`; `PENDING_APPROVAL` is non-final, `UNKNOWN` remains unresolved, and not-found alone does not authorize replay. Final `CANCELLED` requires evidence correlated to the original operation, invoice/UUID, provider, immutable request identity, and contractually required reference. Incomplete or mismatched evidence forbids finalization.

R2 §§14 and 15.4 require atomic local finalization of operation, invoice, authoritative metadata, and outbox event after external validation. R2 does not imply a distributed transaction with the PAC. The outbox event follows validated final local state, and pending/unknown cancellation cannot publish final cancellation. The model provides the required semantic distinction between operation state and provider outcome; §5's last deterministic provider outcome and §§7/15's normalized outcome model preserve reconciliation meaning.

### Provenance, classification, and provider dependency

R2 §4 requires immutable contractual provenance for every production capability declared true, including reference, version, digest, validity period, and limitations; absent approved evidence defaults to false/unavailable. §19 retains provenance references for audit. This provides traceability without making metadata itself provider authority and without requiring confidential contract contents or credentials in the operational store. Provider contract remains `PENDING`; unavailable provider-dependent behavior remains `BLOCKED BY CONTRACT`.

The operation/audit model excludes private keys, key passwords, and PAC credentials from logs (§19). The ACR does not require CSD private-key material in the fiscal operation database, DTOs, outbox, browser/client, or cache. Security must independently assess key custody, certificate/public metadata handling, XML, UUID, provider references, provenance access, and error/log data classification; this review does not grant Security approval.

### Lifecycle, migration, and recovery

R2 defines the operation state lifecycle, durable audit fields, and restart recovery for process failure (§§5–9, 15, 19), but its migration and backup/restore requirements leave two material gaps recorded below. The existing `DATA_ARCHITECTURE.md` labels fiscal-history retention (`5–10 years`) as requiring legal validation, the idempotency-log value (`90 days`) as requiring PO/technical validation, and audit retention (`7 years`) as a policy value; these are not settled values that this review can impose on the new operation store. R2 introduces no purge policy. Durable records must remain available for recovery and audit; exact retention/purge timing remains an advisory policy/legal dependency, not an invented fiscal rule.

## 4. Blocking findings

### `ACR020-R2-DATA-BLK-01` — Fiscal-operation recovery is not covered by testable backup/restore validation

- **Invariant:** Restoring Cloud data must preserve or recover enough fiscal operation identity, ambiguity, authoritative result, and outbox state to reconcile an external effect without duplicate dispatch, lost UUID/XML, inconsistent event publication, or cross-tenant access.
- **Source:** R2 §§9, 14, 15.4, 18, and 20; canonical `DATA_BACKUP_RESTORE.md` §§1–3 and `DATA_ARCHITECTURE_RISKS.md` DAT-08.
- **Evidence:** R2 specifies process crash/restart tests (#21 and #34), atomic local finalization (#23), and migration coverage (#41), but the 42-test matrix has no fiscal-operation backup/PITR restore scenario. The canonical backup specification includes Cloud PITR and tenant restoration and labels restore validation required; its concrete simulation exercises Edge hardware/folio recovery rather than a fiscal operation whose external PAC success predates restored local finalization.
- **Failure scenario:** Cloud is restored to a point before the local finalization transaction/outbox event after the PAC has completed the stamp or cancellation. The restored operation remains ambiguous. Without a required restore scenario, implementation may redispatch, lose or duplicate a semantic event, or fail to preserve tenant-scoped correlation during restore/reconciliation.
- **Impact:** RC4 duplicate fiscal effect, false/lost fiscal state, or tenant isolation failure after disaster recovery; restore validation is not objectively complete for WP-021's critical durable state.
- **Required remediation:** In the next candidate, require a testable Cloud backup/PITR and applicable tenant-restore scenario for an operation whose provider effect may have succeeded before local finalization. Verify restored identity/hash/provider correlation and tenant scope, authoritative reconciliation before finalization, atomic operation/invoice/outbox consistency, and no blind redispatch or duplicate event. The test must remain provider-neutral and cannot use a mock as provider-contract evidence.
- **Human Decision required:** No. This is a technical recovery contract gap.

### `ACR020-R2-DATA-BLK-02` — Migration preservation invariants for fiscal operation history are underspecified

- **Invariant:** Any governed forward migration or authorized non-production rollback must preserve or safely transform all existing fiscal operation and outbox data needed for idempotency, reconciliation, audit, and recovery; it must never silently erase predecessor operation identity or evidence.
- **Source:** R2 §18 and §20 test #41; canonical `DATA_ARCHITECTURE.md` §8 migration strategy and `DATA_ARCHITECTURE_RISKS.md` DAT-05.
- **Evidence:** R2 allows retaining/extending `fiscal_stamping_operations`, generalizing it, or adding a cancellation-specific store and marks schema change RC4. Test #41 broadly says forward migration and authorized non-production down migration preserve predecessor WPs, but the ACR does not expressly require preservation/validation of existing operation IDs, tenant/branch, operation type, semantic key, request hash, attempt/provider references, reconciliation state/outcomes, UUID/stamped result, cancellation result, and matching outbox history. The general migration strategy provides transaction/backup mechanics but does not establish this ACR-specific data mapping invariant.
- **Failure scenario:** A table split, rename, or rollback retains predecessor schemas but drops or resets ambiguous operation records, request hashes, provider references, or result/outbox correlations. A retry can then create a new semantic operation or recovery can no longer distinguish an unresolved external effect from a never-dispatched operation.
- **Impact:** Duplicate fiscal effect, loss of authoritative fiscal/audit evidence, or inconsistent outbox state during schema evolution; migration safety is not sufficiently testable for this RC4 model.
- **Required remediation:** State the fiscal-record preservation/mapping invariants explicitly for forward migration and authorized non-production rollback, including the operation and outbox fields above, tenant isolation, and fail-closed treatment where lossless mapping is impossible. Make R3 migration evidence test these invariants against populated predecessor records; do not permit a down migration to erase fiscal truth silently.
- **Human Decision required:** No. This is a technical migration contract gap.

## 5. Advisories

### `ACR020-R2-DATA-ADV-01` — Bind future retention and purge policy to an approved authority

R2 requires durable operation and audit history but assigns no retention period or deletion rule. Canonical data material currently marks the related fiscal, audit, and idempotency durations as requiring legal or PO/technical validation. Preserve the durable-history invariant and do not introduce purge/retention behavior by assumption. Before a production retention or deletion rule is implemented, bind it to an approved policy/legal decision and ensure recovery/reconciliation and audit obligations remain met. No statutory period is inferred here. Human Decision is not required to resolve the two technical blockers in this semantic gate; a later policy choice may invoke the applicable `HDG-DATA`.

### `ACR020-R2-DATA-ADV-02` — Make tenant-scoped recovery lookups explicit in implementation evidence

R2 requires tenant-safe relationships and RLS/FORCE RLS, and the existing risk matrix DAT-01 requires multi-tenant injection testing. Add explicit implementation tests showing operation ID, semantic idempotency key, provider reference, and invoice/UUID reconciliation lookups cannot read or finalize another tenant's record. This strengthens evidence precision; it does not identify a semantic permission to bypass tenant isolation in R2.

## 6. Preserved passes and testability summary

No blocking data defect was identified in the R2 contract for:

- Billing/PAC source-of-truth separation and no local inference from timeout, crash, rollback, or missing provider data;
- semantic operation identity and immutable request-hash intent;
- independent STAMP/CANCEL data identity and capability model;
- tenant and branch identity requirements, RLS/FORCE RLS, and zero cross-context physical FKs;
- authoritative stamp/cancellation validation and distinct pending, unknown, rejected, and confirmed outcomes;
- local transaction/outbox atomicity after validated provider result;
- mock anti-authority, provider-neutral provenance, and fail-closed unavailable contract behavior;
- pre-stamp XML prohibition, operation recovery intent, and preservation of `OQ-ARCH-02`.

These are semantic architecture findings only. They do not establish implementation conformance, migration PASS, production RLS, backup/restore PASS, runtime behavior, Security, QA, Code Review, or Product Owner approval. The 42-test matrix covers many R3 data invariants but does not close the two gaps above.

## 7. Governance state and verdict

- Provider contract: `PENDING`; provider-dependent semantics remain `BLOCKED BY CONTRACT` where unavailable.
- WP-021: `HOLD / UNAPPROVED`.
- Circuit Breaker: `NORMAL — AT LIMIT`; R1 and R2 Builder iterations consumed; R3 remains the third/default-final iteration; same blocker recurrence is 1 of maximum 1; no reset authorized.
- `OQ-ARCH-02`: `OPEN`.
- Blocking findings: `2`.
- Advisories: `2`.

**DATA ARCHITECTURE GATE = HOLD**

This verdict applies only to exact Frozen Candidate R2 `b015c61da8f0ff26c40268a7e4d406888346b9f9`. No candidate changes or migrations were made.

## 8. Remediation handoff

`NEXT ACTION: ACR-2026-020 author remediation for ACR020-R2-DATA-BLK-01 and ACR020-R2-DATA-BLK-02; produce a new frozen candidate for exact-subject independent Data Architecture revalidation.`

Do not advance to Security review while the Data Architecture Gate is HOLD. WP-021 R3 remains unauthorized. No Product Owner decision is required merely to define the technical restore and migration preservation contracts; retention-duration approval remains a separate policy/legal dependency.
