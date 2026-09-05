# DATA MODEL SPECIFICATION — ERP RESTAURANTES / TRIDENTPOS

**Document ID:** `ARCH-MDL-001`  
**Version:** `1.0 APPROVED / FROZEN`  
**Status:** `APPROVED / FROZEN — 2026-09-01`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect`  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Convenciones Generales de Tipos y Nomenclatura

- **Identificadores:** UUIDv4 estándar en Cloud (`uuid`) y texto canónico en Edge (`TEXT`).
- **Valores Monetarios:** `DECIMAL(12, 4)` en Cloud y `INTEGER` en centavos o `DECIMAL(12, 4)` en Edge. Prohibido punto flotante (`REAL` / `FLOAT`).
- **Cantidades e Insumos:** `DECIMAL(12, 4)` para soportar gramajes, mililitros y fracciones de receta.
- **Fechas y Tiempos:** `TIMESTAMPTZ` (UTC ISO 8601) en Cloud y `TEXT` (formato `YYYY-MM-DDTHH:MM:SS.SSSZ`) en SQLite.
- **Nomenclatura:** `snake_case` para tablas y columnas.

---

## 2. Cloud PostgreSQL Logical Schema (11 Bounded Contexts)

### 2.1 Bounded Context 1: Platform Core (Kernel & Catálogo Maestro)

```sql
-- Organizaciones (Tenants)
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

-- Sucursales
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

-- Usuarios y Credenciales Administrativas
-- users.id es el identificador canónico vinculado al sujeto de autenticación de Supabase (jwt.sub)
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

-- Credenciales Operativas de Borde (Hashes de PIN)
-- Esquema Cloud y aprovisionamiento gobernado por WP-005; verificación offline en Edge gobernada por WP-010
CREATE TABLE user_branch_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    pin_hash VARCHAR(255) NOT NULL, -- Argon2id salted hash (RFC 9106 baseline)
    credential_version INTEGER NOT NULL DEFAULT 1,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_branch_cred UNIQUE (organization_id, user_id, branch_id),
    CONSTRAINT uq_user_branch_cred_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_user_branch_cred_user FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_branch_cred_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE
);

-- Roles y Permisos (RBAC)
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]', -- Array canónico de strings de permissions
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_roles_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_roles_org_id UNIQUE (organization_id, id)
);

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

-- Estaciones / Dispositivos Autorizados
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
    CONSTRAINT fk_stations_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE
);

-- Bitácora de Auditoría Tamper-Evident (Cloud Audit Trail)
-- Modelo de Inmutabilidad: TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY
-- Operaciones ordinarias UPDATE, DELETE y TRUNCATE estrictamente denegadas a nivel de trigger y permisos DML.
CREATE TABLE audit_log_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NULL,
    actor_id UUID NULL,
    station_id UUID NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO', -- INFO, WARN, ERROR, CRITICAL
    action VARCHAR(100) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NULL,
    client_timestamp TIMESTAMPTZ NULL,
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sequence_number BIGINT NOT NULL,
    previous_record_hash VARCHAR(64) NOT NULL, -- SHA-256 hex; para sequence_number=1 se utiliza '0'x64 (genesis)
    record_hash VARCHAR(64) NOT NULL, -- SHA-256 hex del payload canónico serializado (RFC 8785)
    source VARCHAR(50) NOT NULL DEFAULT 'CLOUD', -- CLOUD, EDGE_POS, EDGE_KDS, SYSTEM
    request_id VARCHAR(100) NULL,
    metadata JSONB NOT NULL DEFAULT '{}', -- Metadatos sanitizados previamente (censura recursiva de credenciales y PII)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_audit_log_events_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_audit_log_events_seq UNIQUE NULLS NOT DISTINCT (organization_id, branch_id, sequence_number),
    CONSTRAINT uq_audit_log_events_hash UNIQUE (organization_id, record_hash),
    CONSTRAINT fk_audit_log_events_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE SET NULL (branch_id),
    CONSTRAINT fk_audit_log_events_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE SET NULL (actor_id),
    CONSTRAINT fk_audit_log_events_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE SET NULL (station_id)
);

