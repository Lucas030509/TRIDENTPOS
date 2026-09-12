/**
 * TRIDENTPOS Edge Enrollment HTTPS Server
 * Serves /api/v1/edge/enroll and coordinates station trust bootstrap.
 * Conforms to SECURITY_ARCHITECTURE.md Sec. 3.2 and ACR-2026-011.
 */

import https from 'node:https';
import http from 'node:http';
import { EdgeTlsIdentityManager } from './tls-identity.js';
import { EdgePairingStore } from './pairing-store.js';
import {
  ClockRollbackLockError,
  EnrollmentAlreadyConsumedError,
  EnrollmentContextMismatchError,
  EnrollmentExpiredError,
  EnrollmentSecurityError,
  StationEnrollmentRequest,
} from './types.js';

export interface EdgeEnrollmentServerOptions {
  readonly tlsIdentity: EdgeTlsIdentityManager;
  readonly pairingStore: EdgePairingStore;
  readonly port?: number;
  readonly host?: string;
}

export class EdgeEnrollmentServer {
  readonly #tlsIdentity: EdgeTlsIdentityManager;
  readonly #pairingStore: EdgePairingStore;
  readonly #port: number;
  readonly #host: string;

  #server: https.Server | null = null;
  #listeningPort = 0;
  #simulateHttpResponseFailurePostCommit = false;

  constructor(options: EdgeEnrollmentServerOptions) {
    this.#tlsIdentity = options.tlsIdentity;
    this.#pairingStore = options.pairingStore;
    this.#port = options.port ?? 0; // 0 for ephemeral in tests
    this.#host = options.host ?? '127.0.0.1';
  }

  /**
   * Test-only fault injection to test HTTP delivery failure post-commit semantics.
   */
  public setSimulateHttpResponseFailurePostCommit(fail: boolean): void {
    this.#simulateHttpResponseFailurePostCommit = fail;
  }

  public async start(): Promise<number> {
    const creds = this.#tlsIdentity.getTlsServerCredentials();

    this.#server = https.createServer(creds, (req, res) => {
      this.#handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.#server!.listen(this.#port, this.#host, () => {
        const addr = this.#server!.address();
        if (typeof addr === 'object' && addr !== null) {
          this.#listeningPort = addr.port;
          resolve(this.#listeningPort);
        } else {
          reject(new Error('Failed to resolve server listening port'));
        }
      });

      this.#server!.on('error', (err) => {
        reject(err);
      });
    });
  }

  public getPort(): number {
    return this.#listeningPort;
  }

  public async stop(): Promise<void> {
    if (!this.#server) return;

    return new Promise((resolve) => {
      this.#server!.close(() => {
        this.#server = null;
        resolve();
      });
    });
  }

  #sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  #handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url?.split('?')[0];

    if (req.method === 'POST' && url === '/api/v1/edge/enroll') {
      const chunks: Buffer[] = [];
      let totalLength = 0;

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > 64 * 1024) {
          req.destroy(new Error('Payload too large'));
        } else {
          chunks.push(chunk);
        }
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(raw) as Partial<StationEnrollmentRequest>;

          // Validate required fields
          if (
            !payload.pairingId ||
            !payload.pairingSecret ||
            !payload.stationPublicKey ||
            !payload.stationId ||
            !payload.stationCode ||
            !payload.stationType ||
            !payload.organizationId ||
            !payload.branchId ||
            !payload.edgeId
          ) {
            this.#sendJson(res, 400, {
              error: 'InvalidEnrollmentPayload',
              message: 'Missing required station enrollment fields',
            });
            return;
          }

          const request: StationEnrollmentRequest = {
            pairingId: payload.pairingId,
            pairingSecret: payload.pairingSecret,
            stationPublicKey: payload.stationPublicKey,
            stationId: payload.stationId,
            stationCode: payload.stationCode,
            stationType: payload.stationType,
            organizationId: payload.organizationId,
            branchId: payload.branchId,
            edgeId: payload.edgeId,
          };

          // Coordinate enrollment with pairing store
          const response = this.#pairingStore.enrollStation(request);

          // Fault injection: simulate network disconnect right after DB transaction commit
          if (this.#simulateHttpResponseFailurePostCommit) {
            res.socket?.destroy();
            return;
          }

          this.#sendJson(res, 200, response);
        } catch (err) {
          if (err instanceof EnrollmentContextMismatchError) {
            this.#sendJson(res, 403, {
              error: 'EnrollmentContextMismatch',
              message: err.message,
            });
          } else if (err instanceof EnrollmentExpiredError) {
            this.#sendJson(res, 410, {
              error: 'EnrollmentExpired',
              message: err.message,
            });
          } else if (err instanceof EnrollmentAlreadyConsumedError) {
            this.#sendJson(res, 409, {
              error: 'EnrollmentAlreadyConsumed',
              message: err.message,
            });
          } else if (err instanceof ClockRollbackLockError) {
            this.#sendJson(res, 423, {
              error: 'ClockRollbackLocked',
              message: err.message,
            });
          } else if (err instanceof EnrollmentSecurityError) {
            this.#sendJson(res, 401, {
              error: 'EnrollmentSecurityFailed',
              message: err.message,
            });
          } else {
            this.#sendJson(res, 500, {
              error: 'InternalServerError',
              message: (err as Error).message,
            });
          }
        }
      });

      return;
    }

    this.#sendJson(res, 404, { error: 'NotFound' });
  }
}
