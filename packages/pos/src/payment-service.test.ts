import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TurnoCaja } from './cash-shift-types.js';
import {
  AccountNotPayableError,
  InvalidOperatorPinError,
  PaymentValidationError,
  ShiftNotFoundError,
  ShiftNotOpenError,
  UnauthorizedShiftOperatorError,
} from './errors.js';
import type {
  AtomicSettlementParams,
  CashShiftLookupPort,
  PaymentRepositoryPort,
} from './payment-ports.js';
import { PaymentDomainService } from './payment-service.js';
import type { Pago } from './payment-types.js';
import type { AccountRepositoryPort, IamPinValidatorPort } from './ports.js';
import type { Cuenta } from './types.js';

class MockPaymentRepository implements PaymentRepositoryPort {
  public payments: Pago[] = [];
  public atomicParamsHistory: AtomicSettlementParams[] = [];

  public async findPaymentById(id: string): Promise<Pago | null> {
    return this.payments.find((p) => p.id === id) ?? null;
  }

  public async findPaymentByClientOpId(
    cuentaId: string,
    clientOpId: string,
  ): Promise<Pago | null> {
    return (
      this.payments.find((p) => p.cuentaId === cuentaId && p.clientOpId === clientOpId) ?? null
    );
  }

  public async listPaymentsByCuentaId(cuentaId: string): Promise<readonly Pago[]> {
    return this.payments.filter((p) => p.cuentaId === cuentaId);
  }

  public async executeAtomicSettlement(params: AtomicSettlementParams): Promise<Pago> {
    this.atomicParamsHistory.push(params);
    this.payments.push(params.pago);
    return params.pago;
  }
}

class MockAccountRepository implements AccountRepositoryPort {
  public accounts = new Map<string, Cuenta>();

  public async getCuentaById(id: string): Promise<Cuenta | null> {
    return this.accounts.get(id) ?? null;
  }

  public async saveCuenta(cuenta: Cuenta, _expectedVersion: number): Promise<Cuenta> {
    this.accounts.set(cuenta.id, cuenta);
    return cuenta;
  }

  public async listOpenCuentas(): Promise<readonly Cuenta[]> {
    return Array.from(this.accounts.values());
  }
}

class MockShiftLookup implements CashShiftLookupPort {
  public shifts = new Map<string, TurnoCaja>();

  public async getShiftById(shiftId: string): Promise<TurnoCaja | null> {
    return this.shifts.get(shiftId) ?? null;
  }
}

