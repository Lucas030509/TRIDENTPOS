/**
 * TRIDENTPOS Procurement Price Variance Authorization Policy Contracts & Evaluator
 * Implements neutral policy contracts per ACR-2026-018.
 * No canonical threshold (5%, 10%, $100, etc.) is invented or encoded as default.
 */

import {
  PriceVarianceContext,
  PriceVarianceDisposition,
  PurchasePriceVarianceAuthorizationPolicy,
} from './types.js';
import {
  PriceVariancePolicyRequiredError,
  PriceVarianceRejectedError,
  PriceVarianceSupervisorAuthorizationRequiredError,
} from './errors.js';
import { cmpScale4 } from './numerics.js';

/**
 * Authoritative evaluation of unit cost variance during physical goods receiving.
 * Rules per ACR-2026-018 Sec 9:
 * 1. If receivedUnitCost == orderedUnitCost: receipt may proceed without variance policy.
 * 2. If receivedUnitCost != orderedUnitCost AND no policy is provided: FAIL-CLOSED with PriceVariancePolicyRequiredError.
 * 3. If policy evaluates to REJECTED: throw PriceVarianceRejectedError.
 * 4. If policy evaluates to SUPERVISOR_AUTHORIZATION_REQUIRED: requires valid non-empty supervisor authorization token.
 */
export async function evaluatePriceVariance(
  context: PriceVarianceContext,
  policy?: PurchasePriceVarianceAuthorizationPolicy,
): Promise<void> {
  const isPriceEqual = cmpScale4(context.orderedUnitCost, context.receivedUnitCost) === 0;

  if (isPriceEqual) {
    return;
  }

  if (!policy) {
    throw new PriceVariancePolicyRequiredError(
      context.ingredientId,
      context.orderedUnitCost,
      context.receivedUnitCost,
    );
  }

  const disposition: PriceVarianceDisposition = await policy.evaluatePriceVariance(context);

  if (disposition === 'REJECTED') {
    throw new PriceVarianceRejectedError(
      context.ingredientId,
      context.orderedUnitCost,
      context.receivedUnitCost,
    );
  }

  if (disposition === 'SUPERVISOR_AUTHORIZATION_REQUIRED') {
    if (
      !context.supervisorAuthorizationToken ||
      context.supervisorAuthorizationToken.trim().length === 0
    ) {
      throw new PriceVarianceSupervisorAuthorizationRequiredError(
        context.ingredientId,
        context.orderedUnitCost,
        context.receivedUnitCost,
      );
    }
  }
}

/**
 * TEST ONLY helper — NOT PRODUCT OWNER POLICY.
 * Injected in test suites to verify that policies can demand supervisor tokens upon price variance.
 */
export function createTestSupervisorPriceVariancePolicy(): PurchasePriceVarianceAuthorizationPolicy {
  return {
    evaluatePriceVariance(context: PriceVarianceContext): PriceVarianceDisposition {
      if (cmpScale4(context.orderedUnitCost, context.receivedUnitCost) !== 0) {
        return 'SUPERVISOR_AUTHORIZATION_REQUIRED';
      }
      return 'NO_AUTHORIZATION_REQUIRED';
    },
  };
}
