/**
 * TRIDENTPOS Accounts Payable Domain Service
 * Bounded Context: Finance
 */

import { isPositiveScale4, cmpScale4, subScale4, isZeroScale4 } from './numerics.js';
import {
  AccountsPayableOverpaymentError,
  AccountsPayableInvalidStateError,
  InvalidPaymentTermsError,
} from './errors.js';
import type { AccountsPayable, AccountsPayableStatus } from './types.js';

/**
 * Derives due date string (YYYY-MM-DD) from receivedAt timestamp and credit days.
 */
export function calculateDueDate(receivedAt: string, creditDays: number): string {
  const date = new Date(receivedAt);
  if (isNaN(date.getTime())) {
    throw new InvalidPaymentTermsError(`Invalid receivedAt date timestamp '${receivedAt}'`);
  }
  date.setUTCDate(date.getUTCDate() + creditDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Calculates new balance due and new status after applying a payment to an AccountsPayable record.
 */
export function applyPaymentToAccountsPayable(
  ap: Pick<AccountsPayable, 'balanceDue' | 'status'>,
  paymentAmount: string,
): { newBalanceDue: string; newStatus: AccountsPayableStatus } {
  if (!isPositiveScale4(paymentAmount)) {
    throw new AccountsPayableOverpaymentError(
      `Payment amount must be positive, received '${paymentAmount}'`,
    );
  }

  if (ap.status === 'PAID') {
    throw new AccountsPayableInvalidStateError(
      'Cannot apply payment to an already PAID accounts payable record',
    );
  }

  if (ap.status === 'CANCELLED') {
    throw new AccountsPayableInvalidStateError(
      'Cannot apply payment to a CANCELLED accounts payable record',
    );
  }

  if (cmpScale4(paymentAmount, ap.balanceDue) > 0) {
    throw new AccountsPayableOverpaymentError(
      `Payment amount '${paymentAmount}' exceeds current balance due '${ap.balanceDue}'`,
    );
  }

  const newBalanceDue = subScale4(ap.balanceDue, paymentAmount);
  const newStatus: AccountsPayableStatus = isZeroScale4(newBalanceDue) ? 'PAID' : 'PARTIAL';

  return { newBalanceDue, newStatus };
}
