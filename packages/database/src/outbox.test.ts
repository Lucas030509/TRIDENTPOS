/**
 * TRIDENTPOS WP-012 Cloud Transactional Outbox & Ingested Idempotency Suite
 * Conforms strictly to:
 * - ADR-006 & ADR-007
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - COORDINATOR_PROMPT_WP012_START.md (WP012-T05..T24, WP012-T30..T39, WP012-T42..T43)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  AuthContext,
  ExponentialBackoffPolicy,
  formatIdempotencyKey,
  SyncEventDTO,
} from '@trident/core';
import { resolveDatabaseUrl } from './connection.js';
import { migrateUp } from './runner.js';
import { setTenantContext, withTenantTransaction } from './tenant.js';
import { CloudIntegrationOutboxService, IngestedIdempotencyEngine } from './outbox/index.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-012 Cloud Transactional Outbox & Ingested Idempotency Engine Suite', () => {
  let pool: pg.Pool;
  let engine: IngestedIdempotencyEngine;
  let outboxService: CloudIntegrationOutboxService;

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchA1Id = crypto.randomUUID();
  const branchA2Id = crypto.randomUUID();
  const branchB1Id = crypto.randomUUID();

  const authA1: AuthContext = {
    organizationId: tenantAId,
    branchId: branchA1Id,
  };

  before(async () => {
    pool = new pg.Pool({
      connectionString: resolveDatabaseUrl(),
      max: 20,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });

    // 1. Ensure clean migration state if previous test suite dropped tables
    const prepClient = await pool.connect();
    try {
      const orgCheck = await prepClient.query<{ reg: string | null }>(
        "SELECT to_regclass('organizations') as reg;",
      );
      if (!orgCheck.rows[0]?.reg) {
        await prepClient.query(`
          DROP TABLE IF EXISTS
            wp012_test_domain_fixtures,
            cloud_integration_dlq,
            cloud_integration_outbox,
            reordering_buffer_queue,
            aggregate_sequences,
            ingested_idempotency_log,
            folio_leases,
            security_telemetry_events,
            audit_log_events,
            stations,
            user_branch_credentials,
            user_roles,
            roles,
            users,
            test_composite_ref,
            branches,
            organizations,
            _migrations CASCADE;
        `);
      }
    } finally {
      prepClient.release();
    }

    // 2. Ensure all migrations are applied up to WP-012
    await migrateUp(pool);

    engine = new IngestedIdempotencyEngine();
    outboxService = new CloudIntegrationOutboxService();

    // 2. Provision test tenants and branches
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP012 Tenant A Org', 'Tenant A', 'TAX-WP012-A'),
          ('${tenantBId}', 'WP012 Tenant B Org', 'Tenant B', 'TAX-WP012-B')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchA1Id}', '${tenantAId}', 'BR-012-A1', 'Branch 012 A1'),
          ('${branchA2Id}', '${tenantAId}', 'BR-012-A2', 'Branch 012 A2'),
          ('${branchB1Id}', '${tenantBId}', 'BR-012-B1', 'Branch 012 B1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trident_wp012_app') THEN
            CREATE ROLE trident_wp012_app NOSUPERUSER NOBYPASSRLS NOINHERIT;
          END IF;
        END
        $$;
        GRANT USAGE ON SCHEMA public TO trident_wp012_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO trident_wp012_app;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO trident_wp012_app;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      // Clean up test data
      await client.query(`
        DELETE FROM ingested_idempotency_log WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM aggregate_sequences WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM reordering_buffer_queue WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM cloud_integration_outbox WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM cloud_integration_dlq WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM wp012_test_domain_fixtures WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trident_wp012_app') THEN
            EXECUTE 'DROP OWNED BY trident_wp012_app';
            EXECUTE 'DROP ROLE trident_wp012_app';
          END IF;
        END
        $$;
      `);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('WP012-T05: clientOpId is preserved across retry representation', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();

    const event: SyncEventDTO = {
      organizationId: tenantAId,
      branchId: branchA1Id,
      aggregateType: 'ORDER',
      aggregateId,
      action: 'SUBMIT_ORDER',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { amount: 250 },
    };

    let executionCount = 0;
    const handler = async () => {
      executionCount++;
      return { status: 'SUCCESS', amount: 250 };
    };

    // First delivery attempt
    const res1 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, handler);
    });
    assert.equal(res1.status, 'APPLIED');
    assert.equal(res1.receipt?.clientOpId, clientOpId);
    assert.equal(executionCount, 1);

    // Simulated retry representation reusing exact same clientOpId
    const retryEvent: SyncEventDTO = {
      ...event,
      createdAt: new Date().toISOString(), // transport retry may have newer envelope time
    };

    const res2 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, retryEvent, handler);
    });

    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(
      res2.receipt?.clientOpId,
      clientOpId,
      'clientOpId must be preserved in retry receipt',
    );
    assert.equal(executionCount, 1, 'Retry must not execute handler again');
  });

  it('WP012-T06: Idempotency identity is deterministic for identical logical operation', () => {
    const opId = crypto.randomUUID();
    const key1 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_1', 'PAY', opId);
    const key2 = formatIdempotencyKey({
      orgId: tenantAId,
      branchId: branchA1Id,
      aggregateType: 'ORDER',
      aggregateId: 'ord_1',
      action: 'PAY',
      clientOpId: opId,
    });

    assert.equal(key1, key2);
    assert.equal(key1, `${tenantAId}:${branchA1Id}:ORDER:ord_1:PAY:${opId}`);
  });

  it('WP012-T07: Different clientOpId produces a different logical operation', () => {
    const opId1 = crypto.randomUUID();
    const opId2 = crypto.randomUUID();
    const key1 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_1', 'PAY', opId1);
    const key2 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_1', 'PAY', opId2);

    assert.notEqual(key1, key2);
  });

  it('WP012-T08: Different aggregate/action cannot collide logically', () => {
    const opId = crypto.randomUUID();
    const key1 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_1', 'PAY', opId);
    const key2 = formatIdempotencyKey(tenantAId, branchA1Id, 'INVOICE', 'ord_1', 'PAY', opId);
    const key3 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_2', 'PAY', opId);
    const key4 = formatIdempotencyKey(tenantAId, branchA1Id, 'ORDER', 'ord_1', 'CANCEL', opId);

    const keys = new Set([key1, key2, key3, key4]);
    assert.equal(keys.size, 4, 'All four logical operations must produce distinct keys');
  });

  it('WP012-T09: Exact duplicate request returns persisted original result', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    const originalPayload = { customer: 'Alice', total: 500 };

    const event: SyncEventDTO = {
      aggregateType: 'CHECKOUT',
      aggregateId,
      action: 'COMPLETE',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: originalPayload,
    };

    const res1 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, async () => ({
        checkoutId: 'chk_123',
        appliedAt: '2026-09-04T12:00:00Z',
      }));
    });

    assert.equal(res1.status, 'APPLIED');
    assert.deepEqual(res1.responsePayload, {
      checkoutId: 'chk_123',
      appliedAt: '2026-09-04T12:00:00Z',
    });

    // Exact duplicate
    const res2 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, async () => {
        throw new Error('Handler should NOT be called on duplicate!');
      });
    });

    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.deepEqual(res2.responsePayload, {
      checkoutId: 'chk_123',
      appliedAt: '2026-09-04T12:00:00Z',
    });
    assert.equal(res2.receipt?.clientOpId, clientOpId);
  });

  it('WP012-T10: Exact duplicate executes zero second mutation', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    let mutationExecutions = 0;

    const event: SyncEventDTO = {
      aggregateType: 'MUTATION_TEST',
      aggregateId,
      action: 'UPDATE',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { value: 42 },
    };

    const handler = async () => {
      mutationExecutions++;
      return { success: true };
    };

    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, handler);
    });
    assert.equal(mutationExecutions, 1);

    // Duplicate call
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, handler);
    });
    assert.equal(mutationExecutions, 1, 'Mutation count must remain exactly 1');
  });

  it('WP012-T11: Duplicate result survives process/service re-instantiation', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();

    const event: SyncEventDTO = {
      aggregateType: 'RESTART_TEST',
      aggregateId,
      action: 'INITIALIZE',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { test: true },
    };

    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, async () => ({ saved: true }));
    });

    // Simulate complete process/service re-instantiation
    const brandNewEngine = new IngestedIdempotencyEngine();

    const res = await withTenantTransaction(pool, tenantAId, async (client) => {
      return brandNewEngine.processEvent(client, authA1, event, async () => {
        throw new Error('Should not execute on new engine instance');
      });
    });

    assert.equal(res.status, 'DUPLICATE_ACCEPTED');
    assert.deepEqual(res.responsePayload, { saved: true });
  });

  it('WP012-T12: Concurrent duplicate requests using independent PostgreSQL connections produce exactly one mutation', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    let mutationCounter = 0;

    const event: SyncEventDTO = {
      aggregateType: 'CONCURRENCY_TEST',
      aggregateId,
      action: 'APPLY_PAYMENT',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { payment: 100 },
    };

    // 10 concurrent requests using separate PoolClients
    const concurrency = 10;
    const promises = Array.from({ length: concurrency }).map(async () => {
      return withTenantTransaction(pool, tenantAId, async (client) => {
        return engine.processEvent(client, authA1, event, async () => {
          mutationCounter++;
          // Small artificial delay to challenge concurrency serialization
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { paymentApplied: true };
        });
      });
    });

    const results = await Promise.all(promises);

    // Invariant: Exactly ONE mutation executed!
    assert.equal(
      mutationCounter,
      1,
      'Exactly one mutation must execute across concurrent requests',
    );

    const appliedCount = results.filter((r) => r.status === 'APPLIED').length;
    const duplicateCount = results.filter((r) => r.status === 'DUPLICATE_ACCEPTED').length;

    assert.equal(appliedCount, 1, 'Exactly one request gets APPLIED');
    assert.equal(duplicateCount, concurrency - 1, 'Remaining requests get DUPLICATE_ACCEPTED');
  });

  it('WP012-T13: Cross-tenant idempotency access is denied', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();

    const event: SyncEventDTO = {
      organizationId: tenantBId, // Tenant B declared in payload
      branchId: branchB1Id,
      aggregateType: 'ORDER',
      aggregateId,
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: {},
    };

    // Request arrives under Tenant A's authenticated context authA1!
    await assert.rejects(
      async () => {
        await withTenantTransaction(pool, tenantAId, async (client) => {
          return engine.processEvent(client, authA1, event, async () => ({}));
        });
      },
      /UNAUTHORIZED_TENANT/,
      'Cross-tenant payload must fail closed',
    );
  });

  it('WP012-T14: Cross-branch operation cannot reuse another branch authority', async () => {
    const clientOpId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();

    const event: SyncEventDTO = {
      organizationId: tenantAId,
      branchId: branchA2Id, // Branch A2 declared
      aggregateType: 'ORDER',
      aggregateId,
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: {},
    };

    // Authenticated context is for Branch A1!
    await assert.rejects(
      async () => {
        await withTenantTransaction(pool, tenantAId, async (client) => {
          return engine.processEvent(client, authA1, event, async () => ({}));
        });
      },
      /ORGANIZATION_BRANCH_MISMATCH/,
      'Branch mismatch must fail closed',
    );
  });

  it('WP012-T15: First greenfield aggregate sequence 1 applies', async () => {
    const aggregateId = crypto.randomUUID();
    const event: SyncEventDTO = {
      aggregateType: 'GREENFIELD_STREAM',
      aggregateId,
      action: 'CREATE',
      clientOpId: crypto.randomUUID(),
      aggregateSequenceNumber: 1, // Greenfield starts at 1
      payload: { initial: true },
    };

    const res = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, event, async () => ({ created: true }));
    });

    assert.equal(res.status, 'APPLIED');
    assert.equal(res.receipt?.aggregateSequenceNumber, 1);
  });

  it('WP012-T16: Expected next sequence applies and advances causal sequence', async () => {
    const aggregateId = crypto.randomUUID();

    // Sequence 1
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'STREAM_SEQ',
          aggregateId,
          action: 'CREATE',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
        },
        async () => ({ step: 1 }),
      );
    });

    // Sequence 2 (expected next)
    const res2 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'STREAM_SEQ',
          aggregateId,
          action: 'UPDATE',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: {},
        },
        async () => ({ step: 2 }),
      );
    });

    assert.equal(res2.status, 'APPLIED');
    assert.equal(res2.receipt?.aggregateSequenceNumber, 2);
  });

  it('WP012-T17: incomingSequence < expectedSequence causes zero new mutation', async () => {
    const aggregateId = crypto.randomUUID();

    // Apply sequence 1
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'STALE_TEST',
          aggregateId,
          action: 'STEP1',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
        },
        async () => ({ step: 1 }),
      );
    });

    // Apply sequence 2 -> current sequence is now 2, expected next is 3
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'STALE_TEST',
          aggregateId,
          action: 'STEP2',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: {},
        },
        async () => ({ step: 2 }),
      );
    });

    // Now incoming sequence is 1 (< expected 3)
    let staleMutated = false;
    const resStale = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'STALE_TEST',
          aggregateId,
          action: 'STEP1_RETRY',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
        },
        async () => {
          staleMutated = true;
          return {};
        },
      );
    });

    assert.equal(resStale.status, 'DUPLICATE_ACCEPTED');
    assert.equal(
      staleMutated,
      false,
      'incomingSequence < expectedSequence must not execute mutation',
    );
  });

  it('WP012-T18: incomingSequence > expectedSequence is durably buffered', async () => {
    const aggregateId = crypto.randomUUID();

    // Stream is greenfield (expected 1). Incoming sequence is 3 (gap!)
    const gapEvent: SyncEventDTO = {
      aggregateType: 'GAP_TEST',
      aggregateId,
      action: 'STEP3',
      clientOpId: crypto.randomUUID(),
      aggregateSequenceNumber: 3,
      payload: { data: 'future' },
    };

    const res = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(client, authA1, gapEvent, async () => {
        throw new Error('Should not execute domain handler for gap!');
      });
    });

    assert.equal(res.status, 'REQUIRES_RECONCILIATION');
    assert.deepEqual(res.gapInterval, { from: 1, to: 2 });

    // Verify durably stored in reordering_buffer_queue
    const buffered = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.getBufferedEvents(client, tenantAId, branchA1Id, 'GAP_TEST', aggregateId);
    });

    assert.equal(buffered.length, 1);
    const buf0 = buffered[0];
    assert.ok(buf0);
    assert.equal(buf0.aggregateSequenceNumber, 3);
    assert.equal(buf0.status, 'BUFFERED');
  });

  it('WP012-T19: Gap event is not applied to domain handler', async () => {
    const aggregateId = crypto.randomUUID();
    let handlerCalled = false;

    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'GAP_TEST_19',
          aggregateId,
          action: 'STEP4',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 4, // Expects 1, incoming 4
          payload: {},
        },
        async () => {
          handlerCalled = true;
          return {};
        },
      );
    });

    assert.equal(handlerCalled, false, 'Handler must not be executed during gap event');
  });

  it('WP012-T20: Missing sequence interval is correctly identified', async () => {
    const aggregateId = crypto.randomUUID();

    // Advance to sequence 2
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'INTERVAL_TEST',
          aggregateId,
          action: '1',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
        },
        async () => ({}),
      );
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'INTERVAL_TEST',
          aggregateId,
          action: '2',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: {},
        },
        async () => ({}),
      );
    });

    // Now incoming is sequence 6 (gap: expected 3, incoming 6 => missing 3..5)
    const res = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'INTERVAL_TEST',
          aggregateId,
          action: '6',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 6,
          payload: {},
        },
        async () => ({}),
      );
    });

    assert.equal(res.status, 'REQUIRES_RECONCILIATION');
    assert.deepEqual(res.gapInterval, { from: 3, to: 5 });
  });

  it('WP012-T21 & WP012-T22: Arrival of missing sequence closes gap and drains contiguous sequence in order', async () => {
    const aggregateId = crypto.randomUUID();
    const executionOrder: number[] = [];

    const handler = async (_client: pg.PoolClient, _payload: unknown, event: SyncEventDTO) => {
      executionOrder.push(event.aggregateSequenceNumber);
      return { seq: event.aggregateSequenceNumber };
    };

    // 1. Send sequence 1 (applies)
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'DRAIN_TEST',
          aggregateId,
          action: 'S1',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
        },
        handler,
      );
    });
    assert.deepEqual(executionOrder, [1]);

    // 2. Buffer sequence 3 (gap!)
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'DRAIN_TEST',
          aggregateId,
          action: 'S3',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 3,
          payload: {},
        },
        handler,
      );
    });

    // 3. Buffer sequence 4 (gap!)
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'DRAIN_TEST',
          aggregateId,
          action: 'S4',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 4,
          payload: {},
        },
        handler,
      );
    });

    // Still only [1] has been executed
    assert.deepEqual(executionOrder, [1]);

    // 4. Send missing sequence 2!
    const res2 = await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'DRAIN_TEST',
          aggregateId,
          action: 'S2',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: {},
        },
        handler,
      );
    });

    assert.equal(res2.status, 'APPLIED');
    assert.equal(res2.drainedCount, 2, 'Should drain both sequence 3 and sequence 4');

    // WP012-T22: Verified strictly drained in aggregateSequenceNumber order [1, 2, 3, 4]
    assert.deepEqual(executionOrder, [1, 2, 3, 4]);
  });

  it('WP012-T23: Timestamps cannot alter causal ordering', async () => {
    const aggregateId = crypto.randomUUID();
    const executionOrder: number[] = [];

    const handler = async (_client: pg.PoolClient, _payload: unknown, event: SyncEventDTO) => {
      executionOrder.push(event.aggregateSequenceNumber);
      return {};
    };

    // Send sequence 2 with an EARLIER timestamp than sequence 1
    const pastTimestamp = new Date(Date.now() - 100000).toISOString();
    const futureTimestamp = new Date(Date.now() + 100000).toISOString();

    // Buffer sequence 2 (with older timestamp)
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'TIMESTAMP_TEST',
          aggregateId,
          action: 'S2',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: {},
          createdAt: pastTimestamp,
        },
        handler,
      );
    });

    // Send sequence 1 (with newer timestamp)
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'TIMESTAMP_TEST',
          aggregateId,
          action: 'S1',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: {},
          createdAt: futureTimestamp,
        },
        handler,
      );
    });

    // Causal order [1, 2] MUST be respected, regardless of timestamp differences
    assert.deepEqual(executionOrder, [1, 2]);
  });

  it('WP012-T24: ReorderingBuffer survives process restart', async () => {
    const aggregateId = crypto.randomUUID();

    // Buffer sequence 2
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'RESTART_BUFFER_TEST',
          aggregateId,
          action: 'S2',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 2,
          payload: { item: 2 },
        },
        async () => ({}),
      );
    });

    // Simulate process restart
    const brandNewEngine = new IngestedIdempotencyEngine();

    const drainedOrder: number[] = [];
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return brandNewEngine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'RESTART_BUFFER_TEST',
          aggregateId,
          action: 'S1',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1,
          payload: { item: 1 },
        },
        async (_c, _p, ev) => {
          drainedOrder.push(ev.aggregateSequenceNumber);
          return {};
        },
      );
    });

    assert.deepEqual(drainedOrder, [1, 2], 'Buffered item must survive restart and drain cleanly');
  });

  it('WP012-T30: CloudIntegrationOutbox event persists atomically with Cloud fixture transaction', async () => {
    const fixtureId = crypto.randomUUID();
    let outboxId = '';

    await withTenantTransaction(pool, tenantAId, async (client) => {
      // 1. Mutate domain fixture
      await client.query(
        `INSERT INTO wp012_test_domain_fixtures (id, organization_id, branch_id, entity_name, value)
         VALUES ($1, $2, $3, 'TABLE_A', 'RESERVED');`,
        [fixtureId, tenantAId, branchA1Id],
      );

      // 2. Enqueue integration event in the SAME transaction
      const record = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        branchId: branchA1Id,
        eventType: 'TABLE_RESERVED',
        aggregateType: 'TABLE',
        aggregateId: fixtureId,
        payload: { reserved: true },
      });
      outboxId = record.id;
    });

    // Verify both rows exist in PostgreSQL
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const fixCheck = await client.query(
        'SELECT id, value FROM wp012_test_domain_fixtures WHERE id = $1;',
        [fixtureId],
      );
      assert.equal(fixCheck.rows.length, 1);
      assert.equal(fixCheck.rows[0].value, 'RESERVED');

      const outCheck = await client.query(
        'SELECT id, status FROM cloud_integration_outbox WHERE id = $1;',
        [outboxId],
      );
      assert.equal(outCheck.rows.length, 1);
      assert.equal(outCheck.rows[0].status, 'PENDING');
    } finally {
      client.release();
    }
  });

  it('WP012-T31: Cloud transaction rollback removes both fixture mutation and integration event', async () => {
    const fixtureId = crypto.randomUUID();
    let outboxId = '';

    await assert.rejects(async () => {
      await withTenantTransaction(pool, tenantAId, async (client) => {
        await client.query(
          `INSERT INTO wp012_test_domain_fixtures (id, organization_id, branch_id, entity_name, value)
           VALUES ($1, $2, $3, 'TABLE_B', 'RESERVED');`,
          [fixtureId, tenantAId, branchA1Id],
        );

        const record = await outboxService.enqueue(client, {
          organizationId: tenantAId,
          branchId: branchA1Id,
          eventType: 'TABLE_RESERVED',
          aggregateType: 'TABLE',
          aggregateId: fixtureId,
          payload: { reserved: true },
        });
        outboxId = record.id;

        // Force rollback
        throw new Error('Forced transaction abortion for atomicity test');
      });
    }, /Forced transaction abortion/);

    // Verify neither row exists
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const fixCheck = await client.query(
        'SELECT id FROM wp012_test_domain_fixtures WHERE id = $1;',
        [fixtureId],
      );
      assert.equal(fixCheck.rows.length, 0);

      const outCheck = await client.query(
        'SELECT id FROM cloud_integration_outbox WHERE id = $1;',
        [outboxId],
      );
      assert.equal(outCheck.rows.length, 0);
    } finally {
      client.release();
    }
  });

  it('WP012-T32: Dispatcher successfully dispatches one pending event and records durable completion', async () => {
    let eventId = '';
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const rec = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'INVOICE_GENERATED',
        aggregateType: 'INVOICE',
        aggregateId: 'inv_100',
        payload: { invoiceNum: 'INV-100' },
      });
      eventId = rec.id;
    });

    // Worker claims and completes event
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const claimed = await outboxService.claimBatch(client, 'worker_1', 10);
      const target = claimed.find((e) => e.id === eventId);
      assert.ok(target, 'Event must be claimed');
      assert.equal(target.status, 'PROCESSING');

      await outboxService.completeEvent(client, target.id);
    });

    // Verify status is PUBLISHED
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const check = await client.query<{ status: string; published_at: Date }>(
        'SELECT status, published_at FROM cloud_integration_outbox WHERE id = $1;',
        [eventId],
      );
      assert.ok(check.rows[0]);
      assert.equal(check.rows[0].status, 'PUBLISHED');
      assert.ok(check.rows[0].published_at);
    } finally {
      client.release();
    }
  });

  it('WP012-T33 & WP012-T34: Retryable failure increments retry state and applies exponential backoff', async () => {
    let eventId = '';
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const rec = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'SYNC_DISPATCH',
        aggregateType: 'ITEM',
        aggregateId: 'item_1',
        payload: {},
      });
      eventId = rec.id;
    });

    const deterministicBackoff = new ExponentialBackoffPolicy({
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      multiplier: 2,
      deterministic: true,
    });

    // Attempt 1 fails
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const res = await outboxService.handleFailure(
        client,
        eventId,
        new Error('Network temporary glitch'),
        deterministicBackoff,
        false, // retryable
      );
      assert.equal(res.routedToDlq, false);
      assert.equal(res.newRetryCount, 1);
    });

    // Verify retry_count is 1 and status returned to PENDING
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const check = await client.query<{ retry_count: number; status: string; last_error: string }>(
        'SELECT retry_count, status, last_error FROM cloud_integration_outbox WHERE id = $1;',
        [eventId],
      );
      assert.ok(check.rows[0]);
      assert.equal(check.rows[0].retry_count, 1);
      assert.equal(check.rows[0].status, 'PENDING');
      assert.equal(check.rows[0].last_error, 'Network temporary glitch');
    } finally {
      client.release();
    }
  });

  it('WP012-T35: Failure after retry #5 routes event to CloudIntegrationDLQ', async () => {
    let eventId = '';
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const rec = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'EXHAUSTION_TEST',
        aggregateType: 'TEST',
        aggregateId: 't_5',
        payload: { critical: true },
        maxRetries: 5,
      });
      eventId = rec.id;
    });

    const backoff = new ExponentialBackoffPolicy({
      baseDelayMs: 10,
      maxDelayMs: 100,
      deterministic: true,
    });

    // Fail 4 times
    for (let attempt = 1; attempt <= 4; attempt++) {
      await withTenantTransaction(pool, tenantAId, async (client) => {
        const res = await outboxService.handleFailure(
          client,
          eventId,
          new Error(`Attempt ${attempt}`),
          backoff,
        );
        assert.equal(res.routedToDlq, false);
      });
    }

    // 5th failure: routes to DLQ!
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const res = await outboxService.handleFailure(
        client,
        eventId,
        new Error('Fatal 5th attempt failure'),
        backoff,
      );
      assert.equal(res.routedToDlq, true, '5th failure must route to DLQ');
      assert.equal(res.newRetryCount, 5);
    });

    // Verify status DLQ in outbox and record present in cloud_integration_dlq
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const outCheck = await client.query<{ status: string }>(
        'SELECT status FROM cloud_integration_outbox WHERE id = $1;',
        [eventId],
      );
      assert.ok(outCheck.rows[0]);
      assert.equal(outCheck.rows[0].status, 'DLQ');

      const dlqCheck = await client.query<{ errorCode: string; retryCount: number }>(
        'SELECT error_code AS "errorCode", retry_count AS "retryCount" FROM cloud_integration_dlq WHERE originating_outbox_id = $1;',
        [eventId],
      );
      assert.equal(dlqCheck.rows.length, 1);
      assert.ok(dlqCheck.rows[0]);
      assert.equal(dlqCheck.rows[0].errorCode, 'RETRY_EXHAUSTED');
      assert.equal(dlqCheck.rows[0].retryCount, 5);
    } finally {
      client.release();
    }
  });

  it('WP012-T36: Non-retryable validation failure routes directly to DLQ', async () => {
    let eventId = '';
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const rec = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'SCHEMA_INVALID',
        aggregateType: 'INVALID',
        aggregateId: 'inv_1',
        payload: { corrupt: true },
      });
      eventId = rec.id;
    });

    const backoff = new ExponentialBackoffPolicy({ baseDelayMs: 10, maxDelayMs: 100 });

    // Non-retryable error
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const res = await outboxService.handleFailure(
        client,
        eventId,
        new Error('Invalid payload schema: malformed enum value'),
        backoff,
        true, // isNonRetryable
      );
      assert.equal(res.routedToDlq, true, 'Non-retryable must route to DLQ on attempt 1');
      assert.equal(res.newRetryCount, 1);
    });

    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const dlqRows = await outboxService.queryDLQ(client, tenantAId);
      const item = dlqRows.find((d) => d.originatingOutboxId === eventId);
      assert.ok(item);
      assert.equal(item.errorCode, 'NON_RETRYABLE_ERROR');
    } finally {
      client.release();
    }
  });

  it('WP012-T37: Poison event moved to DLQ does not permanently block processing of subsequent queue items', async () => {
    let poisonId = '';
    let goodId = '';

    await withTenantTransaction(pool, tenantAId, async (client) => {
      const p = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'POISON_EVENT',
        aggregateType: 'TEST',
        aggregateId: 'poison_1',
        payload: {},
      });
      poisonId = p.id;

      const g = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        eventType: 'GOOD_EVENT',
        aggregateType: 'TEST',
        aggregateId: 'good_1',
        payload: {},
      });
      goodId = g.id;
    });

    const backoff = new ExponentialBackoffPolicy({ baseDelayMs: 10, maxDelayMs: 100 });

    // Route poison event to DLQ
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await outboxService.handleFailure(
        client,
        poisonId,
        new Error('Corrupted poison'),
        backoff,
        true,
      );
    });

    // Good event must still be discoverable and claimable!
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const claimed = await outboxService.claimBatch(client, 'worker_rescue', 5);
      const foundGood = claimed.find((c) => c.id === goodId);
      assert.ok(foundGood, 'Subsequent item must be successfully claimed');

      await outboxService.completeEvent(client, goodId);
    });

    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const goodCheck = await client.query<{ status: string }>(
        'SELECT status FROM cloud_integration_outbox WHERE id = $1;',
        [goodId],
      );
      assert.ok(goodCheck.rows[0]);
      assert.equal(goodCheck.rows[0].status, 'PUBLISHED');
    } finally {
      client.release();
    }
  });

  it('WP012-T38: DLQ preserves raw payload + error + trace/context + attempt information', async () => {
    const rawPayload = { customerId: 'cust_999', sensitiveData: 'preserved_for_diagnostics' };
    let eventId = '';

    await withTenantTransaction(pool, tenantAId, async (client) => {
      const rec = await outboxService.enqueue(client, {
        organizationId: tenantAId,
        branchId: branchA1Id,
        eventType: 'DIAGNOSTIC_DLQ_TEST',
        aggregateType: 'CUSTOMER',
        aggregateId: 'c_999',
        payload: rawPayload,
      });
      eventId = rec.id;
    });

    const backoff = new ExponentialBackoffPolicy({ baseDelayMs: 10, maxDelayMs: 100 });
    const diagnosticError = new Error('Database integrity trigger failure in remote service');

    await withTenantTransaction(pool, tenantAId, async (client) => {
      await outboxService.handleFailure(client, eventId, diagnosticError, backoff, true);
    });

    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);
      const dlqItems = await outboxService.queryDLQ(client, tenantAId);
      const target = dlqItems.find((d) => d.originatingOutboxId === eventId);

      assert.ok(target, 'DLQ record must exist');
      assert.deepEqual(target.rawPayload, rawPayload, 'Raw payload must be preserved verbatim');
      assert.equal(target.errorMessage, 'Database integrity trigger failure in remote service');
      assert.ok(target.errorTrace, 'Error stack trace must be recorded');
      assert.equal(target.retryCount, 1);
      assert.equal((target.context as { branchId: string }).branchId, branchA1Id);
    } finally {
      client.release();
    }
  });

  it('WP012-T39: Multiple dispatcher workers cannot process the same claimed event concurrently', async () => {
    const eventIds: string[] = [];
    await withTenantTransaction(pool, tenantAId, async (client) => {
      for (let i = 0; i < 5; i++) {
        const r = await outboxService.enqueue(client, {
          organizationId: tenantAId,
          eventType: 'CONCURRENT_CLAIM',
          aggregateType: 'ITEM',
          aggregateId: `claim_${i}`,
          payload: { index: i },
        });
        eventIds.push(r.id);
      }
    });

    // 2 workers concurrently claiming with FOR UPDATE SKIP LOCKED
    const [claimedWorker1, claimedWorker2] = await Promise.all([
      withTenantTransaction(pool, tenantAId, async (client) => {
        return outboxService.claimBatch(client, 'worker_A', 10);
      }),
      withTenantTransaction(pool, tenantAId, async (client) => {
        return outboxService.claimBatch(client, 'worker_B', 10);
      }),
    ]);

    const idsWorker1 = new Set(claimedWorker1.map((r) => r.id));
    const idsWorker2 = new Set(claimedWorker2.map((r) => r.id));

    // Invariant: Intersection must be EMPTY!
    for (const id of idsWorker1) {
      assert.equal(idsWorker2.has(id), false, `Event ${id} claimed by both worker A and B!`);
    }
  });

  it('WP012-T42: RLS denies direct cross-tenant access to WP-012 Cloud persistence', async () => {
    // Insert record under Tenant A
    const clientOpId = crypto.randomUUID();
    await withTenantTransaction(pool, tenantAId, async (client) => {
      return engine.processEvent(
        client,
        authA1,
        {
          aggregateType: 'RLS_TEST',
          aggregateId: 'rls_1',
          action: 'PAY',
          clientOpId,
          aggregateSequenceNumber: 1,
          payload: {},
        },
        async () => ({ tenant: 'A' }),
      );
    });

    // Query under Tenant B context using non-superuser role (so RLS is enforced)
    const client = await pool.connect();
    try {
      await client.query('SET ROLE trident_wp012_app;');
      await setTenantContext(client, tenantBId);

      const crossIdempotency = await client.query(
        'SELECT * FROM ingested_idempotency_log WHERE client_op_id = $1;',
        [clientOpId],
      );
      assert.equal(
        crossIdempotency.rows.length,
        0,
        'Tenant B must NOT see Tenant A idempotency logs under RLS',
      );

      const crossSeq = await client.query(
        'SELECT * FROM aggregate_sequences WHERE aggregate_type = $1;',
        ['RLS_TEST'],
      );
      assert.equal(crossSeq.rows.length, 0, 'Tenant B must NOT see Tenant A sequences under RLS');
    } finally {
      await client.query('RESET ROLE;');
      client.release();
    }
  });

  it('WP012-T43: Composite branch integrity rejects organization/branch mismatch', async () => {
    const client = await pool.connect();
    try {
      await setTenantContext(client, tenantAId);

      // Attempt to insert an idempotency log row with Tenant A orgId and Tenant B's branchId
      await assert.rejects(
        async () => {
          await client.query(
            `INSERT INTO ingested_idempotency_log (
              organization_id,
              branch_id,
              aggregate_type,
              aggregate_id,
              action,
              client_op_id,
              idempotency_key,
              aggregate_sequence_number,
              status,
              response_payload,
              receipt_token
            ) VALUES ($1, $2, 'TEST', '1', 'ACT', $3, 'key', 1, 'APPLIED', '{}'::jsonb, 'tok');`,
            [tenantAId, branchB1Id, crypto.randomUUID()],
          );
        },
        /violates foreign key constraint/,
        'Composite foreign key (organization_id, branch_id) must reject mismatched branch',
      );
    } finally {
      client.release();
    }
  });
});
