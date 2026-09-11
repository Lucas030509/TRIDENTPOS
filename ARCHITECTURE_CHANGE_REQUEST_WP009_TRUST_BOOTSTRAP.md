# ARCHITECTURE CHANGE REQUEST: WP-009 EDGE ENROLLMENT & TRUST BOOTSTRAP DATA AUTHORITY, KEY LIFECYCLE, AND TRANSACTION INVARIANTS

**ID:** `ACR-2026-011`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `03_Data_Architect` & `08_Security_Architect` — Joint Architecture Synthesis  
**Date:** `2026-09-11`  
**Status:** `PROPOSED / PENDING PRODUCT OWNER APPROVAL`  
**Base Commit:** `bb44f35bbe459ae86869b541e42dea12fc8173f8` (`G8`)  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `ARCHITECTURE CLARIFICATION & SSOT GOVERNANCE SYNTHESIS`  

---

## 1. Governance Affirmations & Invariants

This Architecture Change Request is a joint Data and Security Architecture synthesis formulated from independent clarification evaluations (`ED9 = 469e30d07e4ea3e18bb9c22e1c7089f37b1dc560` and `ES9C = c5dbd25b977d8a2cc54da3f21a888bf07dbb7cbc`) to establish the canonical governance baselines for `WP-009: Edge Enrollment & Trust Bootstrap Protocol`.

The following invariants are formally affirmed:
1. **Zero Functional Modifications:** No product feature, functional capability, or restaurant business workflow is added, modified, or removed.
2. **Product Owner Neutrality Preserved:** All nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`.
3. **No Retroactive Authority:** No unapproved implementation behavior from candidate S9/S9-R1 is grandfathered into SSOT without explicit architectural justification.
4. **Cloud `stations` Authority Preserved:** Cloud PostgreSQL `public.stations` remains the canonical corporate fleet registry governed by WP-006. Edge SQLite does not duplicate or override corporate station authority.
5. **Zero Scope Creep into WP-012:** Generic transactional sync mechanisms (`OutboxQueue`, `IngestedIdempotencyLog`, WAN sync workers) remain under the exclusive architectural and migration ownership of `WP-012`. WP-009 is confined to local floor trust bootstrap.
6. **Zero Weakening of Security Controls:** No security control is downgraded. Private key storage is upgraded from unencrypted filesystem files to OS Keyring envelope encryption. Atomic rollback and clock rollback fail-closed controls are strictly codified.

---

## 2. Problem Statement & Ambiguities Identified in S9-R1

Pre-review evaluations of implementation candidate S9-R1 (PR #28) identified critical architectural gaps and ambiguities:

1. **Absence of Topological Authority in Frozen SSOT:**  
   Neither `enrollment_tokens` nor `station_credentials` were explicitly assigned to an authoritative storage topology in `DATA_AUTHORITY_MATRIX.md`, and no SQLite DDL existed in `DATA_MODEL.md` Section 3.
2. **Non-Atomic Transaction Vulnerability (`CAS vs INSERT Split`):**  
   S9-R1 executed pairing token Compare-And-Swap (CAS) consumption and station credential persistence in two separate database transactions. If credential insertion failed, the pairing token remained irreversibly consumed (`consumed_at` populated), permanently locking out the physical terminal and burning the QR code.
3. **Multi-Tenant Context Omission:**  
   S9-R1 omitted `organization_id` and `branch_id` from the local `station_credentials` SQLite table, creating severe risks of cross-tenant and cross-branch credential replay.
4. **Ungoverned Persistence Escape Hatch:**  
   `EdgeDatabaseService` exposed a public method `getEnrollmentPersistence()`, allowing any caller in the Edge process to insert station credentials and mutate tokens without passing through cryptographic QR or TLS verification layers.
5. **Insecure Private Key Storage & Silent Regeneration Hazard:**  
   Edge TLS private keys were written in plaintext with POSIX mode `0600` (which is ignored by Node.js on Windows). If the key was deleted or missing, S9-R1 silently generated a new key, instantly invalidating all enrolled floor stations via certificate pin mismatch.
6. **Volatile In-Memory Station Token HMAC Key:**  
   The HMAC-SHA256 Station Token signing key was generated randomly in memory on server startup, causing all issued 12-hour Station Tokens to become invalid upon any process restart or crash.
7. **False-Success Audit Sequencing:**  
   S9-R1 emitted `TerminalEnrolada / SUCCESS` audit events **before** the database transaction committed, writing false-positive enrollment records even when token consumption failed.
8. **Missing Trusted Time & Clock Rollback Enforcement:**  
   S9-R1 relied on `Date.now()` without monotonic counters (`process.hrtime.bigint()`) or `lastKnownCloudTime` anchoring, failing to implement the frozen clock-rollback lockout mandated by `IAM_SECURITY_MODEL.md` §5.

---

## 3. Data Architecture Governance Resolutions

### 3.1 Data Authority Topology (`DATA_AUTHORITY_MATRIX.md`)
The following four (4) aggregates are formally added to Section 1 of `DATA_AUTHORITY_MATRIX.md`:
- **`stations`:** Cloud PostgreSQL SoR | Cloud Writable | Edge SQLite Read Replica (`local_authorized_stations`) | Cloud → Edge Delta Sync | Cloud Wins (Soft Deauth) | Cloud Platform Core.
- **`edge_hosts`:** Hybrid: Protected Config (`edge-config.json` + OS Keyring) + Cloud PostgreSQL | Edge Host Local (Runtime) / Cloud (Tenancy) | Cloud Fleet Telemetry | Edge → Cloud Heartbeats | Cloud Wins | Edge Host / Cloud Platform Core.
- **`enrollment_tokens`:** Edge SQLite WAL SoR | Edge Host Local Console Only | None (LAN-local only) | Zero Cloud Sync | Atomic CAS Single-Winner | Edge Enrollment Subsystem.
- **`station_credentials`:** Edge SQLite WAL SoR (Local LAN Credential Authority) | Edge Host Local (Enrollment & Local Revocation) | Cloud PostgreSQL (Audit & Fleet Registry) | Edge → Cloud Enrollment Events (WP-012) / Cloud → Edge Revocation Deltas | Cloud Wins (Revocation) | Edge Security & IAM Subsystem.

### 3.2 Atomic Enrollment Transaction Invariant (`DATA-INV-WP009-01`)
Enrollment persistence on the Edge Host must execute inside a **single, atomic SQLite WAL transaction (`BEGIN IMMEDIATE ... COMMIT`)**:
```text
ALL COMMIT OR NONE COMMIT
1. Validate token status (consumed_at IS NULL AND now < expires_at).
2. CAS update: UPDATE enrollment_tokens SET consumed_at = :now ...
3. Insert credential: INSERT INTO station_credentials ...
4. Link pairing session to station_id.

