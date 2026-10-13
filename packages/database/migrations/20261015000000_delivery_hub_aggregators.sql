-- Up
-- ============================================================================
-- TRIDENTPOS Migration: 20261015000000_delivery_hub_aggregators.sql
-- Work Package: WP-023 Delivery Hub & Aggregator Webhooks
-- Tables: delivery_integrations, external_orders, webhook_events
-- Architecture: ADR-007, ADR-012, SEC-VAL-10, Multi-Tenant RLS Forced
-- ============================================================================

-- 1. Table: delivery_integrations (integraciones_delivery)
CREATE TABLE IF NOT EXISTS delivery_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    store_external_id VARCHAR(128) NOT NULL,
    webhook_secret VARCHAR(255) NOT NULL,
    api_key VARCHAR(255),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_accept_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_order_amount NUMERIC(14,4) DEFAULT 0.0000,
    max_order_amount NUMERIC(14,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_delivery_integrations_org_branch_channel UNIQUE (organization_id, branch_id, channel),
    CONSTRAINT chk_delivery_channel CHECK (channel IN ('UBER_EATS', 'RAPPI', 'DIDIFOOD', 'DIRECT_FLEET')),
    CONSTRAINT chk_delivery_min_positive CHECK (min_order_amount IS NULL OR min_order_amount >= 0.0000),
    CONSTRAINT chk_delivery_max_positive CHECK (max_order_amount IS NULL OR max_order_amount >= 0.0000)
);

CREATE INDEX IF NOT EXISTS idx_delivery_integrations_org_channel
    ON delivery_integrations (organization_id, channel, is_enabled);

ALTER TABLE delivery_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_integrations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_delivery_integrations ON delivery_integrations
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Table: external_orders (pedidos_externos)
CREATE TABLE IF NOT EXISTS external_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    external_order_id VARCHAR(128) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(32),
    delivery_address TEXT,
    delivery_notes TEXT,
    courier_name VARCHAR(255),
    courier_phone VARCHAR(32),
    subtotal NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    tax_total NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    platform_commission NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    delivery_fee NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    customer_tip NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    grand_total NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
    rejection_reason VARCHAR(255),
    kds_comanda_id UUID,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_external_orders_org_channel_order UNIQUE (organization_id, channel, external_order_id),
    CONSTRAINT chk_ext_order_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'CANCELLED')),
    CONSTRAINT chk_ext_order_channel CHECK (channel IN ('UBER_EATS', 'RAPPI', 'DIDIFOOD', 'DIRECT_FLEET')),
    CONSTRAINT chk_ext_subtotal_positive CHECK (subtotal >= 0.0000),
    CONSTRAINT chk_ext_grand_total_positive CHECK (grand_total >= 0.0000)
);

CREATE INDEX IF NOT EXISTS idx_external_orders_org_status
    ON external_orders (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_orders_org_event
    ON external_orders (organization_id, event_id);

ALTER TABLE external_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_external_orders ON external_orders
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Table: webhook_events (webhook_eventos)
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    signature VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    error_detail TEXT,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_webhook_events_org_channel_event UNIQUE (organization_id, channel, event_id),
    CONSTRAINT chk_webhook_event_status CHECK (status IN ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED')),
    CONSTRAINT chk_webhook_event_channel CHECK (channel IN ('UBER_EATS', 'RAPPI', 'DIDIFOOD', 'DIRECT_FLEET'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_org_event
    ON webhook_events (organization_id, channel, event_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhook_events ON webhook_events
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_webhook_events ON webhook_events;
DROP TABLE IF EXISTS webhook_events CASCADE;

DROP POLICY IF EXISTS tenant_isolation_external_orders ON external_orders;
DROP TABLE IF EXISTS external_orders CASCADE;

DROP POLICY IF EXISTS tenant_isolation_delivery_integrations ON delivery_integrations;
DROP TABLE IF EXISTS delivery_integrations CASCADE;
