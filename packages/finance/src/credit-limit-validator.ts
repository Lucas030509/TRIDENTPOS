/**
 * TRIDENTPOS Credit Limit Validator Contract (OQ-SSOT-03)
 * Bounded Context: Finance
 *
 * OQ-SSOT-03 STATUS: OPEN
 * This module defines the contract interface ONLY.
 * No concrete production policy (hard block, supervisor override, or open credit)
 * is selected or hardcoded.
 */

export interface CreditLimitEvaluationContext {
  organizationId: string;
  branchId: string;
  customerId: string;
  currentReceivableBalance: string; // Scale-4 string
  requestedCreditAmount: string; // Scale-4 string
  referenceAccountId?: string;
}

export type CreditLimitDisposition =
  'AUTHORIZED' | 'REJECTED' | 'SUPERVISOR_OVERRIDE_REQUIRED' | 'NOT_APPLICABLE';

export interface CreditLimitEvaluationResult {
  authorized: boolean;
  disposition: CreditLimitDisposition;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CreditLimitValidator {
  evaluateCredit(
    context: CreditLimitEvaluationContext,
  ): Promise<CreditLimitEvaluationResult> | CreditLimitEvaluationResult;
}
