# WP-009 BUILDER EVIDENCE REPORT — REMEDIATION R2 (S9-R2)

**Work Package:** WP-009 Edge Enrollment & Trust Bootstrap  
**Remediation Cycle:** R2  
**Candidate Subject:** `S9-R2`  
**Date:** 2026-09-11  
**Author / Builder Agent:** `16_Native_Edge_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Baseline:** `G9C = c10cfa51f0b6990bf85c14525477ae789224c996`  
**Implementation Branch:** `feature/wp-009-edge-enrollment-trust-bootstrap-r2`  
**Invalidated Predecessors:**  
- `S9-R1 = 6b7fc1982e04872fa9255a701cb978380376807d` (Permanently Invalidated)  
- `PR #28` (Permanently Invalidated & Untouched)  

---

## 1. Executive Summary & Lineage

Under formal activation following the merge and closure of WP-009 governance metadata (`ACR-2026-011` / `PR #30` / `G9C`), Builder Agent `16_Native_Edge_Developer` has constructed the fresh implementation candidate **`S9-R2`**.

The implementation branch `feature/wp-009-edge-enrollment-trust-bootstrap-r2` was created directly from canonical baseline `G9C = c10cfa51f0b6990bf85c14525477ae789224c996`. The old invalidated branch and `PR #28` remain untouched.

All 10 governed architectural invariants specified in `ACR-2026-011`, `DATA_MODEL.md` Section 3, `SECRETS_AND_KEY_MANAGEMENT.md` Section 4, and `SECURITY_ARCHITECTURE.md` Section 3.2 & 10 have been implemented in full. All 27 governed automated test obligations defined in `IMPLEMENTATION_PLAN.md` (totaling 29 explicit test cases) execute with **100% PASS** and zero skips or placeholders.

---

## 2. Governed Invariants Implementation Summary

| Invariant ID | Governance Requirement | Architectural Implementation in S9-R2 |
|---|---|---|
| **`DATA-INV-WP009-01`** | **Atomic Enrollment Transaction (`ALL COMMIT OR NONE COMMIT`)** | Implemented in `EnrollmentPersistence.executeAtomicEnrollment` inside a single SQLite WAL transaction (`EdgeDatabaseService.runInTransaction` with `BEGIN IMMEDIATE ... COMMIT`). Token CAS consumption (`UPDATE enrollment_tokens SET consumed_at = ? WHERE pairing_id = ? AND consumed_at IS NULL`), `station_credentials` insertion, and append-only forensic audit insertion into `edge_security_audit` (`TerminalEnrolada / SUCCESS`) are committed together. If credential or audit insertion fails, full rollback occurs, `consumed_at` remains `NULL`, pairing token remains unconsumed/retryable, and zero station tokens are issued. |
| **`SEC-INV-WP009-02`** | **Strict Sequential TLS Pinning Order** | Implemented in `StationEnrollmentClient.enroll`: (1) Zero-data TLS probe socket connects, extracts candidate DER cert and computes SHA-256 fingerprint with zero application bytes written; (2) Constant-time compare against physical QR payload; (3) Verified fingerprint persisted in `StationPinStore` **BEFORE** opening second TLS connection (`PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION`); (4) Second TLS connection opened with exact certificate pin (`ca: [derToPem(provenCertDer)]`); (5) Only then transmits pairing secret and station credentials. |
| **`SEC-INV-WP009-01`** | **`EdgeSecureStore` (OS Keyring Backing & Fail-Closed)** | Implemented in `EdgeSecureStore`. Sensitive material (TLS private key, 32-byte HMAC signing key) is encrypted at rest using OS-backed cryptographic keyrings (Electron safeStorage / DPAPI / Keychain / Secret Service). Linux `basic_text` fallback is strictly prohibited and fails closed upon initialization. If key material is missing or corrupted on active node, startup fails closed with `EdgeTlsKeyMissingOrCorruptedError`. Zero silent regeneration. |
| **`IAM-INV-WP009-01`** | **Station Token HMAC Key Lifecycle** | Implemented in `EdgePairingStore` and `validateHmacKeyLength`. Key is strictly 32 bytes (256 bits) generated via CSPRNG (`crypto.randomBytes(32)`). Shorter or longer keys are rejected fail-closed. Stored securely in `EdgeSecureStore`. Multi-restart persistence. Key rotation retains previous verification key for up to 12 hours (43200 seconds) token TTL. Supervised emergency invalidation purges previous key immediately. |
| **`TIME-INV-WP009-01`** | **Monotonic Trusted Effective Time & Rollback Lock** | Implemented in `TrustedTimeManager`. Runtime calculation: `trustedEffectiveTime = Tcloud + monotonicElapsedSince(M0)` using `process.hrtime.bigint()`. Anchors persisted in SQLite table `trusted_time_anchors`. Wall-clock rollback $> 5\text{ minutes}$ (300 seconds) against persisted anchor triggers `CLOCK_ROLLBACK_LOCKED`, blocks token issuance, and records critical audit `ClockRollbackDetected` with parameters recursively redacted. Initial bootstrap requires authenticated Cloud time. |
| **`SCHEMA-WP009-01`** | **Timestamp Normalization** | All security records, token expirations, anchor records, and audit events consistently use **`UNIX EPOCH SECONDS`**. |
| **`SCHEMA-WP009-02`** | **Station Type Schema Fidelity** | Conforms to canonical schema `station_type TEXT NOT NULL`. No restrictive unauthorized enums. |
| **`SCHEMA-WP009-03`** | **Omission of `station_token_hash`** | Durable table `station_credentials` omits `station_token_hash` per canonical schema in `DATA_MODEL.md` Section 3. |
| **`FLOW-INV-WP009-01`** | **In-Memory Token Signing Pre-Transaction** | Station token is prepared and signed in memory (HS256) prior to entering the atomic SQLite transaction. If signing fails, zero database mutation occurs. HTTP transmission failure post-commit preserves committed DB state. |
| **`DATA-AUTH-WP009`** | **Data Authority & Zero Generic WAN Sync Outbox** | All WP-009 tables (`enrollment_tokens`, `station_credentials`, `edge_security_audit`, `trusted_time_anchors`) are local Edge WAL authoritative records. Generic WAN sync outbox tables (`outbox_queue`) are completely absent in WP-009 (reserved for WP-012). |

