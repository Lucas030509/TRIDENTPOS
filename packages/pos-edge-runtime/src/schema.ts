/**
 * TRIDENTPOS Edge SQLite Schema DDL
 * Conforms strictly to DATA_MODEL.md Sec. 3 & ADR-012.
 * All monetary and tax columns use scale-4 INTEGER (factor 10000n).
 */

export const POS_EDGE_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS mesas (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    table_number TEXT NOT NULL,
    status TEXT NOT NULL,
    current_account_id TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuentas (
    id TEXT PRIMARY KEY,
    folio_number INTEGER NULL,
    epoch_id TEXT NOT NULL,
    mesa_id TEXT NULL,
    account_type TEXT NOT NULL,
    status TEXT NOT NULL,
    subtotal INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    discounts_total INTEGER NOT NULL DEFAULT 0,
    tips_total INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    opened_by_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuenta_items (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL REFERENCES cuentas(id),
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    unit_price_applied INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    tax_rate_applied INTEGER NOT NULL,
    tax_amount_applied INTEGER NOT NULL,
    discount_amount_applied INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuenta_item_modificadores (
    id TEXT PRIMARY KEY,
    cuenta_item_id TEXT NOT NULL REFERENCES cuenta_items(id),
    modifier_id TEXT NOT NULL,
    modifier_name_snapshot TEXT NOT NULL,
    modifier_price_applied INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cuentas_mesa ON cuentas(mesa_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_status ON cuentas(status);
CREATE INDEX IF NOT EXISTS idx_cuenta_items_cuenta ON cuenta_items(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cuenta_item_modificadores_item ON cuenta_item_modificadores(cuenta_item_id);
`;
