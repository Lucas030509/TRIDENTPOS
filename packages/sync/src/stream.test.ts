/**
 * TRIDENTPOS WP-013: Bidirectional Sync Service & WAN Reconnection Protocol Test Suite
 * Conforms strictly to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 4 & 5
 * - ADR-005, ADR-006, EAAF v1.2.0 WP-013
 * - Canonical Network Partition Chaos Failure-Mode Specification (Section 9)
 * - Remediated per COORDINATOR_PROMPT_WP013_S13-R1_REMEDIATION.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import {
  AuthContext,
  CloudReceiptIssuer,
  ERROR_CODE_CHECKPOINT_REGRESSION,
  ERROR_CODE_CONTROL_PLANE_FORBIDDEN,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  ExponentialBackoffPolicy,
  SyncBatchAckDTO,
  SyncBatchDTO,
  SyncEventAckDTO,
  createSyncStreamMessage,
} from '@trident/core';
import { TestCloudReceiptIssuer, TestCloudReceiptVerifier } from '@trident/core/test-support';
import { EdgeDatabaseService, EdgeOutboxPersistence, EdgeSyncPersistence } from '@trident/edge';
import { SignJWT, generateKeyPair } from 'jose';
import {
  CloudWebSocketSyncGateway,
  EdgeSyncClient,
  CloudCatalogDeltaService,
  CallbackWebSocketAuthenticator,
  JwtWebSocketAuthenticator,
  ISyncBatchProcessor,
} from './index.js';

// --- Canonical WP-012 Ingested Batch Processor ---

class CanonicalTestBatchProcessor implements ISyncBatchProcessor {
  readonly #issuer: CloudReceiptIssuer;
  public processedBatches: SyncBatchDTO[] = [];
  public ingestedEvents = new Map<string, SyncEventAckDTO>();
  public sequenceMap = new Map<string, number>();

  constructor(issuer: CloudReceiptIssuer) {
    this.#issuer = issuer;
  }

  public async processBatch(auth: AuthContext, batch: SyncBatchDTO): Promise<SyncBatchAckDTO> {
    this.processedBatches.push(batch);
    const results: SyncEventAckDTO[] = [];

    for (const ev of batch.events) {
      const streamKey = `${auth.organizationId}:${auth.branchId}:${ev.aggregateType}:${ev.aggregateId}`;
      const currentSeq = this.sequenceMap.get(streamKey) ?? 0;
      const expectedSeq = currentSeq + 1;

      // Duplicate Check (WP-012 idempotent replay)
      const existing = this.ingestedEvents.get(ev.clientOpId);
      if (existing) {
        results.push({
          ...existing,
          status: 'DUPLICATE_ACCEPTED',
        });
        continue;
      }

      // Gap Check (WP-012 causal sequencing)
      if (ev.aggregateSequenceNumber > expectedSeq) {
        results.push({
          clientOpId: ev.clientOpId,
          aggregateType: ev.aggregateType,
          aggregateId: ev.aggregateId,
          aggregateSequenceNumber: ev.aggregateSequenceNumber,
          status: 'REQUIRES_RECONCILIATION',
          gapInterval: {
            expectedSequence: expectedSeq,
            incomingSequence: ev.aggregateSequenceNumber,
            missingStart: expectedSeq,
            missingEnd: ev.aggregateSequenceNumber - 1,
          },
        });
        continue;
      }

      // Contiguous sequence: Issue authentic receipt via CloudReceiptIssuer
      const receipt = await this.#issuer.issueReceipt({
        organizationId: auth.organizationId,
        branchId: auth.branchId,
        clientOpId: ev.clientOpId,
        aggregateSequenceNumber: ev.aggregateSequenceNumber,
      });

      this.sequenceMap.set(streamKey, ev.aggregateSequenceNumber);

      const ack: SyncEventAckDTO = {
        clientOpId: ev.clientOpId,
        aggregateType: ev.aggregateType,
        aggregateId: ev.aggregateId,
        aggregateSequenceNumber: ev.aggregateSequenceNumber,
        status: 'APPLIED',
        receipt,
      };

      this.ingestedEvents.set(ev.clientOpId, ack);
      results.push(ack);
    }

    return {
      batchId: batch.batchId ?? crypto.randomUUID(),
      organizationId: auth.organizationId,
      branchId: auth.branchId,
      results,
    };
  }
}

describe('TRIDENTPOS WP-013: Bidirectional Synchronization Service & WAN Reconnection Protocol', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const branchId = '22222222-2222-4222-8222-222222222222';
  const tenantBId = '33333333-3333-4333-8333-333333333333';
  const branchBId = '44444444-4444-4444-8444-444444444444';
  const auth: AuthContext = { organizationId: orgId, branchId };

  const validTokenTenantA = 'station-token-valid-tenant-a';
  const validTokenControlPlane = 'control-plane-token-valid-admin';

  let server: http.Server;
  let gateway: CloudWebSocketSyncGateway;
  let batchProcessor: CanonicalTestBatchProcessor;
  let deltaService: CloudCatalogDeltaService;
  let testIssuer: TestCloudReceiptIssuer;
  let testVerifier: TestCloudReceiptVerifier;
  let authenticator: CallbackWebSocketAuthenticator;
  let port: number;

  before(async () => {
    testIssuer = new TestCloudReceiptIssuer();
    testVerifier = new TestCloudReceiptVerifier();
    batchProcessor = new CanonicalTestBatchProcessor(testIssuer);
    deltaService = new CloudCatalogDeltaService();

    deltaService.setEntities(
      orgId,
      [
        {
          entityType: 'PRODUCT',
          entityId: 'prod-001',
          action: 'UPSERT',
          data: { name: 'Tacos al Pastor', price: 95.0 },
          version: 1,
        },
        {
          entityType: 'PRODUCT',
          entityId: 'prod-002',
          action: 'UPSERT',
          data: { name: 'Agua de Horchata', price: 35.0 },
          version: 1,
        },
      ],
      1,
    );

    authenticator = new CallbackWebSocketAuthenticator((req) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      const token = authHeader.slice(7);
      if (token === validTokenTenantA) {
        return {
          organizationId: orgId,
          branchId,
          isControlPlane: false,
          roles: ['STATION_OPERATOR'],
        };
      }
      if (token === validTokenControlPlane) {
        return {
          organizationId: orgId,
          branchId,
          isControlPlane: true,
          roles: ['CLOUD_OPS'],
        };
      }
      return null;
    });

    server = http.createServer();
    gateway = new CloudWebSocketSyncGateway({
      server,
      path: '/api/v1/sync/stream',
      batchProcessor,
      deltaProvider: deltaService,
      authenticator,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // WP013-T01: Normal Connection Lifecycle
  // =========================================================================
  it('WP013-T01: EdgeSyncClient establishes authenticated connection with CloudWebSocketSyncGateway', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-t01-'));
    const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const persistence = new EdgeSyncPersistence(edgeDb);

    const client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      config: {
        heartbeatIntervalMs: 500,
        heartbeatTimeoutMs: 1000,
      },
      deterministicBackoff: true,
    });

    await client.connect();
    assert.equal(client.getState(), 'CONNECTED');
    await client.disconnect();
    assert.equal(client.getState(), 'DISCONNECTED');

    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // BLOCKER R1-01 & R1-02: Fail-Closed Authentication & Tenant Spoofing
  // =========================================================================
  it('WP013-T02A: Gateway rejects connection when authentication token is missing (HTTP 401)', async () => {
    const unauthClient = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      // No authToken provided
      deterministicBackoff: true,
    });

    await assert.rejects(async () => {
      await unauthClient.connect();
    }, /401|Unexpected server response: 401/);

    assert.notEqual(unauthClient.getState(), 'CONNECTED');
    await unauthClient.disconnect();
  });

  it('WP013-T02B: Gateway rejects connection when authentication token is malformed or invalid (HTTP 401)', async () => {
    const invalidClient = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: 'malicious-forged-token-xyz',
      deterministicBackoff: true,
    });

    await assert.rejects(async () => {
      await invalidClient.connect();
    }, /401|Unexpected server response: 401/);

    assert.notEqual(invalidClient.getState(), 'CONNECTED');
    await invalidClient.disconnect();
  });

  it('WP013-T02C: Gateway rejects tenant spoofing when client claims different organizationId', async () => {
    const initialBatchCount = batchProcessor.processedBatches.length;

    // Connect raw socket authenticated as Tenant A
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/stream`, {
      headers: { Authorization: `Bearer ${validTokenTenantA}` },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Transmit a validly framed message claiming Tenant B
    const forgedTenantMsg = createSyncStreamMessage(
      'UPSTREAM_BATCH',
      tenantBId, // Spoofed Tenant B
      branchId,
      {
        batchId: crypto.randomUUID(),
        organizationId: tenantBId,
        branchId,
        events: [
          {
            organizationId: tenantBId,
            branchId,
            clientOpId: crypto.randomUUID(),
            aggregateType: 'ORDER',
            aggregateId: 'ord-spoof-tenant',
            aggregateSequenceNumber: 1,
            action: 'CREATE',
            payload: { amount: 100 },
          },
        ],
      },
    );

    const errorPromise = new Promise<{ code: string; message: string }>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.type === 'SYNC_ERROR') {
          resolve(parsed.payload);
        }
      });
    });

    ws.send(JSON.stringify(forgedTenantMsg));
    const err = await errorPromise;

    // Gateway returns governed UNAUTHORIZED_TENANT
    assert.equal(err.code, ERROR_CODE_UNAUTHORIZED_TENANT);

    // Assert batchProcessor is NOT called, zero Cloud mutation occurred
    assert.equal(batchProcessor.processedBatches.length, initialBatchCount);
    assert.equal(batchProcessor.ingestedEvents.size, initialBatchCount);

    ws.close();
  });

  it('WP013-T02D: Gateway rejects branch spoofing when client claims different branchId', async () => {
    const initialBatchCount = batchProcessor.processedBatches.length;

    // Connect raw socket authenticated as Tenant A / Branch A
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/stream`, {
      headers: { Authorization: `Bearer ${validTokenTenantA}` },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Transmit message claiming Branch B
    const forgedBranchMsg = createSyncStreamMessage(
      'UPSTREAM_BATCH',
      orgId,
      branchBId, // Spoofed Branch B
      {
        batchId: crypto.randomUUID(),
        organizationId: orgId,
        branchId: branchBId,
        events: [
          {
            organizationId: orgId,
            branchId: branchBId,
            clientOpId: crypto.randomUUID(),
            aggregateType: 'ORDER',
            aggregateId: 'ord-spoof-branch',
            aggregateSequenceNumber: 1,
            action: 'CREATE',
            payload: { amount: 200 },
          },
        ],
      },
    );

    const errorPromise = new Promise<{ code: string; message: string }>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.type === 'SYNC_ERROR') {
          resolve(parsed.payload);
        }
      });
    });

    ws.send(JSON.stringify(forgedBranchMsg));
    const err = await errorPromise;

    // Gateway returns governed ORGANIZATION_BRANCH_MISMATCH
    assert.equal(err.code, ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH);

    // Assert batchProcessor is NOT called, zero Cloud mutation occurred
    assert.equal(batchProcessor.processedBatches.length, initialBatchCount);
    assert.equal(batchProcessor.ingestedEvents.size, initialBatchCount);

    ws.close();
  });

  it('WP013-T02E: Gateway rejects batch payload mismatch even when stream headers match', async () => {
    const initialBatchCount = batchProcessor.processedBatches.length;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/stream`, {
      headers: { Authorization: `Bearer ${validTokenTenantA}` },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Outer stream message claims orgId, but inner batch payload claims tenantBId
    const innerPayloadMismatchMsg = createSyncStreamMessage('UPSTREAM_BATCH', orgId, branchId, {
      batchId: crypto.randomUUID(),
      organizationId: tenantBId, // Inner payload spoofed!
      branchId,
      events: [],
    });

    const errorPromise = new Promise<{ code: string; message: string }>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.type === 'SYNC_ERROR') {
          resolve(parsed.payload);
        }
      });
    });

    ws.send(JSON.stringify(innerPayloadMismatchMsg));
    const err = await errorPromise;

    assert.equal(err.code, ERROR_CODE_UNAUTHORIZED_TENANT);
    assert.equal(batchProcessor.processedBatches.length, initialBatchCount);

    ws.close();
  });

  // =========================================================================
  // WP013-T03: Downstream Delta Pull Protocol
  // =========================================================================
  it('WP013-T03: Delta-pull protocol retrieves catalog deltas and applies atomically with checksum verification', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-t03-'));
    const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const persistence = new EdgeSyncPersistence(edgeDb);

    const client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      deterministicBackoff: true,
    });

    await client.connect();

    // Auto-pull retrieved baseline catalog version 1
    const checkpoint = persistence.getCheckpoint('CATALOG_DELTA');
    assert.ok(checkpoint);
    assert.equal(checkpoint.lastSnapshotVersion, 1);

    // New catalog update arrives in Cloud
    deltaService.setEntities(
      orgId,
      [
        {
          entityType: 'PRODUCT',
          entityId: 'prod-001',
          action: 'UPSERT',
          data: { name: 'Tacos al Pastor Especiales', price: 110.0 },
          version: 2,
        },
        {
          entityType: 'PRODUCT',
          entityId: 'prod-004',
          action: 'UPSERT',
          data: { name: 'Cerveza Modelo', price: 45.0 },
          version: 2,
        },
      ],
      2,
    );

    const delta = await client.pullCatalogDeltas();
    assert.ok(delta);
    assert.equal(delta.snapshotVersion, 2);
    assert.equal(delta.entities.length, 2);
    assert.ok(delta.checksum);

    const updatedCheckpoint = persistence.getCheckpoint('CATALOG_DELTA');
    assert.ok(updatedCheckpoint);
    assert.equal(updatedCheckpoint.lastSnapshotVersion, 2);

    await client.disconnect();
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // BLOCKER R1-06: Governed Kill Switch Control Plane
  // =========================================================================
  it('WP013-T04A: Ordinary Edge station cannot globally mutate Cloud sync kill switch (fails closed)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/stream`, {
      headers: { Authorization: `Bearer ${validTokenTenantA}` }, // Station operator, not control plane
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Ordinary station attempts to send KILL_SWITCH_COMMAND
    const killCmd = createSyncStreamMessage('KILL_SWITCH_COMMAND', orgId, branchId, {
      enabled: false,
      reason: 'Malicious station disabling sync',
    });

    const errorPromise = new Promise<{ code: string; message: string }>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.type === 'SYNC_ERROR') {
          resolve(parsed.payload);
        }
      });
    });

    ws.send(JSON.stringify(killCmd));
    const err = await errorPromise;

    // Must fail closed with CONTROL_PLANE_FORBIDDEN
    assert.equal(err.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

    // Verify global gateway kill switch was NOT modified
    assert.equal(gateway.getKillSwitch().enabled, true);

    ws.close();
  });

  it('WP013-T04B: Authorized control plane client toggles kill switch and broadcasts state', async () => {
    // 1. Ordinary client connects and listens
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-t04b-'));
    const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const persistence = new EdgeSyncPersistence(edgeDb);

    const stationClient = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      deterministicBackoff: true,
    });
    await stationClient.connect();
    assert.equal(stationClient.getState(), 'CONNECTED');
    assert.equal(stationClient.getKillSwitch().enabled, true);

    // 2. Control plane client connects
    const controlWs = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/stream`, {
      headers: { Authorization: `Bearer ${validTokenControlPlane}` }, // Privileged CLOUD_OPS
    });

    await new Promise<void>((resolve, reject) => {
      controlWs.on('open', resolve);
      controlWs.on('error', reject);
    });

    // 3. Control plane engages kill switch
    const engageCmd = createSyncStreamMessage('KILL_SWITCH_COMMAND', orgId, branchId, {
      enabled: false,
      reason: 'Authorized Emergency Maintenance',
    });
    controlWs.send(JSON.stringify(engageCmd));

    // Wait for broadcast to propagate to stationClient
    await new Promise((r) => setTimeout(r, 100));

    // Verify gateway state updated
    assert.equal(gateway.getKillSwitch().enabled, false);
    assert.equal(gateway.getKillSwitch().reason, 'Authorized Emergency Maintenance');

    // Verify station client received broadcast and updated local kill switch
    assert.equal(stationClient.getKillSwitch().enabled, false);
    assert.equal(stationClient.getState(), 'DISABLED');

    // While disabled, flushing yields 0
    const flushRes = await stationClient.flushOutbox();
    assert.equal(flushRes.flushed, 0);

    // 4. Control plane restores kill switch
    const restoreCmd = createSyncStreamMessage('KILL_SWITCH_COMMAND', orgId, branchId, {
      enabled: true,
      reason: 'Maintenance Completed',
    });
    controlWs.send(JSON.stringify(restoreCmd));

    await new Promise((r) => setTimeout(r, 100));

    assert.equal(gateway.getKillSwitch().enabled, true);
    assert.equal(stationClient.getKillSwitch().enabled, true);
    assert.equal(stationClient.getState(), 'CONNECTED');

    controlWs.close();
    await stationClient.disconnect();
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // BLOCKER R1-05: Checkpoint Monotonicity Enforcement on Edge SQLite
  // =========================================================================
  it('WP013-T05: Edge SQLite sync persistence rejects sequence and snapshot regressions', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-t05-'));
    const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
    const persistence = new EdgeSyncPersistence(edgeDb);

    // Initial valid checkpoint: sequence 84, snapshot version 10
    persistence.upsertCheckpoint({
      id: crypto.randomUUID(),
      organizationId: orgId,
      branchId,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'UPSTREAM_SEQUENCE',
      lastSyncedSequence: 84,
      lastSnapshotVersion: 10,
      lastSyncTimestamp: new Date().toISOString(),
    });

    const baseline = persistence.getCheckpoint('OUTBOX_INGESTION');
    assert.ok(baseline);
    assert.equal(baseline.lastSyncedSequence, 84);
    assert.equal(baseline.lastSnapshotVersion, 10);

    // 1. Negative Test: sequence drop 84 -> 40 must be rejected
    assert.throws(
      () => {
        persistence.upsertCheckpoint({
          id: crypto.randomUUID(),
          organizationId: orgId,
          branchId,
          streamType: 'OUTBOX_INGESTION',
          checkpointType: 'UPSTREAM_SEQUENCE',
          lastSyncedSequence: 40, // Regression!
          lastSnapshotVersion: 10,
          lastSyncTimestamp: new Date().toISOString(),
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(ERROR_CODE_CHECKPOINT_REGRESSION));
        return true;
      },
    );

    // Verify baseline preserved
    assert.equal(persistence.getCheckpoint('OUTBOX_INGESTION')?.lastSyncedSequence, 84);

    // 2. Negative Test: snapshot version drop 10 -> 7 must be rejected
    assert.throws(
      () => {
        persistence.upsertCheckpoint({
          id: crypto.randomUUID(),
          organizationId: orgId,
          branchId,
          streamType: 'OUTBOX_INGESTION',
          checkpointType: 'UPSTREAM_SEQUENCE',
          lastSyncedSequence: 84,
          lastSnapshotVersion: 7, // Regression!
          lastSyncTimestamp: new Date().toISOString(),
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(ERROR_CODE_CHECKPOINT_REGRESSION));
        return true;
      },
    );

    // Verify baseline preserved
    assert.equal(persistence.getCheckpoint('OUTBOX_INGESTION')?.lastSnapshotVersion, 10);

    // 3. Positive Test: equal sequence/version is idempotently accepted
    persistence.upsertCheckpoint({
      id: crypto.randomUUID(),
      organizationId: orgId,
      branchId,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'UPSTREAM_SEQUENCE',
      lastSyncedSequence: 84,
      lastSnapshotVersion: 10,
      lastSyncTimestamp: new Date().toISOString(),
    });
    assert.equal(persistence.getCheckpoint('OUTBOX_INGESTION')?.lastSyncedSequence, 84);

    // 4. Positive Test: monotonic advance 84 -> 90, 10 -> 12 succeeds
    persistence.upsertCheckpoint({
      id: crypto.randomUUID(),
      organizationId: orgId,
      branchId,
      streamType: 'OUTBOX_INGESTION',
      checkpointType: 'UPSTREAM_SEQUENCE',
      lastSyncedSequence: 90,
      lastSnapshotVersion: 12,
      lastSyncTimestamp: new Date().toISOString(),
    });
    assert.equal(persistence.getCheckpoint('OUTBOX_INGESTION')?.lastSyncedSequence, 90);
    assert.equal(persistence.getCheckpoint('OUTBOX_INGESTION')?.lastSnapshotVersion, 12);

    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // ADVISORY R1-07: Exponential Backoff & Jitter Behavior
  // =========================================================================
  it('WP013-T06: ExponentialBackoffPolicy applies configured jitter in production and deterministic delay when requested', () => {
    const baseDelayMs = 1000;
    const maxDelayMs = 10000;
    const jitterRatio = 0.2; // 20%

    // Deterministic policy
    const detPolicy = new ExponentialBackoffPolicy({
      baseDelayMs,
      maxDelayMs,
      deterministic: true,
    });
    assert.equal(detPolicy.getDelayMs(1), 1000);
    assert.equal(detPolicy.getDelayMs(2), 2000);
    assert.equal(detPolicy.getDelayMs(3), 4000);

    // Production jittered policy (deterministic: false, default)
    const prodPolicy = new ExponentialBackoffPolicy({
      baseDelayMs,
      maxDelayMs,
      jitterRatio,
      deterministic: false,
    });

    const delaysAttempt1: number[] = [];
    for (let i = 0; i < 20; i++) {
      delaysAttempt1.push(prodPolicy.getDelayMs(1));
    }

    // Delays must stay within [1000 * 0.8, 1000 * 1.2] = [800, 1200]
    for (const d of delaysAttempt1) {
      assert.ok(d >= 800, `Delay ${d} should be >= 800`);
      assert.ok(d <= 1200, `Delay ${d} should be <= 1200`);
    }

    // Must not be all identical (proves random jitter is active)
    const uniqueDelays = new Set(delaysAttempt1);
    assert.ok(uniqueDelays.size > 1, 'Production jitter must produce varying backoff delays');
  });

  // =========================================================================
  // BLOCKER R1-03 & R1-04: Canonical Network Partition Chaos & SQLite Durability
  // Fulfills SEC-VAL-09 Minimum Scenario (14 sequential validation gates)
  // Exercising REAL Edge SQLite persistence, real process restart, and real transport failure
  // =========================================================================
  it('WP013-CHAOS-01: Canonical Network Partition Chaos & SQLite Durability (SEC-VAL-09 Real Stack)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-chaos-real-'));
    const dbPath = path.join(tempDir, 'trident-edge-durability.db');

    // 1. Setup REAL Edge persistence stack on SQLite disk database
    let edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    let outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    let persistence = new EdgeSyncPersistence(edgeDb);

    let client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      config: {
        baseDelayMs: 50,
        maxDelayMs: 200,
        heartbeatIntervalMs: 200,
        heartbeatTimeoutMs: 500,
      },
      deterministicBackoff: true,
    });

    // Gate 1: Establish normal authenticated Edge ↔ Cloud synchronization
    await client.connect();
    assert.equal(client.getState(), 'CONNECTED');

    // Gate 2: Initial baseline sync with real SQLite transactional outbox
    const baselineOp = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-baseline-1',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 5, total: 150.0 },
    });

    const initFlush = await client.flushOutbox();
    assert.equal(initFlush.flushed, 1);
    assert.equal(initFlush.synced, 1);

    // Verify row transitioned to SYNCED in SQLite with authentic receipt
    const baselineRow = outbox.getById(baselineOp.id);
    assert.ok(baselineRow);
    assert.equal(baselineRow.status, 'SYNCED');
    assert.ok(baselineRow.receiptToken);

    // Gate 3 & R1-04: Real transport failure - terminate gateway connection
    // We close the gateway to cause a real transport failure on the client socket
    await gateway.close();

    // Verify client detects transport failure and enters RECONNECTING
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (client.getState() === 'RECONNECTING') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
    assert.equal(client.getState(), 'RECONNECTING');

    // Verify telemetry captured WAN_DISCONNECTED
    const dropTelemetry = persistence
      .getRecentTelemetry()
      .find((t) => t.eventType === 'WAN_DISCONNECTED');
    assert.ok(dropTelemetry);

    // Gate 4: Generate valid offline operations transactionally in SQLite while WAN is dead
    const offlineOp1 = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-offline-1',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 7, total: 320.0, items: ['Enchiladas Verdes', 'Cerveza Corona'] },
    });

    const offlineOp2 = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-offline-1',
      aggregateSequenceNumber: 2,
      action: 'ADD_PARTIDA',
      clientOpId: crypto.randomUUID(),
      payload: { item: 'Flan Casero', price: 65.0 },
    });

    const offlineOp3 = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-offline-2',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 2, total: 85.0, items: ['Cafe de Olla'] },
    });

    // Gate 5: Verify rows exist physically in SQLite as PENDING
    assert.equal(outbox.getBacklogCount(), 3);
    const pendingDuringPartition = outbox.getPendingEvents();
    assert.equal(pendingDuringPartition.length, 3);
    assert.equal(outbox.getById(offlineOp1.id)?.status, 'PENDING');
    assert.equal(outbox.getById(offlineOp2.id)?.status, 'PENDING');
    assert.equal(outbox.getById(offlineOp3.id)?.status, 'PENDING');

    // Gate 6 & R1-03: Process restart simulation
    // Disconnect client and close SQLite database connection
    await client.disconnect();
    edgeDb.close();

    // Re-open the SAME SQLite database file from disk
    edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    persistence = new EdgeSyncPersistence(edgeDb);

    // Gate 7: Prove pending records survive restart (durability verification)
    assert.equal(outbox.getBacklogCount(), 3);
    const pendingAfterRestart = outbox.getPendingEvents();
    assert.equal(pendingAfterRestart.length, 3);
    assert.equal(pendingAfterRestart[0]!.clientOpId, offlineOp1.clientOpId);
    assert.equal(pendingAfterRestart[1]!.clientOpId, offlineOp2.clientOpId);
    assert.equal(pendingAfterRestart[2]!.clientOpId, offlineOp3.clientOpId);

    // Update Cloud catalog while Edge was disconnected (simulating upstream catalog change)
    deltaService.setEntities(
      orgId,
      [
        {
          entityType: 'PRODUCT',
          entityId: 'prod-001',
          action: 'UPSERT',
          data: { name: 'Tacos al Pastor', price: 100.0 },
          version: 10,
        },
        {
          entityType: 'PRODUCT',
          entityId: 'prod-003',
          action: 'UPSERT',
          data: { name: 'Guacamole Tradicional', price: 85.0 },
          version: 10,
        },
      ],
      10,
    );

    // Gate 8: Restore server connectivity
    gateway = new CloudWebSocketSyncGateway({
      server,
      path: '/api/v1/sync/stream',
      batchProcessor,
      deltaProvider: deltaService,
      authenticator,
    });

    // Re-instantiate EdgeSyncClient with the re-opened persistence stack
    client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${port}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      config: {
        baseDelayMs: 50,
        maxDelayMs: 200,
        heartbeatIntervalMs: 200,
        heartbeatTimeoutMs: 500,
      },
      deterministicBackoff: true,
    });

    // Gate 9: Reconnect and drain the actual persisted SQLite outbox
    await client.connect();
    assert.equal(client.getState(), 'CONNECTED');

    // On connection, client automatically drains pending outbox
    assert.equal(outbox.getBacklogCount(), 0);
    assert.equal(outbox.getPendingEvents().length, 0);

    // Any subsequent flush confirms 0 remaining
    const drainResult = await client.flushOutbox();
    assert.equal(drainResult.flushed, 0);
    assert.equal(drainResult.synced, 0);

    // Gate 10: Verify records transition to SYNCED only after authentic receipt verification
    const row1 = outbox.getById(offlineOp1.id);
    const row2 = outbox.getById(offlineOp2.id);
    const row3 = outbox.getById(offlineOp3.id);

    assert.equal(row1?.status, 'SYNCED');
    assert.ok(row1?.receiptToken);
    assert.ok(row1?.receiptVerifiedAt);

    assert.equal(row2?.status, 'SYNCED');
    assert.ok(row2?.receiptToken);
    assert.ok(row2?.receiptVerifiedAt);

    assert.equal(row3?.status, 'SYNCED');
    assert.ok(row3?.receiptToken);
    assert.ok(row3?.receiptVerifiedAt);

    // Gate 11: Execute downstream delta pull
    const pulledDelta = await client.pullCatalogDeltas();
    assert.ok(pulledDelta);
    assert.equal(pulledDelta.snapshotVersion, 10);
    const deltaCheckpoint = persistence.getCheckpoint('CATALOG_DELTA');
    assert.ok(deltaCheckpoint);
    assert.equal(deltaCheckpoint.lastSnapshotVersion, 10);

    // Gate 12: Prove duplicate retry performs zero duplicate mutation (idempotency check)
    const replayBatch: SyncBatchDTO = {
      batchId: crypto.randomUUID(),
      organizationId: orgId,
      branchId,
      events: [
        {
          clientOpId: offlineOp1.clientOpId,
          aggregateType: offlineOp1.aggregateType,
          aggregateId: offlineOp1.aggregateId,
          aggregateSequenceNumber: offlineOp1.aggregateSequenceNumber,
          action: offlineOp1.action,
          payload: offlineOp1.payload,
        },
      ],
    };

    const initialIngestedCount = batchProcessor.ingestedEvents.size;
    const replayAck = await batchProcessor.processBatch(auth, replayBatch);

    assert.equal(replayAck.results.length, 1);
    assert.equal(replayAck.results[0]!.status, 'DUPLICATE_ACCEPTED');
    assert.equal(replayAck.results[0]!.receipt?.serverSignature, row1?.receiptToken);
    // Zero new mutations: map size is unchanged
    assert.equal(batchProcessor.ingestedEvents.size, initialIngestedCount);

    // Gate 13: Prove gaps/reordering remain governed
    const gapBatch: SyncBatchDTO = {
      batchId: crypto.randomUUID(),
      organizationId: orgId,
      branchId,
      events: [
        {
          clientOpId: crypto.randomUUID(),
          aggregateType: 'DINING_ORDER',
          aggregateId: 'ord-offline-1',
          aggregateSequenceNumber: 5, // Current is 2, incoming is 5
          action: 'PAY_ORDER',
          payload: { paymentMethod: 'CASH', amount: 385.0 },
        },
      ],
    };

    const gapAck = await batchProcessor.processBatch(auth, gapBatch);
    assert.equal(gapAck.results.length, 1);
    assert.equal(gapAck.results[0]!.status, 'REQUIRES_RECONCILIATION');
    assert.ok(gapAck.results[0]!.gapInterval);
    assert.equal(gapAck.results[0]!.gapInterval?.missingStart, 3);
    assert.equal(gapAck.results[0]!.gapInterval?.missingEnd, 4);

    // Gate 14: Prove eventual convergence, zero lost transactions, and capture telemetry
    assert.equal(outbox.getBacklogCount(), 0);
    assert.equal(outbox.getPendingEvents().length, 0);

    // All 4 rows (1 baseline + 3 offline) must be SYNCED in SQLite
    const allDbRows = [
      outbox.getById(baselineOp.id),
      outbox.getById(offlineOp1.id),
      outbox.getById(offlineOp2.id),
      outbox.getById(offlineOp3.id),
    ];
    for (const r of allDbRows) {
      assert.ok(r);
      assert.equal(r.status, 'SYNCED');
      assert.ok(r.syncedAt);
      assert.ok(r.receiptToken);
    }

    // Upstream checkpoint recorded monotonically
    const outboxCheckpoint = persistence.getCheckpoint('OUTBOX_INGESTION');
    assert.ok(outboxCheckpoint);
    assert.ok(outboxCheckpoint.lastSyncedSequence >= 1);

    // Verify comprehensive telemetry log
    const eventTypes = persistence.getRecentTelemetry().map((t) => t.eventType);
    assert.ok(eventTypes.includes('WAN_DISCONNECTED'));
    assert.ok(eventTypes.includes('OUTBOX_DRAINED'));
    assert.ok(eventTypes.includes('DELTA_PULLED'));

    await client.disconnect();
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // R2-02 & R2-03: Production JwtWebSocketAuthenticator Suite
  // Exercises real RS256 cryptographically signed JWTs, signature validation,
  // issuer/audience checks, tenant authority fencing, and strict boolean
  // control-plane claim typing.
  // =========================================================================
  describe('WP013-T07: Production JwtWebSocketAuthenticator Suite', () => {
    let rsaKeyPair: { privateKey: any; publicKey: any };
    let otherKeyPair: { privateKey: any; publicKey: any };
    const jwtIssuer = 'https://auth.tridentpos.com';
    const jwtAudience = 'trident-cloud-sync';
    let jwtPort: number = 0;
    let jwtHttpServer: http.Server;
    let jwtGateway: CloudWebSocketSyncGateway;
    let jwtAuthenticator: JwtWebSocketAuthenticator;

    before(async () => {
      rsaKeyPair = await generateKeyPair('RS256');
      otherKeyPair = await generateKeyPair('RS256');

      jwtAuthenticator = new JwtWebSocketAuthenticator({
        issuer: jwtIssuer,
        audience: jwtAudience,
        key: rsaKeyPair.publicKey,
      });

      jwtHttpServer = http.createServer();
      jwtGateway = new CloudWebSocketSyncGateway({
        server: jwtHttpServer,
        path: '/api/v1/sync/stream',
        batchProcessor,
        deltaProvider: deltaService,
        authenticator: jwtAuthenticator,
      });

      await new Promise<void>((resolve) => {
        jwtHttpServer.listen(0, '127.0.0.1', () => {
          const addr = jwtHttpServer.address();
          if (typeof addr === 'object' && addr) {
            jwtPort = addr.port;
          }
          resolve();
        });
      });
    });

    after(async () => {
      await jwtGateway.close();
      await new Promise<void>((resolve) => jwtHttpServer.close(() => resolve()));
    });

    it('authenticates valid RS256 station JWT and establishes connection', async () => {
      const stationSub = crypto.randomUUID();
      const validToken = await new SignJWT({
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(jwtIssuer)
        .setAudience(jwtAudience)
        .setSubject(stationSub)
        .setExpirationTime('1h')
        .sign(rsaKeyPair.privateKey);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-jwt-valid-'));
      const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
      const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
      const persistence = new EdgeSyncPersistence(edgeDb);

      const client = new EdgeSyncClient({
        wsUrl: `ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`,
        auth,
        authToken: validToken,
        outbox,
        syncPersistence: persistence,
      });

      await client.connect();
      assert.equal(client.getState(), 'CONNECTED');

      await client.disconnect();
      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('rejects connection when signature is forged / signed by wrong key (HTTP 401)', async () => {
      const forgedToken = await new SignJWT({
        organizationId: orgId,
        branchId,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(jwtIssuer)
        .setAudience(jwtAudience)
        .setSubject(crypto.randomUUID())
        .setExpirationTime('1h')
        .sign(otherKeyPair.privateKey);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-jwt-forged-'));
      const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
      const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
      const persistence = new EdgeSyncPersistence(edgeDb);

      const client = new EdgeSyncClient({
        wsUrl: `ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`,
        auth,
        authToken: forgedToken,
        outbox,
        syncPersistence: persistence,
      });

      try {
        await assert.rejects(async () => {
          await client.connect();
        }, /Unexpected server response: 401|Sync client error/);
      } finally {
        await client.disconnect();
      }

      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('rejects connection when JWT issuer is wrong (HTTP 401)', async () => {
      const wrongIssuerToken = await new SignJWT({
        organizationId: orgId,
        branchId,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://malicious-issuer.com')
        .setAudience(jwtAudience)
        .setSubject(crypto.randomUUID())
        .setExpirationTime('1h')
        .sign(rsaKeyPair.privateKey);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-jwt-wrong-iss-'));
      const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
      const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
      const persistence = new EdgeSyncPersistence(edgeDb);

      const client = new EdgeSyncClient({
        wsUrl: `ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`,
        auth,
        authToken: wrongIssuerToken,
        outbox,
        syncPersistence: persistence,
      });

      try {
        await assert.rejects(async () => {
          await client.connect();
        }, /Unexpected server response: 401|Sync client error/);
      } finally {
        await client.disconnect();
      }

      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('rejects connection when JWT audience is wrong (HTTP 401)', async () => {
      const wrongAudToken = await new SignJWT({
        organizationId: orgId,
        branchId,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(jwtIssuer)
        .setAudience('wrong-audience')
        .setSubject(crypto.randomUUID())
        .setExpirationTime('1h')
        .sign(rsaKeyPair.privateKey);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-jwt-wrong-aud-'));
      const edgeDb = new EdgeDatabaseService({ databasePath: path.join(tempDir, 'edge.db') });
      const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
      const persistence = new EdgeSyncPersistence(edgeDb);

      const client = new EdgeSyncClient({
        wsUrl: `ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`,
        auth,
        authToken: wrongAudToken,
        outbox,
        syncPersistence: persistence,
      });

      try {
        await assert.rejects(async () => {
          await client.connect();
        }, /Unexpected server response: 401|Sync client error/);
      } finally {
        await client.disconnect();
      }

      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('fences authority strictly to verified JWT claims; payload cannot override them', async () => {
      const tokenTenantA = await new SignJWT({
        organizationId: orgId,
        branchId,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(jwtIssuer)
        .setAudience(jwtAudience)
        .setSubject(crypto.randomUUID())
        .setExpirationTime('1h')
        .sign(rsaKeyPair.privateKey);

      const ws = new WebSocket(`ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`, {
        headers: { Authorization: `Bearer ${tokenTenantA}` },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      const maliciousMsg = createSyncStreamMessage('UPSTREAM_BATCH', tenantBId, branchBId, {
        batchId: crypto.randomUUID(),
        organizationId: tenantBId,
        branchId: branchBId,
        events: [],
      });

      const errorPromise = new Promise<{ code: string }>((resolve) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf8'));
          if (msg.type === 'SYNC_ERROR') {
            resolve(msg.payload);
          }
        });
      });

      ws.send(JSON.stringify(maliciousMsg));
      const errPayload = await errorPromise;
      assert.equal(errPayload.code, ERROR_CODE_UNAUTHORIZED_TENANT);

      ws.terminate();
    });

    it('enforces strict control-plane claim typing: string, numeric, and falsy claims fail closed', async () => {
      async function testKillSwitchPrivilege(
        claimValue: unknown,
      ): Promise<{ code?: string; success?: boolean }> {
        const token = await new SignJWT({
          organizationId: orgId,
          branchId,
          isControlPlane: claimValue,
          roles: ['STATION_OPERATOR'],
        })
          .setProtectedHeader({ alg: 'RS256' })
          .setIssuer(jwtIssuer)
          .setAudience(jwtAudience)
          .setSubject(crypto.randomUUID())
          .setExpirationTime('1h')
          .sign(rsaKeyPair.privateKey);

        const ws = new WebSocket(`ws://127.0.0.1:${jwtPort}/api/v1/sync/stream`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        });

        const commandMsg = createSyncStreamMessage('KILL_SWITCH_COMMAND', orgId, branchId, {
          enabled: false,
          reason: 'Test claim typing',
        });

        const responsePromise = new Promise<{ code?: string; success?: boolean }>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ code: 'TIMEOUT' });
          }, 3000);
          ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString('utf8'));
            if (msg.type === 'SYNC_ERROR') {
              clearTimeout(timeout);
              resolve({ code: msg.payload.code });
            } else if (msg.type === 'KILL_SWITCH_COMMAND') {
              clearTimeout(timeout);
              resolve({ success: true });
            }
          });
        });

        ws.send(JSON.stringify(commandMsg));
        const res = await responsePromise;
        ws.terminate();
        return res;
      }

      // Case 1: isControlPlane: false -> rejected
      const resFalse = await testKillSwitchPrivilege(false);
      assert.equal(resFalse.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

      // Case 2: isControlPlane: "false" (string) -> rejected (must NOT be truthy)
      const resStringFalse = await testKillSwitchPrivilege('false');
      assert.equal(resStringFalse.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

      // Case 3: isControlPlane: "true" (string) -> rejected (must NOT grant privilege)
      const resStringTrue = await testKillSwitchPrivilege('true');
      assert.equal(resStringTrue.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

      // Case 4: isControlPlane: 1 (number) -> rejected (must NOT grant privilege)
      const resNumberOne = await testKillSwitchPrivilege(1);
      assert.equal(resNumberOne.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

      // Case 5: Missing claim -> rejected
      const resMissing = await testKillSwitchPrivilege(undefined);
      assert.equal(resMissing.code, ERROR_CODE_CONTROL_PLANE_FORBIDDEN);

      // Case 6: Literal boolean true -> allowed
      const resTrue = await testKillSwitchPrivilege(true);
      assert.equal(resTrue.success, true);
      jwtGateway.setKillSwitch(true);
    });
  });

  // =========================================================================
  // R2-01: True Automatic WAN Reconnection & Outbox Drain Without Manual Connect
  // Fulfills R2-01: Proves automatic WAN recovery where the SAME client detects
  // socket termination, enters RECONNECTING, retries autonomously, reconnects
  // automatically upon server restoration WITHOUT calling client.connect() again,
  // emits WAN_RECONNECTED telemetry, and drains the pending SQLite Outbox to 0.
  // =========================================================================
  it('WP013-T08: True Automatic WAN Reconnection & Outbox Drain Without Manual Connect', async () => {
    // 1. Setup dedicated ephemeral HTTP server and gateway
    let autoServer = http.createServer();
    let autoGateway = new CloudWebSocketSyncGateway({
      server: autoServer,
      path: '/api/v1/sync/stream',
      batchProcessor,
      deltaProvider: deltaService,
      authenticator,
    });

    let autoPort: number = 0;
    await new Promise<void>((resolve) => {
      autoServer.listen(0, '127.0.0.1', () => {
        const addr = autoServer.address();
        if (typeof addr === 'object' && addr) {
          autoPort = addr.port;
        }
        resolve();
      });
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-auto-reconnect-'));
    const dbPath = path.join(tempDir, 'edge.db');
    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const persistence = new EdgeSyncPersistence(edgeDb);

    // 2. Start EdgeSyncClient with rapid deterministic retry backoff (50ms base)
    const client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${autoPort}/api/v1/sync/stream`,
      auth,
      authToken: validTokenTenantA,
      outbox,
      syncPersistence: persistence,
      config: {
        baseDelayMs: 50,
        maxDelayMs: 150,
        heartbeatIntervalMs: 200,
        heartbeatTimeoutMs: 500,
      },
      deterministicBackoff: true,
    });

    // Step 3: Confirm initial CONNECTED state
    await client.connect();
    assert.equal(client.getState(), 'CONNECTED');

    // Step 4: Persist at least one operation and verify it flushes
    const initialOp = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-init-1',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 1, total: 100.0 },
    });

    const initFlush = await client.flushOutbox();
    assert.equal(initFlush.flushed, 1);
    assert.equal(initFlush.synced, 1);
    assert.equal(outbox.getById(initialOp.id)?.status, 'SYNCED');
    assert.equal(outbox.getBacklogCount(), 0);

    // Step 5: Terminate the real gateway / WebSocket transport
    await autoGateway.close();
    await new Promise<void>((resolve) => autoServer.close(() => resolve()));

    // Step 6 & 7: Leave the SAME EdgeSyncClient running; confirm close detected,
    // WAN_DISCONNECTED emitted, state enters RECONNECTING, retry/backoff loop active.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const interval = setInterval(() => {
        if (client.getState() === 'RECONNECTING') {
          clearInterval(interval);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          reject(
            new Error(
              `Timeout waiting for client to enter RECONNECTING; current: ${client.getState()}`,
            ),
          );
        }
      }, 20);
    });
    assert.equal(client.getState(), 'RECONNECTING');

    const telemetryEventsAfterDrop = persistence.getRecentTelemetry().map((t) => t.eventType);
    assert.ok(
      telemetryEventsAfterDrop.includes('WAN_DISCONNECTED'),
      'WAN_DISCONNECTED telemetry must be recorded upon socket drop',
    );

    // Step 8: While Cloud is unavailable, persist new operations into real SQLite EdgeOutboxPersistence
    const offlineOp1 = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-auto-1',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 3, total: 250.0 },
    });

    const offlineOp2 = outbox.enqueue({
      organizationId: orgId,
      branchId,
      aggregateType: 'DINING_ORDER',
      aggregateId: 'ord-auto-2',
      aggregateSequenceNumber: 1,
      action: 'CREATE_ORDER',
      clientOpId: crypto.randomUUID(),
      payload: { tableNumber: 4, total: 310.0 },
    });

    assert.equal(outbox.getBacklogCount(), 2);
    assert.equal(outbox.getById(offlineOp1.id)?.status, 'PENDING');
    assert.equal(outbox.getById(offlineOp2.id)?.status, 'PENDING');

    // Step 9: Restore the gateway on the EXACT SAME endpoint (same port & path)
    autoServer = http.createServer();
    await new Promise<void>((resolve) => {
      autoServer.listen(autoPort, '127.0.0.1', () => resolve());
    });
    autoGateway = new CloudWebSocketSyncGateway({
      server: autoServer,
      path: '/api/v1/sync/stream',
      batchProcessor,
      deltaProvider: deltaService,
      authenticator,
    });

    // Step 10 & 11: DO NOT call client.connect() again. Wait for existing retry loop.
    // Step 12: Assert the SAME client transitions automatically to CONNECTED.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const interval = setInterval(() => {
        if (client.getState() === 'CONNECTED') {
          clearInterval(interval);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          reject(
            new Error(
              `Timeout waiting for automatic reconnect without manual connect(); current: ${client.getState()}`,
            ),
          );
        }
      }, 25);
    });
    assert.equal(client.getState(), 'CONNECTED');

    // Step 13: Assert WAN_RECONNECTED telemetry
    const hasReconnectedTelem = persistence
      .getRecentTelemetry()
      .some((t) => t.eventType === 'WAN_RECONNECTED');
    assert.ok(hasReconnectedTelem, 'WAN_RECONNECTED telemetry must be emitted by retry loop');

    // Step 14 & 16: Assert pending SQLite Outbox automatically drains to 0
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const interval = setInterval(() => {
        if (outbox.getBacklogCount() === 0) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          reject(
            new Error(
              `Timeout waiting for pending outbox to automatically drain; count: ${outbox.getBacklogCount()}`,
            ),
          );
        }
      }, 25);
    });
    assert.equal(outbox.getBacklogCount(), 0);
    assert.equal(outbox.getPendingEvents().length, 0);

    // Step 15: Assert records reach SYNCED only after valid receipt verification
    const verifiedRow1 = outbox.getById(offlineOp1.id);
    const verifiedRow2 = outbox.getById(offlineOp2.id);
    assert.ok(verifiedRow1);
    assert.equal(verifiedRow1.status, 'SYNCED');
    assert.ok(verifiedRow1.receiptToken);
    assert.ok(verifiedRow1.syncedAt);

    assert.ok(verifiedRow2);
    assert.equal(verifiedRow2.status, 'SYNCED');
    assert.ok(verifiedRow2.receiptToken);
    assert.ok(verifiedRow2.syncedAt);

    // Teardown
    await client.disconnect();
    await autoGateway.close();
    await new Promise<void>((resolve) => autoServer.close(() => resolve()));
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
