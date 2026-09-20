-- Up
-- ============================================================================
-- TRIDENTPOS — WP-020: Finance, Accounts Payable/Receivable & Cash Reconciliation
-- Architecture Baselines: DATA_MODEL.md Sec 2.4, FUNCTIONAL_ARCHITECTURE.md Sec 6.3, ADR-001, ADR-007, ADR-012
-- Physical Objects:
-- 1. accounts_payable (Finance-owned liability from confirmed physical receipts)
-- 2. accounts_payable_payments (Finance-owned immutable append-only AP payment transactions & reversals)
-- 3. scheduled_payments (Finance-owned scheduling intent for AP settlements)
-- 4. accounts_receivable (Finance-owned customer balances & charges)
-- 5. accounts_receivable_settlements (Finance-owned immutable append-only AR settlement transactions & reversals)
-- 6. branch_operating_expenses (Finance-owned petty cash / operating expenses)
-- 7. cash_reconciliations (Finance-owned daily cash variance reconciliation from Corte Z)
-- ============================================================================

-- 1. Accounts Payable (AP)
CREATE TABLE accounts_payable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    supplier_id UUID NOT NULL,
    purchase_receipt_id UUID NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    balance_due DECIMAL(12, 4) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ap_total_positive CHECK (total_amount > 0.0000),
    CONSTRAINT chk_ap_balance_nonnegative CHECK (balance_due >= 0.0000),
    CONSTRAINT chk_ap_balance_le_total CHECK (balance_due <= total_amount),
    CONSTRAINT chk_ap_status CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED')),
    CONSTRAINT uq_accounts_payable_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_ap_org_receipt UNIQUE (organization_id, purchase_receipt_id),
    CONSTRAINT fk_ap_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_ap_org_branch ON accounts_payable (organization_id, branch_id);
CREATE INDEX idx_ap_org_supplier ON accounts_payable (organization_id, supplier_id);
CREATE INDEX idx_ap_org_status ON accounts_payable (organization_id, status);
CREATE INDEX idx_ap_org_receipt ON accounts_payable (organization_id, purchase_receipt_id);

-- Row-Level Security: accounts_payable
ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON accounts_payable
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Accounts Payable Payments (Immutable Append-Only Transaction History)
CREATE TABLE accounts_payable_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    accounts_payable_id UUID NOT NULL,
    transaction_kind VARCHAR(50) NOT NULL,
    amount DECIMAL(12, 4) NOT NULL,
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_id VARCHAR(100) NOT NULL,
    reversal_of_transaction_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ap_pay_kind CHECK (transaction_kind IN ('APPLY', 'REVERSAL')),
    CONSTRAINT chk_ap_pay_amount_positive CHECK (amount > 0.0000),
    CONSTRAINT chk_ap_pay_reference_nonempty CHECK (length(trim(reference_id)) > 0),
    CONSTRAINT uq_accounts_payable_payments_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_ap_payments_org_ref UNIQUE (organization_id, reference_id),
    CONSTRAINT fk_ap_payments_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_ap_payments_ap FOREIGN KEY (organization_id, accounts_payable_id) REFERENCES accounts_payable(organization_id, id),
    CONSTRAINT fk_ap_payments_reversal FOREIGN KEY (organization_id, reversal_of_transaction_id) REFERENCES accounts_payable_payments(organization_id, id)
);

CREATE INDEX idx_ap_pay_org_ap ON accounts_payable_payments (organization_id, accounts_payable_id);
CREATE INDEX idx_ap_pay_org_ref ON accounts_payable_payments (organization_id, reference_id);
CREATE INDEX idx_ap_pay_org_reversal ON accounts_payable_payments (organization_id, reversal_of_transaction_id);

-- Append-Only Trigger Function for Finance Transactions
CREATE OR REPLACE FUNCTION trg_finance_payments_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is immutable append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ap_payments_immutable
    BEFORE UPDATE OR DELETE ON accounts_payable_payments
    FOR EACH ROW
    EXECUTE FUNCTION trg_finance_payments_append_only();

-- Row-Level Security: accounts_payable_payments
ALTER TABLE accounts_payable_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON accounts_payable_payments
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Scheduled Payments
CREATE TABLE scheduled_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    accounts_payable_id UUID NOT NULL,
    scheduled_amount DECIMAL(12, 4) NOT NULL,
    scheduled_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sched_pay_amount_positive CHECK (scheduled_amount > 0.0000),
    CONSTRAINT chk_sched_pay_status CHECK (status IN ('PENDING', 'EXECUTED', 'CANCELLED')),
    CONSTRAINT uq_scheduled_payments_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_sched_pay_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_sched_pay_ap FOREIGN KEY (organization_id, accounts_payable_id) REFERENCES accounts_payable(organization_id, id)
);

CREATE INDEX idx_sched_pay_org_ap ON scheduled_payments (organization_id, accounts_payable_id);
CREATE INDEX idx_sched_pay_org_date ON scheduled_payments (organization_id, scheduled_date);

