/**
 * TRIDENTPOS Event-Driven TanStack Query Cache Invalidator
 * Sits on window.trident.events per FRONTEND_ARCHITECTURE.md Sec 7 & Decision FE-06.
 */

import { DomainEvent, TridentApi } from '../bridge/trident-bridge.js';

export interface QueryInvalidationHandler {
  readonly invalidateQueries: (queryKeyPrefix: readonly unknown[]) => void;
  readonly invalidateAll: () => void;
}

export class EventInvalidator {
  private unsubscribeFn: (() => void) | null = null;

  constructor(
    private readonly bridge: TridentApi,
    private readonly cacheHandler: QueryInvalidationHandler,
  ) {}

  public start(): void {
    if (this.unsubscribeFn) return;

    this.unsubscribeFn = this.bridge.events.subscribe((event: DomainEvent) => {
      this.handleDomainEvent(event);
    });
  }

  public stop(): void {
    if (this.unsubscribeFn) {
      this.unsubscribeFn();
      this.unsubscribeFn = null;
    }
  }

  public handleDomainEvent(event: DomainEvent): void {
    // ACR-2026-020 Event Contract Version check: drop unknown major versions and force full refetch
    if (event.eventContractVersion !== 1) {
      this.cacheHandler.invalidateAll();
      return;
    }

    switch (event.eventType) {
      // Salón / Dining Events
      case 'CuentaAbierta':
      case 'CuentaActualizada':
      case 'CuentaCancelada':
      case 'PartidaAgregada':
      case 'PartidaCancelada':
      case 'CuentaTransferida':
      case 'CuentaDividida':
      case 'MesaLiberada':
        this.cacheHandler.invalidateQueries(['salon', 'floor-plan']);
        if (event.entityId) {
          this.cacheHandler.invalidateQueries(['salon', 'cuenta', event.entityId]);
        }
        break;

      // KDS Ticket Events
      case 'KdsTicketCreado':
      case 'KdsTicketActualizado':
      case 'KdsTicketListo':
      case 'KdsTicketBumped':
        this.cacheHandler.invalidateQueries(['kds', 'tickets']);
        break;

      // Cash / Caja Events
      case 'TurnoCajaAbierto':
      case 'TurnoCajaCerrado':
      case 'MovimientoCajaRegistrado':
      case 'CorteCajaGenerado':
        this.cacheHandler.invalidateQueries(['caja', 'shift']);
        break;

      // Payment & Settlement (WP-016C)
      case 'PagoRegistrado':
      case 'CuentaPagada':
        this.cacheHandler.invalidateQueries(['caja', 'shift']);
        this.cacheHandler.invalidateQueries(['salon', 'floor-plan']);
        if (event.entityId) {
          this.cacheHandler.invalidateQueries(['caja', 'payments', event.entityId]);
          this.cacheHandler.invalidateQueries(['salon', 'cuenta', event.entityId]);
        }
        break;

      // Reconnect Resync (ADR-005)
      case 'connectivity.restored':
        this.cacheHandler.invalidateAll();
        break;

      default:
        // Unknown domain event: invalidate all operational queries fail-safe
        this.cacheHandler.invalidateAll();
        break;
    }
  }
}
