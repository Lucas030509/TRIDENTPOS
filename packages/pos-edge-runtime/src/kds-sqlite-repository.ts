/**
 * TRIDENTPOS Edge SQLite KDS & Printer Persistence Adapter (WP-015, ACR-2026-016)
 * Implements KdsRepositoryPort and PrinterRepositoryPort from @trident/pos.
 * Adapts to EdgeDatabaseService per DATA_AUTHORITY_MATRIX.md and DATA_MODEL.md
 * conventions established by WP-014's SqliteDiningRoomRepository.
 * Enforces ADR-012 scale-4 integer quantity persistence.
 */

import {
  type ImpresoraRed,
  type KdsEstacion,
  type KdsEstacionStatus,
  type KdsEstacionType,
  type KdsRepositoryPort,
  type KdsTicket,
  type KdsTicketPartida,
  type KdsTicketPartidaModificadorSnapshot,
  type KdsTicketPartidaStatus,
  type KdsTicketStatus,
  type PrinterRepositoryPort,
  type PrinterStatus,
  type PrintJobStatus,
  type UrgencyLevel,
} from '@trident/pos';
import { EdgeDatabaseService } from '@trident/edge';
import { KDS_EDGE_SQLITE_SCHEMA } from './kds-schema.js';

interface KdsEstacionRow {
  id: string;
  name: string;
  station_type: string;
  status: string;
  created_at: string;
}

interface ImpresoraRedRow {
  id: string;
  name: string;
  host: string;
  port: number;
  kds_estacion_id: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

interface KdsTicketRow {
  id: string;
  cuenta_id: string;
  mesa_reference: string;
  kds_estacion_id: string;
  urgency_level: string;
  status: string;
  print_status: string;
  print_attempts: number;
  printer_id: string | null;
  last_print_error: string | null;
  aggregate_sequence_number: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  preparation_time_minutes: number | null;
}

interface KdsTicketPartidaRow {
  id: string;
  kds_ticket_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number | bigint;
  comments: string | null;
  modifiers_snapshot: string;
  status: string;
  created_at: string;
}

export class SqliteKdsRepository implements KdsRepositoryPort, PrinterRepositoryPort {
  readonly #db: EdgeDatabaseService;

  constructor(db: EdgeDatabaseService) {
    this.#db = db;
    this.bootstrapSchema();
    this.recoverInterruptedPrintingJobs();
  }

  public bootstrapSchema(): void {
    this.#db.executeSchema(KDS_EDGE_SQLITE_SCHEMA);
  }


  // ==========================================
  // KDS Estacion helpers (test/bootstrap convenience -- not part of the
  // port interface, but required for any caller to actually create
  // stations/printers before tickets can be routed to them).
  // ==========================================

  public createEstacion(estacion: {
    id: string;
    name: string;
    stationType: KdsEstacionType;
    status?: KdsEstacionStatus;
  }): KdsEstacion {
    const now = new Date().toISOString();
    this.#db.executeMutation(
      `INSERT INTO kds_estaciones (id, name, station_type, status, created_at) VALUES (?, ?, ?, ?, ?);`,
      estacion.id,
      estacion.name,
      estacion.stationType,
      estacion.status ?? 'ACTIVA',
      now,
    );
    const created = this.getEstacionById(estacion.id);
    if (!created) {
      throw new Error(`Failed to persist kds_estacion '${estacion.id}'`);
    }
    return created;
  }

