/**
 * TRIDENTPOS KDS Edge SQLite Schema DDL (WP-015)
 * Data Objects per IMPLEMENTATION_PLAN.md WP-015 entry: kds_estaciones,
 * kds_tickets, kds_ticket_partidas, impresoras_red.
 *
 * Conflict policy per DATA_AUTHORITY_MATRIX.md ("KDS (Preparacion Cocina/
 * Barra)" row): Causal Sequence Number, not OCC compare-and-swap -- writes
 * are append/advance only, so no `version` column is required on kds_tickets
 * (unlike mesas/cuentas). The print queue (print_status/print_attempts/
 * printer_id/last_print_error) is modeled as columns on kds_tickets itself
 * rather than a separate table: DATA_AUTHORITY_MATRIX.md has no row for a
 * distinct "printer queue" entity, and a KDS ticket IS the physical print
 * job for that comanda -- a separate queue table would be a second source
 * of truth for the same fact.
 */

export const KDS_EDGE_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS kds_estaciones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    station_type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS impresoras_red (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 9100,
    kds_estacion_id TEXT NULL REFERENCES kds_estaciones(id),
    status TEXT NOT NULL DEFAULT 'UNKNOWN',
    last_seen_at TEXT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kds_tickets (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL,
    mesa_reference TEXT NOT NULL,
    kds_estacion_id TEXT NOT NULL REFERENCES kds_estaciones(id),
    urgency_level TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL,
    print_status TEXT NOT NULL DEFAULT 'PENDING',
    print_attempts INTEGER NOT NULL DEFAULT 0,
    printer_id TEXT NULL REFERENCES impresoras_red(id),
    last_print_error TEXT NULL,
    aggregate_sequence_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS kds_ticket_partidas (
    id TEXT PRIMARY KEY,
    kds_ticket_id TEXT NOT NULL REFERENCES kds_tickets(id),
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    quantity TEXT NOT NULL,
    comments TEXT NULL,
    modifiers_snapshot TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kds_tickets_estacion ON kds_tickets(kds_estacion_id);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_status ON kds_tickets(status);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_print_status ON kds_tickets(print_status);
CREATE INDEX IF NOT EXISTS idx_kds_ticket_partidas_ticket ON kds_ticket_partidas(kds_ticket_id);
CREATE INDEX IF NOT EXISTS idx_impresoras_red_estacion ON impresoras_red(kds_estacion_id);
`;
