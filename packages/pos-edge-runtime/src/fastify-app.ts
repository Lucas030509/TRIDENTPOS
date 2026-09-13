/**
 * TRIDENTPOS Edge POS Fastify LAN REST Application (ADR-013)
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
  type Cuenta,
  type CuentaItem,
  type CuentaItemModificador,
  type Mesa,
  DiningDomainService,
  DomainError,
  OCCConflictError,
} from '@trident/pos';
import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import { SqliteDiningRoomRepository } from './dining-sqlite-repository.js';

export interface FastifyAppOptions {
  readonly edgeDb: EdgeDatabaseService;
  readonly outbox: EdgeOutboxPersistence;
  readonly organizationId: string;
  readonly branchId: string;
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

export function serializeSnapshotToDTO(snapshot: unknown): {
  aggregateType: 'CUENTA' | 'MESA' | 'UNKNOWN';
  snapshot: Record<string, unknown> | null;
} {
  if (!snapshot || typeof snapshot !== 'object') {
    return { aggregateType: 'UNKNOWN', snapshot: null };
  }
  const rec = snapshot as Record<string, unknown>;
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
  const repo = new SqliteDiningRoomRepository(options.edgeDb);
  const service = new DiningDomainService({
    diningRepo: repo,
    accountRepo: repo,
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

  // -------------------------------------------------------------
  // Frozen WP-014 Public Cuentas & Orders Endpoints
  // -------------------------------------------------------------
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
      () => service.openCuentaSync(body),
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
      unitPriceApplied: string; // Canonical 4-decimal string
      quantity: string; // Canonical 4-decimal string
      taxRateApplied: string; // Canonical 4-decimal string
      discountAmountApplied?: string; // Canonical 4-decimal string
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

    // Strict lexical conversion to scale-4 BigInt
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

    // Execute with transactional outbox under one synchronous transaction
    const updatedCuenta = options.outbox.executeWithOutbox(
      () =>
        service.addItemToCuentaSync(cuentaId, body.expectedVersion, {
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
      () => service.closeCuentaSync(id, body.expectedVersion, body.closedStatus ?? 'PAGADA'),
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

  return app;
}
