/**
 * TRIDENTPOS ESC/POS Network Printer Client (WP-015)
 * Raw TCP socket delivery to thermal kitchen printers, default port 9100.
 * Single-attempt transport primitive -- retry/queue policy lives in the
 * composition root (@trident/pos-edge-runtime), never here (ADR-013
 * Invariant 3: composition roots own retry/orchestration, transport
 * adapters stay minimal and generic).
 *
 * A printer failure (offline, unreachable, connection refused, timeout,
 * mid-write reset) MUST NOT crash the caller's order flow -- every failure
 * mode below rejects with a typed `PrinterConnectionError` instead of
 * throwing synchronously or leaving dangling sockets/timers.
 */

import net from 'node:net';

export class PrinterConnectionError extends Error {
  public readonly host: string;
  public readonly port: number;
  public readonly reason: 'TIMEOUT' | 'REFUSED' | 'UNREACHABLE' | 'RESET' | 'UNKNOWN';

  constructor(
    host: string,
    port: number,
    reason: PrinterConnectionError['reason'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PrinterConnectionError';
    this.host = host;
    this.port = port;
    this.reason = reason;
  }
}

export interface EscPosPrinterClientOptions {
  readonly host: string;
  readonly port?: number; // default 9100 per WP-015 spec
  readonly connectTimeoutMs?: number;
  readonly writeTimeoutMs?: number;
}

function classifyError(err: NodeJS.ErrnoException): PrinterConnectionError['reason'] {
  switch (err.code) {
    case 'ECONNREFUSED':
      return 'REFUSED';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
      return 'UNREACHABLE';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'RESET';
    default:
      return 'UNKNOWN';
  }
}

export class EscPosPrinterClient {
  readonly #host: string;
  readonly #port: number;
  readonly #connectTimeoutMs: number;
  readonly #writeTimeoutMs: number;

  constructor(options: EscPosPrinterClientOptions) {
    this.#host = options.host;
    this.#port = options.port ?? 9100;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.#writeTimeoutMs = options.writeTimeoutMs ?? 5000;
  }

  public getHost(): string {
    return this.#host;
  }

  public getPort(): number {
    return this.#port;
  }

  /**
   * Sends a raw ESC/POS byte buffer to the printer over a single TCP
   * connection. Resolves once the data has been flushed and the socket
   * closed cleanly; rejects with `PrinterConnectionError` on any recoverable
   * failure (offline, unreachable, disconnected mid-write, timeout).
   * Never throws synchronously; never leaves an open socket or dangling timer.
   */
  public printTicket(payload: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;
      let writeTimer: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        clearTimeout(connectTimer);
        if (writeTimer) clearTimeout(writeTimer);
        socket.removeAllListeners();
        socket.destroy();
      };

      const fail = (
        reason: PrinterConnectionError['reason'],
        message: string,
        cause?: unknown,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new PrinterConnectionError(this.#host, this.#port, reason, message, { cause }));
      };

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const connectTimer = setTimeout(() => {
        fail(
          'TIMEOUT',
          `Printer connection to ${this.#host}:${this.#port} timed out after ${this.#connectTimeoutMs}ms`,
        );
      }, this.#connectTimeoutMs);

      socket.once('error', (err: NodeJS.ErrnoException) => {
        fail(classifyError(err), `Printer socket error: ${err.message}`, err);
      });

      socket.connect(this.#port, this.#host, () => {
        if (connectTimer) clearTimeout(connectTimer);

        writeTimer = setTimeout(() => {
          fail(
            'TIMEOUT',
            `Printer write to ${this.#host}:${this.#port} timed out after ${this.#writeTimeoutMs}ms`,
          );
        }, this.#writeTimeoutMs);

        socket.write(payload, (writeErr) => {
          if (writeErr) {
            fail('UNKNOWN', `Printer write failed: ${writeErr.message}`, writeErr);
            return;
          }
          socket.end();
        });
      });

      socket.once('close', (hadError: boolean) => {
        if (!hadError) {
          succeed();
        }
        // If hadError, the 'error' listener above has already invoked fail().
      });
    });
  }
}
