/**
 * TRIDENTPOS KDS Edge Composition Root (WP-015)
 * Wires @trident/pos's KdsDomainService (pure domain logic) to
 * @trident/edge's KdsWebSocketDispatcher (WS /kds/events transport) and
 * EscPosPrinterClient (via PrinterQueueRunner), backed by
 * SqliteKdsRepository for persistence. Contains zero business logic of its
 * own (ADR-013 Invariant 3: composition roots own only lifecycle, transport
 * routing, and dependency injection).
 */

import type http from 'node:http';
import { KdsWebSocketDispatcher, type KdsDispatcherLogger } from '@trident/edge';
import { EdgeDatabaseService } from '@trident/edge';
import { KdsDomainService, type KdsEventPublisherPort, mapKdsTicketToWire } from '@trident/pos';
import { SqliteKdsRepository } from './kds-sqlite-repository.js';
import { PrinterQueueRunner } from './printer-queue-runner.js';

export interface CreateKdsRuntimeOptions {
  readonly edgeDb: EdgeDatabaseService;
  readonly wsServer?: http.Server;
  readonly wsPort?: number;
  readonly wsPath?: string;
  readonly heartbeatIntervalMs?: number;
  readonly authenticateStation?: (req: http.IncomingMessage) => boolean | Promise<boolean>;
  readonly printerMaxAttempts?: number;
  readonly printerConnectTimeoutMs?: number;
  readonly printerWriteTimeoutMs?: number;
  readonly logger?: KdsDispatcherLogger;
}

export interface KdsRuntime {
  readonly repo: SqliteKdsRepository;
  readonly service: KdsDomainService;
  readonly dispatcher: KdsWebSocketDispatcher;
  readonly printerQueueRunner: PrinterQueueRunner;
}

export function createKdsRuntime(options: CreateKdsRuntimeOptions): KdsRuntime {
  const repo = new SqliteKdsRepository(options.edgeDb);

  const dispatcher = new KdsWebSocketDispatcher({
    server: options.wsServer,
    port: options.wsPort,
    path: options.wsPath,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    authenticateStation: options.authenticateStation,
    logger: options.logger,
    // ADR-005 full-state resync on (re)connection: send every active ticket
    // across all stations so a reconnecting KDS screen never misses work
    // that was broadcast while it was disconnected.
    getResyncSnapshot: () => {
      const estaciones = repo.listEstaciones();
      const activeTickets = estaciones
        .flatMap((e) => repo.listActiveTicketsByEstacion(e.id))
        .map(mapKdsTicketToWire);
      return { activeTickets };
    },
  });

  const eventPublisher: KdsEventPublisherPort = {
    publishTicketEvent(event) {
      if (event.type === 'OrdenProduccionConfirmadaEnKDS') {
        dispatcher.broadcast({
          type: event.type,
          kdsEstacionId: event.kdsEstacionId,
          payload: {
            ordenProduccionId: event.ordenProduccionId,
            completedAt: event.completedAt,
            tiempoPreparacionMinutos: event.tiempoPreparacionMinutos,
            ticket: mapKdsTicketToWire(event.ticket),
          },
          emittedAt: event.emittedAt,
        });
      } else {
        dispatcher.broadcast({
          type: event.type,
          kdsEstacionId: event.kdsEstacionId,
          payload: {
            ticket: mapKdsTicketToWire(event.ticket),
          },
          emittedAt: event.emittedAt,
        });
      }
    },
  };


  const service = new KdsDomainService({ kdsRepo: repo, eventPublisher });

  const printerQueueRunner = new PrinterQueueRunner({
    printerRepo: repo,
    maxAttempts: options.printerMaxAttempts,
    connectTimeoutMs: options.printerConnectTimeoutMs,
    writeTimeoutMs: options.printerWriteTimeoutMs,
  });

  return { repo, service, dispatcher, printerQueueRunner };
}
