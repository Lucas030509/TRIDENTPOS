-- Up
-- ============================================================================
-- TRIDENTPOS WP-021: Billing, Tax Schemes, Emisor Fiscal Config, CFDI Invoicing & Batch Lotes
-- Complies with DATA_MODEL.md Sec. 2.4, DATA_ARCHITECTURE.md, and ADR-002 / ADR-014 tenant isolation standards.
-- ============================================================================

-- 1. Tax Schemes (Esquemas de Impuestos Compuestos)
CREATE TABLE IF NOT EXISTS tax_schemes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    rate DECIMAL(6, 4) NOT NULL,
    is_inclusive BOOLEAN NOT NULL DEFAULT TRUE,
    tax_type VARCHAR(50) NOT NULL, -- IVA, IEPS, RETENCION_IVA, RETENCION_ISR, PROPINA_LEGAL, LOCAL
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tax_schemes_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_tax_schemes_org_id UNIQUE (organization_id, id),
    CONSTRAINT chk_tax_schemes_rate_non_negative CHECK (rate >= 0.0000)
);

ALTER TABLE tax_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_schemes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON tax_schemes
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Emisor Fiscal Config (Configuración del Emisor por Organización)
CREATE TABLE IF NOT EXISTS emisor_fiscal_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    rfc VARCHAR(50) NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    regimen_fiscal VARCHAR(10) NOT NULL,
    codigo_postal VARCHAR(10) NOT NULL,
    certificate_number VARCHAR(50) NULL,
    certificate_pem TEXT NULL,
    private_key_vault_id VARCHAR(255) NULL,
    valid_from TIMESTAMPTZ NULL,
    valid_to TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_emisor_config_org UNIQUE (organization_id),
    CONSTRAINT uq_emisor_config_org_id UNIQUE (organization_id, id)
);

ALTER TABLE emisor_fiscal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE emisor_fiscal_config FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON emisor_fiscal_config
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Fiscal Invoices (Comprobantes y Facturas Fiscales)
CREATE TABLE IF NOT EXISTS fiscal_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    invoice_uuid VARCHAR(100) NULL, -- UUID fiscal del PAC/SAT
    series VARCHAR(20) NOT NULL,
    folio VARCHAR(50) NOT NULL,
    customer_tax_id VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_regimen_fiscal VARCHAR(10) NOT NULL,
    customer_postal_code VARCHAR(10) NOT NULL,
    cfdi_use VARCHAR(10) NOT NULL,
    payment_method VARCHAR(10) NOT NULL,
    payment_way VARCHAR(10) NOT NULL,
    subtotal DECIMAL(12, 4) NOT NULL,
    tax_total DECIMAL(12, 4) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    status VARCHAR(50) NOT NULL, -- DRAFT, STAMPED, CANCELLED, REJECTED
    cancellation_reason VARCHAR(10) NULL,
    cancellation_replacement_uuid VARCHAR(100) NULL,
    stamped_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    xml_payload TEXT NULL,
    stamped_xml TEXT NULL,
    sello_emisor TEXT NULL,
    sello_sat TEXT NULL,
    cadena_original_hash VARCHAR(100) NULL,
    pac_request_reference_id VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_invoices_folio UNIQUE (organization_id, series, folio),
    CONSTRAINT uq_fiscal_invoices_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_fiscal_invoices_uuid UNIQUE (organization_id, invoice_uuid),
    CONSTRAINT uq_fiscal_invoices_pac_ref UNIQUE (organization_id, pac_request_reference_id),
    CONSTRAINT chk_fiscal_invoices_subtotal CHECK (subtotal >= 0.0000),
    CONSTRAINT chk_fiscal_invoices_tax_total CHECK (tax_total >= 0.0000),
    CONSTRAINT chk_fiscal_invoices_total CHECK (total_amount >= 0.0000),
    CONSTRAINT chk_fiscal_invoices_status CHECK (status IN ('DRAFT', 'STAMPED', 'CANCELLED', 'REJECTED'))
);

ALTER TABLE fiscal_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON fiscal_invoices
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Fiscal Invoice Line Items (Partidas de Factura Fiscal)
CREATE TABLE IF NOT EXISTS fiscal_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    invoice_id UUID NOT NULL,
    line_number INTEGER NOT NULL,
    product_code VARCHAR(100) NOT NULL,
    description VARCHAR(255) NOT NULL,
    sat_product_code VARCHAR(50) NOT NULL,
    sat_unit_code VARCHAR(50) NOT NULL,
    quantity DECIMAL(12, 4) NOT NULL,
    unit_price DECIMAL(12, 4) NOT NULL,
    subtotal DECIMAL(12, 4) NOT NULL,
    tax_amount DECIMAL(12, 4) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    tax_rate DECIMAL(6, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_invoice_items_line UNIQUE (organization_id, invoice_id, line_number),
    CONSTRAINT fk_fiscal_invoice_items_invoice FOREIGN KEY (organization_id, invoice_id)
        REFERENCES fiscal_invoices(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_fiscal_invoice_items_quantity CHECK (quantity > 0.0000),
    CONSTRAINT chk_fiscal_invoice_items_subtotal CHECK (subtotal >= 0.0000),
    CONSTRAINT chk_fiscal_invoice_items_tax CHECK (tax_amount >= 0.0000),
    CONSTRAINT chk_fiscal_invoice_items_total CHECK (total_amount >= 0.0000)
);

ALTER TABLE fiscal_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_invoice_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON fiscal_invoice_items
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 5. Lotes de Facturación Global (OQ-ARCH-02 Batch Infrastructure)
CREATE TABLE IF NOT EXISTS lotes_facturacion_global (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    batch_reference VARCHAR(100) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    ticket_folios TEXT[] NOT NULL,
    subtotal DECIMAL(12, 4) NOT NULL,
    tax_total DECIMAL(12, 4) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSED, FAILED
    fiscal_invoice_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lotes_facturacion_ref UNIQUE (organization_id, batch_reference),
    CONSTRAINT fk_lotes_facturacion_invoice FOREIGN KEY (organization_id, fiscal_invoice_id)
        REFERENCES fiscal_invoices(organization_id, id) ON DELETE SET NULL,
    CONSTRAINT chk_lotes_facturacion_subtotal CHECK (subtotal >= 0.0000),
    CONSTRAINT chk_lotes_facturacion_tax CHECK (tax_total >= 0.0000),
    CONSTRAINT chk_lotes_facturacion_total CHECK (total_amount >= 0.0000)
);

ALTER TABLE lotes_facturacion_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_facturacion_global FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON lotes_facturacion_global
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP TABLE IF EXISTS lotes_facturacion_global;
DROP TABLE IF EXISTS fiscal_invoice_items;
DROP TABLE IF EXISTS fiscal_invoices;
DROP TABLE IF EXISTS emisor_fiscal_config;
DROP TABLE IF EXISTS tax_schemes;
