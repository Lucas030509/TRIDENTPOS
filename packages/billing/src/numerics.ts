/**
 * TRIDENTPOS Billing: Exact Scale-4 Fixed-Point Monetary Calculations
 * Implements ADR-012 via @trident/core primitives.
 */

import {
  decimalStringToScaledBigInt,
  scaledBigIntToDecimalString,
  roundDiv,
  SCALE_FACTOR,
} from '@trident/core';

export function assertValidBillingScale4(val: string): void {
  decimalStringToScaledBigInt(val);
}

export function addBillingScale4(a: string, b: string): string {
  const bigA = decimalStringToScaledBigInt(a);
  const bigB = decimalStringToScaledBigInt(b);
  return scaledBigIntToDecimalString(bigA + bigB);
}

export function subBillingScale4(a: string, b: string): string {
  const bigA = decimalStringToScaledBigInt(a);
  const bigB = decimalStringToScaledBigInt(b);
  return scaledBigIntToDecimalString(bigA - bigB);
}

export function mulBillingScale4(amount: string, rate: string): string {
  const bigAmount = decimalStringToScaledBigInt(amount);
  const bigRate = decimalStringToScaledBigInt(rate);
  const product = bigAmount * bigRate;
  const rounded = roundDiv(product, SCALE_FACTOR);
  return scaledBigIntToDecimalString(rounded);
}

export function divBillingScale4(amount: string, divisor: string): string {
  const bigAmount = decimalStringToScaledBigInt(amount);
  const bigDivisor = decimalStringToScaledBigInt(divisor);
  if (bigDivisor === 0n) {
    throw new RangeError('Division by zero in billing scale-4 arithmetic');
  }
  const scaledDividend = bigAmount * SCALE_FACTOR;
  const quotient = roundDiv(scaledDividend, bigDivisor);
  return scaledBigIntToDecimalString(quotient);
}

export function cmpBillingScale4(a: string, b: string): number {
  const bigA = decimalStringToScaledBigInt(a);
  const bigB = decimalStringToScaledBigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}
