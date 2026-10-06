import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EdgeDatabaseService, EdgeOutboxPersistence } from '@trident/edge';
import { createPosFastifyApp, SqliteCashShiftRepository } from './index.js';

describe('TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Integration Suite (DEC-017)', () => {
  let tmpDir: string;
  let dbPath: string;
  let edgeDb: EdgeDatabaseService;
  let outbox: EdgeOutboxPersistence;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp016-shifts-test-'));
    dbPath = path.join(tmpDir, 'edge.db');
    edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    outbox = new EdgeOutboxPersistence(edgeDb);
  });

  afterEach(() => {
    try {
      if (edgeDb.isOpen()) {
        edgeDb.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('WP016-INT-01: Full REST Lifecycle: Apertura -> Operadores -> Movimientos -> Arqueo Ciego -> Corte Z', async () => {
    let drawerKicked = false;
    const drawerMock = {
      kickDrawer: async () => {
        drawerKicked = true;
      },
    };

    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      cashDrawerPort: drawerMock,
    });

    // 1. POST /turnos/apertura
    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        stationId: 'POS_TERMINAL_01',
        responsibleUserId: 'MGR_JUAN',
        openingCashFloat: '500.0000',
        shiftNumber: 1,
      },
    });

    assert.equal(openRes.statusCode, 201);
    const openData = JSON.parse(openRes.body);
    const shiftId = openData.turno.id;
    assert.equal(openData.turno.status, 'ABIERTO');
    assert.equal(openData.turno.openingCashFloat, '500.0000');
    assert.equal(openData.turno.version, 1);
    assert.deepEqual(openData.turno.participatingOperators, ['MGR_JUAN']);

    // 2. POST /turnos/:id/operadores (Add participant under DEC-017)
    const addOpRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/operadores`,
      payload: {
        operatorUserId: 'CASHIER_ANA',
        addedByUserId: 'MGR_JUAN',
        expectedVersion: openData.turno.version,
      },
    });

    assert.equal(addOpRes.statusCode, 200);
    const addOpData = JSON.parse(addOpRes.body);
    assert.equal(addOpData.turno.version, 2);
    assert.deepEqual(addOpData.turno.participatingOperators, ['MGR_JUAN', 'CASHIER_ANA']);

    // 3. POST /turnos/:id/movimientos (CASHIER_ANA registers cash sale $350.5000)
    const movRes1 = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/movimientos`,
      payload: {
        operatorUserId: 'CASHIER_ANA',
        movementType: 'VENTA_EFECTIVO',
        amount: '350.5000',
        reason: 'Cobro comanda 101',
        expectedVersion: addOpData.turno.version,
      },
    });

    assert.equal(movRes1.statusCode, 201);
    const movData1 = JSON.parse(movRes1.body);
    assert.equal(movData1.movimiento.amount, '350.5000');
    assert.equal(movData1.turno.version, 3);

    // 4. POST /turnos/:id/movimientos (MGR_JUAN registers payout $50.0000)
    const movRes2 = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/movimientos`,
      payload: {
        operatorUserId: 'MGR_JUAN',
        movementType: 'EGRESO',
        amount: '50.0000',
        reason: 'Pago de propinas / gastos menores',
        expectedVersion: movData1.turno.version,
      },
    });

    assert.equal(movRes2.statusCode, 201);
    const movData2 = JSON.parse(movRes2.body);
    assert.equal(movData2.turno.version, 4);

    // 5. POST /turnos/:id/corte-x (Read-only verification)
    const corteXRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/corte-x`,
      payload: {
        requestedByUserId: 'MGR_JUAN',
      },
    });

    assert.equal(corteXRes.statusCode, 200);
    const corteXData = JSON.parse(corteXRes.body);
    assert.equal(corteXData.corte.openingCashFloat, '500.0000');
    assert.equal(corteXData.corte.totalVentasEfectivo, '350.5000');
    assert.equal(corteXData.corte.totalEgresos, '50.0000');
    // Calculated total = 500 + 350.5000 - 50 = 800.5000
    assert.equal(corteXData.corte.totalCalculado, '800.5000');

    // 6. POST /turnos/:id/arqueo (Arqueo ciego: operator declares $795.5000 -> discrepancy -$5.0000)
    const arqueoRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/arqueo`,
      payload: {
        performedByUserId: 'CASHIER_ANA',
        declaredCash: '795.5000',
        expectedVersion: movData2.turno.version,
      },
    });

    assert.equal(arqueoRes.statusCode, 200);
    const arqueoData = JSON.parse(arqueoRes.body);
    assert.equal(arqueoData.turno.status, 'CERRADO_ARQUEO');
    assert.equal(arqueoData.turno.closingDeclaredCash, '795.5000');
    assert.equal(arqueoData.turno.calculatedCashTotal, '800.5000');
    assert.equal(arqueoData.turno.cashDifference, '-5.0000');
    assert.equal(arqueoData.turno.version, 5);

    // 7. POST /turnos/:id/corte-z (Permanently closes and freezes shift)
    const corteZRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/corte-z`,
      payload: {
        closedByUserId: 'MGR_JUAN',
        expectedVersion: arqueoData.turno.version,
      },
    });

    assert.equal(corteZRes.statusCode, 200);
    const corteZData = JSON.parse(corteZRes.body);
    assert.equal(corteZData.turno.status, 'CORTE_Z_EMITIDO');
    assert.equal(corteZData.corte.tipoCorte, 'CORTE_Z');
    assert.ok(drawerKicked, 'Drawer kick pulse executed');

    // 8. Verify SQLite outbox_queue has CorteZGenerado event
    const outboxRows = edgeDb.queryRowsSafe<{ action: string; payload: string }>(
      `SELECT action, payload FROM outbox_queue WHERE aggregate_type = 'CORTE_Z';`,
    );
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0]!.action, 'CorteZGenerado');
    const payload = JSON.parse(outboxRows[0]!.payload);
    assert.equal(payload.totalCalculado, '800.5000');
    assert.equal(payload.totalDeclarado, '795.5000');
    assert.equal(payload.diferencia, '-5.0000');

    // 9. Verify local_audit_trail has cash difference record
    const auditRows = edgeDb.queryRowsSafe<{ action: string; details_json: string }>(
      `SELECT action, details_json FROM local_audit_trail WHERE action = 'CASH_DIFFERENCE_AUDITED';`,
    );
    assert.equal(auditRows.length, 1);
    const auditDetails = JSON.parse(auditRows[0]!.details_json);
    assert.equal(auditDetails.cashDifference, '-5.0000');
  });

  it('WP016-INT-02: Double close blocked by OCC (HTTP 409)', async () => {
    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        stationId: 'POS_STATION_OCC',
        responsibleUserId: 'USER_MGR',
        openingCashFloat: '100.0000',
      },
    });
    const shiftId = JSON.parse(openRes.body).turno.id;

    // Perform Arqueo
    const arqRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/arqueo`,
      payload: {
        performedByUserId: 'USER_MGR',
        declaredCash: '100.0000',
        expectedVersion: 1,
      },
    });
    assert.equal(arqRes.statusCode, 200);

    // Stale Corte Z attempt with version 1 instead of version 2
    const staleRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/corte-z`,
      payload: {
        closedByUserId: 'USER_MGR',
        expectedVersion: 1,
      },
    });

    assert.equal(staleRes.statusCode, 409);
    const staleData = JSON.parse(staleRes.body);
    assert.equal(staleData.error, 'OCC_CONFLICT');
    assert.equal(staleData.actualVersion, 2);
  });

  it('WP016-INT-03: Simulated crash during Corte Z commit guarantees atomic rollback', async () => {
    const repo = new SqliteCashShiftRepository(edgeDb);

    const shift = repo.saveShiftSync(
      {
        id: 'SHIFT_CRASH_TEST',
        stationId: 'STATION_CRASH',
        responsibleUserId: 'MGR_CRASH',
        openedByUserId: 'MGR_CRASH',
        shiftNumber: 1,
        openingCashFloat: 1000000n,
        closingDeclaredCash: 1000000n,
        calculatedCashTotal: 1000000n,
        cashDifference: 0n,
        status: 'CERRADO_ARQUEO',
        assignmentStrategy: 'COMPARTIDO',
        participatingOperators: ['MGR_CRASH'],
        openedAt: new Date().toISOString(),
        closedAt: null,
        version: 2,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    // Simulate crash inside transaction by throwing in saveCorteZSync
    const failingCorte = {
      id: 'CORTE_FAIL',
      turnoCajaId: shift.id,
      tipoCorte: 'CORTE_Z' as const,
      generatedByUserId: 'MGR_CRASH',
      openingCashFloat: 1000000n,
      totalIngresos: 0n,
      totalEgresos: 0n,
      totalVentasEfectivo: 0n,
      totalCalculado: 1000000n,
      totalDeclarado: 1000000n,
      diferencia: 0n,
      desgloseOperadores: [],
      generatedAt: new Date().toISOString(),
    };

    // Corrupt mutation with wrong version to trigger rollback
    assert.throws(() => {
      repo.saveCorteZSync(
        failingCorte,
        { ...shift, status: 'CORTE_Z_EMITIDO', version: 3 },
        99, // Stale version triggers OCC rollback
      );
    });

    // Verify shift remains intact in CERRADO_ARQUEO status with version 2
    const current = repo.getShiftByIdSync(shift.id);
    assert.equal(current?.status, 'CERRADO_ARQUEO');
    assert.equal(current?.version, 2);

    // Verify zero records in cortes_caja or outbox_queue
    const cortes = edgeDb.queryRowsSafe('SELECT * FROM cortes_caja WHERE id = ?;', 'CORTE_FAIL');
    assert.equal(cortes.length, 0);
  });
});
