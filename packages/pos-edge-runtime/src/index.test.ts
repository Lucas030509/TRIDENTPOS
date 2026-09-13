import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import { OCCConflictError, type Mesa } from '@trident/pos';
import {
  SqliteDiningRoomRepository,
  createPosFastifyApp,
  serializeSnapshotToDTO,
} from './index.js';
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
    // Mesa domain persistence via repository (public HTTP surface restricted to frozen contract)
    const savedMesa = repo.saveMesaSync(
      {
        id: 'mesa_t02',
        roomName: 'Terraza',
        tableNumber: 'T-101',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    assert.equal(savedMesa.id, 'mesa_t02');
    assert.equal(savedMesa.status, 'DISPONIBLE');
    assert.equal(savedMesa.version, 1);

    const list = await repo.listMesas();
    assert.ok(list.some((m) => m.id === 'mesa_t02'));

    // Assert unauthorized public Mesa routes are NOT exposed on Fastify app (404)
    const postRes = await app.inject({
      method: 'POST',
      url: '/mesas',
      payload: { id: 'm_404', roomName: 'R', tableNumber: '1' },
    });
    assert.equal(postRes.statusCode, 404, 'POST /mesas must not be exposed');

    const getRes = await app.inject({ method: 'GET', url: '/mesas' });
    assert.equal(getRes.statusCode, 404, 'GET /mesas must not be exposed');

    const putRes = await app.inject({
      method: 'PUT',
      url: '/mesas/mesa_t02',
      payload: { roomName: 'R', tableNumber: '1', status: 'DISPONIBLE', expectedVersion: 1 },
    });
    assert.equal(putRes.statusCode, 404, 'PUT /mesas/:id must not be exposed');
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
      url: '/ordenes/partidas',
      payload: {
        cuentaId: 'cta_t03',
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
      url: '/ordenes/partidas',
      payload: {
        cuentaId: 'cta_t03',
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
      url: '/ordenes/partidas',
      payload: {
        cuentaId: 'cta_t03',
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
    assert.equal(body.aggregateType, 'CUENTA');
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
        url: '/ordenes/partidas',
        payload: {
          cuentaId: 'cta_race',
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
        url: '/ordenes/partidas',
        payload: {
          cuentaId: 'cta_race',
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
      url: '/ordenes/partidas',
      payload: {
        cuentaId: ctaId,
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
        url: '/ordenes/partidas',
        payload: {
          cuentaId: 'cta_race',
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
        url: '/ordenes/partidas',
        payload: {
          cuentaId: benchCtaId,
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

  it('WP014-T13: QI-014-02: Exact SQLite BigInt write/read roundtrip without Number coercion (> MAX_SAFE_INTEGER)', () => {
    // Value exceeds JavaScript Number.MAX_SAFE_INTEGER (9007199254740991)
    // If coerced to Number, 9007199254740993n becomes 9007199254740992 (loss of precision)
    const largeAmount = 9007199254740993n;
    const ctaId = 'cta_exact_roundtrip';
    const itmId = 'itm_exact_roundtrip';
    const modId = 'mod_exact_roundtrip';

    repo.saveCuentaSync(
      {
        id: ctaId,
        folioNumber: 99999,
        epochId: 'ep_exact',
        mesaId: null,
        accountType: 'COMEDOR',
        status: 'ABIERTA',
        subtotal: largeAmount,
        taxTotal: 0n,
        discountsTotal: 0n,
        tipsTotal: 0n,
        totalAmount: largeAmount,
        openedByUserId: 'usr_exact',
        openedAt: new Date().toISOString(),
        closedAt: null,
        version: 1,
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: itmId,
            cuentaId: ctaId,
            productId: 'prod_exact',
            productNameSnapshot: 'Exact Product',
            unitPriceApplied: largeAmount,
            quantity: 10000n,
            taxRateApplied: 0n,
            taxAmountApplied: 0n,
            discountAmountApplied: 0n,
            subtotal: largeAmount,
            total: largeAmount,
            status: 'ORDENADO',
            createdAt: new Date().toISOString(),
            modifiers: [
              {
                id: modId,
                cuentaItemId: itmId,
                modifierId: 'mod_exact',
                modifierNameSnapshot: 'Exact Modifier',
                modifierPriceApplied: largeAmount,
              },
            ],
          },
        ],
      },
      0,
    );

    // Read back via synchronous and asynchronous repository ports
    const fetchedSync = repo.getCuentaByIdSync(ctaId);
    assert.ok(fetchedSync);
    assert.equal(fetchedSync.subtotal, largeAmount);
    assert.equal(fetchedSync.totalAmount, largeAmount);
    assert.equal(fetchedSync.items[0]?.unitPriceApplied, largeAmount);
    assert.equal(fetchedSync.items[0]?.subtotal, largeAmount);
    assert.equal(fetchedSync.items[0]?.total, largeAmount);
    assert.equal(fetchedSync.items[0]?.modifiers[0]?.modifierPriceApplied, largeAmount);

    // Prove IEEE-754 Number conversion would have drifted
    assert.notEqual(
      fetchedSync.subtotal,
      BigInt(Number(largeAmount)),
      'Authoritative BigInt must NOT match lossy Float/Number conversion',
    );
  });

  it('WP014-T14: QI-014-05: clientOpId transport validation (400) and real outbox infrastructure failure rollback (500)', async () => {
    // -------------------------------------------------------------
    // Part A: Transport Boundary Validation of clientOpId (HTTP 400 VALIDATION_ERROR)
    // Non-UUID syntax must fail closed at transport boundary before transaction/mutation
    // -------------------------------------------------------------
    repo.saveMesaSync(
      {
        id: 'mesa_val_test',
        roomName: 'VIP',
        tableNumber: 'V-1',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    // 1. POST /cuentas with invalid clientOpId -> 400, zero mutation, zero outbox
    const openInvalidRes = await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_val_fail',
        mesaId: 'mesa_val_test',
        epochId: 'ep_tx',
        accountType: 'COMEDOR',
        openedByUserId: 'usr_tx',
        clientOpId: 'NOT_A_VALID_UUID_V4',
      },
    });
    assert.equal(openInvalidRes.statusCode, 400);
    const openErr = JSON.parse(openInvalidRes.body);
    assert.equal(openErr.error, 'VALIDATION_ERROR');
    assert.equal(repo.getCuentaByIdSync('cta_val_fail'), null, 'Cuenta must NOT be created');
    const mesaAfterValFail = repo.getMesaByIdSync('mesa_val_test');
    assert.equal(mesaAfterValFail?.status, 'DISPONIBLE', 'Mesa must remain DISPONIBLE');
    assert.equal(mesaAfterValFail?.version, 1, 'Mesa version must remain 1');
    const openOutboxFail = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      'NOT_A_VALID_UUID_V4',
    );
    assert.equal(openOutboxFail, undefined, 'Zero outbox records on validation failure');

    // Open cuenta successfully with valid UUID for subsequent mutation validation tests
    const validOpenOpId = crypto.randomUUID();
    const openValidRes = await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_val_test',
        mesaId: 'mesa_val_test',
        epochId: 'ep_tx',
        accountType: 'COMEDOR',
        openedByUserId: 'usr_tx',
        clientOpId: validOpenOpId,
      },
    });
    assert.equal(openValidRes.statusCode, 201);

    // 2. POST /ordenes/partidas with invalid clientOpId -> 400, zero item, version unchanged, zero outbox
    const addInvalidRes = await app.inject({
      method: 'POST',
      url: '/ordenes/partidas',
      payload: {
        id: 'itm_val_fail',
        cuentaId: 'cta_val_test',
        expectedVersion: 1,
        clientOpId: 'INVALID_OP_ID_123',
        productId: 'p_val',
        productNameSnapshot: 'Val Product',
        unitPriceApplied: '50.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
      },
    });
    assert.equal(addInvalidRes.statusCode, 400);
    const addErr = JSON.parse(addInvalidRes.body);
    assert.equal(addErr.error, 'VALIDATION_ERROR');
    const ctaAfterAddValFail = repo.getCuentaByIdSync('cta_val_test');
    assert.equal(ctaAfterAddValFail?.version, 1, 'Version must not advance');
    assert.equal(ctaAfterAddValFail?.items.length, 0, 'Item must not be added');
    const addOutboxFail = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      'INVALID_OP_ID_123',
    );
    assert.equal(addOutboxFail, undefined);

    // 3. PUT /cuentas/:id/cerrar with invalid clientOpId -> 400, account open, mesa occupied, zero outbox
    const closeInvalidRes = await app.inject({
      method: 'PUT',
      url: '/cuentas/cta_val_test/cerrar',
      payload: {
        expectedVersion: 1,
        clientOpId: 'INVALID_CLOSE_OP_ID',
        closedStatus: 'PAGADA',
      },
    });
    assert.equal(closeInvalidRes.statusCode, 400);
    const closeErr = JSON.parse(closeInvalidRes.body);
    assert.equal(closeErr.error, 'VALIDATION_ERROR');
    const ctaAfterCloseValFail = repo.getCuentaByIdSync('cta_val_test');
    assert.equal(ctaAfterCloseValFail?.status, 'ABIERTA', 'Cuenta must remain ABIERTA');
    assert.equal(ctaAfterCloseValFail?.version, 1);
    const mesaAfterCloseValFail = repo.getMesaByIdSync('mesa_val_test');
    assert.equal(mesaAfterCloseValFail?.status, 'OCUPADA', 'Mesa must remain OCUPADA');
    const closeOutboxFail = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      'INVALID_CLOSE_OP_ID',
    );
    assert.equal(closeOutboxFail, undefined);

    // -------------------------------------------------------------
    // Part B: Real Outbox / Infrastructure Persistence Failure Injection
    // Valid inputs, real failure inside synchronous SQLite transaction rolls back business state
    // -------------------------------------------------------------
    repo.saveMesaSync(
      {
        id: 'mesa_infra_fail',
        roomName: 'Bar',
        tableNumber: 'B-1',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    const originalEnqueue = outbox.enqueue.bind(outbox);

    // 1. POST /cuentas: forced outbox persistence failure rolls back Mesa & Cuenta
    const infraOpenOpId = crypto.randomUUID();
    outbox.enqueue = () => {
      throw new Error('SIMULATED_DISK_IO_PERSISTENCE_FAILURE');
    };

    const openInfraRes = await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_infra_fail',
        mesaId: 'mesa_infra_fail',
        epochId: 'ep_tx',
        accountType: 'COMEDOR',
        openedByUserId: 'usr_tx',
        clientOpId: infraOpenOpId,
      },
    });
    outbox.enqueue = originalEnqueue;

    assert.equal(openInfraRes.statusCode, 500);
    const openInfraBody = JSON.parse(openInfraRes.body);
    assert.equal(openInfraBody.error, 'INTERNAL_SERVER_ERROR');
    assert.equal(openInfraBody.message, 'An internal server error occurred');
    assert.equal(
      repo.getCuentaByIdSync('cta_infra_fail'),
      null,
      'Cuenta must NOT exist on outbox failure',
    );
    const mesaAfterInfraFail = repo.getMesaByIdSync('mesa_infra_fail');
    assert.equal(
      mesaAfterInfraFail?.status,
      'DISPONIBLE',
      'Mesa must remain DISPONIBLE on rollback',
    );
    assert.equal(mesaAfterInfraFail?.version, 1, 'Mesa version must remain 1 on rollback');
    assert.equal(mesaAfterInfraFail?.currentAccountId, null);
    const outboxOpenInfra = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      infraOpenOpId,
    );
    assert.equal(outboxOpenInfra, undefined, 'Zero outbox records on transaction rollback');

    // 2. Open cuenta successfully for item add rollback test
    const validInfraCtaOpId = crypto.randomUUID();
    const openInfraSuccessRes = await app.inject({
      method: 'POST',
      url: '/cuentas',
      payload: {
        id: 'cta_infra_success',
        mesaId: 'mesa_infra_fail',
        epochId: 'ep_tx',
        accountType: 'COMEDOR',
        openedByUserId: 'usr_tx',
        clientOpId: validInfraCtaOpId,
      },
    });
    assert.equal(openInfraSuccessRes.statusCode, 201);

    // 3. POST /ordenes/partidas: forced outbox persistence failure rolls back added item and version
    const infraAddItemOpId = crypto.randomUUID();
    outbox.enqueue = () => {
      throw new Error('SIMULATED_DISK_IO_PERSISTENCE_FAILURE');
    };

    const addItemInfraRes = await app.inject({
      method: 'POST',
      url: '/ordenes/partidas',
      payload: {
        id: 'itm_infra_fail',
        cuentaId: 'cta_infra_success',
        expectedVersion: 1,
        clientOpId: infraAddItemOpId,
        productId: 'p_tx',
        productNameSnapshot: 'TX Product',
        unitPriceApplied: '100.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
      },
    });
    outbox.enqueue = originalEnqueue;

    assert.equal(addItemInfraRes.statusCode, 500);
    const addInfraBody = JSON.parse(addItemInfraRes.body);
    assert.equal(addInfraBody.error, 'INTERNAL_SERVER_ERROR');
    assert.equal(addInfraBody.message, 'An internal server error occurred');
    const ctaAfterItemInfraFail = repo.getCuentaByIdSync('cta_infra_success');
    assert.equal(
      ctaAfterItemInfraFail?.version,
      1,
      'Cuenta version must NOT advance after rollback',
    );
    assert.equal(ctaAfterItemInfraFail?.items.length, 0, 'No item must be saved on outbox failure');
    const outboxAddInfra = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      infraAddItemOpId,
    );
    assert.equal(outboxAddInfra, undefined);

    // 4. PUT /cuentas/:id/cerrar: forced outbox persistence failure rolls back account close and table free
    const infraCloseOpId = crypto.randomUUID();
    outbox.enqueue = () => {
      throw new Error('SIMULATED_DISK_IO_PERSISTENCE_FAILURE');
    };

    const closeInfraRes = await app.inject({
      method: 'PUT',
      url: '/cuentas/cta_infra_success/cerrar',
      payload: {
        expectedVersion: 1,
        clientOpId: infraCloseOpId,
        closedStatus: 'PAGADA',
      },
    });
    outbox.enqueue = originalEnqueue;

    assert.equal(closeInfraRes.statusCode, 500);
    const closeInfraBody = JSON.parse(closeInfraRes.body);
    assert.equal(closeInfraBody.error, 'INTERNAL_SERVER_ERROR');
    assert.equal(closeInfraBody.message, 'An internal server error occurred');
    const ctaAfterCloseInfraFail = repo.getCuentaByIdSync('cta_infra_success');
    assert.equal(
      ctaAfterCloseInfraFail?.status,
      'ABIERTA',
      'Cuenta must remain ABIERTA on rollback',
    );
    assert.equal(ctaAfterCloseInfraFail?.version, 1);
    const mesaAfterCloseInfraFail = repo.getMesaByIdSync('mesa_infra_fail');
    assert.equal(
      mesaAfterCloseInfraFail?.status,
      'OCUPADA',
      'Mesa must remain OCUPADA on rollback',
    );
    assert.equal(mesaAfterCloseInfraFail?.currentAccountId, 'cta_infra_success');
    const outboxCloseInfra = edgeDb.queryRow(
      'SELECT id FROM outbox_queue WHERE client_op_id = ?;',
      infraCloseOpId,
    );
    assert.equal(outboxCloseInfra, undefined);
  });

  it('WP014-T15: QI-014-04: Cross-aggregate atomicity between Mesa and Cuenta', () => {
    // Open Account atomicity: failure during cuenta insert rolls back Mesa to DISPONIBLE
    repo.saveMesaSync(
      {
        id: 'mesa_atomicity_1',
        roomName: 'Salon',
        tableNumber: 'S-1',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    assert.throws(() => {
      edgeDb.runInTransaction(() => {
        // Step 1: occupy table
        repo.saveMesaSync(
          {
            id: 'mesa_atomicity_1',
            roomName: 'Salon',
            tableNumber: 'S-1',
            status: 'OCUPADA',
            currentAccountId: 'cta_atomicity_fail',
            version: 2,
            updatedAt: new Date().toISOString(),
          },
          1,
        );

        // Step 2: simulated crash during cuenta creation
        throw new Error('SIMULATED_CUENTA_INSERT_FAILURE');
      });
    });

    const mesaAfter = repo.getMesaByIdSync('mesa_atomicity_1');
    assert.equal(
      mesaAfter?.status,
      'DISPONIBLE',
      'Mesa must stay DISPONIBLE when transaction fails',
    );
    assert.equal(mesaAfter?.version, 1);
    assert.equal(mesaAfter?.currentAccountId, null);
  });

  it('WP014-T16: QI-014-06: Mesa OCC conflict and snapshot serialization via domain/repo without public route expansion', async () => {
    // 1. Create Mesa with initial version 1 via repository
    const initialMesa = repo.saveMesaSync(
      {
        id: 'mesa_occ_snapshot',
        roomName: 'Jardin',
        tableNumber: 'J-1',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );
    assert.equal(initialMesa.version, 1);

    // 2. Client A updates Mesa with expectedVersion 1 -> succeeds, version becomes 2
    const updatedA = repo.saveMesaSync(
      {
        id: 'mesa_occ_snapshot',
        roomName: 'Jardin Principal',
        tableNumber: 'J-1',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 2,
        updatedAt: new Date().toISOString(),
      },
      1,
    );
    assert.equal(updatedA.version, 2);
    assert.equal(updatedA.roomName, 'Jardin Principal');

    // 3. Client B attempts update with stale expectedVersion 1 -> OCC conflict
    assert.throws(
      () => {
        repo.saveMesaSync(
          {
            id: 'mesa_occ_snapshot',
            roomName: 'Jardin Secundario',
            tableNumber: 'J-1',
            status: 'DISPONIBLE',
            currentAccountId: null,
            version: 2,
            updatedAt: new Date().toISOString(),
          },
          1, // Stale! Current is 2
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof OCCConflictError);
        assert.equal(err.aggregateId, 'mesa_occ_snapshot');
        assert.equal(err.expectedVersion, 1);
        assert.equal(err.actualVersion, 2);

        // Verify current snapshot
        const currentSnapshot = err.currentSnapshot as Mesa;
        assert.ok(currentSnapshot, 'currentSnapshot must exist');
        assert.equal(currentSnapshot.id, 'mesa_occ_snapshot');
        assert.equal(currentSnapshot.roomName, 'Jardin Principal');
        assert.equal(currentSnapshot.version, 2);

        // 4. Verify snapshot serialization to DTO
        const serialized = serializeSnapshotToDTO(currentSnapshot);
        assert.equal(serialized.aggregateType, 'MESA');
        assert.equal(serialized.snapshot?.id, 'mesa_occ_snapshot');
        assert.equal(serialized.snapshot?.roomName, 'Jardin Principal');
        assert.equal(serialized.snapshot?.tableNumber, 'J-1');
        assert.equal(serialized.snapshot?.version, 2);

        return true;
      },
    );

    // 5. Assert PUT /mesas/:id returns 404 on Fastify app
    const putRes = await app.inject({
      method: 'PUT',
      url: '/mesas/mesa_occ_snapshot',
      payload: {
        roomName: 'Jardin Secundario',
        tableNumber: 'J-1',
        status: 'DISPONIBLE',
        expectedVersion: 1,
      },
    });
    assert.equal(putRes.statusCode, 404, 'PUT /mesas/:id must not be exposed');
  });

  it('WP014-T17: QI-014-05: Hardened Fastify error boundary returns generic 500 on unexpected internal exception', async () => {
    // Inject an unexpected internal exception with sensitive details
    const originalExecute = outbox.executeWithOutbox.bind(outbox);
    outbox.executeWithOutbox = () => {
      throw new Error('SENSITIVE_INTERNAL_DATABASE_TIMEOUT: connection=sqlite://secrets@host');
    };

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/cuentas',
        payload: {
          id: 'cta_leak_test',
          epochId: 'ep_1',
          accountType: 'COMEDOR',
          openedByUserId: 'u1',
          clientOpId: crypto.randomUUID(),
        },
      });

      assert.equal(res.statusCode, 500);
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'INTERNAL_SERVER_ERROR');
      assert.equal(body.message, 'An internal server error occurred');
      assert.equal(
        Object.keys(body).sort().join(','),
        'error,message',
        'Response must only contain generic error and message keys without raw stack or SQLite internals',
      );
    } finally {
      outbox.executeWithOutbox = originalExecute;
    }
  });
});
