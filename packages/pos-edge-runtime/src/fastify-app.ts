/**
 * TRIDENTPOS Edge POS Fastify LAN REST Application (ADR-013 / WP-014 / WP-016 / DEC-017)
 * Provides local LAN REST daemon for floor operations.
 * Enforces canonical fixed-four-decimal transport format and OCC conflict resolution.
 */

import Fastify, { FastifyInstance } from 'fastify';
import {
  decimalStringToScaledBigInt,
  isValidUuidV4,
  scaledBigIntToDecimalString,
} from '@trident/core';
import {
  type AccountType,
  type ArqueoCiego,
  type CashDrawerPort,
  type CashShiftRepositoryPort,
  type CorteCaja,
  type Cuenta,
  type CuentaItem,
  type CuentaItemModificador,
  type IamPinValidatorPort,
  type Mesa,
  type MovimientoCaja,
  type ShiftAssignmentStrategy,
  type TurnoCaja,
  CashShiftDomainService,
  DiningDomainService,
  DomainError,
  OCCConflictError,
} from '@trident/pos';
import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import { SqliteDiningRoomRepository } from './dining-sqlite-repository.js';
import { SqliteCashShiftRepository } from './cash-shift-sqlite-repository.js';

export interface FastifyAppOptions {
  readonly edgeDb: EdgeDatabaseService;
  readonly outbox: EdgeOutboxPersistence;
  readonly organizationId: string;
  readonly branchId: string;
  readonly cashShiftRepository?: CashShiftRepositoryPort;
  readonly cashShiftService?: CashShiftDomainService;
  readonly shiftAssignmentStrategy?: ShiftAssignmentStrategy;
  readonly cashDrawerPort?: CashDrawerPort;
  readonly pinValidator?: IamPinValidatorPort;
}

export function serializeCuentaToDTO(cuenta: Cuenta): Record<string, unknown> {
  return {
    id: cuenta.id,
    folioNumber: cuenta.folioNumber,
    epochId: cuenta.epochId,
    mesaId: cuenta.mesaId,
    accountType: cuenta.accountType,
    status: cuenta.status,
    subtotal: scaledBigIntToDecimalString(cuenta.subtotal),
    taxTotal: scaledBigIntToDecimalString(cuenta.taxTotal),
    discountsTotal: scaledBigIntToDecimalString(cuenta.discountsTotal),
    tipsTotal: scaledBigIntToDecimalString(cuenta.tipsTotal),
    totalAmount: scaledBigIntToDecimalString(cuenta.totalAmount),
    openedByUserId: cuenta.openedByUserId,
    openedAt: cuenta.openedAt,
    closedAt: cuenta.closedAt,
    version: cuenta.version,
    updatedAt: cuenta.updatedAt,
    items: cuenta.items.map((item) => serializeCuentaItemToDTO(item)),
  };
}

export function serializeCuentaItemToDTO(item: CuentaItem): Record<string, unknown> {
  return {
    id: item.id,
    cuentaId: item.cuentaId,
    productId: item.productId,
    productNameSnapshot: item.productNameSnapshot,
    unitPriceApplied: scaledBigIntToDecimalString(item.unitPriceApplied),
    quantity: scaledBigIntToDecimalString(item.quantity),
    taxRateApplied: scaledBigIntToDecimalString(item.taxRateApplied),
    taxAmountApplied: scaledBigIntToDecimalString(item.taxAmountApplied),
    discountAmountApplied: scaledBigIntToDecimalString(item.discountAmountApplied),
    subtotal: scaledBigIntToDecimalString(item.subtotal),
    total: scaledBigIntToDecimalString(item.total),
    status: item.status,
    createdAt: item.createdAt,
    modifiers: item.modifiers.map((mod) => serializeModifierToDTO(mod)),
  };
}

export function serializeModifierToDTO(mod: CuentaItemModificador): Record<string, unknown> {
  return {
    id: mod.id,
    cuentaItemId: mod.cuentaItemId,
    modifierId: mod.modifierId,
    modifierNameSnapshot: mod.modifierNameSnapshot,
    modifierPriceApplied: scaledBigIntToDecimalString(mod.modifierPriceApplied),
  };
}

export function serializeMesaToDTO(mesa: Mesa): Record<string, unknown> {
  return {
    id: mesa.id,
    roomName: mesa.roomName,
    tableNumber: mesa.tableNumber,
    status: mesa.status,
    currentAccountId: mesa.currentAccountId,
    version: mesa.version,
    updatedAt: mesa.updatedAt,
  };
}