-- Telemetría de Eventos de Seguridad y Detección de Incidentes (Cloud Security Telemetry)
-- Modelo de Inmutabilidad: TAMPER-EVIDENT / APPEND-ONLY UNDER APPLICATION TRUST BOUNDARY
CREATE TABLE security_telemetry_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NULL,
    station_id UUID NULL,
    actor_id UUID NULL,
    rule_code VARCHAR(100) NOT NULL, -- PIN_BRUTE_FORCE, LEASE_REVOKED_ACCESS, DELIVERY_WEBHOOK_INVALID_SIGNATURE, RLS_VIOLATION_ATTEMPT, AUDIT_HASH_CHAIN_BREAK, CLOCK_ROLLBACK_DETECTED
    severity VARCHAR(20) NOT NULL, -- LOW, MEDIUM, HIGH, CRITICAL
    category VARCHAR(50) NOT NULL, -- AUTHENTICATION, AUTHORIZATION, INTEGRITY, NETWORK, TIMING
    details JSONB NOT NULL DEFAULT '{}', -- Atributos estructurados de telemetría sanitizados y redactados previamente
    action_taken VARCHAR(100) NOT NULL, -- Mitigación aplicada (e.g., STATION_TEMPORARY_BLOCK, REJECT_403_LEASE_REVOKED, etc.)
    source VARCHAR(50) NOT NULL DEFAULT 'CLOUD', -- CLOUD, EDGE_POS, EDGE_SERVER, SYSTEM
    request_id VARCHAR(100) NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sec_telemetry_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_sec_telemetry_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE SET NULL (branch_id),
    CONSTRAINT fk_sec_telemetry_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id) ON DELETE SET NULL (actor_id),
    CONSTRAINT fk_sec_telemetry_station FOREIGN KEY (organization_id, branch_id, station_id) REFERENCES stations(organization_id, branch_id, id) ON DELETE SET NULL (station_id)
);

-- Función y Triggers de Inmutabilidad (Append-Only Under Application Trust Boundary)
CREATE OR REPLACE FUNCTION trg_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit trail is append-only: UPDATE and DELETE operations are strictly prohibited on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_events_immutable
BEFORE UPDATE OR DELETE ON audit_log_events
FOR EACH ROW
EXECUTE FUNCTION trg_audit_log_append_only();

CREATE TRIGGER trg_security_telemetry_events_immutable
BEFORE UPDATE OR DELETE ON security_telemetry_events
FOR EACH ROW
EXECUTE FUNCTION trg_audit_log_append_only();

-- Políticas Mandatorias de Row Level Security (RLS)
ALTER TABLE audit_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_events_tenant_isolation ON audit_log_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

ALTER TABLE security_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_telemetry_events FORCE ROW LEVEL SECURITY;

CREATE POLICY security_telemetry_events_tenant_isolation ON security_telemetry_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Índices de Rendimiento y Verificación de Cadena
CREATE INDEX idx_audit_log_org_created_at ON audit_log_events (organization_id, created_at DESC);
CREATE INDEX idx_audit_log_org_event_type ON audit_log_events (organization_id, event_type);
CREATE INDEX idx_audit_log_org_entity ON audit_log_events (organization_id, entity_name, entity_id);
CREATE INDEX idx_audit_log_org_actor ON audit_log_events (organization_id, actor_id);
CREATE INDEX idx_audit_log_seq_hash ON audit_log_events (organization_id, branch_id, sequence_number, record_hash);

CREATE INDEX idx_sec_telemetry_org_time ON security_telemetry_events (organization_id, timestamp DESC);
CREATE INDEX idx_sec_telemetry_org_rule ON security_telemetry_events (organization_id, rule_code, severity);
CREATE INDEX idx_sec_telemetry_org_branch_station ON security_telemetry_events (organization_id, branch_id, station_id);

-- Catálogo Maestro: Categorías
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_categories_org_code UNIQUE (organization_id, code)
);

-- Catálogo Maestro: Grupos de Modificadores
CREATE TABLE modifier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    min_selectable INTEGER NOT NULL DEFAULT 0,
    max_selectable INTEGER NOT NULL DEFAULT 1,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_mod_groups_org_code UNIQUE (organization_id, code)
);

