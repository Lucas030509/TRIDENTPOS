# ARCHITECTURE CHANGE REQUEST: WP-009 EDGE ENROLLMENT & TRUST BOOTSTRAP DATA AUTHORITY, KEY LIFECYCLE, AND TRANSACTION INVARIANTS

> [!NOTE]
> **ACR-2026-011 APPROVED / MERGED / CANONICAL ON MAIN — G9**
> 
> This document constitutes a formal Architecture Change Request under EAAF v1.2.0. Its contents have been explicitly approved by the Product Owner (POA11) and merged into canonical main under G9 (`0e50fe12ba7a95638c8efe57d4cd9c598b56daa9`).

**ID:** `ACR-2026-011`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `01_Solution_Architect — ACR-2026-011 GOVERNANCE SYNTHESIS AUTHOR`  
**Clarification Inputs:** `03_Data_Architect` (ED9), `08_Security_Architect` (ES9C), and EAAF Coordinator Synthesis Corrections  
**Date:** `2026-09-11`  
**Status:** `ACR-2026-011 APPROVED / MERGED / CANONICAL ON MAIN — G9`  
**Base Commit:** `bb44f35bbe459ae86869b541e42dea12fc8173f8` (`G8`)  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `ARCHITECTURE CLARIFICATION & SSOT GOVERNANCE SYNTHESIS (REMEDIATION R1)`  

---

## 1. Governance Affirmations & Lineage

This Architecture Change Request constitutes the authoritative governance synthesis formulated by the Solution Architect from the architectural evaluations of the Data Architect (`ED9 = 469e30d07e4ea3e18bb9c22e1c7089f37b1dc560`), the Security Architect (`ES9C = c5dbd25b977d8a2cc54da3f21a888bf07dbb7cbc`), and the formal remediation directives issued following the EAAF Coordinator Quick Integrity check of initial proposal GA11 (`c018ac9cc3528d93af741cd997d5355b86ecd5e8`).