export function serializeTurnoCajaToDTO(turno: TurnoCaja): Record<string, unknown> {
  return {
    id: turno.id,
    organizationId: turno.organizationId,
    branchId: turno.branchId,
    stationId: turno.stationId,
    responsibleUserId: turno.responsibleUserId,
    openedByUserId: turno.openedByUserId,
    shiftNumber: turno.shiftNumber,
    openingCashFloat: scaledBigIntToDecimalString(turno.openingCashFloat),
    closingDeclaredCash:
      turno.closingDeclaredCash !== null
        ? scaledBigIntToDecimalString(turno.closingDeclaredCash)
        : null,
    calculatedCashTotal:
      turno.calculatedCashTotal !== null
        ? scaledBigIntToDecimalString(turno.calculatedCashTotal)
        : null,
    cashDifference:
      turno.cashDifference !== null ? scaledBigIntToDecimalString(turno.cashDifference) : null,
    status: turno.status,
    assignmentStrategy: turno.assignmentStrategy,
    participatingOperators: Array.from(turno.participatingOperators),
    openedAt: turno.openedAt,
    closedAt: turno.closedAt,
    version: turno.version,
    updatedAt: turno.updatedAt,
  };
}

export function serializeMovimientoCajaToDTO(mov: MovimientoCaja): Record<string, unknown> {
  return {
    id: mov.id,
    turnoCajaId: mov.turnoCajaId,
    operatorUserId: mov.operatorUserId,
    movementType: mov.movementType,
    amount: scaledBigIntToDecimalString(mov.amount),
    reason: mov.reason,
    referenceId: mov.referenceId,
    createdAt: mov.createdAt,
  };
}

export function serializeArqueoCiegoToDTO(arqueo: ArqueoCiego): Record<string, unknown> {
  return {
    id: arqueo.id,
    turnoCajaId: arqueo.turnoCajaId,
    performedByUserId: arqueo.performedByUserId,
    declaredCash: scaledBigIntToDecimalString(arqueo.declaredCash),
    calculatedCash: scaledBigIntToDecimalString(arqueo.calculatedCash),
    difference: scaledBigIntToDecimalString(arqueo.difference),
    createdAt: arqueo.createdAt,
  };
}

export function serializeCorteCajaToDTO(corte: CorteCaja): Record<string, unknown> {
  return {
    id: corte.id,
    turnoCajaId: corte.turnoCajaId,
    tipoCorte: corte.tipoCorte,
    generatedByUserId: corte.generatedByUserId,
    openingCashFloat: scaledBigIntToDecimalString(corte.openingCashFloat),
    totalIngresos: scaledBigIntToDecimalString(corte.totalIngresos),
    totalEgresos: scaledBigIntToDecimalString(corte.totalEgresos),
    totalVentasEfectivo: scaledBigIntToDecimalString(corte.totalVentasEfectivo),
    totalCalculado: scaledBigIntToDecimalString(corte.totalCalculado),
    totalDeclarado:
      corte.totalDeclarado !== null ? scaledBigIntToDecimalString(corte.totalDeclarado) : null,
    diferencia: corte.diferencia !== null ? scaledBigIntToDecimalString(corte.diferencia) : null,
    desgloseOperadores: corte.desgloseOperadores.map((op) => ({
      operatorUserId: op.operatorUserId,
      totalIngresos: scaledBigIntToDecimalString(op.totalIngresos),
      totalEgresos: scaledBigIntToDecimalString(op.totalEgresos),
      totalVentasEfectivo: scaledBigIntToDecimalString(op.totalVentasEfectivo),
      netCash: scaledBigIntToDecimalString(op.netCash),
      movementsCount: op.movementsCount,
    })),
    generatedAt: corte.generatedAt,
  };
}

export function serializeSnapshotToDTO(snapshot: unknown): {
  aggregateType: 'CUENTA' | 'MESA' | 'TURNO_CAJA' | 'UNKNOWN';
  snapshot: Record<string, unknown> | null;
} {
  if (!snapshot || typeof snapshot !== 'object') {
    return { aggregateType: 'UNKNOWN', snapshot: null };
  }
  const rec = snapshot as Record<string, unknown>;
  if ('responsibleUserId' in rec && 'openingCashFloat' in rec) {
    return {
      aggregateType: 'TURNO_CAJA',
      snapshot: serializeTurnoCajaToDTO(snapshot as TurnoCaja),
    };
  }
  if ('tableNumber' in rec && 'roomName' in rec) {
    return {
      aggregateType: 'MESA',
      snapshot: serializeMesaToDTO(snapshot as Mesa),
    };
  }
  if ('items' in rec && 'subtotal' in rec) {
    return {
      aggregateType: 'CUENTA',
      snapshot: serializeCuentaToDTO(snapshot as Cuenta),
    };
  }
  return { aggregateType: 'UNKNOWN', snapshot: null };
}

