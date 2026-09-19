-- Up
-- ============================================================================
-- TRIDENTPOS — WP-019: Procurement, Supplier Management & Physical Receiving
-- Architecture Baselines: ACR-2026-018, DATA_MODEL.md Sec 2.3, ADR-007, ADR-012, ADR-013
-- Physical Objects:
-- 1. suppliers (commercial entity authority)
-- 2. purchase_orders (procurement document authority)
-- 3. purchase_order_items (line-item ordered quantities & costs)
-- 4. purchase_receipts (confirmed physical receiving authority)
-- 5. purchase_receipt_items (line-item received quantities & accepted costs)
-- ============================================================================

-- 1. Commercial Suppliers
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NOT NULL,
    credit_days INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_suppliers_code_nonempty CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_suppliers_trade_name_nonempty CHECK (length(trim(trade_name)) > 0),
    CONSTRAINT chk_suppliers_tax_id_nonempty CHECK (length(trim(tax_id)) > 0),
    CONSTRAINT chk_suppliers_credit_days_nonnegative CHECK (credit_days >= 0),
    CONSTRAINT uq_suppliers_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_suppliers_org_code UNIQUE (organization_id, code)
);

CREATE INDEX idx_suppliers_org_active ON suppliers (organization_id, is_active);
CREATE INDEX idx_suppliers_org_code ON suppliers (organization_id, code);

-- Row-Level Security: suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON suppliers
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Purchase Orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    supplier_id UUID NOT NULL,
    order_number VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    total_amount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_purchase_orders_number_nonempty CHECK (length(trim(order_number)) > 0),
    CONSTRAINT chk_purchase_orders_status CHECK (status IN ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT chk_purchase_orders_total_nonnegative CHECK (total_amount >= 0.0000),
    CONSTRAINT uq_purchase_orders_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_purchase_orders_org_branch_number UNIQUE (organization_id, branch_id, order_number),
    CONSTRAINT fk_purchase_orders_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id)
);

CREATE INDEX idx_purchase_orders_org_branch ON purchase_orders (organization_id, branch_id);
CREATE INDEX idx_purchase_orders_org_supplier ON purchase_orders (organization_id, supplier_id);
CREATE INDEX idx_purchase_orders_org_status ON purchase_orders (organization_id, status);

-- Row-Level Security: purchase_orders
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON purchase_orders
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Purchase Order Items
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    purchase_order_id UUID NOT NULL,
    ingredient_id UUID NOT NULL,
    ordered_quantity DECIMAL(12, 4) NOT NULL,
    unit_cost DECIMAL(12, 4) NOT NULL,
    line_amount DECIMAL(12, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_po_items_qty_positive CHECK (ordered_quantity > 0.0000),
    CONSTRAINT chk_po_items_cost_nonnegative CHECK (unit_cost >= 0.0000),
    CONSTRAINT chk_po_items_amount_nonnegative CHECK (line_amount >= 0.0000),
    CONSTRAINT uq_purchase_order_items_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_po_items_po FOREIGN KEY (organization_id, purchase_order_id) REFERENCES purchase_orders(organization_id, id),
    CONSTRAINT fk_po_items_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id)
);

CREATE INDEX idx_po_items_org_po ON purchase_order_items (organization_id, purchase_order_id);
CREATE INDEX idx_po_items_org_ingredient ON purchase_order_items (organization_id, ingredient_id);

-- Row-Level Security: purchase_order_items
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON purchase_order_items
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Purchase Receipts
CREATE TABLE purchase_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    supplier_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    receipt_number VARCHAR(100) NOT NULL,
    invoice_reference VARCHAR(100) NULL,
    total_amount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_purchase_receipts_number_nonempty CHECK (length(trim(receipt_number)) > 0),
    CONSTRAINT chk_purchase_receipts_status CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    CONSTRAINT chk_purchase_receipts_total_nonnegative CHECK (total_amount >= 0.0000),
    CONSTRAINT uq_purchase_receipts_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_purchase_receipts_org_branch_number UNIQUE (organization_id, branch_id, receipt_number),
    CONSTRAINT fk_purchase_receipts_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_purchase_receipts_po FOREIGN KEY (organization_id, purchase_order_id) REFERENCES purchase_orders(organization_id, id),
    CONSTRAINT fk_purchase_receipts_supplier FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id),
    CONSTRAINT fk_purchase_receipts_warehouse FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses(organization_id, id)
);

CREATE INDEX idx_purchase_receipts_org_branch ON purchase_receipts (organization_id, branch_id);
CREATE INDEX idx_purchase_receipts_org_po ON purchase_receipts (organization_id, purchase_order_id);
CREATE INDEX idx_purchase_receipts_org_supplier ON purchase_receipts (organization_id, supplier_id);
CREATE INDEX idx_purchase_receipts_org_wh ON purchase_receipts (organization_id, warehouse_id);

-- Row-Level Security: purchase_receipts
ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON purchase_receipts
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 5. Purchase Receipt Items
CREATE TABLE purchase_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    purchase_receipt_id UUID NOT NULL,
    purchase_order_item_id UUID NOT NULL,
    ingredient_id UUID NOT NULL,
    received_quantity DECIMAL(12, 4) NOT NULL,
    accepted_unit_cost DECIMAL(12, 4) NOT NULL,
    line_amount DECIMAL(12, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_receipt_items_qty_positive CHECK (received_quantity > 0.0000),
    CONSTRAINT chk_receipt_items_cost_nonnegative CHECK (accepted_unit_cost >= 0.0000),
    CONSTRAINT chk_receipt_items_amount_nonnegative CHECK (line_amount >= 0.0000),
    CONSTRAINT uq_purchase_receipt_items_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_receipt_items_receipt FOREIGN KEY (organization_id, purchase_receipt_id) REFERENCES purchase_receipts(organization_id, id),
    CONSTRAINT fk_receipt_items_po_item FOREIGN KEY (organization_id, purchase_order_item_id) REFERENCES purchase_order_items(organization_id, id),
    CONSTRAINT fk_receipt_items_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id)
);

CREATE INDEX idx_receipt_items_org_receipt ON purchase_receipt_items (organization_id, purchase_receipt_id);
CREATE INDEX idx_receipt_items_org_po_item ON purchase_receipt_items (organization_id, purchase_order_item_id);
CREATE INDEX idx_receipt_items_org_ingredient ON purchase_receipt_items (organization_id, ingredient_id);

-- Row-Level Security: purchase_receipt_items
ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON purchase_receipt_items
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
-- ============================================================================
-- Reverse dependency order clean drops — ZERO CASCADE to protect core tables
-- ============================================================================
DROP TABLE IF EXISTS purchase_receipt_items;
DROP TABLE IF EXISTS purchase_receipts;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS suppliers;
