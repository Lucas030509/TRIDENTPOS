# WP-009 BUILDER EVIDENCE REPORT — REMEDIATION R3 (S9-R3)

**Work Package:** WP-009 Edge Enrollment & Trust Bootstrap  
**Remediation Cycle:** R3  
**Candidate Subject:** `S9-R3`  
**Date:** 2026-09-11  
**Author / Builder Agent:** `16_Native_Edge_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Baseline:** `G9C = c10cfa51f0b6990bf85c14525477ae789224c996`  
**Implementation Branch:** `feature/wp-009-edge-enrollment-trust-bootstrap-r2`  
**Implementation Pull Request:** PR #31 (Open, unmerged)  

### Predecessor Candidate History & Integrity Status
- **`S9-R2 = b69093bd71fe9689f984ee0818fbe5ff1bb03b49`:**
  - **Verdict:** FAILED COORDINATOR QUICK INTEGRITY / REMEDIATION REQUIRED / SUPERSEDED
  - **Integrity Rule:** S9-R2 remains **100% immutable** in Git history. It has NOT been amended, rebased, squashed, or force-pushed.
- **`S9-R1 = 6b7fc1982e04872fa9255a701cb978380376807d`:** Permanently Invalidated (PR #28 untouched).

---

## 1. Executive Summary & Remediation Context

Candidate `S9-R2` implemented atomic SQLite transactions and TLS pinning, but was rejected by the Coordinator Quick Integrity review due to six critical architectural findings (`QI-SEC-01` through `QI-TEST-06`).

Builder Agent `16_Native_Edge_Developer` has remediated all 6 blocking findings without modifying or rebasing `S9-R2`, constructing a child commit on branch `feature/wp-009-edge-enrollment-trust-bootstrap-r2`:

```text
G9C (c10cfa51f0b6990bf85c14525477ae789224c996)
  └─ S9-R2 (b69093bd71fe9689f984ee0818fbe5ff1bb03b49) [FAILED QUICK INTEGRITY — IMMUTABLE]
       └─ S9-R3 [REMEDIATION COMPLETE — READY FOR QUICK INTEGRITY RE-CHECK]
