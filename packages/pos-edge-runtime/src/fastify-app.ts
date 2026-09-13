/**
 * TRIDENTPOS Edge POS Fastify LAN REST Application (ADR-013)
 * Provides local LAN REST daemon for floor operations.
 * Enforces canonical fixed-four-decimal transport format and OCC conflict resolution.
 */

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { decimalStringToScaledBigInt, scaledBigIntToDecimalString } from '@trident/core';
import {
  type AccountType,
  type Cuenta,
  type CuentaItem,
  type CuentaItemModificador,
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

export async function createPosFastifyApp(options: FastifyAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const repo = new SqliteDiningRoomRepository(options.edgeDb);
  const service = new DiningDomainService({
    diningRepo: repo,
    accountRepo: repo,
  });

  // Custom Error Handler mapping domain & OCC errors
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof OCCConflictError) {
      const snapshotDTO = error.currentSnapshot
        ? serializeCuentaToDTO(error.currentSnapshot as Cuenta)
        : null;

      return reply.status(409).send({
        error: 'OCC_CONFLICT',
        message: error.message,
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

    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: (error as Error).message,
    });
  });

  // -------------------------------------------------------------
  // Mesas Endpoints
  // -------------------------------------------------------------
  app.post('/mesas', async (req, reply) => {
    const body = req.body as { id: string; roomName: string; tableNumber: string };
    if (!body?.id || !body?.roomName || !body?.tableNumber) {
      return reply
        .status(400)
        .send({ error: 'MISSING_FIELDS', message: 'Missing id, roomName, or tableNumber' });
    }

    const mesa = await service.createMesa(body);
    return reply.status(201).send(mesa);
  });

  app.get('/mesas', async (_req, reply) => {
    const mesas = await repo.listMesas();
    return reply.send(mesas);
  });

  // -------------------------------------------------------------
  // Cuentas Endpoints
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

    // Standard service openCuenta with OCC
    const op = await service.openCuenta(body);

    options.outbox.enqueue({
      organizationId: options.organizationId,
      branchId: options.branchId,
      aggregateType: 'CUENTA',
      aggregateId: body.id,
      action: 'OPEN_CUENTA',
      clientOpId: body.clientOpId,
      aggregateSequenceNumber: 1,
      payload: { cuentaId: body.id, mesaId: body.mesaId, accountType: body.accountType },
    });

    return reply.status(201).send({
      cuenta: serializeCuentaToDTO(op.cuenta),
      mesa: op.mesa,
    });
  });

  app.get('/cuentas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cuenta = await repo.getCuentaById(id);
    if (!cuenta) {
      return reply
        .status(404)
        .send({ error: 'CUENTA_NOT_FOUND', message: `Cuenta '${id}' not found` });
    }
    return reply.send(serializeCuentaToDTO(cuenta));
  });

  // Add Item to Cuenta (supports POST /cuentas/:id/items and alias POST /ordenes/partidas)
  const handleAddItem = async (
    req: FastifyRequest<{ Params: { id?: string }; Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const cuentaId = req.params?.id ?? (req.body?.cuentaId as string | undefined);
    const body = req.body as {
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

    // Execute with transactional outbox
    const updatedCuenta = await service.addItemToCuenta(cuentaId, body.expectedVersion, {
      id: body.id,
      productId: body.productId,
      productNameSnapshot: body.productNameSnapshot,
      unitPriceApplied,
      quantity,
      taxRateApplied,
      discountAmountApplied,
      modifiers,
    });

    options.outbox.enqueue({
      organizationId: options.organizationId,
      branchId: options.branchId,
      aggregateType: 'CUENTA',
      aggregateId: cuentaId,
      action: 'ADD_ITEM',
      clientOpId: body.clientOpId,
      aggregateSequenceNumber: updatedCuenta.version,
      payload: {
        cuentaId,
        itemId: body.id,
        productId: body.productId,
        quantity: body.quantity,
        total: scaledBigIntToDecimalString(updatedCuenta.totalAmount),
      },
    });

    return reply.status(200).send(serializeCuentaToDTO(updatedCuenta));
  };

  app.post('/cuentas/:id/items', handleAddItem);
  app.post('/ordenes/partidas', handleAddItem);

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

    const { cuenta, mesa } = await service.closeCuenta(
      id,
      body.expectedVersion,
      body.closedStatus ?? 'PAGADA',
    );

    options.outbox.enqueue({
      organizationId: options.organizationId,
      branchId: options.branchId,
      aggregateType: 'CUENTA',
      aggregateId: id,
      action: 'CLOSE_CUENTA',
      clientOpId: body.clientOpId,
      aggregateSequenceNumber: cuenta.version,
      payload: {
        cuentaId: id,
        status: cuenta.status,
        totalAmount: scaledBigIntToDecimalString(cuenta.totalAmount),
      },
    });

    return reply.status(200).send({
      cuenta: serializeCuentaToDTO(cuenta),
      mesa,
    });
  });

  return app;
}