FAIL-CLOSED INVARIANT:
If credential insertion fails for ANY reason, the transaction ROLLS BACK.
consumed_at MUST REMAIN NULL, allowing clean retry before expiration.
```

### 3.3 Relational Schema Formalization (`DATA_MODEL.md` Section 3)
The Edge SQLite logical schema is updated with canonical DDL for `enrollment_tokens` and `station_credentials` enforcing:
- Mandatory `organization_id` and `branch_id`;
- Unique constraint `uq_station_credentials_tenant_branch_code (organization_id, branch_id, station_code)`;
- Exclusion of `station_token_hash` from durable credentials (separating device identity from shift tokens);
- Strict check constraints on station types and revocation status.

---

## 4. Security Architecture Governance Resolutions

### 4.1 Edge TLS Private Key Protection & Fail-Closed Invariant
- **Encryption at Rest:** Plaintext private key files on disk are strictly prohibited. The private key must be encrypted at rest using OS-bound protection: Windows DPAPI, macOS Keychain, or Linux Secret Service / Kernel Keyring.
- **Prohibition of Silent Regeneration (`SEC-INV-WP009-01`):**  
  If the Edge Host has been initialized and its TLS key is missing, corrupted, or unreadable, the Edge Host **MUST FAIL CLOSED ON STARTUP**, emit `EdgeTlsKeyMissingOrCorrupted`, and refuse to start HTTPS listeners. Silent key regeneration is strictly prohibited.

### 4.2 Local Station Token HMAC Key Contract
- Must be generated via CSPRNG with exactly 256 bits (32 bytes) of entropy.
- Must persist across Edge process restarts and OS reboots in protected storage (OS Keyring / Encrypted Local Vault).
- Must be cryptographically independent from the Edge TLS private key.
- Public constructor options must strictly validate key buffers ($\ge 32\text{ bytes}$); arbitrary strings are prohibited.

### 4.3 Station Pin Persistence & Removal of `initialPin`
- Station clients (POS, KDS, comanderos) must persist `pinnedFingerprint` in platform-level tamper-resistant storage (Electron encrypted store, Android Keystore, iOS Keychain).
- The `initialPin` option is prohibited in production to prevent bypassing physical QR verification.
- Resetting a pinned certificate requires an authenticated physical supervisor reset on the terminal.

### 4.4 Trusted Time & Clock Rollback Lockout
- In-memory pairing TTL is enforced using monotonic counters (`process.hrtime.bigint()`).
- Local wall clock is compared against persisted `lastKnownCloudTime`.
- If backward clock drift $> 5\text{ minutes}$ is detected, the Edge Host transitions to `CLOCK_ROLLBACK_LOCKED`, blocks pairing secret generation and Station Token issuance, and emits a `CRITICAL` audit event `ClockRollbackDetected`.

### 4.5 Governed Execution Order & Audit Sequencing
1. Unauthenticated TLS probe connects with zero application bytes sent; extracts certificate DER; closes socket.
2. Station verifies fingerprint in constant time against physical QR payload. Mismatch aborts immediately.
3. Station establishes pinned HTTPS connection with `ca: [provenCertDer]`.
4. Edge validates payload, trusted time, and constant-time secret comparison.
5. Edge executes atomic SQLite transaction (`DATA-INV-WP009-01`).
6. Edge signs Station Token (HS256, 12h).
7. **Forensic Audit Emission:** Edge emits `TerminalEnrolada / SUCCESS` fail-closed **ONLY AFTER transaction commit and token signing**.
8. Return HTTP 200 to station; station persists pinned fingerprint.

### 4.6 Elimination of Policy-Weakening Public Overrides
The following options are restricted:
- `tokenTtlSeconds`: Prohibited public override; hardcoded to 12 hours (43200s).
- `PairingPayloadInput.pairingSecret`: Prohibited public override; always generated via 256-bit CSPRNG.
- `PairingPayloadInput.ttlSeconds`: Validated $\le 600\text{ seconds}$.
- `initialPin`: Prohibited in production.
- `customCa`: Test-only; prohibited in production.
- `onAuditEvent`: Mandatory default local audit sink required.

---

## 5. Summary of SSOT Document Amendments

The following governed documents are amended to reflect this synthesis:
1. `DATA_AUTHORITY_MATRIX.md`: Added 4 explicit rows in Section 1.
2. `DATA_MODEL.md`: Added Section 3 DDL for `enrollment_tokens` and `station_credentials`.
3. `DATA_DICTIONARY.md`: Added attributes for `enrollment_tokens` and `station_credentials`.
4. `SECURITY_ARCHITECTURE.md`: Amended Section 3.2 with key encryption, no silent regen, TLS probe invariant, and post-commit audit.
5. `IAM_SECURITY_MODEL.md`: Amended Sections 4 and 5 with persistent HMAC key, trusted time contract, and clock rollback lockout.
6. `SECURITY_CONTROL_MATRIX.md`: Updated `SEC-VAL-03` with hardware LAN closure assigned to WP-028.
7. `IMPLEMENTATION_PLAN.md`: Updated WP-009 acceptance criteria with atomic transaction, encapsulated persistence, trusted time, and removal of public overrides.

---

## 6. Implementation & Builder Directive

Upon Product Owner approval of this ACR:
1. The Builder (`16_Native_Edge_Developer`) is authorized to produce remediation candidate **`S9-R2`** on `feature/wp-009-edge-enrollment-trust-bootstrap`.
2. S9-R2 must conform strictly to `DATA-INV-WP009-01` (composite atomic transaction in `runInTransaction`), include `organization_id` and `branch_id`, encapsulate `EnrollmentPersistence` as module-internal, encrypt keys via OS Keyring, enforce trusted time, and emit `TerminalEnrolada` post-commit.
3. S9-R2 must not implement `outbox_queue` or generic sync tables (reserved for WP-012).

---

## 7. Approval Block

```text
====================================================================================================
PRODUCT OWNER GOVERNANCE APPROVAL
====================================================================================================
[ ] APPROVED
[ ] REJECTED / REVISION REQUIRED

Product Owner: _______________________________      Date: ________________________
====================================================================================================
```