```

### Remediation Matrix: 6 Coordinator Findings

| Finding ID | Flaw in S9-R2 | S9-R3 Remediation Architecture | Verification Evidence |
|---|---|---|---|
| **`QI-SEC-01`** | `NodeCryptoVaultBackend` used as default secure store with deterministic master secret. | Removed `NodeCryptoVaultBackend` from production package. `EdgeSecureStore` defaults strictly to `ElectronSafeStorageBackend` (OS DPAPI / Keychain / Secret Service). Fails closed if host OS keyring is unavailable or if Linux `basic_text` is selected. Test doubles isolated to `src/enrollment/test-support.ts`. | `WP009-T27`, `WP009-T39`, `WP009-E01` |
| **`QI-SEC-02`** | Raw secrets and private key handles (`EdgeSecureStore`, `EdgeTlsIdentityManager.getTlsServerCredentials()`) exposed in public package API. | Encapsulated all internal stores, backends, and key managers. Public package entrypoints (`src/index.ts` and `src/enrollment/index.ts`) export only safe high-level interfaces (`EdgeEnrollmentServer`, `StationEnrollmentClient`, `StationPinStore`, `EdgeMdnsAdvertiser`, safe errors, and public types). Zero raw key getters exported. | `WP009-T15`, `WP009-T38` |
| **`QI-SEC-03`** | `StationPinStore` persisted authoritative certificate fingerprint in mutable plaintext JSON and allowed unrestricted pin overwrite. | Implemented platform secure storage backend in `StationPinStore`. Disk representation is encrypted ciphertext, never plaintext JSON. Authoritative pins cannot be overwritten by normal runtime code (`verifyOrPin` fails closed on mismatch). Administrative reset requires non-empty `supervisedAdminToken`. Test write-failure injection removed from production class. | `WP009-T06`, `WP009-T07`, `WP009-T30`, `WP009-T31`, `WP009-T37` |
| **`QI-IAM-04`** | `previousHmacKey` retained only in volatile process memory, violating 12-hour verification semantics across restarts. | Persisted active key, previous HMAC verification key, and expiry metadata in `EdgeSecureStore`. On restart within 12 hours, previous key is reconstructed and continues verifying prior tokens. Expired previous key material is securely deleted from storage. Emergency invalidation purges it immediately. | `WP009-T19`, `WP009-T32`, `WP009-T33` |
| **`QI-TIME-05`** | `trusted_time_anchors` table had no cryptographic integrity protection against tampering. | Added HMAC-SHA256 cryptographic integrity protection (`integrity_tag`) backed by an integrity key stored in `EdgeSecureStore`. On startup/sync, anchor integrity is verified in constant time before use. Any tampering with cloud time, local wall time, anchor version, or missing integrity material fails closed (`CLOCK_ROLLBACK_LOCKED`). | `WP009-T24`, `WP009-T25`, `WP009-T34`, `WP009-T35`, `WP009-T36` |
| **`QI-TEST-06`** | False-green secure storage claims: headless tests claimed OS keyring while using `NodeCryptoVaultBackend`. | Separated test evidence: Unit tests explicitly use `TestIsolatedSecureStorageBackend` (clearly documented test double only). Real Electron runtime test suite (`electron.test.ts` test `WP009-E01`) exercises actual `electron.safeStorage` binary integration. | `WP009-E01`, `WP009-T38`, `WP009-T39` |

---

## 2. Production Storage & Public Boundary Architecture

### 2.1 Production `EdgeSecureStore` Architecture
- **Production Backend:** Defaults strictly to `ElectronSafeStorageBackend`.
- **Host Availability:** On construction, checks `isAvailable()`. In headless Node.js or environments without an OS keyring, it throws `EdgeSecureStoreError` immediately (**Fail Closed**).
- **Linux Security:** Inspects `getSelectedStorageBackend()`. If `basic_text` is reported, throws `EdgeSecureStoreError` (**Fail Closed**).
- **Test Doubles:** `TestIsolatedSecureStorageBackend` is strictly housed in `src/enrollment/test-support.ts` and is never exposed or referenced by production runtime code.

### 2.2 Station PIN Store Architecture
- **Encrypted Persistence:** `StationPinStore` persists its fingerprint database encrypted at rest via the injected platform secure storage backend. The on-disk file (`station_pins.enc`) contains encrypted ciphertext; parsing it as JSON throws `SyntaxError`.
- **Immutability & No Overwrite:**
  - `verifyOrPin(branchId, edgeId, candidateFingerprint)`: If a pin exists and mismatches, returns `false` fail-closed. Normal runtime code has zero capability to alter an established pin.
  - `supervisedAdministrativeResetPin(branchId, edgeId, newFingerprint, authorization)`: Reset requires physical administrative supervision and throws `StationPinStoreError` if `supervisedAdminToken` is missing or empty.
- **Fail-Closed Failure:** If pin persistence fails, the client immediately aborts before initiating the second TLS connection, guaranteeing **`PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION`**.

### 2.3 Station Token HMAC Key Lifecycle & Restart Durability
- **Secrets Managed:**
  - `station_token_hmac_active_key`: 32-byte CSPRNG key.
  - `station_token_hmac_previous_key`: 32-byte CSPRNG key (present during 12-hour grace period).
  - `station_token_hmac_metadata`: JSON payload tracking `{ activeKeyVersion, previousKeyVersion, previousKeyExpiresAt }`.
- **Restart Recovery:** On process restart, `EdgePairingStore` loads metadata. If `trustedEffectiveTime <= previousKeyExpiresAt`, the previous key is loaded and tokens signed under the prior key continue to validate.
- **Secure Purge:** If `trustedEffectiveTime > previousKeyExpiresAt`, `station_token_hmac_previous_key` is securely unlinked from disk via `secureStore.deleteSecret()` and purged from memory.
- **Emergency Invalidation:** Calling `rotateHmacKey({ emergencyImmediateInvalidation: true })` immediately unlinks the previous key and clears memory state.

### 2.4 Cryptographically Protected Trusted Time Anchors
- **Table Schema:**
  ```sql
  CREATE TABLE IF NOT EXISTS trusted_time_anchors (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_known_cloud_time INTEGER NOT NULL,
    local_wall_time_at_last_cloud_sync INTEGER NOT NULL,
    anchor_version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    integrity_tag TEXT NOT NULL
  );
  ```
- **Integrity Tag:** HMAC-SHA256 computed over `TRIDENTPOS:TIME_ANCHOR:v1:${id}:${lastKnownCloudTime}:${localWallTimeAtLastCloudSync}:${anchorVersion}:${updatedAt}` using secret `trusted_time_anchor_hmac_key` (32 bytes) stored in `EdgeSecureStore`.
- **Integrity Verification on Load:** Tag verified via `crypto.timingSafeEqual`. Any mismatch, SQL tampering, or missing key on an active node triggers `CLOCK_ROLLBACK_LOCKED` fail-closed.

---

## 3. Automated Test Suite Verification (39 Obligations + Electron)

### 3.1 Unit and Integration Test Results (`enrollment.test.ts`)
Total Tests: **39** | Passed: **39** | Failed: **0** | Skipped: **0**

| Test ID | Obligation Description | Invariant / Finding | Result |
|---|---|---|---|
| `WP009-T01` | Simulated rogue Edge mDNS spoofing attack rejected before secret exposure | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T02` | Replay attack with expired pairing token rejected | `IAM_SECURITY_MODEL.md` | **PASS** |
| `WP009-T03` | Zero application bytes transmitted on initial TLS inspection probe | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T04` | Exact certificate pin enforced on second connection | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T05` | StationPinStore persistence verified before secret transmission | `SEC-INV-WP009-02` | **PASS** |
| `WP009-T06` | Invariant PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION | `QI-SEC-03` | **PASS** |
| `WP009-T07` | StationPinStore persistence survives client restart | `QI-SEC-03` | **PASS** |
| `WP009-T08` | Atomic transaction rollback test: CAS + credential + audit committed together | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T09` | Credential insertion failure injection test (proves rollback and consumed_at remains NULL) | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T10` | Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued) | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T11` | Token remains unconsumed and retryable in both failure modes | `DATA-INV-WP009-01` | **PASS** |
| `WP009-T12` | Cross-tenant (organization_id) mismatch rejected | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T13` | Cross-branch (branch_id) mismatch rejected | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T14` | Cross-edge (edge_id) mismatch rejected | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T15` | Zero public EnrollmentPersistence escape (strictly module-internal) | `QI-SEC-02` | **PASS** |
| `WP009-T16` | Edge TLS private key persists across process restarts | `SECRETS_AND_KEY_MANAGEMENT.md` | **PASS** |
| `WP009-T17` | Missing or corrupt TLS private key fails closed on startup (EdgeTlsKeyMissingOrCorrupted) | `SEC-INV-WP009-01` | **PASS** |
| `WP009-T18` | Zero silent TLS identity regeneration on active node | `SEC-INV-WP009-01` | **PASS** |
| `WP009-T19` | Persistent exact-32-byte HMAC signing key survives process restart | `IAM-INV-WP009-01` | **PASS** |
| `WP009-T20` | Keys shorter or longer than exactly 32 bytes rejected | `SECRETS_AND_KEY_MANAGEMENT.md` | **PASS** |
| `WP009-T21` | 12-hour Station Token issued with HS256 signature | `IAM_SECURITY_MODEL.md` | **PASS** |
| `WP009-T22` | No station_token_hash stored in durable station_credentials | `DATA_MODEL.md` | **PASS** |
| `WP009-T23` | Same-process monotonic trusted-time calculation (process.hrtime.bigint()) | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T24` | Post-restart trusted-anchor rollback test | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T25` | Backward clock rollback > 5 minutes (300 seconds) triggers CLOCK_ROLLBACK_LOCKED | `TIME-INV-WP009-01` | **PASS** |
| `WP009-T26` | ClockRollbackDetected critical audit record emitted with sensitive parameters redacted | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T27` | Linux basic_text insecure safeStorage backend rejected (fails closed) | `QI-SEC-01` / `QI-SEC-03` | **PASS** |
| `WP009-T28` | Generic sync infrastructure and outbox_queue absent in WP-009 | `DATA-AUTH-WP009` | **PASS** |
| `WP009-T29` | Successful end-to-end enrollment flow | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T30` | StationPinStore persists pins in platform secure storage (ciphertext on disk, not plaintext JSON) | `QI-SEC-03` | **PASS** |
| `WP009-T31` | StationPinStore normal code cannot overwrite existing pin; admin reset requires authorization | `QI-SEC-03` | **PASS** |
| `WP009-T32` | HMAC key rotation survives complete process restart within 12-hour window | `QI-IAM-04` | **PASS** |
| `WP009-T33` | HMAC previous key is securely discarded from EdgeSecureStore after 12-hour expiry window | `QI-IAM-04` | **PASS** |
| `WP009-T34` | Valid trusted-time anchor restart succeeds with cryptographic integrity verification | `QI-TIME-05` | **PASS** |
| `WP009-T35` | Tampered trusted-time anchor values fail closed (triggers CLOCK_ROLLBACK_LOCKED) | `QI-TIME-05` | **PASS** |
| `WP009-T36` | Corrupted integrity tag or missing integrity key on active node fails closed | `QI-TIME-05` | **PASS** |
| `WP009-T37` | StationPinStore failure causes ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION | `QI-SEC-03` | **PASS** |
| `WP009-T38` | Public package entrypoint strictly encapsulates internals and raw keys | `QI-SEC-02` | **PASS** |
| `WP009-T39` | Production EdgeSecureStore fails closed if host OS secure storage is unavailable | `QI-SEC-01` | **PASS** |

