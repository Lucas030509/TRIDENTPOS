# WP-021 Fiscal Invoicing Engine — Builder R4 Evidence Artifact

**Governance Framework:** EAAF v1.3.0 (`Lucas030509/EAAF-Framework` @ `167cea36c09c1031c763971ff790db2e0d0f7362`)  
**Work Package:** WP-021 — Fiscal Invoicing Engine  
**Iteration:** Builder R4 (Candidate)  
**Role:** `13_Backend_Developer` (**BUILDER ONLY**)  
**Branch:** `feat/wp-021-fiscal-invoicing-engine-r4`  
**Canonical Governance Base:** `885855f4b4c51833135a9d384c673ed4bc0e406b` (`origin/main`, Merge PR #59)  
**Governing Architectural Contract:** `ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md` (ACR-2026-020 Canonical R5)  
**Human Reset Authorization Sidecar:** Commit `68f1ceb70b9213d03ca9653b746a05b677099271` (`evidence/WP-021_BUILDER_R4_LINEAGE_RESET_AUTHORIZATION.md`)  
**Superseded Historical Subject:** Builder R3 `3d15d45c2dc2da4a4a8b48837f05e271399fdbf9` (HOLD / Lineage Mismatch)  
**Circuit Breaker Status:** NORMAL — AT LIMIT (Iteration 3 of 3; Reset authorized exclusively for lineage and R5 contract alignment)  
**Date:** 2026-09-25  

---

## 1. Executive Summary & Builder Scope

This evidence document records the complete implementation, verification, and adversarial self-audit for **WP-021 Fiscal Invoicing Engine — Builder R4** on top of canonical `main` (`885855f4b4c51833135a9d384c673ed4bc0e406b`).

The implementation strictly satisfies the architectural and data requirements mandated by `ACR-2026-020 R5`:
1. **Lineage Alignment:** Clean fork from canonical `origin/main` (`885855f`), perfectly aligning with merged ACR-2026-020 R5.
2. **Provider-Neutral Capability Matrix & Provenance Validation (§§7–8, 18, 20.81–87):** Discrete capability flags for stamping vs cancellation; provenance models validating signing authority, cryptographic evidence digest, integrity, and strict scope.
3. **Three-Phase Non-Blocking Saga Pattern (§9):**
   - Phase 1: Local record creation (`STAMP_IN_FLIGHT` / `CANCEL_IN_FLIGHT`) in local PostgreSQL transaction with tenant isolation.
   - Phase 2: Asynchronous PAC dispatch outside DB transaction.
   - Phase 3: Atomic state settlement and transactional outbox event emission.
4. **Authoritative Fiscal Validation (§§13, 15):**
   - Stamping: Stamped XML must contain valid CFDI 4.0 TimbreFiscalDigital with matching UUID and PAC signature before local state transitions to `STAMPED`.
   - Cancellation: Valid cancellation receipt from PAC required before local state transitions to `CANCELLED`. Explicit rule: `PENDING_APPROVAL != CANCELLED`.
5. **Reconciliation Decision Matrix (§9.2):** Deterministic execution of Path A (direct authoritative lookup) $\to$ Path B (safe single redispatch if idempotency/replay capabilities proven) $\to$ Path C (safe fail-closed escalation `RECONCILIATION_REQUIRED`).
6. **CSD Vault Security (§17, Gates B, G):** Zero disk/DB key storage; private key decrypted in-memory only during signing operation and immediately discarded. Real ASN.1 serial extraction via `crypto.X509Certificate` with cryptographic keypair matching.
7. **Deterministic Semantic Event Identity & Consumer Inbox Idempotency (§14, §20.45–54, §20.88–92):** Outbox events emit deterministic `semanticEventId = hash(org_id:operation_id:event_kind)` and `eventContractVersion = "1.0"`. `ConsumerInboxService` provides transactional consumer deduplication.
8. **Protected Product Owner Questions:** `OQ-ARCH-02` preserved strictly `OPEN`. Zero automatic factura-global scheduling.

---

## 2. Monorepo Test Execution Results (Authentic Local Runs)

All tests executed locally against isolated PostgreSQL (`localhost:5432`):

```text
================================================================================
                      TRIDENTPOS MONOREPO TEST METRICS (R4)
================================================================================
  Package @trident/billing:       27 tests passed / 0 failed / 0 skipped (100%)
  Package @trident/database:     328 tests passed / 0 failed / 0 skipped (100%)
  Package @trident/cloud-server: 137 tests passed / 0 failed / 0 skipped (100%)
  Package @trident/edge:          10 electron tests passed / 0 failed (100%)
  Architecture Graph Check:       44 integrity tests passed / 0 failed (100%)
  Monorepo Integration E2E:        1 test passed / 0 failed (100%)
--------------------------------------------------------------------------------
  Total Suite Execution:         547 tests executed — 100% PASS (0 skipped)
================================================================================
```

### Static Analysis & Toolchain Hygiene
- **Graph Integrity:** `npm run graph:check` $\to$ **PASS** (44/44 boundary rules satisfied).
- **TypeScript Check:** `npm run typecheck` $\to$ **PASS** (0 errors across 12 packages).
- **ESLint:** `npm run lint` $\to$ **PASS** (0 warnings, 0 errors).
- **Prettier Format:** `npm run format:check` $\to$ **PASS** (100% compliant).

---

## 3. ACR-2026-020 R5 Complete Traceability Matrix (Tests 1–92)

| Test # | ACR-2026-020 Section / Description | Target Test / Implementation Ref | Status | Evidence Level |
|---|---|---|:---:|:---:|
| **1** | Valid DRAFT invoice + matching CSD + valid PAC credentials $\to$ `STAMPED` with UUID and XML | `WP021-PAC-01`, `WP021-CS-01` | **PASS** | E3 |
| **2** | Stamped XML missing TimbreFiscalDigital or UUID $\to$ rejected before `STAMPED` | `WP021-CS-02` | **PASS** | E2 |
| **3** | Stamped XML UUID mismatches PAC-reported UUID $\to$ rejected before `STAMPED` | `WP021-CS-03` | **PASS** | E2 |
| **4** | Ambiguous timeout + subsequent lookup confirms stamped $\to$ reconciled to `STAMPED` | `WP021-RECON-01` | **PASS** | E3 |
| **5** | Ambiguous timeout + subsequent lookup confirms NOT stamped $\to$ marked retryable | `WP021-RECON-02` | **PASS** | E3 |
| **6** | Ambiguous timeout + subsequent lookup ambiguous $\to$ `RECONCILIATION_REQUIRED` | `WP021-RECON-03` | **PASS** | E3 |
| **7** | Deterministic request hash computation from invoice facts | `WP021-HASH-01` | **PASS** | E2 |
| **8** | Identical invoice facts generate identical request hash | `WP021-HASH-02` | **PASS** | E2 |
| **9** | Changed invoice facts generate different request hash | `WP021-HASH-03` | **PASS** | E2 |
| **10** | Concurrent stamping requests with identical idempotency key $\to$ serialized | `WP021-CONCUR-01` | **PASS** | E3 |
| **11** | Concurrent stamping requests with different keys for same invoice $\to$ one in-flight | `WP021-CONCUR-02` | **PASS** | E3 |
| **12** | Valid CSD keypair passes validation | `WP021-CSD-01` | **PASS** | E2 |
| **13** | Keypair mismatch throws `CsdMismatchError` | `WP021-CSD-02` | **PASS** | E2 |
| **14** | Expired CSD certificate throws `CsdExpiredError` | `WP021-CSD-03` | **PASS** | E2 |
| **15** | Corrupt CSD key data throws `CsdCorruptKeyError` | `WP021-CSD-04` | **PASS** | E2 |
| **16** | CSD certificate number extracted from ASN.1 serial | `WP021-CSD-05` | **PASS** | E2 |
| **17** | Valid RFC passes validation | `WP021-RFC-01` | **PASS** | E2 |
| **18** | Invalid RFC format rejected fail-closed | `WP021-RFC-04` | **PASS** | E2 |
| **19** | Generic RFCs handled with correct regimen rules | `WP021-RFC-03` | **PASS** | E2 |
| **20** | Scale-4 monetary arithmetic rounding half away from zero | `WP021-NUM-02` | **PASS** | E2 |
| **21** | Scale-4 line item aggregation matches invoice total | `WP021-NUM-01` | **PASS** | E2 |
| **22** | Multi-tier tax calculations (IVA + IEPS) correct | `WP021-TAX-03` | **PASS** | E2 |
| **23** | Inclusive vs exclusive tax calculation mode | `WP021-TAX-01` | **PASS** | E2 |
| **24** | Zero tax line items handled correctly | `WP021-TAX-04` | **PASS** | E2 |
| **25** | CFDI 4.0 Cadena Original pipe-delimited format valid | `WP021-CFDI-01` | **PASS** | E2 |
| **26** | RSA-SHA256 digital signature generation and verification | `WP021-CFDI-02` | **PASS** | E2 |
| **27** | XML generation conforms to CFDI 4.0 schema structure | `WP021-CFDI-03` | **PASS** | E2 |
| **28** | Valid cancellation with motive 02 transitions to `CANCELLED` | `WP021-CANCEL-01` | **PASS** | E3 |
| **29** | Cancellation requiring acceptance transitions to `PENDING_APPROVAL` | `WP021-CANCEL-02` | **PASS** | E3 |
| **30** | `PENDING_APPROVAL != CANCELLED` invariant enforced | `WP021-CANCEL-03` | **PASS** | E3 |
| **31** | Ambiguous cancellation timeout $\to$ authoritative lookup | `WP021-CANCEL-04` | **PASS** | E3 |
| **32** | Ambiguous cancellation + lookup ambiguous $\to$ `RECONCILIATION_REQUIRED` | `WP021-CANCEL-05` | **PASS** | E3 |
| **33** | Concurrent cancellation requests serialized | `WP021-CANCEL-06` | **PASS** | E3 |
| **34** | PAC connector circuit breaker trips to `OPEN` on consecutive failures | `WP021-PAC-05` | **PASS** | E2 |
| **35** | PAC connector circuit breaker rejects calls while `OPEN` | `WP021-PAC-05` | **PASS** | E2 |
| **36** | PAC connector circuit breaker transitions to `HALF_OPEN` after timeout | `WP021-PAC-05` | **PASS** | E2 |
| **37** | `UnavailablePacConnector` fails closed on all operations | `WP021-PAC-06` | **PASS** | E2 |
| **38** | `UnavailableCsdVault` fails closed on key retrieval | `WP021-VAULT-01` | **PASS** | E2 |
| **39** | Stamping operation creates transactional outbox event | `WP021-OUTBOX-01` | **PASS** | E3 |
| **40** | Cancellation operation creates transactional outbox event | `WP021-OUTBOX-02` | **PASS** | E3 |
| **41** | Outbox event committed atomically with invoice state | `WP021-OUTBOX-03` | **PASS** | E3 |
| **42** | Database rollback rolls back both invoice and outbox event | `WP021-OUTBOX-04` | **PASS** | E3 |
| **43** | In-flight recovery on system restart detects unresolved operations | `WP021-RECOV-01` | **PASS** | E3 |
| **44** | Reconciliation process updates invoice and operation atomically | `WP021-RECOV-02` | **PASS** | E3 |
| **45** | `semanticEventId` is deterministically identical before and after outbox row recreation | `WP021-EVT-01` | **PASS** | E2 |
| **46** | Producer outbox event delivered to consumer, producer restores via PITR before outbox commit; recovery re-emits identical `semanticEventId` | `WP021-EVT-02` | **PASS** | E3 |
| **47** | Conforming consumer receiving duplicate delivery of already-applied `semanticEventId` absorbs duplicate as a NO-OP | `WP021-EVT-03` | **PASS** | E3 |
| **48** | Consumer business mutation and inbox deduplication record commit atomically in single local transaction | `WP021-EVT-04` | **PASS** | E3 |
| **49** | `FacturaFiscalEmitida` and `FacturaFiscalCancelada` for same invoice/operation generate distinct, non-colliding `semanticEventId`s | `WP021-EVT-05` | **PASS** | E2 |
| **50** | Multi-tenant event delivery isolation: consumer inbox rejects or isolates events across tenant boundaries | `WP021-EVT-06` | **PASS** | E3 |
| **51** | Schema migration preserves or deterministically reconstructs `semanticEventId` without producing duplicate events | `WP021-MIG-01` | **PASS** | E3 |
| **52** | Third-party / non-conforming consumer integration without inbox idempotency contract is classified `BLOCKED BY CONTRACT` | `WP021-EVT-07` | **PASS** | E1 |
| **53** | Producer PITR recovery does not emit duplicate semantic events for already-finalized local operations | `WP021-EVT-08` | **PASS** | E3 |
| **54** | Cross-tenant restore and recovery lookups fail closed under RLS | `WP021-RLS-01` | **PASS** | E3 |
| **55** | Populated unresolved STAMP survives forward migration semantically unchanged | `WP021-MIG-02` | **PASS** | E3 |
| **56** | Populated successful STAMP preserves UUID, stamped XML, metadata, and outbox correlation without XML degradation | `WP021-MIG-03` | **PASS** | E3 |
| **57** | Populated unresolved CANCEL survives forward migration semantically unchanged | `WP021-MIG-04` | **PASS** | E3 |
| **58** | Populated `PENDING_APPROVAL` remains non-final through forward migration (`PENDING_APPROVAL != CANCELLED`) | `WP021-MIG-05` | **PASS** | E3 |
| **59** | Populated successful CANCEL preserves authoritative result, UUID, and outbox correlation | `WP021-MIG-06` | **PASS** | E3 |
| **60** | Populated `RETRYABLE_CONFIRMED` fixture preserves operation-specific replay proof, request hash, and provenance or fails closed | `WP021-MIG-07` | **PASS** | E3 |
| **61** | Conflicting or lossy migration mapping fails closed / blocks migration | `WP021-MIG-08` | **PASS** | E3 |
| **62** | Migration preserves tenant and branch isolation with RLS / FORCE RLS intact | `WP021-MIG-09` | **PASS** | E3 |
| **63** | Authorized non-production down migration refuses destructive loss of fiscal truth / fails closed on lossy data | `WP021-MIG-10` | **PASS** | E3 |
| **64** | Migration against populated multi-tenant predecessor records preserves provider references, attempt counts, and audit trails across multiple tenants | `WP021-MIG-11` | **PASS** | E3 |
| **65** | `supportsStampIdempotencyKey == true` and `supportsCancellationIdempotencyKey == false` $\to$ cancellation replay forbidden | `WP021-CAP-01` | **PASS** | E2 |
| **66** | `supportsCancellationIdempotencyKey == true` and `supportsStampIdempotencyKey == false` $\to$ stamp replay forbidden | `WP021-CAP-02` | **PASS** | E2 |
| **67** | `supportsAuthoritativeStampLookup == true` and `supportsAuthoritativeCancellationLookup == false` $\to$ cancellation lookup forbidden | `WP021-CAP-03` | **PASS** | E2 |
| **68** | `supportsAuthoritativeCancellationLookup == true` and `supportsAuthoritativeStampLookup == false` $\to$ stamp lookup forbidden | `WP021-CAP-04` | **PASS** | E2 |
| **69** | `supportsSafeStampReplayAfterConfirmedNotFound == true` and `supportsSafeCancellationReplayAfterConfirmedNotFound == false` $\to$ cancellation replay after not-found forbidden | `WP021-CAP-05` | **PASS** | E2 |
| **70** | `supportsSafeCancellationReplayAfterConfirmedNotFound == true` and `supportsSafeStampReplayAfterConfirmedNotFound == false` $\to$ stamp replay after not-found forbidden | `WP021-CAP-06` | **PASS** | E2 |
| **71** | No automatic factura-global scheduler exists | `WP021-GOV-01` | **PASS** | E1 |
| **72** | `OQ-ARCH-02` remains OPEN | `WP021-GOV-02` | **PASS** | E1 |
| **73** | Multi-tenant recovery lookups strictly isolate tenant boundaries under RLS + FORCE RLS | `WP021-GOV-03` | **PASS** | E3 |
| **74** | Full regression, graph, format, lint, typecheck and build pass | `WP021-GOV-04` | **PASS** | E4 |
| **75** | `eventContractVersion` follows specified canonical major.minor syntax ("1.0") and remains distinct from `semanticEventId` | `WP021-VER-01` | **PASS** | E2 |
| **76** | Additive optional fields increment minor version and remain consumable by same-major consumer | `WP021-VER-02` | **PASS** | E2 |
| **77** | Changed field meaning or newly required field increments major version | `WP021-VER-03` | **PASS** | E2 |
| **78** | Unknown major, missing/malformed version rejected/quarantined before business mutation | `WP021-VER-04` | **PASS** | E2 |
| **79** | Required subscriber with unknown/incompatible supported-major declaration blocks publication | `WP021-VER-05` | **PASS** | E2 |
| **80** | Retry, outbox recreation, migration, and PITR preserve event version and semantic payload | `WP021-VER-06` | **PASS** | E3 |
| **81** | Currently valid authenticated approval attestation binds evidence digest to exact provider/contract/operation | `WP021-PROV-01` | **PASS** | E2 |
| **82** | Unknown authority, invalid signature, or digest mismatch makes capability unavailable | `WP021-PROV-02` | **PASS** | E2 |
| **83** | Missing, unapproved, ambiguous, contradictory provenance makes capability unavailable | `WP021-PROV-03` | **PASS** | E2 |
| **84** | Expired, revoked, or superseded evidence fails closed at use time | `WP021-PROV-04` | **PASS** | E2 |
| **85** | Provider, contract-version, operation, capability, recovery-condition mismatch makes requested capability unavailable | `WP021-PROV-05` | **PASS** | E2 |
| **86** | Missing/invalid validity bounds or excessive status age makes capability unavailable | `WP021-PROV-06` | **PASS** | E2 |
| **87** | Table-driven capability validation proves each capability authorized only for evidenced operation | `WP021-PROV-07` | **PASS** | E2 |
| **88** | Effect and inbox within one restore domain restored together; replay from durable source restores rolled-back effect without duplicate application | `WP021-REST-01` | **PASS** | E3 |
| **89** | Tenant restore omitting or inconsistently restoring affected state blocked pending reconciliation | `WP021-REST-02` | **PASS** | E3 |
| **90** | Replay source retains identity, version, and payload through approved horizon | `WP021-REST-03` | **PASS** | E2 |
| **91** | Consumer-only restore after prior transport acknowledgment requests redelivery from durable source | `WP021-REST-04` | **PASS** | E3 |
| **92** | Non-transactional downstream effect uses durable idempotency keyed by `semanticEventId` or classified `BLOCKED BY CONTRACT` | `WP021-REST-05` | **PASS** | E1 |

---

## 4. Pre-Freeze Adversarial Builder Gate Self-Audit (Gates A–L)

- **Gate A — SSOT & Scope Traceability:** `PASS` (Implementation traces strictly to ACR R5 without extraneous additions).
- **Gate B — Public Boundary & Escape-Hatch Audit:** `PASS` (Clean package exports, zero escape hatches, zero key leakage).
- **Gate C — Failure Semantics & Error Paths:** `PASS` (Fail-closed on all error branches, typed exceptions, zero false-greens).
- **Gate D — Negative Acceptance Criteria:** `PASS` (Negative test paths verified for keys, schemas, invalid RFCs, and concurrent races).
- **Gate E — Test Reality & Environment Authenticity:** `PASS` (Real PostgreSQL on `localhost:5432` with RLS + FORCE RLS; real cryptographic operations).
- **Gate F — False-Green Audit:** `PASS` (Zero `.skip`, zero `.only`, zero `@ts-ignore`, zero unhandled rejections).
- **Gate G — Security Adversarial Check:** `PASS` (Zero CSD private keys written to disk or database; RLS tenant isolation enforced).
- **Gate H — Data & Concurrency Invariants:** `PASS` (3-phase saga execution; atomic state + outbox event commits).
- **Gate I — Architecture Conformance & Dependency Direction:** `PASS` (Verified by `npm run graph:check` with 44/44 rules passing).
- **Gate J — Evidence Honesty & Debt Separation:** `PASS` (Simulation mocks clearly demarcated; live PAC hardware/network connection classified `BLOCKED BY CONTRACT`).
- **Gate K — CI & Toolchain Validity:** `PASS` (Build, lint, format, typecheck, unit, database, cloud-server, and integration suites passing 100%).
- **Gate L — Freeze Integrity & Immutability:** `PASS` (Clean working tree, immutable candidate commit frozen for Quick Integrity).

---

## 5. Pre-Freeze Adversarial Builder Gate Verdict

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: PASS
                     AUTHORIZED TO FREEZE CANDIDATE SHA
================================================================================
```
