/**
 * TRIDENTPOS KDS Printer Queue Runner (WP-015)
 * Composition-root orchestration: retries queued/failed KDS tickets against
 * their assigned network printer using @trident/edge's raw ESC/POS transport,
 * persisting outcomes through @trident/pos's PrinterRepositoryPort. Retry
 * policy (attempt caps, backoff) is orchestration, not domain or transport
 * concern, so it lives here per ADR-013 Invariant 3 (composition roots own
 * retry/wiring; adapters below stay minimal and generic).
 *
 * A printer failure (offline, unreachable, disconnected, paper-out) MUST NOT
 * make order capture unavailable: this runner never throws out of
 * `runPendingQueueOnce()` for an individual ticket's printer failure -- it
 * always marks the ticket FAILED (still durably queued in SQLite, eligible
 * for a future retry) and continues with the next ticket.
 */

import { EscPosPrinterClient, formatKdsTicketEscPos } from '@trident/edge';
import type { ImpresoraRed, KdsTicket, PrinterRepositoryPort } from '@trident/pos';

export interface PrinterQueueRunnerOptions {
  readonly printerRepo: PrinterRepositoryPort;
  readonly maxAttempts?: number; // default 5
  readonly connectTimeoutMs?: number;
  readonly writeTimeoutMs?: number;
}

export interface PrintAttemptResult {
  readonly ticketId: string;
  readonly outcome: 'PRINTED' | 'FAILED' | 'NO_PRINTER_ASSIGNED' | 'MAX_ATTEMPTS_EXCEEDED';
  readonly error?: string;
}

export class PrinterQueueRunner {
  readonly #printerRepo: PrinterRepositoryPort;
  readonly #maxAttempts: number;
  readonly #connectTimeoutMs?: number;
  readonly #writeTimeoutMs?: number;

  constructor(options: PrinterQueueRunnerOptions) {
    this.#printerRepo = options.printerRepo;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#connectTimeoutMs = options.connectTimeoutMs;
    this.#writeTimeoutMs = options.writeTimeoutMs;
  }

  /**
   * Resolves the printer for a ticket that has none assigned yet: the first
   * printer registered against the ticket's own KDS estacion, if any.
   */
  #resolvePrinterFor(ticket: KdsTicket): ImpresoraRed | null {
    if (ticket.printerId) {
      return this.#printerRepo.getPrinterById(ticket.printerId);
    }
    const candidate = this.#printerRepo
      .listPrinters()
      .find((p) => p.kdsEstacionId === ticket.kdsEstacionId);
    return candidate ?? null;
  }

  /**
   * Attempts to print every ticket currently eligible (PENDING, QUEUED, or
   * FAILED under the attempt cap). Never throws for an individual ticket's
   * printer failure -- each ticket's outcome is captured and returned.
   */
  public async runPendingQueueOnce(): Promise<readonly PrintAttemptResult[]> {
    const pending = this.#printerRepo.listPendingPrintJobs();
    const results: PrintAttemptResult[] = [];

    for (const ticket of pending) {
      results.push(await this.#attemptPrint(ticket));
    }

    return results;
  }

  async #attemptPrint(ticket: KdsTicket): Promise<PrintAttemptResult> {
    if (ticket.printAttempts >= this.#maxAttempts) {
      return { ticketId: ticket.id, outcome: 'MAX_ATTEMPTS_EXCEEDED' };
    }

    const printer = this.#resolvePrinterFor(ticket);
    if (!printer) {
      this.#printerRepo.markTicketPrintAttempt(ticket.id, {
        status: 'FAILED',
        attempts: ticket.printAttempts,
        lastPrintError: 'NO_PRINTER_ASSIGNED',
      });
      return { ticketId: ticket.id, outcome: 'NO_PRINTER_ASSIGNED', error: 'NO_PRINTER_ASSIGNED' };
    }

    const client = new EscPosPrinterClient({
      host: printer.host,
      port: printer.port,
      connectTimeoutMs: this.#connectTimeoutMs,
      writeTimeoutMs: this.#writeTimeoutMs,
    });

    const payload = formatKdsTicketEscPos({
      ticketId: ticket.id,
      mesaReference: ticket.mesaReference,
      urgencyLevel: ticket.urgencyLevel,
      createdAt: ticket.createdAt,
      partidas: ticket.partidas.map((p) => ({
        quantity: p.quantity,
        productNameSnapshot: p.productNameSnapshot,
        comments: p.comments,
        modifiers: p.modifiers,
      })),
    });

    const attemptNumber = ticket.printAttempts + 1;

    try {
      await client.printTicket(payload);
      this.#printerRepo.markTicketPrintAttempt(ticket.id, {
        status: 'PRINTED',
        attempts: attemptNumber,
        lastPrintError: null,
      });
      this.#printerRepo.updatePrinterStatus(printer.id, 'ONLINE', new Date().toISOString());
      return { ticketId: ticket.id, outcome: 'PRINTED' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextStatus = attemptNumber >= this.#maxAttempts ? 'FAILED' : 'QUEUED';
      this.#printerRepo.markTicketPrintAttempt(ticket.id, {
        status: nextStatus,
        attempts: attemptNumber,
        lastPrintError: message,
      });
      this.#printerRepo.updatePrinterStatus(printer.id, 'OFFLINE', new Date().toISOString());
      return { ticketId: ticket.id, outcome: 'FAILED', error: message };
    }
  }
}