export async function createPosFastifyApp(options: FastifyAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Dining Room & Account Service
  const diningRepo = new SqliteDiningRoomRepository(options.edgeDb);
  const diningService = new DiningDomainService({
    diningRepo,
    accountRepo: diningRepo,
  });

  // Cash Shift Service (WP-016 / DEC-017)
  const shiftRepo = options.cashShiftRepository ?? new SqliteCashShiftRepository(options.edgeDb);
  const shiftService =
    options.cashShiftService ??
    new CashShiftDomainService({
      repository: shiftRepo,
      assignmentStrategy: options.shiftAssignmentStrategy,
      drawerPort: options.cashDrawerPort,
      pinValidator: options.pinValidator,
    });

  // Custom Error Handler mapping domain & OCC errors
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof OCCConflictError) {
      const { aggregateType, snapshot: snapshotDTO } = serializeSnapshotToDTO(
        error.currentSnapshot,
      );

      return reply.status(409).send({
        error: 'OCC_CONFLICT',
        message: error.message,
        aggregateType,
        aggregateId: error.aggregateId,
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
        currentSnapshot: snapshotDTO,
      });
    }

    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof TypeError || error instanceof RangeError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
      });
    }

    // Safe generic internal error boundary:
    // Zero raw SQLite or internal infrastructure error leakage to client
    req.log?.error(error);
    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An internal server error occurred',
    });
  });

  // ==========================================
  // Dining Room & Accounts API (WP-014)
  // ==========================================

  // Open Account on Table or Direct
  app.post('/cuentas', async (req, reply) => {
    const body = req.body as {
      id: string;
      mesaId?: string | null;
      epochId: string;
      accountType: AccountType;
      openedByUserId: string;
      clientOpId: string;
    };

    if (
      !body?.id ||
      !body?.epochId ||
      !body?.accountType ||
      !body?.openedByUserId ||
      !body?.clientOpId
    ) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing id, epochId, accountType, openedByUserId, or clientOpId',
      });
    }

    if (!isValidUuidV4(body.clientOpId)) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'clientOpId must be a valid UUIDv4',
      });
    }

    // Atomic execution with transactional outbox under one synchronous SQLite transaction
    const op = options.outbox.executeWithOutbox(
      () => diningService.openCuentaSync(body),
      [
        {
          organizationId: options.organizationId,
          branchId: options.branchId,
          aggregateType: 'CUENTA',
          aggregateId: body.id,
          action: 'OPEN_CUENTA',
          clientOpId: body.clientOpId,
          aggregateSequenceNumber: 1,
          payload: { cuentaId: body.id, mesaId: body.mesaId, accountType: body.accountType },
        },
      ],
    );

    return reply.status(201).send({
      cuenta: serializeCuentaToDTO(op.cuenta),
      mesa: op.mesa ? serializeMesaToDTO(op.mesa) : undefined,
    });
  });

  // Add Item to Cuenta (canonical POST /ordenes/partidas)
  app.post('/ordenes/partidas', async (req, reply) => {
    const body = req.body as {
      cuentaId: string;
      id: string;
      expectedVersion: number;
      clientOpId: string;
      productId: string;
      productNameSnapshot: string;
      unitPriceApplied: string;
      quantity: string;
      taxRateApplied: string;
      discountAmountApplied?: string;
      modifiers?: Array<{
        id: string;
        modifierId: string;
        modifierNameSnapshot: string;
        modifierPriceApplied: string;
      }>;
    };

    const cuentaId = (req.params as { id?: string })?.id ?? body?.cuentaId;

    if (
      !cuentaId ||
      !body?.id ||
      body.expectedVersion === undefined ||
      !body?.clientOpId ||
      !body?.productId ||
      !body?.productNameSnapshot ||
      body?.unitPriceApplied === undefined ||
      body?.quantity === undefined ||
      body?.taxRateApplied === undefined
    ) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory fields for adding item',
      });
    }

    if (!isValidUuidV4(body.clientOpId)) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'clientOpId must be a valid UUIDv4',
      });
    }

    const unitPriceApplied = decimalStringToScaledBigInt(body.unitPriceApplied);
    const quantity = decimalStringToScaledBigInt(body.quantity);
    const taxRateApplied = decimalStringToScaledBigInt(body.taxRateApplied);
    const discountAmountApplied = body.discountAmountApplied
      ? decimalStringToScaledBigInt(body.discountAmountApplied)
      : 0n;

    const modifiers = (body.modifiers ?? []).map((m) => ({
      id: m.id,
      modifierId: m.modifierId,
      modifierNameSnapshot: m.modifierNameSnapshot,
      modifierPriceApplied: decimalStringToScaledBigInt(m.modifierPriceApplied),
    }));

    const updatedCuenta = options.outbox.executeWithOutbox(
      () =>
        diningService.addItemToCuentaSync(cuentaId, body.expectedVersion, {
          id: body.id,
          productId: body.productId,
          productNameSnapshot: body.productNameSnapshot,
          unitPriceApplied,
          quantity,
          taxRateApplied,
          discountAmountApplied,
          modifiers,
        }),
      (savedCuenta) => [
        {
          organizationId: options.organizationId,
          branchId: options.branchId,
          aggregateType: 'CUENTA',
          aggregateId: cuentaId,
          action: 'ADD_ITEM',
          clientOpId: body.clientOpId,
          aggregateSequenceNumber: savedCuenta.version,
          payload: {
            cuentaId,
            itemId: body.id,
            productId: body.productId,
            quantity: body.quantity,
            total: scaledBigIntToDecimalString(savedCuenta.totalAmount),
          },
        },
      ],
    );

    return reply.status(200).send(serializeCuentaToDTO(updatedCuenta));
  });

  // Close Cuenta
  app.put('/cuentas/:id/cerrar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      expectedVersion: number;
      clientOpId: string;
      closedStatus?: 'PAGADA' | 'ANULADA';
    };

    if (body?.expectedVersion === undefined || !body?.clientOpId) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing expectedVersion or clientOpId',
      });
    }

    if (!isValidUuidV4(body.clientOpId)) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'clientOpId must be a valid UUIDv4',
      });
    }

    const op = options.outbox.executeWithOutbox(
      () => diningService.closeCuentaSync(id, body.expectedVersion, body.closedStatus ?? 'PAGADA'),
      (result) => [
        {
          organizationId: options.organizationId,
          branchId: options.branchId,
          aggregateType: 'CUENTA',
          aggregateId: id,
          action: 'CLOSE_CUENTA',
          clientOpId: body.clientOpId,
          aggregateSequenceNumber: result.cuenta.version,
          payload: {
            cuentaId: id,
            status: result.cuenta.status,
            totalAmount: scaledBigIntToDecimalString(result.cuenta.totalAmount),
          },
        },
      ],
    );

    return reply.status(200).send({
      cuenta: serializeCuentaToDTO(op.cuenta),
      mesa: op.mesa ? serializeMesaToDTO(op.mesa) : undefined,
    });
  });

  // ==========================================
  // Cash Management & Shifts API (WP-016 / DEC-017)
  // ==========================================

  // POST /turnos/apertura
  app.post('/turnos/apertura', async (req, reply) => {
    const body = req.body as {
      organizationId?: string;
      branchId?: string;
      stationId: string;
      responsibleUserId: string;
      openedByUserId?: string;
      openingCashFloat: string; // Scale-4 DecimalString (e.g. "500.0000")
      shiftNumber?: number;
      operatorPin?: string;
    };

    const organizationId = body?.organizationId ?? options.organizationId;
    const branchId = body?.branchId ?? options.branchId;

    if (!organizationId || !branchId) {
      return reply.status(400).send({
        error: 'MISSING_TENANT_IDENTITY',
        message: 'Missing mandatory tenant identity: organizationId, branchId',
      });
    }

    if (!body?.stationId || !body?.responsibleUserId || body?.openingCashFloat === undefined) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory fields: stationId, responsibleUserId, openingCashFloat',
      });
    }

    const openingCashFloat = decimalStringToScaledBigInt(body.openingCashFloat);

    const turno = await shiftService.abrirTurno({
      organizationId,
      branchId,
      stationId: body.stationId,
      responsibleUserId: body.responsibleUserId,
      openedByUserId: body.openedByUserId,
      openingCashFloat,
      shiftNumber: body.shiftNumber,
      operatorPin: body.operatorPin,
    });

    return reply.status(201).send({
      turno: serializeTurnoCajaToDTO(turno),
    });
  });

  // POST /turnos/:id/operadores (Add participant to shared shift, DEC-017)
  app.post('/turnos/:id/operadores', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      operatorUserId: string;
      addedByUserId: string;
      expectedVersion: number;
      operatorPin?: string;
      requestingPin?: string;
    };

    if (
      !id ||
      !body?.operatorUserId ||
      !body?.addedByUserId ||
      body.expectedVersion === undefined
    ) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory fields: operatorUserId, addedByUserId, expectedVersion',
      });
    }

    const turno = await shiftService.agregarOperador({
      shiftId: id,
      operatorUserId: body.operatorUserId,
      requestingUserId: body.addedByUserId,
      expectedVersion: body.expectedVersion,
      operatorPin: body.operatorPin,
      requestingPin: body.requestingPin,
    });

    return reply.status(200).send({
      turno: serializeTurnoCajaToDTO(turno),
    });
  });

  // POST /turnos/:id/movimientos (Register cash movement)
  app.post('/turnos/:id/movimientos', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      operatorUserId: string;
      movementType: MovimientoCaja['movementType'];
      amount: string; // Scale-4 DecimalString
      reason: string;
      referenceId?: string | null;
      expectedVersion: number;
      operatorPin?: string;
    };

    if (
      !id ||
      !body?.operatorUserId ||
      !body?.movementType ||
      body?.amount === undefined ||
      !body?.reason ||
      body.expectedVersion === undefined
    ) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message:
          'Missing mandatory fields: operatorUserId, movementType, amount, reason, expectedVersion',
      });
    }

    const amount = decimalStringToScaledBigInt(body.amount);

    const result = await shiftService.registrarMovimiento({
      shiftId: id,
      operatorUserId: body.operatorUserId,
      movementType: body.movementType,
      amount,
      reason: body.reason,
      referenceId: body.referenceId,
      expectedVersion: body.expectedVersion,
      operatorPin: body.operatorPin,
    });

    return reply.status(201).send({
      turno: serializeTurnoCajaToDTO(result.shift),
      movimiento: serializeMovimientoCajaToDTO(result.movement),
    });
  });

  // POST /turnos/:id/corte-x (Read-only partial inspection)
  app.post('/turnos/:id/corte-x', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      requestedByUserId: string;
      requestedByPin?: string;
    };

    if (!id || !body?.requestedByUserId) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory field: requestedByUserId',
      });
    }

    const corte = await shiftService.generarCorteX({
      shiftId: id,
      requestedByUserId: body.requestedByUserId,
      requestedByPin: body.requestedByPin,
    });

    return reply.status(200).send({
      corte: serializeCorteCajaToDTO(corte),
    });
  });

  // POST /turnos/:id/arqueo (Blind cash count, captures declared cash before displaying calculated total)
  app.post('/turnos/:id/arqueo', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      performedByUserId: string;
      declaredCash: string; // Scale-4 DecimalString
      expectedVersion: number;
      performedByPin?: string;
    };

    if (
      !id ||
      !body?.performedByUserId ||
      body?.declaredCash === undefined ||
      body.expectedVersion === undefined
    ) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory fields: performedByUserId, declaredCash, expectedVersion',
      });
    }

    const declaredCash = decimalStringToScaledBigInt(body.declaredCash);

    const result = await shiftService.realizarArqueoCiego({
      shiftId: id,
      performedByUserId: body.performedByUserId,
      declaredCash,
      expectedVersion: body.expectedVersion,
      performedByPin: body.performedByPin,
    });

    return reply.status(200).send({
      turno: serializeTurnoCajaToDTO(result.shift),
      arqueo: serializeArqueoCiegoToDTO(result.arqueo),
    });
  });

  // POST /turnos/:id/corte-z (Permanently closes shift, commits with PRAGMA synchronous = FULL, emits sync event)
  app.post('/turnos/:id/corte-z', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      closedByUserId: string;
      expectedVersion: number;
      closedByPin?: string;
    };

    if (!id || !body?.closedByUserId || body.expectedVersion === undefined) {
      return reply.status(400).send({
        error: 'MISSING_FIELDS',
        message: 'Missing mandatory fields: closedByUserId, expectedVersion',
      });
    }

    const result = await shiftService.generarCorteZ({
      shiftId: id,
      closedByUserId: body.closedByUserId,
      expectedVersion: body.expectedVersion,
      closedByPin: body.closedByPin,
    });

    return reply.status(200).send({
      turno: serializeTurnoCajaToDTO(result.shift),
      corte: serializeCorteCajaToDTO(result.corte),
    });
  });

  return app;
}
