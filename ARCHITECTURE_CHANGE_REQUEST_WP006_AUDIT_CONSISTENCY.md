# ARCHITECTURE CHANGE REQUEST: WP-006 AUDIT ARCHITECTURE CONSISTENCY REMEDIATION

**ID:** `ACR-2026-007`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `01_Solution_Architect — WP-006 CROSS-ARCHITECTURE CONSISTENCY REMEDIATION AUTHOR`  
**Date:** `2026-09-04`  
**Status:** `READY FOR ROLE-SEPARATED BASELINE REVIEW`  
**Base Commit:** `5a52fd674e9afaf15f9c5f12c695d6ce09bd25b7`  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `PRE-IMPLEMENTATION CONSISTENCY REMEDIATION & AUDIT INTEGRITY SPECIFICATION`  

---

## 1. Problem Statement

Prior to activating `13_Backend_Developer` (Builder) for Work Package `WP-006: Tamper-Evident Security Logging & Cloud Audit Trail`, this pre-implementation consistency gate was executed across the frozen architectural baselines (`IMPLEMENTATION_PLAN.md`, `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `SECURITY_LOGGING_AND_MONITORING.md`, `SECURITY_ARCHITECTURE.md`, `SECURITY_RISKS.md`, and `DATA_PROTECTION_AND_PRIVACY.md`).

The audit identified two critical contradictions and four architectural boundaries requiring formal governance:
1. **Contradiction A (Undefined WP-006 Data Objects):** `IMPLEMENTATION_PLAN.md` assigns `audit_log_events` and `security_telemetry_events` to `WP-006`, but neither table was defined in `DATA_MODEL.md` or `DATA_DICTIONARY.md`. Leaving schemas to builder interpretation violates EAAF Section 2 invariants.
2. **Contradiction B (Nonexistent Source Section Reference):** `IMPLEMENTATION_PLAN.md` cited `SECURITY_LOGGING_AND_MONITORING.md Sec. 2, 3`, whereas the frozen document contained only Section 1 and Section 2.
3. **Cloud vs. Edge Boundary Ambiguity:** `SECURITY_LOGGING_AND_MONITORING.md` defines a two-layer tamper-evident model (Layer 1: Edge SQLite hash chain; Layer 2: Cloud remote checkpoint / immutable ingestion). Because Edge SQLite (`WP-008`) and Outbox sync (`WP-012`/`WP-013`) do not yet exist, `WP-006` cannot implement Edge components. The architectural boundary must explicitly restrict `WP-006` to Cloud audit logging, schema persistence, checkpoint representation, verification primitives, and pre-persistence redaction.
4. **SEC-VAL-06 Ownership & Staging:** The current validation requirement for `SEC-VAL-06` mandates "direct database alteration simulation verifying hash-chain breakage detection during sync". This cannot be validated in `WP-006` without Edge SQLite and sync infrastructure. A false "PASS" in `WP-006` using mocks would violate governance integrity. `SEC-VAL-06` must be staged into `SEC-VAL-06A` (Cloud integrity) and `SEC-VAL-06` (end-to-end Edge alteration and sync), remaining `OPEN` until `WP-013`.
5. **Append-Only / Immutability Trust Boundary:** Previous planning language loosely referred to an "immutable audit table". Absolute immutability in relational databases is impossible against database superusers or cloud host administrators. The precise term **"TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY"** must be codified, backed by PostgreSQL triggers and restricted application role grants.
6. **Multi-Tenant Relational Safety & Automatic Redaction:** The schema must enforce composite tenant foreign keys `(organization_id, id)` across `branches`, `users`, and `stations`, combined with `ENABLE + FORCE ROW LEVEL SECURITY` and `current_app_org_id()`. Furthermore, recursive, case-insensitive redaction of credentials and PII masking must be enforced **before** any persistence or external emission (`REDACT BEFORE ANY EXTERNAL SINK`).

---

## 2. Frozen Sources Inspected

The following authoritative architectural baselines were inspected:
- `DATA_MODEL.md` (Document ID `ARCH-MDL-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `DATA_DICTIONARY.md` (Document ID `ARCH-DIC-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `DATA_ARCHITECTURE.md` (Document ID `ARCH-DAT-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `DATA_PROTECTION_AND_PRIVACY.md` (Document ID `ARCH-PRV-001`, Version `1.1 APPROVED / FROZEN — 2026-09-03`)
- `SECURITY_LOGGING_AND_MONITORING.md` (Document ID `ARCH-LOG-001`, Version `1.2 APPROVED / FROZEN — 2026-09-03`)
- `SECURITY_ARCHITECTURE.md` (Document ID `ARCH-SEC-001`, Version `1.2 APPROVED / FROZEN — 2026-09-03`)
- `SECURITY_CONTROL_MATRIX.md` (Document ID `ARCH-SCM-001`, Version `1.0 APPROVED / FROZEN — 2026-09-03`)
- `SECURITY_RISKS.md` (Document ID `ARCH-SRSK-001`, Version `1.2 APPROVED / FROZEN — 2026-09-03`)
- `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Document ID `ARCH-OFF-001`, Version `1.1 APPROVED / FROZEN — 2026-09-03`)
- `IMPLEMENTATION_PLAN.md` (Document ID `ARCH-PLN-001`, Version `1.0 APPROVED / FROZEN — 2026-09-03`)
- `project-manifest.json`

Repository SSOT prevails over narrative planning assumptions.

---

## 3. Detailed Remediation Decisions

### 3.1 Contradiction A: Canonical DDL & Data Objects for WP-006
`WP-006` owns two primary data objects in Cloud PostgreSQL, defined with complete type, nullability, constraint, classification, and index specifications:

#### 1. `audit_log_events` (Cloud Audit Trail)
- **Purpose:** Immutable business and operational audit log for compliance, forensically verifiable event history, and remote checkpointing.
- **Classification:** `CONFIDENTIAL / COMPLIANCE_AUDIT`.
- **Retention:** `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED (SEC-VAL-11)`.
- **Append-Only Contract:** `TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY`. Disallows `UPDATE`, `DELETE`, and `TRUNCATE` via PostgreSQL triggers and application role privilege revocation.
- **RLS Behavior:** `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `current_app_org_id()`.
- **Schema Specification:**
  ```sql
  CREATE TABLE audit_log_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      branch_id UUID NULL,
      actor_id UUID NULL,
      station_id UUID NULL,
      event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
      action VARCHAR(100) NOT NULL,
      entity_name VARCHAR(100) NOT NULL,
      entity_id VARCHAR(100) NULL,
      client_timestamp TIMESTAMPTZ NULL,
      server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sequence_number BIGINT NOT NULL,
      previous_record_hash VARCHAR(64) NOT NULL,
      record_hash VARCHAR(64) NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'CLOUD',
      request_id VARCHAR(100) NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_audit_log_events_org_id UNIQUE (organization_id, id),
      CONSTRAINT uq_audit_log_events_seq UNIQUE NULLS NOT DISTINCT (organization_id, branch_id, sequence_number),
      CONSTRAINT uq_audit_log_events_hash UNIQUE (organization_id, record_hash),
      CONSTRAINT fk_audit_log_events_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_log_events_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_log_events_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE SET NULL
  );
  ```

#### 2. `security_telemetry_events` (Cloud Security Telemetry)
- **Purpose:** Ingestion and persistence of security detections, threshold violations, and incident triggers across Cloud and Edge nodes.
- **Classification:** `CONFIDENTIAL / SECURITY_TELEMETRY`.
- **Retention:** `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED (SEC-VAL-11)`.
- **Append-Only Contract:** `TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY`. Disallows `UPDATE`, `DELETE`, and `TRUNCATE`.
- **RLS Behavior:** `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `current_app_org_id()`.
- **Schema Specification:**
  ```sql
  CREATE TABLE security_telemetry_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      branch_id UUID NULL,
      station_id UUID NULL,
      actor_id UUID NULL,
      rule_code VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL,
      category VARCHAR(50) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}',
      action_taken VARCHAR(100) NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'CLOUD',
      request_id VARCHAR(100) NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_sec_telemetry_org_id UNIQUE (organization_id, id),
      CONSTRAINT fk_sec_telemetry_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE SET NULL,
      CONSTRAINT fk_sec_telemetry_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE SET NULL,
      CONSTRAINT fk_sec_telemetry_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE SET NULL
  );
  ```

### 3.2 Contradiction B: Section 3 Addition in `SECURITY_LOGGING_AND_MONITORING.md`
- Added explicit Section 3: **"Contrato Canónico de Auditoría Cloud y Telemetría de Seguridad (WP-006)"** to `SECURITY_LOGGING_AND_MONITORING.md`.
- Governs the exact boundary split, TypeScript interface contracts (`AuditEventInput`, `SecurityTelemetryInput`, `IAuditLogger`), cryptographic hashing and checkpoint rules, redaction policy, append-only trust boundaries, and multi-tenant RLS isolation.
- Corrected citations in `IMPLEMENTATION_PLAN.md` to:
  `SECURITY_LOGGING_AND_MONITORING.md Sec. 1, 2, 3; DATA_PROTECTION_AND_PRIVACY.md Sec. 3; SECURITY_ARCHITECTURE.md Sec. 10`.

### 3.3 Cloud vs. Edge Tamper-Evidence Ownership Boundary
To prevent scope creep and avoid blocking on unbuilt Edge components:
- **`WP-006` Exclusively Owns:**
  - Cloud structured audit interface (`logAuditEvent()`) and telemetry interface (`logSecurityTelemetryEvent()`).
  - Cloud PostgreSQL persistence (`audit_log_events`, `security_telemetry_events`).
  - Cloud hash chaining computation (`record_hash = SHA256(canonical_payload)`).
  - Cloud checkpoint representation (`audit.checkpoint.created`) and chain verification primitives.
  - Recursive pre-persistence and pre-observability redaction engine.
  - Tenant RLS isolation and DB trigger append-only enforcement.
- **`WP-006` Does NOT Own (Deferred to Later WPs):**
  - Edge SQLite `local_audit_trail` table and storage engine (owned by `WP-008`).
  - Edge local hash chaining runtime and offline queueing (owned by `WP-008` / `WP-010`).
  - Outbox queue transport and WAN synchronization engine (owned by `WP-012` / `WP-013`).
  - Edge checkpoint ACK processing runtime (owned by `WP-013`).
  - Detection rule execution engines (e.g. PIN brute-force terminal lockout in `WP-010`, lease fencing validation in `WP-011`, webhook signature verification in `WP-021`). `WP-006` provides the data contract to record their outcomes, not their execution logic.

### 3.4 Staged Validation Model for SEC-VAL-06
`SEC-VAL-06` requires physical SQLite file tampering simulation during WAN synchronization. This cannot be completed in `WP-006`. Attempting to mock the missing Edge components to force a "PASS" would degrade security governance.
The validation is formally staged:
1. **`SEC-VAL-06A` (WP-006): Cloud Audit Integrity & Append-Only Controls Validation**
   - Verified via unit and integration tests executing:
     - SQL `UPDATE` rejection test on `audit_log_events` (expecting trigger exception).
     - SQL `DELETE` rejection test on `audit_log_events` (expecting trigger exception).
     - SQL `UPDATE` / `DELETE` rejection test on `security_telemetry_events`.
     - Multi-tenant RLS isolation negative tests (cross-tenant read/write blocked).
     - SHA-256 hash continuity test (verifying detection of modified payload attributes).
     - Recursive case-insensitive credential redaction and PII masking tests.
     - Cloud checkpoint verification test (accepting valid chains, rejecting/quarantining discontinuous chains).
   - Deliverable: `EVIDENCE_SEC_VAL_06A_CLOUD_AUDIT_INTEGRITY.md`.
2. **`SEC-VAL-06` (WP-013 / WP-008): Tamper-Evident Audit & SQLite Hash Chain (End-to-End)**
   - Complete multi-tier attack scenario: corrupting SQLite rows on local Edge disk, triggering sync, verifying Cloud detection of hash break, batch quarantine, and forensic alert generation.
   - Status: **Remains OPEN** until `WP-013` completion.

### 3.5 Cryptographic Hash, Checkpoint & Serialization Contract
1. **Hash Algorithm:** Standard SHA-256 (NIST FIPS 180-4), 64-character lowercase hex string.
2. **Deterministic Serialization:** Conforms to RFC 8785 (JSON Canonicalization Scheme - JCS) or strict deterministic key sorting:
   $$\text{CanonicalString} = \text{Serialize}(\{ \text{orgId}, \text{branchId}, \text{sequenceNumber}, \text{clientTimestamp}, \text{serverTimestamp}, \text{eventType}, \text{action}, \text{entityName}, \text{entityId}, \text{actorId}, \text{stationId}, \text{redactedMetadata}, \text{previousRecordHash} \})$$
   $$\text{record\_hash} = \text{SHA256}(\text{CanonicalString})$$
3. **Genesis Constant:** For `sequence_number = 1`, `previous_record_hash` is canonically defined as 64 zeroes:
   `"0000000000000000000000000000000000000000000000000000000000000000"`.
4. **Sequence Semantics:** Monotonically increasing `BIGINT` per stream `(organization_id, branch_id)`.
5. **Checkpoint Format:** Structured event `audit.checkpoint.created` containing:
   `start_sequence_number`, `end_sequence_number`, `start_record_hash`, `checkpoint_record_hash`, `event_count`, and `source_stream`.
6. **Discontinuity Behavior:** If $\text{received\_event.previous\_record\_hash} \neq \text{latest\_persisted.record\_hash}$, the batch is rejected, quarantined, and a CRITICAL `AUDIT_HASH_CHAIN_BREAK` event is recorded.

### 3.6 Automatic Pre-Persistence Redaction Policy
In conformance with `DATA_PROTECTION_AND_PRIVACY.md` Sec. 3:
1. **Timing Rule:** `REDACT BEFORE ANY EXTERNAL SINK`. Redaction occurs strictly before database insertion, terminal logging, or error reporting. Plaintext secrets are never persisted.
2. **Prohibited Keys:** Case-insensitive match on `password`, `pin`, `pin_hash`, `token`, `secret`, `authorization`, `credit_card`, `cvv`, `private_key` (and camelCase equivalents `accessToken`, `refreshToken`, `apiKey`, `clientSecret`) are replaced with literal `"[REDACTED]"`.
3. **PII Masking:**
   - Emails: `u***@domain.com` (first character preserved, three asterisks, domain preserved).
   - Phones: `******1234` (all digits masked except last 4).
4. **Deep Traversal:** Redaction recursively inspects nested JSON objects and arrays to arbitrary depth.

### 3.7 Immutability Trust Boundary
- **Precise Governance Definition:** `TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY`.
- No claim is made that records are immune to PostgreSQL superuser alteration or cloud infrastructure host manipulation.
- Within the application trust boundary, database triggers (`trg_audit_log_events_immutable`, `trg_security_telemetry_events_immutable`) raise runtime exceptions on any `UPDATE` or `DELETE`, and application database roles are granted only `SELECT` and `INSERT`.

### 3.8 Preservation of Product Owner Neutrality
All 9 Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`.
`WP-006` has zero PO dependency: the structured audit framework supports arbitrary event types associated with future business behaviors without deciding or committing those behaviors.

