-- Up
-- ============================================================================
-- TRIDENTPOS — WP-013: Sync Checkpoints & Telemetry
-- Architecture Baselines: SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 4, 5
-- ADR-002, ADR-005, ADR-006, EAAF v1.2.0 WP-013
-- ============================================================================

-- 1. Sync Checkpoints
CREATE TABLE sync_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    stream_type VARCHAR(64) NOT NULL,
    checkpoint_type VARCHAR(64) NOT NULL,
    last_synced_sequence BIGINT NOT NULL DEFAULT 0,
    last_snapshot_version BIGINT NOT NULL DEFAULT 0,
    last_sync_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_sync_checkpoints_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_sync_checkpoints_stream UNIQUE (organization_id, branch_id, stream_type),
    CONSTRAINT chk_sync_checkpoints_seq CHECK (last_synced_sequence >= 0),
    CONSTRAINT chk_sync_checkpoints_ver CHECK (last_snapshot_version >= 0)
);

CREATE INDEX idx_sync_checkpoints_lookup ON sync_checkpoints (organization_id, branch_id, stream_type);

ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_checkpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON sync_checkpoints
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Sync Telemetry
CREATE TABLE sync_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    duration_ms INT NULL,
    records_count INT NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_sync_telemetry_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT chk_sync_telemetry_records CHECK (records_count >= 0)
);

CREATE INDEX idx_sync_telemetry_branch_occurred ON sync_telemetry (organization_id, branch_id, occurred_at);
CREATE INDEX idx_sync_telemetry_event_type ON sync_telemetry (organization_id, event_type);

ALTER TABLE sync_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_telemetry FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON sync_telemetry
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON sync_telemetry;
ALTER TABLE IF EXISTS sync_telemetry NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_telemetry DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS sync_telemetry CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON sync_checkpoints;
ALTER TABLE IF EXISTS sync_checkpoints NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_checkpoints DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS sync_checkpoints CASCADE;
