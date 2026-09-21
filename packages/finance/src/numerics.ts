/**
 * TRIDENTPOS Finance Exact Fixed-Point Scale-4 Numerics
 * Built on @trident/core canonical arithmetic. Zero floating-point arithmetic.
 */

import {
  scaledBigIntToDecimalString,
  decimalStringToScaledBigInt,
  calculateLineSubtotal,
} from '@trident/core';
import { InvalidFinancialAmountError } from './errors.js';

export const ZERO_SCALE4 = '0.0000';

export function parseDecimal12x4(val: string): bigint {
  try {
    return decimalStringToScaledBigInt(val);
  } catch (err) {
    throw new InvalidFinancialAmountError(
      `Invalid Scale-4 financial amount '${val}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function formatDecimal12x4(scaled: bigint): string {
  return scaledBigIntToDecimalString(scaled);
}

export function addScale4(a: string, b: string): string {
  const scaledA = parseDecimal12x4(a);
  const scaledB = parseDecimal12x4(b);
  return formatDecimal12x4(scaledA + scaledB);
}

export function subScale4(a: string, b: string): string {
  const scaledA = parseDecimal12x4(a);
  const scaledB = parseDecimal12x4(b);
  return formatDecimal12x4(scaledA - scaledB);
}

export function mulScale4(quantity: string, unitPrice: string): string {
  const qtyScaled = parseDecimal12x4(quantity);
  const priceScaled = parseDecimal12x4(unitPrice);
  const resultScaled = calculateLineSubtotal(priceScaled, qtyScaled);
  return formatDecimal12x4(resultScaled);
}

export function cmpScale4(a: string, b: string): number {
  const scaledA = parseDecimal12x4(a);
  const scaledB = parseDecimal12x4(b);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

export function isZeroScale4(val: string): boolean {
  return cmpScale4(val, ZERO_SCALE4) === 0;
}

export function isPositiveScale4(val: string): boolean {
  return cmpScale4(val, ZERO_SCALE4) > 0;
}

export function isNonNegativeScale4(val: string): boolean {
  return cmpScale4(val, ZERO_SCALE4) >= 0;
}

export function isNegativeScale4(val: string): boolean {
  return cmpScale4(val, ZERO_SCALE4) < 0;
}