---

## 4. Summary of Document Changes

| Document | Nature of Change | Justification |
|---|---|---|
| `IMPLEMENTATION_PLAN.md` | Updated `WP-006` specification, dependencies, acceptance criteria, test cases, and staged `SEC-VAL-06A` / `SEC-VAL-06` mapping. Added `stations`, `audit_log_events`, and `security_telemetry_events` to Platform Core summary. | Eliminates missing section citations, defines exact deliverables and test cases, prevents false PASS on `SEC-VAL-06`. |
| `DATA_MODEL.md` | Added composite unique constraints on `stations`, defined full DDL for `audit_log_events` and `security_telemetry_events`, append-only triggers, RLS policies, and indexes. | Resolves Contradiction A; establishes tenant-safe schema before builder activation. |
| `DATA_DICTIONARY.md` | Added attribute-level dictionary entries for `stations`, `audit_log_events`, and `security_telemetry_events` in Section 1.1. | Aligns data dictionary with data model. |
| `SECURITY_LOGGING_AND_MONITORING.md` | Added Section 3 defining the Cloud vs Edge split, structured logger interfaces, SHA-256 hash chaining, checkpoint format, redaction rules, and append-only model. | Resolves Contradiction B; creates the missing frozen specification for WP-006. |
| `SECURITY_RISKS.md` | Clarified staged validation for `SEC-06` (`SEC-VAL-06A` in Cloud WP-006 vs `SEC-VAL-06` in Sync WP-013). | Aligns risk matrix with staged validation framework. |
| `evidence/WP-006_PLAN_REMEDIATION_AUTHOR_EVIDENCE.md` | Author evidence documenting remediation decisions, baseline preservation, and review readiness. | Required EAAF author evidence artifact. |

---

## 5. Rollback Plan

If rejected by baseline reviewers, the repository can be cleanly restored to canonical base commit `5a52fd674e9afaf15f9c5f12c695d6ce09bd25b7`.

---

## 6. Required Independent Reviews

This Change Request requires dual role-separated EAAF agent reviews:
1. `03_Data_Architect` — Data Architecture Conformance Review (`review/wp-006-plan-data-r1`)
2. `08_Security_Architect` — Security Conformance Review (`review/wp-006-plan-security-r1`)
