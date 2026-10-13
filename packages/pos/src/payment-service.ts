/**
 * TRIDENTPOS Payment Orchestration & Account Settlement Service (WP-016C)
 * Pure domain service handling split payments, cash change, shift gating,
 * operator PIN validation, atomic settlement invariants, and CuentaPagada emission.
 */

import crypto from 'node:crypto';
import { scaledBigIntToDecimalString } from '@trident/core';
import type { MovimientoCaja } from './cash-shift-types.js';
import {
  AccountNotPayableError,
  DomainError,
  InvalidOperatorPinError,
  PaymentValidationError,
  ShiftNotFoundError,
  ShiftNotOpenError,
  UnauthorizedShiftOperatorError,
} from './errors.js';
import type {
  AtomicSettlementParams,
  CashShiftLookupPort,
  IamPinValidatorPort,
  PaymentRepositoryPort,
} from './payment-ports.js';
import type {
  AccountPaymentsSummary,
  Pago,
  PaymentSettlementResult,
  SubmitTenderCommand,
} from './payment-types.js';
import type { AccountRepositoryPort } from './ports.js';
import type { Cuenta } from './types.js';

export interface PaymentDomainServiceOptions {
  readonly organizationId?: string;
  readonly branchId?: string;
  readonly stationId?: string;
}

export class PaymentDomainService {
  readonly #paymentRepo: PaymentRepositoryPort;
  readonly #accountRepo: AccountRepositoryPort;
  readonly #shiftLookup: CashShiftLookupPort;
  readonly #pinValidator: IamPinValidatorPort;
  readonly #options: PaymentDomainServiceOptions;

  constructor(
    paymentRepo: PaymentRepositoryPort,
    accountRepo: AccountRepositoryPort,
    shiftLookup: CashShiftLookupPort,
    pinValidator: IamPinValidatorPort,
    options?: PaymentDomainServiceOptions,
  ) {
    this.#paymentRepo = paymentRepo;
    this.#accountRepo = accountRepo;
    this.#shiftLookup = shiftLookup;
    this.#pinValidator = pinValidator;
    this.#options = options ?? {};
  }

  public async submitTender(command: SubmitTenderCommand): Promise<PaymentSettlementResult> {
    // 1. Idempotency Check (DATA-COND-015-02)
    const existingPago = await this.#paymentRepo.findPaymentByClientOpId(
      command.cuentaId,
      command.clientOpId,
    );

    if (existingPago) {
      const cuenta = await this.#accountRepo.getCuentaById(command.cuentaId);
      if (!cuenta) {
        throw new DomainError('Cuenta not found for idempotent replay', 'CUENTA_NOT_FOUND', 404);
      }
      const allPayments = await this.#paymentRepo.listPaymentsByCuentaId(command.cuentaId);
      const totalPaid = allPayments.reduce((acc, p) => acc + p.amount, 0n);
      const totalTips = allPayments.reduce((acc, p) => acc + p.tipAmount, 0n);
      const remainingBalance = cuenta.totalAmount > totalPaid ? cuenta.totalAmount - totalPaid : 0n;

      return {
        pago: existingPago,
        totalAmount: cuenta.totalAmount,
        totalPaid,
        totalTips,
        remainingBalance,
        accountSettled: cuenta.status === 'PAGADA',
        accountStatus: cuenta.status,
        closedAt: cuenta.closedAt,
        isIdempotentReplay: true,
      };
    }

