/**
 * TRIDENTPOS WP-012 Edge Transactional Outbox & Ingested Idempotency Suite
 * Conforms strictly to:
 * - ADR-006 (Transactional Outbox and Ingested Idempotency)
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2
 * - COORDINATOR_PROMPT_WP012_START.md & COORDINATOR_PROMPT_WP012_S12-R1_REMEDIATION.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EdgeDatabaseService } from './db/edge-database.js';
import { getTestNativeDatabase } from './db/test-access.js';
import { EdgeOutboxPersistence, EnqueueOutboxInput } from './db/outbox-persistence.js';
import { SyncEventAckDTO, createCloudReceipt } from '@trident/core';
import { TestCloudReceiptIssuer, TestCloudReceiptVerifier } from '@trident/core/test-support';

describe('TRIDENTPOS WP-012 Edge Transactional Outbox & Durability Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let edgeDb: EdgeDatabaseService;
  let outbox: EdgeOutboxPersistence;
  const testIssuer = new TestCloudReceiptIssuer();
  const testVerifier = new TestCloudReceiptVerifier();

  const testOrgId = crypto.randomUUID();
  const testBranchId = crypto.randomUUID();

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-outbox-'));
    dbPath = path.join(tempDir, 'trident-edge-outbox.db');
    edgeDb = new EdgeDatabaseService({
      databasePath: dbPath,
    });

    // QI-012-06: Create test fixture table exclusively in test setup, NOT in production schema
    getTestNativeDatabase(edgeDb).exec(`
      CREATE TABLE IF NOT EXISTS local_fixture_orders (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        table_number TEXT NOT NULL,
        total_amount REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
  });

  after(() => {
    if (edgeDb && edgeDb.isOpen()) {
      getTestNativeDatabase(edgeDb).exec('DROP TABLE IF EXISTS local_fixture_orders;');
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

    const receipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 1,
    });

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
    assert.equal(updated?.receiptToken, receipt.serverSignature);
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

    const receipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 2,
    });

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
    assert.equal(updated?.receiptToken, receipt.serverSignature);
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

  it('WP012-R1-T50: Arbitrary non-empty forged receipt signature cannot mark Edge row SYNCED', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_50',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { paid: true },
    });

    // Fabricated arbitrary forged signature
    const forgedReceipt = createCloudReceipt(
      'receipt_fake_token',
      'forged_non_empty_signature_1234567890abcdef',
      clientOpId,
      1,
    );

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_50',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt: forgedReceipt,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'Forged signature must fail closed and NOT mark SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'PENDING');
  });

  it('WP012-R1-T51: Missing CloudReceiptVerifier fails closed', () => {
    const tempDirNoVerifier = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-noverifier-'));
    const tempDb = new EdgeDatabaseService({
      databasePath: path.join(tempDirNoVerifier, 'noverifier.db'),
    });
    // Explicitly null verifier
    const noVerifierOutbox = new EdgeOutboxPersistence(tempDb, null);

    const clientOpId = crypto.randomUUID();
    const record = noVerifierOutbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_51',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { paid: true },
    });

    const receipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 1,
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_51',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt,
    };

    const marked = noVerifierOutbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'Without verifier, markSynced must fail closed');

    const updated = noVerifierOutbox.getById(record.id);
    assert.equal(updated?.status, 'PENDING');

    tempDb.close();
    fs.rmSync(tempDirNoVerifier, { recursive: true, force: true });
  });

  it('WP012-R1-T52: Trusted deterministic TEST verifier permits valid APPLIED receipt', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_52',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: { paid: true },
    });

    const validReceipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 1,
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r1_52',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt: validReceipt,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, true, 'Valid receipt with trusted test verifier must mark SYNCED');

    const updated = outbox.getById(record.id);
    assert.equal(updated?.status, 'SYNCED');
    assert.equal(updated?.receiptToken, validReceipt.serverSignature);
  });

  it('WP012-R1-T60: Production Edge outbox implementation has no runtime dependency on test-access', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const jsPath = path.resolve(currentDir, 'db', 'outbox-persistence.js');
    const tsPath = path.resolve(currentDir, '..', 'src', 'db', 'outbox-persistence.ts');
    const targetPath = fs.existsSync(jsPath) ? jsPath : tsPath;
    const content = fs.readFileSync(targetPath, 'utf-8');
    assert.equal(
      content.includes('test-access'),
      false,
      'Production outbox-persistence must NOT import or reference test-access',
    );
    if (fs.existsSync(tsPath)) {
      const tsContent = fs.readFileSync(tsPath, 'utf-8');
      assert.equal(
        tsContent.includes('test-access'),
        false,
        'TypeScript source outbox-persistence.ts must NOT import or reference test-access',
      );
    }
  });

  it('WP012-R1-T62: Production Edge initialization contains no local_fixture_orders test table', () => {
    const tempDirClean = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-edge-clean-'));
    const cleanDb = new EdgeDatabaseService({
      databasePath: path.join(tempDirClean, 'clean.db'),
    });
    // Create production EdgeOutboxPersistence
    new EdgeOutboxPersistence(cleanDb);

    const nativeDb = getTestNativeDatabase(cleanDb);
    const fixtureTable = nativeDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_fixture_orders';")
      .get();
    assert.equal(
      fixtureTable,
      undefined,
      'Production initialization must NOT create local_fixture_orders test table',
    );

    cleanDb.close();
    fs.rmSync(tempDirClean, { recursive: true, force: true });
  });

  it('WP012-R1-T63: Fractional aggregateSequenceNumber rejected at Edge persistence boundary', () => {
    assert.throws(
      () => {
        outbox.enqueue({
          organizationId: testOrgId,
          branchId: testBranchId,
          aggregateType: 'ORDER',
          aggregateId: 'agg_frac',
          action: 'PAY',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 1.5,
          payload: {},
        });
      },
      /safe positive integer/,
      'Fractional aggregateSequenceNumber must be rejected',
    );
  });

  it('WP012-R1-T64: Unsafe integer aggregateSequenceNumber rejected', () => {
    assert.throws(
      () => {
        outbox.enqueue({
          organizationId: testOrgId,
          branchId: testBranchId,
          aggregateType: 'ORDER',
          aggregateId: 'agg_unsafe',
          action: 'PAY',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: Number.MAX_SAFE_INTEGER + 100,
          payload: {},
        });
      },
      /safe positive integer/,
      'Unsafe integer aggregateSequenceNumber must be rejected',
    );

    assert.throws(
      () => {
        outbox.enqueue({
          organizationId: testOrgId,
          branchId: testBranchId,
          aggregateType: 'ORDER',
          aggregateId: 'agg_nan',
          action: 'PAY',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: Number.NaN,
          payload: {},
        });
      },
      /safe positive integer/,
      'NaN aggregateSequenceNumber must be rejected',
    );

    assert.throws(
      () => {
        outbox.enqueue({
          organizationId: testOrgId,
          branchId: testBranchId,
          aggregateType: 'ORDER',
          aggregateId: 'agg_zero',
          action: 'PAY',
          clientOpId: crypto.randomUUID(),
          aggregateSequenceNumber: 0,
          payload: {},
        });
      },
      /safe positive integer/,
      'Zero aggregateSequenceNumber must be rejected',
    );
  });

  it('WP012-R2-T67: markSynced arity is strictly 2 and does not permit per-call verifier override', () => {
    assert.equal(
      outbox.markSynced.length,
      2,
      'markSynced must declare exactly 2 parameters (id, ack)',
    );
    // Test that passing a fake permissive verifier as 3rd argument does not override constructor verifier
    const fakeVerifier = {
      verifyReceipt: () => true,
    };
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t67',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: {},
    });

    const invalidAck: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t67',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt: {
        receiptId: 'forged_receipt',
        serverSignature: 'forged_sig',
        clientOpId,
        aggregateSequenceNumber: 1,
        appliedAt: new Date().toISOString(),
      },
    };

    // Calling with 3 arguments should NOT use fakeVerifier
    const marked = (outbox.markSynced as any)(record.id, invalidAck, fakeVerifier);
    assert.equal(marked, false, 'markSynced must not allow 3rd parameter override of verifier');
    const row = outbox.getById(record.id);
    assert.equal(row?.status, 'PENDING');
  });

  it('WP012-R2-T68: Missing or omitted verifier fails closed', () => {
    const tempDirNoVerifier = fs.mkdtempSync(path.join(os.tmpdir(), 'wp012-no-verifier-'));
    const tempDb = new EdgeDatabaseService({
      databasePath: path.join(tempDirNoVerifier, 'no-ver.db'),
    });
    const noVerifierOutbox = new EdgeOutboxPersistence(tempDb);

    const clientOpId = crypto.randomUUID();
    const record = noVerifierOutbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t68',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: {},
    });

    const genuineReceipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 1,
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t68',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt: genuineReceipt,
    };

    const marked = noVerifierOutbox.markSynced(record.id, ack);
    assert.equal(marked, false, 'Without injected verifier, markSynced must fail closed');
    const row = noVerifierOutbox.getById(record.id);
    assert.equal(row?.status, 'PENDING');

    tempDb.close();
    fs.rmSync(tempDirNoVerifier, { recursive: true, force: true });
  });

  it('WP012-R2-T69: Injected trusted test verifier validates genuine APPLIED receipt', () => {
    const clientOpId = crypto.randomUUID();
    const record = outbox.enqueue({
      organizationId: testOrgId,
      branchId: testBranchId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t69',
      action: 'PAY',
      clientOpId,
      aggregateSequenceNumber: 1,
      payload: {},
    });

    const receipt = testIssuer.issueReceipt({
      organizationId: testOrgId,
      branchId: testBranchId,
      clientOpId,
      aggregateSequenceNumber: 1,
    });

    const ack: SyncEventAckDTO = {
      clientOpId,
      aggregateType: 'ORDER',
      aggregateId: 'agg_r2_t69',
      aggregateSequenceNumber: 1,
      status: 'APPLIED',
      receipt,
    };

    const marked = outbox.markSynced(record.id, ack);
    assert.equal(marked, true, 'Valid receipt with trusted verifier must succeed');
    const row = outbox.getById(record.id);
    assert.equal(row?.status, 'SYNCED');
  });

  it('WP012-R2-T73: EdgeDatabaseService does not expose public exec() method', () => {
    assert.equal(
      typeof (edgeDb as any).exec,
      'undefined',
      'exec must not be defined on EdgeDatabaseService instance',
    );
    assert.equal(
      typeof (EdgeDatabaseService.prototype as any).exec,
      'undefined',
      'exec must not be defined on EdgeDatabaseService prototype',
    );
  });

  it('WP012-R2-T74: EdgeDatabaseService does not expose public prepare() method', () => {
    assert.equal(
      typeof (edgeDb as any).prepare,
      'undefined',
      'prepare must not be defined on EdgeDatabaseService instance',
    );
    assert.equal(
      typeof (EdgeDatabaseService.prototype as any).prepare,
      'undefined',
      'prepare must not be defined on EdgeDatabaseService prototype',
    );
  });

  it('WP012-R2-T75: Internal outbox adapter cannot be obtained through any public API of @trident/edge', async () => {
    const edgeExports = await import('./index.js');
    assert.equal(
      'InternalOutboxAdapter' in edgeExports,
      false,
      'InternalOutboxAdapter must not be exported by @trident/edge index',
    );
    assert.equal(
      'getInternalOutboxAdapter' in edgeExports,
      false,
      'getInternalOutboxAdapter must not be exported by @trident/edge index',
    );
    assert.equal(
      'InternalOutboxAdapter' in (edgeDb as any),
      false,
      'Internal adapter must not be on EdgeDatabaseService instance',
    );
  });

  it('WP012-R2-T76: Edge atomic domain + outbox transaction functions properly using runInTransaction', () => {
    const nativeDb = getTestNativeDatabase(edgeDb);
    const orderId = crypto.randomUUID();
    const clientOpId = crypto.randomUUID();

    const res = edgeDb.runInTransaction(() => {
      nativeDb
        .prepare(
          `INSERT INTO local_fixture_orders (id, organization_id, branch_id, table_number, total_amount)
           VALUES (?, ?, ?, ?, ?);`,
        )
        .run(orderId, testOrgId, testBranchId, 'T-R2-76', 888.0);

      return outbox.enqueue({
        organizationId: testOrgId,
        branchId: testBranchId,
        aggregateType: 'ORDER',
        aggregateId: orderId,
        action: 'CREATE_ORDER',
        clientOpId,
        aggregateSequenceNumber: 1,
        payload: { orderId, totalAmount: 888.0 },
      });
    });

    assert.ok(res, 'Outbox item must be returned from transaction');
    assert.equal(res.clientOpId, clientOpId);

    // Verify both domain row and outbox record exist
    const orderRow = nativeDb
      .prepare('SELECT id, total_amount FROM local_fixture_orders WHERE id = ?;')
      .get(orderId) as { id: string; total_amount: number } | undefined;
    assert.ok(orderRow, 'Domain order row must be committed');
    assert.equal(orderRow?.total_amount, 888.0);

    const outboxRow = outbox.getById(res.id);
    assert.ok(outboxRow, 'Outbox record must exist');
    assert.equal(outboxRow?.status, 'PENDING');
  });
});
