/**
 * TRIDENTPOS Edge SQLite Cash Management & Shift Repository Adapter (WP-016 / DEC-017 / ADR-004 / ADR-012)
 * Implements CashShiftRepositoryPort from @trident/pos.
 * Guarantees strict OCC concurrency, scale-4 integer storage, atomic movement persistence,
 * and PRAGMA synchronous = FULL durable commit for Corte Z before outbox emission.
 */

import crypto from 'node:crypto';
import { scaledBigIntToDecimalString } from '@trident/core';
import {
  type ArqueoCiego,
  type CashShiftRepositoryPort,
  type CorteCaja,
  type MovimientoCaja,
  type TurnoCaja,
  type TurnoCajaStatus,
  DomainError,
  OCCConflictError,
} from '@trident/pos';
import { EdgeDatabaseService } from '@trident/edge';
import { CASH_SHIFT_SQLITE_SCHEMA } from './cash-shift-schema.js';

interface TurnoCajaRow {
  id: string;
  station_id: string;
  responsible_user_id: string;
  opened_by_user_id: string;
  shift_number: number;
  opening_cash_float: number | bigint;
  closing_declared_cash: number | bigint | null;
  calculated_cash_total: number | bigint | null;
  cash_difference: number | bigint | null;
  status: string;
  assignment_strategy: string;
  opened_at: string;
  closed_at: string | null;
  version: number;
  updated_at: string;
}

interface OperadorRow {
  operator_user_id: string;
}

interface MovimientoCajaRow {
  id: string;
  turno_caja_id: string;
  operator_user_id: string;
  movement_type: string;
  amount: number | bigint;
  reason: string;
  reference_id: string | null;
  created_at: string;
}

export class SqliteCashShiftRepository implements CashShiftRepositoryPort {
  readonly #db: EdgeDatabaseService;

  constructor(db: EdgeDatabaseService) {
    this.#db = db;
    this.bootstrapSchema();
  }

  public bootstrapSchema(): void {
    this.#db.executeSchema(CASH_SHIFT_SQLITE_SCHEMA);
  }

  private mapTurnoRow(row: TurnoCajaRow, participatingOperators: readonly string[]): TurnoCaja {
    return {
      id: row.id,
      stationId: row.station_id,
      responsibleUserId: row.responsible_user_id,
      openedByUserId: row.opened_by_user_id,
      shiftNumber: Number(row.shift_number),
      openingCashFloat: BigInt(row.opening_cash_float),
      closingDeclaredCash:
        row.closing_declared_cash !== null ? BigInt(row.closing_declared_cash) : null,
      calculatedCashTotal:
        row.calculated_cash_total !== null ? BigInt(row.calculated_cash_total) : null,
      cashDifference: row.cash_difference !== null ? BigInt(row.cash_difference) : null,
      status: row.status as TurnoCajaStatus,
      assignmentStrategy: row.assignment_strategy,
      participatingOperators,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      version: Number(row.version),
      updatedAt: row.updated_at,
    };
  }

