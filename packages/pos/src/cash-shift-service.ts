/**
 * TRIDENTPOS Cash Shift Domain Service (WP-016 / DEC-017 / ADR-004 / ADR-012 / ADR-013)
 * Pure domain logic: zero direct SQL, zero floats, strict OCC, blind count calculation,
 * per-operator breakdowns, and immutable shift closure.
 */

import crypto from 'node:crypto';
import type {
  ArqueoCiego,
  CorteCaja,
  MovimientoCaja,
  OperatorBreakdown,
  TurnoCaja,
} from './cash-shift-types.js';
import type {
  CashDrawerPort,
  CashShiftRepositoryPort,
  IamPinValidatorPort,
} from './cash-shift-ports.js';
import {
  SharedShiftAssignmentStrategy,
  type ShiftAssignmentStrategy,
} from './cash-shift-strategy.js';
import {
  DomainError,
  InvalidCashMovementError,
  InvalidOperatorPinError,
  OCCConflictError,
  ShiftAlreadyOpenError,
  ShiftInvalidStatusError,
  ShiftLockedError,
  ShiftNotFoundError,
  UnauthorizedShiftOperatorError,
} from './errors.js';

export interface CashShiftDomainServiceOptions {
  readonly repository: CashShiftRepositoryPort;
  readonly assignmentStrategy?: ShiftAssignmentStrategy;
  readonly drawerPort?: CashDrawerPort;
  readonly pinValidator?: IamPinValidatorPort;
}

export interface AbrirTurnoCommand {
  readonly organizationId: string;
  readonly branchId: string;
  readonly stationId: string;
  readonly responsibleUserId: string;
  readonly openedByUserId?: string;
  readonly openingCashFloat: bigint; // Scale 4
  readonly shiftNumber?: number;
  readonly assignmentStrategy?: string;
  readonly operatorPin?: string;
}

export interface AgregarOperadorCommand {
  readonly shiftId: string;
  readonly operatorUserId: string;
  readonly requestingUserId: string;
  readonly expectedVersion: number;
  readonly operatorPin?: string;
  readonly requestingPin?: string;
}

export interface RegistrarMovimientoCommand {
  readonly shiftId: string;
  readonly operatorUserId: string;
  readonly movementType: MovimientoCaja['movementType'];
  readonly amount: bigint; // Scale 4
  readonly reason: string;
  readonly referenceId?: string | null;
  readonly expectedVersion: number;
  readonly operatorPin?: string;
}

export interface GenerarCorteXCommand {
  readonly shiftId: string;
  readonly requestedByUserId: string;
  readonly requestedByPin?: string;
}

export interface RealizarArqueoCiegoCommand {
  readonly shiftId: string;
  readonly performedByUserId: string;
  readonly declaredCash: bigint; // Scale 4
  readonly expectedVersion: number;
  readonly performedByPin?: string;
}

export interface GenerarCorteZCommand {
  readonly shiftId: string;
  readonly closedByUserId: string;
  readonly expectedVersion: number;
  readonly closedByPin?: string;
}

export class CashShiftDomainService {
  readonly #repository: CashShiftRepositoryPort;
  readonly #strategy: ShiftAssignmentStrategy;
  readonly #drawerPort?: CashDrawerPort;
  readonly #pinValidator?: IamPinValidatorPort;

  constructor(options: CashShiftDomainServiceOptions) {
    this.#repository = options.repository;
    this.#strategy = options.assignmentStrategy ?? new SharedShiftAssignmentStrategy();
    this.#drawerPort = options.drawerPort;
    this.#pinValidator = options.pinValidator;
  }

  private async validatePinIfConfigured(
    userId: string,
    pin?: string,
    stationId?: string,
  ): Promise<void> {
    if (this.#pinValidator) {
      if (!pin || pin.trim() === '') {
        throw new InvalidOperatorPinError(userId);
      }
      const isValid = await this.#pinValidator.validatePin(userId, pin, stationId);
      if (!isValid) {
        throw new InvalidOperatorPinError(userId);
      }
    }
  }

