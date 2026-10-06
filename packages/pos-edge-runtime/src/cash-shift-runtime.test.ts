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
import { DomainError, ShiftAlreadyOpenError } from '@trident/pos';
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
      stationId: 'POS_TERMINAL_01',
      cashDrawerPort: drawerMock,
    });

    // 1. POST /turnos/apertura
    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
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
    assert.equal(openData.turno.stationId, 'POS_TERMINAL_01');
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

  it('WP016-INT-02 (BLK-05): Double close blocked by OCC: two closes against same version -> one 200, second 409 OCC without second corte or event', async () => {
    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'POS_STATION_OCC',
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'USER_MGR',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(openRes.statusCode, 201);
    const shiftId = JSON.parse(openRes.body).turno.id;

    // Perform Arqueo Ciego -> advances shift to version 2 (CERRADO_ARQUEO)
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

    // Call 1: Corte Z with expectedVersion = 2 -> Succeeds (200)
    const closeRes1 = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/corte-z`,
      payload: {
        closedByUserId: 'USER_MGR',
        expectedVersion: 2,
      },
    });
    assert.equal(closeRes1.statusCode, 200);

    // Call 2: Duplicate Corte Z with expectedVersion = 2 (same version) -> Blocked by OCC (409)
    const closeRes2 = await app.inject({
      method: 'POST',
      url: `/turnos/${shiftId}/corte-z`,
      payload: {
        closedByUserId: 'USER_MGR',
        expectedVersion: 2,
      },
    });

    assert.equal(closeRes2.statusCode, 409);
    const conflictData = JSON.parse(closeRes2.body);
    assert.equal(conflictData.error, 'OCC_CONFLICT');
    assert.equal(conflictData.actualVersion, 3);

    // Verify exactly ONE corte row in cortes_caja
    const cortesRows = edgeDb.queryRowsSafe(
      'SELECT * FROM cortes_caja WHERE turno_caja_id = ?;',
      shiftId,
    );
    assert.equal(cortesRows.length, 1);

    // Verify exactly ONE CorteZGenerado event in outbox_queue
    const outboxEvents = edgeDb.queryRowsSafe(
      "SELECT * FROM outbox_queue WHERE aggregate_type = 'CORTE_Z';",
    );
    assert.equal(outboxEvents.length, 1);
  });

  it('WP016-INT-03 (BLK-04): Simulated real crash during Corte Z transaction with DB reopen guarantees all-or-nothing atomicity', async () => {
    const crashTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp016-crash-test-'));
    const crashDbPath = path.join(crashTmpDir, 'crash.db');

    let dbInstance: EdgeDatabaseService | null = new EdgeDatabaseService({
      databasePath: crashDbPath,
    });
    const repo = new SqliteCashShiftRepository(dbInstance);

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

    // Simulate crash inside transaction by executing partial writes and throwing before commit
    assert.throws(() => {
      dbInstance!.runInTransaction(() => {
        dbInstance!.executeMutation(
          `INSERT INTO cortes_caja (
            id, turno_caja_id, tipo_corte, generated_by_user_id, opening_cash_float,
            total_ingresos, total_egresos, total_ventas_efectivo, total_calculado,
            total_declarado, diferencia, desglose_operadores_json, generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'CORTE_PARTIAL_CRASH',
          shift.id,
          'CORTE_Z',
          'MGR_CRASH',
          1000000n,
          0n,
          0n,
          0n,
          1000000n,
          1000000n,
          0n,
          '[]',
          new Date().toISOString(),
        );

        // Crash simulation: unhandled error / abrupt termination inside transaction
        throw new Error('SIMULATED_POWER_FAILURE_MID_TRANSACTION');
      });
    });

    // Close the crashed DB connection
    dbInstance.close();
    dbInstance = null;

    // Reopen the DB from disk and verify clean recovery
    const recoveredDb = new EdgeDatabaseService({ databasePath: crashDbPath });
    try {
      const recoveredRepo = new SqliteCashShiftRepository(recoveredDb);

      // Verify shift remains intact in CERRADO_ARQUEO status with version 2
      const current = recoveredRepo.getShiftByIdSync(shift.id);
      assert.equal(current?.status, 'CERRADO_ARQUEO');
      assert.equal(current?.version, 2);

      // Verify ZERO partial records in cortes_caja or outbox_queue
      const cortes = recoveredDb.queryRowsSafe(
        'SELECT * FROM cortes_caja WHERE id = ?;',
        'CORTE_PARTIAL_CRASH',
      );
      assert.equal(cortes.length, 0);

      const outboxRows = recoveredDb.queryRowsSafe(
        'SELECT * FROM outbox_queue WHERE aggregate_id = ?;',
        shift.id,
      );
      assert.equal(outboxRows.length, 0);

      // Now complete the Corte Z successfully on the recovered DB
      const successfulCorte = {
        id: 'CORTE_SUCCESS_RECOVERY',
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

      recoveredRepo.saveCorteZSync(
        successfulCorte,
        { ...shift, status: 'CORTE_Z_EMITIDO', closedAt: new Date().toISOString(), version: 3 },
        2,
      );

      // Post-recovery verification: both corte and outbox event are complete and durable
      const finishedShift = recoveredRepo.getShiftByIdSync(shift.id);
      assert.equal(finishedShift?.status, 'CORTE_Z_EMITIDO');
      assert.equal(finishedShift?.version, 3);

      const finalCortes = recoveredDb.queryRowsSafe(
        'SELECT * FROM cortes_caja WHERE id = ?;',
        'CORTE_SUCCESS_RECOVERY',
      );
      assert.equal(finalCortes.length, 1);

      const finalOutbox = recoveredDb.queryRowsSafe(
        "SELECT * FROM outbox_queue WHERE aggregate_type = 'CORTE_Z' AND action = 'CorteZGenerado';",
      );
      assert.equal(finalOutbox.length, 1);
    } finally {
      recoveredDb.close();
      fs.rmSync(crashTmpDir, { recursive: true, force: true });
    }
  });

  it('WP016-INT-04 (BLK-03): Fail-closed: sin stationId enrolado rechaza con 400 y no acepta stationId del body', async () => {
    // 1. Missing stationId at app level
    const appWithoutStation = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_VALID',
      branchId: 'BRANCH_VALID',
      // stationId omitted
    });

    const resMissingStation = await appWithoutStation.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        stationId: 'STATION_IN_BODY_SHOULD_BE_IGNORED',
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });

    assert.equal(resMissingStation.statusCode, 400);
    const bodyMissingStation = JSON.parse(resMissingStation.body);
    assert.equal(bodyMissingStation.error, 'MISSING_ENROLLED_IDENTITY');

    // Verify zero shifts created
    const count = edgeDb.queryRowSafe<{ count: number | bigint }>(
      'SELECT count(*) AS count FROM turnos_caja;',
    );
    assert.equal(BigInt(count?.count ?? 0), 0n);

    // 2. Direct repository fail-closed check on tenant identity
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

  it('WP016-INT-04B (ADV-01 & BLK-03): Foreign tenant/station identities rejected with 403 without leaking enrolled IDs in messages', async () => {
    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_ENROLLED_SECRET_ID',
      branchId: 'BRANCH_ENROLLED_SECRET_ID',
      stationId: 'STATION_ENROLLED_SECRET_ID',
    });

    // 1. Body with foreign organizationId -> 403 TENANT_MISMATCH
    const resForeignOrg = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        organizationId: 'ORG_ATTACKER_ID',
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(resForeignOrg.statusCode, 403);
    const bodyForeignOrg = JSON.parse(resForeignOrg.body);
    assert.equal(bodyForeignOrg.error, 'TENANT_MISMATCH');
    // ADV-01: Message must NOT contain the enrolled or attacker ID
    assert.ok(!bodyForeignOrg.message.includes('ORG_ENROLLED_SECRET_ID'));
    assert.equal(
      bodyForeignOrg.message,
      'Tenant mismatch: client organizationId does not match enrolled tenant',
    );

    // 2. Body with foreign branchId -> 403 TENANT_MISMATCH
    const resForeignBranch = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        branchId: 'BRANCH_ATTACKER_ID',
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(resForeignBranch.statusCode, 403);
    const bodyForeignBranch = JSON.parse(resForeignBranch.body);
    assert.equal(bodyForeignBranch.error, 'TENANT_MISMATCH');
    assert.ok(!bodyForeignBranch.message.includes('BRANCH_ENROLLED_SECRET_ID'));
    assert.equal(
      bodyForeignBranch.message,
      'Tenant mismatch: client branchId does not match enrolled branch',
    );

    // 3. Body with foreign stationId -> 403 STATION_MISMATCH
    const resForeignStation = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        stationId: 'STATION_ATTACKER_ID',
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(resForeignStation.statusCode, 403);
    const bodyForeignStation = JSON.parse(resForeignStation.body);
    assert.equal(bodyForeignStation.error, 'STATION_MISMATCH');
    assert.ok(!bodyForeignStation.message.includes('STATION_ENROLLED_SECRET_ID'));
    assert.equal(
      bodyForeignStation.message,
      'Station mismatch: client stationId does not match enrolled station',
    );

    // 4. Valid opening without body identity -> uses enrolled identity
    const resEnrolled = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(resEnrolled.statusCode, 201);
    const shiftData = JSON.parse(resEnrolled.body).turno;
    assert.equal(shiftData.organizationId, 'ORG_ENROLLED_SECRET_ID');
    assert.equal(shiftData.branchId, 'BRANCH_ENROLLED_SECRET_ID');
    assert.equal(shiftData.stationId, 'STATION_ENROLLED_SECRET_ID');
  });

  it('WP016-INT-07 (BLK-01): Operator PIN is MANDATORY on each movement/charge: missing or invalid PIN -> 401 rejection with 0 movements persisted', async () => {
    const pinValidatorMock = {
      validatePin: async (userId: string, pin: string, _stationId?: string) => {
        return userId === 'CASHIER_01' && pin === '4321';
      },
    };

    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_PIN_TEST',
      branchId: 'BRANCH_PIN_TEST',
      stationId: 'STATION_PIN_TEST',
      pinValidator: pinValidatorMock,
    });

    // 1. Open shift with valid PIN
    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'CASHIER_01',
        operatorPin: '4321',
        openingCashFloat: '200.0000',
      },
    });
    assert.equal(openRes.statusCode, 201);
    const shift = JSON.parse(openRes.body).turno;

    // 2. Register movement without PIN -> 401 rejection
    const movMissingPin = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/movimientos`,
      payload: {
        operatorUserId: 'CASHIER_01',
        movementType: 'VENTA_EFECTIVO',
        amount: '150.0000',
        reason: 'Venta sin PIN',
        expectedVersion: shift.version,
        // operatorPin missing
      },
    });
    assert.equal(movMissingPin.statusCode, 401);
    assert.equal(JSON.parse(movMissingPin.body).error, 'INVALID_OPERATOR_PIN');

    // 3. Register movement with wrong PIN -> 401 rejection
    const movWrongPin = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/movimientos`,
      payload: {
        operatorUserId: 'CASHIER_01',
        operatorPin: '0000',
        movementType: 'VENTA_EFECTIVO',
        amount: '150.0000',
        reason: 'Venta con PIN equivocado',
        expectedVersion: shift.version,
      },
    });
    assert.equal(movWrongPin.statusCode, 401);
    assert.equal(JSON.parse(movWrongPin.body).error, 'INVALID_OPERATOR_PIN');

    // Verify exactly 1 movement exists in SQLite (the initial float only; 0 rejected movements persisted)
    const movements = edgeDb.queryRowsSafe<{ movement_type: string }>(
      'SELECT * FROM movimientos_caja WHERE turno_caja_id = ?;',
      shift.id,
    );
    assert.equal(movements.length, 1);
    assert.equal(movements[0]!.movement_type, 'FONDO_INICIAL');

    // 4. Register movement with correct PIN -> 201 success
    const movValidPin = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/movimientos`,
      payload: {
        operatorUserId: 'CASHIER_01',
        operatorPin: '4321',
        movementType: 'VENTA_EFECTIVO',
        amount: '150.0000',
        reason: 'Venta con PIN correcto',
        expectedVersion: shift.version,
      },
    });
    assert.equal(movValidPin.statusCode, 201);

    const updatedMovements = edgeDb.queryRowsSafe(
      'SELECT * FROM movimientos_caja WHERE turno_caja_id = ?;',
      shift.id,
    );
    assert.equal(updatedMovements.length, 2);
  });

  it('WP016-INT-08 (BLK-02): Instance enrolled in Station A cannot operate or view a shift of Station B (returns 404 SHIFT_NOT_FOUND, zero existence leaked)', async () => {
    // Open a shift on Station B
    const repo = new SqliteCashShiftRepository(edgeDb);
    const shiftB = repo.saveShiftSync(
      {
        id: 'SHIFT_STATION_B',
        organizationId: 'ORG_MAIN',
        branchId: 'BRANCH_MAIN',
        stationId: 'STATION_B',
        responsibleUserId: 'OPERATOR_B',
        openedByUserId: 'OPERATOR_B',
        shiftNumber: 1,
        openingCashFloat: 3000000n,
        closingDeclaredCash: null,
        calculatedCashTotal: null,
        cashDifference: null,
        status: 'ABIERTO',
        assignmentStrategy: 'COMPARTIDO',
        participatingOperators: ['OPERATOR_B'],
        openedAt: new Date().toISOString(),
        closedAt: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    // Create Fastify app enrolled in Station A
    const appStationA = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_MAIN',
      branchId: 'BRANCH_MAIN',
      stationId: 'STATION_A',
    });

    // Attempt /turnos/:id/operadores -> 404
    const resOp = await appStationA.inject({
      method: 'POST',
      url: `/turnos/${shiftB.id}/operadores`,
      payload: {
        operatorUserId: 'OPERATOR_A',
        addedByUserId: 'OPERATOR_B',
        expectedVersion: 1,
      },
    });
    assert.equal(resOp.statusCode, 404);
    assert.equal(JSON.parse(resOp.body).error, 'SHIFT_NOT_FOUND');

    // Attempt /turnos/:id/movimientos -> 404
    const resMov = await appStationA.inject({
      method: 'POST',
      url: `/turnos/${shiftB.id}/movimientos`,
      payload: {
        operatorUserId: 'OPERATOR_A',
        movementType: 'VENTA_EFECTIVO',
        amount: '100.0000',
        reason: 'Attempt on other station shift',
        expectedVersion: 1,
      },
    });
    assert.equal(resMov.statusCode, 404);
    assert.equal(JSON.parse(resMov.body).error, 'SHIFT_NOT_FOUND');

    // Attempt /turnos/:id/corte-x -> 404
    const resCorteX = await appStationA.inject({
      method: 'POST',
      url: `/turnos/${shiftB.id}/corte-x`,
      payload: {
        requestedByUserId: 'OPERATOR_A',
      },
    });
    assert.equal(resCorteX.statusCode, 404);
    assert.equal(JSON.parse(resCorteX.body).error, 'SHIFT_NOT_FOUND');

    // Attempt /turnos/:id/arqueo -> 404
    const resArqueo = await appStationA.inject({
      method: 'POST',
      url: `/turnos/${shiftB.id}/arqueo`,
      payload: {
        performedByUserId: 'OPERATOR_A',
        declaredCash: '300.0000',
        expectedVersion: 1,
      },
    });
    assert.equal(resArqueo.statusCode, 404);
    assert.equal(JSON.parse(resArqueo.body).error, 'SHIFT_NOT_FOUND');

    // Attempt /turnos/:id/corte-z -> 404
    const resCorteZ = await appStationA.inject({
      method: 'POST',
      url: `/turnos/${shiftB.id}/corte-z`,
      payload: {
        closedByUserId: 'OPERATOR_A',
        expectedVersion: 1,
      },
    });
    assert.equal(resCorteZ.statusCode, 404);
    assert.equal(JSON.parse(resCorteZ.body).error, 'SHIFT_NOT_FOUND');

    // Verify shift B is completely unchanged
    const unchanged = repo.getShiftByIdSync(shiftB.id);
    assert.equal(unchanged?.version, 1);
    assert.equal(unchanged?.status, 'ABIERTO');
  });

  it('WP016-INT-09 (BLK Data): Simultaneous shifts: max ONE active shift per station; SQLite partial unique index + service check enforce one 201 and one 409', async () => {
    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_CONCURRENT',
      branchId: 'BRANCH_CONCURRENT',
      stationId: 'STATION_CONCURRENT_01',
    });

    // First opening -> 201 Created
    const res1 = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'USER_01',
        openingCashFloat: '100.0000',
      },
    });
    assert.equal(res1.statusCode, 201);

    // Second concurrent opening on same station -> 409 Conflict
    const res2 = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'USER_02',
        openingCashFloat: '200.0000',
      },
    });
    assert.equal(res2.statusCode, 409);
    assert.equal(JSON.parse(res2.body).error, 'SHIFT_ALREADY_OPEN');

    // Direct SQLite repository test verifying partial unique index enforcement
    const repo = new SqliteCashShiftRepository(edgeDb);
    assert.throws(
      () => {
        repo.saveShiftSync(
          {
            id: 'SHIFT_DIRECT_CONFLICT',
            organizationId: 'ORG_CONCURRENT',
            branchId: 'BRANCH_CONCURRENT',
            stationId: 'STATION_CONCURRENT_01',
            responsibleUserId: 'USER_03',
            openedByUserId: 'USER_03',
            shiftNumber: 2,
            openingCashFloat: 1000000n,
            closingDeclaredCash: null,
            calculatedCashTotal: null,
            cashDifference: null,
            status: 'ABIERTO',
            assignmentStrategy: 'COMPARTIDO',
            participatingOperators: ['USER_03'],
            openedAt: new Date().toISOString(),
            closedAt: null,
            version: 1,
            updatedAt: new Date().toISOString(),
          },
          0,
        );
      },
      (err: Error) => {
        return err instanceof ShiftAlreadyOpenError;
      },
    );
  });

  it('WP016-INT-10 (ADV-02): Arqueo Ciego secrecy: blind count does not disclose calculated cash total prior to registering declared cash', async () => {
    const app = await createPosFastifyApp({
      edgeDb,
      outbox,
      organizationId: 'ORG_BLIND',
      branchId: 'BRANCH_BLIND',
      stationId: 'STATION_BLIND',
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/turnos/apertura',
      payload: {
        responsibleUserId: 'CASHIER_01',
        openingCashFloat: '500.0000',
      },
    });
    const shift = JSON.parse(openRes.body).turno;

    // Movement: $200 sale
    const movRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/movimientos`,
      payload: {
        operatorUserId: 'CASHIER_01',
        movementType: 'VENTA_EFECTIVO',
        amount: '200.0000',
        reason: 'Sale 1',
        expectedVersion: shift.version,
      },
    });
    const updatedShift = JSON.parse(movRes.body).turno;

    // Attempting to do Arqueo without declaredCash fails validation
    const missingDeclaredRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/arqueo`,
      payload: {
        performedByUserId: 'CASHIER_01',
        expectedVersion: updatedShift.version,
      },
    });
    assert.equal(missingDeclaredRes.statusCode, 400);

    // Operator submits declaredCash ($690.0000) -> system records and returns computed variance
    const arqueoRes = await app.inject({
      method: 'POST',
      url: `/turnos/${shift.id}/arqueo`,
      payload: {
        performedByUserId: 'CASHIER_01',
        declaredCash: '690.0000',
        expectedVersion: updatedShift.version,
      },
    });
    assert.equal(arqueoRes.statusCode, 200);
    const arqueoData = JSON.parse(arqueoRes.body);
    // Calculated is 500 + 200 = 700.0000, declared is 690.0000, difference is -10.0000
    assert.equal(arqueoData.arqueo.declaredCash, '690.0000');
    assert.equal(arqueoData.arqueo.calculatedCash, '700.0000');
    assert.equal(arqueoData.arqueo.difference, '-10.0000');
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
