-- Up
-- ============================================================================
-- TRIDENTPOS — WP-017: Inventory Catalog, Multi-Warehouse & Recipe Explosion
-- Architecture Baselines: DATA_MODEL.md Sec 2.3, SECURITY_ARCHITECTURE.md Sec 6.2, ADR-013
-- ============================================================================

-- 1. Almacenes y Centros de Consumo
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    warehouse_type VARCHAR(50) NOT NULL, -- PRINCIPAL, PRODUCCION, BARRA, COCINA
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_warehouses_org_branch_code UNIQUE (organization_id, branch_id, code),
    CONSTRAINT uq_warehouses_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_warehouses_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

-- 2. Insumos e Ingredientes Base
CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL, -- KG, LT, PZ, GR, ML
    current_average_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    last_purchase_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ingredients_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_ingredients_org_id UNIQUE (organization_id, id)
);

-- 3. Recetas Escandallo (Subrecetas y Productos Compuestos)
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    product_id UUID NULL, -- Null si es subreceta intermedia
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    yield_quantity DECIMAL(12, 4) NOT NULL DEFAULT 1.0000,
    yield_unit VARCHAR(20) NOT NULL,
    total_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recipes_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_recipes_org_id UNIQUE (organization_id, id)
);

-- 4. Partidas de Receta (Exclusividad Ingrediente XOR Subreceta)
CREATE TABLE recipe_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    recipe_id UUID NOT NULL,
    ingredient_id UUID NULL,
    sub_recipe_id UUID NULL,
    quantity DECIMAL(12, 4) NOT NULL,
    gross_quantity DECIMAL(12, 4) NOT NULL, -- Incluye factor de merma
    unit_cost_snapshot DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recipe_items_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_recipe_items_recipe FOREIGN KEY (organization_id, recipe_id) REFERENCES recipes(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_recipe_items_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id),
    CONSTRAINT fk_recipe_items_sub_recipe FOREIGN KEY (organization_id, sub_recipe_id) REFERENCES recipes(organization_id, id),
    CONSTRAINT chk_recipe_items_exclusive_source CHECK (
        (ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR
        (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL)
    )
);

-- 5. Row-Level Security (RLS) & Isolation Policies: warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;

CREATE POLICY warehouses_tenant_isolation_policy ON warehouses
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 6. Row-Level Security (RLS) & Isolation Policies: ingredients
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients FORCE ROW LEVEL SECURITY;

CREATE POLICY ingredients_tenant_isolation_policy ON ingredients
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 7. Row-Level Security (RLS) & Isolation Policies: recipes
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;

CREATE POLICY recipes_tenant_isolation_policy ON recipes
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 8. Row-Level Security (RLS) & Isolation Policies: recipe_items
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items FORCE ROW LEVEL SECURITY;

CREATE POLICY recipe_items_tenant_isolation_policy ON recipe_items
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS recipe_items_tenant_isolation_policy ON recipe_items;
ALTER TABLE IF EXISTS recipe_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipe_items DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipes_tenant_isolation_policy ON recipes;
ALTER TABLE IF EXISTS recipes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredients_tenant_isolation_policy ON ingredients;
ALTER TABLE IF EXISTS ingredients NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingredients DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouses_tenant_isolation_policy ON warehouses;
ALTER TABLE IF EXISTS warehouses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS warehouses DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS recipe_items CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
