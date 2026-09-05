-- Up
-- ============================================================================
-- TRIDENTPOS — WP-006: Tamper-Evident Security Logging & Cloud Audit Trail
-- Architecture Baselines: DATA_MODEL.md Sec 2.1, SECURITY_LOGGING_AND_MONITORING.md,
--                         ACR-2026-007, ACR-2026-008 (R4 Immutable Referential Actions)
-- ============================================================================

-- 1. Stations (Authorized Terminals & Edge Devices - Platform Core Prerequisite)
-- Owned by WP-006 to establish composite foreign keys and immutable audit integrity.
CREATE TABLE stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    station_type VARCHAR(50) NOT NULL,
    public_key_fingerprint VARCHAR(255) NULL,
    is_authorized BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stations_org_branch_code UNIQUE (organization_id, branch_id, code),
    CONSTRAINT uq_stations_org_branch_id UNIQUE (organization_id, branch_id, id),
    CONSTRAINT uq_stations_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_stations_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES branches(organization_id, id)
        ON DELETE RESTRICT
);

-- Row Level Security: stations
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON stations
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Cloud Audit Log Events (Tamper-Evident SHA-256 Hash Chained Audit Trail)
-- Immutability Model: TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY
-- Referential Action Policy: ON DELETE RESTRICT on all parent entity references.
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
    CONSTRAINT fk_audit_log_events_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES branches(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_audit_log_events_actor FOREIGN KEY (organization_id, actor_id)
        REFERENCES users(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_audit_log_events_station FOREIGN KEY (organization_id, branch_id, station_id)
        REFERENCES stations(organization_id, branch_id, id)
        ON DELETE RESTRICT
);

-- 3. Cloud Security Telemetry Events (Incident Detection & Tampering Telemetry Sink)
-- Immutability Model: TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY
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
    CONSTRAINT fk_sec_telemetry_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES branches(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_sec_telemetry_actor FOREIGN KEY (organization_id, actor_id)
        REFERENCES users(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_sec_telemetry_station FOREIGN KEY (organization_id, branch_id, station_id)
        REFERENCES stations(organization_id, branch_id, id)
        ON DELETE RESTRICT
);

-- 4. Append-Only Trigger Enforcement Function
CREATE OR REPLACE FUNCTION trg_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Trigger on audit_log_events
CREATE TRIGGER trg_audit_log_events_immutable
    BEFORE UPDATE OR DELETE ON audit_log_events
    FOR EACH ROW
    EXECUTE FUNCTION trg_audit_log_append_only();

-- Trigger on security_telemetry_events
CREATE TRIGGER trg_security_telemetry_events_immutable
    BEFORE UPDATE OR DELETE ON security_telemetry_events
    FOR EACH ROW
    EXECUTE FUNCTION trg_audit_log_append_only();

-- 5. Row Level Security & Isolation Policies
ALTER TABLE audit_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON audit_log_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

ALTER TABLE security_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_telemetry_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON security_telemetry_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 6. Performance & Verification Indexes
CREATE INDEX idx_stations_org_branch ON stations (organization_id, branch_id);
CREATE INDEX idx_audit_log_org_created_at ON audit_log_events (organization_id, created_at DESC);
CREATE INDEX idx_audit_log_org_event_type ON audit_log_events (organization_id, event_type);
CREATE INDEX idx_audit_log_org_entity ON audit_log_events (organization_id, entity_name, entity_id);
CREATE INDEX idx_audit_log_org_actor ON audit_log_events (organization_id, actor_id);
CREATE INDEX idx_audit_log_seq_hash ON audit_log_events (organization_id, branch_id, sequence_number, record_hash);

CREATE INDEX idx_sec_telemetry_org_time ON security_telemetry_events (organization_id, timestamp DESC);
CREATE INDEX idx_sec_telemetry_org_rule ON security_telemetry_events (organization_id, rule_code, severity);
CREATE INDEX idx_sec_telemetry_org_branch_station ON security_telemetry_events (organization_id, branch_id, station_id);

-- Down
DROP TRIGGER IF EXISTS trg_security_telemetry_events_immutable ON security_telemetry_events;
DROP TRIGGER IF EXISTS trg_audit_log_events_immutable ON audit_log_events;
DROP FUNCTION IF EXISTS trg_audit_log_append_only();

DROP POLICY IF EXISTS tenant_isolation_policy ON security_telemetry_events;
ALTER TABLE IF EXISTS security_telemetry_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS security_telemetry_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON audit_log_events;
ALTER TABLE IF EXISTS audit_log_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON stations;
ALTER TABLE IF EXISTS stations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stations DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS security_telemetry_events CASCADE;
DROP TABLE IF EXISTS audit_log_events CASCADE;
DROP TABLE IF EXISTS stations CASCADE;
