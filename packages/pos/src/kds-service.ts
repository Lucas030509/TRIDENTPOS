/**
 * TRIDENTPOS KDS Domain Service (WP-015, ACR-2026-016)
 * Pure business logic implementing the FUNCTIONAL_ARCHITECTURE.md Sec. 6.1
 * "Contrato TRIDENTPOS <-> KDS" functional commands/queries and ADR-012 quantity rules.
 * Never imports infrastructure (@trident/edge) -- transport (WebSocket broadcast, printing)
 * is the composition root's responsibility (ADR-013 Invariant 1).
 */

import { decimalStringToScaledBigInt, scaledBigIntToDecimalString } from '@trident/core';
import { DomainError } from './errors.js';
import type {
  EnviarComandaInput,
  KdsDomainEvent,
  KdsTicket,
  KdsTicketPartida,
} from './kds-types.js';
import type { KdsEventPublisherPort, KdsRepositoryPort } from './kds-ports.js';

export interface KdsServiceOptions {
  readonly kdsRepo: KdsRepositoryPort;
  readonly eventPublisher?: KdsEventPublisherPort;
}

export class KdsDomainService {
  readonly #kdsRepo: KdsRepositoryPort;
  readonly #eventPublisher?: KdsEventPublisherPort;

  constructor(options: KdsServiceOptions) {
    this.#kdsRepo = options.kdsRepo;
    this.#eventPublisher = options.eventPublisher;
  }

  /**
   * `EnviarComandaACocina(cuentaId, mesaId, items[], modificadores[], comentarios, urgencia)`
   * Creates a new KDS ticket and emits `ComandaEnviadaACocina`. The ticket is created
   * with printStatus PENDING -- printing itself is orchestrated separately by the
   * composition root's printer queue runner, never by this domain method directly
   * (the WebSocket dispatcher and printer transport own zero business semantics).
   */
  public enviarComandaACocina(input: EnviarComandaInput): KdsTicket {
    const existing = this.#kdsRepo.getTicketById(input.id);
    if (existing) {
      throw new DomainError(`KDS ticket '${input.id}' already exists`, 'DUPLICATE_KDS_TICKET', 409);
    }

    const estacion = this.#kdsRepo.getEstacionById(input.kdsEstacionId);
    if (!estacion) {
      throw new DomainError(
        `KDS estacion '${input.kdsEstacionId}' not found`,
        'KDS_ESTACION_NOT_FOUND',
        404,
      );
    }
    if (estacion.status !== 'ACTIVA') {
      throw new DomainError(
        `KDS estacion '${input.kdsEstacionId}' is not ACTIVA (current status: ${estacion.status})`,
        'KDS_ESTACION_INACTIVE',
        409,
      );
    }

    if (input.items.length === 0) {
      throw new DomainError('Comanda must contain at least one item', 'EMPTY_COMANDA', 400);
    }

    const now = new Date().toISOString();
    const previousActive = this.#kdsRepo.listActiveTicketsByEstacion(input.kdsEstacionId);
    const nextSequence =
      previousActive.reduce((max, t) => Math.max(max, t.aggregateSequenceNumber), 0) + 1;

    const partidas: KdsTicketPartida[] = input.items.map((item) => {
      let scaledQty: bigint;
      try {
        scaledQty = decimalStringToScaledBigInt(item.quantity);
      } catch (err) {
        throw new DomainError(
          `Invalid quantity '${item.quantity}': must be canonical 4-decimal format`,
          'INVALID_QUANTITY',
          400,
        );
      }

      if (scaledQty <= 0n) {
        throw new DomainError(
          `Item quantity '${item.quantity}' must be greater than zero`,
          'INVALID_QUANTITY',
          400,
        );
      }

      const canonicalQty = scaledBigIntToDecimalString(scaledQty);

      return {
        id: item.id,
        kdsTicketId: input.id,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        quantity: canonicalQty,
        comments: item.comments ?? null,
        modifiers: item.modifiers ?? [],
        status: 'PENDIENTE',
        createdAt: now,
      };
    });

    const ticket: KdsTicket = {
      id: input.id,
      cuentaId: input.cuentaId,
      mesaReference: input.mesaReference,
      kdsEstacionId: input.kdsEstacionId,
      urgencyLevel: input.urgencyLevel ?? 'NORMAL',
      status: 'PENDIENTE',
      printStatus: 'PENDING',
      printAttempts: 0,
      printerId: null,
      lastPrintError: null,
      aggregateSequenceNumber: nextSequence,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      preparationTimeMinutes: null,
      partidas,
    };

    const saved = this.#kdsRepo.saveTicket(ticket);
    this.#emit('ComandaEnviadaACocina', saved);
    return saved;
  }