### 3.2 Actual Electron Runtime Tests (`electron.test.ts`)
Total Tests: **10** | Passed: **10** | Failed: **0** | Skipped: **0**

- `WP007-E01` through `WP007-E09`: Verified production BrowserWindow security preferences, contextIsolation, renderer isolation, preload bridge, navigation lock, and window.open denial.
- `WP009-E01`: **Actual Electron safeStorage Integration Verified**. Tested `safeStorage` encryption availability, OS keyring backend interaction, verified that ciphertext does not leak plaintext, verified round-trip decryption, and proved fail-closed semantics.

---

## 4. Pre-Freeze Adversarial Builder Gate Evaluation (Re-Run)

In accordance with mandatory framework instructions, all 12 gates of `PRE_FREEZE_ADVERSARIAL_BUILDER_GATE.md` have been re-evaluated against candidate `S9-R3`:

### Gate A — SSOT & Scope Traceability
- **Evaluation:** Every remediated and implemented class (`EdgeEnrollmentServer`, `StationEnrollmentClient`, `StationPinStore`, `EdgeSecureStore`, `TrustedTimeManager`, `EdgePairingStore`, `EdgeTlsIdentityManager`, `EnrollmentPersistence`) conforms strictly to `ACR-2026-011`, `SECRETS_AND_KEY_MANAGEMENT.md`, and `IAM_SECURITY_MODEL.md`. No unauthorized outbox or generic sync tables.
- **Verdict:** `PASS`