-- Catálogo Maestro: Modificadores
CREATE TABLE modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    group_id UUID NOT NULL REFERENCES modifier_groups(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    base_price DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_modifiers_org_code UNIQUE (organization_id, code)
);

-- Catálogo Maestro: Productos
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    category_id UUID NOT NULL REFERENCES categories(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    product_type VARCHAR(50) NOT NULL, -- SIMPLE, COMPOSITE, PACKAGE
    base_price DECIMAL(12, 4) NOT NULL,
    tax_scheme_id UUID NOT NULL,
    is_inventoriable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_products_org_code UNIQUE (organization_id, code)
);

-- Overrides de Producto por Sucursal (Branch Overrides)
CREATE TABLE branch_product_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    product_id UUID NOT NULL REFERENCES products(id),
    price_override DECIMAL(12, 4) NULL,
    is_available_override BOOLEAN NULL,
    tax_scheme_override_id UUID NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_branch_product_override UNIQUE (organization_id, branch_id, product_id)
);

-- Protocolo de Lease de Folios con Épocas (REM-01, ADR-008)
CREATE TABLE folio_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    folio_type VARCHAR(50) NOT NULL, -- TICKET, CORTE_X, CORTE_Z, FACTURA
    epoch_id VARCHAR(50) NOT NULL,   -- ep_1, ep_2
    fencing_token VARCHAR(100) NOT NULL,
    range_start BIGINT NOT NULL,
    range_end BIGINT NOT NULL,
    high_water_mark BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL, -- ALLOCATED, ACTIVE, EXHAUSTED, REVOKED, ABANDONED_CONTINGENCY_RANGE, RECONCILED
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL,
    abandoned_at TIMESTAMPTZ NULL,
    reconciled_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_folio_leases_epoch UNIQUE (organization_id, branch_id, folio_type, epoch_id)
);
```

---

### 2.2 Bounded Context 2: TRIDENTPOS (Cloud Projections & Outbox Ingestion)

```sql
-- Registro de Ingesta Idempotente (REM-04)
CREATE TABLE ingested_idempotency_log (
    idempotency_key VARCHAR(255) PRIMARY KEY, -- org:branch:aggType:aggId:action:clientOpId
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    aggregate_sequence_number BIGINT NOT NULL,
    client_op_id UUID NOT NULL,
    processing_status VARCHAR(50) NOT NULL, -- DURABLY_STORED, APPLIED, DUPLICATE_ACCEPTED
    response_payload JSONB NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Buffer de Reordenamiento Causal
CREATE TABLE reordering_buffer_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    sequence_number BIGINT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reordering_buffer UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, sequence_number)
);

-- Proyección Consolidada de Cortes Z
CREATE TABLE synced_cortes_z (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    corte_z_number BIGINT NOT NULL,
    epoch_id VARCHAR(50) NOT NULL,
    fencing_token VARCHAR(100) NOT NULL,
    shift_close_id UUID NOT NULL,
    business_date DATE NOT NULL,
    gross_sales DECIMAL(12, 4) NOT NULL,
    net_sales DECIMAL(12, 4) NOT NULL,
    tax_total DECIMAL(12, 4) NOT NULL,
    discounts_total DECIMAL(12, 4) NOT NULL,
    tips_total DECIMAL(12, 4) NOT NULL,
    cash_amount DECIMAL(12, 4) NOT NULL,
    card_amount DECIMAL(12, 4) NOT NULL,
    other_payments_amount DECIMAL(12, 4) NOT NULL,
    total_sales_count INTEGER NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_synced_cortes_z UNIQUE (organization_id, branch_id, corte_z_number, epoch_id)
);
```

---

### 2.3 Bounded Context 3 & 4: Inventory & Procurement

```sql
-- Almacenes y Centros de Consumo
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    warehouse_type VARCHAR(50) NOT NULL, -- PRINCIPAL, PRODUCCION, BARRA, COCINA
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_warehouses_org_branch_code UNIQUE (organization_id, branch_id, code)
);

-- Insumos e Ingredientes Base
CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL, -- KG, LT, PZ, GR, ML
    current_average_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    last_purchase_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_ingredients_org_code UNIQUE (organization_id, code)
);

