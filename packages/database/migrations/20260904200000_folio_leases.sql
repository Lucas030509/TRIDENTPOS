-- Up
-- ============================================================================
-- TRIDENTPOS — WP-011: Folio Lease Allocation & Fencing Protocol Engine
-- Architecture Baselines: DATA_MODEL.md Sec 2.1, SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 1, ADR-008
-- ============================================================================

CREATE TABLE folio_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    folio_type VARCHAR(50) NOT NULL,
    epoch_id VARCHAR(50) NOT NULL,
    fencing_token VARCHAR(100) NOT NULL,
    range_start BIGINT NOT NULL,
    range_end BIGINT NOT NULL,
    high_water_mark BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL,
    abandoned_at TIMESTAMPTZ NULL,
    reconciled_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_folio_leases_epoch UNIQUE (organization_id, branch_id, folio_type, epoch_id),
    CONSTRAINT chk_folio_leases_type CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA')),
    CONSTRAINT chk_folio_leases_status CHECK (status IN ('ALLOCATED', 'ACTIVE', 'EXHAUSTED', 'REVOKED', 'ABANDONED_CONTINGENCY_RANGE', 'RECONCILED')),
    CONSTRAINT chk_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start),
    CONSTRAINT chk_folio_leases_hwm CHECK (high_water_mark >= range_start - 1 AND high_water_mark <= range_end)
);

-- Performance & Query Indices
CREATE INDEX idx_folio_leases_org_branch_type ON folio_leases (organization_id, branch_id, folio_type);
CREATE INDEX idx_folio_leases_status ON folio_leases (status);
CREATE INDEX idx_folio_leases_fencing_token ON folio_leases (fencing_token);

-- Row Level Security & Multi-Tenant Isolation
ALTER TABLE folio_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_leases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON folio_leases
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON folio_leases;
ALTER TABLE IF EXISTS folio_leases NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS folio_leases DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS folio_leases CASCADE;
