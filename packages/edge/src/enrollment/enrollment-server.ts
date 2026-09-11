/**
 * TRIDENTPOS Edge Enrollment HTTPS Server
 * Implements /api/v1/edge/enroll contract per SECURITY_ARCHITECTURE.md Sec. 3.2
 * and IAM_SECURITY_MODEL.md Sec. 4 & 5 (Local Station Token HMAC-SHA256, 12 hours).
 */

import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  EnrollmentAuditEvent,
  EnrollmentError,
  EnrollmentRequest,
  EnrollmentResponse,
  StationType,
} from './types.js';
import { EdgeTlsIdentityManager } from './tls-identity.js';
import { OneTimePairingStore } from './pairing-store.js';
import { redactSensitiveData, timingSafeSecretCompare } from './crypto.js';

export const MAX_ENROLLMENT_BODY_BYTES = 64 * 1024; // 64 KB maximum payload
export const STATION_TOKEN_TTL_SECONDS = 12 * 3600; // Exactly 12 hours per IAM_SECURITY_MODEL.md Sec. 4

export interface EdgeEnrollmentServerOptions {
  readonly branchId: string;
  readonly edgeId: string;
  readonly tlsManager: EdgeTlsIdentityManager;
  readonly pairingStore: OneTimePairingStore;
  readonly localStationSigningKey?: string | Buffer;
  readonly tokenTtlSeconds?: number;
  readonly onAuditEvent?: (event: EnrollmentAuditEvent) => void;
}

export interface VerifiedStationToken {
  readonly stationId: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly branchId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export class EdgeEnrollmentServer {
  readonly #branchId: string;
  readonly #edgeId: string;
  readonly #tlsManager: EdgeTlsIdentityManager;
  readonly #pairingStore: OneTimePairingStore;
  readonly #localStationSigningKey: Buffer;
  readonly #tokenTtlSeconds: number;
  readonly #onAuditEvent?: (event: EnrollmentAuditEvent) => void;
  #server: https.Server | null = null;

  constructor(options: EdgeEnrollmentServerOptions) {
    this.#branchId = options.branchId;
    this.#edgeId = options.edgeId;
    this.#tlsManager = options.tlsManager;
    this.#pairingStore = options.pairingStore;
    this.#tokenTtlSeconds = options.tokenTtlSeconds ?? STATION_TOKEN_TTL_SECONDS;
    this.#onAuditEvent = options.onAuditEvent;

    // Dedicated local Station Token signing key per IAM_SECURITY_MODEL.md
    // Completely distinct from Edge TLS identity private key
    if (options.localStationSigningKey) {
      this.#localStationSigningKey = Buffer.isBuffer(options.localStationSigningKey)
        ? options.localStationSigningKey
        : Buffer.from(options.localStationSigningKey, 'utf8');
    } else {
      this.#localStationSigningKey = crypto.randomBytes(32); // 256-bit CSPRNG key
    }
  }

  public async start(port = 0, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve, reject) => {
      // Create HTTPS server without exposing private key outside tlsManager
      this.#server = this.#tlsManager.createHttpsServer((req, res) => {
        this.#handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: (err as Error).message }),
            );
          }
        });
      });

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

  /**
   * Signs a Local Station Token using HMAC-SHA256 (Llave Local) per IAM_SECURITY_MODEL.md Sec. 4.
   */
  #signStationToken(stationId: string, stationCode: string, stationType: StationType): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.#tokenTtlSeconds;

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.#edgeId,
        aud: 'tridentpos-station',
        sub: stationId,
        branchId: this.#branchId,
        stationCode,
        stationType,
        iat: now,
        exp,
      }),
    ).toString('base64url');

    const signature = crypto
      .createHmac('sha256', this.#localStationSigningKey)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /**
   * Verifies an incoming Station Token against the dedicated local HMAC key.
   */
  public verifyStationToken(token: string): VerifiedStationToken {
    return EdgeEnrollmentServer.verifyStationTokenWithKey(
      token,
      this.#localStationSigningKey,
      this.#edgeId,
    );
  }

  /**
   * Static verification helper for Station Tokens.
   */
  public static verifyStationTokenWithKey(
    token: string,
    key: Buffer | string,
    expectedIssuer?: string,
  ): VerifiedStationToken {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new EnrollmentError('MALFORMED_REQUEST', 'Invalid station token format');
    }

    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf8');
    const expectedSig = crypto
      .createHmac('sha256', keyBuf)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (!timingSafeSecretCompare(sigB64, expectedSig)) {
      throw new EnrollmentError('INVALID_SECRET', 'Invalid station token signature');
    }

    let header: { alg?: string; typ?: string };
    let payload: {
      iss?: string;
      aud?: string;
      sub?: string;
      branchId?: string;
      stationCode?: string;
      stationType?: StationType;
      iat?: number;
      exp?: number;
    };

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new EnrollmentError('MALFORMED_REQUEST', 'Malformed station token JSON payload');
    }

    if (header.alg !== 'HS256') {
      throw new EnrollmentError(
        'INVALID_SECRET',
        `Unapproved token algorithm '${header.alg}'. Expected HS256.`,
      );
    }

    if (expectedIssuer && payload.iss !== expectedIssuer) {
      throw new EnrollmentError('CONTEXT_MISMATCH', `Token issuer mismatch: ${payload.iss}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= payload.exp) {
      throw new EnrollmentError('TOKEN_EXPIRED', 'Station token has expired');
    }

    if (!payload.sub || !payload.stationCode || !payload.stationType || !payload.branchId) {
      throw new EnrollmentError('MALFORMED_REQUEST', 'Station token missing mandatory claims');
    }

    return {
      stationId: payload.sub,
      stationCode: payload.stationCode,
      stationType: payload.stationType,
      branchId: payload.branchId,
      issuedAt: payload.iat ?? now,
      expiresAt: payload.exp,
    };
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
    } catch {
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

    // Issue Station Token using HMAC-SHA256 (Llave Local) per IAM_SECURITY_MODEL.md
    let stationToken: string;
    try {
      stationToken = this.#signStationToken(
        stationId,
        enrollReq.stationCode,
        enrollReq.stationType,
      );
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

    // Pre-flight audit event: If mandatory audit logging fails, MUST FAIL CLOSED (R1-E)
    try {
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
    } catch (auditErr) {
      // FAIL CLOSED: If audit recording fails, do NOT commit token consumption
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'AUDIT_LOGGING_FAILED',
          message: `Mandatory audit recording failed: ${(auditErr as Error).message}`,
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

      try {
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
      } catch {
        // Failure audit best-effort
      }

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: enrollErr.code ?? 'ENROLLMENT_FAILED',
          message: enrollErr.message,
        }),
      );
      return;
    }

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
      // Do not swallow errors: propagate to caller to guarantee fail-closed behavior
      this.#onAuditEvent(redactSensitiveData(event));
    }
  }

  #validateEnrollmentRequest(
    body: unknown,
  ): { valid: true; request: EnrollmentRequest } | { valid: false; error: string } {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { valid: false, error: 'Request body must be a JSON object' };
    }

    const b = body as Record<string, unknown>;

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
