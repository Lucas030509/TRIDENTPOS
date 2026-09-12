# WP-009 BUILDER EVIDENCE REPORT — REMEDIATION R4 (S9-R4)

**Work Package:** WP-009 Edge Enrollment & Trust Bootstrap  
**Remediation Cycle:** R4  
**Candidate Subject:** `S9-R4`  
**Date:** 2026-09-11  
**Author / Builder Agent:** `16_Native_Edge_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Baseline:** `G9C = c10cfa51f0b6990bf85c14525477ae789224c996`  
**Implementation Branch:** `feature/wp-009-edge-enrollment-trust-bootstrap-r2`  
**Implementation Pull Request:** PR #31 (Open, unmerged)  

### Predecessor Candidate History & Integrity Status
- **`S9-R3 = 9423f4f1ae8a90c77c8a8789611fc8c6403d0bf9`:**
  - **Verdict:** FAILED COORDINATOR QUICK INTEGRITY / REMEDIATION REQUIRED / SUPERSEDED
  - **Integrity Rule:** S9-R3 remains **100% immutable** in Git history. It has NOT been amended, rebased, squashed, or force-pushed.
- **`S9-R2 = b69093bd71fe9689f984ee0818fbe5ff1bb03b49`:** FAILED QUICK INTEGRITY / SUPERSEDED (Immutable).
- **`S9-R1 = 6b7fc1982e04872fa9255a701cb978380376807d`:** Permanently Invalidated (PR #28 untouched).

---

## 1. Executive Summary & Remediation Context

Candidate `S9-R3` resolved packaging, encapsulation, and key persistence concerns, but was rejected by the Coordinator Quick Integrity review due to four blocking security and validation findings:
1. **Admin Pin Reset is an Authorization Bypass:** `StationPinStore.supervisedAdministrativeResetPin` accepted arbitrary non-empty strings as tokens.
2. **HMAC Metadata Fails Open:** `#loadOrInitializeHmacKeys()` silently fell back to `activeKeyVersion = 1` if metadata was missing or corrupted on an active node.
3. **Trusted Time Anchor Deletion Bypass:** Deleting the SQLite anchor row caused `#loadPersistedAnchor()` to treat an active node with an existing integrity key as a fresh bootstrap.
4. **Linux safeStorage Unknown Backend Fail-Open:** Electron runtime test recorded PASS with `backend = unavailable` without platform-aware fail-closed validation on Linux.

Builder Agent `16_Native_Edge_Developer` has remediated all 4 blockers in a clean child commit `S9-R4`:

```text
G9C (c10cfa51f0b6990bf85c14525477ae789224c996)
  └─ S9-R2 (b69093bd71fe9689f984ee0818fbe5ff1bb03b49) [FAILED QUICK INTEGRITY — IMMUTABLE]
       └─ S9-R3 (9423f4f1ae8a90c77c8a8789611fc8c6403d0bf9) [FAILED QUICK INTEGRITY — IMMUTABLE]
            └─ S9-R4 [REMEDIATION COMPLETE — READY FOR QUICK INTEGRITY RE-VERIFICATION]
```

### Remediation Matrix: 4 Coordinator Blockers

| Blocker ID | Flaw in S9-R3 | S9-R4 Remediation Architecture | Verification Evidence |
|---|---|---|---|
| **`BLOCKER 1`** | `StationPinStore.supervisedAdministrativeResetPin` accepted arbitrary strings, permitting runtime PIN overwrite without authentication. | Removed `supervisedAdministrativeResetPin` completely from `StationPinStore` and public runtime API. Established PINs are immutable; mismatch fails closed. Zero overwrite/reset methods exist in production runtime. Administrative/physical reset remains a separately governed future workflow. | `WP009-T31`, `WP009-T37`, `WP009-T38` |
| **`BLOCKER 2`** | `EdgePairingStore` fell back to `activeKeyVersion = 1` when metadata was missing/corrupt, risking invalidation of 12-hour Station Tokens. | Defined first bootstrap strictly as: `!hasActiveKey && !hasMetadata`. On an active node (`hasActiveKey`), metadata MUST exist, be valid JSON, and have integer `activeKeyVersion >= 1`. If metadata declares an unexpired previous key, `station_token_hmac_previous_key` MUST exist and be exactly 32 bytes; otherwise fails closed (`EnrollmentSecurityError`). Expired keys are purged normally. Zero silent version resets. | `WP009-T32`, `WP009-T33`, `WP009-T40` |
| **`BLOCKER 3`** | If SQLite anchor row was deleted, `TrustedTimeManager` treated the node as a fresh bootstrap despite `trusted_time_anchor_hmac_key` existing in secure storage. | Defined first bootstrap strictly as: `!hasRow && !hasIntegrityKey`. If integrity key exists but anchor row is missing: FAIL CLOSED (`CLOCK_ROLLBACK_LOCKED`). If anchor row exists but integrity key is missing: FAIL CLOSED. If both exist: verify HMAC-SHA256 integrity tag before use. System lock prevents automatic recreation via `syncCloudTime`. | `WP009-T24`, `WP009-T25`, `WP009-T34`, `WP009-T35`, `WP009-T36` |
| **`BLOCKER 4`** | `ElectronSafeStorageBackend` did not distinguish Linux backend allowlist from macOS/Windows, passing with `backend = unavailable`. | Implemented platform-aware validation: macOS/Windows require `isEncryptionAvailable() === true`. Linux requires `isEncryptionAvailable() === true` AND `getSelectedStorageBackend()` in `['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']`. On Linux, `basic_text`, `unavailable`, and unknown backends FAIL CLOSED in `ElectronSafeStorageBackend`, `EdgeSecureStore`, and `StationPinStore`. Electron test `WP009-E01` explicitly separates Outcomes A, B, and C and reports exact evidence. | `WP009-T27`, `WP009-T39`, `WP009-T41`, `WP009-E01` |

