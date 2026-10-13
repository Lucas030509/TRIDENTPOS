-- Up
-- ============================================================================
-- TRIDENTPOS WP-022: CRM Customer Profiles & Loyalty Rewards Engine (RestCard)
-- Complies with DATA_MODEL.md Sec. 2.4 & 2.5, FUNCTIONAL_ARCHITECTURE.md Sec. 6
-- and ADR-002 / ADR-014 tenant isolation standards.
-- ============================================================================

-- 1. Clientes y Cuentas Corporativas (CRM)
CREATE TABLE IF NOT EXISTS customers (
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
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customers_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_customers_org_id UNIQUE (organization_id, id),
    CONSTRAINT chk_customers_credit_limit CHECK (credit_limit >= 0.0000),
    CONSTRAINT chk_customers_current_balance CHECK (current_balance >= 0.0000 OR allow_overdraft = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_customers_org_phone ON customers(organization_id, phone) WHERE phone IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON customers
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Direcciones de Entrega por Cliente (Delivery)
CREATE TABLE IF NOT EXISTS customer_delivery_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    customer_id UUID NOT NULL,
    street_and_number VARCHAR(255) NOT NULL,
    neighborhood VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    reference_notes TEXT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_addresses_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (organization_id, customer_id)
        REFERENCES customers(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE customer_delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_delivery_addresses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON customer_delivery_addresses
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Cuentas de Lealtad y Monedero RestCard (Loyalty Accounts)
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    customer_id UUID NOT NULL,
    card_number VARCHAR(50) NOT NULL,
    points_balance DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    wallet_balance DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    tier VARCHAR(20) NOT NULL DEFAULT 'BRONZE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_card UNIQUE (organization_id, card_number),
    CONSTRAINT uq_loyalty_accounts_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_loyalty_accounts_customer FOREIGN KEY (organization_id, customer_id)
        REFERENCES customers(organization_id, id),
    CONSTRAINT chk_loyalty_points_positive CHECK (points_balance >= 0.0000),
    CONSTRAINT chk_loyalty_wallet_positive CHECK (wallet_balance >= 0.0000),
    CONSTRAINT chk_loyalty_tier CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM'))
);

ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON loyalty_accounts
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Transacciones y Movimientos de Puntos/Monedero (Append-Only)
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    loyalty_account_id UUID NOT NULL,
    transaction_type VARCHAR(50) NOT NULL, -- EARN, REDEEM, TOP_UP, EXPIRE, REVERSAL
    points_delta DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    wallet_delta DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    reference_account_id VARCHAR(100) NOT NULL,
    reference_ticket_folio VARCHAR(100) NULL,
    notes TEXT NULL,
    reversal_of_transaction_id UUID NULL REFERENCES loyalty_transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_tx_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_loyalty_tx_account FOREIGN KEY (organization_id, loyalty_account_id)
        REFERENCES loyalty_accounts(organization_id, id),
    CONSTRAINT chk_loyalty_tx_type CHECK (transaction_type IN ('EARN', 'REDEEM', 'TOP_UP', 'EXPIRE', 'REVERSAL'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_account_date ON loyalty_transactions(loyalty_account_id, created_at DESC);

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON loyalty_transactions
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Append-only trigger: impide UPDATE y DELETE a nivel motor PostgreSQL
CREATE OR REPLACE FUNCTION trg_loyalty_transactions_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'loyalty_transactions is append-only. Direct UPDATE and DELETE are prohibited.'
        USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loyalty_tx_immutable
    BEFORE UPDATE OR DELETE ON loyalty_transactions
    FOR EACH ROW EXECUTE FUNCTION trg_loyalty_transactions_append_only();

-- 5. Promociones Corporativas (Promotions)
CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    promo_type VARCHAR(50) NOT NULL, -- PERCENTAGE, FIXED_AMOUNT, 2X1, BIRTHDAY, POINTS_MULTIPLIER
    discount_value DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_promotions_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_promotions_org_id UNIQUE (organization_id, id),
    CONSTRAINT chk_promotions_type CHECK (promo_type IN ('PERCENTAGE', 'FIXED_AMOUNT', '2X1', 'BIRTHDAY', 'POINTS_MULTIPLIER')),
    CONSTRAINT chk_promotions_discount CHECK (discount_value >= 0.0000)
);

CREATE INDEX IF NOT EXISTS idx_promotions_org_active ON promotions(organization_id, is_active, start_date, end_date);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON promotions
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
-- ============================================================================
-- Non-production rollback for WP-022 CRM & Loyalty
-- ============================================================================
DROP TRIGGER IF EXISTS trg_loyalty_tx_immutable ON loyalty_transactions;
DROP FUNCTION IF EXISTS trg_loyalty_transactions_append_only();
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS loyalty_transactions;
DROP TABLE IF EXISTS loyalty_accounts;
DROP TABLE IF EXISTS customer_delivery_addresses;
DROP TABLE IF EXISTS customers;