  /**
   * Computes totals and per-operator breakdown from opening cash float and movements.
   * All arithmetic is exact scale-4 bigint (factor 10000n) per ADR-012.
   */
  public computeBreakdown(
    openingCashFloat: bigint,
    movements: readonly MovimientoCaja[],
  ): {
    totalIngresos: bigint;
    totalEgresos: bigint;
    totalVentasEfectivo: bigint;
    totalCalculado: bigint;
    desgloseOperadores: readonly OperatorBreakdown[];
  } {
    let totalIngresos = 0n;
    let totalEgresos = 0n;
    let totalVentasEfectivo = 0n;

    const opMap = new Map<
      string,
      {
        totalIngresos: bigint;
        totalEgresos: bigint;
        totalVentasEfectivo: bigint;
        netCash: bigint;
        movementsCount: number;
      }
    >();

    for (const mov of movements) {
      let stats = opMap.get(mov.operatorUserId);
      if (!stats) {
        stats = {
          totalIngresos: 0n,
          totalEgresos: 0n,
          totalVentasEfectivo: 0n,
          netCash: 0n,
          movementsCount: 0,
        };
        opMap.set(mov.operatorUserId, stats);
      }

      stats.movementsCount += 1;

      switch (mov.movementType) {
        case 'INGRESO':
          totalIngresos += mov.amount;
          stats.totalIngresos += mov.amount;
          stats.netCash += mov.amount;
          break;
        case 'VENTA_EFECTIVO':
          totalVentasEfectivo += mov.amount;
          stats.totalVentasEfectivo += mov.amount;
          stats.netCash += mov.amount;
          break;
        case 'EGRESO':
        case 'DEVOLUCION_EFECTIVO':
          totalEgresos += mov.amount;
          stats.totalEgresos += mov.amount;
          stats.netCash -= mov.amount;
          break;
        case 'FONDO_INICIAL':
          // Initial float is counted separately in openingCashFloat
          break;
      }
    }

    const totalCalculado = openingCashFloat + totalIngresos + totalVentasEfectivo - totalEgresos;

    const desgloseOperadores: OperatorBreakdown[] = Array.from(opMap.entries()).map(
      ([operatorUserId, data]) => ({
        operatorUserId,
        totalIngresos: data.totalIngresos,
        totalEgresos: data.totalEgresos,
        totalVentasEfectivo: data.totalVentasEfectivo,
        netCash: data.netCash,
        movementsCount: data.movementsCount,
      }),
    );

    return {
      totalIngresos,
      totalEgresos,
      totalVentasEfectivo,
      totalCalculado,
      desgloseOperadores,
    };
  }

  /**
   * Opens a new cash shift on a station.
   */
  public async abrirTurno(command: AbrirTurnoCommand): Promise<TurnoCaja> {
    if (!command.organizationId || command.organizationId.trim() === '') {
      throw new DomainError('organizationId is required', 'MISSING_TENANT_IDENTITY', 400);
    }
    if (!command.branchId || command.branchId.trim() === '') {
      throw new DomainError('branchId is required', 'MISSING_TENANT_IDENTITY', 400);
    }

    const existing = await this.#repository.getActiveShift(command.stationId);
    if (existing) {
      throw new ShiftAlreadyOpenError(command.stationId);
    }

    if (command.openingCashFloat < 0n) {
      throw new DomainError(
        'Opening cash float must be non-negative',
        'INVALID_OPENING_FLOAT',
        400,
      );
    }

    await this.validatePinIfConfigured(
      command.responsibleUserId,
      command.operatorPin,
      command.stationId,
    );

    const now = new Date().toISOString();
    const shiftId = crypto.randomUUID();
    const responsibleUserId = command.responsibleUserId;
    const openedByUserId = command.openedByUserId ?? responsibleUserId;

    const newShift: TurnoCaja = {
      id: shiftId,
      organizationId: command.organizationId,
      branchId: command.branchId,
      stationId: command.stationId,
      responsibleUserId,
      openedByUserId,
      shiftNumber: command.shiftNumber ?? 1,
      openingCashFloat: command.openingCashFloat,
      closingDeclaredCash: null,
      calculatedCashTotal: null,
      cashDifference: null,
      status: 'ABIERTO',
      assignmentStrategy: command.assignmentStrategy ?? this.#strategy.name,
      participatingOperators: [responsibleUserId],
      openedAt: now,
      closedAt: null,
      version: 1,
      updatedAt: now,
    };

    const saved = await this.#repository.saveShift(newShift, 0);

    // If opening float > 0, record initial float movement
    if (command.openingCashFloat > 0n) {
      const initialMovement: MovimientoCaja = {
        id: crypto.randomUUID(),
        turnoCajaId: shiftId,
        operatorUserId: responsibleUserId,
        movementType: 'FONDO_INICIAL',
        amount: command.openingCashFloat,
        reason: 'Fondo inicial de apertura de turno',
        referenceId: null,
        createdAt: now,
      };
      await this.#repository.addMovement(initialMovement, saved, saved.version);
    }

    return saved;
  }

  /**
   * Adds a participating operator to a shared shift (DEC-017).
   */
  public async agregarOperador(command: AgregarOperadorCommand): Promise<TurnoCaja> {
    const shift = await this.#repository.getShiftById(command.shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(command.shiftId);
    }

    if (shift.version !== command.expectedVersion) {
      throw new OCCConflictError(shift.id, command.expectedVersion, shift.version, shift);
    }

