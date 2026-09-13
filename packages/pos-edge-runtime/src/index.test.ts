import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import { SqliteDiningRoomRepository, createPosFastifyApp } from './index.js';
import type { FastifyInstance } from 'fastify';

describe('TRIDENTPOS WP-014: Dining Orders & OCC Integration Suite', () => {
  let tempDir: string;
  let edgeDb: EdgeDatabaseService;
  let outbox: EdgeOutboxPersistence;
  let repo: SqliteDiningRoomRepository;
  let app: FastifyInstance;

  const orgId = 'org_test_wp014';
  const branchId = 'br_test_wp014';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp014-test-'));
    const dbPath = path.join(tempDir, 'pos-edge.db');

    edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    outbox = new EdgeOutboxPersistence(edgeDb);
    repo = new SqliteDiningRoomRepository(edgeDb);

    app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: orgId,
      branchId,
    });
    await app.ready();
  });

  after(async () => {
    await app.close();
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('WP014-T01: SQLite Schema initializes under WAL mode with scale-4 integer columns', () => {
    assert.equal(edgeDb.getJournalMode(), 'wal');

    // Verify tables exist in sqlite_master
    const tables = edgeDb.queryRows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mesas', 'cuentas', 'cuenta_items', 'cuenta_item_modificadores');",
    );
    assert.equal(tables.length, 4, 'All 4 canonical tables must exist');
  });

  it('WP014-T02: Mesa creation and listing persists with OCC version 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mesas',
      payload: {
        id: 'mesa_t02',
        roomName: 'Terraza',
        tableNumber: 'T-101',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.id, 'mesa_t02');
    assert.equal(body.status, 'DISPONIBLE');
    assert.equal(body.version, 1);

    const listRes = await app.inject({ method: 'GET', url: '/mesas' });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body) as Array<{ id: string }>;
    assert.ok(list.some((m) => m.id === 'mesa_t02'));
  });

  it('WP014-T03: Open cuenta occupies mesa and sets initial version to 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_t03',
        mesaId: 'mesa_t02',
        epochId: 'ep_1',
        accountType: 'COMEDOR',
        openedByUserId: 'usr_waiter_1',
        clientOpId: crypto.randomUUID(),
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.cuenta.id, 'cta_t03');
    assert.equal(body.cuenta.status, 'ABIERTA');
    assert.equal(body.cuenta.version, 1);
    assert.equal(body.cuenta.totalAmount, '0.0000');
    assert.equal(body.mesa.status, 'OCUPADA');
    assert.equal(body.mesa.currentAccountId, 'cta_t03');
    assert.equal(body.mesa.version, 2);
  });

  it('WP014-T04: Exact line calculation and integer persistence in SQLite', async () => {
    // Add item: unitPrice 150.0000 (1500000), quantity 2.0000 (20000), tax 16% (1600), discount 30.0000 (300000)
    // subtotal = 300.0000 (3000000)
    // netSubtotal = 270.0000 (2700000)
    // tax = roundDiv(2700000 * 1600, 10000) = 432000 (43.2000)
    // total = 313.2000 (3132000)
    const clientOpId = crypto.randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/cuentas/cta_t03/items',
      payload: {
        id: 'itm_t04',
        expectedVersion: 1,
        clientOpId,
        productId: 'prod_ribeye',
        productNameSnapshot: 'Ribeye 400g',
        unitPriceApplied: '150.0000',
        quantity: '2.0000',
        taxRateApplied: '0.1600',
        discountAmountApplied: '30.0000',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.version, 2);
    assert.equal(body.subtotal, '300.0000');
    assert.equal(body.taxTotal, '43.2000');
    assert.equal(body.discountsTotal, '30.0000');
    assert.equal(body.totalAmount, '313.2000');

    // Direct SQLite raw row verification: check INTEGER storage
    const rawItem = edgeDb.queryRow<{
      unit_price_applied: number;
      quantity: number;
      tax_rate_applied: number;
      tax_amount_applied: number;
      discount_amount_applied: number;
      subtotal: number;
      total: number;
    }>('SELECT * FROM cuenta_items WHERE id = ?;', 'itm_t04');
    assert.ok(rawItem, 'Raw cuenta item row must exist');
    assert.equal(rawItem.unit_price_applied, 1500000);
    assert.equal(rawItem.quantity, 20000);
    assert.equal(rawItem.tax_rate_applied, 1600);
    assert.equal(rawItem.tax_amount_applied, 432000);
    assert.equal(rawItem.discount_amount_applied, 300000);
    assert.equal(rawItem.subtotal, 3000000);
    assert.equal(rawItem.total, 3132000);
  });

  it('WP014-T05: Modifier persistence in cuenta_item_modificadores with scale-4 integer', async () => {
    const clientOpId = crypto.randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/cuentas/cta_t03/items',
      payload: {
        id: 'itm_t05',
        expectedVersion: 2,
        clientOpId,
        productId: 'prod_burger',
        productNameSnapshot: 'Burger Gourmet',
        unitPriceApplied: '85.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
        modifiers: [
          {
            id: 'mod_t05_1',
            modifierId: 'mod_extra_cheese',
            modifierNameSnapshot: 'Queso Gouda Extra',
            modifierPriceApplied: '15.0000',
          },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.version, 3);

    // Direct SQLite raw row verification for modifier
    const rawMod = edgeDb.queryRow<{
      modifier_id: string;
      modifier_price_applied: number;
    }>('SELECT * FROM cuenta_item_modificadores WHERE id = ?;', 'mod_t05_1');
    assert.ok(rawMod, 'Raw modifier row must exist');
    assert.equal(rawMod.modifier_id, 'mod_extra_cheese');
    assert.equal(rawMod.modifier_price_applied, 150000); // 15.0000
  });

  it('WP014-T06: OCC expectedVersion mismatch returns HTTP 409 with current snapshot', async () => {
    // Current version of cta_t03 is 3. Attempting mutation with expectedVersion 2 must fail.
    const res = await app.inject({
      method: 'POST',
      url: '/cuentas/cta_t03/items',
      payload: {
        id: 'itm_t06_stale',
        expectedVersion: 2, // Stale version!
        clientOpId: crypto.randomUUID(),
        productId: 'prod_drink',
        productNameSnapshot: 'Agua Mineral',
        unitPriceApplied: '25.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
      },
    });

    assert.equal(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'OCC_CONFLICT');
    assert.equal(body.expectedVersion, 2);
    assert.equal(body.actualVersion, 3);
    assert.ok(body.currentSnapshot);
    assert.equal(body.currentSnapshot.id, 'cta_t03');
    assert.equal(body.currentSnapshot.version, 3);
  });

  it('WP014-T07: True SQLite concurrent race between two clients yields 0 lost updates', async () => {
    // Create new account for race test
    await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_race',
        epochId: 'ep_1',
        accountType: 'MOSTRADOR',
        openedByUserId: 'usr_race',
        clientOpId: crypto.randomUUID(),
      },
    });

    // Both clients attempt to mutate with identical expectedVersion: 1 simultaneously
    const [resClientA, resClientB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/cuentas/cta_race/items',
        payload: {
          id: 'itm_race_a',
          expectedVersion: 1,
          clientOpId: crypto.randomUUID(),
          productId: 'p_a',
          productNameSnapshot: 'Pizza Hawaiana',
          unitPriceApplied: '120.0000',
          quantity: '1.0000',
          taxRateApplied: '0.1600',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/cuentas/cta_race/items',
        payload: {
          id: 'itm_race_b',
          expectedVersion: 1,
          clientOpId: crypto.randomUUID(),
          productId: 'p_b',
          productNameSnapshot: 'Pizza Pepperoni',
          unitPriceApplied: '130.0000',
          quantity: '1.0000',
          taxRateApplied: '0.1600',
        },
      }),
    ]);

    // Invariant: Exactly one must succeed (200) and the other must receive OCC 409
    const statuses = [resClientA.statusCode, resClientB.statusCode].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      'Exactly one client must succeed and one must fail with 409',
    );

    // Verify account state: version is exactly 2, and exactly 1 item was saved (zero lost update)
    const finalCuenta = await repo.getCuentaById('cta_race');
    assert.equal(finalCuenta?.version, 2);
    assert.equal(finalCuenta?.items.length, 1);
  });

  it('WP014-T08: Transactional Outbox commits business mutation and outbox event atomically', async () => {
    const clientOpId = crypto.randomUUID();
    const ctaId = 'cta_atomic';

    await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: ctaId,
        epochId: 'ep_1',
        accountType: 'MOSTRADOR',
        openedByUserId: 'usr_1',
        clientOpId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/cuentas/${ctaId}/items`,
      payload: {
        id: 'itm_atomic',
        expectedVersion: 1,
        clientOpId,
        productId: 'prod_salad',
        productNameSnapshot: 'Ensalada César',
        unitPriceApplied: '75.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
      },
    });

    assert.equal(res.statusCode, 200);

    // Verify both item and outbox record exist in SQLite
    const itemRow = edgeDb.queryRow('SELECT id FROM cuenta_items WHERE id = ?;', 'itm_atomic');
    assert.ok(itemRow, 'Cuenta item must be committed');

    const outboxRow = edgeDb.queryRow<{
      id: string;
      client_op_id: string;
      action: string;
      status: string;
    }>(
      'SELECT id, client_op_id, action, status FROM outbox_queue WHERE client_op_id = ?;',
      clientOpId,
    );
    assert.ok(outboxRow, 'Outbox queue event must be committed atomically');
    assert.equal(outboxRow.action, 'ADD_ITEM');
    assert.equal(outboxRow.status, 'PENDING');
  });

  it('WP014-T09: Transactional Outbox rollback leaves zero partial state on failure', () => {
    const rollbackCtaId = 'cta_rollback_test';
    const clientOpId = crypto.randomUUID();

    // Use outbox.executeWithOutbox directly to test transaction failure
    assert.throws(() => {
      outbox.executeWithOutbox(() => {
        repo.saveCuenta(
          {
            id: rollbackCtaId,
            folioNumber: null,
            epochId: 'ep_1',
            mesaId: null,
            accountType: 'COMEDOR',
            status: 'ABIERTA',
            subtotal: 1000000n,
            taxTotal: 160000n,
            discountsTotal: 0n,
            tipsTotal: 0n,
            totalAmount: 1160000n,
            openedByUserId: 'u1',
            openedAt: new Date().toISOString(),
            closedAt: null,
            version: 1,
            updatedAt: new Date().toISOString(),
            items: [],
          },
          0,
        );

        // Force deliberate failure inside transaction
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      }, [
        {
          organizationId: orgId,
          branchId,
          aggregateType: 'CUENTA',
          aggregateId: rollbackCtaId,
          action: 'OPEN_CUENTA',
          clientOpId,
          aggregateSequenceNumber: 1,
          payload: {},
        },
      ]);
    });

    // Verify zero partial state
    const cuentaInDb = edgeDb.queryRow('SELECT id FROM cuentas WHERE id = ?;', rollbackCtaId);
    assert.equal(cuentaInDb, undefined, 'Cuenta must NOT exist in database after rollback');

    const outboxInDb = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      clientOpId,
    );
    assert.equal(outboxInDb, undefined, 'Outbox event must NOT exist in database after rollback');
  });

  it('WP014-T10: Close cuenta transitions status and frees table with outbox record', async () => {
    const closeClientOpId = crypto.randomUUID();
    const res = await app.inject({
      method: 'PUT',
      url: '/cuentas/cta_t03/cerrar',
      payload: {
        expectedVersion: 3,
        clientOpId: closeClientOpId,
        closedStatus: 'PAGADA',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.cuenta.status, 'PAGADA');
    assert.equal(body.cuenta.version, 4);
    assert.equal(body.mesa.status, 'DISPONIBLE');
    assert.equal(body.mesa.currentAccountId, null);

    // Verify outbox
    const outboxRow = edgeDb.queryRow<{
      action: string;
      status: string;
    }>('SELECT action, status FROM outbox_queue WHERE client_op_id = ?;', closeClientOpId);
    assert.equal(outboxRow?.action, 'CLOSE_CUENTA');
    assert.equal(outboxRow?.status, 'PENDING');
  });

  it('WP014-T11: REST API rejects invalid numeric string formatting (fails closed with 400)', async () => {
    const invalidInputs = ['150.5', '150', '150.50000', 'abc', '150.500a', ''];

    for (const invalidPrice of invalidInputs) {
      const res = await app.inject({
        method: 'POST',
        url: '/cuentas/cta_race/items',
        payload: {
          id: `itm_inv_${crypto.randomUUID().slice(0, 8)}`,
          expectedVersion: 2,
          clientOpId: crypto.randomUUID(),
          productId: 'p_test',
          productNameSnapshot: 'Test Item',
          unitPriceApplied: invalidPrice,
          quantity: '1.0000',
          taxRateApplied: '0.1600',
        },
      });

      assert.equal(
        res.statusCode,
        400,
        `Expected 400 for invalid price '${invalidPrice}', got ${res.statusCode}`,
      );
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'VALIDATION_ERROR');
    }
  });

  it('WP014-T12: Local performance benchmark on order persistence', async () => {
    // Benchmark 50 sequential addItemToCuenta operations on a dedicated account
    const benchCtaId = 'cta_benchmark';
    await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: benchCtaId,
        epochId: 'ep_bench',
        accountType: 'MOSTRADOR',
        openedByUserId: 'usr_bench',
        clientOpId: crypto.randomUUID(),
      },
    });

    const samples: number[] = [];
    const iterations = 50;

    for (let i = 1; i <= iterations; i++) {
      const t0 = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: `/cuentas/${benchCtaId}/items`,
        payload: {
          id: `itm_bench_${i}`,
          expectedVersion: i,
          clientOpId: crypto.randomUUID(),
          productId: 'prod_bench',
          productNameSnapshot: `Bench Item ${i}`,
          unitPriceApplied: '50.0000',
          quantity: '1.0000',
          taxRateApplied: '0.1600',
        },
      });
      const elapsedMs = performance.now() - t0;
      assert.equal(res.statusCode, 200);
      samples.push(elapsedMs);
    }

    samples.sort((a, b) => a - b);
    const min = samples[0];
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const max = samples[samples.length - 1];

    console.log(`\n--- WP-014 Local Order Performance Benchmark (50 samples) ---`);
    console.log(`Min: ${min?.toFixed(3)} ms`);
    console.log(`Median (p50): ${median?.toFixed(3)} ms`);
    console.log(`p95: ${p95?.toFixed(3)} ms`);
    console.log(`Max: ${max?.toFixed(3)} ms`);
    console.log(
      `Governance Note: Local benchmark only. Target hardware validation SEC-VAL-08 remains OPEN.\n`,
    );

    assert.ok(
      median !== undefined && median < 50,
      'Local median order latency should be under 50ms',
    );
  });
});
