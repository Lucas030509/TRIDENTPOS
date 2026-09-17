-- Up
-- ============================================================================
-- TRIDENTPOS — WP-018: Real-Time Kárdex, Waste Tracking & KDS Depletion Service
-- Architecture Baselines: ACR-2026-017, DATA_MODEL.md Sec 2.3, ADR-007, ADR-012, ADR-013
-- Physical Objects:
-- 1. stock_ledger (authoritative append-only movement ledger)
-- 2. inventory_waste_records (governed waste evidence persistence)
-- 3. inventory_quarantine_records (durable modifier quarantine persistence)
-- ============================================================================

-- 1. Authoritative Inventory Stock Ledger (Kárdex)
CREATE TABLE stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    ingredient_id UUID NOT NULL,
    movement_type VARCHAR(50) NOT NULL,
    reference_event_id VARCHAR(100) NOT NULL,
    quantity_delta DECIMAL(12, 4) NOT NULL,
    unit_cost DECIMAL(12, 4) NOT NULL,
    total_cost DECIMAL(12, 4) NOT NULL,
    balance_after DECIMAL(12, 4) NOT NULL,
    movement_sequence_number BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_ledger_movement_type CHECK (movement_type IN ('COMPRA', 'CONSUMO_KDS', 'MERMA', 'AJUSTE_FISICO', 'TRANSFERENCIA')),
    CONSTRAINT chk_stock_ledger_quantity_delta_nonzero CHECK (quantity_delta <> 0.0000),
    CONSTRAINT uq_stock_ledger_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_stock_ledger_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_stock_ledger_warehouse FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses(organization_id, id),
    CONSTRAINT fk_stock_ledger_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id),
    CONSTRAINT uq_stock_ledger_seq UNIQUE (organization_id, branch_id, warehouse_id, ingredient_id, movement_sequence_number),
    CONSTRAINT uq_stock_ledger_idempotency UNIQUE (organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)
);

CREATE INDEX idx_stock_ledger_aggregate ON stock_ledger (organization_id, branch_id, warehouse_id, ingredient_id);
CREATE INDEX idx_stock_ledger_created_at ON stock_ledger (organization_id, created_at DESC);
CREATE INDEX idx_stock_ledger_reference_event ON stock_ledger (organization_id, reference_event_id);

-- Append-Only Trigger Enforcement Function for stock_ledger
CREATE OR REPLACE FUNCTION trg_stock_ledger_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Stock ledger is append-only: UPDATE and DELETE operations are strictly prohibited on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_ledger_immutable
    BEFORE UPDATE OR DELETE ON stock_ledger
    FOR EACH ROW
    EXECUTE FUNCTION trg_stock_ledger_append_only();

-- Row-Level Security: stock_ledger
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON stock_ledger
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Waste Evidence Records
CREATE TABLE inventory_waste_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    ingredient_id UUID NOT NULL,
    stock_ledger_id UUID NOT NULL,
    command_id VARCHAR(100) NOT NULL,
    reason_code VARCHAR(100) NOT NULL,
    photo_attachment_url TEXT NOT NULL,
    notes TEXT NULL,
    actor_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_waste_records_reason_nonempty CHECK (length(trim(reason_code)) > 0),
    CONSTRAINT chk_waste_records_photo_nonempty CHECK (length(trim(photo_attachment_url)) > 0),
    CONSTRAINT uq_waste_records_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_waste_records_org_cmd UNIQUE (organization_id, command_id),
    CONSTRAINT uq_waste_records_org_ledger UNIQUE (organization_id, stock_ledger_id),
    CONSTRAINT fk_waste_records_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_waste_records_warehouse FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses(organization_id, id),
    CONSTRAINT fk_waste_records_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id),
    CONSTRAINT fk_waste_records_ledger FOREIGN KEY (organization_id, stock_ledger_id) REFERENCES stock_ledger(organization_id, id),
    CONSTRAINT fk_waste_records_actor FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id)
);

CREATE INDEX idx_waste_records_org_branch ON inventory_waste_records (organization_id, branch_id);
CREATE INDEX idx_waste_records_org_cmd ON inventory_waste_records (organization_id, command_id);

-- Validation Trigger for Waste Record Semantic Integrity
CREATE OR REPLACE FUNCTION trg_validate_waste_record()
RETURNS TRIGGER AS $$
DECLARE
    v_movement_type VARCHAR(50);
    v_quantity_delta DECIMAL(12, 4);
    v_org_id UUID;
    v_branch_id UUID;
    v_warehouse_id UUID;
    v_ingredient_id UUID;
BEGIN
    SELECT movement_type, quantity_delta, organization_id, branch_id, warehouse_id, ingredient_id
    INTO v_movement_type, v_quantity_delta, v_org_id, v_branch_id, v_warehouse_id, v_ingredient_id
    FROM stock_ledger
    WHERE organization_id = NEW.organization_id AND id = NEW.stock_ledger_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced stock_ledger entry % not found for organization %', NEW.stock_ledger_id, NEW.organization_id;
    END IF;

    IF v_movement_type <> 'MERMA' THEN
        RAISE EXCEPTION 'Waste record must reference a stock_ledger movement of type MERMA, got %', v_movement_type;
    END IF;

    IF v_quantity_delta >= 0 THEN
        RAISE EXCEPTION 'Waste record must reference a negative stock_ledger quantity_delta, got %', v_quantity_delta;
    END IF;

    IF v_org_id <> NEW.organization_id OR v_branch_id <> NEW.branch_id OR v_warehouse_id <> NEW.warehouse_id OR v_ingredient_id <> NEW.ingredient_id THEN
        RAISE EXCEPTION 'Waste record tenant/branch/warehouse/ingredient does not match referenced stock_ledger entry';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_waste_record_integrity
    BEFORE INSERT OR UPDATE ON inventory_waste_records
    FOR EACH ROW
    EXECUTE FUNCTION trg_validate_waste_record();

-- Row-Level Security: inventory_waste_records
ALTER TABLE inventory_waste_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_waste_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON inventory_waste_records
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Modifier Depletion Quarantine Persistence
CREATE TABLE inventory_quarantine_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    source_event_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    reason VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replayed_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_quarantine_records_status CHECK (status IN ('PENDING', 'REPLAYED', 'REJECTED')),
    CONSTRAINT uq_quarantine_records_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_quarantine_records_source UNIQUE (organization_id, branch_id, source_event_id),
    CONSTRAINT fk_quarantine_records_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_quarantine_records_pending ON inventory_quarantine_records (organization_id, status) WHERE status = 'PENDING';

-- Row-Level Security: inventory_quarantine_records
ALTER TABLE inventory_quarantine_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_quarantine_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON inventory_quarantine_records
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory_quarantine_records;
ALTER TABLE IF EXISTS inventory_quarantine_records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_quarantine_records DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON inventory_waste_records;
ALTER TABLE IF EXISTS inventory_waste_records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_waste_records DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON stock_ledger;
ALTER TABLE IF EXISTS stock_ledger NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stock_ledger DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_waste_record_integrity ON inventory_waste_records;
DROP FUNCTION IF EXISTS trg_validate_waste_record();

DROP TRIGGER IF EXISTS trg_stock_ledger_immutable ON stock_ledger;
DROP FUNCTION IF EXISTS trg_stock_ledger_append_only();

DROP TABLE IF EXISTS inventory_quarantine_records;
DROP TABLE IF EXISTS inventory_waste_records;
DROP TABLE IF EXISTS stock_ledger;
