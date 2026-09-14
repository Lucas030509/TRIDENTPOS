/**
 * TRIDENTPOS Protected Product Owner Decision Hooks & Policies
 * Pursuant to EAAF v1.2 governance directives:
 * All Product Owner decisions (OQ-SSOT-01, OQ-SSOT-02, OQ-SSOT-06) remain strictly PENDING PO DECISION.
 * This module exports abstract interfaces and parameterization contracts only.
 * NO concrete default implementations are provided in production runtime code.
 */

import type { Cuenta, CuentaItem, Mesa } from './types.js';

/**
 * OQ-SSOT-01: Post-kitchen cancellation semantics.
 * Governs whether and how kitchen-committed lines can be cancelled.
 * Status: PENDING PO DECISION
 */
export interface CancellationContext {
  readonly operatorUserId: string;
  readonly operatorRole: string;
  readonly kitchenStatus: string;
  readonly hasSupervisorAuthorization?: boolean;
}

export interface CancellationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresWasteRecord?: boolean;
}

export interface CancellationPolicy {
  canCancelItem(item: CuentaItem, context: CancellationContext): CancellationResult;
}

/**
 * OQ-SSOT-02: Table and account transfer validation rules.
 * Governs whether transfers require receiving waiter PIN confirmation.
 * Status: PENDING PO DECISION
 */
export interface TransferValidationContext {
  readonly operatorUserId: string;
  readonly targetWaiterUserId?: string;
  readonly targetWaiterPinProvided?: boolean;
}

export interface TransferValidationResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface TransferValidationRule {
  validateTransfer(
    sourceMesa: Mesa,
    targetMesa: Mesa,
    cuenta: Cuenta,
    context: TransferValidationContext,
  ): TransferValidationResult;
}

/**
 * OQ-SSOT-06: Bill splitting proration semantics.
 * Governs how shared discounts, taxes, and items are split across sub-accounts.
 * Status: PENDING PO DECISION
 */
export interface SplitPartitionPlan {
  readonly partitionId: string;
  readonly itemIds?: readonly string[];
  readonly ratioScale4?: bigint;
}

export interface BillSplitProrationStrategy {
  prorateSplit(
    originalCuenta: Cuenta,
    partitions: readonly SplitPartitionPlan[],
  ): readonly Cuenta[];
}
