-- Up
-- ============================================================================
-- TRIDENTPOS — WP-016B: Platform Core Master Catalog Foundation (Categories & Products)
-- Architecture Baseline: ACR-2026-014 — Platform Core Master Catalog Physical Prerequisite for WP-017
-- Ownership: categories & products belong to Platform Core, NOT Inventory.
-- ============================================================================

-- 1. Categories (Tenant-Scoped Master Catalog)
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_categories_org_code
        UNIQUE (organization_id, code),

    CONSTRAINT uq_categories_org_id
        UNIQUE (organization_id, id)
);

-- 2. Products (Tenant-Scoped Master Catalog)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),

    category_id UUID NOT NULL,

    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,

    product_type VARCHAR(50) NOT NULL,

    base_price DECIMAL(12,4) NOT NULL,

    tax_scheme_id UUID NOT NULL,

    is_inventoriable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,

    CONSTRAINT uq_products_org_code
        UNIQUE (organization_id, code),

    CONSTRAINT uq_products_org_id
        UNIQUE (organization_id, id),

    CONSTRAINT fk_products_category
        FOREIGN KEY (organization_id, category_id)
        REFERENCES categories (organization_id, id)
        ON DELETE RESTRICT
);

-- 3. Row Level Security & Isolation Policies: categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON categories
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Row Level Security & Isolation Policies: products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON products
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON products;
ALTER TABLE IF EXISTS products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON categories;
ALTER TABLE IF EXISTS categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
