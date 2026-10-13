/**
 * TRIDENTPOS Edge SQLite Cash Management & Shift Repository Adapter (WP-016 / DEC-017 / ADR-004 / ADR-012)
 * Implements CashShiftRepositoryPort from @trident/pos.
 * Guarantees strict OCC concurrency, scale-4 BigInt storage (zero floats/coercion),
 * atomic movement persistence, canonical tenant identity enforcement (fail-closed, zero defaults),
 * and PRAGMA synchronous = FULL durable commit for Corte Z before outbox emission.
 */

import crypto from 'node:crypto';
import { scaledBigIntToDecimalString } from '@trident/core';
import {
  type ArqueoCiego,
  type CashShiftRepositoryPort,
  type CorteCaja,
  type CorteZGeneradoEventPayload,
  type MovimientoCaja,
  type TurnoCaja,
  type TurnoCajaStatus,
  DomainError,
  OCCConflictError,
  ShiftAlreadyOpenError,
} from '@trident/pos';
import {
  EdgeDatabaseService,
  EdgeOutboxPersistence,
  LocalAuditTrailPersistence,
} from '@trident/edge';
import { CASH_SHIFT_SQLITE_SCHEMA } from './cash-shift-schema.js';

interface TurnoCajaRow {
  id: string;
  organization_id: string;
  branch_id: string;
  station_id: string;
  responsible_user_id: string;
  opened_by_user_id: string;
  shift_number: number | bigint;
  opening_cash_float: number | bigint | string;
  closing_declared_cash: number | bigint | string | null;
  calculated_cash_total: number | bigint | string | null;
  cash_difference: number | bigint | string | null;
  status: string;
  assignment_strategy: string;
  opened_at: string;
  closed_at: string | null;
  version: number | bigint;
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
  amount: number | bigint | string;
  reason: string;
  reference_id: string | null;
  created_at: string;
}

export interface SqliteCashShiftRepositoryOptions {
  readonly outboxPersistence?: EdgeOutboxPersistence;
  readonly auditPersistence?: LocalAuditTrailPersistence;
  readonly onBeforeCorteZCommit?: (corte: CorteCaja) => void;
}

export class SqliteCashShiftRepository implements CashShiftRepositoryPort {
  readonly #db: EdgeDatabaseService;
  readonly #outboxPersistence: EdgeOutboxPersistence;
  readonly #auditPersistence: LocalAuditTrailPersistence;
  readonly #onBeforeCorteZCommit?: (corte: CorteCaja) => void;

  constructor(db: EdgeDatabaseService, options?: SqliteCashShiftRepositoryOptions) {
    this.#db = db;
    this.#outboxPersistence = options?.outboxPersistence ?? new EdgeOutboxPersistence(db);
    this.#auditPersistence = options?.auditPersistence ?? new LocalAuditTrailPersistence(db);
    this.#onBeforeCorteZCommit = options?.onBeforeCorteZCommit;
    this.bootstrapSchema();
  }

  public bootstrapSchema(): void {
    this.#db.executeSchema(CASH_SHIFT_SQLITE_SCHEMA);
  }

