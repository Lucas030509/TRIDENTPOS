/**
 * TRIDENTPOS Repository-Level Integration Test Suite
 * WP-013 / WP-012 Real Cloud Ingestion & Edge Outbox End-to-End Test
 *
 * Location: tests/integration/wp013-sync-e2e.test.mjs
 * Architecture: Neutral test orchestration layer consuming public package exports.
 *
 * Target E2E Path:
 * Real Edge SQLite Outbox
 *   -> EdgeSyncClient (WebSocket)
 *   -> CloudWebSocketSyncGateway
 *   -> real IngestedIdempotencyEngine
 *   -> PostgreSQL 16
 *   -> CloudTransactionReceipt
 *   -> Edge receipt verification
 *   -> SQLite SYNCED
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import dotenv from 'dotenv';

// Load environment variables (DATABASE_URL)
dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

// 1. Consume strictly public package contracts
import { TestCloudReceiptIssuer, TestCloudReceiptVerifier } from '@trident/core/test-support';
import { getPool, migrateUp, IngestedIdempotencyEngine } from '@trident/database';
import {
  CloudWebSocketSyncGateway,
  EdgeSyncClient,
  CallbackWebSocketAuthenticator,
  CloudCatalogDeltaService,
} from '@trident/sync';
import { EdgeDatabaseService, EdgeOutboxPersistence, EdgeSyncPersistence } from '@trident/edge';

/**
 * PostgreSQL batch processor orchestrating real WP-012 IngestedIdempotencyEngine
 */
class PostgreSqlIngestedBatchProcessor {
  #pool;
  #engine;

  constructor(pool, engine) {
    this.#pool = pool;
    this.#engine = engine;
  }

  async processBatch(auth, batch) {
    const results = [];
    const client = await this.#pool.connect();
    try {
      for (const ev of batch.events) {
        await client.query('BEGIN');
        try {
          const res = await this.#engine.processEvent(client, auth, ev, async (c, payload, e) => {
            await c.query(
              `INSERT INTO wp013_test_domain_fixtures (id, organization_id, branch_id, entity_name, value)
                 VALUES ($1, $2, $3, $4, $5)`,
              [
                crypto.randomUUID(),
                auth.organizationId,
                auth.branchId,
                e.aggregateId,
                JSON.stringify(payload),
              ],
            );
            return { success: true, mutatedAt: new Date().toISOString() };
          });
          await client.query('COMMIT');

          if (res.status === 'APPLIED') {
            results.push({
              clientOpId: ev.clientOpId,
              aggregateType: ev.aggregateType,
              aggregateId: ev.aggregateId,
              aggregateSequenceNumber: ev.aggregateSequenceNumber,
              status: 'APPLIED',
              receipt: res.receipt ?? undefined,
            });
          } else if (res.status === 'DUPLICATE_ACCEPTED') {
            results.push({
              clientOpId: ev.clientOpId,
              aggregateType: ev.aggregateType,
              aggregateId: ev.aggregateId,
              aggregateSequenceNumber: ev.aggregateSequenceNumber,
              status: 'DUPLICATE_ACCEPTED',
              receipt: res.receipt ?? undefined,
            });
          } else if (res.status === 'REQUIRES_RECONCILIATION') {
            results.push({
              clientOpId: ev.clientOpId,
              aggregateType: ev.aggregateType,
              aggregateId: ev.aggregateId,
              aggregateSequenceNumber: ev.aggregateSequenceNumber,
              status: 'REQUIRES_RECONCILIATION',
              gapInterval: res.gapInterval
                ? {
                    expectedSequence: res.gapInterval.from,
                    incomingSequence: ev.aggregateSequenceNumber,
                    missingStart: res.gapInterval.from,
                    missingEnd: res.gapInterval.to,
                  }
                : undefined,
            });
          }
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      client.release();
    }
    return {
      batchId: batch.batchId ?? crypto.randomUUID(),
      organizationId: auth.organizationId,
      branchId: auth.branchId,
      results,
    };
  }
}