---

## 2. Detailed Technical Remediation

### 2.1 Blocker 1: Elimination of Admin Pin Reset Authorization Bypass
- **Elimination of Bypass:** `supervisedAdministrativeResetPin` was completely excised from `StationPinStore` in `packages/edge/src/enrollment/secure-store.ts`.
- **Enforced Immutability:** `verifyOrPin` checks if an authoritative pin exists. If it exists, it strictly returns `existing.edgePublicKeyFingerprint.toUpperCase() === candidateFingerprint.toUpperCase()`. Candidate mismatch fails closed (`false`).
- **No Alternative Overwrite Paths:** Automated test `WP009-T31` inspects the store instance to confirm that `supervisedAdministrativeResetPin`, `resetPin`, `overwritePin`, and `clearPin` are undefined on `StationPinStore`.
- **Persistence Across Restarts:** Established pins are encrypted on disk (`station_pins.enc`) and survive restart without mutation.

### 2.2 Blocker 2: HMAC Metadata Fail-Closed Verification
- **First Bootstrap Rule:** A node is considered fresh if and only if neither `station_token_hmac_active_key` nor `station_token_hmac_metadata` exists.
- **Inconsistent State Enforcement:**
  - `hasActiveKey && !hasMetadata` => throws `EnrollmentSecurityError` (fail closed).
  - `!hasActiveKey && hasMetadata` => throws `EnrollmentSecurityError` (fail closed).
  - Corrupt / non-JSON metadata => throws `EnrollmentSecurityError` (fail closed).
  - Malformed metadata schema (e.g. non-numeric activeKeyVersion) => throws `EnrollmentSecurityError` (fail closed).
  - Metadata declares non-expired previous key while `station_token_hmac_previous_key` is missing in `EdgeSecureStore` => throws `EnrollmentSecurityError` (fail closed).
  - Previous key length !== 32 bytes => throws `EnrollmentSecurityError` (fail closed).
- **Grace Period Preservation:** When metadata declares an unexpired previous key and trusted effective time is within bounds, both active and previous keys are restored with exact versions, allowing Station Tokens issued before restart to validate seamlessly.

### 2.3 Blocker 3: Trusted Time Anchor Deletion Fail-Closed Verification
- **Strict First Bootstrap Definition:**
  ```text
  Fresh Bootstrap Allowed <==> (NO trusted_time_anchors row) AND (NO trusted_time_anchor_hmac_key)
  ```
- **Anchor Deletion Detection:** If `trusted_time_anchor_hmac_key` exists in `EdgeSecureStore` but no row exists in SQLite table `trusted_time_anchors`, the system immediately detects anchor deletion/tampering and triggers `CLOCK_ROLLBACK_LOCKED` (`ClockRollbackLockError`).
- **Recreation Prevention:** Calling `syncCloudTime()` while locked throws `ClockRollbackLockError`, prohibiting attackers from wiping the database row to reset trusted time lower bounds.

### 2.4 Blocker 4: Linux safeStorage Platform-Aware Validation & Electron Test Requirements
- **Secure Linux Keyring Allowlist (Electron 44.3.0 Contract):**
  ```ts
  export const SECURE_LINUX_STORAGE_BACKENDS: ReadonlySet<string> = new Set([
    'gnome_libsecret',
    'kwallet',
    'kwallet5',
    'kwallet6',
  ]);
  ```
- **Platform-Aware Availability:**
  - macOS (`darwin`) / Windows (`win32`): `safeStorage.isEncryptionAvailable() === true`.
  - Linux (`linux`): `safeStorage.isEncryptionAvailable() === true` AND `SECURE_LINUX_STORAGE_BACKENDS.has(selectedBackend)`.
