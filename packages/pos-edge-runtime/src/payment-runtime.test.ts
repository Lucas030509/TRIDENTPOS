import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import type { CuentaStatus } from '@trident/pos';
import {
  createPosFastifyApp,
  SqliteCashShiftRepository,
  SqliteDiningRoomRepository,
  SqlitePaymentRepository,
} from './index.js';
import type { FastifyInstance } from 'fastify';

const defaultTestPinValidator = {
  validatePin: async (_userId: string, pin: string, _stationId?: string) => {
    return pin === '1234' || pin === '4321';
  },
};

describe('TRIDENTPOS WP-016C Payment Orchestration & Account Settlement Integration Suite (ADR-012 / ADR-013 / DEC-015 / DEC-017)', () => {
  let tmpDir: string;
  let dbPath: string;
  let edgeDb: EdgeDatabaseService;
  let outbox: EdgeOutboxPersistence;
  let diningRepo: SqliteDiningRoomRepository;
  let cashRepo: SqliteCashShiftRepository;
  let paymentRepo: SqlitePaymentRepository;
  let app: FastifyInstance;
  let drawerKicked: boolean;

  const orgId = 'ORG_WP016C';
  const branchId = 'BRANCH_WP016C';
  const stationId = 'STATION_WP016C';
  const cashierUserId = 'user_cashier_01';
  const validPin = '1234';

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp016c-payment-test-'));
    dbPath = path.join(tmpDir, 'edge.db');
    edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    outbox = new EdgeOutboxPersistence(edgeDb);
    diningRepo = new SqliteDiningRoomRepository(edgeDb);
    cashRepo = new SqliteCashShiftRepository(edgeDb, { outboxPersistence: outbox });
    paymentRepo = new SqlitePaymentRepository(edgeDb, {
      organizationId: orgId,
      branchId,
      stationId,
      outboxPersistence: outbox,
      diningRepo,
    });

    drawerKicked = false;
    const drawerMock = {
      kickDrawer: async () => {
        drawerKicked = true;
      },
    };

    app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: orgId,
      branchId,
      stationId,
      cashDrawerPort: drawerMock,
      pinValidator: defaultTestPinValidator,
      cashShiftRepository: cashRepo,
      paymentRepository: paymentRepo,
    });
    await app.ready();
  });

  afterEach(async () => {
    try {
      if (app) {
        await app.close();
      }
      if (edgeDb.isOpen()) {
        edgeDb.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function openTestShift(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        organizationId: orgId,
        branchId,
        stationId,
        responsibleUserId: cashierUserId,
        openedByUserId: cashierUserId,
        openingCashFloat: '1000.0000',
        operatorPin: validPin,
      },
    });
    assert.equal(res.statusCode, 201, `Failed to open shift: ${res.body}`);
    const data = JSON.parse(res.body);
    return data.turno.id;
  }

  function seedTestCuenta(cuentaId: string, totalAmount: bigint, status: CuentaStatus = 'ABIERTA') {
    const now = new Date().toISOString();
    return diningRepo.saveCuentaSync(
      {
        id: cuentaId,
        folioNumber: 101,
        epochId: 'epoch_01',
        mesaId: null,
        accountType: 'COMEDOR',
        status,
        subtotal: totalAmount,
        taxTotal: 0n,
        discountsTotal: 0n,
        tipsTotal: 0n,
        totalAmount,
        openedByUserId: cashierUserId,
        currentWaiterUserId: cashierUserId,
        guestCount: 2,
        openedAt: now,
        closedAt: null,
        version: 1,
        updatedAt: now,
        items: [],
      },
      0,
    );
  }

  it('WP016C-T01: SQLite Schema initializes pagos table with scale-4 INTEGER amounts and unique client_op_id constraint', () => {
    const tables = edgeDb.queryRowsSafe<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'pagos';",
    );
    assert.equal(tables.length, 1, 'Table pagos must exist');

    const columns = edgeDb.queryRowsSafe<{ name: string; type: string }>(
      "PRAGMA table_info('pagos');",
    );
    const colMap = new Map(columns.map((c) => [c.name, c.type.toUpperCase()]));
    assert.equal(colMap.get('amount'), 'INTEGER');
    assert.equal(colMap.get('tip_amount'), 'INTEGER');
    assert.equal(colMap.get('cash_given'), 'INTEGER');
    assert.equal(colMap.get('change_due'), 'INTEGER');
    assert.equal(colMap.get('client_op_id'), 'TEXT');
  });

  it('WP016C-T02: Single tender payment in cash (EFECTIVO) calculates change, records cash movement, kicks drawer and transitions account to PAGADA', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t02';
    // 50.0000 (500000n)
    seedTestCuenta(cuentaId, 500000n);

    const clientOpId = crypto.randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'EFECTIVO',
        amount: '50.0000',
        tipAmount: '5.0000',
        cashGiven: '100.0000',
        clientOpId,
      },
    });

    assert.equal(res.statusCode, 201, `Failed tender: ${res.body}`);
    const data = JSON.parse(res.body);

    assert.equal(data.accountSettled, true);
    assert.equal(data.accountStatus, 'PAGADA');
    assert.equal(data.remainingBalance, '0.0000');
    assert.equal(data.amount, '50.0000');
    assert.equal(data.tipAmount, '5.0000');
    assert.equal(data.cashGiven, '100.0000');
    // Change: 100 - (50 + 5) = 45.0000
    assert.equal(data.changeDue, '45.0000');
    assert.equal(drawerKicked, true, 'Drawer kicker must be triggered for cash payment');

    // Verify cuenta in SQLite updated to PAGADA
    const updatedCuenta = diningRepo.getCuentaByIdSync(cuentaId);
    assert.ok(updatedCuenta);
    assert.equal(updatedCuenta.status, 'PAGADA');
    assert.equal(updatedCuenta.version, 2);

    // Verify movimientos_caja recorded VENTA_EFECTIVO of amount + tip (55.0000)
    const movRows = edgeDb.queryRowsSafe<{ movement_type: string; amount: number | bigint }>(
      "SELECT movement_type, amount FROM movimientos_caja WHERE turno_caja_id = ? AND movement_type = 'VENTA_EFECTIVO';",
      shiftId,
    );
    assert.equal(movRows.length, 1);
    assert.equal(BigInt(movRows[0]!.amount), 550000n);
  });

  it('WP016C-T03: Multi-tender split payment (TARJETA + EFECTIVO) maintains partial balance and transitions to PAGADA on final tender', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t03';
    // 100.0000 (1000000n)
    seedTestCuenta(cuentaId, 1000000n);

    // 1st Tender: TARJETA 40.0000
    const op1 = crypto.randomUUID();
    const res1 = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'TARJETA',
        amount: '40.0000',
        referenceAuthCode: 'AUTH_CARD_999',
        clientOpId: op1,
      },
    });
    assert.equal(res1.statusCode, 201);
    const data1 = JSON.parse(res1.body);
    assert.equal(data1.accountSettled, false);
    assert.equal(data1.remainingBalance, '60.0000');
    assert.equal(data1.accountStatus, 'ABIERTA');

    // 2nd Tender: EFECTIVO 60.0000
    const op2 = crypto.randomUUID();
    const res2 = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'EFECTIVO',
        amount: '60.0000',
        cashGiven: '60.0000',
        clientOpId: op2,
      },
    });
    assert.equal(res2.statusCode, 201);
    const data2 = JSON.parse(res2.body);
    assert.equal(data2.accountSettled, true);
    assert.equal(data2.remainingBalance, '0.0000');
    assert.equal(data2.accountStatus, 'PAGADA');

    // Verify 2 payments in pagos
    const payments = edgeDb.queryRowsSafe<{ id: string; amount: number | bigint }>(
      'SELECT id, amount FROM pagos WHERE cuenta_id = ?;',
      cuentaId,
    );
    assert.equal(payments.length, 2);
  });

  it('WP016C-T04: Idempotent replay: Resubmission with same clientOpId returns 200 without duplicate records or double-charging cash', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t04';
    seedTestCuenta(cuentaId, 800000n);

    const clientOpId = crypto.randomUUID();
    const payload = {
      turnoCajaId: shiftId,
      operatorUserId: cashierUserId,
      operatorPin: validPin,
      paymentMethod: 'EFECTIVO',
      amount: '80.0000',
      cashGiven: '100.0000',
      clientOpId,
    };

    // First attempt -> 201
    const res1 = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload,
    });
    assert.equal(res1.statusCode, 201);

    // Second attempt with identical clientOpId -> 200
    const res2 = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload,
    });
    assert.equal(res2.statusCode, 200);

    const data1 = JSON.parse(res1.body);
    const data2 = JSON.parse(res2.body);
    assert.equal(data1.id, data2.id);
    assert.equal(data2.accountSettled, true);

    // Verify exactly ONE payment row and ONE cash movement
    const countPagos = edgeDb.queryRowSafe<{ cnt: number | bigint }>(
      'SELECT count(*) as cnt FROM pagos WHERE cuenta_id = ?;',
      cuentaId,
    );
    assert.equal(Number(countPagos?.cnt), 1);

    const countMovs = edgeDb.queryRowSafe<{ cnt: number | bigint }>(
      "SELECT count(*) as cnt FROM movimientos_caja WHERE turno_caja_id = ? AND movement_type = 'VENTA_EFECTIVO';",
      shiftId,
    );
    assert.equal(Number(countMovs?.cnt), 1);
  });

  it('WP016C-T05: Operator PIN validation fail-closed (DEC-017): Invalid or missing PIN rejects request with 401 before any mutation', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t05';
    seedTestCuenta(cuentaId, 500000n);

    // Wrong PIN
    const resWrong = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: '9999',
        paymentMethod: 'EFECTIVO',
        amount: '50.0000',
        clientOpId: crypto.randomUUID(),
      },
    });
    assert.equal(resWrong.statusCode, 401);
    const err = JSON.parse(resWrong.body);
    assert.equal(err.error, 'INVALID_OPERATOR_PIN');

    // Zero records created
    const countPagos = edgeDb.queryRowSafe<{ cnt: number | bigint }>(
      'SELECT count(*) as cnt FROM pagos WHERE cuenta_id = ?;',
      cuentaId,
    );
    assert.equal(Number(countPagos?.cnt), 0);
  });

  it('WP016C-T06: Shift-gating validation: Payments submitted to closed, cancelled, or missing shift fail with 400', async () => {
    const cuentaId = 'cuenta_t06';
    seedTestCuenta(cuentaId, 500000n);

    // Non-existent shift
    const resMissing = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: 'shift_non_existent',
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'EFECTIVO',
        amount: '50.0000',
        clientOpId: crypto.randomUUID(),
      },
    });
    assert.equal(resMissing.statusCode, 404);
  });

  it('WP016C-T07: Account not payable validation: Already paid or cancelled account rejects payments with 400', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t07';
    seedTestCuenta(cuentaId, 500000n, 'PAGADA');

    const res = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'EFECTIVO',
        amount: '50.0000',
        clientOpId: crypto.randomUUID(),
      },
    });
    assert.equal(res.statusCode, 400);
    const err = JSON.parse(res.body);
    assert.equal(err.error, 'ACCOUNT_NOT_PAYABLE');
  });

  it('WP016C-T08: Atomic transaction rollback on crash/fault injection (DATA-COND-015-01): Simulated failure right before commit leaves zero partial state', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t08';
    seedTestCuenta(cuentaId, 1000000n);

    // Create repository with fault-injection hook that crashes on commit
    const crashingPaymentRepo = new SqlitePaymentRepository(edgeDb, {
      organizationId: orgId,
      branchId,
      stationId,
      outboxPersistence: outbox,
      diningRepo,
      onBeforeCommit: () => {
        throw new Error('SIMULATED_POWER_FAILURE_BEFORE_COMMIT');
      },
    });

    const crashingApp = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: orgId,
      branchId,
      stationId,
      pinValidator: defaultTestPinValidator,
      cashShiftRepository: cashRepo,
      paymentRepository: crashingPaymentRepo,
    });
    await crashingApp.ready();

    const clientOpId = crypto.randomUUID();
    const res = await crashingApp.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'EFECTIVO',
        amount: '100.0000',
        clientOpId,
      },
    });
    assert.equal(res.statusCode, 500);

    // Invariant check: zero payments in pagos
    const pagosRows = edgeDb.queryRowsSafe('SELECT * FROM pagos WHERE cuenta_id = ?;', cuentaId);
    assert.equal(pagosRows.length, 0);

    // Invariant check: cuenta remains ABIERTA with version 1
    const cuenta = diningRepo.getCuentaByIdSync(cuentaId);
    assert.equal(cuenta?.status, 'ABIERTA');
    assert.equal(cuenta?.version, 1);

    // Invariant check: zero cash movements
    const movRows = edgeDb.queryRowsSafe(
      "SELECT * FROM movimientos_caja WHERE turno_caja_id = ? AND movement_type = 'VENTA_EFECTIVO';",
      shiftId,
    );
    assert.equal(movRows.length, 0);

    // Invariant check: zero outbox events
    const outboxRows = edgeDb.queryRowsSafe(
      "SELECT * FROM outbox_queue WHERE aggregate_id = ? AND action = 'CuentaPagada';",
      cuentaId,
    );
    assert.equal(outboxRows.length, 0);

    await crashingApp.close();
  });

  it('WP016C-T09: Account settlement enqueues CuentaPagada event into outbox_queue with tenant metadata and scale-4 strings', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t09';
    seedTestCuenta(cuentaId, 750000n);

    const clientOpId = crypto.randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'TARJETA',
        amount: '75.0000',
        tipAmount: '10.0000',
        referenceAuthCode: 'AUTH_TEST_777',
        clientOpId,
      },
    });
    assert.equal(res.statusCode, 201);

    // Verify outbox_queue entry
    const outboxRows = edgeDb.queryRowsSafe<{
      organization_id: string;
      branch_id: string;
      action: string;
      payload: string;
    }>(
      "SELECT organization_id, branch_id, action, payload FROM outbox_queue WHERE aggregate_id = ? AND action = 'CuentaPagada';",
      cuentaId,
    );
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0]!.organization_id, orgId);
    assert.equal(outboxRows[0]!.branch_id, branchId);
    assert.equal(outboxRows[0]!.action, 'CuentaPagada');

    const payload = JSON.parse(outboxRows[0]!.payload);
    assert.equal(payload.cuentaId, cuentaId);
    assert.equal(payload.montos.total, '75.0000');
    assert.equal(payload.propina, '10.0000');
    assert.equal(payload.formasPago.length, 1);
    assert.equal(payload.formasPago[0].method, 'TARJETA');
    assert.equal(payload.formasPago[0].reference, 'AUTH_TEST_777');
  });

  it('WP016C-T10: GET /cuentas/:id/pagos returns complete summary with remainingBalance and all individual payments', async () => {
    const shiftId = await openTestShift();
    const cuentaId = 'cuenta_t10';
    seedTestCuenta(cuentaId, 2000000n); // 200.0000

    // Add first payment: 80.0000
    await app.inject({
      method: 'POST',
      url: `/cuentas/${cuentaId}/pagos`,
      payload: {
        turnoCajaId: shiftId,
        operatorUserId: cashierUserId,
        operatorPin: validPin,
        paymentMethod: 'TARJETA',
        amount: '80.0000',
        clientOpId: crypto.randomUUID(),
      },
    });

    // Query summary
    const resSummary = await app.inject({
      method: 'GET',
      url: `/cuentas/${cuentaId}/pagos`,
    });
    assert.equal(resSummary.statusCode, 200);
    const summary = JSON.parse(resSummary.body);

    assert.equal(summary.cuentaId, cuentaId);
    assert.equal(summary.totalAmount, '200.0000');
    assert.equal(summary.totalPaid, '80.0000');
    assert.equal(summary.remainingBalance, '120.0000');
    assert.equal(summary.isSettled, false);
    assert.equal(summary.payments.length, 1);
    assert.equal(summary.payments[0].amount, '80.0000');
  });
});