-- Recetas Escandallo (Subrecetas y Productos Compuestos)
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    product_id UUID NULL REFERENCES products(id), -- Null si es subreceta intermedia
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    yield_quantity DECIMAL(12, 4) NOT NULL DEFAULT 1.0000,
    yield_unit VARCHAR(20) NOT NULL,
    total_cost DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_recipes_org_code UNIQUE (organization_id, code)
);

CREATE TABLE recipe_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id),
    ingredient_id UUID NULL REFERENCES ingredients(id),
    sub_recipe_id UUID NULL REFERENCES recipes(id),
    quantity DECIMAL(12, 4) NOT NULL,
    gross_quantity DECIMAL(12, 4) NOT NULL, -- Incluye factor de merma
    unit_cost_snapshot DECIMAL(12, 4) NOT NULL
);

-- Kárdex de Movimientos de Stock (Append-Only)
CREATE TABLE stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    movement_type VARCHAR(50) NOT NULL, -- COMPRA, CONSUMO_KDS, MERMA, AJUSTE_FISICO, TRANSFERENCIA
    reference_event_id VARCHAR(100) NOT NULL,
    quantity_delta DECIMAL(12, 4) NOT NULL, -- Positivo o negativo
    unit_cost DECIMAL(12, 4) NOT NULL,
    total_cost DECIMAL(12, 4) NOT NULL,
    balance_after DECIMAL(12, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proveedores
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NOT NULL,
    credit_days INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_suppliers_org_code UNIQUE (organization_id, code)
);

-- Órdenes de Compra y Recepciones (REM-11 Canonical)
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    order_number VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL, -- DRAFT, APPROVED, RECEIVED, CANCELLED
    total_amount DECIMAL(12, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_po_number UNIQUE (organization_id, branch_id, order_number)
);

CREATE TABLE purchase_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    purchase_order_id UUID NULL REFERENCES purchase_orders(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    receipt_number VARCHAR(50) NOT NULL,
    invoice_reference VARCHAR(100) NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    status VARCHAR(50) NOT NULL, -- REGISTERED, CANCELLED
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_receipt_number UNIQUE (organization_id, branch_id, receipt_number)
);
```

---

### 2.4 Bounded Context 5, 6, 7 & 8: Finance, Billing, CRM & Delivery

```sql
-- Cuentas por Pagar (AP)
CREATE TABLE accounts_payable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    purchase_receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
    total_amount DECIMAL(12, 4) NOT NULL,
    balance_due DECIMAL(12, 4) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, PARTIAL, PAID, CANCELLED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cuentas por Cobrar (AR / Crédito a Clientes)
CREATE TABLE accounts_receivable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    customer_id UUID NOT NULL,
    reference_account_id VARCHAR(100) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    balance_due DECIMAL(12, 4) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, PAID, OVERDUE, DEFAULTED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Esquemas de Impuestos Compuestos / Multi-Nivel
CREATE TABLE tax_schemes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    rate DECIMAL(6, 4) NOT NULL, -- Ej. 0.1600 para 16%
    is_inclusive BOOLEAN NOT NULL DEFAULT TRUE,
    tax_type VARCHAR(50) NOT NULL, -- IVA, IEPS, PROPINA_LEGAL
    CONSTRAINT uq_tax_schemes_org_code UNIQUE (organization_id, code)
);

-- Facturas Fiscales y Timbres (Billing)
CREATE TABLE fiscal_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    invoice_uuid VARCHAR(100) NULL, -- UUID fiscal del PAC/SAT
    series VARCHAR(20) NOT NULL,
    folio VARCHAR(50) NOT NULL,
    customer_tax_id VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    subtotal DECIMAL(12, 4) NOT NULL,
    tax_total DECIMAL(12, 4) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    status VARCHAR(50) NOT NULL, -- DRAFT, STAMPED, CANCELLED, REJECTED
    stamped_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_invoices_folio UNIQUE (organization_id, series, folio)
);

-- Clientes y Cuentas Corporativas (CRM)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(50) NULL,
    credit_limit DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    current_balance DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    allow_overdraft BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_customers_org_code UNIQUE (organization_id, code)
);