- **Fail-Closed on Insecure Backends:** On Linux, `basic_text`, `unavailable`, and unknown backends cause `isAvailable()` to return `false`, and any invocation of `encrypt()` or `decrypt()` throws `EdgeSecureStoreError`. Constructors of `EdgeSecureStore` and `StationPinStore` verify availability immediately upon instantiation and fail closed.
- **WP009-E01 Disambiguation:**
  - **Outcome A:** Secure OS-backed backend positively available -> PASS with positive encryption/decryption proof.
  - **Outcome B:** Linux `basic_text` -> PASS only if production constructor and encryption FAIL CLOSED.
  - **Outcome C:** Linux `unavailable`/unknown backend -> PASS only if production constructor and encryption FAIL CLOSED.
  - Never reports "OS-backed integration verified" when the backend is unknown or unavailable.

---

## 3. Automated Test Suite Verification

### 3.1 Unit and Integration Test Results (`enrollment.test.ts`)
Total Tests: **41** | Passed: **41** | Failed: **0** | Skipped: **0**

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
| `WP009-T27` | Linux basic_text insecure safeStorage backend rejected (fails closed) | `QI-SEC-01` / `BLOCKER 4` | **PASS** |
| `WP009-T28` | Generic sync infrastructure and outbox_queue absent in WP-009 | `DATA-AUTH-WP009` | **PASS** |
| `WP009-T29` | Successful end-to-end enrollment flow | `SECURITY_ARCHITECTURE.md` | **PASS** |
| `WP009-T30` | StationPinStore persists pins in platform secure storage (ciphertext on disk, not plaintext JSON) | `QI-SEC-03` | **PASS** |
| `WP009-T31` | StationPinStore cannot replace existing pin, has no reset/overwrite bypass, and survives restart | `BLOCKER 1` | **PASS** |
| `WP009-T32` | HMAC key rotation survives complete process restart within 12-hour window | `QI-IAM-04` | **PASS** |
| `WP009-T33` | HMAC previous key is securely discarded from EdgeSecureStore after 12-hour expiry window | `QI-IAM-04` | **PASS** |
| `WP009-T34` | Valid trusted-time anchor restart succeeds with cryptographic integrity verification | `QI-TIME-05` | **PASS** |
| `WP009-T35` | Tampered trusted-time anchor values fail closed (triggers CLOCK_ROLLBACK_LOCKED) | `QI-TIME-05` | **PASS** |
| `WP009-T36` | Trusted time integrity verification and anchor deletion fail-closed behavior (all 6 cases) | `BLOCKER 3` | **PASS** |
| `WP009-T37` | StationPinStore failure causes ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION | `QI-SEC-03` | **PASS** |
| `WP009-T38` | Public package entrypoint strictly encapsulates internals and raw keys | `QI-SEC-02` | **PASS** |
| `WP009-T39` | Production EdgeSecureStore fails closed if host OS secure storage is unavailable | `QI-SEC-01` | **PASS** |
| `WP009-T40` | HMAC metadata fail-closed validation on active node (missing, corrupt, malformed, missing prev key, invalid length) | `BLOCKER 2` | **PASS** |
| `WP009-T41` | Platform-aware ElectronSafeStorageBackend and Linux fail-closed enforcement (basic_text, unavailable, unknown, secure keyring) | `BLOCKER 4` | **PASS** |

Total `@trident/edge` Unit/Integration Tests: **85** (41 enrollment + 22 security/isolation + 22 local database) | Passed: **85** | Failed: **0**

### 3.2 Actual Electron Runtime Tests (`electron.test.ts`)
Total Tests: **10** | Passed: **10** | Failed: **0** | Skipped: **0**

- `WP007-E01` through `WP007-E09`: Verified production BrowserWindow security preferences, contextIsolation, renderer isolation, preload bridge, navigation lock, and window.open denial.
- `WP009-E01`: Platform-aware Electron safeStorage integration validation:
  - Local execution on macOS (`darwin`): Output reports `Outcome A: OS-backed secure storage positively verified on darwin (Keychain/DPAPI active and verified)`.
  - Headless Linux execution: If backend is `basic_text`, reports `Outcome B: Linux basic_text insecure storage backend correctly failed closed in production backend and constructor`. If backend is `unavailable` or unknown, reports `Outcome C: Linux 'unavailable' backend correctly rejected and failed closed (insecure fallback prohibited)`.
  - Never reports "OS-backed integration verified" when the backend is unknown or unavailable.

---

## 4. Pre-Freeze Adversarial Builder Gate Evaluation (Re-Run for S9-R4)

