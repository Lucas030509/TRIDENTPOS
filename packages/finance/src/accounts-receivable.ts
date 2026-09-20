/**
 * TRIDENTPOS Accounts Receivable Domain Service
 * Bounded Context: Finance
 */

import { isPositiveScale4, cmpScale4, subScale4, addScale4, isZeroScale4 } from './numerics.js';
import {
  AccountsReceivableOverpaymentError,
  AccountsReceivableInvalidStateError,
} from './errors.js';
import type { AccountsReceivable, AccountsReceivableStatus } from './types.js';

/**
 * Calculates new balance due and new status after applying a settlement to an AccountsReceivable record.
 */
export function applySettlementToAccountsReceivable(
  ar: Pick<AccountsReceivable, 'balanceDue' | 'status'>,
  settlementAmount: string,
): { newBalanceDue: string; newStatus: AccountsReceivableStatus } {
  if (!isPositiveScale4(settlementAmount)) {
    throw new AccountsReceivableOverpaymentError(
      `Settlement amount must be positive, received '${settlementAmount}'`,
    );
  }

  if (ar.status === 'PAID') {
    throw new AccountsReceivableInvalidStateError(
      'Cannot apply settlement to an already PAID accounts receivable record',
    );
  }

  if (ar.status === 'DEFAULTED') {
    throw new AccountsReceivableInvalidStateError(
      'Cannot apply settlement to a DEFAULTED accounts receivable record without explicit re-opening',
    );
  }

  if (cmpScale4(settlementAmount, ar.balanceDue) > 0) {
    throw new AccountsReceivableOverpaymentError(
      `Settlement amount '${settlementAmount}' exceeds current balance due '${ar.balanceDue}'`,
    );
  }

  const newBalanceDue = subScale4(ar.balanceDue, settlementAmount);
  const newStatus: AccountsReceivableStatus = isZeroScale4(newBalanceDue) ? 'PAID' : ar.status;

  return { newBalanceDue, newStatus };
}

/**
 * Calculates new balance due and restored status after compensating reversal of an AR settlement.
 */
export function reverseSettlementOnAccountsReceivable(
  ar: Pick<AccountsReceivable, 'totalAmount' | 'balanceDue' | 'status'>,
  reversalAmount: string,
): { newBalanceDue: string; newStatus: AccountsReceivableStatus } {
  if (!isPositiveScale4(reversalAmount)) {
    throw new AccountsReceivableOverpaymentError(
      `Reversal amount must be positive, received '${reversalAmount}'`,
    );
  }

  if (ar.status === 'DEFAULTED') {
    throw new AccountsReceivableInvalidStateError(
      'Cannot reverse settlement on a DEFAULTED accounts receivable record',
    );
  }

  const newBalanceDue = addScale4(ar.balanceDue, reversalAmount);
  if (cmpScale4(newBalanceDue, ar.totalAmount) > 0) {
    throw new AccountsReceivableOverpaymentError(
      `Reversal amount '${reversalAmount}' would cause balance due '${newBalanceDue}' to exceed original total '${ar.totalAmount}'`,
    );
  }

  const newStatus: AccountsReceivableStatus = 'PENDING';

  return { newBalanceDue, newStatus };
}