  /**
   * `IniciarPreparacionOrden(ordenProduccionId, kdsEstacionId)`
   */
  public iniciarPreparacionOrden(kdsTicketId: string, kdsEstacionId: string): KdsTicket {
    const ticket = this.#requireTicketAtEstacion(kdsTicketId, kdsEstacionId);

    if (ticket.status !== 'PENDIENTE') {
      throw new DomainError(
        `Cannot start preparation for ticket in status '${ticket.status}'`,
        'INVALID_KDS_TICKET_STATUS',
        400,
      );
    }

    const now = new Date().toISOString();
    const updated: KdsTicket = {
      ...ticket,
      status: 'EN_PREPARACION',
      partidas: ticket.partidas.map((p) => ({ ...p, status: 'EN_PREPARACION' })),
      updatedAt: now,
    };

    const saved = this.#kdsRepo.saveTicket(updated);
    this.#emit('OrdenProduccionIniciadaEnKDS', saved);
    return saved;
  }

  /**
   * `ConfirmarOrdenSurtida(ordenProduccionId, kdsEstacionId, tiempoPreparacionMinutos)`
   * Hito operacional formal de confirmacion de produccion (FUNCTIONAL_ARCHITECTURE.md Sec 6.1 & ACR-2026-016).
   */
  public confirmarOrdenSurtida(
    kdsTicketId: string,
    kdsEstacionId: string,
    tiempoPreparacionMinutos: number,
  ): KdsTicket {
    const ticket = this.#requireTicketAtEstacion(kdsTicketId, kdsEstacionId);

    if (ticket.status !== 'EN_PREPARACION') {
      throw new DomainError(
        `Cannot confirm order supplied for ticket in status '${ticket.status}'`,
        'INVALID_KDS_TICKET_STATUS',
        400,
      );
    }

    if (
      typeof tiempoPreparacionMinutos !== 'number' ||
      !Number.isInteger(tiempoPreparacionMinutos) ||
      tiempoPreparacionMinutos < 0
    ) {
      throw new DomainError(
        `tiempoPreparacionMinutos must be a non-negative integer (received: ${tiempoPreparacionMinutos})`,
        'INVALID_PREPARATION_TIME',
        400,
      );
    }

    const now = new Date().toISOString();
    const updated: KdsTicket = {
      ...ticket,
      status: 'LISTO',
      partidas: ticket.partidas.map((p) => ({ ...p, status: 'LISTO' })),
      completedAt: now,
      updatedAt: now,
      preparationTimeMinutes: tiempoPreparacionMinutos,
    };

    const saved = this.#kdsRepo.saveTicket(updated);
    this.#emit('OrdenProduccionConfirmadaEnKDS', saved, tiempoPreparacionMinutos);
    return saved;
  }

  /**
   * `ConsultarOrdenesActivas(kdsEstacionId)`
   */
  public consultarOrdenesActivas(kdsEstacionId: string): readonly KdsTicket[] {
    const estacion = this.#kdsRepo.getEstacionById(kdsEstacionId);
    if (!estacion) {
      throw new DomainError(`KDS estacion '${kdsEstacionId}' not found`, 'KDS_ESTACION_NOT_FOUND', 404);
    }
    return this.#kdsRepo.listActiveTicketsByEstacion(kdsEstacionId);
  }

  /**
   * `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)`
   * Canonical functional contract per FUNCTIONAL_ARCHITECTURE.md Sec. 6.1 & ACR-2026-016.
   * Looks up exactly one production order / ticket by `ordenProduccionId` within `ventanaMaxMinutos`
   * anchored on `completed_at`. Non-mutating operation.
   */
  public recuperarOrdenRecall(
    ordenProduccionId: string,
    ventanaMaxMinutos: number = 120,
  ): KdsTicket | null {
    if (typeof ventanaMaxMinutos !== 'number' || ventanaMaxMinutos < 0) {
      throw new DomainError(
        `ventanaMaxMinutos must be a non-negative number (received: ${ventanaMaxMinutos})`,
        'INVALID_RECALL_WINDOW',
        400,
      );
    }

    return this.#kdsRepo.getTicketForRecall(ordenProduccionId, ventanaMaxMinutos);
  }

  #requireTicketAtEstacion(kdsTicketId: string, kdsEstacionId: string): KdsTicket {
    const ticket = this.#kdsRepo.getTicketById(kdsTicketId);
    if (!ticket) {
      throw new DomainError(`KDS ticket '${kdsTicketId}' not found`, 'KDS_TICKET_NOT_FOUND', 404);
    }
    if (ticket.kdsEstacionId !== kdsEstacionId) {
      throw new DomainError(
        `KDS ticket '${kdsTicketId}' does not belong to estacion '${kdsEstacionId}'`,
        'KDS_ESTACION_MISMATCH',
        409,
      );
    }
    return ticket;
  }

  #emit(
    type: KdsDomainEvent['type'],
    ticket: KdsTicket,
    tiempoPreparacionMinutos?: number | null,
  ): void {
    if (!this.#eventPublisher) {
      return;
    }
    const event: KdsDomainEvent = {
      type,
      kdsEstacionId: ticket.kdsEstacionId,
      ticket,
      emittedAt: new Date().toISOString(),
      ...(tiempoPreparacionMinutos !== undefined ? { tiempoPreparacionMinutos } : {}),
    };
    this.#eventPublisher.publishTicketEvent(event);
  }
}