The following fundamental governance invariants are affirmed:
1. **Zero Functional Modifications:** No restaurant domain business logic, workflow, or user capability is altered.
2. **Product Owner Neutrality Preserved:** All nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`.
3. **No Retroactive Authority:** No unapproved implementation behavior from candidate S9/S9-R1 is grandfathered into SSOT.
4. **Cloud `stations` Authority Preserved:** Cloud PostgreSQL `public.stations` remains the canonical corporate fleet registry governed by WP-006. Edge SQLite maintains local floor authorization and credentials without overriding corporate fleet authority.
5. **Zero Scope Creep into WP-012:** Generic transactional synchronization mechanisms (`outbox_queue`, `IngestedIdempotencyLog`, WAN sync workers) remain under the exclusive architectural ownership of `WP-012`. WP-009 is confined to local floor trust bootstrap.
6. **Zero Weakening of Security Controls:** Private key storage is upgraded from unencrypted filesystem files to OS Keyring envelope encryption (`EdgeSecureStore`). Atomic rollback and clock rollback fail-closed controls are strictly codified.

---

## 2. Problem Statement & Quick Integrity Remediation Drivers

Pre-review evaluations of implementation candidate S9-R1 (PR #28) and the subsequent Quick Integrity check of proposal GA11 identified critical architectural deficiencies requiring definitive remediation:

1. **Absence of Topological Authority in Frozen SSOT:**  
   Neither `enrollment_tokens` nor `station_credentials` were assigned to an authoritative storage topology in `DATA_AUTHORITY_MATRIX.md`, and no SQLite DDL existed in `DATA_MODEL.md` Section 3.
2. **Atomic Enrollment & Forensic Audit Gap (`DATA-INV-WP009-01`):**  
   Initial candidate S9-R1 split token CAS and credential insertion across separate transactions. GA11 corrected the split transaction but incorrectly placed `TerminalEnrolada / SUCCESS` audit outside the transaction as a post-commit callback. Authoritative security governance mandates that `TerminalEnrolada / SUCCESS` is committed inside the same SQLite WAL transaction as credential insertion and token CAS (`ALL COMMIT OR NONE COMMIT`).
3. **Absence of Edge Local Security Audit Model:**  
   SSOT lacked an append-only, tamper-evident local forensic audit table on the Edge host to record critical security lifecycle events (such as terminal enrollment and clock rollback lockout) independently of WAN replication.
4. **Inverted Station Pinning Ordering:**  
   Initial proposals persisted the certificate pin after server enrollment. The corrected security sequence requires the client to persist the verified fingerprint in `StationPinStore` **BEFORE** transmitting secrets or identities over the second TLS connection (`PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION`).
5. **Invented Provisioning Manifest vs. Trusted Time Mechanics:**  
   Initial draft language referenced an unproven "cryptographic branch provisioning manifest". Canonical trusted time must be computed monotonically as `trustedEffectiveTime = Tcloud + monotonicElapsedSince(M0)` using `process.hrtime.bigint()`, anchored in SQLite WAL, with backward clock drift $> 5\text{ minutes}$ (300 seconds) triggering `CLOCK_ROLLBACK_LOCKED`.
6. **Inconsistent Timestamp Units:**  
   Initial proposals inadvertently introduced milliseconds (`Epoch ms`). All WP-009 governed security records must use `UNIX EPOCH SECONDS` uniformly.
7. **Unproven Station Type Check:**  
   GA11 froze an unproven enum `CHECK (station_type IN ('POS', 'KDS', 'COMANDERO', 'DISPLAY'))`. To prevent creating unauthorized taxonomy authority, this check is removed in favor of `station_type TEXT NOT NULL`.
8. **Omission of `EdgeSecureStore` in SSOT:**  
   GA11 failed to amend `SECRETS_AND_KEY_MANAGEMENT.md`. The internal secure store contract (OS Keyring, fail-closed, no plaintext files, prohibition of Linux `basic_text`) must be formally codified in SSOT.
9. **HMAC Key Validation and Rotation Contract:**  
   HMAC signing key must be validated as **exactly 32 bytes (256 bits)**. Arbitrary string injection is prohibited. Rotation semantics must retain the previous key for the 12-hour Station Token lifetime without an arbitrary 15-minute grace period.
10. **Token Signing Order & HTTP Failure Semantics:**  
    Token must be signed in memory before the atomic transaction to prevent burning tokens upon crypto failures. If HTTP response fails after successful commit, historical truth in database and audit remains committed.

---

## 3. Data Architecture Governance Resolutions

### 3.1 Data Authority Topology (`DATA_AUTHORITY_MATRIX.md`)
The following five (5) aggregates are formally governed in Section 1 of `DATA_AUTHORITY_MATRIX.md`:
- **`stations`:** Cloud PostgreSQL SoR | Cloud Writable | Edge SQLite Read Replica (`local_authorized_stations`) | Cloud → Edge Delta Sync | Cloud Wins (Soft Deauth) | Cloud Platform Core.
- **`edge_hosts`:** Hybrid: Protected Config (`edge-config.json` + OS Keyring) + Cloud PostgreSQL | Edge Host Local (Runtime) / Cloud (Tenancy) | Cloud Fleet Telemetry | Edge → Cloud Heartbeats | Cloud Wins | Edge Host / Cloud Platform Core.
- **`enrollment_tokens`:** Edge SQLite WAL SoR | Edge Host Local Console Only | None (LAN-local only) | Zero Cloud Sync | Atomic CAS Single-Winner | Edge Enrollment Subsystem.
- **`station_credentials`:** Edge SQLite WAL SoR (Local LAN Credential Authority) | Edge Host Local (Enrollment & Local Revocation) | Cloud PostgreSQL (Audit & Fleet Registry) | Edge → Cloud Enrollment Events (WP-012) / Cloud → Edge Revocation Deltas | Cloud Wins (Revocation) | Edge Security & IAM Subsystem.
- **`edge_security_audit`:** Edge SQLite WAL SoR | Edge Host Local (Runtime Security Subsystem) | None (Local Append-Only; WP-012 owns future WAN transport) | Zero Cloud Sync in WP-009 | Append-Only (Tamper-Evident Hash Chain) | Edge Security & Governance Subsystem.

### 3.2 Canonical Atomic Enrollment Transaction (`DATA-INV-WP009-01`)
Enrollment persistence on the Edge Host must execute inside a **single, atomic SQLite WAL transaction (`BEGIN IMMEDIATE ... COMMIT`)**:
```text
BEGIN IMMEDIATE

1. Re-read enrollment token
2. Validate tenant / branch / edge context
3. Validate expiration (now < expires_at in Unix epoch seconds)
4. Verify pairing secret in constant time
5. CAS consume token (UPDATE enrollment_tokens SET consumed_at = :now WHERE pairing_id = :id AND consumed_at IS NULL)
6. Insert station_credentials (station_id, organization_id, branch_id, station_code, station_type, station_public_key, enrolled_at)
7. Bind pairing_id -> station_id
8. Append durable local edge_security_audit (TerminalEnrolada / SUCCESS, sequence_number, hash-chain)

