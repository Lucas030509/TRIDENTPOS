/**
 * TRIDENTPOS WP-012 Edge Transactional Outbox & Ingested Idempotency Suite
 * Conforms strictly to:
 * - ADR-006 (Transactional Outbox and Ingested Idempotency)
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - COORDINATOR_PROMPT_WP012_START.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EdgeDatabaseService } from './db/edge-database.js';
import { getTestNativeDatabase } from './db/test-access.js';
import { EdgeOutboxPersistence, EnqueueOutboxInput } from './db/outbox-persistence.js';
import { createCloudReceipt, SyncEventAckDTO } from '@trident/core';

describe('TRIDENTPOS WP-012 Edge Transactional Outbox & Durability Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let edgeDb: EdgeDatabaseService;
  let outbox: EdgeOutboxPersistence;

  const testOrgId = crypto.randomUUID();
  const testBranchId = crypto.randomUUID();

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-outbox-'));
    dbPath = path.join(tempDir, 'trident-edge-outbox.db');
    edgeDb = new EdgeDatabaseService({
      databasePath: dbPath,
    });
    outbox = new EdgeOutboxPersistence(edgeDb);
  });

  after(() => {
    if (edgeDb && edgeDb.isOpen()) {
      edgeDb.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('WP012-T01: Edge OutboxQueue initializes under canonical SQLite WAL database', () => {
    const journalMode = edgeDb.getJournalMode();
    assert.equal(journalMode, 'wal', 'SQLite must be running in WAL journal mode');

    const nativeDb = getTestNativeDatabase(edgeDb);
    const tableCheck = nativeDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox_queue';")
      .get() as { name: string } | undefined;

    assert.ok(tableCheck, 'outbox_queue table must exist in SQLite database');
    assert.equal(tableCheck?.name, 'outbox_queue');

    const indexCheck = nativeDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_outbox_queue_status';",
      )
      .get() as { name: string } | undefined;

    assert.ok(indexCheck, 'idx_outbox_queue_status index must exist');
  });

  it('WP012-T02: Domain fixture mutation + outbox event commit atomically', () => {
    const nativeDb = getTestNativeDatabase(edgeDb);
    const orderId = crypto.randomUUID();
    const clientOpId = crypto.randomUUID();

    const eventInput: EnqueueOutboxInput = {
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: orderId,
      action: 'CREATE_ORDER',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { orderId, totalAmount: 450.0 },
    };

    // Execute atomic domain fixture mutation + outbox event in ONE SQLite transaction
    outbox.executeWithOutbox(() => {
      nativeDb
        .prepare(
          `INSERT INTO local_fixture_orders (id, organization_id, branch_id, table_number, total_amount)
           VALUES (?, ?, ?, ?, ?);`,
        )
        .run(orderId, testOrgId, testBranchId, 'T-01', 450.0);
    }, [eventInput]);

    // Verify both domain row and outbox row are committed
    const orderRow = nativeDb
      .prepare('SELECT id, total_amount FROM local_fixture_orders WHERE id = ?;')
      .get(orderId) as { id: string; total_amount: number } | undefined;
    assert.ok(orderRow, 'Domain order row must be committed');
    assert.equal(orderRow?.total_amount, 450.0);

    const outboxRow = nativeDb
      .prepare('SELECT id, client_op_id, status FROM outbox_queue WHERE client_op_id = ?;')
      .get(clientOpId) as { id: string; client_op_id: string; status: string } | undefined;
    assert.ok(outboxRow, 'Outbox row must be committed');
    assert.equal(outboxRow?.status, 'PENDING');
  });

  it('WP012-T03: Outbox insert failure rolls back domain fixture mutation', () => {
    const nativeDb = getTestNativeDatabase(edgeDb);
    const orderId = crypto.randomUUID();
    // Invalid clientOpId (not a UUIDv4) causes enqueue to throw!
    const invalidEventInput: EnqueueOutboxInput = {
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: orderId,
      action: 'CREATE_ORDER',
      clientOpId: 'invalid-non-uuid',
      aggregateSequenceNumber: 1,
      payload: { orderId },
    };

    assert.throws(
      () => {
        outbox.executeWithOutbox(() => {
          nativeDb
            .prepare(
              `INSERT INTO local_fixture_orders (id, organization_id, branch_id, table_number, total_amount)
               VALUES (?, ?, ?, ?, ?);`,
            )
            .run(orderId, testOrgId, testBranchId, 'T-02', 200.0);
        }, [invalidEventInput]);
      },
      /UUIDv4/,
      'Should throw on invalid clientOpId',
    );

    // Verify domain row was rolled back!
    const orderRow = nativeDb
      .prepare('SELECT id FROM local_fixture_orders WHERE id = ?;')
      .get(orderId);
    assert.equal(orderRow, undefined, 'Domain order must be rolled back on outbox failure');
  });

  it('WP012-T04: Domain mutation failure rolls back outbox insert', () => {
    const nativeDb = getTestNativeDatabase(edgeDb);
    const clientOpId = crypto.randomUUID();

    const validEventInput: EnqueueOutboxInput = {
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: crypto.randomUUID(),
      action: 'CREATE_ORDER',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { amount: 100 },
    };

    assert.throws(
      () => {
        outbox.executeWithOutbox(() => {
          // Intentional SQL failure in domain mutation: insert null into NOT NULL column
          nativeDb
            .prepare(
              `INSERT INTO local_fixture_orders (id, organization_id, branch_id, table_number, total_amount)
               VALUES (NULL, ?, ?, ?, ?);`,
            )
            .run(testOrgId, testBranchId, 'T-03', 100.0);
        }, [validEventInput]);
      },
      /NOT NULL constraint failed/,
      'Domain SQL failure should trigger rollback',
    );

    // Verify outbox row was rolled back
    const outboxRow = nativeDb
      .prepare('SELECT id FROM outbox_queue WHERE client_op_id = ?;')
      .get(clientOpId);
    assert.equal(outboxRow, undefined, 'Outbox row must be rolled back on domain failure');
  });

  it('WP012-T25: ACK APPLIED may mark Edge outbox row SYNCED only with required Cloud receipt/signature material', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_25',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { paid: true },
    });

    const receipt = createCloudReceipt('receipt_tok_25', 'sig_cloud_valid_25', clientOpId, 1);

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_25',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, true, 'Should mark row SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'SYNCED');
    assert.equal(updated?.receiptToken, 'sig_cloud_valid_25');
    assert.ok(updated?.receiptVerifiedAt);
    assert.ok(updated?.syncedAt);
  });

  it('WP012-T26: ACK DUPLICATE_ACCEPTED may mark Edge outbox row SYNCED only with required Cloud receipt/signature material', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_26',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 2,
      payload: { paid: true },
    });

    const receipt = createCloudReceipt('receipt_tok_26', 'sig_cloud_valid_26', clientOpId, 2);

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_26',
      aggregateSequenceNumber: 2,
      status: 'DUPLICATE_ACCEPTED',
      receipt,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, true, 'Should mark row SYNCED on DUPLICATE_ACCEPTED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'SYNCED');
    assert.equal(updated?.receiptToken, 'sig_cloud_valid_26');
  });

  it('WP012-T27: RECEIVED does NOT mark Edge row SYNCED', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_27',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 3,
      payload: { paid: true },
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_27',
      aggregateSequenceNumber: 3,
      status: 'RECEIVED',
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'RECEIVED must NOT mark row SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'PENDING');
  });

  it('WP012-T28: DURABLY_STORED does NOT mark Edge row SYNCED', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_28',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 4,
      payload: { paid: true },
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_28',
      aggregateSequenceNumber: 4,
      status: 'DURABLY_STORED',
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'DURABLY_STORED must NOT mark row SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'PENDING');
  });

  it('WP012-T29: Missing Cloud receipt/signature material does NOT mark Edge row SYNCED', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_29',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 5,
      payload: { paid: true },
    });

    // ACK is APPLIED but missing receipt!
    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_29',
      aggregateSequenceNumber: 5,
      status: 'APPLIED',
      receipt: undefined,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'Missing receipt must NOT mark row SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'PENDING');
  });

  it('WP012-T40: Outbox backlog >100 triggers governed alert hook', () => {
    const tempDirAlert = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-alert-'));
    const tempDb = new EdgeDatabaseService({
      databasePath: path.join(tempDirAlert, 'alert.db'),
    });
    const alertOutbox = new EdgeOutboxPersistence(tempDb);

    // Insert 101 pending events
    for (let i = 1; i <= 101; i++) {
      alertOutbox.enqueue({
        organizationId: testOrgId,
        branchId: testBranchId,
        aggregateType: 'TEST',
        aggregateId: `agg_${i}`,
        action: 'ACT',
        clientOpId: crypto.randomUUID(),
        aggregateSequenceNumber: 1,
        payload: { index: i },
      });
    }

    assert.equal(alertOutbox.getBacklogCount(), 101);

    let alertFired = false;
    let reportedCount = 0;

    const res = alertOutbox.checkBacklogAlert((count) => {
      alertFired = true;
      reportedCount = count;
    });

    assert.equal(res.alertTriggered, true);
    assert.equal(alertFired, true);
    assert.equal(reportedCount, 101);

    tempDb.close();
    fs.rmSync(tempDirAlert, { recursive: true, force: true });
  });

  it('WP012-T41: Outbox backlog ==100 does not trigger >100 condition', () => {
    const tempDirAlert = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-exact100-'));
    const tempDb = new EdgeDatabaseService({
      databasePath: path.join(tempDirAlert, 'exact100.db'),
    });
    const alertOutbox = new EdgeOutboxPersistence(tempDb);

    // Insert exactly 100 pending events
    for (let i = 1; i <= 100; i++) {
      alertOutbox.enqueue({
        organizationId: testOrgId,
        branchId: testBranchId,
        aggregateType: 'TEST',
        aggregateId: `agg_${i}`,
        action: 'ACT',
        clientOpId: crypto.randomUUID(),
        aggregateSequenceNumber: 1,
        payload: { index: i },
      });
    }

    assert.equal(alertOutbox.getBacklogCount(), 100);

    let alertFired = false;
    const res = alertOutbox.checkBacklogAlert(() => {
      alertFired = true;
    });

    assert.equal(res.alertTriggered, false, 'Backlog == 100 must NOT trigger alert');
    assert.equal(alertFired, false);

    tempDb.close();
    fs.rmSync(tempDirAlert, { recursive: true, force: true });
  });
});
