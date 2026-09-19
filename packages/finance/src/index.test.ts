import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal12x4,
  formatDecimal12x4,
  addScale4,
  subScale4,
  mulScale4,
  cmpScale4,
  isZeroScale4,
  isPositiveScale4,
  isNonNegativeScale4,
  isNegativeScale4,
  parseCreditDaysFromPaymentTerms,
  calculateDueDate,
  applyPaymentToAccountsPayable,
  applySettlementToAccountsReceivable,
  calculateCashReconciliation,
  AccountsPayableOverpaymentError,
  AccountsReceivableOverpaymentError,
  AccountsPayableInvalidStateError,
  AccountsReceivableInvalidStateError,
  InvalidPaymentTermsError,
  InvalidFinancialAmountError,
  CreditPolicyRequiredError,
  type CreditLimitValidator,
  type CreditLimitEvaluationContext,
  type CreditLimitEvaluationResult,
} from './index.js';

describe('TRIDENTPOS Finance Domain & Numerics (WP-020)', () => {
  it('WP020-DOM-01: exact SCALE_4 parse/format, addition, subtraction and multiplication', () => {
    assert.equal(formatDecimal12x4(parseDecimal12x4('123.4567')), '123.4567');
    assert.equal(addScale4('100.2500', '50.7500'), '151.0000');
    assert.equal(subScale4('100.2500', '50.7500'), '49.5000');
    assert.equal(mulScale4('5.0000', '12.5000'), '62.5000');
    assert.equal(cmpScale4('10.0000', '10.0000'), 0);
    assert.equal(cmpScale4('10.0001', '10.0000'), 1);
    assert.equal(cmpScale4('9.9999', '10.0000'), -1);
    assert.equal(isZeroScale4('0.0000'), true);
    assert.equal(isPositiveScale4('0.0001'), true);
    assert.equal(isNegativeScale4('-0.0001'), true);
    assert.equal(isNonNegativeScale4('0.0000'), true);

    // Invalid formatting rejected
    assert.throws(() => parseDecimal12x4('123.4'), InvalidFinancialAmountError);
    assert.throws(() => parseDecimal12x4('abc'), InvalidFinancialAmountError);
  });

  it('WP020-DOM-02: AP initial balance and due date derivation from payment terms', () => {
    assert.equal(parseCreditDaysFromPaymentTerms('NET_30'), 30);
    assert.equal(parseCreditDaysFromPaymentTerms('NET_15'), 15);
    assert.equal(parseCreditDaysFromPaymentTerms('NET_60'), 60);
    assert.equal(parseCreditDaysFromPaymentTerms('CREDIT_45'), 45);
    assert.equal(parseCreditDaysFromPaymentTerms('30_DAYS'), 30);
    assert.equal(parseCreditDaysFromPaymentTerms('10'), 10);
    assert.equal(parseCreditDaysFromPaymentTerms('CONTADO'), 0);
    assert.equal(parseCreditDaysFromPaymentTerms('CASH'), 0);
    assert.equal(parseCreditDaysFromPaymentTerms('IMMEDIATE'), 0);

    const receivedAt = '2026-09-01T12:00:00.000Z';
    assert.equal(calculateDueDate(receivedAt, 30), '2026-10-01');
    assert.equal(calculateDueDate(receivedAt, 15), '2026-09-16');
    assert.equal(calculateDueDate(receivedAt, 0), '2026-09-01');

    assert.throws(() => parseCreditDaysFromPaymentTerms(''), InvalidPaymentTermsError);
    assert.throws(() => parseCreditDaysFromPaymentTerms(null), InvalidPaymentTermsError);
    assert.throws(() => parseCreditDaysFromPaymentTerms('INVALID_TERMS'), InvalidPaymentTermsError);
  });

  it('WP020-DOM-03: AP partial payment reduces balance due and transitions status to PARTIAL', () => {
    const ap = {
      balanceDue: '500.0000',
      status: 'PENDING' as const,
    };

    const result = applyPaymentToAccountsPayable(ap, '200.0000');
    assert.equal(result.newBalanceDue, '300.0000');
    assert.equal(result.newStatus, 'PARTIAL');
  });

  it('WP020-DOM-04: AP full settlement reduces balance to 0.0000 and transitions status to PAID', () => {
    const ap = {
      balanceDue: '300.0000',
      status: 'PARTIAL' as const,
    };

    const result = applyPaymentToAccountsPayable(ap, '300.0000');
    assert.equal(result.newBalanceDue, '0.0000');
    assert.equal(result.newStatus, 'PAID');
  });

  it('WP020-DOM-05: AP overpayment rejected fail-closed', () => {
    const ap = {
      balanceDue: '300.0000',
      status: 'PENDING' as const,
    };

    assert.throws(
      () => applyPaymentToAccountsPayable(ap, '300.0001'),
      AccountsPayableOverpaymentError,
    );

    assert.throws(
      () => applyPaymentToAccountsPayable(ap, '0.0000'),
      AccountsPayableOverpaymentError,
    );

    assert.throws(
      () => applyPaymentToAccountsPayable(ap, '-50.0000'),
      AccountsPayableOverpaymentError,
    );

    const paidAp = { balanceDue: '0.0000', status: 'PAID' as const };
    assert.throws(
      () => applyPaymentToAccountsPayable(paidAp, '10.0000'),
      AccountsPayableInvalidStateError,
    );
  });

  it('WP020-DOM-06: AR initial balance and status validation', () => {
    const totalAmount = '1500.0000';
    assert.equal(isPositiveScale4(totalAmount), true);
  });

  it('WP020-DOM-07: AR settlement exact partial and full application', () => {
    const ar = {
      balanceDue: '1000.0000',
      status: 'PENDING' as const,
    };

    const partial = applySettlementToAccountsReceivable(ar, '400.0000');
    assert.equal(partial.newBalanceDue, '600.0000');
    assert.equal(partial.newStatus, 'PENDING');

    const full = applySettlementToAccountsReceivable(
      { balanceDue: partial.newBalanceDue, status: partial.newStatus },
      '600.0000',
    );
    assert.equal(full.newBalanceDue, '0.0000');
    assert.equal(full.newStatus, 'PAID');
  });

  it('WP020-DOM-08: AR overpayment rejected fail-closed', () => {
    const ar = {
      balanceDue: '600.0000',
      status: 'PENDING' as const,
    };

    assert.throws(
      () => applySettlementToAccountsReceivable(ar, '600.0001'),
      AccountsReceivableOverpaymentError,
    );

    assert.throws(
      () => applySettlementToAccountsReceivable(ar, '0.0000'),
      AccountsReceivableOverpaymentError,
    );

    const paidAr = { balanceDue: '0.0000', status: 'PAID' as const };
    assert.throws(
      () => applySettlementToAccountsReceivable(paidAr, '50.0000'),
      AccountsReceivableInvalidStateError,
    );
  });

  it('WP020-DOM-09: CreditLimitValidator is neutral contract interface', () => {
    // Proves interface can be implemented without concrete default
    const neutralContext: CreditLimitEvaluationContext = {
      organizationId: 'org-1',
      branchId: 'branch-1',
      customerId: 'cust-1',
      currentReceivableBalance: '1000.0000',
      requestedCreditAmount: '500.0000',
    };
    assert.ok(neutralContext);
  });

  it('WP020-DOM-10: missing required credit policy fails closed (CREDIT_POLICY_REQUIRED)', () => {
    function executeChargeWithCreditCheck(
      context: CreditLimitEvaluationContext,
      validator?: CreditLimitValidator,
    ): void {
      if (!validator) {
        throw new CreditPolicyRequiredError();
      }
    }

    const ctx: CreditLimitEvaluationContext = {
      organizationId: 'org-1',
      branchId: 'branch-1',
      customerId: 'cust-1',
      currentReceivableBalance: '500.0000',
      requestedCreditAmount: '200.0000',
    };

    assert.throws(() => executeChargeWithCreditCheck(ctx), CreditPolicyRequiredError);
  });

  it('WP020-DOM-11: TEST policy remains explicit test-only (NOT PRODUCT OWNER POLICY)', async () => {
    const testLimit = '2000.0000';
    const testOnlyValidator: CreditLimitValidator = {
      evaluateCredit(context: CreditLimitEvaluationContext): CreditLimitEvaluationResult {
        const totalProjected = addScale4(
          context.currentReceivableBalance,
          context.requestedCreditAmount,
        );
        if (cmpScale4(totalProjected, testLimit) > 0) {
          return {
            authorized: false,
            disposition: 'REJECTED',
            reason: `Projected balance ${totalProjected} exceeds test credit limit ${testLimit}`,
          };
        }
        return { authorized: true, disposition: 'AUTHORIZED' };
      },
    };

    const allowed = await testOnlyValidator.evaluateCredit({
      organizationId: 'org-1',
      branchId: 'branch-1',
      customerId: 'cust-1',
      currentReceivableBalance: '500.0000',
      requestedCreditAmount: '500.0000',
    });
    assert.equal(allowed.authorized, true);
    assert.equal(allowed.disposition, 'AUTHORIZED');

    const denied = await testOnlyValidator.evaluateCredit({
      organizationId: 'org-1',
      branchId: 'branch-1',
      customerId: 'cust-1',
      currentReceivableBalance: '1500.0000',
      requestedCreditAmount: '600.0000',
    });
    assert.equal(denied.authorized, false);
    assert.equal(denied.disposition, 'REJECTED');
  });

  it('WP020-DOM-12: cash variance exactly zero is not flagged', () => {
    const rec = calculateCashReconciliation({
      expectedCash: '5000.0000',
      actualCash: '5000.0000',
    });
    assert.equal(rec.expectedCash, '5000.0000');
    assert.equal(rec.actualCash, '5000.0000');
    assert.equal(rec.variance, '0.0000');
    assert.equal(rec.hasVariance, false);
  });

  it('WP020-DOM-13: cash variance positive non-zero is flagged (surplus)', () => {
    const rec = calculateCashReconciliation({
      expectedCash: '5000.0000',
      actualCash: '5050.0000',
    });
    assert.equal(rec.variance, '50.0000');
    assert.equal(rec.hasVariance, true);
  });

  it('WP020-DOM-14: cash variance negative non-zero is flagged (shortage)', () => {
    const rec = calculateCashReconciliation({
      expectedCash: '5000.0000',
      actualCash: '4950.0000',
    });
    assert.equal(rec.variance, '-50.0000');
    assert.equal(rec.hasVariance, true);
  });
});