    // 2. Validate Operator PIN (DEC-017 / Fail-Closed)
    const pinValid = await this.#pinValidator.validatePin(
      command.operatorUserId,
      command.operatorPin,
      this.#options.stationId,
    );
    if (!pinValid) {
      throw new InvalidOperatorPinError(command.operatorUserId);
    }

    // 3. Shift-Gating Validation (turnoCajaId MUST exist and be ABIERTO)
    const shift = await this.#shiftLookup.getShiftById(command.turnoCajaId);
    if (!shift) {
      throw new ShiftNotFoundError(command.turnoCajaId);
    }
    if (shift.status !== 'ABIERTO') {
      throw new ShiftNotOpenError(shift.id, shift.status);
    }

    // 4. Operator Shift Participation Check (DEC-017 Shared Shift)
    const isResponsible = shift.responsibleUserId === command.operatorUserId;
    const isOpener = shift.openedByUserId === command.operatorUserId;
    const isParticipant =
      shift.participatingOperators && shift.participatingOperators.includes(command.operatorUserId);
    if (!isResponsible && !isOpener && !isParticipant) {
      throw new UnauthorizedShiftOperatorError(command.operatorUserId, shift.id);
    }

    // 5. Account Payable Validation
    const cuenta = await this.#accountRepo.getCuentaById(command.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${command.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }
    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new AccountNotPayableError(cuenta.id, cuenta.status);
    }

    // 6. Payment Method Validation (Explicit Slice 1: EFECTIVO, TARJETA, TRANSFERENCIA)
    if (
      command.paymentMethod !== 'EFECTIVO' &&
      command.paymentMethod !== 'TARJETA' &&
      command.paymentMethod !== 'TRANSFERENCIA'
    ) {
      throw new PaymentValidationError(
        `Payment method '${command.paymentMethod}' is not supported in this slice`,
      );
    }

    // 7. Amount Validations (Strict Scale 4 BigInt)
    if (command.amount <= 0n) {
      throw new PaymentValidationError('Payment amount must be greater than 0');
    }
    const tipAmount = command.tipAmount && command.tipAmount > 0n ? command.tipAmount : 0n;

    // 8. Accumulated Paid & Balance Calculation
    const existingPayments = await this.#paymentRepo.listPaymentsByCuentaId(command.cuentaId);
    const totalPaidSoFar = existingPayments.reduce((acc, p) => acc + p.amount, 0n);
    const totalTipsSoFar = existingPayments.reduce((acc, p) => acc + p.tipAmount, 0n);
    const currentRemaining =
      cuenta.totalAmount > totalPaidSoFar ? cuenta.totalAmount - totalPaidSoFar : 0n;

    if (command.amount > currentRemaining) {
      throw new PaymentValidationError(
        `Payment amount (${scaledBigIntToDecimalString(command.amount)}) exceeds remaining account balance (${scaledBigIntToDecimalString(currentRemaining)})`,
      );
    }

    // 9. Cash Change Calculation (EFECTIVO)
    let cashGiven: bigint | null = null;
    let changeDue: bigint | null = null;
    if (command.paymentMethod === 'EFECTIVO') {
      if (command.cashGiven !== undefined && command.cashGiven !== null) {
        if (command.cashGiven < command.amount + tipAmount) {
          throw new PaymentValidationError('Cash given cannot be less than tender amount plus tip');
        }
        cashGiven = command.cashGiven;
        changeDue = command.cashGiven - (command.amount + tipAmount);
      }
    }

    // 10. Construct Pago Aggregate
    const now = new Date().toISOString();
    const pagoId = crypto.randomUUID();
    const newPago: Pago = {
      id: pagoId,
      cuentaId: command.cuentaId,
      turnoCajaId: command.turnoCajaId,
      operatorUserId: command.operatorUserId,
      paymentMethod: command.paymentMethod,
      amount: command.amount,
      tipAmount,
      cashGiven,
      changeDue,
      referenceAuthCode: command.referenceAuthCode ?? null,
      clientOpId: command.clientOpId,
      createdAt: now,
    };

    // 11. Compute New Totals & Settlement Transition
    const newTotalPaid = totalPaidSoFar + command.amount;
    const newTotalTips = totalTipsSoFar + tipAmount;
    const newRemaining = cuenta.totalAmount > newTotalPaid ? cuenta.totalAmount - newTotalPaid : 0n;
    const isAccountSettled = newRemaining === 0n;

    const updatedCuenta: Cuenta = {
      ...cuenta,
      tipsTotal: newTotalTips,
      status: isAccountSettled ? 'PAGADA' : cuenta.status,
      closedAt: isAccountSettled ? now : cuenta.closedAt,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    // 12. Cash Movement Construction (if EFECTIVO)
    let cashMovement: MovimientoCaja | undefined;
    if (command.paymentMethod === 'EFECTIVO') {
      cashMovement = {
        id: crypto.randomUUID(),
        turnoCajaId: command.turnoCajaId,
        operatorUserId: command.operatorUserId,
        movementType: 'VENTA_EFECTIVO',
        amount: command.amount + tipAmount,
        reason: `Cobro cuenta ${cuenta.id} (Folio ${cuenta.folioNumber ?? 'S/F'})`,
        referenceId: pagoId,
        createdAt: now,
      };
    }

    // 13. Construct CuentaPagada Event (FUNCTIONAL_ARCHITECTURE.md Sec 6.3)
    let cuentaPagadaEvent = undefined;
    if (isAccountSettled) {
      const allPayments = [...existingPayments, newPago];
      cuentaPagadaEvent = {
        organizacionId: this.#options.organizationId ?? 'org_default',
        sucursalId: this.#options.branchId ?? 'branch_default',
        estacionId: this.#options.stationId ?? 'station_default',
        cuentaId: cuenta.id,
        folioVenta: cuenta.folioNumber,
        montos: {
          subtotal: scaledBigIntToDecimalString(cuenta.subtotal),
          taxTotal: scaledBigIntToDecimalString(cuenta.taxTotal),
          discountsTotal: scaledBigIntToDecimalString(cuenta.discountsTotal),
          total: scaledBigIntToDecimalString(cuenta.totalAmount),
        },
        impuestos: [{ rate: '0.1600', amount: scaledBigIntToDecimalString(cuenta.taxTotal) }],
        propina: scaledBigIntToDecimalString(newTotalTips),
        formasPago: allPayments.map((p) => ({
          method: p.paymentMethod,
          amount: scaledBigIntToDecimalString(p.amount + p.tipAmount),
          reference: p.referenceAuthCode,
        })),
        meseroId: cuenta.currentWaiterUserId ?? null,
        clienteId: null,
        settledAt: now,
      };
    }

    // 14. Operational Audit Linkage (SEC-COND-015-03)
    const auditRecord = {
      actorId: command.operatorUserId,
      action: isAccountSettled ? 'CUENTA_LIQUIDADA' : 'PAGO_RECIBIDO',
      details: {
        cuentaId: cuenta.id,
        pagoId,
        turnoCajaId: command.turnoCajaId,
        paymentMethod: command.paymentMethod,
        amount: scaledBigIntToDecimalString(command.amount),
        tipAmount: scaledBigIntToDecimalString(tipAmount),
        remainingBalance: scaledBigIntToDecimalString(newRemaining),
        accountSettled: isAccountSettled,
        clientOpId: command.clientOpId,
      },
    };

    // 15. Execute Atomic Settlement (DATA-COND-015-01)
    const params: AtomicSettlementParams = {
      pago: newPago,
      updatedCuenta,
      cashMovement,
      cuentaPagadaEvent,
      auditRecord,
    };

    const savedPago = await this.#paymentRepo.executeAtomicSettlement(params);

    return {
      pago: savedPago,
      totalAmount: cuenta.totalAmount,
      totalPaid: newTotalPaid,
      totalTips: newTotalTips,
      remainingBalance: newRemaining,
      accountSettled: isAccountSettled,
      accountStatus: updatedCuenta.status,
      closedAt: updatedCuenta.closedAt,
      isIdempotentReplay: false,
      cashMovement,
      cuentaPagadaEvent,
    };
  }

  public async getAccountPayments(cuentaId: string): Promise<AccountPaymentsSummary> {
    const cuenta = await this.#accountRepo.getCuentaById(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    const payments = await this.#paymentRepo.listPaymentsByCuentaId(cuentaId);
    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0n);
    const totalTips = payments.reduce((acc, p) => acc + p.tipAmount, 0n);
    const remainingBalance = cuenta.totalAmount > totalPaid ? cuenta.totalAmount - totalPaid : 0n;

    return {
      cuentaId,
      totalAmount: cuenta.totalAmount,
      totalPaid,
      totalTips,
      remainingBalance,
      isSettled: cuenta.status === 'PAGADA',
      accountStatus: cuenta.status,
      payments,
    };
  }
}