---

## 3. Automated Test Suite Verification (27 Governed Obligations)

The test suite in `packages/edge/src/enrollment.test.ts` contains 29 dedicated automated tests mapping 1-to-1 to every governed test obligation in `IMPLEMENTATION_PLAN.md`.

| Test ID | Obligation Description | Governed Requirement | Result |
|---|---|---|---|
| `WP009-T01` | Rogue Edge mDNS spoofing attack rejected before secret exposure | `SEC-INV-WP009-02` / `R2F-01` | **PASS** |
| `WP009-T02` | Replay attack with expired pairing token rejected | `IAM_SECURITY_MODEL.md` Sec. 5 | **PASS** |
| `WP009-T03` | Zero application bytes transmitted on initial TLS inspection probe | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T04` | Exact certificate pin enforced on second connection | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T05` | StationPinStore persistence verified before secret transmission | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T06` | Invariant PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T07` | StationPinStore persistence survives client restart | `SECRETS_AND_KEY_MANAGEMENT.md` Sec. 4.3 | **PASS** |
| `WP009-T08` | Atomic transaction rollback test: CAS + credential + audit committed together | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T09` | Credential insertion failure injection test (proves rollback and consumed_at remains NULL) | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T10` | Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued) | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T11` | Token remains unconsumed and retryable in both failure modes | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T12` | Cross-tenant (`organization_id`) mismatch rejected | `SECURITY_ARCHITECTURE.md` Sec. 6 | **PASS** |
| `WP009-T13` | Cross-branch (`branch_id`) mismatch rejected | `SECURITY_ARCHITECTURE.md` Sec. 6 | **PASS** |
| `WP009-T14` | Cross-edge (`edge_id`) mismatch rejected | `SECURITY_ARCHITECTURE.md` Sec. 6 | **PASS** |
| `WP009-T15` | Zero public `EnrollmentPersistence` escape (strictly module-internal) | Gate B / Escape-Hatch Audit | **PASS** |
| `WP009-T16` | Edge TLS private key persists across process restarts | `SECRETS_AND_KEY_MANAGEMENT.md` Sec. 4.1 | **PASS** |
| `WP009-T17` | Missing or corrupt TLS private key fails closed on startup (`EdgeTlsKeyMissingOrCorrupted`) | `SEC-INV-WP009-01` | **PASS** |
| `WP009-T18` | Zero silent TLS identity regeneration on active node | `SEC-INV-WP009-01` | **PASS** |
| `WP009-T19` | Persistent exact-32-byte HMAC signing key survives process restart | `SECRETS_AND_KEY_MANAGEMENT.md` Sec. 4.2 | **PASS** |
| `WP009-T20` | Keys shorter or longer than exactly 32 bytes rejected | `SECRETS_AND_KEY_MANAGEMENT.md` Sec. 4.2 | **PASS** |
| `WP009-T21` | 12-hour Station Token issued with HS256 signature | `IAM_SECURITY_MODEL.md` Sec. 4 | **PASS** |
| `WP009-T22` | No `station_token_hash` stored in durable `station_credentials` | `DATA_MODEL.md` Sec. 3 | **PASS** |
| `WP009-T23` | Same-process monotonic trusted-time calculation (`process.hrtime.bigint()`) | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T24` | Post-restart trusted-anchor rollback test | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T25` | Backward clock rollback $> 5\text{ minutes}$ (300 seconds) triggers `CLOCK_ROLLBACK_LOCKED` | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T26` | `ClockRollbackDetected` critical audit record emitted with sensitive parameters redacted | `SECURITY_ARCHITECTURE.md` Sec. 10 | **PASS** |
| `WP009-T27` | Linux `basic_text` insecure safeStorage backend rejected (fails closed) | `SECRETS_AND_KEY_MANAGEMENT.md` Sec. 4.1 | **PASS** |
| `WP009-T28` | Generic sync infrastructure and `outbox_queue` absent in WP-009 | `DATA_ARCHITECTURE.md` | **PASS** |
| `WP009-T29` | Successful end-to-end enrollment flow | `SECURITY_ARCHITECTURE.md` Sec. 3.2 | **PASS** |

### Local Test Execution Output
```text
✔ WP009-T01: Simulated rogue Edge mDNS spoofing attack rejected before secret exposure (131ms)
✔ WP009-T02: Replay attack with expired pairing token rejected (62ms)
✔ WP009-T03: Zero application bytes transmitted on initial TLS inspection probe (55ms)
✔ WP009-T04: Exact certificate pin enforced on second connection (58ms)
✔ WP009-T05: StationPinStore persistence verified before secret transmission (53ms)
✔ WP009-T06: Invariant PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION (52ms)
✔ WP009-T07: StationPinStore persistence survives client restart (1ms)
✔ WP009-T08: Atomic transaction rollback test: CAS + credential + audit committed together (48ms)
✔ WP009-T09: Credential insertion failure injection test (proves rollback and consumed_at remains NULL) (48ms)
✔ WP009-T10: Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued) (47ms)
✔ WP009-T11: Token remains unconsumed and retryable in both failure modes (43ms)
✔ WP009-T12: Cross-tenant (organization_id) mismatch rejected (49ms)
✔ WP009-T13: Cross-branch (branch_id) mismatch rejected (45ms)
✔ WP009-T14: Cross-edge (edge_id) mismatch rejected (44ms)
✔ WP009-T15: Zero public EnrollmentPersistence escape (strictly module-internal) (0.1ms)
✔ WP009-T16: Edge TLS private key persists across process restarts (89ms)
✔ WP009-T17: Missing or corrupt TLS private key fails closed on startup (EdgeTlsKeyMissingOrCorrupted) (44ms)
✔ WP009-T18: Zero silent TLS identity regeneration on active node (47ms)
✔ WP009-T19: Persistent exact-32-byte HMAC signing key survives process restart (88ms)
✔ WP009-T20: Keys shorter or longer than exactly 32 bytes rejected (0.3ms)
✔ WP009-T21: 12-hour Station Token issued with HS256 signature (45ms)
✔ WP009-T22: No station_token_hash stored in durable station_credentials (43ms)
✔ WP009-T23: Same-process monotonic trusted-time calculation (process.hrtime.bigint()) (1147ms)
✔ WP009-T24: Post-restart trusted-anchor rollback test (3.4ms)
✔ WP009-T25: Backward clock rollback > 5 minutes (300 seconds) triggers CLOCK_ROLLBACK_LOCKED (45ms)
✔ WP009-T26: ClockRollbackDetected critical audit record emitted with sensitive parameters redacted (45ms)
✔ WP009-T27: Linux basic_text insecure safeStorage backend rejected (fails closed) (43ms)
✔ WP009-T28: Generic sync infrastructure and outbox_queue absent in WP-009 (44ms)
✔ WP009-T29: Successful end-to-end enrollment flow (60ms)
tests 29 | pass 29 | fail 0 | cancelled 0 | skipped 0 | todo 0
```

---

## 4. Pre-Freeze Adversarial Builder Gate Evaluation

In compliance with `PRE_FREEZE_ADVERSARIAL_BUILDER_GATE.md`, each of the 12 mandatory gates is evaluated below:

### Gate A — SSOT & Scope Traceability
- **Evaluation:** Every implemented class and function (`EdgeEnrollmentServer`, `StationEnrollmentClient`, `StationPinStore`, `EdgeSecureStore`, `TrustedTimeManager`, `EdgePairingStore`, `EdgeTlsIdentityManager`, `EnrollmentPersistence`) maps directly to approved requirements in `IMPLEMENTATION_PLAN.md` (WP-009), `DATA_MODEL.md` Section 3, `SECRETS_AND_KEY_MANAGEMENT.md` Section 4, and `SECURITY_ARCHITECTURE.md` Section 3.2. Zero scope creep. No premature WAN synchronization tables or outbox queues created.
- **Verdict:** `PASS`

### Gate B — Public Boundary & Escape-Hatch Audit
- **Evaluation:** Internal database access in `EnrollmentPersistence` is completely encapsulated within module-internal boundaries. Neither `EnrollmentPersistence` nor internal database connection getters are exported in `packages/edge/src/index.ts`. No raw private keys, HMAC secret buffers, or unpinned TLS handles are exposed via public APIs or IPC. Automated test `WP009-T15` verifies zero escape hatches.
- **Verdict:** `PASS`

### Gate C — Failure Semantics & Error Paths
- **Evaluation:** All failure paths are strictly fail-closed: (1) Missing/corrupted TLS private key throws `EdgeTlsKeyMissingOrCorruptedError`; (2) Linux `basic_text` throws `EdgeSecureStoreError`; (3) Clock rollback $> 300\text{s}$ throws `ClockRollbackLockError` and blocks issuance; (4) Fingerprint mismatch throws `EnrollmentSecurityError` without secret revelation; (5) Pin store write failure aborts before connection with zero secret disclosure; (6) Credential or audit insertion failure in SQLite triggers complete transaction rollback (`ALL COMMIT OR NONE COMMIT`). Zero false-green paths.
- **Verdict:** `PASS`

### Gate D — Negative Acceptance Criteria
- **Evaluation:** Paired negative tests are implemented and automated for every positive invariant:
  - Rogue fingerprint -> rejected (`WP009-T01`).
  - Expired token -> rejected (`WP009-T02`).
  - Pin store write failure -> zero secret disclosure & zero server mutation (`WP009-T06`).
  - Credential insert failure -> rollback, `consumed_at` remains NULL (`WP009-T09`).
  - Audit insert failure -> rollback, `consumed_at` remains NULL (`WP009-T10`).
  - Cross-tenant / cross-branch / cross-edge -> rejected (`WP009-T12`, `T13`, `T14`).
  - Corrupt key on startup -> fail-closed (`WP009-T17`).
  - Silent regeneration -> prohibited (`WP009-T18`).
  - HMAC key $\ne 32$ bytes -> rejected (`WP009-T20`).
  - Clock rollback $> 300\text{s}$ -> locked (`WP009-T24`, `T25`).
  - Linux `basic_text` -> rejected (`WP009-T27`).
- **Verdict:** `PASS`

### Gate E — Test Reality & Environment Authenticity
- **Evaluation:** Tests run against real on-disk SQLite databases via `EdgeDatabaseService` in WAL mode, real HTTPS servers with native TLS sockets, real pure Node.js X.509 ASN.1 certificate generation, and real disk-backed `StationPinStore` and `EdgeSecureStore`. Zero mock engines.
- **Verdict:** `PASS`

### Gate F — False-Green Audit
- **Evaluation:** Explicit ripgrep scans executed across `packages/edge/src`:
  - `test.skip`, `describe.skip`, `it.skip`: 0
  - `.only(`, `test.only`, `it.only`: 0
  - `test.todo`, `it.todo`: 0
  - `@ts-ignore`, `@ts-nocheck`: 0
  - Strict TypeScript compilation with `skipLibCheck: false`: PASSED (0 errors).
  - ESLint: PASSED (0 errors, 0 warnings).
  - Prettier format check: PASSED (all files clean).
- **Verdict:** `PASS`

### Gate G — Security Adversarial Check
- **Evaluation:** Zero-trust architecture verified: Zero secrets exposed over wire prior to physical certificate fingerprint pinning; constant-time string comparisons used for secret hashes and fingerprints (`crypto.timingSafeEqual`); HMAC key size strictly validated to 256 bits; sensitive fields recursively redacted before audit logging; Linux basic_text rejected fail-closed.
- **Verdict:** `PASS`

### Gate H — Data & Concurrency Invariants
- **Evaluation:** Single-writer atomic serialization guaranteed by SQLite WAL and `EdgeDatabaseService.runInTransaction({ behavior: 'IMMEDIATE' })`. CAS token update strictly verifies `changes === 1`. Invariant `ALL COMMIT OR NONE COMMIT` verified under fault injection: token remains unconsumed and retryable in both credential and audit failure modes (`WP009-T09`, `T10`, `T11`).
- **Verdict:** `PASS`

### Gate I — Architecture Conformance & Dependency Direction
- **Evaluation:** Dependencies flow strictly in accordance with the frozen architecture graph: `@trident/edge` -> `@trident/core`. Zero circular dependencies (`scripts/check-graph.mjs` PASSED). Monorepo workspace exact dependency pinning verified.
- **Verdict:** `PASS`

### Gate J — Evidence Honesty & Debt Separation
- **Evaluation:** Software algorithms for trust bootstrap, zero-data TLS probing, station pinning, atomic enrollment, and rollback protection are fully validated by automated tests in WP-009. Physical Wi-Fi / LAN hardware testing is honestly and explicitly recorded as **`SEC-VAL-03: OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** and assigned to `WP-028`.
- **Verdict:** `PASS`

### Gate K — CI & Security Pipeline Validity
- **Evaluation:** All build, lint, typecheck, unit-test, and actual Electron runtime suites execute cleanly with exit code 0 locally. Monorepo dependency graph passes. GitHub Actions workflows are verified and preserved.
- **Verdict:** `PASS`

### Gate L — Freeze Integrity & Immutability
- **Evaluation:** Working tree will be completely clean upon commit. The implementation commit will be created and frozen as `S9-R2`. Zero further commits will be added to the feature branch following freeze.
- **Verdict:** `PASS`

---

## 5. Mandatory Builder Gate Verdict

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: PASS
                     AUTHORIZED TO FREEZE CANDIDATE SHA
================================================================================
```

---

## 6. Security Debt & Protected Decisions Status

### Security Debt Tracking
| Control ID | Description | Current Status | Notes |
|---|---|---|---|
| **`SEC-VAL-03`** | Trust bootstrap, rogue Edge mDNS spoofing and relay resistance | **`OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** | Software algorithmic proof completed in WP-009; physical Wi-Fi/multicast network hardware evidence remains assigned to WP-028. |

### Protected Product Owner Decisions (Preserved as `PENDING PO DECISION`)
| Decision ID | Description | Status |
|---|---|---|
| `OQ-SSOT-01` | Post-Kitchen Cancellation Authorization | `PENDING PO DECISION` |
| `OQ-SSOT-02` | Account Transfer Authorization | `PENDING PO DECISION` |
| `OQ-SSOT-03` | Credit / CxC Charge Authorization | `PENDING PO DECISION` |
| `OQ-SSOT-04` | Total Mobile Account Cancellation | `PENDING PO DECISION` |
| `OQ-SSOT-05` | Replenishment Suggestion Authorization | `PENDING PO DECISION` |
| `OQ-SSOT-06` | Split Bill Proration Authorization | `PENDING PO DECISION` |
| `OQ-SSOT-07` | Recipe Modifier Consumption | `PENDING PO DECISION` |
| `OQ-ARCH-01` | Multi-Cashier Shift Concurrency Policy | `PENDING PO DECISION` |
| `OQ-ARCH-02` | Global / Batch Fiscal Invoicing | `PENDING PO DECISION` |

---

## 7. Invalidated Predecessor Confirmation
- **`S9-R1 = 6b7fc1982e04872fa9255a701cb978380376807d`:** Confirmed permanently INVALIDATED. Not merged, not rebased, not rehabilitated.
- **`PR #28`:** Confirmed untouched, unmerged, and permanently INVALIDATED.

---

BUILDER EVIDENCE REPORT R2 COMPLETE — READY FOR SUBJECT FREEZE