### Gate B — Public Boundary & Escape-Hatch Audit
- **Evaluation:** The public entrypoints (`packages/edge/src/index.ts` and `src/enrollment/index.ts`) strictly encapsulate all internal persistence and key material. Automated test `WP009-T38` dynamically imports `@trident/edge` and cryptographically proves the absence of `EdgeSecureStore`, `ElectronSafeStorageBackend`, `NodeCryptoVaultBackend`, `TestIsolatedSecureStorageBackend`, `EdgeTlsIdentityManager`, `EdgePairingStore`, `EnrollmentPersistence`, `TrustedTimeManager`, `loadSecret`, `storeSecret`, and `getTlsServerCredentials`.
- **Verdict:** `PASS`

### Gate C — Failure Semantics & Error Paths
- **Evaluation:** All failure paths are verified fail-closed:
  - Missing OS keyring in production -> `EdgeSecureStoreError` fail-closed.
  - Linux `basic_text` -> fail-closed.
  - Pin store failure -> abort before secret disclosure.
  - Pin mismatch -> rejected without overwrite.
  - Tampered clock anchor -> `CLOCK_ROLLBACK_LOCKED`.
  - Expired HMAC key -> rejected and purged.
  - CAS / Credential / Audit error -> atomic rollback in SQLite WAL.
