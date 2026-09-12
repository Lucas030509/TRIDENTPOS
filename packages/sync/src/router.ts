/**
 * TRIDENTPOS Sync Leases HTTP Router & Dispatcher
 * Implements:
 * - POST /api/v1/sync/leases/request
 * - POST /api/v1/sync/leases/heartbeat
 * Conforms strictly to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3
 * - ADR-002, ADR-008
 * - COORDINATOR_PROMPT_WP011_START.md & COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md
 */

import http from 'node:http';
import {
  ERROR_CODE_INVALID_BLOCK_SIZE,
  ERROR_CODE_INVALID_FOLIO_TYPE,
  ERROR_CODE_LEASE_REVOKED,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  MAX_BLOCK_SIZE,
  MIN_BLOCK_SIZE,
  isValidFolioType,
} from '@trident/core';
import {
  AuthContext,
  FolioHeartbeatRequestDTO,
  FolioLeaseRequestDTO,
  HttpResponse,
  ICloudLeaseService,
} from './types.js';

export class SyncLeaseRouter {
  readonly #leaseService: ICloudLeaseService;

  constructor(leaseService: ICloudLeaseService) {
    this.#leaseService = leaseService;
  }

  /**
   * Programmatic dispatch for in-memory, RPC, and unit tests.
   */
  public async handleRequest(
    method: string,
    urlPath: string,
    bodyJson: string,
    authContext?: AuthContext,
  ): Promise<HttpResponse> {
    const normalizedMethod = method.toUpperCase();
    const cleanPath = urlPath.split('?')[0];

    if (normalizedMethod === 'POST' && cleanPath === '/api/v1/sync/leases/request') {
      return this.#handleLeaseRequest(bodyJson, authContext);
    }

    if (normalizedMethod === 'POST' && cleanPath === '/api/v1/sync/leases/heartbeat') {
      return this.#handleHeartbeat(bodyJson, authContext);
    }

    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ROUTE_NOT_FOUND', message: 'Requested sync route not found' }),
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
      // Derive auth context from trusted authenticated session/headers
      const orgId = req.headers['x-organization-id'] as string | undefined;
      const branchId = req.headers['x-branch-id'] as string | undefined;

      const authContext: AuthContext | undefined =
        orgId && branchId ? { organizationId: orgId, branchId } : undefined;

      const response = await this.handleRequest(
        req.method ?? 'GET',
        req.url ?? '/',
        body,
        authContext,
      );

      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
  }

  async #handleLeaseRequest(bodyJson: string, auth?: AuthContext): Promise<HttpResponse> {
    if (!auth || !auth.organizationId || !auth.branchId) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_UNAUTHORIZED_TENANT,
          message: 'Missing or unauthenticated tenant/branch authority context.',
        }),
      };
    }

    let payload: Partial<FolioLeaseRequestDTO>;
    try {
      payload = JSON.parse(bodyJson || '{}');
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'INVALID_JSON_PAYLOAD', message: 'Malformed JSON payload' }),
      };
    }

    // 1. Validate Folio Type
    if (!payload.folioType || !isValidFolioType(payload.folioType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_INVALID_FOLIO_TYPE,
          message: `Invalid or missing folioType. Allowed: TICKET, CORTE_X, CORTE_Z, FACTURA`,
        }),
      };
    }

    // 2. Validate Block Size (Governed Policy 1: No clamping)
    if (payload.requestedBlockSize !== undefined) {
      if (
        typeof payload.requestedBlockSize !== 'number' ||
        !Number.isInteger(payload.requestedBlockSize) ||
        payload.requestedBlockSize < MIN_BLOCK_SIZE ||
        payload.requestedBlockSize > MAX_BLOCK_SIZE
      ) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_BLOCK_SIZE,
            message: `Invalid requestedBlockSize. Must be an integer between ${MIN_BLOCK_SIZE} and ${MAX_BLOCK_SIZE}. Clamping is strictly prohibited.`,
          }),
        };
      }
    }

    try {
      const lease = await this.#leaseService.allocateLease({
        organizationId: auth.organizationId,
        branchId: auth.branchId,
        folioType: payload.folioType,
        requestedBlockSize: payload.requestedBlockSize,
        isDisasterRecoveryReplacement: payload.isDisasterRecoveryBootstrap,
      });

      return {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lease: {
            id: lease.id,
            organizationId: lease.organizationId,
            branchId: lease.branchId,
            folioType: lease.folioType,
            epochId: lease.epochId,
            fencingToken: lease.fencingToken,
            rangeStart: lease.rangeStart,
            rangeEnd: lease.rangeEnd,
            highWaterMark: lease.highWaterMark,
            status: lease.status,
            allocatedAt: lease.allocatedAt.toISOString(),
          },
        }),
      };
    } catch (err: unknown) {
      const error = err as { code?: string; httpStatus?: number; message?: string };
      const status = error.httpStatus ?? 500;
      return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.code ?? 'ALLOCATION_FAILED',
          message: error.message ?? 'Lease allocation failed',
        }),
      };
    }
  }

  async #handleHeartbeat(bodyJson: string, auth?: AuthContext): Promise<HttpResponse> {
    if (!auth || !auth.organizationId || !auth.branchId) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_UNAUTHORIZED_TENANT,
          message: 'Missing or unauthenticated tenant/branch authority context.',
        }),
      };
    }

    let payload: Partial<FolioHeartbeatRequestDTO>;
    try {
      payload = JSON.parse(bodyJson || '{}');
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'INVALID_JSON_PAYLOAD', message: 'Malformed JSON payload' }),
      };
    }

    if (
      !payload.leaseId ||
      !payload.folioType ||
      !isValidFolioType(payload.folioType) ||
      !payload.epochId ||
      !payload.fencingToken ||
      typeof payload.currentFolio !== 'number'
    ) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_HEARTBEAT_PAYLOAD',
          message: 'Missing or invalid fields in heartbeat payload',
        }),
      };
    }

    try {
      const ack = await this.#leaseService.heartbeat({
        organizationId: auth.organizationId,
        branchId: auth.branchId,
        leaseId: payload.leaseId,
        folioType: payload.folioType,
        epochId: payload.epochId,
        fencingToken: payload.fencingToken,
        currentFolio: payload.currentFolio,
      });

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ack),
      };
    } catch (err: unknown) {
      const error = err as {
        code?: string;
        httpStatus?: number;
        message?: string;
        activeEpoch?: string;
      };
      const status = error.httpStatus ?? 500;

      // Special handling for LEASE_REVOKED (HTTP 403) per canonical spec
      if (error.code === ERROR_CODE_LEASE_REVOKED) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_LEASE_REVOKED,
            message: error.message ?? 'Lease revoked. Station fenced.',
            activeEpoch: error.activeEpoch,
          }),
        };
      }

      return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.code ?? 'HEARTBEAT_FAILED',
          message: error.message ?? 'Heartbeat failed',
        }),
      };
    }
  }
}
