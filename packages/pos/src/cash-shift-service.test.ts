import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type ArqueoCiego,
  type CashShiftRepositoryPort,
  type CorteCaja,
  type IamPinValidatorPort,
  type MovimientoCaja,
  type TurnoCaja,
  CashShiftDomainService,
  DomainError,
  InvalidOperatorPinError,
  OCCConflictError,
  ShiftAlreadyOpenError,
  ShiftLockedError,
  UnauthorizedShiftOperatorError,
} from './index.js';

class InMemoryCashShiftRepository implements CashShiftRepositoryPort {
  public shifts = new Map<string, TurnoCaja>();
  public movements = new Map<string, MovimientoCaja[]>();
  public arqueos = new Map<string, ArqueoCiego>();
  public cortes = new Map<string, CorteCaja>();

  async getActiveShift(stationId: string): Promise<TurnoCaja | null> {
    for (const shift of this.shifts.values()) {
      if (
        shift.stationId === stationId &&
        (shift.status === 'ABIERTO' || shift.status === 'CERRADO_ARQUEO')
      ) {
        return { ...shift, participatingOperators: [...shift.participatingOperators] };
      }
    }
    return null;
  }

  async getShiftById(id: string): Promise<TurnoCaja | null> {
    const shift = this.shifts.get(id);
    return shift ? { ...shift, participatingOperators: [...shift.participatingOperators] } : null;
  }

  async saveShift(shift: TurnoCaja, expectedVersion: number): Promise<TurnoCaja> {
    const current = this.shifts.get(shift.id);
    if (expectedVersion === 0) {
      if (current) {
        throw new Error(`Shift ${shift.id} already exists`);
      }
    } else {
      if (!current || current.version !== expectedVersion) {
        throw new OCCConflictError(
          shift.id,
          expectedVersion,
          current ? current.version : 0,
          current ?? null,
        );
      }
    }
    this.shifts.set(shift.id, {
      ...shift,
      participatingOperators: [...shift.participatingOperators],
    });
    return { ...shift, participatingOperators: [...shift.participatingOperators] };
  }

  async addMovement(
    movement: MovimientoCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<MovimientoCaja> {
    await this.saveShift(shift, expectedVersion);
    const list = this.movements.get(shift.id) ?? [];
    list.push({ ...movement });
    this.movements.set(shift.id, list);
    return { ...movement };
  }

  async listMovements(shiftId: string): Promise<readonly MovimientoCaja[]> {
    return (this.movements.get(shiftId) ?? []).map((m) => ({ ...m }));
  }

  async saveArqueoCiego(
    arqueo: ArqueoCiego,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<ArqueoCiego> {
    await this.saveShift(shift, expectedVersion);
    this.arqueos.set(shift.id, { ...arqueo });
    return { ...arqueo };
  }

  async saveCorteZ(
    corte: CorteCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<CorteCaja> {
    await this.saveShift(shift, expectedVersion);
    this.cortes.set(shift.id, { ...corte });
    return { ...corte };
  }
}

const defaultPinValidator: IamPinValidatorPort = {
  validatePin: async (_userId: string, pin: string) => pin === '1234',
};

describe('TRIDENTPOS WP-016 Cash Management, Shifts & Arqueo Ciego Domain Suite (DEC-017)', () => {
  it('WP016-DOM-00: Fail-closed when tenant identity (organizationId or branchId) is missing', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    await assert.rejects(
      service.abrirTurno({
        organizationId: '',
        branchId: 'BRANCH_01',
        stationId: 'STATION_01',
        responsibleUserId: 'USER_MGR_01',
        openingCashFloat: 5000000n,
        operatorPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof DomainError);
        assert.equal((err as DomainError).code, 'MISSING_TENANT_IDENTITY');
        return true;
      },
    );

    await assert.rejects(
      service.abrirTurno({
        organizationId: 'ORG_01',
        branchId: '',
        stationId: 'STATION_01',
        responsibleUserId: 'USER_MGR_01',
        openingCashFloat: 5000000n,
        operatorPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof DomainError);
        assert.equal((err as DomainError).code, 'MISSING_TENANT_IDENTITY');
        return true;
      },
    );
  });

  it('WP016-DOM-01: Abre turno con fondo inicial y asignación compartida (DEC-017)', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR_01',
      openingCashFloat: 5000000n, // $500.0000
      shiftNumber: 1,
      operatorPin: '1234',
    });

    assert.equal(shift.organizationId, 'ORG_01');
    assert.equal(shift.branchId, 'BRANCH_01');
    assert.equal(shift.stationId, 'STATION_01');
    assert.equal(shift.responsibleUserId, 'USER_MGR_01');
    assert.equal(shift.openingCashFloat, 5000000n);
    assert.equal(shift.status, 'ABIERTO');
    assert.equal(shift.version, 1);
    assert.deepEqual(shift.participatingOperators, ['USER_MGR_01']);

    // Second shift open on same station must fail closed
    await assert.rejects(
      service.abrirTurno({
        organizationId: 'ORG_01',
        branchId: 'BRANCH_01',
        stationId: 'STATION_01',
        responsibleUserId: 'USER_MGR_02',
        openingCashFloat: 2000000n,
        operatorPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof ShiftAlreadyOpenError);
        return true;
      },
    );
  });