  public createPrinter(printer: {
    id: string;
    name: string;
    host: string;
    port?: number;
    kdsEstacionId?: string | null;
  }): ImpresoraRed {
    const now = new Date().toISOString();
    this.#db.executeMutation(
      `INSERT INTO impresoras_red (id, name, host, port, kds_estacion_id, status, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'UNKNOWN', NULL, ?);`,
      printer.id,
      printer.name,
      printer.host,
      printer.port ?? 9100,
      printer.kdsEstacionId ?? null,
      now,
    );
    const created = this.getPrinterById(printer.id);
    if (!created) {
      throw new Error(`Failed to persist impresora_red '${printer.id}'`);
    }
    return created;
  }

  // ==========================================
  // KdsRepositoryPort
  // ==========================================

  public getEstacionById(id: string): KdsEstacion | null {
    const row = this.#db.queryRow<KdsEstacionRow>(
      `SELECT id, name, station_type, status, created_at FROM kds_estaciones WHERE id = ?;`,
      id,
    );
    return row ? this.#mapEstacion(row) : null;
  }

  public listEstaciones(): readonly KdsEstacion[] {
    const rows = this.#db.queryRows<KdsEstacionRow>(
      `SELECT id, name, station_type, status, created_at FROM kds_estaciones ORDER BY name ASC;`,
    );
    return rows.map((r) => this.#mapEstacion(r));
  }

  public getTicketById(id: string): KdsTicket | null {
    const row = this.#db.queryRow<KdsTicketRow>(
      `SELECT id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status,
              print_status, print_attempts, printer_id, last_print_error,
              aggregate_sequence_number, created_at, updated_at, completed_at,
              preparation_time_minutes
       FROM kds_tickets WHERE id = ?;`,
      id,
    );
    if (!row) return null;
    return this.#mapTicket(row, this.#loadPartidas(row.id));
  }

  public saveTicket(ticket: KdsTicket): KdsTicket {
    const existing = this.getTicketById(ticket.id);
    if (!existing) {
      this.#db.runInTransaction(() => {
        this.#db.executeMutation(
          `INSERT INTO kds_tickets (
             id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status,
             print_status, print_attempts, printer_id, last_print_error,
             aggregate_sequence_number, created_at, updated_at, completed_at,
             preparation_time_minutes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ticket.id,
          ticket.cuentaId,
          ticket.mesaReference,
          ticket.kdsEstacionId,
          ticket.urgencyLevel,
          ticket.status,
          ticket.printStatus,
          ticket.printAttempts,
          ticket.printerId,
          ticket.lastPrintError,
          ticket.aggregateSequenceNumber,
          ticket.createdAt,
          ticket.updatedAt,
          ticket.completedAt,
          ticket.preparationTimeMinutes,
        );
        this.#persistPartidas(ticket.id, ticket.partidas);
      });
      return ticket;
    }

    this.#db.runInTransaction(() => {
      this.#db.executeMutation(
        `UPDATE kds_tickets SET
           mesa_reference = ?, urgency_level = ?, status = ?,
           print_status = ?, print_attempts = ?, printer_id = ?, last_print_error = ?,
           updated_at = ?, completed_at = ?, preparation_time_minutes = ?
         WHERE id = ?;`,
        ticket.mesaReference,
        ticket.urgencyLevel,
        ticket.status,
        ticket.printStatus,
        ticket.printAttempts,
        ticket.printerId,
        ticket.lastPrintError,
        ticket.updatedAt,
        ticket.completedAt,
        ticket.preparationTimeMinutes,
        ticket.id,
      );
      this.#persistPartidas(ticket.id, ticket.partidas);
    });
    return ticket;
  }

  public listActiveTicketsByEstacion(kdsEstacionId: string): readonly KdsTicket[] {
    const rows = this.#db.queryRows<KdsTicketRow>(
      `SELECT id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status,
              print_status, print_attempts, printer_id, last_print_error,
              aggregate_sequence_number, created_at, updated_at, completed_at,
              preparation_time_minutes
       FROM kds_tickets
       WHERE kds_estacion_id = ? AND status != 'ENTREGADO'
       ORDER BY aggregate_sequence_number ASC;`,
      kdsEstacionId,
    );
    return rows.map((r) => this.#mapTicket(r, this.#loadPartidas(r.id)));
  }

  /**
   * `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)`
   * Queries exactly one KDS ticket by identity, using `completed_at` as the recall anchor.
   * Non-mutating operation.
   */
  public getTicketForRecall(ordenProduccionId: string, windowMinutes: number): KdsTicket | null {
    const row = this.#db.queryRow<KdsTicketRow>(
      `SELECT id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status,
              print_status, print_attempts, printer_id, last_print_error,
              aggregate_sequence_number, created_at, updated_at, completed_at,
              preparation_time_minutes
       FROM kds_tickets
       WHERE id = ?;`,
      ordenProduccionId,
    );
    if (!row || !row.completed_at) {
      return null;
    }

    const completedEpoch = Date.parse(row.completed_at);
    if (Number.isNaN(completedEpoch)) {
      return null;
    }

    const now = Date.now();
    const elapsedMinutes = (now - completedEpoch) / 60_000;
    if (elapsedMinutes < 0 || elapsedMinutes > windowMinutes) {
      return null;
    }

    return this.#mapTicket(row, this.#loadPartidas(row.id));
  }

  // ==========================================
  // PrinterRepositoryPort
  // ==========================================

  public getPrinterById(id: string): ImpresoraRed | null {
    const row = this.#db.queryRow<ImpresoraRedRow>(
      `SELECT id, name, host, port, kds_estacion_id, status, last_seen_at, created_at
       FROM impresoras_red WHERE id = ?;`,
      id,
    );
    return row ? this.#mapPrinter(row) : null;
  }

  public listPrinters(): readonly ImpresoraRed[] {
    const rows = this.#db.queryRows<ImpresoraRedRow>(
      `SELECT id, name, host, port, kds_estacion_id, status, last_seen_at, created_at
       FROM impresoras_red ORDER BY name ASC;`,
    );
    return rows.map((r) => this.#mapPrinter(r));
  }

  public updatePrinterStatus(id: string, status: PrinterStatus, lastSeenAt: string): void {
    this.#db.executeMutation(
      `UPDATE impresoras_red SET status = ?, last_seen_at = ? WHERE id = ?;`,
      status,
      lastSeenAt,
      id,
    );
  }

  public listPendingPrintJobs(): readonly KdsTicket[] {
    const rows = this.#db.queryRows<KdsTicketRow>(
      `SELECT id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status,
              print_status, print_attempts, printer_id, last_print_error,
              aggregate_sequence_number, created_at, updated_at, completed_at,
              preparation_time_minutes
       FROM kds_tickets
       WHERE print_status IN ('PENDING', 'QUEUED', 'FAILED')
       ORDER BY aggregate_sequence_number ASC;`,
    );
    return rows.map((r) => this.#mapTicket(r, this.#loadPartidas(r.id)));
  }

  public recoverInterruptedPrintingJobs(): readonly KdsTicket[] {
    const interruptedRows = this.#db.queryRows<KdsTicketRow>(
      `SELECT id FROM kds_tickets WHERE print_status = 'PRINTING';`,
    );
    if (interruptedRows.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    this.#db.executeMutation(
      `UPDATE kds_tickets
       SET print_status = 'QUEUED',
           last_print_error = 'RECOVERED_AFTER_RESTART_DURING_PRINTING',
           updated_at = ?
       WHERE print_status = 'PRINTING';`,
      now,
    );
    return interruptedRows.map((r) => this.getTicketById(r.id)!);
  }

  public markTicketPrintAttempt(
    id: string,
    result: { status: PrintJobStatus; attempts: number; lastPrintError: string | null },
  ): void {
    this.#db.executeMutation(
      `UPDATE kds_tickets SET print_status = ?, print_attempts = ?, last_print_error = ?, updated_at = ?
       WHERE id = ?;`,
      result.status,
      result.attempts,
      result.lastPrintError,
      new Date().toISOString(),
      id,
    );
  }

  public assignPrinterToTicket(ticketId: string, printerId: string): void {
    this.#db.executeMutation(`UPDATE kds_tickets SET printer_id = ? WHERE id = ?;`, printerId, ticketId);
  }

  // ==========================================
  // Mapping helpers
  // ==========================================

  #mapEstacion(row: KdsEstacionRow): KdsEstacion {
    return {
      id: row.id,
      name: row.name,
      stationType: row.station_type as KdsEstacionType,
      status: row.status as KdsEstacionStatus,
      createdAt: row.created_at,
    };
  }

  #mapPrinter(row: ImpresoraRedRow): ImpresoraRed {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: Number(row.port),
      kdsEstacionId: row.kds_estacion_id,
      status: row.status as PrinterStatus,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }

  #mapTicket(row: KdsTicketRow, partidas: readonly KdsTicketPartida[]): KdsTicket {
    return {
      id: row.id,
      cuentaId: row.cuenta_id,
      mesaReference: row.mesa_reference,
      kdsEstacionId: row.kds_estacion_id,
      urgencyLevel: row.urgency_level as UrgencyLevel,
      status: row.status as KdsTicketStatus,
      printStatus: row.print_status as PrintJobStatus,
      printAttempts: Number(row.print_attempts),
      printerId: row.printer_id,
      lastPrintError: row.last_print_error,
      aggregateSequenceNumber: Number(row.aggregate_sequence_number),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      preparationTimeMinutes:
        row.preparation_time_minutes !== null ? Number(row.preparation_time_minutes) : null,
      partidas,
    };
  }

  #loadPartidas(kdsTicketId: string): readonly KdsTicketPartida[] {
    const rows = this.#db.queryRowsSafe<KdsTicketPartidaRow>(
      `SELECT id, kds_ticket_id, product_id, product_name_snapshot, quantity, comments,
              modifiers_snapshot, status, created_at
       FROM kds_ticket_partidas WHERE kds_ticket_id = ? ORDER BY created_at ASC;`,
      kdsTicketId,
    );
    return rows.map((r) => ({
      id: r.id,
      kdsTicketId: r.kds_ticket_id,
      productId: r.product_id,
      productNameSnapshot: r.product_name_snapshot,
      quantity: BigInt(r.quantity),
      comments: r.comments,
      modifiers: JSON.parse(r.modifiers_snapshot) as KdsTicketPartidaModificadorSnapshot[],
      status: r.status as KdsTicketPartidaStatus,
      createdAt: r.created_at,
    }));
  }

  #persistPartidas(kdsTicketId: string, partidas: readonly KdsTicketPartida[]): void {
    for (const p of partidas) {
      this.#db.executeMutation(
        `INSERT INTO kds_ticket_partidas (
           id, kds_ticket_id, product_id, product_name_snapshot, quantity, comments,
           modifiers_snapshot, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status;`,
        p.id,
        kdsTicketId,
        p.productId,
        p.productNameSnapshot,
        p.quantity,
        p.comments,
        JSON.stringify(p.modifiers),
        p.status,
        p.createdAt,
      );
    }
  }
}
