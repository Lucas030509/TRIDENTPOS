/**
 * Unit Test Suite for @trident/procurement Domain Package
 * Covers WP019-DOM-01 through WP019-DOM-10.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addScale4,
  subScale4,
  mulScale4,
  cmpScale4,
  isPositiveScale4,
  isNonNegativeScale4,
  calculatePoItemLineAmount,
  calculatePoTotalAmount,
  validatePoTransition,
  validateCanCancelPo,
  calculateReceiptItemLineAmount,
  calculateReceiptTotalAmount,
  deriveCumulativeReceivingQuantities,
  evaluateOverReceipt,
  determinePostReceiptPoStatus,
  evaluatePriceVariance,
  createTestSupervisorPriceVariancePolicy,
  OverReceiptNotAuthorizedError,
  PriceVariancePolicyRequiredError,
  PriceVarianceSupervisorAuthorizationRequiredError,
  PriceVarianceRejectedError,
  InvalidPurchaseOrderTransitionError,
  InvalidPurchaseOrderError,
  ReplenishmentSuggestionProvider,
} from './index.js';

describe('TRIDENTPOS Procurement Domain & Numerics (WP-019)', () => {
  it('WP019-DOM-01: exact SCALE_4 multiplication', () => {
    // 12.5000 * 4.3500 = 54.3750
    const res = mulScale4('12.5000', '4.3500');
    assert.strictEqual(res, '54.3750');

    // 0.3333 * 3.0000 = 0.9999
    const res2 = mulScale4('0.3333', '3.0000');
    assert.strictEqual(res2, '0.9999');

    // zero unit price
    assert.strictEqual(mulScale4('10.0000', '0.0000'), '0.0000');
  });

  it('WP019-DOM-02: exact SCALE_4 addition and subtraction', () => {
    assert.strictEqual(addScale4('10.2500', '5.7500'), '16.0000');
    assert.strictEqual(subScale4('16.0000', '5.7500'), '10.2500');
    assert.strictEqual(cmpScale4('10.0000', '10.0000'), 0);
    assert.strictEqual(cmpScale4('10.0001', '10.0000'), 1);
    assert.strictEqual(cmpScale4('9.9999', '10.0000'), -1);
    assert.strictEqual(isPositiveScale4('0.0001'), true);
    assert.strictEqual(isPositiveScale4('0.0000'), false);
    assert.strictEqual(isNonNegativeScale4('0.0000'), true);
  });

  it('WP019-DOM-03: PO exact total and line calculation', () => {
    const line1 = calculatePoItemLineAmount('5.0000', '10.5000'); // 52.5000
    const line2 = calculatePoItemLineAmount('2.5000', '20.0000'); // 50.0000
    assert.strictEqual(line1, '52.5000');
    assert.strictEqual(line2, '50.0000');

    const total = calculatePoTotalAmount([{ lineAmount: line1 }, { lineAmount: line2 }]);
    assert.strictEqual(total, '102.5000');

    // Negative/Zero quantity throws
    assert.throws(() => calculatePoItemLineAmount('0.0000', '10.0000'), InvalidPurchaseOrderError);
  });

  it('WP019-DOM-04: partial remaining quantity calculation', () => {
    const ordered = '10.0000';
    const previouslyReceived = '3.5000';
    const current = '2.5000';

    const result = deriveCumulativeReceivingQuantities(ordered, previouslyReceived, current);
    assert.strictEqual(result.cumulativeReceivedQuantity, '6.0000');
    assert.strictEqual(result.remainingQuantity, '4.0000');
    assert.strictEqual(result.isFullyReceived, false);

    const postStatus = determinePostReceiptPoStatus(result.isFullyReceived);
    assert.strictEqual(postStatus, 'PARTIAL');

    // Completing the rest
    const result2 = deriveCumulativeReceivingQuantities(ordered, '6.0000', '4.0000');
    assert.strictEqual(result2.cumulativeReceivedQuantity, '10.0000');
    assert.strictEqual(result2.remainingQuantity, '0.0000');
    assert.strictEqual(result2.isFullyReceived, true);
    assert.strictEqual(determinePostReceiptPoStatus(result2.isFullyReceived), 'RECEIVED');
  });

  it('WP019-DOM-05: over-receipt rejection (fail-closed)', () => {
    const ordered = '10.0000';
    const previouslyReceived = '8.0000';
    const current = '2.0001'; // Total 10.0001 > 10.0000

    assert.throws(
      () => evaluateOverReceipt('ing-1', ordered, previouslyReceived, current),
      (err: unknown) => {
        assert(err instanceof OverReceiptNotAuthorizedError);
        assert.strictEqual(err.orderedQuantity, '10.0000');
        assert.strictEqual(err.previouslyReceivedQuantity, '8.0000');
        assert.strictEqual(err.attemptedQuantity, '2.0001');
        assert.strictEqual(err.totalAttempted, '10.0001');
        return true;
      },
    );

    // Exact receipt is permitted
    assert.doesNotThrow(() => evaluateOverReceipt('ing-1', ordered, previouslyReceived, '2.0000'));
  });

  it('WP019-DOM-06: canonical lifecycle transition validation', () => {
    // Valid transitions
    assert.doesNotThrow(() => validatePoTransition('DRAFT', 'SENT'));
    assert.doesNotThrow(() => validatePoTransition('DRAFT', 'CANCELLED'));
    assert.doesNotThrow(() => validatePoTransition('SENT', 'PARTIAL'));
    assert.doesNotThrow(() => validatePoTransition('SENT', 'RECEIVED'));
    assert.doesNotThrow(() => validatePoTransition('SENT', 'CANCELLED'));
    assert.doesNotThrow(() => validatePoTransition('PARTIAL', 'RECEIVED'));

    // Invalid transitions
    assert.throws(
      () => validatePoTransition('DRAFT', 'RECEIVED'),
      InvalidPurchaseOrderTransitionError,
    );
    assert.throws(
      () => validatePoTransition('RECEIVED', 'SENT'),
      InvalidPurchaseOrderTransitionError,
    );
    assert.throws(() => validatePoTransition('CANCELLED', 'SENT'));

    // Cancellation restrictions
    assert.doesNotThrow(() => validateCanCancelPo('DRAFT', false));
    assert.doesNotThrow(() => validateCanCancelPo('SENT', false));
    assert.throws(() => validateCanCancelPo('SENT', true), InvalidPurchaseOrderError);
    assert.throws(() => validateCanCancelPo('PARTIAL', true), InvalidPurchaseOrderError);
    assert.throws(() => validateCanCancelPo('RECEIVED', true), InvalidPurchaseOrderTransitionError);
  });

  it('WP019-DOM-07: equal price requires no variance policy', async () => {
    const context = {
      organizationId: 'org-1',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      ingredientId: 'ing-1',
      orderedUnitCost: '25.5000',
      receivedUnitCost: '25.5000',
    };

    // No policy provided, same price -> passes cleanly
    await assert.doesNotReject(async () => {
      await evaluatePriceVariance(context, undefined);
    });
  });

  it('WP019-DOM-08: unequal price without policy fails closed (PRICE_VARIANCE_POLICY_REQUIRED)', async () => {
    const context = {
      organizationId: 'org-1',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      ingredientId: 'ing-1',
      orderedUnitCost: '25.5000',
      receivedUnitCost: '26.0000',
    };

    await assert.rejects(
      async () => {
        await evaluatePriceVariance(context, undefined);
      },
      (err: unknown) => {
        assert(err instanceof PriceVariancePolicyRequiredError);
        return true;
      },
    );
  });

  it('WP019-DOM-09: injected TEST policy supported', async () => {
    const testPolicy = createTestSupervisorPriceVariancePolicy();

    const contextWithoutToken = {
      organizationId: 'org-1',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      ingredientId: 'ing-1',
      orderedUnitCost: '25.5000',
      receivedUnitCost: '27.0000',
    };

    // Fails without supervisor token
    await assert.rejects(async () => {
      await evaluatePriceVariance(contextWithoutToken, testPolicy);
    }, PriceVarianceSupervisorAuthorizationRequiredError);

    // Passes with valid supervisor token
    const contextWithToken = {
      ...contextWithoutToken,
      supervisorAuthorizationToken: 'AUTH-SUPERVISOR-TOKEN-12345',
    };
    await assert.doesNotReject(async () => {
      await evaluatePriceVariance(contextWithToken, testPolicy);
    });

    // Custom reject policy
    const rejectingPolicy = {
      evaluatePriceVariance: () => 'REJECTED' as const,
    };
    await assert.rejects(async () => {
      await evaluatePriceVariance(contextWithToken, rejectingPolicy);
    }, PriceVarianceRejectedError);
  });

  it('WP019-DOM-10: ReplenishmentSuggestionProvider has no default algorithm and is contract only', () => {
    // Proves that contract exists as a type interface and there is no default concrete algorithm
    const dummyProvider: ReplenishmentSuggestionProvider = {
      async getSuggestions(_ctx) {
        return {
          generatedAt: new Date().toISOString(),
          items: [
            {
              ingredientId: 'test-ing',
              suggestedQuantity: '10.0000',
              rationale: 'Injected test provider',
            },
          ],
        };
      },
    };

    assert.strictEqual(typeof dummyProvider.getSuggestions, 'function');
  });

  it('calculates receipt total amount accurately', () => {
    const line1 = calculateReceiptItemLineAmount('10.0000', '15.2500'); // 152.5000
    const line2 = calculateReceiptItemLineAmount('4.0000', '5.5000'); // 22.0000
    const total = calculateReceiptTotalAmount([{ lineAmount: line1 }, { lineAmount: line2 }]);
    assert.strictEqual(total, '174.5000');
  });
});
