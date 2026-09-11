/**
 * TRIDENTPOS Edge Enrollment HTTPS Server
 * Implements /api/v1/edge/enroll contract per SECURITY_ARCHITECTURE.md Sec. 3.2.
 */

import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import {
  EnrollmentAuditEvent,
  EnrollmentError,
  EnrollmentRequest,
  EnrollmentResponse,
  StationType,
} from './types.js';
import { EdgeTlsIdentityManager } from './tls-identity.js';
import { OneTimePairingStore } from './pairing-store.js';
import { redactSensitiveData } from './crypto.js';

export const MAX_ENROLLMENT_BODY_BYTES = 64 * 1024; // 64 KB maximum payload

export interface EdgeEnrollmentServerOptions {
  readonly branchId: string;
  readonly edgeId: string;
  readonly tlsManager: EdgeTlsIdentityManager;
  readonly pairingStore: OneTimePairingStore;
  readonly tokenTtlSeconds?: number;
  readonly onAuditEvent?: (event: EnrollmentAuditEvent) => void;
}

export class EdgeEnrollmentServer {
  readonly #branchId: string;
  readonly #edgeId: string;
  readonly #tlsManager: EdgeTlsIdentityManager;
  readonly #pairingStore: OneTimePairingStore;
  readonly #tokenTtlSeconds: number;
  readonly #onAuditEvent?: (event: EnrollmentAuditEvent) => void;
  #server: https.Server | null = null;
  #jwtSigningKey: Promise<KeyLike> | null = null;

  constructor(options: EdgeEnrollmentServerOptions) {
    this.#branchId = options.branchId;
    this.#edgeId = options.edgeId;
    this.#tlsManager = options.tlsManager;
    this.#pairingStore = options.pairingStore;
    this.#tokenTtlSeconds = options.tokenTtlSeconds ?? 30 * 24 * 3600; // 30 days default
    this.#onAuditEvent = options.onAuditEvent;
  }

  private async getSigningKey(): Promise<KeyLike> {
    if (!this.#jwtSigningKey) {
      this.#jwtSigningKey = importPKCS8(this.#tlsManager.keyPem, 'ES256');
    }
    return this.#jwtSigningKey;
  }