  it('WP016-DOM-02: Agrega operadores participantes a turno compartido (DEC-017)', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR_01',
      openingCashFloat: 10000000n, // $1000.0000
      operatorPin: '1234',
    });

    // Responsible adds Cashier A
    const updated = await service.agregarOperador({
      shiftId: shift.id,
      operatorUserId: 'USER_CASHIER_A',
      requestingUserId: 'USER_MGR_01',
      expectedVersion: shift.version,
      requestingPin: '1234',
    });

    assert.equal(updated.version, 2);
    assert.deepEqual(updated.participatingOperators, ['USER_MGR_01', 'USER_CASHIER_A']);

    // Non-participating user cannot add operators
    await assert.rejects(
      service.agregarOperador({
        shiftId: shift.id,
        operatorUserId: 'USER_CASHIER_B',
        requestingUserId: 'USER_STRANGER',
        expectedVersion: updated.version,
        requestingPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof UnauthorizedShiftOperatorError);
        return true;
      },
    );
  });

  it('WP016-DOM-03: Rechaza movimientos de operador no participante', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR_01',
      openingCashFloat: 5000000n,
      operatorPin: '1234',
    });

    await assert.rejects(
      service.registrarMovimiento({
        shiftId: shift.id,
        operatorUserId: 'USER_UNAUTHORIZED',
        movementType: 'VENTA_EFECTIVO',
        amount: 2500000n, // $250.0000
        reason: 'Cobro no autorizado',
        expectedVersion: shift.version,
        operatorPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof UnauthorizedShiftOperatorError);
        return true;
      },
    );
  });

  it('WP016-DOM-04: Cálculo exacto de cuadre de caja con desglose por operador (ADR-012)', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    let shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR',
      openingCashFloat: 5000000n, // $500.0000
      operatorPin: '1234',
    });

    // Add Cashier 1 and Cashier 2
    shift = await service.agregarOperador({
      shiftId: shift.id,
      operatorUserId: 'CASHIER_1',
      requestingUserId: 'USER_MGR',
      expectedVersion: shift.version,
      requestingPin: '1234',
    });

    shift = await service.agregarOperador({
      shiftId: shift.id,
      operatorUserId: 'CASHIER_2',
      requestingUserId: 'USER_MGR',
      expectedVersion: shift.version,
      requestingPin: '1234',
    });

    // Cashier 1 makes cash sales
    const mov1 = await service.registrarMovimiento({
      shiftId: shift.id,
      operatorUserId: 'CASHIER_1',
      movementType: 'VENTA_EFECTIVO',
      amount: 1505000n, // $150.5000
      reason: 'Venta mesa 1',
      expectedVersion: shift.version,
      operatorPin: '1234',
    });
    shift = mov1.shift;

    // Cashier 2 makes cash sales and payout
    const mov2 = await service.registrarMovimiento({
      shiftId: shift.id,
      operatorUserId: 'CASHIER_2',
      movementType: 'VENTA_EFECTIVO',
      amount: 3202500n, // $320.2500
      reason: 'Venta mesa 2',
      expectedVersion: shift.version,
      operatorPin: '1234',
    });
    shift = mov2.shift;

    const mov3 = await service.registrarMovimiento({
      shiftId: shift.id,
      operatorUserId: 'CASHIER_2',
      movementType: 'EGRESO',
      amount: 500000n, // $50.0000
      reason: 'Pago hielo',
      expectedVersion: shift.version,
      operatorPin: '1234',
    });
    shift = mov3.shift;

    // Corte X (read only)
    const corteX = await service.generarCorteX({
      shiftId: shift.id,
      requestedByUserId: 'USER_MGR',
      requestedByPin: '1234',
    });

    // Calculated = 500 + (150.5000 + 320.2500) - 50.0000 = 920.7500 = 9207500n
    assert.equal(corteX.openingCashFloat, 5000000n);
    assert.equal(corteX.totalVentasEfectivo, 4707500n);
    assert.equal(corteX.totalEgresos, 500000n);
    assert.equal(corteX.totalCalculado, 9207500n);

    // Verify per-operator breakdown
    const op1 = corteX.desgloseOperadores.find((o) => o.operatorUserId === 'CASHIER_1');
    const op2 = corteX.desgloseOperadores.find((o) => o.operatorUserId === 'CASHIER_2');
    assert.ok(op1 && op2);
    assert.equal(op1.totalVentasEfectivo, 1505000n);
    assert.equal(op1.netCash, 1505000n);
    assert.equal(op2.totalVentasEfectivo, 3202500n);
    assert.equal(op2.totalEgresos, 500000n);
    assert.equal(op2.netCash, 2702500n); // 320.2500 - 50.0000
  });

  it('WP016-DOM-05: Arqueo Ciego captura efectivo declarado antes de calcular descuadre', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    let shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR',
      openingCashFloat: 10000000n, // $1000.0000
      operatorPin: '1234',
    });

    const mov = await service.registrarMovimiento({
      shiftId: shift.id,
      operatorUserId: 'USER_MGR',
      movementType: 'VENTA_EFECTIVO',
      amount: 2500000n, // $250.0000
      reason: 'Venta',
      expectedVersion: shift.version,
      operatorPin: '1234',
    });
    shift = mov.shift;

    // Blind count: Cashier counts $1240.0000 (missing $10.0000)
    const { shift: closedShift, arqueo } = await service.realizarArqueoCiego({
      shiftId: shift.id,
      performedByUserId: 'USER_MGR',
      declaredCash: 12400000n, // $1240.0000
      expectedVersion: shift.version,
      performedByPin: '1234',
    });

    assert.equal(closedShift.status, 'CERRADO_ARQUEO');
    assert.equal(closedShift.closingDeclaredCash, 12400000n);
    assert.equal(closedShift.calculatedCashTotal, 12500000n);
    assert.equal(closedShift.cashDifference, -100000n); // -$10.0000 difference
    assert.equal(arqueo.difference, -100000n);
  });

  it('WP016-DOM-06: Corte Z congela el turno permanentemente y previene doble cierre o mutación', async () => {
    let drawerKicked = false;
    const drawerMock = {
      kickDrawer: async () => {
        drawerKicked = true;
      },
    };

    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
      drawerPort: drawerMock,
    });

    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR',
      openingCashFloat: 5000000n,
      operatorPin: '1234',
    });

    const { shift: arqueado } = await service.realizarArqueoCiego({
      shiftId: shift.id,
      performedByUserId: 'USER_MGR',
      declaredCash: 5000000n,
      expectedVersion: shift.version,
      performedByPin: '1234',
    });

    const { shift: finalized, corte } = await service.generarCorteZ({
      shiftId: arqueado.id,
      closedByUserId: 'USER_MGR',
      expectedVersion: arqueado.version,
      closedByPin: '1234',
    });

    assert.equal(finalized.status, 'CORTE_Z_EMITIDO');
    assert.equal(corte.tipoCorte, 'CORTE_Z');
    assert.ok(drawerKicked, 'Physical drawer pulse triggered');

    // Double close attempt must fail with ShiftLockedError
    await assert.rejects(
      service.generarCorteZ({
        shiftId: finalized.id,
        closedByUserId: 'USER_MGR',
        expectedVersion: finalized.version,
        closedByPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof ShiftLockedError);
        return true;
      },
    );

    // Any movement on closed shift must fail with ShiftLockedError
    await assert.rejects(
      service.registrarMovimiento({
        shiftId: finalized.id,
        operatorUserId: 'USER_MGR',
        movementType: 'VENTA_EFECTIVO',
        amount: 1000000n,
        reason: 'Post-close movement',
        expectedVersion: finalized.version,
        operatorPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof ShiftLockedError);
        return true;
      },
    );
  });

  it('WP016-DOM-07: OCC Conflict detection on stale versions', async () => {
    const repo = new InMemoryCashShiftRepository();
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator: defaultPinValidator,
    });

    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_MGR',
      openingCashFloat: 5000000n,
      operatorPin: '1234',
    });

    // Pass stale version 99
    await assert.rejects(
      service.agregarOperador({
        shiftId: shift.id,
        operatorUserId: 'CASHIER_1',
        requestingUserId: 'USER_MGR',
        expectedVersion: 99,
        requestingPin: '1234',
      }),
      (err: Error) => {
        assert.ok(err instanceof OCCConflictError);
        assert.equal((err as OCCConflictError).actualVersion, 1);
        return true;
      },
    );
  });

  it('WP016-DOM-08: Mandatory operator PIN validation: missing or invalid PIN rejects with 0 movements persisted', async () => {
    const repo = new InMemoryCashShiftRepository();
    const pinValidator = {
      validatePin: async (userId: string, pin: string, _stationId?: string) => {
        return userId === 'USER_VALID' && pin === '1234';
      },
    };
    const service = new CashShiftDomainService({
      repository: repo,
      pinValidator,
    });

    // Opening with missing PIN -> rejects
    await assert.rejects(
      service.abrirTurno({
        organizationId: 'ORG_01',
        branchId: 'BRANCH_01',
        stationId: 'STATION_01',
        responsibleUserId: 'USER_VALID',
        openingCashFloat: 5000000n,
      }),
      (err: Error) => {
        assert.ok(err instanceof InvalidOperatorPinError);
        return true;
      },
    );

    // Opening with wrong PIN -> rejects
    await assert.rejects(
      service.abrirTurno({
        organizationId: 'ORG_01',
        branchId: 'BRANCH_01',
        stationId: 'STATION_01',
        responsibleUserId: 'USER_VALID',
        openingCashFloat: 5000000n,
        operatorPin: '9999',
      }),
      (err: Error) => {
        assert.ok(err instanceof InvalidOperatorPinError);
        return true;
      },
    );

    // Opening with valid PIN -> succeeds
    const shift = await service.abrirTurno({
      organizationId: 'ORG_01',
      branchId: 'BRANCH_01',
      stationId: 'STATION_01',
      responsibleUserId: 'USER_VALID',
      openingCashFloat: 5000000n,
      operatorPin: '1234',
    });
    assert.ok(shift);

    // Movement with missing PIN -> rejects without persisting movement
    await assert.rejects(
      service.registrarMovimiento({
        shiftId: shift.id,
        operatorUserId: 'USER_VALID',
        movementType: 'VENTA_EFECTIVO',
        amount: 1000000n,
        reason: 'Venta sin PIN',
        expectedVersion: shift.version,
      }),
      (err: Error) => {
        assert.ok(err instanceof InvalidOperatorPinError);
        return true;
      },
    );

    const movements = await repo.listMovements(shift.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0]?.movementType, 'FONDO_INICIAL');
  });

  it('WP016-DOM-09: Fail-closed configuration: constructing CashShiftDomainService without pinValidator throws PIN_VALIDATOR_REQUIRED', () => {
    const repo = new InMemoryCashShiftRepository();
    assert.throws(
      // @ts-expect-error Testing missing pinValidator runtime error
      () => new CashShiftDomainService({ repository: repo }),
      (err: Error) => {
        assert.ok(err instanceof DomainError);
        assert.equal((err as DomainError).code, 'PIN_VALIDATOR_REQUIRED');
        assert.equal((err as DomainError).statusCode, 500);
        return true;
      },
    );
  });
});
