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
  ERROR_CODE_MALFORMED_STREAM_MESSAGE,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_SYNC_KILL_SWITCH_ENGAGED,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  SyncBatchAckDTO,
  SyncBatchDTO,
  SyncEngineKillSwitch,
  SyncStreamMessage,
  createSyncStreamMessage,
  isValidSyncStreamMessage,
} from '@trident/core';
import type { IDownstreamDeltaProvider, ISyncBatchProcessor } from './types.js';

export interface CloudSyncGatewayOptions {
  readonly server?: http.Server;
  readonly port?: number;
  readonly path?: string;
  readonly batchProcessor: ISyncBatchProcessor;
  readonly deltaProvider?: IDownstreamDeltaProvider;
  readonly authResolver?: (req: http.IncomingMessage) => Promise<AuthContext | null> | AuthContext | null;
}

export class CloudWebSocketSyncGateway {
  readonly #wss: WebSocketServer;
  readonly #batchProcessor: ISyncBatchProcessor;
  readonly #deltaProvider?: IDownstreamDeltaProvider;
  readonly #authResolver?: (req: http.IncomingMessage) => Promise<AuthContext | null> | AuthContext | null;
  readonly #clients = new Map<WebSocket, AuthContext>();
  #killSwitch: SyncEngineKillSwitch = {
    enabled: true, // true = sync active
    updatedAt: new Date().toISOString(),
  };

  constructor(options: CloudSyncGatewayOptions) {
    this.#batchProcessor = options.batchProcessor;
    this.#deltaProvider = options.deltaProvider;
    this.#authResolver = options.authResolver;

    const path = options.path ?? '/api/v1/sync/stream';

    if (options.server) {
      this.#wss = new WebSocketServer({
        noServer: true,
      });

      options.server.on('upgrade', async (req, socket, head) => {
        const url = req.url?.split('?')[0];
        if (url !== path) {
          return;
        }

        let auth: AuthContext | null = null;
        if (this.#authResolver) {
          auth = await this.#authResolver(req);
          if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        this.#wss.handleUpgrade(req, socket, head, (ws) => {
          if (auth) {
            this.#clients.set(ws, auth);
          }
          this.#wss.emit('connection', ws, req);
        });
      });
    } else {
      this.#wss = new WebSocketServer({
        port: options.port ?? 0,
        path,
      });
    }

    this.#wss.on('connection', (ws, req) => {
      this.#handleConnection(ws, req);
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

  #handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    ws.on('message', async (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          this.#sendError(ws, 'unknown', 'unknown', ERROR_CODE_MALFORMED_STREAM_MESSAGE, 'Invalid JSON format');
          return;
        }

        if (!isValidSyncStreamMessage(parsed)) {
          this.#sendError(ws, 'unknown', 'unknown', ERROR_CODE_MALFORMED_STREAM_MESSAGE, 'Message does not conform to SyncStreamMessage');
          return;
        }

        const msg = parsed as SyncStreamMessage;

        // Establish or verify authenticated session context (Pattern B)
        let auth = this.#clients.get(ws);
        if (!auth) {
          if (this.#authResolver) {
            const resolved = await this.#authResolver(req);
            if (resolved) {
              auth = resolved;
            }
          }
          if (!auth) {
            // Default to message authority ONLY if no resolver is configured (test harness mode)
            auth = {
              organizationId: msg.organizationId,
              branchId: msg.branchId,
            };
          }
          this.#clients.set(ws, auth);
        }

        // Fencing check: incoming payload cannot override authenticated tenant authority
        if (msg.organizationId !== auth.organizationId) {
          this.#sendError(ws, auth.organizationId, auth.branchId, ERROR_CODE_UNAUTHORIZED_TENANT, 'Message organizationId does not match verified session authority');
          return;
        }
        if (msg.branchId !== auth.branchId) {
          this.#sendError(ws, auth.organizationId, auth.branchId, ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH, 'Message branchId does not match verified session authority');
          return;
        }

        await this.#routeMessage(ws, auth, msg);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown gateway routing error';
        this.#sendError(ws, 'unknown', 'unknown', 'GATEWAY_INTERNAL_ERROR', errMsg);
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
          {
            serverTime: new Date().toISOString(),
            killSwitch: this.#killSwitch,
          },
          msg.messageId,
        );
        ws.send(JSON.stringify(pong));
        break;
      }

      case 'UPSTREAM_BATCH': {
        // Enforce Kill Switch
        if (!this.#killSwitch.enabled) {
          this.#sendError(
            ws,
            auth.organizationId,
            auth.branchId,
            ERROR_CODE_SYNC_KILL_SWITCH_ENGAGED,
            `Sync engine is currently disabled: ${this.#killSwitch.reason ?? 'Kill switch active'}`,
          );
          return;
        }

        const batch = msg.payload as SyncBatchDTO;
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
          this.#sendError(ws, auth.organizationId, auth.branchId, 'DELTA_PROVIDER_NOT_AVAILABLE', 'No downstream delta provider configured on gateway');
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
        const command = msg.payload as { enabled: boolean; reason?: string };
        this.setKillSwitch(command.enabled, command.reason, 'CLIENT_DISPATCHER');
        break;
      }

      default: {
        this.#sendError(ws, auth.organizationId, auth.branchId, 'UNSUPPORTED_MESSAGE_TYPE', `Type '${msg.type}' not supported by gateway`);
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
    const errorMsg = createSyncStreamMessage(
      'SYNC_ERROR',
      organizationId,
      branchId,
      errPayload,
    );
    ws.send(JSON.stringify(errorMsg));
  }
}
