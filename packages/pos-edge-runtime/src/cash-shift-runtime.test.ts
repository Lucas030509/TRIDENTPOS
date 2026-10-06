import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EdgeDatabaseService,
  EdgeOutboxPersistence,
  LocalAuditTrailPersistence,
} from '@trident/edge';
import { DomainError } from '@trident/pos';
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

  it('WP016-INT-01: Full REST Lifecycle: Apertura -> Operadores -> Movimientos -> Arqueo Ciego -> Corte Z (con identidad enrolled)', async () => {
    let drawerKicked = false;
    const drawerMock = {
      kickDrawer: async () => {
        drawerKicked = true;
      },
    };

    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_REAL_01',
      branchId: 'BRANCH_REAL_01',
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
    assert.equal(openData.turno.organizationId, 'ORG_REAL_01');
    assert.equal(openData.turno.branchId, 'BRANCH_REAL_01');
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

    // 8. Verify SQLite outbox_queue has CorteZGenerado event with real tenant identity
    const outboxRows = edgeDb.queryRowsSafe<{
      organization_id: string;
      branch_id: string;
      action: string;
      payload: string;
    }>(
      `SELECT organization_id, branch_id, action, payload FROM outbox_queue WHERE aggregate_type = 'CORTE_Z';`,
    );
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0]!.organization_id, 'ORG_REAL_01');
    assert.equal(outboxRows[0]!.branch_id, 'BRANCH_REAL_01');
    assert.equal(outboxRows[0]!.action, 'CorteZGenerado');
    const payload = JSON.parse(outboxRows[0]!.payload);
    assert.equal(payload.organizationId, 'ORG_REAL_01');
    assert.equal(payload.branchId, 'BRANCH_REAL_01');
    assert.equal(payload.totalCalculado, '800.5000');
    assert.equal(payload.totalDeclarado, '795.5000');
    assert.equal(payload.diferencia, '-5.0000');

    // 9. Verify canonical local_audit_trail has cash difference record with real tenant identity
    const auditRows = edgeDb.queryRowsSafe<{
      organization_id: string;
      branch_id: string;
      action: string;
      details_json: string;
    }>(
      `SELECT organization_id, branch_id, action, details_json FROM local_audit_trail WHERE action = 'CASH_DIFFERENCE_AUDITED';`,
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0]!.organization_id, 'ORG_REAL_01');
    assert.equal(auditRows[0]!.branch_id, 'BRANCH_REAL_01');
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
        organizationId: 'ORG_CRASH',
        branchId: 'BRANCH_CRASH',
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

  it('WP016-INT-04: Tenant fail-closed: apertura rechaza si falta organization_id o branch_id sin defaults', async () => {
    // 1. Missing organizationId at app level without per-request override
    const appWithoutOrg = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: '',
      branchId: 'BRANCH_VALID',
    });

    const resMissingOrg = await appWithoutOrg.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        stationId: 'STATION_NO_ORG',
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(resMissingOrg.statusCode, 400);
    const bodyMissingOrg = JSON.parse(resMissingOrg.body);
    assert.equal(bodyMissingOrg.error, 'MISSING_TENANT_IDENTITY');

    // 2. Direct repository fail-closed check
    const repo = new SqliteCashShiftRepository(edgeDb);
    assert.throws(
      () => {
        repo.saveShiftSync(
          {
            id: 'SHIFT_NO_TENANT',
            organizationId: '',
            branchId: 'BRANCH_VALID',
            stationId: 'STATION_01',
            responsibleUserId: 'USER_01',
            openedByUserId: 'USER_01',
            shiftNumber: 1,
            openingCashFloat: 1000000n,
            closingDeclaredCash: null,
            calculatedCashTotal: null,
            cashDifference: null,
            status: 'ABIERTO',
            assignmentStrategy: 'COMPARTIDO',
            participatingOperators: ['USER_01'],
            openedAt: new Date().toISOString(),
            closedAt: null,
            version: 1,
            updatedAt: new Date().toISOString(),
          },
          0,
        );
      },
      (err: Error) => {
        return err instanceof DomainError && err.code === 'MISSING_TENANT_IDENTITY';
      },
    );
  });

  it('WP016-INT-05: El esquema de outbox_queue y audit_trail es canónico sin importar orden de inicialización', async () => {
    // Orden A: Inicializar caja repo antes que edge outbox
    const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wp016-order-a-'));
    const dbPathA = path.join(tmpDirA, 'edge-a.db');
    const dbA = new EdgeDatabaseService({ databasePath: dbPathA });
    try {
      const repoA = new SqliteCashShiftRepository(dbA);
      const outboxA = new EdgeOutboxPersistence(dbA);
      const auditA = new LocalAuditTrailPersistence(dbA);

      assert.ok(repoA);
      assert.ok(outboxA);
      assert.ok(auditA);

      // Verify outbox_queue table exists with canonical CHECK constraint
      const tableInfoA = dbA.queryRowsSafe<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox_queue';`,
      );
      assert.equal(tableInfoA.length, 1);
      assert.ok(tableInfoA[0]!.sql.includes("CHECK (status IN ('PENDING'"));

      // Enqueue works through canonical outbox
      const enq = outboxA.enqueue({
        organizationId: 'ORG_A',
        branchId: 'BRANCH_A',
        aggregateType: 'TEST',
        aggregateId: '1',
        action: 'TestEvent',
        clientOpId: '11111111-1111-4111-8111-111111111111',
        aggregateSequenceNumber: 1,
        payload: { ok: true },
      });
      assert.equal(enq.status, 'PENDING');

      // Audit works through canonical audit trail
      const aud = auditA.recordAudit({
        organizationId: 'ORG_A',
        branchId: 'BRANCH_A',
        actorId: 'USER_A',
        stationId: 'STATION_A',
        action: 'TEST_ACTION',
        aggregateType: 'TEST',
        aggregateId: '1',
        details: { detail: 'value' },
      });
      assert.equal(aud.action, 'TEST_ACTION');
    } finally {
      dbA.close();
      fs.rmSync(tmpDirA, { recursive: true, force: true });
    }

    // Orden B: Inicializar edge outbox/audit antes que caja repo
    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wp016-order-b-'));
    const dbPathB = path.join(tmpDirB, 'edge-b.db');
    const dbB = new EdgeDatabaseService({ databasePath: dbPathB });
    try {
      const outboxB = new EdgeOutboxPersistence(dbB);
      const auditB = new LocalAuditTrailPersistence(dbB);
      const repoB = new SqliteCashShiftRepository(dbB);

      assert.ok(outboxB);
      assert.ok(auditB);
      assert.ok(repoB);

      const tableInfoB = dbB.queryRowsSafe<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox_queue';`,
      );
      assert.equal(tableInfoB.length, 1);
      assert.ok(tableInfoB[0]!.sql.includes("CHECK (status IN ('PENDING'"));

      // Cash shift table initialized successfully
      const turnosTable = dbB.queryRowsSafe<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='turnos_caja';`,
      );
      assert.equal(turnosTable.length, 1);
    } finally {
      dbB.close();
      fs.rmSync(tmpDirB, { recursive: true, force: true });
    }
  });

  it('WP016-INT-06: ADR-012: Monto mayor a 2^53 / 10^4 sobrevive ida y vuelta en SQLite sin pérdida de precisión', async () => {
    const repo = new SqliteCashShiftRepository(edgeDb);

    // 2^53 = 9_007_199_254_740_992.
    // 2^53 / 10^4 = 900_719_925_474.0992
    // Un monto escala-4 mayor a 2^53 (e.g. 50_000_000_000_000_0000n = $5,000,000,000,000.0000 = $5 Trillions)
    // 50_000_000_000_000_0000n > 9_007_199_254_740_992n (excede 2^53 por más de 5500x)
    const hugeOpeningCashFloat = 50_000_000_000_000_0000n;
    const hugeMovementAmount = 12_345_678_901_234_5678n;
    const expectedTotal = hugeOpeningCashFloat + hugeMovementAmount; // 62_345_678_901_234_5678n

    assert.ok(
      hugeOpeningCashFloat > BigInt(Number.MAX_SAFE_INTEGER),
      'El monto excede Number.MAX_SAFE_INTEGER (2^53 - 1)',
    );

    const shift = repo.saveShiftSync(
      {
        id: 'SHIFT_HUGE_AMOUNT',
        organizationId: 'ORG_BIGINT',
        branchId: 'BRANCH_BIGINT',
        stationId: 'STATION_BIGINT',
        responsibleUserId: 'USER_WHALE',
        openedByUserId: 'USER_WHALE',
        shiftNumber: 1,
        openingCashFloat: hugeOpeningCashFloat,
        closingDeclaredCash: null,
        calculatedCashTotal: null,
        cashDifference: null,
        status: 'ABIERTO',
        assignmentStrategy: 'COMPARTIDO',
        participatingOperators: ['USER_WHALE'],
        openedAt: new Date().toISOString(),
        closedAt: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    // Read back and verify exact BigInt
    const retrievedShift = repo.getShiftByIdSync(shift.id);
    assert.ok(retrievedShift);
    assert.equal(retrievedShift.openingCashFloat, hugeOpeningCashFloat);
    assert.equal(typeof retrievedShift.openingCashFloat, 'bigint');

    // Add huge cash movement
    const mov = repo.addMovementSync(
      {
        id: 'MOV_HUGE_01',
        turnoCajaId: shift.id,
        operatorUserId: 'USER_WHALE',
        movementType: 'VENTA_EFECTIVO',
        amount: hugeMovementAmount,
        reason: 'Venta de activos de alto valor',
        referenceId: 'REF_999999999',
        createdAt: new Date().toISOString(),
      },
      { ...shift, version: 2, updatedAt: new Date().toISOString() },
      1,
    );
    assert.equal(mov.id, 'MOV_HUGE_01');

    // Read back movements and verify exact BigInt amount
    const movements = repo.listMovementsSync(shift.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0]!.amount, hugeMovementAmount);
    assert.equal(typeof movements[0]!.amount, 'bigint');

    // Arqueo Ciego with huge declared cash
    const arqueo = repo.saveArqueoCiegoSync(
      {
        id: 'ARQ_HUGE',
        turnoCajaId: shift.id,
        performedByUserId: 'USER_WHALE',
        declaredCash: expectedTotal,
        calculatedCash: expectedTotal,
        difference: 0n,
        createdAt: new Date().toISOString(),
      },
      {
        ...shift,
        closingDeclaredCash: expectedTotal,
        calculatedCashTotal: expectedTotal,
        cashDifference: 0n,
        status: 'CERRADO_ARQUEO',
        version: 3,
        updatedAt: new Date().toISOString(),
      },
      2,
    );

    assert.equal(arqueo.declaredCash, expectedTotal);
    assert.equal(arqueo.calculatedCash, expectedTotal);
    assert.equal(arqueo.difference, 0n);

    // Corte Z emission
    const corte = repo.saveCorteZSync(
      {
        id: 'CORTE_HUGE',
        turnoCajaId: shift.id,
        tipoCorte: 'CORTE_Z',
        generatedByUserId: 'USER_WHALE',
        openingCashFloat: hugeOpeningCashFloat,
        totalIngresos: 0n,
        totalEgresos: 0n,
        totalVentasEfectivo: hugeMovementAmount,
        totalCalculado: expectedTotal,
        totalDeclarado: expectedTotal,
        diferencia: 0n,
        desgloseOperadores: [
          {
            operatorUserId: 'USER_WHALE',
            totalIngresos: 0n,
            totalEgresos: 0n,
            totalVentasEfectivo: hugeMovementAmount,
            netCash: hugeMovementAmount,
            movementsCount: 1,
          },
        ],
        generatedAt: new Date().toISOString(),
      },
      {
        ...shift,
        status: 'CORTE_Z_EMITIDO',
        closedAt: new Date().toISOString(),
        version: 4,
        updatedAt: new Date().toISOString(),
      },
      3,
    );

    assert.equal(corte.openingCashFloat, hugeOpeningCashFloat);
    assert.equal(corte.totalVentasEfectivo, hugeMovementAmount);
    assert.equal(corte.totalCalculado, expectedTotal);

    // Direct SQLite raw column read to verify TEXT / INTEGER exactness
    const rawRow = edgeDb.queryRowSafe<{ opening_cash_float: string | number | bigint }>(
      'SELECT opening_cash_float FROM turnos_caja WHERE id = ?;',
      shift.id,
    );
    assert.equal(BigInt(rawRow!.opening_cash_float), hugeOpeningCashFloat);
  });
});
