# ARCHITECTURE CHANGE REQUEST: WP-006 FINAL INTEGRITY CLOSURE
## AUDIT IMMUTABLE-HISTORY REFERENTIAL ACTIONS & CLOUD STATIONS PREREQUISITE OWNERSHIP

**ID:** `ACR-2026-008` (supersedes `ACR-2026-007` delete semantics)  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `01_Solution_Architect — WP-006 CROSS-ARCHITECTURE CONSISTENCY REMEDIATION AUTHOR`  
**Date:** `2026-09-04`  
**Status:** `APPROVED / FROZEN — FINAL R4 INTEGRITY CLOSURE`  
**Base Commit:** `bdada1d389a089e05dede3a2166beeb4a529911d`  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `PRE-IMPLEMENTATION CONSISTENCY REMEDIATION & AUDIT INTEGRITY SPECIFICATION (R4)`  

---

## 1. Problem Statement & Motivation

Following independent architectural audit of prior iterations, two essential architectural requirements must be ratified to achieve 100% integrity prior to builder activation for `WP-006: Tamper-Evident Security Logging & Cloud Audit Trail`:

### 1.1 Required Change A: Audit FKs Must Not Mutate History (Immutable History via RESTRICT)
- **Defect in Prior Design:** Prior proposals utilized `ON DELETE SET NULL` (unqualified or column-specific) on foreign keys referencing `branches`, `users`, and `stations`. In an immutable audit log, setting referencing foreign keys to `NULL` upon deletion of an operational parent row constitutes **retroactive mutation of historical evidence**.
- **Mandatory Invariant:** Once inserted, an `audit_log_events` or `security_telemetry_events` row must **never** be modified by application DML OR by foreign-key referential actions.
- **Enforcement Mechanism:** Foreign keys must strictly enforce `ON DELETE RESTRICT` (or PostgreSQL `NO ACTION`). Physical deletion of any parent entity (`branches`, `users`, `stations`) must be rejected by the relational engine while historical audit rows reference it.
- **Operational Decommissioning Contract:**
  - Decommissioning branches: `branches.is_active = false`
  - Decommissioning users/staff: `users.is_active = false`
  - Deauthorizing stations: `stations.is_authorized = false`
- **Prohibitions:** `ON DELETE CASCADE` and `ON DELETE SET NULL` are strictly prohibited on all audit trail references.

### 1.2 Required Change B: Stations Table Cloud Ownership by WP-006
- `WP-006` owns the creation of the canonical Cloud `stations` table as a **SUPPORTING PLATFORM CORE PREREQUISITE**.
- **Rationale:** `audit_log_events` and `security_telemetry_events` contain foreign keys referencing `stations(organization_id, branch_id, id)`. In order to enforce referential integrity and strict multi-tenant constraints at the database level, the Cloud `stations` table must exist and enforce tenant isolation before audit log foreign keys are created.
- **Boundary with WP-009:** `WP-006` creates only the Cloud `stations` master table and tenant RLS policies. `WP-009` exclusively owns `edge_hosts`, `station_credentials`, `enrollment_tokens`, the Edge enrollment handshake protocol, mTLS/pairing, and the fingerprint trust bootstrap runtime. Zero scope creep into edge runtime logic is permitted in `WP-006`.

---

## 2. Canonical DDL Specifications

