/**
 * TRIDENTPOS Edge Local Auth HTTP Request Handler & Dispatcher
 * Conforms to ADR-005, IMPLEMENTATION_PLAN.md (POST /api/v1/auth/pin).
 *
 * Requirements:
 * - Handles POST /api/v1/auth/pin
 * - Handles POST /api/v1/auth/supervisor-unlock
 * - Enforces zero sensitive data in response bodies, error messages, and logs.
 * - Maps OfflineIamError to semantic HTTP status codes.
 */

import http from 'node:http';
import { OfflineIamService } from './offline-iam-service.js';
import { OfflineIamError, PinAuthRequest, SupervisorUnlockRequest } from './types.js';

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export class EdgeAuthRouter {
  readonly #iamService: OfflineIamService;

  constructor(iamService: OfflineIamService) {
    this.#iamService = iamService;
  }

  /**
   * Dispatches an in-memory or programmatic HTTP request.
   */
  public async handleRequest(
    method: string,
    urlPath: string,
    bodyJson: string,
  ): Promise<HttpResponse> {
    const normalizedMethod = method.toUpperCase();
    const cleanPath = urlPath.split('?')[0];

    if (normalizedMethod === 'POST' && cleanPath === '/api/v1/auth/pin') {
      return this.#handlePinAuth(bodyJson);
    }

    if (normalizedMethod === 'POST' && cleanPath === '/api/v1/auth/supervisor-unlock') {
      return this.#handleSupervisorUnlock(bodyJson);
    }

    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ROUTE_NOT_FOUND', message: 'Requested route not found' }),
    };
  }

  /**
   * Connects router directly to a Node.js http.Server request/response cycle.
   */
  public async handleNodeHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });

    req.on('end', async () => {
      const response = await this.handleRequest(req.method ?? 'GET', req.url ?? '/', body);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
  }

  async #handlePinAuth(bodyJson: string): Promise<HttpResponse> {
    let payload: unknown;
    try {
      payload = JSON.parse(bodyJson || '{}');
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'INVALID_JSON', message: 'Malformed JSON payload' }),
      };
    }

    const req = payload as PinAuthRequest;

    try {
      const result = await this.#iamService.authenticateWithPin(req);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    } catch (err) {
      return this.#mapErrorToResponse(err);
    }
  }

  async #handleSupervisorUnlock(bodyJson: string): Promise<HttpResponse> {
    let payload: unknown;
    try {
      payload = JSON.parse(bodyJson || '{}');
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'INVALID_JSON', message: 'Malformed JSON payload' }),
      };
    }

    const req = payload as SupervisorUnlockRequest;

    try {
      const result = await this.#iamService.supervisorUnlockStation(req);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    } catch (err) {
      return this.#mapErrorToResponse(err);
    }
  }

  #mapErrorToResponse(err: unknown): HttpResponse {
    if (err instanceof OfflineIamError) {
      let status = 500;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      switch (err.code) {
        case 'INVALID_INPUT':
        case 'INVALID_PIN_FORMAT':
          status = 400;
          break;
        case 'AUTHENTICATION_FAILED':
        case 'USER_NOT_CACHED':
        case 'USER_REVOKED':
        case 'CREDENTIAL_EXPIRED':
        case 'CREDENTIAL_CORRUPT':
        case 'CREDENTIAL_FUTURE_TIMESTAMP':
          status = 401;
          break;
        case 'STATION_NOT_FOUND':
        case 'STATION_REVOKED':
        case 'INSUFFICIENT_PERMISSIONS':
        case 'SESSION_STATION_MISMATCH':
          status = 403;
          break;
        case 'STATION_LOCKED':
          status = 423; // Locked
          if (err.retryAfterSeconds) {
            headers['Retry-After'] = String(err.retryAfterSeconds);
          }
          break;
        case 'CLOCK_ROLLBACK_LOCKED':
          status = 409; // Conflict (system temporal conflict)
          break;
        case 'SESSION_NOT_FOUND':
        case 'SESSION_EXPIRED':
        case 'SESSION_REVOKED':
          status = 401;
          break;
        default:
          status = 500;
      }

      return {
        status,
        headers,
        body: JSON.stringify({
          error: err.code,
          message: err.message,
          retryAfter: err.retryAfterSeconds ?? null,
        }),
      };
    }

    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'An internal authentication error occurred',
      }),
    };
  }
}
