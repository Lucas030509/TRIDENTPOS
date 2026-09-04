-- Up
-- ============================================================================
-- TRIDENTPOS — WP-004: Organization & Branch Multi-Tenant RLS Foundation
-- Architecture Baselines: DATA_MODEL.md Sec 2.1, SECURITY_ARCHITECTURE.md Sec 6.2
-- ============================================================================

-- 1. Organizations (Tenant Root)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organizations_tax_id UNIQUE (tax_id)
);

-- 2. Branches (Scoped to Organization)
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/Mexico_City',
    address JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_branches_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_branches_org_id UNIQUE (organization_id, id)
);

-- 3. Foundational Tenant Context Helper
-- Derives current tenant organization UUID from transaction-local session setting.
-- Returns NULL when context is missing, empty, or malformed, enforcing default-deny.
CREATE OR REPLACE FUNCTION current_app_org_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_val TEXT;
BEGIN
    v_val := current_setting('app.current_organization_id', true);
    IF v_val IS NULL OR trim(v_val) = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_val::UUID;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

-- 4. Row Level Security & Isolation Policies: organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON organizations
    FOR ALL
    USING (id = current_app_org_id())
    WITH CHECK (id = current_app_org_id());

-- 5. Row Level Security & Isolation Policies: branches
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON branches
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON branches;
ALTER TABLE IF EXISTS branches NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS branches DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON organizations;
ALTER TABLE IF EXISTS organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS organizations DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS current_app_org_id();

DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