-- Row-Level Security: scheduled_payments
ALTER TABLE scheduled_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON scheduled_payments
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Accounts Receivable (AR)
CREATE TABLE accounts_receivable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    reference_account_id VARCHAR(100) NOT NULL,
    total_amount DECIMAL(12, 4) NOT NULL,
    balance_due DECIMAL(12, 4) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ar_total_positive CHECK (total_amount > 0.0000),
    CONSTRAINT chk_ar_balance_nonnegative CHECK (balance_due >= 0.0000),
    CONSTRAINT chk_ar_balance_le_total CHECK (balance_due <= total_amount),
    CONSTRAINT chk_ar_status CHECK (status IN ('PENDING', 'PAID', 'OVERDUE', 'DEFAULTED')),
    CONSTRAINT chk_ar_reference_account_nonempty CHECK (length(trim(reference_account_id)) > 0),
    CONSTRAINT uq_accounts_receivable_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_ar_org_reference UNIQUE (organization_id, reference_account_id),
    CONSTRAINT fk_ar_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_ar_org_branch ON accounts_receivable (organization_id, branch_id);
CREATE INDEX idx_ar_org_customer ON accounts_receivable (organization_id, customer_id);
CREATE INDEX idx_ar_org_status ON accounts_receivable (organization_id, status);
CREATE INDEX idx_ar_org_reference ON accounts_receivable (organization_id, reference_account_id);

-- Row-Level Security: accounts_receivable
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON accounts_receivable
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 5. Accounts Receivable Settlements (Immutable Append-Only Transaction History)
CREATE TABLE accounts_receivable_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    accounts_receivable_id UUID NOT NULL,
    transaction_kind VARCHAR(50) NOT NULL,
    amount DECIMAL(12, 4) NOT NULL,
    settlement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_id VARCHAR(100) NOT NULL,
    reversal_of_transaction_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ar_settle_kind CHECK (transaction_kind IN ('APPLY', 'REVERSAL')),
    CONSTRAINT chk_ar_settle_amount_positive CHECK (amount > 0.0000),
    CONSTRAINT chk_ar_settle_reference_nonempty CHECK (length(trim(reference_id)) > 0),
    CONSTRAINT uq_accounts_receivable_settlements_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_ar_settlements_org_ref UNIQUE (organization_id, reference_id),
    CONSTRAINT fk_ar_settlements_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT fk_ar_settlements_ar FOREIGN KEY (organization_id, accounts_receivable_id) REFERENCES accounts_receivable(organization_id, id),
    CONSTRAINT fk_ar_settlements_reversal FOREIGN KEY (organization_id, reversal_of_transaction_id) REFERENCES accounts_receivable_settlements(organization_id, id)
);

CREATE INDEX idx_ar_settle_org_ar ON accounts_receivable_settlements (organization_id, accounts_receivable_id);
CREATE INDEX idx_ar_settle_org_ref ON accounts_receivable_settlements (organization_id, reference_id);
CREATE INDEX idx_ar_settle_org_reversal ON accounts_receivable_settlements (organization_id, reversal_of_transaction_id);

CREATE TRIGGER trg_ar_settlements_immutable
    BEFORE UPDATE OR DELETE ON accounts_receivable_settlements
    FOR EACH ROW
    EXECUTE FUNCTION trg_finance_payments_append_only();

-- Row-Level Security: accounts_receivable_settlements
ALTER TABLE accounts_receivable_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable_settlements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON accounts_receivable_settlements
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 6. Branch Operating Expenses
CREATE TABLE branch_operating_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    amount DECIMAL(12, 4) NOT NULL,
    expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    category VARCHAR(100) NOT NULL,
    receipt_attachment_url TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_expense_amount_positive CHECK (amount > 0.0000),
    CONSTRAINT chk_expense_category_nonempty CHECK (length(trim(category)) > 0),
    CONSTRAINT uq_branch_operating_expenses_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_expense_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_expense_org_branch ON branch_operating_expenses (organization_id, branch_id);
CREATE INDEX idx_expense_org_date ON branch_operating_expenses (organization_id, expense_date);

-- Row-Level Security: branch_operating_expenses
ALTER TABLE branch_operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_operating_expenses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON branch_operating_expenses
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 7. Cash Reconciliations
CREATE TABLE cash_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    source_cut_id VARCHAR(100) NOT NULL,
    operational_date DATE NOT NULL,
    expected_cash DECIMAL(12, 4) NOT NULL,
    actual_cash DECIMAL(12, 4) NOT NULL,
    variance DECIMAL(12, 4) NOT NULL,
    has_variance BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cash_rec_source_cut_nonempty CHECK (length(trim(source_cut_id)) > 0),
    CONSTRAINT uq_cash_reconciliations_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_cash_rec_org_source_cut UNIQUE (organization_id, source_cut_id),
    CONSTRAINT fk_cash_rec_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_cash_rec_org_branch ON cash_reconciliations (organization_id, branch_id);
CREATE INDEX idx_cash_rec_org_date ON cash_reconciliations (organization_id, operational_date);

-- Row-Level Security: cash_reconciliations
ALTER TABLE cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reconciliations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cash_reconciliations
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP TABLE IF EXISTS accounts_receivable_settlements CASCADE;
DROP TABLE IF EXISTS accounts_payable_payments CASCADE;
DROP TABLE IF EXISTS cash_reconciliations CASCADE;
DROP TABLE IF EXISTS branch_operating_expenses CASCADE;
DROP TABLE IF EXISTS scheduled_payments CASCADE;
DROP TABLE IF EXISTS accounts_receivable CASCADE;
DROP TABLE IF EXISTS accounts_payable CASCADE;
DROP FUNCTION IF EXISTS trg_finance_payments_append_only() CASCADE;