-- Logística de Flota Propia (Delivery)
CREATE TABLE delivery_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    name VARCHAR(100) NOT NULL,
    delivery_fee DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    code VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL, -- MOTO, BICI, AUTO
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_drivers_org_code UNIQUE (organization_id, code)
);
```

---

### 2.5 Bounded Context 9, 10 & 11: Loyalty, Analytics & Integrations

```sql
-- Programas de Lealtad y Monedero RestCard (Loyalty)
CREATE TABLE loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    card_number VARCHAR(50) NOT NULL,
    points_balance DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    wallet_balance DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_loyalty_card UNIQUE (organization_id, card_number)
);

CREATE TABLE loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loyalty_account_id UUID NOT NULL REFERENCES loyalty_accounts(id),
    transaction_type VARCHAR(50) NOT NULL, -- EARN, REDEEM, TOP_UP, EXPIRE
    points_delta DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    wallet_delta DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    reference_account_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conectores Externos y Credenciales de Plataforma (Integrations Hub)
CREATE TABLE external_connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    connector_type VARCHAR(50) NOT NULL, -- UBER_EATS, RAPPI, DIDI_FOOD, DELIVERECT, PAC_CFDI, PMS_OPERA
    name VARCHAR(100) NOT NULL,
    encrypted_credentials BYTEA NOT NULL, -- Cifrado con llave gestionada
    webhook_secret VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE external_platform_order_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    connector_id UUID NOT NULL REFERENCES external_connectors(id),
    external_order_id VARCHAR(100) NOT NULL,
    internal_account_id VARCHAR(100) NOT NULL,
    raw_payload JSONB NOT NULL,
    ingestion_status VARCHAR(50) NOT NULL, -- INGESTED, CONFIRMED, FAILED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ext_order_mapping UNIQUE (organization_id, connector_id, external_order_id)
);

-- Transactional Outbox de Cloud PostgreSQL (REM-05, ADR-007)
CREATE TABLE cloud_integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- TRIDENTPOS.CorteZGenerado, Procurement.RecepcionCompraRegistrada, etc.
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, PUBLISHED, FAILED
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL
);

-- Dead Letter Queue de Cloud PostgreSQL (REM-04, REM-05)
CREATE TABLE cloud_integration_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    outbox_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    error_code VARCHAR(100) NOT NULL,
    stack_trace TEXT NOT NULL,
    retry_count INTEGER NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ NULL,
    resolution_notes TEXT NULL
);

-- Bitácora de Auditoría Global
CREATE TABLE audit_log_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    actor_id UUID NULL,
    station_id UUID NULL,
    action VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    before_snapshot JSONB NULL,
    after_snapshot JSONB NULL,
    reason TEXT NULL,
    correlation_id VARCHAR(100) NOT NULL,
    is_offline_origin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Edge SQLite Logical Schema (Branch Operational Plane)

