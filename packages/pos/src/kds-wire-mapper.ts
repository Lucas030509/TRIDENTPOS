/**
 * TRIDENTPOS KDS Wire DTO Mappers (WP-015, ADR-012, ACR-2026-016)
 * Maps between authoritative domain entities (with bigint quantities) and
 * wire/JSON transport DTOs (with canonical 4-decimal strings).
 */

import { decimalStringToScaledBigInt, scaledBigIntToDecimalString } from '@trident/core';
import type {
  EnviarComandaItemInput,
  KdsTicket,
  KdsTicketPartida,
  KdsTicketPartidaModificadorSnapshot,
  KdsTicketPartidaWireDto,
  KdsTicketWireDto,
} from './kds-types.js';

export function mapKdsTicketPartidaToWire(partida: KdsTicketPartida): KdsTicketPartidaWireDto {
  return {
    id: partida.id,
    kdsTicketId: partida.kdsTicketId,
    productId: partida.productId,
    productNameSnapshot: partida.productNameSnapshot,
    quantity: scaledBigIntToDecimalString(partida.quantity),
    comments: partida.comments,
    modifiers: partida.modifiers,
    status: partida.status,
    createdAt: partida.createdAt,
  };
}

export function mapKdsTicketToWire(ticket: KdsTicket): KdsTicketWireDto {
  return {
    id: ticket.id,
    cuentaId: ticket.cuentaId,
    mesaReference: ticket.mesaReference,
    kdsEstacionId: ticket.kdsEstacionId,
    urgencyLevel: ticket.urgencyLevel,
    status: ticket.status,
    printStatus: ticket.printStatus,
    printAttempts: ticket.printAttempts,
    printerId: ticket.printerId,
    lastPrintError: ticket.lastPrintError,
    aggregateSequenceNumber: ticket.aggregateSequenceNumber,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    completedAt: ticket.completedAt,
    preparationTimeMinutes: ticket.preparationTimeMinutes,
    partidas: ticket.partidas.map(mapKdsTicketPartidaToWire),
  };
}

export function parseComandaWireItem(item: {
  readonly id: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly quantity: string;
  readonly comments?: string | null;
  readonly modifiers?: ReadonlyArray<KdsTicketPartidaModificadorSnapshot>;
}): EnviarComandaItemInput {
  return {
    id: item.id,
    productId: item.productId,
    productNameSnapshot: item.productNameSnapshot,
    quantity: decimalStringToScaledBigInt(item.quantity),
    comments: item.comments,
    modifiers: item.modifiers,
  };
}