COMMIT
```

**Invariant `ALL COMMIT OR NONE COMMIT`:**
If credential insertion OR security audit insertion fails for ANY reason:
- Full `ROLLBACK` is executed.
- `consumed_at` remains `NULL` in `enrollment_tokens`.
- `station_credentials` row does not exist.
- `SUCCESS` audit row does not exist.
- No Station Token is returned to the client.
- The pairing token remains cleanly reusable until its expiration.

Authoritative audit success is established **strictly inside** this atomic transaction. Optional post-commit observability callbacks are purely secondary.

### 3.3 Relational Schema Formalization (`DATA_MODEL.md` & `DATA_DICTIONARY.md`)
The Edge SQLite WAL schema is updated with canonical DDL:
- **`enrollment_tokens`:** `pairing_id` (PK), `organization_id`, `branch_id`, `edge_id`, `secret_hash`, `expires_at` (Unix epoch seconds), `consumed_at` (Unix epoch seconds nullable), `created_at` (Unix epoch seconds).
- **`station_credentials`:** `station_id` (PK UUID), `organization_id`, `branch_id`, `station_code`, `station_type TEXT NOT NULL`, `station_public_key`, `enrolled_at` (Unix epoch seconds), `is_revoked`, `revoked_at` (Unix epoch seconds nullable). Composite unique constraint `(organization_id, branch_id, station_code)`. No `station_token_hash`.
- **`edge_security_audit`:** `event_id` (PK UUIDv4), `organization_id`, `branch_id`, `edge_id`, `station_id` (nullable), `event_type`, `severity`, `action`, `sequence_number`, `previous_record_hash`, `record_hash`, `metadata_json`, `created_at` (Unix epoch seconds). Append-only tamper-evident hash chain.

---

## 4. Security Architecture Governance Resolutions

### 4.1 Internal Secure Store (`EdgeSecureStore`)
Amends `SECRETS_AND_KEY_MANAGEMENT.md` to establish:
- **Scope:** Encapsulates Edge TLS private key, Station Token HMAC signing key, and trusted time integrity anchors.
- **Backing:** Backed by OS Keyring (`electron.safeStorage` in Electron production: Windows DPAPI, macOS Keychain, Linux Secret Service).
- **Prohibition of Insecure Backends:** Plaintext storage (`0600`) and Linux `basic_text` fallback are strictly prohibited.
- **Fail-Closed on Startup:** If secure encryption is unavailable or the key is corrupt/missing, the Edge Host must fail closed (`FAIL CLOSED`), log `EdgeTlsKeyMissingOrCorrupted`, and refuse to start HTTPS listeners. Silent key regeneration is strictly prohibited.

### 4.2 Station Token HMAC Key Contract & Lifecycle
- **Entropy & Size:** Exactly 32 bytes (256 bits) generated by CSPRNG (HS256). Constructor and factory strictly validate `key.length === 32`.
- **Isolation:** Key is cryptographically independent from the TLS private key.
- **Rotation Semantics:** Non-disruptive rotation retains `previousKey` in verification memory until the maximum expiration of all issued tokens (12 hours). Supervised emergency or shift-close rotation may intentionally invalidate prior keys. Generic 15-minute grace periods and automatic daily rotations are prohibited in WP-009.

### 4.3 Station Pin Ordering (`SEC-INV-WP009-02`)
The enrollment client must enforce the following strict sequential protocol:
1. Discover Edge candidate via mDNS.
2. Open unauthenticated zero-application-data TLS inspection probe.
3. Extract candidate certificate DER and calculate SHA-256 fingerprint.
4. Compare fingerprint in constant time against physical QR payload. Abort immediately on mismatch without revealing secrets.
5. Persist verified fingerprint in governed client `StationPinStore` (tamper-resistant platform storage).
6. **Invariant:** `PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION`.
7. ONLY AFTER pin persistence succeeds, open second TLS connection pinned to proven certificate (`ca: [provenCertDer]`).
8. ONLY THEN transmit `pairingId`, `pairingSecret`, and `stationPublicKey`.

### 4.4 Token Signing Order Pre-Transaction
To prevent burned tokens caused by signing failures after database consumption:
1. Validate request payload and trusted time.
2. Construct and sign the Station Token (HS256, 12h) in memory.
3. Enter atomic SQLite transaction (`DATA-INV-WP009-01`).
4. If signing fails, zero database mutation occurs. Token bytes are not valid or usable until transaction commits and HTTP 200 is returned.

### 4.5 HTTP Response Failure Semantics
If network transport fails during HTTP response delivery after the atomic SQLite transaction has committed:
- The enrollment transaction remains committed and durable.
- `TerminalEnrolada / SUCCESS` remains recorded in `edge_security_audit`.
- Historical database truth is NOT rolled back due to network transport failure.
- The client must follow governed recovery / re-enrollment handling.

### 4.6 Trusted Time & Clock Rollback Lockout
- **Monotonic Runtime Time:** Security elapsed-time decisions during process execution use `process.hrtime.bigint()`. When authenticated Cloud time $T_{cloud}$ is received at monotonic instant $M_0$:
  $$\text{trustedEffectiveTime} = T_{cloud} + \text{monotonicElapsedSince}(M_0)$$
- **Persisted Anchors:** SQLite WAL persists `lastKnownCloudTime`, `localWallTimeAtLastCloudSync`, `anchorVersion`, and integrity metadata in Unix epoch seconds.
- **Post-Restart Verification:** Persisted anchor acts as an absolute lower bound. If local wall clock retrocedes $> 5\text{ minutes}$ (300 seconds) against persisted anchors (`Date.now() / 1000 < lastKnownCloudTime - 300`), the Edge transitions to `CLOCK_ROLLBACK_LOCKED`, blocks pairing secret and token generation, and records a critical audit record `ClockRollbackDetected` with sensitive parameters redacted.
- **Bootstrap Requirement:** First secure bootstrap requires authenticated Cloud time; deriving trusted time from unvalidated local clock or invented manifests is prohibited.

---

## 5. Summary of Governed SSOT Files Amended

The following ten (10) SSOT architecture documents have been amended:
1. **`DATA_AUTHORITY_MATRIX.md`:** Added 5 explicit rows in Section 1 (`stations`, `edge_hosts`, `enrollment_tokens`, `station_credentials`, `edge_security_audit`) with proposal overlay notice.
2. **`DATA_MODEL.md`:** Added Section 3 SQLite WAL DDL for `enrollment_tokens`, `station_credentials` (removed unproven station-type check), and `edge_security_audit` (13 fields) with Unix epoch seconds.
3. **`DATA_DICTIONARY.md`:** Added dictionary definitions for attributes of `enrollment_tokens`, `station_credentials`, and `edge_security_audit`.
4. **`SECURITY_ARCHITECTURE.md`:** Updated Section 3.2 sequence diagram, pin-before-secret ordering, in-memory signing order, atomic transaction invariant (`DATA-INV-WP009-01`), HTTP failure semantics, and Section 10 trusted time.
5. **`IAM_SECURITY_MODEL.md`:** Updated Sections 4 and 5 with exact 32-byte HMAC key contract, rotation semantics, pin-before-secret ordering, monotonic `trustedEffectiveTime`, and clock rollback lockout.
6. **`SECRETS_AND_KEY_MANAGEMENT.md`:** Added `EdgeSecureStore` specification (Section 4), inventory entries, exact 32-byte HMAC key contract, and `StationPinStore`.
7. **`SECURITY_CONTROL_MATRIX.md`:** Updated Section 3 with refined `SEC-VAL-03` debt disposition and enrollment audit control.
8. **`IMPLEMENTATION_PLAN.md`:** Updated WP-009 outputs, acceptance criteria, and detailed 27 test obligations with zero `.skip`/`.only`/fake providers.
9. **`ARCHITECTURE_CHANGE_REQUEST_WP009_TRUST_BOOTSTRAP.md`:** Authoritative ACR specification synthesized under remediation R1.
10. **`evidence/ACR-2026-011_GOVERNANCE_SYNTHESIS.md`:** Governance synthesis evidence recording Quick Integrity failure and remediation reconciliation.

---

## 6. Implementation Directive for Builder

Upon Product Owner approval of this ACR:
1. The Builder (`16_Native_Edge_Developer`) is authorized to produce remediation candidate **`S9-R2`** on `feature/wp-009-edge-enrollment-trust-bootstrap`.
2. S9-R2 must strictly fulfill all 27 test obligations specified in `IMPLEMENTATION_PLAN.md` WP-009.
3. PR #28 must not be merged until formal gate reviews are completed.

---

## 7. Approval Block

```text
====================================================================================================
PRODUCT OWNER GOVERNANCE APPROVAL
====================================================================================================
[X] APPROVED
[ ] REJECTED / REVISION REQUIRED

Product Owner: Product Owner (via EAAF v1.2.0)      Date: 2026-09-11
====================================================================================================
```