describe('TRIDENTPOS WP-013 / WP-012 Cross-Package Integration E2E Suite', () => {
  const pool = getPool();
  const tenantAId = crypto.randomUUID();
  const branchA1Id = crypto.randomUUID();

  before(async () => {
    // Ensure migrations are current
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP013 E2E Org A', 'E2E Org A', 'TAX-WP013-E2E-${tenantAId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchA1Id}', '${tenantAId}', 'BR-013-E2E-A1', 'Branch 013 E2E A1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS wp013_test_domain_fixtures (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id),
          branch_id UUID NOT NULL,
          entity_name VARCHAR(100) NOT NULL,
          value VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT fk_wp013_test_domain_fixtures_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
        );
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS wp013_test_domain_fixtures;
        DELETE FROM ingested_idempotency_log WHERE organization_id = '${tenantAId}';
        DELETE FROM aggregate_sequences WHERE organization_id = '${tenantAId}';
        DELETE FROM reordering_buffer_queue WHERE organization_id = '${tenantAId}';
        DELETE FROM branches WHERE organization_id = '${tenantAId}';
        DELETE FROM organizations WHERE id = '${tenantAId}';
      `);
    } finally {
      client.release();
    }
  });

  it('WP013-E2E-01: Real WP-012 Cloud Ingestion E2E with PostgreSQL, receipts, and idempotency', async () => {
    const testIssuer = new TestCloudReceiptIssuer();
    const testVerifier = new TestCloudReceiptVerifier();
    const engine = new IngestedIdempotencyEngine(testIssuer);
    const dbBatchProcessor = new PostgreSqlIngestedBatchProcessor(pool, engine);

    const testHttpServer = http.createServer();
    const authenticator = new CallbackWebSocketAuthenticator((req) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
      return {
        organizationId: tenantAId,
        branchId: branchA1Id,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      };
    });

    const testGateway = new CloudWebSocketSyncGateway({
      server: testHttpServer,
      path: '/api/v1/sync/stream',
      batchProcessor: dbBatchProcessor,
      deltaProvider: new CloudCatalogDeltaService(),
      authenticator,
    });

    let wsPort = 0;
    await new Promise((resolve) => {
      testHttpServer.listen(0, '127.0.0.1', () => {
        const addr = testHttpServer.address();
        if (typeof addr === 'object' && addr) {
          wsPort = addr.port;
        }
        resolve();
      });
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp013-e2e-pg-'));
    const databasePath = path.join(tempDir, 'test-edge-e2e.db');
    const edgeDb = new EdgeDatabaseService({ databasePath, verbose: false });
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const syncPersist = new EdgeSyncPersistence(edgeDb);

    const client = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${wsPort}/api/v1/sync/stream`,
      auth: {
        organizationId: tenantAId,
        branchId: branchA1Id,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      },
      authToken: 'mock-valid-token',
      outbox,
      syncPersistence: syncPersist,
      deterministicBackoff: true,
    });

    try {
      await client.connect();
      assert.equal(client.getState(), 'CONNECTED');

      // 1. First operation: enqueue to real SQLite outbox and flush to real PostgreSQL
      const op1 = outbox.enqueue({
        organizationId: tenantAId,
        branchId: branchA1Id,
        clientOpId: crypto.randomUUID(),
        aggregateType: 'ORDER',
        aggregateId: 'ord-e2e-real-1',
        aggregateSequenceNumber: 1,
        action: 'CREATE_ORDER',
        payload: { tableNumber: 8, total: 350.0 },
      });

      const flush1 = await client.flushOutbox();
      assert.equal(flush1.flushed, 1);
      assert.equal(flush1.synced, 1);

      // Verify row reached SYNCED in SQLite with authentic receipt
      const row1 = outbox.getById(op1.id);
      assert.ok(row1);
      assert.equal(row1.status, 'SYNCED');
      assert.ok(row1.receiptToken);
      assert.ok(row1.syncedAt);

      // Verify PostgreSQL: domain table mutated once
      const pgMutations = await pool.query(
        `SELECT count(*)::int AS count FROM wp013_test_domain_fixtures WHERE organization_id = $1 AND entity_name = $2`,
        [tenantAId, 'ord-e2e-real-1'],
      );
      assert.equal(pgMutations.rows[0].count, 1, 'First operation mutates once in PostgreSQL');

      // Verify aggregate_sequences table updated to sequence 1
      const seqCheck = await pool.query(
        `SELECT current_sequence_number FROM aggregate_sequences WHERE organization_id = $1 AND aggregate_id = $2`,
        [tenantAId, 'ord-e2e-real-1'],
      );
      assert.equal(Number(seqCheck.rows[0].current_sequence_number), 1);

      // Verify ingested_idempotency_log has recorded APPLIED
      const logCheck = await pool.query(
        `SELECT status, client_op_id, receipt_token, receipt_payload FROM ingested_idempotency_log WHERE organization_id = $1 AND client_op_id = $2`,
        [tenantAId, op1.clientOpId],
      );
      assert.equal(logCheck.rows.length, 1);
      assert.equal(logCheck.rows[0].status, 'APPLIED');
      assert.ok(logCheck.rows[0].receipt_token);
      assert.equal(logCheck.rows[0].receipt_payload.serverSignature, row1.receiptToken);

      // 2 & 3. Duplicate replay: send identical clientOpId and sequence 1
      const dupBatch = {
        batchId: crypto.randomUUID(),
        organizationId: tenantAId,
        branchId: branchA1Id,
        events: [
          {
            clientOpId: op1.clientOpId,
            aggregateType: 'ORDER',
            aggregateId: 'ord-e2e-real-1',
            aggregateSequenceNumber: 1,
            action: 'CREATE_ORDER',
            payload: { tableNumber: 8, total: 350.0 },
          },
        ],
      };

      const dupAck = await dbBatchProcessor.processBatch(
        { organizationId: tenantAId, branchId: branchA1Id },
        dupBatch,
      );
      assert.equal(dupAck.results.length, 1);
      assert.equal(dupAck.results[0].status, 'DUPLICATE_ACCEPTED');

      // Duplicate causes ZERO second mutation in PostgreSQL
      const pgMutationsAfterDup = await pool.query(
        `SELECT count(*)::int AS count FROM wp013_test_domain_fixtures WHERE organization_id = $1 AND entity_name = $2`,
        [tenantAId, 'ord-e2e-real-1'],
      );
      assert.equal(
        pgMutationsAfterDup.rows[0].count,
        1,
        'Duplicate replay causes zero second mutation in PostgreSQL',
      );

      // 4. Persisted original receipt is returned
      assert.equal(dupAck.results[0].receipt?.serverSignature, row1.receiptToken);

      // 5. Edge marks row SYNCED (already verified, and backlog count is 0)
      assert.equal(outbox.getBacklogCount(), 0);
      assert.equal(outbox.getPendingEvents().length, 0);

      // 6. Sequence gap returns governed reconciliation result
      const gapBatch = {
        batchId: crypto.randomUUID(),
        organizationId: tenantAId,
        branchId: branchA1Id,
        events: [
          {
            clientOpId: crypto.randomUUID(),
            aggregateType: 'ORDER',
            aggregateId: 'ord-e2e-real-1',
            aggregateSequenceNumber: 3, // Gap: sequence 2 missing
            action: 'UPDATE_ORDER',
            payload: { tableNumber: 8, status: 'SERVED' },
          },
        ],
      };

      const gapAck = await dbBatchProcessor.processBatch(
        { organizationId: tenantAId, branchId: branchA1Id },
        gapBatch,
      );
      assert.equal(gapAck.results.length, 1);
      assert.equal(gapAck.results[0].status, 'REQUIRES_RECONCILIATION');
      assert.ok(gapAck.results[0].gapInterval);
      assert.equal(gapAck.results[0].gapInterval.expectedSequence, 2);
      assert.equal(gapAck.results[0].gapInterval.incomingSequence, 3);
      assert.equal(gapAck.results[0].gapInterval.missingStart, 2);
      assert.equal(gapAck.results[0].gapInterval.missingEnd, 2);
    } finally {
      await client.disconnect();
      await testGateway.close();
      await new Promise((r) => testHttpServer.close(() => r()));
      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
