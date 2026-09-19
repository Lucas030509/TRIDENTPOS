/**
 * TRIDENTPOS Cash Reconciliation Domain Service
 * Bounded Context: Finance
 */

import { subScale4, isZeroScale4 } from './numerics.js';

export interface CalculateCashReconciliationParams {
  expectedCash: string; // Scale-4 string
  actualCash: string; // Scale-4 string
}

export interface CalculatedCashReconciliation {
  expectedCash: string;
  actualCash: string;
  variance: string; // actual - expected
  hasVariance: boolean;
}

/**
 * Calculates exact cash variance and flags non-zero differences.
 * Formula: variance = actualCash - expectedCash
 * hasVariance = (variance !== 0.0000)
 */
export function calculateCashReconciliation(
  params: CalculateCashReconciliationParams,
): CalculatedCashReconciliation {
  const variance = subScale4(params.actualCash, params.expectedCash);
  const hasVariance = !isZeroScale4(variance);

  return {
    expectedCash: params.expectedCash,
    actualCash: params.actualCash,
    variance,
    hasVariance,
  };
}
