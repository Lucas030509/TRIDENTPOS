/**
 * TRIDENTPOS KDS Domain Types (WP-015, ACR-2026-016)
 * Kitchen Display System ticket/estación/printer domain model.
 * Conforms to FUNCTIONAL_ARCHITECTURE.md Sec. 3 & 6.1 (Contrato TRIDENTPOS <-> KDS), ADR-005, and ADR-012.
 * All quantities are canonical scale-4 decimal strings on domain/transport boundaries (ADR-012 convention);
 * authoritative persistence in SQLite uses INTEGER scale-4.
 * KDS tickets carry no monetary fields (kitchen production concern only).
 */

export type KdsEstacionType = 'COCINA' | 'BARRA';

export type KdsEstacionStatus = 'ACTIVA' | 'INACTIVA';

export type KdsTicketStatus = 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';

export type KdsTicketPartidaStatus = 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO';

export type UrgencyLevel = 'NORMAL' | 'ALTA' | 'URGENTE';

export type PrintJobStatus = 'PENDING' | 'QUEUED' | 'PRINTING' | 'PRINTED' | 'FAILED';

export type PrinterStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface KdsEstacion {
  readonly id: string;
  readonly name: string;
  readonly stationType: KdsEstacionType;
  readonly status: KdsEstacionStatus;
  readonly createdAt: string;
}

export interface ImpresoraRed {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly kdsEstacionId: string | null;
  readonly status: PrinterStatus;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}

export interface KdsTicketPartidaModificadorSnapshot {
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
}

export interface KdsTicketPartida {
  readonly id: string;
  readonly kdsTicketId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly quantity: string; // canonical 4-decimal string (ADR-012)
  readonly comments: string | null;
  readonly modifiers: readonly KdsTicketPartidaModificadorSnapshot[];
  readonly status: KdsTicketPartidaStatus;
  readonly createdAt: string;
}

export interface KdsTicket {
  readonly id: string;
  readonly cuentaId: string;
  readonly mesaReference: string;
  readonly kdsEstacionId: string;
  readonly urgencyLevel: UrgencyLevel;
  readonly status: KdsTicketStatus;
  readonly printStatus: PrintJobStatus;
  readonly printAttempts: number;
  readonly printerId: string | null;
  readonly lastPrintError: string | null;
  readonly aggregateSequenceNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly preparationTimeMinutes: number | null; // integer >= 0 populated on completion (ACR-2026-016)
  readonly partidas: readonly KdsTicketPartida[];
}

/** Input for `KdsDomainService.enviarComandaACocina`. */
export interface EnviarComandaInput {
  readonly id: string;
  readonly cuentaId: string;
  readonly mesaReference: string;
  readonly kdsEstacionId: string;
  readonly urgencyLevel?: UrgencyLevel;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly productId: string;
    readonly productNameSnapshot: string;
    readonly quantity: string; // canonical 4-decimal string, e.g. "1.0000"
    readonly comments?: string | null;
    readonly modifiers?: ReadonlyArray<KdsTicketPartidaModificadorSnapshot>;
  }>;
}

/**
 * Domain event contract per FUNCTIONAL_ARCHITECTURE.md Sec. 6.1
 * ("Eventos de Dominio Emitidos"). Transported verbatim over `WS /kds/events`
 * by the Edge WebSocket dispatcher (@trident/edge) -- the dispatcher does not
 * interpret or mutate this payload, it only broadcasts it (Sec. 8 of the
 * WP-015 work order: "no business-rule ownership in the WebSocket dispatcher").
 */
export type KdsDomainEventType =
  | 'ComandaEnviadaACocina'
  | 'OrdenProduccionIniciadaEnKDS'
  | 'OrdenProduccionConfirmadaEnKDS';

export interface KdsDomainEvent {
  readonly type: KdsDomainEventType;
  readonly kdsEstacionId: string;
  readonly ticket: KdsTicket;
  readonly emittedAt: string;
  readonly tiempoPreparacionMinutos?: number | null; // explicitly propagated per ACR-2026-016 on completion
}
