/**
 * TRIDENTPOS Cash Management & Shift SQLite Schema DDL (WP-016 / DEC-017 / DATA_MODEL.md / ADR-004 / ADR-012)
 * All monetary amounts use scale-4 INTEGER (factor 10000n).
 */

export const CASH_SHIFT_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS turnos_caja (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL,
    responsible_user_id TEXT NOT NULL,
    opened_by_user_id TEXT NOT NULL,
    shift_number INTEGER NOT NULL DEFAULT 1,
    opening_cash_float INTEGER NOT NULL, -- Scale 4 (ADR-012)
    closing_declared_cash INTEGER NULL, -- Scale 4
    calculated_cash_total INTEGER NULL, -- Scale 4
    cash_difference INTEGER NULL, -- Scale 4
    status TEXT NOT NULL, -- ABIERTO, CERRADO_ARQUEO, CORTE_Z_EMITIDO
    assignment_strategy TEXT NOT NULL DEFAULT 'COMPARTIDO',
    opened_at TEXT NOT NULL,
    closed_at TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1, -- OCC Version
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turnos_caja_operadores (
    id TEXT PRIMARY KEY,
    turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id),
    operator_user_id TEXT NOT NULL,
    added_by_user_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE(turno_caja_id, operator_user_id)
);

CREATE TABLE IF NOT EXISTS movimientos_caja (
    id TEXT PRIMARY KEY,
    turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id),
    operator_user_id TEXT NOT NULL,
    movement_type TEXT NOT NULL, -- INGRESO, EGRESO, VENTA_EFECTIVO, DEVOLUCION_EFECTIVO, FONDO_INICIAL
    amount INTEGER NOT NULL, -- Scale 4
    reason TEXT NOT NULL,
    reference_id TEXT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arqueos_ciegos (
    id TEXT PRIMARY KEY,
    turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id),
    performed_by_user_id TEXT NOT NULL,
    declared_cash INTEGER NOT NULL, -- Scale 4
    calculated_cash INTEGER NOT NULL, -- Scale 4
    difference INTEGER NOT NULL, -- Scale 4
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cortes_caja (
    id TEXT PRIMARY KEY,
    turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id),
    tipo_corte TEXT NOT NULL, -- CORTE_X, CORTE_Z
    generated_by_user_id TEXT NOT NULL,
    opening_cash_float INTEGER NOT NULL, -- Scale 4
    total_ingresos INTEGER NOT NULL, -- Scale 4
    total_egresos INTEGER NOT NULL, -- Scale 4
    total_ventas_efectivo INTEGER NOT NULL, -- Scale 4
    total_calculado INTEGER NOT NULL, -- Scale 4
    total_declarado INTEGER NULL, -- Scale 4
    diferencia INTEGER NULL, -- Scale 4
    desglose_operadores_json TEXT NOT NULL,
    generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_audit_trail (
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

CREATE TABLE IF NOT EXISTS outbox_queue (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL DEFAULT 'org_default',
    branch_id TEXT NOT NULL DEFAULT 'branch_default',
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    action TEXT NOT NULL,
    client_op_id TEXT NOT NULL UNIQUE,
    aggregate_sequence_number INTEGER NOT NULL CHECK (aggregate_sequence_number >= 1),
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    receipt_token TEXT,
    receipt_verified_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    synced_at TEXT,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_turnos_station_status ON turnos_caja(station_id, status);
CREATE INDEX IF NOT EXISTS idx_movimientos_turno ON movimientos_caja(turno_caja_id);
CREATE INDEX IF NOT EXISTS idx_turnos_operadores_turno ON turnos_caja_operadores(turno_caja_id);
CREATE INDEX IF NOT EXISTS idx_cortes_turno ON cortes_caja(turno_caja_id);
CREATE INDEX IF NOT EXISTS idx_arqueos_turno ON arqueos_ciegos(turno_caja_id);
`;
