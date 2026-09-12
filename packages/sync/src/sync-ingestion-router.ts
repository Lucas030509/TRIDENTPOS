/**
 * TRIDENTPOS Sync Ingestion HTTP Router & Dispatcher (ADR-006)
 * Implements:
 * - POST /api/v1/sync/batches
 * Conforms strictly to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - ADR-006 (Ingested Idempotency, Pattern B Authentication, Malformed Request Fails Closed)
 * - COORDINATOR_PROMPT_WP012_START.md
 */

import http from 'node:http';
import {
  AuthContext,
  ERROR_CODE_INVALID_REQUEST,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  isValidUuidV4,
  SyncBatchDTO,
  SyncEventDTO,
} from '@trident/core';
import { HttpResponse, ISyncBatchProcessor } from './types.js';

export class SyncIngestionRouter {
  readonly #batchProcessor: ISyncBatchProcessor;

  constructor(batchProcessor: ISyncBatchProcessor) {
    this.#batchProcessor = batchProcessor;
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

    if (normalizedMethod === 'POST' && cleanPath === '/api/v1/sync/batches') {
      return this.#handleSyncBatches(bodyJson, authContext);
    }

    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'ROUTE_NOT_FOUND',
        message: `Requested sync ingestion route '${cleanPath}' not found`,
      }),
    };
  }

  /**
   * Connects router directly to a Node.js http.Server request/response cycle.
   * Pattern B: Verified AuthContext can ONLY be supplied by an upstream trusted boundary.
   * Client-supplied request headers (e.g. x-organization-id, x-branch-id) are PROHIBITED
   * from establishing authenticated authority.
   */
  public async handleNodeHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    verifiedAuth?: AuthContext,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });

      req.on('end', async () => {
        try {
          const response = await this.handleRequest(
            req.method ?? 'GET',
            req.url ?? '/',
            body,
            verifiedAuth,
          );

          res.writeHead(response.status, response.headers);
          res.end(response.body);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  async #handleSyncBatches(bodyJson: string, authContext?: AuthContext): Promise<HttpResponse> {
    // 1. Authoritative AuthContext enforcement (Pattern B)
    if (!authContext) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_UNAUTHORIZED_TENANT,
          message: 'Missing or unverified authentication context',
        }),
      };
    }

    // 2. Parse request payload
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(bodyJson);
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_INVALID_REQUEST,
          message: 'Request body must be valid JSON',
        }),
      };
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_INVALID_REQUEST,
          message: 'Request body must be a JSON object',
        }),
      };
    }

    const batch = rawBody as Partial<SyncBatchDTO>;

    // 3. Validate Batch DTO structure (Fail Closed before any mutation)
    if (!batch.batchId || typeof batch.batchId !== 'string' || !isValidUuidV4(batch.batchId)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_INVALID_REQUEST,
          message: 'batchId must be a valid UUIDv4',
        }),
      };
    }

    // Authority mismatch check
    if (batch.organizationId && batch.organizationId !== authContext.organizationId) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_UNAUTHORIZED_TENANT,
          message: 'Payload organizationId does not match verified authority',
        }),
      };
    }

    if (batch.branchId && batch.branchId !== authContext.branchId) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
          message: 'Payload branchId does not match verified authority',
        }),
      };
    }

    if (!Array.isArray(batch.events) || batch.events.length === 0) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: ERROR_CODE_INVALID_REQUEST,
          message: 'events must be a non-empty array of SyncEventDTO',
        }),
      };
    }

    // Validate each event in the batch
    for (const [index, ev] of batch.events.entries()) {
      if (!ev || typeof ev !== 'object') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} must be an object`,
          }),
        };
      }

      if (!ev.aggregateType || typeof ev.aggregateType !== 'string') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} missing required aggregateType`,
          }),
        };
      }

      if (!ev.aggregateId || typeof ev.aggregateId !== 'string') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} missing required aggregateId`,
          }),
        };
      }

      if (!ev.action || typeof ev.action !== 'string') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} missing required action`,
          }),
        };
      }

      if (!ev.clientOpId || typeof ev.clientOpId !== 'string' || !isValidUuidV4(ev.clientOpId)) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} clientOpId must be a valid UUIDv4`,
          }),
        };
      }

      if (
        typeof ev.aggregateSequenceNumber !== 'number' ||
        !Number.isInteger(ev.aggregateSequenceNumber) ||
        ev.aggregateSequenceNumber < 1
      ) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_INVALID_REQUEST,
            message: `Event at index ${index} aggregateSequenceNumber must be a positive integer >= 1`,
          }),
        };
      }

      // Check tenant/branch per event
      if (ev.organizationId && ev.organizationId !== authContext.organizationId) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_UNAUTHORIZED_TENANT,
            message: `Event at index ${index} organizationId does not match verified authority`,
          }),
        };
      }

      if (ev.branchId && ev.branchId !== authContext.branchId) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
            message: `Event at index ${index} branchId does not match verified authority`,
          }),
        };
      }
    }

    // 4. Construct normalized batch with verified authority
    const normalizedBatch: SyncBatchDTO = {
      batchId: batch.batchId,
      organizationId: authContext.organizationId,
      branchId: authContext.branchId,
      events: batch.events.map((ev: SyncEventDTO) => ({
        ...ev,
        organizationId: authContext.organizationId,
        branchId: authContext.branchId,
      })),
      createdAt: batch.createdAt ?? new Date().toISOString(),
    };

    // 5. Dispatch to batch processor
    try {
      const ack = await this.#batchProcessor.processBatch(authContext, normalizedBatch);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ack),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal sync processing error';
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INTERNAL_SYNC_ERROR',
          message,
        }),
      };
    }
  }
}