```sql
-- Versión de Esquema Local y Control de Migraciones
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
);

-- Snapshot de Configuración de Sucursal
CREATE TABLE local_branch_config (
    branch_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    tax_scheme_id TEXT NOT NULL,
    snapshot_version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

-- Cached Identity Store (Argon2id Hashes) (REM-09)
CREATE TABLE cached_users (
    user_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    pin_hash TEXT NOT NULL, -- Argon2id salted hash
    roles_json TEXT NOT NULL, -- JSON array de roles y permisos
    credential_version INTEGER NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    is_revoked INTEGER NOT NULL DEFAULT 0
);

-- Catálogo de Productos Local (Read Replica Snapshot)
CREATE TABLE local_products (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    effective_price REAL NOT NULL, -- Precio base o override ya resuelto
    tax_scheme_id TEXT NOT NULL,
    tax_rate REAL NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    delta_version INTEGER NOT NULL
);

-- Snapshot de Lease de Folios Local (REM-01, ADR-008)
CREATE TABLE local_folio_leases (
    folio_type TEXT PRIMARY KEY,
    epoch_id TEXT NOT NULL,
    fencing_token TEXT NOT NULL,
    range_start INTEGER NOT NULL,
    range_end INTEGER NOT NULL,
    current_folio INTEGER NOT NULL,
    status TEXT NOT NULL -- ACTIVE, EXHAUSTED, REVOKED
);

-- Salones y Mesas (Concurrencia Optimista OCC)
CREATE TABLE mesas (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    table_number TEXT NOT NULL,
    status TEXT NOT NULL, -- DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA
    current_account_id TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1, -- OCC Version
    updated_at TEXT NOT NULL
);

-- Cuentas de Comedor / Mostrador / Delivery (OCC + Economic Snapshot)
CREATE TABLE cuentas (
    id TEXT PRIMARY KEY,
    folio_number INTEGER NULL, -- Asignado al imprimir precuenta o cobrar
    epoch_id TEXT NOT NULL,
    mesa_id TEXT NULL,
    account_type TEXT NOT NULL, -- COMEDOR, MOSTRADOR, RAPPI, UBER, DOMICILIO
    status TEXT NOT NULL, -- ABIERTA, IMPRESA, PAGADA, ANULADA
    subtotal REAL NOT NULL DEFAULT 0.0,
    tax_total REAL NOT NULL DEFAULT 0.0,
    discounts_total REAL NOT NULL DEFAULT 0.0,
    tips_total REAL NOT NULL DEFAULT 0.0,
    total_amount REAL NOT NULL DEFAULT 0.0,
    opened_by_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1, -- OCC Version
    updated_at TEXT NOT NULL
);

-- Items en Cuenta (Preservación de Snapshot Económico Inmutable) (REM-10)
CREATE TABLE cuenta_items (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL REFERENCES cuentas(id),
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    unit_price_applied REAL NOT NULL,
    quantity REAL NOT NULL,
    tax_rate_applied REAL NOT NULL,
    tax_amount_applied REAL NOT NULL,
    discount_amount_applied REAL NOT NULL DEFAULT 0.0,
    subtotal REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL, -- ORDENADO, EN_COCINA, PREPARADO, ENTREGADO, CANCELADO
    created_at TEXT NOT NULL
);

CREATE TABLE cuenta_item_modificadores (
    id TEXT PRIMARY KEY,
    cuenta_item_id TEXT NOT NULL REFERENCES cuenta_items(id),
    modifier_id TEXT NOT NULL,
    modifier_name_snapshot TEXT NOT NULL,
    modifier_price_applied REAL NOT NULL DEFAULT 0.0
);

-- Órdenes y Comandas de KDS (Cocina / Barra)
CREATE TABLE kds_ordenes (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL,
    mesa_reference TEXT NOT NULL,
    urgency_level TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL, -- PENDIENTE, EN_PREPARACION, LISTO, ENTREGADO
    aggregate_sequence_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT NULL
);

-- Turnos de Caja (OCC Invariant)
CREATE TABLE turnos_caja (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL,
    operator_user_id TEXT NOT NULL,
    shift_number INTEGER NOT NULL,
    opening_cash_float REAL NOT NULL,
    closing_declared_cash REAL NULL,
    calculated_cash_total REAL NULL,
    cash_difference REAL NULL,
    status TEXT NOT NULL, -- ABIERTO, CERRADO_ARQUEO, CORTE_Z_EMITIDO
    opened_at TEXT NOT NULL,
    closed_at TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1, -- OCC Version
    updated_at TEXT NOT NULL
);

-- Pagos y Transacciones de Cobro (Append-Only)
CREATE TABLE pagos (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL REFERENCES cuentas(id),
    turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id),
    payment_method TEXT NOT NULL, -- EFECTIVO, TARJETA, TRANSFERENCIA, RESTCARD, CXC
    amount REAL NOT NULL,
    tip_amount REAL NOT NULL DEFAULT 0.0,
    reference_auth_code TEXT NULL,
    created_at TEXT NOT NULL
);

-- Transactional Outbox Local (REM-04, ADR-006)
CREATE TABLE outbox_queue (
    id TEXT PRIMARY KEY, -- UUIDv4
    client_op_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_sequence_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, IN_FLIGHT, SYNCED, FAILED
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    synced_at TEXT NULL
);

-- Bitácora de Auditoría Local (Append-Only)
CREATE TABLE local_audit_trail (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    action TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    details_json TEXT NOT NULL,
    reason TEXT NULL,
    created_at TEXT NOT NULL,
    is_synced INTEGER NOT NULL DEFAULT 0
);
```

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
