/**
 * TRIDENTPOS KDS Persistence & Transport Ports (WP-015, Hexagonal Architecture / ADR-013, ACR-2026-016)
 * Implemented by infrastructure adapters in composition root @trident/pos-edge-runtime.
 * @trident/pos defines only ports and domain logic, never importing infrastructure packages.
 *
 * Per DATA_AUTHORITY_MATRIX.md ("KDS (Preparacion Cocina/Barra)" row): conflict policy is
 * Causal Sequence Number, not OCC compare-and-swap -- KDS ticket writes are append/advance
 * only (no concurrent multi-writer contention expected on a single Edge Host), so
 * `saveTicket` takes the full ticket and persists it monotonically by
 * `aggregateSequenceNumber`, unlike Mesa/Cuenta's `expectedVersion` CAS pattern.
 */

import type { ImpresoraRed, KdsEstacion, KdsTicket, PrinterStatus } from './kds-types.js';

export interface KdsRepositoryPort {
  getEstacionById(id: string): KdsEstacion | null;
  listEstaciones(): readonly KdsEstacion[];
  getTicketById(id: string): KdsTicket | null;
  saveTicket(ticket: KdsTicket): KdsTicket;
  listActiveTicketsByEstacion(kdsEstacionId: string): readonly KdsTicket[];
  getTicketForRecall(ordenProduccionId: string, windowMinutes: number): KdsTicket | null;
}

export interface PrinterRepositoryPort {
  getPrinterById(id: string): ImpresoraRed | null;
  listPrinters(): readonly ImpresoraRed[];
  updatePrinterStatus(id: string, status: PrinterStatus, lastSeenAt: string): void;
  /** Tickets whose printStatus is PENDING, QUEUED, or FAILED -- eligible for a print attempt. */
  listPendingPrintJobs(): readonly KdsTicket[];
  recoverInterruptedPrintingJobs(): readonly KdsTicket[];
  markTicketPrintAttempt(
    id: string,
    result: {
      readonly status: KdsTicket['printStatus'];
      readonly attempts: number;
      readonly lastPrintError: string | null;
    },
  ): void;
}

/**
 * Transport-side publish port. The Edge WebSocket dispatcher (@trident/edge)
 * implements the actual broadcast mechanics; this port only describes the
 * contract the domain service uses to hand off an event -- it carries no
 * transport-layer detail (no socket/connection concepts leak into @trident/pos).
 */
export interface KdsEventPublisherPort {
  publishTicketEvent(event: import('./kds-types.js').KdsDomainEvent): void;
}