  private mapTurnoRow(row: TurnoCajaRow, participatingOperators: readonly string[]): TurnoCaja {
    return {
      id: row.id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
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
      `SELECT id, organization_id, branch_id, station_id, responsible_user_id, opened_by_user_id, shift_number,
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
      `SELECT id, organization_id, branch_id, station_id, responsible_user_id, opened_by_user_id, shift_number,
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
    if (!shift.organizationId || shift.organizationId.trim() === '') {
      throw new DomainError('organizationId is required', 'MISSING_TENANT_IDENTITY', 400);
    }
    if (!shift.branchId || shift.branchId.trim() === '') {
      throw new DomainError('branchId is required', 'MISSING_TENANT_IDENTITY', 400);
    }

    if (expectedVersion === 0) {
      // New shift insert
      const existing = this.getShiftByIdSync(shift.id);
      if (existing) {
        throw new DomainError(`Shift '${shift.id}' already exists`, 'DUPLICATE_SHIFT', 409);
      }

      try {
        this.#db.runInTransaction(() => {
          this.#db.executeMutation(
            `INSERT INTO turnos_caja (
              id, organization_id, branch_id, station_id, responsible_user_id, opened_by_user_id, shift_number,
              opening_cash_float, closing_declared_cash, calculated_cash_total, cash_difference,
              status, assignment_strategy, opened_at, closed_at, version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            shift.id,
            shift.organizationId,
            shift.branchId,
            shift.stationId,
            shift.responsibleUserId,
            shift.openedByUserId,
            shift.shiftNumber,
            shift.openingCashFloat,
            shift.closingDeclaredCash,
            shift.calculatedCashTotal,
            shift.cashDifference,
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('UNIQUE constraint failed') ||
          message.includes('uq_turnos_caja_active_station')
        ) {
          throw new ShiftAlreadyOpenError(shift.stationId);
        }
        throw err;
      }

      return shift;
    }

    // OCC Update
    return this.#db.runInTransaction(() => {
      const result = this.#db.executeMutation(
        `UPDATE turnos_caja
         SET closing_declared_cash = ?, calculated_cash_total = ?, cash_difference = ?,
             status = ?, closed_at = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?;`,
        shift.closingDeclaredCash,
        shift.calculatedCashTotal,
        shift.cashDifference,
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
        movement.amount,
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
        shift.closingDeclaredCash,
        shift.calculatedCashTotal,
        shift.cashDifference,
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
        arqueo.declaredCash,
        arqueo.calculatedCash,
        arqueo.difference,
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
    if (!shift.organizationId || shift.organizationId.trim() === '') {
      throw new DomainError('organizationId is required', 'MISSING_TENANT_IDENTITY', 400);
    }
    if (!shift.branchId || shift.branchId.trim() === '') {
      throw new DomainError('branchId is required', 'MISSING_TENANT_IDENTITY', 400);
    }

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
          corte.openingCashFloat,
          corte.totalIngresos,
          corte.totalEgresos,
          corte.totalVentasEfectivo,
          corte.totalCalculado,
          corte.totalDeclarado,
          corte.diferencia,
          serializedDesglose,
          corte.generatedAt,
        );

        // Audit cash discrepancy in canonical local_audit_trail if difference is non-zero
        if (corte.diferencia !== null && corte.diferencia !== 0n) {
          this.#auditPersistence.recordAudit({
            organizationId: shift.organizationId,
            branchId: shift.branchId,
            actorId: corte.generatedByUserId,
            stationId: shift.stationId,
            action: 'CASH_DIFFERENCE_AUDITED',
            aggregateType: 'TURNO_CAJA',
            aggregateId: shift.id,
            details: {
              shiftId: shift.id,
              stationId: shift.stationId,
              shiftNumber: shift.shiftNumber,
              declaredCash: scaledBigIntToDecimalString(corte.totalDeclarado!),
              calculatedCash: scaledBigIntToDecimalString(corte.totalCalculado),
              cashDifference: scaledBigIntToDecimalString(corte.diferencia),
            },
            reason: 'Descuadre de efectivo detectado en Arqueo Ciego / Corte Z',
            createdAt: corte.generatedAt,
          });
        }

        // Emit Transactional Outbox Event CorteZGenerado to canonical outbox_queue
        const outboxPayload: CorteZGeneradoEventPayload = {
          shiftId: shift.id,
          organizationId: shift.organizationId,
          branchId: shift.branchId,
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

        const clientOpId =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(corte.id)
            ? corte.id
            : crypto.randomUUID();

        this.#outboxPersistence.enqueue({
          organizationId: shift.organizationId,
          branchId: shift.branchId,
          aggregateType: 'CORTE_Z',
          aggregateId: corte.id,
          action: 'CorteZGenerado',
          clientOpId,
          aggregateSequenceNumber: shift.shiftNumber >= 1 ? shift.shiftNumber : 1,
          payload: outboxPayload,
        });

        if (this.#onBeforeCorteZCommit) {
          this.#onBeforeCorteZCommit(corte);
        }

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