function createTestCuenta(overrides?: Partial<Cuenta>): Cuenta {
  return {
    id: 'cta_test_1',
    folioNumber: 101,
    epochId: 'epoch_1',
    mesaId: 'mesa_1',
    accountType: 'COMEDOR',
    status: 'ABIERTA',
    subtotal: 400_0000n,
    taxTotal: 64_0000n,
    discountsTotal: 0n,
    tipsTotal: 0n,
    totalAmount: 464_0000n,
    openedByUserId: 'usr_waiter',
    currentWaiterUserId: 'usr_waiter',
    guestCount: 2,
    openedAt: new Date().toISOString(),
    printedAt: null,
    closedAt: null,
    parentCuentaId: null,
    splitSequence: null,
    version: 1,
    updatedAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

function createTestShift(overrides?: Partial<TurnoCaja>): TurnoCaja {
  return {
    id: 'shift_1',
    organizationId: 'org_test',
    branchId: 'branch_test',
    stationId: 'pos_1',
    responsibleUserId: 'usr_cajero',
    openedByUserId: 'usr_cajero',
    shiftNumber: 1,
    openingCashFloat: 1000_0000n,
    closingDeclaredCash: null,
    calculatedCashTotal: null,
    cashDifference: null,
    status: 'ABIERTO',
    assignmentStrategy: 'COMPARTIDO',
    participatingOperators: ['usr_cajero', 'usr_cajero_2'],
    openedAt: new Date().toISOString(),
    closedAt: null,
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const alwaysValidPin: IamPinValidatorPort = {
  validatePin: () => true,
};

const alwaysInvalidPin: IamPinValidatorPort = {
  validatePin: () => false,
};

describe('PaymentDomainService (WP-016C)', () => {
  it('submits a cash tender, calculates change, and records cash movement (DEC-017 / DATA-COND-015-01)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta();
    accountRepo.accounts.set(cuenta.id, cuenta);

    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const pinValidator: IamPinValidatorPort = {
      validatePin: async (userId: string, pin: string) => userId === 'usr_cajero' && pin === '1234',
    };

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, pinValidator, {
      organizationId: 'org_test',
      branchId: 'branch_test',
      stationId: 'pos_1',
    });

    const result = await service.submitTender({
      cuentaId: cuenta.id,
      turnoCajaId: shift.id,
      operatorUserId: 'usr_cajero',
      operatorPin: '1234',
      paymentMethod: 'EFECTIVO',
      amount: 464_0000n,
      tipAmount: 36_0000n,
      cashGiven: 600_0000n,
      clientOpId: '550e8400-e29b-41d4-a716-446655440001',
    });

    assert.equal(result.isIdempotentReplay, false);
    assert.equal(result.totalPaid, 464_0000n);
    assert.equal(result.totalTips, 36_0000n);
    assert.equal(result.remainingBalance, 0n);
    assert.equal(result.accountSettled, true);
    assert.equal(result.accountStatus, 'PAGADA');
    assert.ok(result.closedAt);

    // Verify cash change calculation
    assert.equal(result.pago.cashGiven, 600_0000n);
    assert.equal(result.pago.changeDue, 100_0000n); // 600 - (464 + 36) = 100

    // Verify cash movement
    assert.ok(result.cashMovement);
    assert.equal(result.cashMovement.movementType, 'VENTA_EFECTIVO');
    assert.equal(result.cashMovement.amount, 500_0000n); // 464 + 36

    // Verify CuentaPagada event
    assert.ok(result.cuentaPagadaEvent);
    assert.equal(result.cuentaPagadaEvent.cuentaId, cuenta.id);
    assert.equal(result.cuentaPagadaEvent.montos.total, '464.0000');
    assert.equal(result.cuentaPagadaEvent.propina, '36.0000');

    // Verify atomic transaction params
    assert.equal(paymentRepo.atomicParamsHistory.length, 1);
    const params = paymentRepo.atomicParamsHistory[0];
    assert.ok(params);
    assert.equal(params.updatedCuenta.status, 'PAGADA');
    assert.equal(params.auditRecord.action, 'CUENTA_LIQUIDADA');
  });

  it('supports split payment across multiple tender lines until settlement (P0)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta({ totalAmount: 1000_0000n });
    accountRepo.accounts.set(cuenta.id, cuenta);

    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    // 1st Tender: Card $400.00
    const res1 = await service.submitTender({
      cuentaId: cuenta.id,
      turnoCajaId: shift.id,
      operatorUserId: 'usr_cajero',
      operatorPin: '1234',
      paymentMethod: 'TARJETA',
      amount: 400_0000n,
      referenceAuthCode: 'AUTH-VISA-9912',
      clientOpId: '550e8400-e29b-41d4-a716-446655440011',
    });

    assert.equal(res1.accountSettled, false);
    assert.equal(res1.remainingBalance, 600_0000n);
    assert.equal(res1.pago.referenceAuthCode, 'AUTH-VISA-9912');

    // 2nd Tender: Transfer $300.00
    const res2 = await service.submitTender({
      cuentaId: cuenta.id,
      turnoCajaId: shift.id,
      operatorUserId: 'usr_cajero_2',
      operatorPin: '1234',
      paymentMethod: 'TRANSFERENCIA',
      amount: 300_0000n,
      referenceAuthCode: 'SPEI-88231',
      clientOpId: '550e8400-e29b-41d4-a716-446655440012',
    });

    assert.equal(res2.accountSettled, false);
    assert.equal(res2.remainingBalance, 300_0000n);

    // 3rd Tender: Cash $300.00 (Finalizes settlement)
    const res3 = await service.submitTender({
      cuentaId: cuenta.id,
      turnoCajaId: shift.id,
      operatorUserId: 'usr_cajero',
      operatorPin: '1234',
      paymentMethod: 'EFECTIVO',
      amount: 300_0000n,
      cashGiven: 500_0000n,
      clientOpId: '550e8400-e29b-41d4-a716-446655440013',
    });

    assert.equal(res3.accountSettled, true);
    assert.equal(res3.remainingBalance, 0n);
    assert.equal(res3.pago.changeDue, 200_0000n);
    assert.ok(res3.cuentaPagadaEvent);
    assert.equal(res3.cuentaPagadaEvent.formasPago.length, 3);
  });

  it('guarantees payment idempotency on replay with same clientOpId (DATA-COND-015-02)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta();
    accountRepo.accounts.set(cuenta.id, cuenta);
    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    const cmd = {
      cuentaId: cuenta.id,
      turnoCajaId: shift.id,
      operatorUserId: 'usr_cajero',
      operatorPin: '1234',
      paymentMethod: 'TARJETA' as const,
      amount: 464_0000n,
      clientOpId: '550e8400-e29b-41d4-a716-446655440022',
    };

    const firstResult = await service.submitTender(cmd);
    assert.equal(firstResult.isIdempotentReplay, false);
    assert.equal(paymentRepo.payments.length, 1);

    // Replay with identical clientOpId
    const replayResult = await service.submitTender(cmd);
    assert.equal(replayResult.isIdempotentReplay, true);
    assert.equal(replayResult.pago.id, firstResult.pago.id);
    assert.equal(paymentRepo.payments.length, 1); // No duplicate payment inserted
  });

  it('fails closed on invalid operator PIN (DEC-017 / SEC-FAIL-CLOSED)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta();
    accountRepo.accounts.set(cuenta.id, cuenta);
    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysInvalidPin);

    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: shift.id,
          operatorUserId: 'usr_cajero',
          operatorPin: 'wrong_pin',
          paymentMethod: 'EFECTIVO',
          amount: 100_0000n,
          clientOpId: '550e8400-e29b-41d4-a716-446655440033',
        });
      },
      InvalidOperatorPinError,
    );
  });

  it('fails closed when shift is closed or does not exist (shift-gating)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta();
    accountRepo.accounts.set(cuenta.id, cuenta);

    const closedShift = createTestShift({ status: 'CERRADO_ARQUEO' });
    shiftLookup.shifts.set(closedShift.id, closedShift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    // Non-existent shift
    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: 'non_existent_shift',
          operatorUserId: 'usr_cajero',
          operatorPin: '1234',
          paymentMethod: 'EFECTIVO',
          amount: 100_0000n,
          clientOpId: '550e8400-e29b-41d4-a716-446655440044',
        });
      },
      ShiftNotFoundError,
    );

    // Closed shift
    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: closedShift.id,
          operatorUserId: 'usr_cajero',
          operatorPin: '1234',
          paymentMethod: 'EFECTIVO',
          amount: 100_0000n,
          clientOpId: '550e8400-e29b-41d4-a716-446655440045',
        });
      },
      ShiftNotOpenError,
    );
  });

  it('rejects tender when operator is not participating in shared shift (DEC-017)', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta();
    accountRepo.accounts.set(cuenta.id, cuenta);
    const shift = createTestShift({ participatingOperators: ['usr_authorized'] });
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: shift.id,
          operatorUserId: 'usr_unauthorized_intruder',
          operatorPin: '1234',
          paymentMethod: 'EFECTIVO',
          amount: 100_0000n,
          clientOpId: '550e8400-e29b-41d4-a716-446655440055',
        });
      },
      UnauthorizedShiftOperatorError,
    );
  });

  it('rejects tender when account is already PAGADA or CANCELADA', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta({ status: 'PAGADA' });
    accountRepo.accounts.set(cuenta.id, cuenta);
    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: shift.id,
          operatorUserId: 'usr_cajero',
          operatorPin: '1234',
          paymentMethod: 'EFECTIVO',
          amount: 100_0000n,
          clientOpId: '550e8400-e29b-41d4-a716-446655440066',
        });
      },
      AccountNotPayableError,
    );
  });

  it('rejects tender exceeding account remaining balance', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta({ totalAmount: 200_0000n });
    accountRepo.accounts.set(cuenta.id, cuenta);
    const shift = createTestShift();
    shiftLookup.shifts.set(shift.id, shift);

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);

    await assert.rejects(
      async () => {
        await service.submitTender({
          cuentaId: cuenta.id,
          turnoCajaId: shift.id,
          operatorUserId: 'usr_cajero',
          operatorPin: '1234',
          paymentMethod: 'TARJETA',
          amount: 300_0000n, // Exceeds 200
          clientOpId: '550e8400-e29b-41d4-a716-446655440077',
        });
      },
      PaymentValidationError,
    );
  });

  it('getAccountPayments returns summary with all previous tenders and balance', async () => {
    const paymentRepo = new MockPaymentRepository();
    const accountRepo = new MockAccountRepository();
    const shiftLookup = new MockShiftLookup();

    const cuenta = createTestCuenta({ totalAmount: 500_0000n });
    accountRepo.accounts.set(cuenta.id, cuenta);

    paymentRepo.payments = [
      {
        id: 'p_1',
        cuentaId: cuenta.id,
        turnoCajaId: 'shift_1',
        operatorUserId: 'usr_cajero',
        paymentMethod: 'TARJETA',
        amount: 200_0000n,
        tipAmount: 20_0000n,
        cashGiven: null,
        changeDue: null,
        referenceAuthCode: 'AUTH-1',
        clientOpId: 'op_1',
        createdAt: new Date().toISOString(),
      },
    ];

    const service = new PaymentDomainService(paymentRepo, accountRepo, shiftLookup, alwaysValidPin);
    const summary = await service.getAccountPayments(cuenta.id);

    assert.equal(summary.totalAmount, 500_0000n);
    assert.equal(summary.totalPaid, 200_0000n);
    assert.equal(summary.totalTips, 20_0000n);
    assert.equal(summary.remainingBalance, 300_0000n);
    assert.equal(summary.isSettled, false);
    assert.equal(summary.payments.length, 1);
  });
});
