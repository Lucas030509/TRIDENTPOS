-- Up
-- ============================================================================
-- TRIDENTPOS — WP-005: Cloud IAM & Administrative Authentication
-- Architecture Baselines: DATA_MODEL.md Sec 2.1, IAM_SECURITY_MODEL.md Sec 1, 4,
--                         SECURITY_ARCHITECTURE.md Sec 1, 2.2, 5.1, 6
-- ============================================================================

-- 1. Users (Cloud IAM Administrative Principals & Edge Identities)
-- Canonical identity invariant: users.id IS the Supabase Auth subject UUID (jwt.sub)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_org_email UNIQUE (organization_id, email),
    CONSTRAINT uq_users_org_id UNIQUE (organization_id, id)
);

-- 2. Roles (Tenant-Scoped RBAC Definitions)
-- Governed authority: roles.permissions JSONB contains array of permission string identifiers
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_roles_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_roles_org_id UNIQUE (organization_id, id)
);

-- 3. User Roles (Tenant-Aware, Branch-Scoped Role Assignments)
-- Composite foreign keys guarantee cross-tenant references are strictly impossible
CREATE TABLE user_roles (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    role_id UUID NOT NULL,
    PRIMARY KEY (organization_id, user_id, branch_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE CASCADE
);

-- 4. User Branch Credentials (Cloud PIN Hash Provisioning & Rotation)
-- Cloud schema and provisioning owned by WP-005; Edge offline runtime verification owned by WP-010
CREATE TABLE user_branch_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 1,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_branch_cred UNIQUE (organization_id, user_id, branch_id),
    CONSTRAINT uq_user_branch_cred_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_user_branch_cred_user FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_branch_cred_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE
);

-- 5. Row Level Security & Isolation Policies: users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON users
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 6. Row Level Security & Isolation Policies: roles
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON roles
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 7. Row Level Security & Isolation Policies: user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON user_roles
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 8. Row Level Security & Isolation Policies: user_branch_credentials
ALTER TABLE user_branch_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON user_branch_credentials
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON user_branch_credentials;
ALTER TABLE IF EXISTS user_branch_credentials NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_branch_credentials DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON user_roles;
ALTER TABLE IF EXISTS user_roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_roles DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON roles;
ALTER TABLE IF EXISTS roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS roles DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON users;
ALTER TABLE IF EXISTS users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS user_branch_credentials CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
