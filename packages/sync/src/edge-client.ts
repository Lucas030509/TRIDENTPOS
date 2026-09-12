/**
 * TRIDENTPOS Edge Synchronization Client (WP-013)
 * Conforms to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 4 & 5
 * - ADR-005, ADR-006, EAAF v1.2.0 WP-013
 */

import { WebSocket } from 'ws';
import {
  AuthContext,
  CatalogDeltaRequest,
  CatalogDeltaResponse,
  DEFAULT_SYNC_RECONNECT_CONFIG,
  ExponentialBackoffPolicy,
  SyncBatchAckDTO,
  SyncBatchDTO,
  SyncConnectionState,
  SyncEngineKillSwitch,
  SyncEventDTO,
  SyncReconnectConfig,
  SyncStreamMessage,
  createSyncStreamMessage,
  isValidSyncStreamMessage,
} from '@trident/core';

export interface IEdgeOutboxManager {
  getPendingEvents(limit?: number): Array<{
    id: string;
    organizationId: string;
    branchId: string;
    clientOpId: string;
    aggregateType: string;
    aggregateId: string;
    aggregateSequenceNumber: number;
    action: string;
    payload: unknown;
  }>;
  markSynced(id: string, ack: import('@trident/core').SyncEventAckDTO): boolean;
}

export interface IEdgeSyncPersistenceManager {
  upsertCheckpoint(checkpoint: import('@trident/core').SyncCheckpointRecord): void;
  getCheckpoint(streamType: string): import('@trident/core').SyncCheckpointRecord | null;
  recordTelemetry(event: import('@trident/core').SyncTelemetryEvent): void;
  applyCatalogDelta(
    orgId: string,
    branchId: string,
    delta: CatalogDeltaResponse,
  ): { success: boolean; appliedCount: number; newSnapshotVersion: number };
}

export interface EdgeSyncClientOptions {
  readonly wsUrl: string;
  readonly auth: AuthContext;
  readonly outbox?: IEdgeOutboxManager;
  readonly syncPersistence?: IEdgeSyncPersistenceManager;
  readonly config?: Partial<SyncReconnectConfig>;
}

export class EdgeSyncClient {
  readonly #wsUrl: string;
  readonly #auth: AuthContext;
  readonly #outbox?: IEdgeOutboxManager;
  readonly #syncPersistence?: IEdgeSyncPersistenceManager;
  readonly #config: SyncReconnectConfig;
  readonly #backoff: ExponentialBackoffPolicy;

  #ws: WebSocket | null = null;
  #state: SyncConnectionState = 'DISCONNECTED';
  #reconnectAttempts = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  #stopped = false;
  #wanBlocked = false;

