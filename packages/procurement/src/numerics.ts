/**
 * TRIDENTPOS Procurement Exact Fixed-Point Scale-4 Numerics
 * Built on @trident/core canonical arithmetic. Zero floating-point arithmetic.
 */

import {
  scaledBigIntToDecimalString,
  decimalStringToScaledBigInt,
  calculateLineSubtotal,
} from '@trident/core';

export const ZERO_SCALE4 = '0.0000';

export function addScale4(a: string, b: string): string {
  const scaledA = decimalStringToScaledBigInt(a);
  const scaledB = decimalStringToScaledBigInt(b);
  return scaledBigIntToDecimalString(scaledA + scaledB);
}

export function subScale4(a: string, b: string): string {
  const scaledA = decimalStringToScaledBigInt(a);
  const scaledB = decimalStringToScaledBigInt(b);
  return scaledBigIntToDecimalString(scaledA - scaledB);
}

export function mulScale4(quantity: string, unitPrice: string): string {
  const qtyScaled = decimalStringToScaledBigInt(quantity);
  const priceScaled = decimalStringToScaledBigInt(unitPrice);
  const resultScaled = calculateLineSubtotal(priceScaled, qtyScaled);
  return scaledBigIntToDecimalString(resultScaled);
}

export function cmpScale4(a: string, b: string): number {
  const scaledA = decimalStringToScaledBigInt(a);
  const scaledB = decimalStringToScaledBigInt(b);
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