  private getParticipatingOperatorsSync(shiftId: string): readonly string[] {
    const rows = this.#db.queryRowsSafe<OperadorRow>(
      'SELECT operator_user_id FROM turnos_caja_operadores WHERE turno_caja_id = ? ORDER BY added_at ASC;',
      shiftId,
    );
    return rows.map((r) => r.operator_user_id);
  }

  public getActiveShiftSync(stationId: string): TurnoCaja | null {
    const row = this.#db.queryRowSafe<TurnoCajaRow>(
      `SELECT id, station_id, responsible_user_id, opened_by_user_id, shift_number,
              opening_cash_float, closing_declared_cash, calculated_cash_total, cash_difference,
              status, assignment_strategy, opened_at, closed_at, version, updated_at
       FROM turnos_caja
       WHERE station_id = ? AND status IN ('ABIERTO', 'CERRADO_ARQUEO');`,
      stationId,
    );

    if (!row) return null;
    const operators = this.getParticipatingOperatorsSync(row.id);
    return this.mapTurnoRow(row, operators);
  }

  public async getActiveShift(stationId: string): Promise<TurnoCaja | null> {
    return this.getActiveShiftSync(stationId);
  }

  public getShiftByIdSync(id: string): TurnoCaja | null {
    const row = this.#db.queryRowSafe<TurnoCajaRow>(
      `SELECT id, station_id, responsible_user_id, opened_by_user_id, shift_number,
              opening_cash_float, closing_declared_cash, calculated_cash_total, cash_difference,
              status, assignment_strategy, opened_at, closed_at, version, updated_at
       FROM turnos_caja
       WHERE id = ?;`,
      id,
    );

    if (!row) return null;
    const operators = this.getParticipatingOperatorsSync(row.id);
    return this.mapTurnoRow(row, operators);
  }

  public async getShiftById(id: string): Promise<TurnoCaja | null> {
    return this.getShiftByIdSync(id);
  }

  public saveShiftSync(shift: TurnoCaja, expectedVersion: number): TurnoCaja {
    if (expectedVersion === 0) {
      // New shift insert
      const existing = this.getShiftByIdSync(shift.id);
      if (existing) {
        throw new DomainError(`Shift '${shift.id}' already exists`, 'DUPLICATE_SHIFT', 409);
      }

      this.#db.runInTransaction(() => {
        this.#db.executeMutation(
          `INSERT INTO turnos_caja (
            id, station_id, responsible_user_id, opened_by_user_id, shift_number,
            opening_cash_float, closing_declared_cash, calculated_cash_total, cash_difference,
            status, assignment_strategy, opened_at, closed_at, version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          shift.id,
          shift.stationId,
          shift.responsibleUserId,
          shift.openedByUserId,
          shift.shiftNumber,
          Number(shift.openingCashFloat),
          shift.closingDeclaredCash !== null ? Number(shift.closingDeclaredCash) : null,
          shift.calculatedCashTotal !== null ? Number(shift.calculatedCashTotal) : null,
          shift.cashDifference !== null ? Number(shift.cashDifference) : null,
          shift.status,
          shift.assignmentStrategy,
          shift.openedAt,
          shift.closedAt,
          shift.version,
          shift.updatedAt,
        );

        for (const opId of shift.participatingOperators) {
          this.#db.executeMutation(
            `INSERT OR IGNORE INTO turnos_caja_operadores (id, turno_caja_id, operator_user_id, added_by_user_id, added_at)
             VALUES (?, ?, ?, ?, ?);`,
            crypto.randomUUID(),
            shift.id,
            opId,
            shift.openedByUserId,
            shift.openedAt,
          );
        }
      });

      return shift;
    }

    // OCC Update
    return this.#db.runInTransaction(() => {
      const result = this.#db.executeMutation(
        `UPDATE turnos_caja
         SET closing_declared_cash = ?, calculated_cash_total = ?, cash_difference = ?,
             status = ?, closed_at = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?;`,
        shift.closingDeclaredCash !== null ? Number(shift.closingDeclaredCash) : null,
        shift.calculatedCashTotal !== null ? Number(shift.calculatedCashTotal) : null,
        shift.cashDifference !== null ? Number(shift.cashDifference) : null,
        shift.status,
        shift.closedAt,
        shift.version,
        shift.updatedAt,
        shift.id,
        expectedVersion,
      );

      if (result.changes === 0) {
        const current = this.getShiftByIdSync(shift.id);
        throw new OCCConflictError(
          shift.id,
          expectedVersion,
          current ? current.version : 0,
          current,
        );
      }

      for (const opId of shift.participatingOperators) {
        this.#db.executeMutation(
          `INSERT OR IGNORE INTO turnos_caja_operadores (id, turno_caja_id, operator_user_id, added_by_user_id, added_at)
           VALUES (?, ?, ?, ?, ?);`,
          crypto.randomUUID(),
          shift.id,
          opId,
          shift.responsibleUserId,
          shift.updatedAt,
        );
      }

      return shift;
    });
  }

  public async saveShift(shift: TurnoCaja, expectedVersion: number): Promise<TurnoCaja> {
    return this.saveShiftSync(shift, expectedVersion);
  }

  public addMovementSync(
    movement: MovimientoCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): MovimientoCaja {
    return this.#db.runInTransaction(() => {
      const result = this.#db.executeMutation(
        `UPDATE turnos_caja SET version = ?, updated_at = ? WHERE id = ? AND version = ?;`,
        shift.version,
        shift.updatedAt,
        shift.id,
        expectedVersion,
      );

      if (result.changes === 0) {
        const current = this.getShiftByIdSync(shift.id);
        throw new OCCConflictError(
          shift.id,
          expectedVersion,
          current ? current.version : 0,
          current,
        );
      }

      this.#db.executeMutation(
        `INSERT INTO movimientos_caja (id, turno_caja_id, operator_user_id, movement_type, amount, reason, reference_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        movement.id,
        movement.turnoCajaId,
        movement.operatorUserId,
        movement.movementType,
        Number(movement.amount),
        movement.reason,
        movement.referenceId,
        movement.createdAt,
      );

      return movement;
    });
  }

  public async addMovement(
    movement: MovimientoCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<MovimientoCaja> {
    return this.addMovementSync(movement, shift, expectedVersion);
  }

  public listMovementsSync(shiftId: string): readonly MovimientoCaja[] {
    const rows = this.#db.queryRowsSafe<MovimientoCajaRow>(
      `SELECT id, turno_caja_id, operator_user_id, movement_type, amount, reason, reference_id, created_at
       FROM movimientos_caja
       WHERE turno_caja_id = ?
       ORDER BY created_at ASC;`,
      shiftId,
    );

    return rows.map((r) => ({
      id: r.id,
      turnoCajaId: r.turno_caja_id,
      operatorUserId: r.operator_user_id,
      movementType: r.movement_type as MovimientoCaja['movementType'],
      amount: BigInt(r.amount),
      reason: r.reason,
      referenceId: r.reference_id,
      createdAt: r.created_at,
    }));
  }

  public async listMovements(shiftId: string): Promise<readonly MovimientoCaja[]> {
    return this.listMovementsSync(shiftId);
  }

  public saveArqueoCiegoSync(
    arqueo: ArqueoCiego,
    shift: TurnoCaja,
    expectedVersion: number,
  ): ArqueoCiego {
    return this.#db.runInTransaction(() => {
      const result = this.#db.executeMutation(
        `UPDATE turnos_caja
         SET closing_declared_cash = ?, calculated_cash_total = ?, cash_difference = ?,
             status = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?;`,
        Number(shift.closingDeclaredCash),
        Number(shift.calculatedCashTotal),
        Number(shift.cashDifference),
        shift.status,
        shift.version,
        shift.updatedAt,
        shift.id,
        expectedVersion,
      );

      if (result.changes === 0) {
        const current = this.getShiftByIdSync(shift.id);
        throw new OCCConflictError(
          shift.id,
          expectedVersion,
          current ? current.version : 0,
          current,
        );
      }

      this.#db.executeMutation(
        `INSERT INTO arqueos_ciegos (id, turno_caja_id, performed_by_user_id, declared_cash, calculated_cash, difference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        arqueo.id,
        arqueo.turnoCajaId,
        arqueo.performedByUserId,
        Number(arqueo.declaredCash),
        Number(arqueo.calculatedCash),
        Number(arqueo.difference),
        arqueo.createdAt,
      );

      return arqueo;
    });
  }

  public async saveArqueoCiego(
    arqueo: ArqueoCiego,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<ArqueoCiego> {
    return this.saveArqueoCiegoSync(arqueo, shift, expectedVersion);
  }

  /**
   * Saves Corte Z under PRAGMA synchronous = FULL durability mode (ADR-004),
   * permanently freezing the shift, writing audit trail on discrepancy, and queuing
   * the transactional outbox event CorteZGenerado for downstream sync.
   */
  public saveCorteZSync(corte: CorteCaja, shift: TurnoCaja, expectedVersion: number): CorteCaja {
    return this.#db.runInTransaction(
      () => {
        const result = this.#db.executeMutation(
          `UPDATE turnos_caja
           SET status = ?, closed_at = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?;`,
          shift.status,
          shift.closedAt,
          shift.version,
          shift.updatedAt,
          shift.id,
          expectedVersion,
        );

        if (result.changes === 0) {
          const current = this.getShiftByIdSync(shift.id);
          throw new OCCConflictError(
            shift.id,
            expectedVersion,
            current ? current.version : 0,
            current,
          );
        }

        const serializedDesglose = JSON.stringify(
          corte.desgloseOperadores.map((op) => ({
            operatorUserId: op.operatorUserId,
            totalIngresos: scaledBigIntToDecimalString(op.totalIngresos),
            totalEgresos: scaledBigIntToDecimalString(op.totalEgresos),
            totalVentasEfectivo: scaledBigIntToDecimalString(op.totalVentasEfectivo),
            netCash: scaledBigIntToDecimalString(op.netCash),
            movementsCount: op.movementsCount,
          })),
        );

        this.#db.executeMutation(
          `INSERT INTO cortes_caja (
            id, turno_caja_id, tipo_corte, generated_by_user_id, opening_cash_float,
            total_ingresos, total_egresos, total_ventas_efectivo, total_calculado,
            total_declarado, diferencia, desglose_operadores_json, generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          corte.id,
          corte.turnoCajaId,
          corte.tipoCorte,
          corte.generatedByUserId,
          Number(corte.openingCashFloat),
          Number(corte.totalIngresos),
          Number(corte.totalEgresos),
          Number(corte.totalVentasEfectivo),
          Number(corte.totalCalculado),
          corte.totalDeclarado !== null ? Number(corte.totalDeclarado) : null,
          corte.diferencia !== null ? Number(corte.diferencia) : null,
          serializedDesglose,
          corte.generatedAt,
        );

        // Audit cash discrepancy if difference is non-zero
        if (corte.diferencia !== null && corte.diferencia !== 0n) {
          this.#db.executeMutation(
            `INSERT INTO local_audit_trail (
              id, actor_id, station_id, action, aggregate_type, aggregate_id, details_json, reason, created_at, is_synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            crypto.randomUUID(),
            corte.generatedByUserId,
            shift.stationId,
            'CASH_DIFFERENCE_AUDITED',
            'TURNO_CAJA',
            shift.id,
            JSON.stringify({
              shiftId: shift.id,
              stationId: shift.stationId,
              shiftNumber: shift.shiftNumber,
              declaredCash: scaledBigIntToDecimalString(corte.totalDeclarado!),
              calculatedCash: scaledBigIntToDecimalString(corte.totalCalculado),
              cashDifference: scaledBigIntToDecimalString(corte.diferencia),
            }),
            'Descuadre de efectivo detectado en Arqueo Ciego / Corte Z',
            corte.generatedAt,
            0,
          );
        }

        // Emit Transactional Outbox Event CorteZGenerado
        const outboxPayload = {
          eventId: crypto.randomUUID(),
          eventType: 'CorteZGenerado',
          occurredAt: corte.generatedAt,
          aggregateType: 'CORTE_Z',
          aggregateId: corte.id,
          shiftId: shift.id,
          stationId: shift.stationId,
          responsibleUserId: shift.responsibleUserId,
          shiftNumber: shift.shiftNumber,
          openingCashFloat: scaledBigIntToDecimalString(corte.openingCashFloat),
          totalIngresos: scaledBigIntToDecimalString(corte.totalIngresos),
          totalEgresos: scaledBigIntToDecimalString(corte.totalEgresos),
          totalVentasEfectivo: scaledBigIntToDecimalString(corte.totalVentasEfectivo),
          totalCalculado: scaledBigIntToDecimalString(corte.totalCalculado),
          totalDeclarado:
            corte.totalDeclarado !== null
              ? scaledBigIntToDecimalString(corte.totalDeclarado)
              : '0.0000',
          diferencia:
            corte.diferencia !== null ? scaledBigIntToDecimalString(corte.diferencia) : '0.0000',
          desgloseOperadores: corte.desgloseOperadores.map((op) => ({
            operatorUserId: op.operatorUserId,
            totalIngresos: scaledBigIntToDecimalString(op.totalIngresos),
            totalEgresos: scaledBigIntToDecimalString(op.totalEgresos),
            totalVentasEfectivo: scaledBigIntToDecimalString(op.totalVentasEfectivo),
            netCash: scaledBigIntToDecimalString(op.netCash),
            movementsCount: op.movementsCount,
          })),
          openedAt: shift.openedAt,
          closedAt: shift.closedAt!,
        };

        this.#db.executeMutation(
          `INSERT INTO outbox_queue (
            id, organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id,
            aggregate_sequence_number, payload, status, retry_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          crypto.randomUUID(),
          'org_default',
          'branch_default',
          'CORTE_Z',
          corte.id,
          'CorteZGenerado',
          corte.id,
          shift.shiftNumber >= 1 ? shift.shiftNumber : 1,
          JSON.stringify(outboxPayload),
          'PENDING',
          0,
          corte.generatedAt,
        );

        return corte;
      },
      { durabilityMode: 'FULL' },
    );
  }

  public async saveCorteZ(
    corte: CorteCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<CorteCaja> {
    return this.saveCorteZSync(corte, shift, expectedVersion);
  }
}