  #killSwitch: SyncEngineKillSwitch = {
    enabled: true,
    updatedAt: new Date().toISOString(),
  };

  #pendingRequests = new Map<
    string,
    { resolve: (msg: SyncStreamMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(options: EdgeSyncClientOptions) {
    this.#wsUrl = options.wsUrl;
    this.#auth = options.auth;
    this.#outbox = options.outbox;
    this.#syncPersistence = options.syncPersistence;

    this.#config = {
      ...DEFAULT_SYNC_RECONNECT_CONFIG,
      ...options.config,
    };

    this.#backoff = new ExponentialBackoffPolicy({
      baseDelayMs: this.#config.baseDelayMs,
      maxDelayMs: this.#config.maxDelayMs,
      deterministic: true,
    });
  }

  public getState(): SyncConnectionState {
    return this.#state;
  }

  public getKillSwitch(): SyncEngineKillSwitch {
    return this.#killSwitch;
  }

  public setKillSwitch(enabled: boolean, reason?: string): void {
    this.#killSwitch = {
      enabled,
      reason: reason ?? null,
      updatedAt: new Date().toISOString(),
    };

    if (!enabled) {
      this.#state = 'DISABLED';
      this.#emitTelemetry('KILL_SWITCH_ENGAGED', 0, { reason });
    } else {
      this.#emitTelemetry('KILL_SWITCH_DISENGAGED', 0, { reason });
      if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
        this.#state = 'CONNECTED';
        // Resume synchronization
        void this.flushOutbox();
        void this.pullCatalogDeltas();
      } else if (!this.#stopped && !this.#wanBlocked) {
        this.#state = 'RECONNECTING';
        this.#scheduleReconnect();
      }
    }
  }

  /**
   * Chaos Test Utility: Simulates deliberate WAN disconnection without terminating the client loop.
   */
  public simulateWanDrop(): void {
    this.#wanBlocked = true;
    this.#clearHeartbeatTimers();
    if (this.#ws) {
      this.#ws.terminate();
      this.#ws = null;
    }
    this.#state = 'DISCONNECTED';
    this.#emitTelemetry('WAN_DISCONNECTED', 0, { simulated: true });
  }

  /**
   * Chaos Test Utility: Restores WAN connectivity after simulated drop.
   */
  public simulateWanRestore(): void {
    this.#wanBlocked = false;
    if (!this.#stopped && this.#killSwitch.enabled) {
      this.#state = 'RECONNECTING';
      this.#scheduleReconnect(0);
    }
  }

  public async connect(): Promise<void> {
    this.#stopped = false;
    this.#wanBlocked = false;
    return this.#performConnect();
  }

  public async disconnect(): Promise<void> {
    this.#stopped = true;
    this.#clearReconnectTimer();
    this.#clearHeartbeatTimers();

    for (const [id, req] of this.#pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('Sync client disconnected'));
      this.#pendingRequests.delete(id);
    }

    if (this.#ws) {
      this.#ws.terminate();
      this.#ws = null;
    }

    this.#state = 'DISCONNECTED';
  }

  #performConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#stopped || this.#wanBlocked) {
        resolve();
        return;
      }

      if (!this.#killSwitch.enabled) {
        this.#state = 'DISABLED';
        resolve();
        return;
      }

      this.#state = this.#reconnectAttempts === 0 ? 'CONNECTING' : 'RECONNECTING';

      try {
        const ws = new WebSocket(this.#wsUrl);
        this.#ws = ws;

        let opened = false;

        ws.on('open', async () => {
          opened = true;
          this.#state = 'CONNECTED';
          const wasReconnected = this.#reconnectAttempts > 0;
          this.#reconnectAttempts = 0;

          if (wasReconnected) {
            this.#emitTelemetry('WAN_RECONNECTED', 0);
          }

          this.#startHeartbeat();

          // Auto-flush pending outbox and pull deltas upon WAN connection/restoration
          try {
            await this.flushOutbox();
            await this.pullCatalogDeltas();
          } catch (syncErr) {
            this.#emitTelemetry('SYNC_ERROR', 0, {
              error: syncErr instanceof Error ? syncErr.message : String(syncErr),
            });
          }

          resolve();
        });

        ws.on('message', (data: Buffer | string) => {
          this.#handleIncomingMessage(data);
        });

        ws.on('close', () => {
          this.#clearHeartbeatTimers();
          this.#rejectPendingRequests(new Error('WebSocket connection closed'));

          if (this.#state === 'CONNECTED') {
            this.#emitTelemetry('WAN_DISCONNECTED', 0);
          }

          if (!this.#stopped && !this.#wanBlocked && this.#killSwitch.enabled) {
            this.#state = 'RECONNECTING';
            this.#scheduleReconnect();
          } else if (!this.#killSwitch.enabled) {
            this.#state = 'DISABLED';
          } else {
            this.#state = 'DISCONNECTED';
          }
        });

        ws.on('error', (err) => {
          if (!opened) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  #scheduleReconnect(overrideDelayMs?: number): void {
    this.#clearReconnectTimer();
    if (this.#stopped || this.#wanBlocked || !this.#killSwitch.enabled) return;

    this.#reconnectAttempts++;
    const delay = overrideDelayMs ?? this.#backoff.getDelayMs(this.#reconnectAttempts);

    this.#reconnectTimer = setTimeout(() => {
      void this.#performConnect().catch(() => {
        if (!this.#stopped && !this.#wanBlocked && this.#killSwitch.enabled) {
          this.#scheduleReconnect();
        }
      });
    }, delay);
  }

  #startHeartbeat(): void {
    this.#clearHeartbeatTimers();

    this.#heartbeatTimer = setInterval(() => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;

      const ping = createSyncStreamMessage(
        'HEARTBEAT_PING',
        this.#auth.organizationId,
        this.#auth.branchId,
        { clientTime: new Date().toISOString() },
      );

      this.#heartbeatTimeoutTimer = setTimeout(() => {
        // Heartbeat timeout declared: WAN drop detected
        this.#emitTelemetry('HEARTBEAT_FAILED', this.#config.heartbeatTimeoutMs);
        if (this.#ws) {
          this.#ws.terminate();
        }
      }, this.#config.heartbeatTimeoutMs);

      this.#ws.send(JSON.stringify(ping));
    }, this.#config.heartbeatIntervalMs);
  }

  #clearHeartbeatTimers(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#heartbeatTimeoutTimer) {
      clearTimeout(this.#heartbeatTimeoutTimer);
      this.#heartbeatTimeoutTimer = null;
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #rejectPendingRequests(error: Error): void {
    for (const [id, req] of this.#pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(error);
      this.#pendingRequests.delete(id);
    }
  }

  #handleIncomingMessage(data: Buffer | string): void {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const parsed = JSON.parse(text);
      if (!isValidSyncStreamMessage(parsed)) return;

      const msg = parsed as SyncStreamMessage;

      // Check Heartbeat Pong
      if (msg.type === 'HEARTBEAT_PONG') {
        if (this.#heartbeatTimeoutTimer) {
          clearTimeout(this.#heartbeatTimeoutTimer);
          this.#heartbeatTimeoutTimer = null;
        }
        const pongPayload = msg.payload as { killSwitch?: SyncEngineKillSwitch };
        if (pongPayload?.killSwitch && pongPayload.killSwitch.enabled !== this.#killSwitch.enabled) {
          this.setKillSwitch(pongPayload.killSwitch.enabled, pongPayload.killSwitch.reason ?? undefined);
        }
        return;
      }

      // Check remote Kill Switch command
      if (msg.type === 'KILL_SWITCH_COMMAND') {
        const killCmd = msg.payload as SyncEngineKillSwitch;
        this.setKillSwitch(killCmd.enabled, killCmd.reason ?? undefined);
        return;
      }

      // Resolve pending correlated request by messageId
      const pending = this.#pendingRequests.get(msg.messageId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pendingRequests.delete(msg.messageId);
        pending.resolve(msg);
      }
    } catch {
      // ignore parse error on client socket
    }
  }

  /**
   * Flushes pending local outbox records to Cloud WebSocket stream.
   * Conforms strictly to WP-012 receipt trust rules:
   * Only transitions local record to SYNCED when receipt serverSignature verifies.
   */
  public async flushOutbox(limit = 100): Promise<{ flushed: number; synced: number }> {
    if (!this.#outbox) {
      return { flushed: 0, synced: 0 };
    }

    if (!this.#killSwitch.enabled || this.#state !== 'CONNECTED' || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      return { flushed: 0, synced: 0 };
    }

    const pending = this.#outbox.getPendingEvents(limit);
    if (pending.length === 0) {
      return { flushed: 0, synced: 0 };
    }

    const startTime = Date.now();
    const batchId = crypto.randomUUID();

    const events: SyncEventDTO[] = pending.map((row) => ({
      organizationId: row.organizationId,
      branchId: row.branchId,
      clientOpId: row.clientOpId,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      aggregateSequenceNumber: row.aggregateSequenceNumber,
      action: row.action,
      payload: row.payload,
    }));

    const batchDto: SyncBatchDTO = {
      batchId,
      organizationId: this.#auth.organizationId,
      branchId: this.#auth.branchId,
      events,
    };

    const upstreamMsg = createSyncStreamMessage(
      'UPSTREAM_BATCH',
      this.#auth.organizationId,
      this.#auth.branchId,
      batchDto,
    );

    const response = await this.#sendAndAwaitResponse<SyncBatchAckDTO>(upstreamMsg);
    const ack = response.payload;

    let syncedCount = 0;
    for (const result of ack.results) {
      const localRecord = pending.find((p) => p.clientOpId === result.clientOpId);
      if (localRecord) {
        const marked = this.#outbox.markSynced(localRecord.id, result);
        if (marked) {
          syncedCount++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.#emitTelemetry('OUTBOX_DRAINED', durationMs, {
      flushedCount: pending.length,
      syncedCount,
      batchId,
    });

    if (this.#syncPersistence && pending.length > 0) {
      const maxSeq = Math.max(...pending.map((p) => p.aggregateSequenceNumber));
      this.#syncPersistence.upsertCheckpoint({
        id: crypto.randomUUID(),
        organizationId: this.#auth.organizationId,
        branchId: this.#auth.branchId,
        streamType: 'OUTBOX_INGESTION',
        checkpointType: 'UPSTREAM_SEQUENCE',
        lastSyncedSequence: maxSeq,
        lastSnapshotVersion: 0,
        lastSyncTimestamp: new Date().toISOString(),
        metadata: { batchId, syncedCount },
      });
    }

    return { flushed: pending.length, synced: syncedCount };
  }

  /**
   * Pulls downstream catalog deltas and applies them atomically.
   */
  public async pullCatalogDeltas(): Promise<CatalogDeltaResponse | null> {
    if (!this.#syncPersistence) return null;
    if (!this.#killSwitch.enabled || this.#state !== 'CONNECTED' || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    const currentCheckpoint = this.#syncPersistence.getCheckpoint('CATALOG_DELTA');
    const sinceSnapshotVersion = currentCheckpoint?.lastSnapshotVersion ?? 0;

    const deltaReq: CatalogDeltaRequest = {
      sinceSnapshotVersion,
    };

    const streamMsg = createSyncStreamMessage(
      'DOWNSTREAM_DELTA_REQUEST',
      this.#auth.organizationId,
      this.#auth.branchId,
      deltaReq,
    );

    const startTime = Date.now();
    const response = await this.#sendAndAwaitResponse<CatalogDeltaResponse>(streamMsg);
    const delta = response.payload;

    if (delta.entities && delta.entities.length > 0) {
      this.#syncPersistence.applyCatalogDelta(
        this.#auth.organizationId,
        this.#auth.branchId,
        delta,
      );

      const durationMs = Date.now() - startTime;
      this.#emitTelemetry('DELTA_PULLED', durationMs, {
        entitiesCount: delta.entities.length,
        snapshotVersion: delta.snapshotVersion,
      });
    }

    return delta;
  }

  #sendAndAwaitResponse<T>(msg: SyncStreamMessage, timeoutMs = 15000): Promise<SyncStreamMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Cannot send message: WebSocket is not open'));
        return;
      }

      const timer = setTimeout(() => {
        this.#pendingRequests.delete(msg.messageId);
        reject(new Error(`Timed out awaiting sync stream response for message ${msg.messageId}`));
      }, timeoutMs);

      this.#pendingRequests.set(msg.messageId, {
        resolve: resolve as (m: SyncStreamMessage) => void,
        reject,
        timer,
      });

      this.#ws.send(JSON.stringify(msg));
    });
  }

  #emitTelemetry(eventType: import('@trident/core').SyncTelemetryEventType, durationMs?: number, details?: Record<string, unknown>): void {
    if (this.#syncPersistence) {
      this.#syncPersistence.recordTelemetry({
        id: crypto.randomUUID(),
        organizationId: this.#auth.organizationId,
        branchId: this.#auth.branchId,
        eventType,
        durationMs: durationMs ?? null,
        recordsCount: details?.syncedCount ? Number(details.syncedCount) : (details?.entitiesCount ? Number(details.entitiesCount) : 0),
        details,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}