  public async start(port = 0, host = '127.0.0.1'): Promise<number> {
    const creds = this.#tlsManager.getTlsCredentials();

    return new Promise((resolve, reject) => {
      this.#server = https.createServer(
        {
          key: creds.key,
          cert: creds.cert,
        },
        (req, res) => {
          this.#handleRequest(req, res).catch((err) => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: (err as Error).message }),
              );
            }
          });
        },
      );

      this.#server.once('error', reject);
      this.#server.listen(port, host, () => {
        const addr = this.#server?.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          resolve(port);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.#server) {
        this.#server.close(() => {
          this.#server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public get port(): number | null {
    const addr = this.#server?.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return null;
  }

  async #handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/api/v1/edge/enroll') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'NOT_FOUND', message: `Cannot ${req.method} ${url.pathname}` }),
      );
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported' }));
      return;
    }

    // Read body safely with size enforcement
    let bodyBuffer = Buffer.alloc(0);
    let bytesRead = 0;

    for await (const chunk of req) {
      bytesRead += (chunk as Buffer).length;
      if (bytesRead > MAX_ENROLLMENT_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'PAYLOAD_OVERSIZED',
            message: `Request body exceeds maximum allowed size of ${MAX_ENROLLMENT_BODY_BYTES} bytes`,
          }),
        );
        return;
      }
      bodyBuffer = Buffer.concat([bodyBuffer, chunk as Buffer]);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyBuffer.toString('utf8'));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MALFORMED_REQUEST', message: 'Invalid JSON body' }));
      return;
    }

    // Strict schema validation
    const validationResult = this.#validateEnrollmentRequest(parsedBody);
    if (!validationResult.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MALFORMED_REQUEST', message: validationResult.error }));
      return;
    }

    const enrollReq = validationResult.request;
    const stationId = enrollReq.stationId ?? crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Issue Station Token signed with Edge TLS identity key
    let stationToken: string;
    try {
      const signingKey = await this.getSigningKey();
      stationToken = await new SignJWT({
        branchId: this.#branchId,
        stationCode: enrollReq.stationCode,
        stationType: enrollReq.stationType,
      })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuer(this.#edgeId)
        .setAudience('tridentpos-station')
        .setSubject(stationId)
        .setIssuedAt(now)
        .setExpirationTime(now + this.#tokenTtlSeconds)
        .sign(signingKey);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'STATION_TOKEN_SIGNING_FAILED',
          message: 'Failed to cryptographically sign station token',
        }),
      );
      return;
    }

    // Atomically consume pairing token and persist station credentials
    try {
      this.#pairingStore.consumePairingToken({
        pairingId: enrollReq.pairingId,
        pairingSecret: enrollReq.pairingSecret,
        branchId: this.#branchId,
        edgeId: this.#edgeId,
        stationId,
        stationCode: enrollReq.stationCode,
        stationType: enrollReq.stationType,
        stationPublicKey: enrollReq.stationPublicKey,
        stationToken,
      });
    } catch (err) {
      const enrollErr = err as EnrollmentError;
      const statusCode = this.#mapErrorCodeToStatus(enrollErr.code ?? 'UNKNOWN');

      this.#emitAuditEvent({
        event: 'TerminalEnrolada',
        branchId: this.#branchId,
        edgeId: this.#edgeId,
        stationId,
        stationCode: enrollReq.stationCode,
        stationType: enrollReq.stationType,
        pairingId: enrollReq.pairingId,
        outcome: 'FAILURE',
        failureReason: enrollErr.message,
        timestamp: now,
      });

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: enrollErr.code ?? 'ENROLLMENT_FAILED',
          message: enrollErr.message,
        }),
      );
      return;
    }

    // Emit sanitized audit event for successful terminal enrollment
    this.#emitAuditEvent({
      event: 'TerminalEnrolada',
      branchId: this.#branchId,
      edgeId: this.#edgeId,
      stationId,
      stationCode: enrollReq.stationCode,
      stationType: enrollReq.stationType,
      pairingId: enrollReq.pairingId,
      outcome: 'SUCCESS',
      timestamp: now,
    });

    const response: EnrollmentResponse = {
      status: 'ENROLLED',
      stationId,
      stationToken,
      edgePublicKeyFingerprint: this.#tlsManager.fingerprint,
      enrolledAt: now,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  #mapErrorCodeToStatus(code: string): number {
    switch (code) {
      case 'TOKEN_NOT_FOUND':
        return 404;
      case 'TOKEN_EXPIRED':
        return 400;
      case 'TOKEN_ALREADY_CONSUMED':
      case 'CONCURRENT_CONSUMPTION_CONFLICT':
        return 409;
      case 'INVALID_SECRET':
        return 401;
      case 'CONTEXT_MISMATCH':
        return 403;
      default:
        return 400;
    }
  }

  #emitAuditEvent(event: EnrollmentAuditEvent): void {
    if (this.#onAuditEvent) {
      try {
        this.#onAuditEvent(redactSensitiveData(event));
      } catch {
        // Audit callback failures must not break security boundaries
      }
    }
  }

  #validateEnrollmentRequest(
    body: unknown,
  ): { valid: true; request: EnrollmentRequest } | { valid: false; error: string } {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { valid: false, error: 'Request body must be a JSON object' };
    }

    const b = body as Record<string, unknown>;

    // Check for prohibited unexpected fields or prototype pollution
    const allowedKeys = new Set([
      'pairingId',
      'pairingSecret',
      'stationPublicKey',
      'stationCode',
      'stationType',
      'stationId',
    ]);

    for (const key of Object.keys(b)) {
      if (!allowedKeys.has(key)) {
        return { valid: false, error: `Unrecognized request property '${key}'` };
      }
    }

    if (typeof b.pairingId !== 'string' || b.pairingId.trim().length === 0) {
      return { valid: false, error: 'Missing or empty pairingId' };
    }

    if (typeof b.pairingSecret !== 'string' || b.pairingSecret.trim().length < 32) {
      return {
        valid: false,
        error: 'Missing or insufficient pairingSecret (must be at least 256 bits)',
      };
    }

    if (typeof b.stationPublicKey !== 'string' || b.stationPublicKey.trim().length === 0) {
      return { valid: false, error: 'Missing or empty stationPublicKey' };
    }

    if (typeof b.stationCode !== 'string' || b.stationCode.trim().length === 0) {
      return { valid: false, error: 'Missing or empty stationCode' };
    }

    const validTypes: StationType[] = ['POS', 'KDS', 'COMANDERO', 'DISPLAY'];
    if (typeof b.stationType !== 'string' || !validTypes.includes(b.stationType as StationType)) {
      return {
        valid: false,
        error: `Invalid stationType. Expected one of [${validTypes.join(', ')}], received '${b.stationType}'`,
      };
    }

    if (
      b.stationId !== undefined &&
      (typeof b.stationId !== 'string' || b.stationId.trim().length === 0)
    ) {
      return { valid: false, error: 'stationId, if provided, must be a non-empty string' };
    }

    return {
      valid: true,
      request: {
        pairingId: b.pairingId.trim(),
        pairingSecret: b.pairingSecret.trim(),
        stationPublicKey: b.stationPublicKey.trim(),
        stationCode: b.stationCode.trim(),
        stationType: b.stationType as StationType,
        stationId: b.stationId ? (b.stationId as string).trim() : undefined,
      },
    };
  }
}
