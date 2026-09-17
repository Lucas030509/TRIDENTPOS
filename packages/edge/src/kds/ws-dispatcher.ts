/**
 * TRIDENTPOS KDS LAN Event Dispatcher (WP-015)
 * Implements: WS /kds/events
 * Local WebSocket pub/sub push engine per ADR-005 ("Servidor WebSocket nativo
 * (ws) en el Edge Host"). Broadcasts already-decided domain events verbatim
 * to connected KDS stations on the LAN -- it never interprets, mutates, or
 * invents order/business semantics (Sec. 8 of the WP-015 work order).
 *
 * ADR-005 obligations implemented here:
 * - Sec. 5.3 Heartbeat every 5s with automatic termination of dead clients.
 * - Sec. 5.3 Full-state resync on (re)connection via an optional
 *   `getResyncSnapshot` callback (Sec. 8: "Ante reconexion, resincronizacion
 *   completa de estado").
 * - Sec. 9 Station/device token handshake authentication via a pluggable
 *   `authenticateStation` callback (fail-closed if not configured).
 * - Sec. 10 Connection/disconnection logging via a pluggable `logger`.
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface KdsBroadcastEvent {
  readonly type: string;
  readonly kdsEstacionId: string;
  readonly payload: unknown;
  readonly emittedAt: string;
}

export interface KdsDispatcherLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface KdsWebSocketDispatcherOptions {
  readonly server?: http.Server;
  readonly port?: number;
  readonly path?: string; // default /kds/events
  readonly heartbeatIntervalMs?: number; // default 5000 per ADR-005 Sec 5.3
  /**
   * Station/device token authenticator. Returning `false`/rejecting refuses
   * the handshake. If omitted, the dispatcher FAILS CLOSED (refuses every
   * connection) rather than silently allowing unauthenticated stations --
   * per ADR-005 Sec 9 and the WP-015 security rules (Sec 14).
   */
  readonly authenticateStation?: (
    req: http.IncomingMessage,
  ) => boolean | Promise<boolean>;
  /**
   * Optional resync-state provider invoked on every successful connection,
   * sent to that single client as an initial `KDS_RESYNC` frame (ADR-005
   * "resincronizacion completa de estado" on reconnect).
   */
  readonly getResyncSnapshot?: (req: http.IncomingMessage) => unknown | Promise<unknown>;
  readonly logger?: KdsDispatcherLogger;
}

interface TrackedClient {
  isAlive: boolean;
}

const noopLogger: KdsDispatcherLogger = {
  info: () => {},
  warn: () => {},
};

export class KdsWebSocketDispatcher {
  readonly #wss: WebSocketServer;
  readonly #clients = new Map<WebSocket, TrackedClient>();
  readonly #logger: KdsDispatcherLogger;
  readonly #heartbeatTimer: NodeJS.Timeout;
  readonly #readyPromise: Promise<void>;

  constructor(options: KdsWebSocketDispatcherOptions = {}) {
    this.#logger = options.logger ?? noopLogger;
    const path = options.path ?? '/kds/events';
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;

    const verifyClient = (
      info: { origin: string; secure: boolean; req: http.IncomingMessage },
      callback: (res: boolean, code?: number, message?: string) => void,
    ): void => {
      const url = info.req.url?.split('?')[0];
      if (url !== path) {
        callback(false, 404, 'Not Found');
        return;
      }

      if (!options.authenticateStation) {
        // Fail closed: no authenticator configured means no station is trusted.
        callback(false, 401, 'Unauthorized: no station authenticator configured');
        return;
      }

      Promise.resolve(options.authenticateStation(info.req))
        .then((ok) => {
          callback(Boolean(ok), ok ? undefined : 401, ok ? undefined : 'Unauthorized');
        })
        .catch(() => {
          callback(false, 401, 'Unauthorized');
        });
    };

    this.#wss = options.server
      ? new WebSocketServer({ server: options.server, path, verifyClient })
      : new WebSocketServer({ port: options.port ?? 0, path, verifyClient });

    // `ws`'s internal http.Server binds asynchronously when constructed with
    // a `port` option -- `.address()` (and therefore `getPort()`) returns
    // null until the underlying server actually starts listening. Track
    // readiness explicitly so callers (e.g. `waitUntilListening()`) never
    // race a still-binding server. When an external `server` is supplied,
    // its own listen lifecycle is the caller's responsibility, so we resolve
    // immediately (ws attaches its upgrade handler synchronously in that path).
    this.#readyPromise = options.server
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.#wss.once('listening', () => resolve());
        });

    this.#wss.on('connection', (ws, req) => {
      this.#clients.set(ws, { isAlive: true });
      this.#logger.info('KDS WebSocket client connected', {
        remoteAddress: req.socket.remoteAddress,
        totalClients: this.#clients.size,
      });

      if (options.getResyncSnapshot) {
        Promise.resolve(options.getResyncSnapshot(req))
          .then((snapshot) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'KDS_RESYNC', payload: snapshot, emittedAt: new Date().toISOString() }));
            }
          })
          .catch((err: unknown) => {
            this.#logger.warn('KDS resync snapshot provider failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }

      ws.on('pong', () => {
        const tracked = this.#clients.get(ws);
        if (tracked) {
          tracked.isAlive = true;
        }
      });

      ws.on('close', () => {
        this.#clients.delete(ws);
        this.#logger.info('KDS WebSocket client disconnected', { totalClients: this.#clients.size });
      });

      ws.on('error', (err) => {
        this.#logger.warn('KDS WebSocket client error', { error: err.message });
      });
    });

    // ADR-005 Sec 5.3: heartbeat every 5s; terminate clients that missed the
    // previous ping (no pong received) to reclaim dead LAN connections.
    this.#heartbeatTimer = setInterval(() => {
      for (const [ws, tracked] of this.#clients) {
        if (!tracked.isAlive) {
          this.#logger.warn('Terminating unresponsive KDS WebSocket client (missed heartbeat)');
          ws.terminate();
          this.#clients.delete(ws);
          continue;
        }
        tracked.isAlive = false;
        ws.ping();
      }
    }, heartbeatIntervalMs);
    this.#heartbeatTimer.unref?.();
  }

  /**
   * Resolves once the underlying server is actually bound and accepting
   * connections. Callers using the ephemeral `port: 0` convention MUST await
   * this before reading `getPort()` or connecting a client, since binding
   * is asynchronous.
   */
  public whenListening(): Promise<void> {
    return this.#readyPromise;
  }

  public getPort(): number {
    const addr = this.#wss.address();
    if (typeof addr === 'object' && addr !== null) {
      return addr.port;
    }
    return 0;
  }

  public getClientCount(): number {
    return this.#clients.size;
  }

  /**
   * Broadcasts an already-decided domain event verbatim to every connected
   * KDS station. Pure transport fan-out: no business-rule evaluation, no
   * order-authority mutation. Returns the number of clients the event was
   * actually sent to (clients not in OPEN state are silently skipped).
   */
  public broadcast(event: KdsBroadcastEvent): number {
    const payload = JSON.stringify(event);
    let sent = 0;
    for (const [ws] of this.#clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent += 1;
      }
    }
    return sent;
  }

  public close(): Promise<void> {
    clearInterval(this.#heartbeatTimer);
    return new Promise((resolve, reject) => {
      for (const [ws] of this.#clients) {
        ws.terminate();
      }
      this.#clients.clear();
      this.#wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
