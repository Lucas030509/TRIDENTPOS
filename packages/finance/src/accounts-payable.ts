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
 * Parses payment terms to a deterministic number of credit days.
 * Governed formats:
 * - NET_XX (e.g. NET_30 -> 30, NET_15 -> 15, NET_60 -> 60, NET_0 -> 0)
 * - CREDIT_XX (e.g. CREDIT_30 -> 30)
 * - XX_DAYS (e.g. 30_DAYS -> 30)
 * - XX (integer string, e.g. "30" -> 30)
 * - CONTADO / CASH / IMMEDIATE -> 0
 */
export function parseCreditDaysFromPaymentTerms(paymentTerms: string | null | undefined): number {
  if (!paymentTerms || typeof paymentTerms !== 'string') {
    throw new InvalidPaymentTermsError(
      'Payment terms are missing or invalid; cannot derive deterministic AP due date',
    );
  }

  const normalized = paymentTerms.trim().toUpperCase();

  if (
    [
      'CONTADO',
      'CASH',
      'CONTADO_CASH',
      'CASH_CONTADO',
      'IMMEDIATE',
      'NET_0',
      '0_DAYS',
      '0',
    ].includes(normalized)
  ) {
    return 0;
  }

  const netMatch = normalized.match(/^NET_(\d+)$/);
  if (netMatch?.[1]) {
    return parseInt(netMatch[1], 10);
  }

  const creditMatch = normalized.match(/^CREDIT_(\d+)$/);
  if (creditMatch?.[1]) {
    return parseInt(creditMatch[1], 10);
  }

  const daysMatch = normalized.match(/^(\d+)_DAYS$/);
  if (daysMatch?.[1]) {
    return parseInt(daysMatch[1], 10);
  }

  const intMatch = normalized.match(/^\d+$/);
  if (intMatch) {
    return parseInt(normalized, 10);
  }

  throw new InvalidPaymentTermsError(
    `Unrecognized payment terms format '${paymentTerms}'. Governed formats: NET_XX, CREDIT_XX, XX_DAYS, CONTADO, CASH`,
  );
}

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