    if (shift.status === 'CORTE_Z_EMITIDO') {
      throw new ShiftLockedError(shift.id);
    }

    if (shift.status !== 'ABIERTO') {
      throw new ShiftInvalidStatusError(shift.id, shift.status, 'ABIERTO');
    }

    await this.validatePinIfConfigured(
      command.requestingUserId,
      command.requestingPin,
      shift.stationId,
    );

    if (!this.#strategy.canAddOperator(shift, command.operatorUserId, command.requestingUserId)) {
      throw new UnauthorizedShiftOperatorError(command.requestingUserId, shift.id);
    }

    // Idempotent add
    if (shift.participatingOperators.includes(command.operatorUserId)) {
      return shift;
    }

    const now = new Date().toISOString();
    const updatedShift: TurnoCaja = {
      ...shift,
      participatingOperators: [...shift.participatingOperators, command.operatorUserId],
      version: shift.version + 1,
      updatedAt: now,
    };

    return this.#repository.saveShift(updatedShift, shift.version);
  }

  /**
   * Records a cash movement (ingreso, egreso, venta efectivo, etc.) against an open shift.
   */
  public async registrarMovimiento(
    command: RegistrarMovimientoCommand,
  ): Promise<{ shift: TurnoCaja; movement: MovimientoCaja }> {
    const shift = await this.#repository.getShiftById(command.shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(command.shiftId);
    }

    if (shift.version !== command.expectedVersion) {
      throw new OCCConflictError(shift.id, command.expectedVersion, shift.version, shift);
    }

    if (shift.status === 'CORTE_Z_EMITIDO') {
      throw new ShiftLockedError(shift.id);
    }

    if (shift.status !== 'ABIERTO') {
      throw new ShiftInvalidStatusError(shift.id, shift.status, 'ABIERTO');
    }

    await this.validatePinIfConfigured(
      command.operatorUserId,
      command.operatorPin,
      shift.stationId,
    );

    if (!this.#strategy.canOperate(shift, command.operatorUserId)) {
      throw new UnauthorizedShiftOperatorError(command.operatorUserId, shift.id);
    }

    if (command.amount <= 0n) {
      throw new InvalidCashMovementError('Movement amount must be greater than zero');
    }

    if (!command.reason || command.reason.trim().length === 0) {
      throw new InvalidCashMovementError('Movement reason is required');
    }

    const now = new Date().toISOString();
    const movement: MovimientoCaja = {
      id: crypto.randomUUID(),
      turnoCajaId: shift.id,
      operatorUserId: command.operatorUserId,
      movementType: command.movementType,
      amount: command.amount,
      reason: command.reason.trim(),
      referenceId: command.referenceId ?? null,
      createdAt: now,
    };

    const updatedShift: TurnoCaja = {
      ...shift,
      version: shift.version + 1,
      updatedAt: now,
    };

    const savedMovement = await this.#repository.addMovement(movement, updatedShift, shift.version);

    return { shift: updatedShift, movement: savedMovement };
  }

  /**
   * Generates a read-only Corte X (partial inspection without closing or state changes).
   */
  public async generarCorteX(command: GenerarCorteXCommand): Promise<CorteCaja> {
    const shift = await this.#repository.getShiftById(command.shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(command.shiftId);
    }

    await this.validatePinIfConfigured(
      command.requestedByUserId,
      command.requestedByPin,
      shift.stationId,
    );

    if (!this.#strategy.canOperate(shift, command.requestedByUserId)) {
      throw new UnauthorizedShiftOperatorError(command.requestedByUserId, shift.id);
    }

    const movements = await this.#repository.listMovements(shift.id);
    const breakdown = this.computeBreakdown(shift.openingCashFloat, movements);

    const now = new Date().toISOString();
    const corteX: CorteCaja = {
      id: crypto.randomUUID(),
      turnoCajaId: shift.id,
      tipoCorte: 'CORTE_X',
      generatedByUserId: command.requestedByUserId,
      openingCashFloat: shift.openingCashFloat,
      totalIngresos: breakdown.totalIngresos,
      totalEgresos: breakdown.totalEgresos,
      totalVentasEfectivo: breakdown.totalVentasEfectivo,
      totalCalculado: breakdown.totalCalculado,
      totalDeclarado: shift.closingDeclaredCash,
      diferencia: shift.cashDifference,
      desgloseOperadores: breakdown.desgloseOperadores,
      generatedAt: now,
    };

    return corteX;
  }

  /**
   * Performs Arqueo Ciego (blind count).
   * Acceptance Criteria: Declared cash is captured BEFORE showing calculated total or variance.
   */
  public async realizarArqueoCiego(
    command: RealizarArqueoCiegoCommand,
  ): Promise<{ shift: TurnoCaja; arqueo: ArqueoCiego }> {
    const shift = await this.#repository.getShiftById(command.shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(command.shiftId);
    }

    if (shift.version !== command.expectedVersion) {
      throw new OCCConflictError(shift.id, command.expectedVersion, shift.version, shift);
    }

    if (shift.status === 'CORTE_Z_EMITIDO') {
      throw new ShiftLockedError(shift.id);
    }

    if (shift.status !== 'ABIERTO') {
      throw new ShiftInvalidStatusError(shift.id, shift.status, 'ABIERTO');
    }

    if (command.declaredCash < 0n) {
      throw new DomainError(
        'Declared cash amount must be non-negative',
        'INVALID_DECLARED_CASH',
        400,
      );
    }

    await this.validatePinIfConfigured(
      command.performedByUserId,
      command.performedByPin,
      shift.stationId,
    );

    if (!this.#strategy.canOperate(shift, command.performedByUserId)) {
      throw new UnauthorizedShiftOperatorError(command.performedByUserId, shift.id);
    }

    const movements = await this.#repository.listMovements(shift.id);
    const breakdown = this.computeBreakdown(shift.openingCashFloat, movements);

    // Exact scale-4 arithmetic: difference = declared - calculated
    const difference = command.declaredCash - breakdown.totalCalculado;
    const now = new Date().toISOString();

    const arqueo: ArqueoCiego = {
      id: crypto.randomUUID(),
      turnoCajaId: shift.id,
      performedByUserId: command.performedByUserId,
      declaredCash: command.declaredCash,
      calculatedCash: breakdown.totalCalculado,
      difference,
      createdAt: now,
    };

    const updatedShift: TurnoCaja = {
      ...shift,
      status: 'CERRADO_ARQUEO',
      closingDeclaredCash: command.declaredCash,
      calculatedCashTotal: breakdown.totalCalculado,
      cashDifference: difference,
      version: shift.version + 1,
      updatedAt: now,
    };

    const savedArqueo = await this.#repository.saveArqueoCiego(arqueo, updatedShift, shift.version);

    return { shift: updatedShift, arqueo: savedArqueo };
  }

  /**
   * Issues Corte Z, permanently freezing the shift, committing in durable transaction,
   * triggering drawer kick pulse, and emitting sync event.
   */
  public async generarCorteZ(
    command: GenerarCorteZCommand,
  ): Promise<{ shift: TurnoCaja; corte: CorteCaja }> {
    const shift = await this.#repository.getShiftById(command.shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(command.shiftId);
    }

    if (shift.version !== command.expectedVersion) {
      throw new OCCConflictError(shift.id, command.expectedVersion, shift.version, shift);
    }

    if (shift.status === 'CORTE_Z_EMITIDO') {
      throw new ShiftLockedError(shift.id);
    }

    if (shift.status !== 'CERRADO_ARQUEO') {
      throw new DomainError(
        'Arqueo ciego is mandatory before issuing Corte Z',
        'BLIND_COUNT_REQUIRED',
        400,
      );
    }

    await this.validatePinIfConfigured(
      command.closedByUserId,
      command.closedByPin,
      shift.stationId,
    );

    if (!this.#strategy.canClose(shift, command.closedByUserId)) {
      throw new UnauthorizedShiftOperatorError(command.closedByUserId, shift.id);
    }

    const movements = await this.#repository.listMovements(shift.id);
    const breakdown = this.computeBreakdown(shift.openingCashFloat, movements);

    const now = new Date().toISOString();
    const corteZ: CorteCaja = {
      id: crypto.randomUUID(),
      turnoCajaId: shift.id,
      tipoCorte: 'CORTE_Z',
      generatedByUserId: command.closedByUserId,
      openingCashFloat: shift.openingCashFloat,
      totalIngresos: breakdown.totalIngresos,
      totalEgresos: breakdown.totalEgresos,
      totalVentasEfectivo: breakdown.totalVentasEfectivo,
      totalCalculado: breakdown.totalCalculado,
      totalDeclarado: shift.closingDeclaredCash,
      diferencia: shift.cashDifference,
      desgloseOperadores: breakdown.desgloseOperadores,
      generatedAt: now,
    };

    const finalShift: TurnoCaja = {
      ...shift,
      status: 'CORTE_Z_EMITIDO',
      closedAt: now,
      version: shift.version + 1,
      updatedAt: now,
    };

    const savedCorte = await this.#repository.saveCorteZ(corteZ, finalShift, shift.version);

    // Trigger physical cash drawer kick pulse if drawer port is present
    if (this.#drawerPort) {
      try {
        await this.#drawerPort.kickDrawer();
      } catch {
        // Hardware kick failure must not abort or compromise the committed Corte Z
      }
    }

    return { shift: finalShift, corte: savedCorte };
  }
}