### 2.1 Canonical Cloud `stations` Table (Platform Core Prerequisite — Owned by WP-006)
```sql
CREATE TABLE stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    station_type VARCHAR(50) NOT NULL, -- POS, KDS, COMANDERO, DISPLAY
    public_key_fingerprint VARCHAR(255) NULL,
    is_authorized BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_stations_org_branch_code UNIQUE (organization_id, branch_id, code),
    CONSTRAINT uq_stations_org_branch_id UNIQUE (organization_id, branch_id, id),
    CONSTRAINT uq_stations_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_stations_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE RESTRICT
);

ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations FORCE ROW LEVEL SECURITY;

CREATE POLICY stations_tenant_isolation ON stations
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

### 2.2 Canonical Cloud `audit_log_events` Table (Primary Object — Owned by WP-006)
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
    CONSTRAINT fk_audit_log_events_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_log_events_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_log_events_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_audit_log_events_immutable
BEFORE UPDATE OR DELETE ON audit_log_events
FOR EACH ROW EXECUTE FUNCTION trg_audit_log_append_only();

ALTER TABLE audit_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_events_tenant_isolation ON audit_log_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

### 2.3 Canonical Cloud `security_telemetry_events` Table (Primary Object — Owned by WP-006)
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
    CONSTRAINT fk_sec_telemetry_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_sec_telemetry_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_sec_telemetry_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_security_telemetry_events_immutable
BEFORE UPDATE OR DELETE ON security_telemetry_events
FOR EACH ROW EXECUTE FUNCTION trg_audit_log_append_only();

ALTER TABLE security_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_telemetry_events FORCE ROW LEVEL SECURITY;

CREATE POLICY security_telemetry_events_tenant_isolation ON security_telemetry_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

---

## 3. Test Contract (Mandatory Integration Verification Suite)

The implementation plan enforces the following automated PostgreSQL integration tests during builder execution:
1. **Branch Deletion Rejection Test:** Deleting a branch referenced by an audit log event is rejected with a foreign-key violation (`RESTRICT`).
2. **Branch Soft-Deactivation Test:** Soft-deactivating a branch (`is_active = false`) succeeds; existing audit records remain unchanged byte-for-byte and field-for-field.
3. **User Deletion Rejection Test:** Deleting a user referenced by an audit log event is rejected with a foreign-key violation (`RESTRICT`).
4. **User Soft-Deactivation Test:** Soft-deactivating a user (`is_active = false`) succeeds; existing audit records remain intact.
5. **Station Deletion Rejection Test:** Deleting a station referenced by an audit log event is rejected with a foreign-key violation (`RESTRICT`).
6. **Station Soft-Deauthorization Test:** Soft-deauthorizing a station (`is_authorized = false`) succeeds; existing audit records remain intact.
7. **No Cascade Deletion Test:** Under no circumstances are audit records cascade-deleted.
8. **Prerequisite Execution Order Test:** The `stations` table is migrated and exists prior to creating audit foreign keys referencing it.
9. **Stations RLS Tenant Isolation Test:** Tenant A cannot read, insert, update, or delete stations belonging to Tenant B (`FORCE ROW LEVEL SECURITY`). Default deny when tenant session context is null.

---

## 4. Document Synchronization Matrix

| File | Updates Applied | Status |
|---|---|---|
| `DATA_MODEL.md` | Foreign keys set to `ON DELETE RESTRICT`; `stations` table annotated as WP-006 supporting Platform Core prerequisite; `stations` `ENABLE + FORCE RLS` added. | Synchronized |
| `DATA_DICTIONARY.md` | Section 1.1 updated to document `ON DELETE RESTRICT` immutable-history semantics and `WP-006` stations ownership. | Synchronized |
| `SECURITY_LOGGING_AND_MONITORING.md` | Section 3 updated: prohibited `SET NULL`/`CASCADE`; codified `ON DELETE RESTRICT` and soft deactivation; clarified `WP-006` stations ownership vs `WP-009` edge enrollment. | Synchronized |
| `IMPLEMENTATION_PLAN.md` | `WP-006` data objects, acceptance criteria, and tests 8–12 updated to enforce `ON DELETE RESTRICT`, soft deactivation, and `stations` prerequisite ownership. | Synchronized |
| `ARCHITECTURE_CHANGE_REQUEST_WP006_AUDIT_CONSISTENCY.md` | Updated DDL, Section 3.9, and Section 4 to reflect the final `ON DELETE RESTRICT` policy. | Synchronized |

---

## 5. Architectural Verdict & Freeze

The cross-architecture consistency and immutable-history semantics for `WP-006` are 100% reconciled and frozen. Zero ambiguities or contradictory referential actions remain.

**Verdict:**  
`APPROVED / FROZEN — FINAL R4 INTEGRITY CLOSURE`
