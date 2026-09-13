/**
 * TRIDENTPOS Cloud WebSocket Synchronization Gateway (WP-013)
 * Implements: WSS /api/v1/sync/stream
 * Conforms to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 4 & 5
 * - ADR-005, ADR-006, EAAF v1.2.0 WP-013
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  AuthContext,
  CatalogDeltaRequest,
  CatalogDeltaResponse,
  ERROR_CODE_CONTROL_PLANE_FORBIDDEN,
  ERROR_CODE_MALFORMED_STREAM_MESSAGE,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_SYNC_KILL_SWITCH_ENGAGED,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  JwtVerifierConfig,
  SyncBatchAckDTO,
  SyncBatchDTO,
  SyncEngineKillSwitch,
  SyncStreamMessage,
  createSyncStreamMessage,
  isValidSyncStreamMessage,
  isValidUuid,
  verifyAccessToken,
} from '@trident/core';
import type {
  IDownstreamDeltaProvider,
  ISyncBatchProcessor,
  IWebSocketAuthenticator,
} from './types.js';

export { IWebSocketAuthenticator };

export class JwtWebSocketAuthenticator implements IWebSocketAuthenticator {
  readonly #config: JwtVerifierConfig;

  constructor(config: JwtVerifierConfig) {
    this.#config = config;
  }

  public async authenticate(req: http.IncomingMessage): Promise<AuthContext | null> {
    const authHeader = req.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      return null;
    }
    const token = match[1];
    const result = await verifyAccessToken(token, this.#config);
    if (!result.ok) {
      return null;
    }
    const claims = result.value.rawClaims;
    const organizationId = (claims.organizationId ?? claims.org_id) as string | undefined;
    const branchId = (claims.branchId ?? claims.branch_id) as string | undefined;
    if (!organizationId || !branchId || !isValidUuid(organizationId) || !isValidUuid(branchId)) {
      return null;
    }
    // R2-02: Strict control-plane claim validation. Literal boolean true ONLY.
    const rawControlPlane =
      claims.isControlPlane !== undefined ? claims.isControlPlane : claims.is_control_plane;
    const isControlPlane = rawControlPlane === true;

    // Strict role/permission array typing: only non-empty strings allowed
    const roles = Array.isArray(claims.roles)
      ? claims.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      : [];
    const permissions = Array.isArray(claims.permissions)
      ? claims.permissions.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];

    return {
      organizationId,
      branchId,
      isControlPlane,
      roles,
      permissions,
    };
  }
}

export class CallbackWebSocketAuthenticator implements IWebSocketAuthenticator {
  readonly #handler: (
    req: http.IncomingMessage,
  ) => Promise<AuthContext | null> | AuthContext | null;

  constructor(
    handler: (req: http.IncomingMessage) => Promise<AuthContext | null> | AuthContext | null,
  ) {
    this.#handler = handler;
  }

  public authenticate(req: http.IncomingMessage): Promise<AuthContext | null> | AuthContext | null {
    return this.#handler(req);
  }
}

export interface CloudSyncGatewayOptions {
  readonly server?: http.Server;
  readonly port?: number;
  readonly path?: string;
  readonly batchProcessor: ISyncBatchProcessor;
  readonly deltaProvider?: IDownstreamDeltaProvider;
  readonly authenticator: IWebSocketAuthenticator;
}

interface AuthenticatedIncomingMessage extends http.IncomingMessage {
  __authContext?: AuthContext;
}

export class CloudWebSocketSyncGateway {
  readonly #wss: WebSocketServer;
  readonly #batchProcessor: ISyncBatchProcessor;
  readonly #deltaProvider?: IDownstreamDeltaProvider;
  readonly #authenticator: IWebSocketAuthenticator;
  readonly #clients = new Map<WebSocket, AuthContext>();
  #killSwitch: SyncEngineKillSwitch = {
    enabled: true, // true = sync active
    updatedAt: new Date().toISOString(),
  };

  constructor(options: CloudSyncGatewayOptions) {
    // Fail closed immediately if authenticator is missing
    if (!options.authenticator || typeof options.authenticator.authenticate !== 'function') {
      throw new Error(
        'GATEWAY_INITIALIZATION_ERROR: Missing required authenticator. CloudWebSocketSyncGateway must fail closed without trusted authentication boundary.',
      );
    }

    this.#batchProcessor = options.batchProcessor;
    this.#deltaProvider = options.deltaProvider;
    this.#authenticator = options.authenticator;

    const path = options.path ?? '/api/v1/sync/stream';

    const verifyClient = (
      info: { origin: string; secure: boolean; req: http.IncomingMessage },
      callback: (res: boolean, code?: number, message?: string) => void,
    ) => {
      const url = info.req.url?.split('?')[0];
      if (url !== path) {
        callback(false, 404, 'Not Found');
        return;
      }

      Promise.resolve(this.#authenticator.authenticate(info.req))
        .then((auth) => {
          if (!auth) {
            callback(false, 401, 'Unauthorized');
            return;
          }
          (info.req as AuthenticatedIncomingMessage).__authContext = auth;
          callback(true);
        })
        .catch(() => {
          callback(false, 401, 'Unauthorized');
        });
    };

    if (options.server) {
      this.#wss = new WebSocketServer({
        server: options.server,
        path,
        verifyClient,
      });
    } else {
      this.#wss = new WebSocketServer({
        port: options.port ?? 0,
        path,
        verifyClient,
      });
    }

    this.#wss.on('connection', (ws, req) => {
      const auth = (req as AuthenticatedIncomingMessage).__authContext;
      if (!auth) {
        ws.terminate();
        return;
      }
      this.#clients.set(ws, auth);
      this.#handleConnection(ws, auth);
    });
  }

  public getPort(): number {
    const addr = this.#wss.address();
    if (typeof addr === 'object' && addr !== null) {
      return addr.port;
    }
    return 0;
  }

  public getKillSwitch(): SyncEngineKillSwitch {
    return this.#killSwitch;
  }

  /**
   * Sets kill switch state and notifies all connected clients.
   * Privileged server-side control plane API.
   */
  public setKillSwitch(enabled: boolean, reason?: string, updatedBy?: string): void {
    this.#killSwitch = {
      enabled,
      reason: reason ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy ?? null,
    };

    const broadcastMsg = createSyncStreamMessage(
      'KILL_SWITCH_COMMAND',
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      this.#killSwitch,
    );

    const payloadStr = JSON.stringify(broadcastMsg);
    for (const client of this.#wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payloadStr);
      }
    }
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      for (const client of this.#wss.clients) {
        client.terminate();
      }
      this.#wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  #handleConnection(ws: WebSocket, auth: AuthContext): void {
    ws.on('message', async (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_MALFORMED_STREAM_MESSAGE,
            'Invalid JSON format',
          );
          return;
        }

        if (!isValidSyncStreamMessage(parsed)) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_MALFORMED_STREAM_MESSAGE,
            'Message does not conform to SyncStreamMessage',
          );
          return;
        }

        const msg = parsed as SyncStreamMessage;

        // Fencing check: incoming payload cannot override authenticated tenant authority
        if (msg.organizationId !== auth.organizationId) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_UNAUTHORIZED_TENANT,
            'Message organizationId does not match verified session authority',
          );
          return;
        }
        if (msg.branchId !== auth.branchId) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
            'Message branchId does not match verified session authority',
          );
          return;
        }

        await this.#routeMessage(ws, auth, msg);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown gateway routing error';
        this.#sendError(ws, auth.organizationId, auth.branchId, 'GATEWAY_INTERNAL_ERROR', errMsg);
      }
    });

    ws.on('close', () => {
      this.#clients.delete(ws);
    });
  }

  async #routeMessage(ws: WebSocket, auth: AuthContext, msg: SyncStreamMessage): Promise<void> {
    switch (msg.type) {
      case 'HEARTBEAT_PING': {
        const pong = createSyncStreamMessage(
          'HEARTBEAT_PONG',
          auth.organizationId,
          auth.branchId,
          { serverTime: new Date().toISOString() },
          msg.messageId,
        );
        ws.send(JSON.stringify(pong));
        break;
      }

      case 'UPSTREAM_BATCH': {
        if (!this.#killSwitch.enabled) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_SYNC_KILL_SWITCH_ENGAGED,
            'Sync engine kill switch is currently engaged',
          );
          return;
        }

        const batch = msg.payload as SyncBatchDTO;

        // Enforce that batch payload matches verified server session authority
        if (batch.organizationId !== auth.organizationId) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_UNAUTHORIZED_TENANT,
            'Batch organizationId does not match verified session authority',
          );
          return;
        }
        if (batch.branchId !== auth.branchId) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
            'Batch branchId does not match verified session authority',
          );
          return;
        }

        const ack = await this.#batchProcessor.processBatch(auth, batch);
        const responseMsg = createSyncStreamMessage<SyncBatchAckDTO>(
          'UPSTREAM_ACK',
          auth.organizationId,
          auth.branchId,
          ack,
          msg.messageId,
        );
        ws.send(JSON.stringify(responseMsg));
        break;
      }

      case 'DOWNSTREAM_DELTA_REQUEST': {
        if (!this.#deltaProvider) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            'DELTA_PROVIDER_NOT_AVAILABLE',
            'No downstream delta provider configured on gateway',
          );
          return;
        }

        const deltaReq = msg.payload as CatalogDeltaRequest;
        const delta = await this.#deltaProvider.getCatalogDeltas(auth, deltaReq);

        const responseMsg = createSyncStreamMessage<CatalogDeltaResponse>(
          'DOWNSTREAM_DELTA_RESPONSE',
          auth.organizationId,
          auth.branchId,
          delta,
          msg.messageId,
        );
        ws.send(JSON.stringify(responseMsg));
        break;
      }

      case 'KILL_SWITCH_COMMAND': {
        // Blocker R1-06 & R2-02: Treat kill switch as a privileged control-plane operation
        const hasControlPlaneAuth =
          auth.isControlPlane === true ||
          (Array.isArray(auth.roles) && auth.roles.includes('CLOUD_OPS')) ||
          (Array.isArray(auth.permissions) && auth.permissions.includes('sync.kill_switch.manage'));

        if (!hasControlPlaneAuth) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_CONTROL_PLANE_FORBIDDEN,
            'Ordinary Edge stations cannot mutate global sync kill switch',
          );
          return;
        }

        const command = msg.payload as { enabled: boolean; reason?: string };
        this.setKillSwitch(command.enabled, command.reason, `CONTROL_PLANE:${auth.organizationId}`);
        break;
      }

      default: {
        this.#sendError(
          ws,
          auth.organizationId,
          auth.branchId,
          'UNSUPPORTED_MESSAGE_TYPE',
          `Type '${msg.type}' not supported by gateway`,
        );
      }
    }
  }

  #sendError(
    ws: WebSocket,
    organizationId: string,
    branchId: string,
    code: string,
    message: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const errPayload = {
      code,
      message,
    };
    const errorMsg = createSyncStreamMessage('SYNC_ERROR', organizationId, branchId, errPayload);
    ws.send(JSON.stringify(errorMsg));
  }
}