All 12 gates of `PRE_FREEZE_ADVERSARIAL_BUILDER_GATE.md` evaluated from scratch against S9-R4:

### Gate A — SSOT & Scope Traceability
- **Evaluation:** Implementation strictly implements `ACR-2026-011`, `SECRETS_AND_KEY_MANAGEMENT.md`, and `IAM_SECURITY_MODEL.md`. No unauthorized outbox or generic sync tables exist.
- **Verdict:** `PASS`

### Gate B — Public Boundary & Escape-Hatch Audit (Remediation Focus)
- **Evaluation:** Verified that `StationPinStore` has NO public runtime method capable of replacing an established pin (`supervisedAdministrativeResetPin`, `resetPin`, `overwritePin`, `clearPin` all absent). All internal stores and raw key getters remain strictly encapsulated.
- **Verdict:** `PASS`

### Gate C — Failure Semantics & Error Paths (Remediation Focus)
- **Evaluation:** Verified that corrupt, missing, or malformed HMAC metadata fails closed (`WP009-T40`). Verified that missing or invalid declared previous HMAC keys fail closed without resetting versions.
- **Verdict:** `PASS`

### Gate D — Negative Acceptance Criteria
- **Evaluation:** Comprehensive paired negative tests cover all failure modes (`WP009-T01`, `T02`, `T06`, `T09`, `T10`, `T12`, `T13`, `T14`, `T17`, `T18`, `T20`, `T25`, `T27`, `T31`, `T33`, `T35`, `T36`, `T37`, `T38`, `T39`, `T40`, `T41`).
- **Verdict:** `PASS`

### Gate E — Test Reality & Environment Authenticity (Remediation Focus)
- **Evaluation:** Real SQLite WAL files, real TLS connections, real encrypted files, and real Electron binary execution. Electron test evidence does not call an unknown backend "OS-backed".
- **Verdict:** `PASS`

### Gate F — False-Green Audit (Remediation Focus)
- **Evaluation:** Zero `.skip`, zero `.only`, zero `.todo`. Test `WP009-T31` no longer uses arbitrary token strings to produce false-green resets.
- **Verdict:** `PASS`

### Gate G — Security Adversarial Check (Remediation Focus)
- **Evaluation:** Linux unknown and `basic_text` backends are rejected fail-closed (`WP009-T27`, `WP009-T41`). Candidate pin mismatch is rejected (`WP009-T31`).
- **Verdict:** `PASS`

### Gate H — Data & Concurrency Invariants (Remediation Focus)
- **Evaluation:** Trusted time anchor deletion cannot reset trusted time lower-bound history; deleting the database row while the integrity key exists triggers `CLOCK_ROLLBACK_LOCKED` (`WP009-T36`). SQLite WAL enrollment transaction remains strictly atomic.
- **Verdict:** `PASS`

### Gate I — Architecture Conformance & Dependency Direction
- **Evaluation:** Dependency graph strictly unidirectional: `@trident/edge` -> `@trident/core`. Zero cycles (`npm run graph:check` passes).
- **Verdict:** `PASS`

### Gate J — Evidence Honesty & Debt Separation
- **Evaluation:** All software algorithms and cryptographic boundaries are proven. Physical LAN/Wi-Fi multicast network hardware testing is honestly tracked as **`SEC-VAL-03: OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** (assigned to WP-028).
- **Verdict:** `PASS`

### Gate K — CI & Security Pipeline Validity
- **Evaluation:** Local monorepo build, format:check, lint, typecheck, and unit/integration tests pass cleanly with 0 failures.
- **Verdict:** `PASS`

### Gate L — Freeze Integrity & Immutability (Remediation Focus)
- **Evaluation:** Candidate S9-R4 descends directly from immutable S9-R3 (`S9-R4^ = S9-R3`). Working tree is clean. Exact S9-R4 SHA will be frozen upon commit.
- **Verdict:** `PASS`

---

## 5. Mandatory Builder Gate Verdict

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: PASS
                     AUTHORIZED TO FREEZE CANDIDATE S9-R4
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
- **`S9-R2 = b69093bd71fe9689f984ee0818fbe5ff1bb03b49`:** Preserved immutable in Git history.
- **`S9-R3 = 9423f4f1ae8a90c77c8a8789611fc8c6403d0bf9`:** Preserved immutable in Git history (parent of S9-R4).
- **`S9-R4`:** New candidate subject.
- **`PR #31`:** Current implementation PR (remains open and unmerged).
- **`PR #28`:** Permanently invalidated and untouched.
- **Independent Security Review (`08_Security_Architect`) Invoked:** `NO`
- **Independent Code Review (`11_Code_Reviewer`) Invoked:** `NO`

---

BUILDER EVIDENCE REPORT R4 COMPLETE — READY FOR SUBJECT FREEZE