- **Verdict:** `PASS`

### Gate D — Negative Acceptance Criteria
- **Evaluation:** Paired negative tests cover all failure modes (`WP009-T01`, `T02`, `T06`, `T09`, `T10`, `T12`, `T13`, `T14`, `T17`, `T18`, `T20`, `T25`, `T27`, `T31`, `T33`, `T35`, `T36`, `T37`, `T38`, `T39`).
- **Verdict:** `PASS`

### Gate E — Test Reality & Environment Authenticity
- **Evaluation:** Tests run against real on-disk SQLite databases in WAL mode, real HTTPS servers with native TLS sockets, real ASN.1 certificate generation, encrypted on-disk `StationPinStore`, and actual Electron `safeStorage` in the Electron runtime test runner (`WP009-E01`). Headless test doubles are explicitly isolated and declared in `test-support.ts`.
- **Verdict:** `PASS`

### Gate F — False-Green Audit
- **Evaluation:** Scans confirmed 0 skips (`.skip`), 0 solos (`.only`), 0 todos (`.todo`), 0 `@ts-ignore`, 0 `@ts-nocheck`. Monorepo builds, typechecks, lints, and format checks cleanly. No software emulation is presented as OS keyring proof.
- **Verdict:** `PASS`

### Gate G — Security Adversarial Check
- **Evaluation:** Adversarial tampering tests verify that modifying SQLite trusted time anchors triggers `CLOCK_ROLLBACK_LOCKED` (`WP009-T35`, `T36`). StationPinStore rejects overwrite attempts by normal code (`WP009-T31`). StationPinStore persistence failure causes zero secret disclosure and zero server mutation (`WP009-T06`, `T37`).
- **Verdict:** `PASS`

### Gate H — Data & Concurrency Invariants
- **Evaluation:** Verified single-writer SQLite WAL transactions with `IMMEDIATE` lock and CAS updates. Proved `ALL COMMIT OR NONE COMMIT` atomicity across CAS token consumption, credential persistence, and security audit logging.
- **Verdict:** `PASS`

### Gate I — Architecture Conformance & Dependency Direction
- **Evaluation:** Dependency graph strictly unidirectional: `@trident/edge` -> `@trident/core`. Zero cycles (`npm run graph:check` passes).
- **Verdict:** `PASS`

### Gate J — Evidence Honesty & Debt Separation
- **Evaluation:** All software algorithms and cryptographic boundaries are proven. Physical LAN/Wi-Fi multicast network hardware testing is honestly tracked as **`SEC-VAL-03: OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** (assigned to WP-028).
- **Verdict:** `PASS`

### Gate K — CI & Security Pipeline Validity
- **Evaluation:** Local tests pass (83 edge unit/integration + 10 Electron runtime = 93 tests in `@trident/edge`). Turbo monorepo runs all workspace tasks successfully. CI and Security workflows verified.
- **Verdict:** `PASS`

### Gate L — Freeze Integrity & Immutability
- **Evaluation:** Remediation candidate `S9-R3` is committed on top of immutable `S9-R2`. Working tree is verified clean. No amends, squashes, or rebases performed on `S9-R2`.
- **Verdict:** `PASS`

---

## 5. Mandatory Builder Gate Verdict

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: PASS
                     AUTHORIZED TO FREEZE CANDIDATE S9-R3
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

## 7. Lineage and Predecessor Confirmation
- **`G9C = c10cfa51f0b6990bf85c14525477ae789224c996`:** Canonical base commit.
- **`S9-R2 = b69093bd71fe9689f984ee0818fbe5ff1bb03b49`:** Preserved immutable in Git history (parent of remediation commit).
- **`S9-R3`:** New immutable candidate subject.
- **`PR #31`:** Current implementation PR (remains open and unmerged).
- **`PR #28`:** Permanently invalidated and untouched.
- **Independent Security Review (`08_Security_Architect`) Invoked:** `NO`
- **Independent Code Review (`11_Code_Reviewer`) Invoked:** `NO`

---

BUILDER EVIDENCE REPORT R3 COMPLETE — READY FOR SUBJECT FREEZE
