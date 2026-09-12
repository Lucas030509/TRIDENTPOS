# WP-009 INDEPENDENT SECURITY ARCHITECTURE REVIEW REPORT

**Review Subject:** `S9-R5 = 22d2cecbcb5572af29041326b681719fa04bf424`  
**Reviewer Agent:** `08_Security_Architect`  
**Date:** 2026-09-11  
**Framework:** `EAAF v1.2.0` (Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Governance Baseline:** `G9C = c10cfa51f0b6990bf85c14525477ae789224c996`  
**Review Branch:** `review/wp-009-s9-r5-security`  
**Implementation PR:** PR #31 (Open, unmerged)  

---

## 1. Scope & Verification Methodology

As `08_Security_Architect`, an autonomous, adversarial audit of the exact frozen subject `S9-R5` (`22d2cecbcb5572af29041326b681719fa04bf424`) was conducted. No assumptions were made based on Builder assertions. The code and test execution were inspected directly against the governing architecture documents:
- `RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC_v1.0_BASELINE.md`
- `SECURITY_ARCHITECTURE.md` (Sections 3.2, 4, 9)
- `SECRETS_AND_KEY_MANAGEMENT.md`
- `IAM_SECURITY_MODEL.md`
- `ACR-2026-011` / `WP-009` Governed Specification

---

## 2. Independent Audit of Governed Security Invariants (Items 1–41)

| Item # | Governed Invariant | Implementation Verification | Security Verdict |
|---|---|---|---|
| **1** | **Atomic Enrollment Transaction** | Inspected `packages/edge/src/enrollment/enrollment-server.ts`. The CAS update on `pairing_tokens`, insertion into `station_credentials`, and audit log insertion execute in a single atomic SQLite transaction via `db.transaction()`. | **PASS** |
| **2** | **CAS Token Consumption** | Verified CAS SQL: `UPDATE pairing_tokens SET consumed_at = ? WHERE pairing_id = ? AND consumed_at IS NULL`. Throws `EnrollmentAlreadyConsumedError` if `info.changes === 0`. | **PASS** |
| **3** | **Credential + Audit Rollback** | Verified that any injection of failure in credential storage or audit logging rolls back the transaction, leaving `consumed_at` NULL and no credentials persisted (`WP009-T08`, `T09`, `T10`, `T11`). | **PASS** |
| **4** | **TerminalEnrolada / SUCCESS Audit Semantics** | In `enrollment-server.ts`, successful enrollment emits action `ENROLLMENT_SUCCESS` with status `SUCCESS` and terminal metadata. | **PASS** |
| **5** | **Cross-Tenant Rejection** | Rejects if client payload `organization_id !== this.#organizationId` (`EnrollmentContextMismatchError`, `WP009-T12`). | **PASS** |
| **6** | **Cross-Branch Rejection** | Rejects if QR payload `branch_id !== this.#branchId` (`EnrollmentContextMismatchError`, `WP009-T13`). | **PASS** |
| **7** | **Cross-Edge Rejection** | Rejects if QR payload `edge_id !== this.#edgeId` (`EnrollmentContextMismatchError`, `WP009-T14`). | **PASS** |
| **8** | **Pairing Token Expiry** | Verified `token.expires_at < effectiveTime` fails closed with `EnrollmentExpiredError`. | **PASS** |
| **9** | **Constant-Time Secret Comparison** | `crypto.timingSafeEqual` is strictly enforced with identical buffer lengths in `timingSafeSecretCompare`. | **PASS** |
| **10** | **Zero-Data Initial TLS Inspection** | Station client performs raw SNI probe writing zero application bytes (`getLastProbeApplicationBytesWritten() === 0`) to extract certificate DER. | **PASS** |
| **11** | **Exact QR Fingerprint Comparison** | Compares extracted certificate SHA-256 fingerprint against QR payload via constant-time verification. | **PASS** |
| **12** | **Pin Persistence BEFORE Secret Disclosure** | Station pin is committed to `StationPinStore` prior to opening the second TLS connection or transmitting secrets (`WP009-T05`). | **PASS** |
| **13** | **Second Pinned TLS Connection** | Second TLS connection strictly sets `ca: [provenCertDer]` and pins host identity. | **PASS** |
| **14** | **StationPinStore Encrypted Persistence** | Persists encrypted ciphertext on disk (`station_pins.enc`), verified to contain zero plaintext fingerprints or tenant identifiers (`WP009-T30`). | **PASS** |
| **15** | **StationPinStore Immutability** | Existing pin cannot be replaced; mismatched fingerprints fail closed (`WP009-T31`). | **PASS** |
| **16** | **Zero Runtime PIN Reset/Overwrite** | Verified absence of `supervisedAdministrativeResetPin`, `resetPin`, `overwritePin`, or `clearPin` on `StationPinStore`. | **PASS** |
| **17** | **Zero Public Backend Substitution** | Public constructor accepts only `StationPinStoreOptions { readonly storeFilePath: string }`. Options containing `backend`, `storageBackend`, etc., throw `StationPinStoreError`. Positional argument injection is blocked. | **PASS** |
| **18** | **Public API Escape-Hatch Audit** | `@trident/edge` and `@trident/edge/enrollment` export zero test doubles, zero internal key handles, zero raw storage classes (`EdgeSecureStore`, `ElectronSafeStorageBackend`, `createTestStationPinStore` are unexported). | **PASS** |
| **19** | **Electron safeStorage Enforcement** | Uses native OS keyring (DPAPI on Windows, Keychain on macOS, Secret Service on Linux). Verified in real Electron runtime (`WP009-E01`). | **PASS** |
| **20** | **Linux basic_text Rejection** | Prohibits `basic_text` fallback; fails closed with explicit error in `ElectronSafeStorageBackend`, `EdgeSecureStore`, and `StationPinStore` (`WP009-T27`). | **PASS** |
| **21** | **Linux Unknown/Unavailable Backend Rejection** | On Linux, backends outside the allowlist (`gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6`) fail closed (`WP009-T41`). | **PASS** |
| **22** | **HMAC Key Exact 32 Bytes** | `validateHmacKeyLength` enforces exact 32 bytes; shorter or longer keys are rejected (`WP009-T20`). | **PASS** |
| **23** | **HMAC Previous-Key Persistence** | Active and previous HMAC keys are stored encrypted in `EdgeSecureStore` and restored across restart. | **PASS** |
| **24** | **Restart Survival Inside 12h Window** | When metadata declares an unexpired previous key, both active and previous keys reload seamlessly without resetting version to 1 (`WP009-T32`). | **PASS** |
| **25** | **Expiry Purge Behavior** | Previous HMAC key is discarded once the 12-hour expiration window lapses (`WP009-T33`). | **PASS** |
| **26** | **Trusted-Time Monotonic Calculation** | Uses `process.hrtime.bigint()` for elapsed time calculations, immune to system clock manipulations within process life (`WP009-T23`). | **PASS** |
| **27** | **Trusted-Time Anchor HMAC Integrity** | Anchors are signed with HMAC-SHA256 (`trusted_time_anchor_hmac_key`). Tampered anchors trigger `CLOCK_ROLLBACK_LOCKED` (`WP009-T35`). | **PASS** |
| **28** | **Anchor Deletion Fail-Closed** | Deleting anchor row while HMAC key exists is detected as tampering; triggers `CLOCK_ROLLBACK_LOCKED` fail-closed (`WP009-T36`). | **PASS** |
| **29** | **> 5 Minute Wall-Clock Rollback Lock** | Backward jump > 300 seconds triggers system lock (`ClockRollbackLockError`) and emits critical audit event (`WP009-T25`, `T26`). | **PASS** |
| **30** | **TLS Private-Key Persistence** | Node TLS private key is stored encrypted in `EdgeSecureStore` and reloaded on reboot (`WP009-T16`). | **PASS** |
| **31** | **Zero Silent TLS Key Regeneration** | Missing or corrupt private key causes startup abort (`EdgeTlsKeyMissingOrCorruptedError`, `WP009-T17`, `T18`). | **PASS** |
| **32** | **Zero Raw Secret/Private-Key Escape** | Private keys and symmetric keys remain strictly in private class fields (`#privateKey`, `#backend`). | **PASS** |
| **33** | **Zero station_token_hash Persistence** | Verified schema: `station_credentials` table has NO `station_token_hash` column (`WP009-T22`). | **PASS** |
| **34** | **station_type Unrestricted TEXT NOT NULL** | Schema defines `station_type TEXT NOT NULL` without premature enum checks. | **PASS** |
| **35** | **Unix Epoch Seconds** | All timestamps utilize whole seconds (`Math.floor(Date.now() / 1000)`). | **PASS** |
| **36** | **Zero Generic WP-009 Sync/Outbox** | No outbox or sync infrastructure present in WP-009 boundary (`WP009-T28`). | **PASS** |
| **37** | **Sensitive Audit Redaction** | `redactSensitiveData` masks secrets, tokens, private keys, and HMAC signatures in audit logs (`WP009-T26`). | **PASS** |
| **38** | **Test Authenticity / Zero False-Greens** | Verified zero `.skip`, `.only`, or `.todo` in test files. Real SQLite WAL, real sockets, real crypto used. | **PASS** |
| **39** | **All Governed Original WP-009 Tests** | WP009-T01 through WP009-T29 pass unconditionally. | **PASS** |
| **40** | **All Remediation Tests Through WP009-T42** | WP009-T30 through WP009-T42 pass unconditionally. `WP009-T42` conclusively proves absence of public backend injection. | **PASS** |
| **41** | **Actual Electron Runtime Evidence** | `WP007-E01` through `WP007-E09` and `WP009-E01` executed in real Electron binary (macOS Keychain). Positive encryption/decryption round-trip verified, backend injection blocked. | **PASS** |

---

## 3. Security Debt & Protected Decisions Audit

### 3.1 Security Debt SEC-VAL-03
- **Status:** **`OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`**
- **Assessment:** Software cryptographic and mDNS advertising contracts are verified in unit and Electron tests. Physical Wi-Fi network hardware validation remains governed under future deployment work package WP-028. This item is **NOT closed**.

### 3.2 Protected Product Owner Decisions
- The nine protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly **`PENDING PO DECISION`**. No decisions were usurped.

---

## 4. Final Security Verdict

**VERDICT: PASS — NO BLOCKING SECURITY FINDINGS**

**Blocking Findings Count:** 0
