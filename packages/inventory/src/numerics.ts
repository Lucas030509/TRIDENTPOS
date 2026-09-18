/**
 * TRIDENTPOS Inventory Fixed-Point Arithmetic Helpers
 *
 * Cloud PostgreSQL numeric arithmetic per DECIMAL(12,4).
 * Built directly upon canonical @trident/core exact fixed-point primitives.
 * Scoped strictly to inventory domain arithmetic per ADR-012/WP-017/WP-018.
 * Zero IEEE 754 floating-point numbers in authoritative calculations.
 */

import {
  roundDiv,
  scaledBigIntToDecimalString,
  decimalStringToScaledBigInt,
  SCALE_FACTOR,
  MIN_SCALE4_BIGINT,
  MAX_SCALE4_BIGINT,
} from '@trident/core';

export const MIN_DECIMAL_12X4_SCALED = MIN_SCALE4_BIGINT;
export const MAX_DECIMAL_12X4_SCALED = MAX_SCALE4_BIGINT;
export { SCALE_FACTOR };

/**
 * Parses a decimal string (strictly 4 decimal places) into a scale-4 bigint.
 * Enforces DECIMAL(12,4) bounds: [-99999999.9999, +99999999.9999].
 * Fails closed on invalid input format or out-of-bounds numbers.
 */
export function parseDecimal12x4(input: string): bigint {
  if (typeof input !== 'string') {
    throw new RangeError(`Invalid decimal input '${String(input)}'. Must be a string.`);
  }
  const trimmed = input.trim();
  try {
    return decimalStringToScaledBigInt(trimmed);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new RangeError(err.message);
    }
    throw new RangeError(`Invalid decimal string '${input}'`);
  }
}

/**
 * Formats a scale-4 bigint to an exact 4-decimal canonical string (e.g. "12.5000").
 * Enforces DECIMAL(12,4) bounds: [-99999999.9999, +99999999.9999].
 */
export function formatDecimal12x4(scaled: bigint): string {
  if (scaled < MIN_DECIMAL_12X4_SCALED || scaled > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(
      `Scaled value ${scaled} exceeds DECIMAL(12,4) range [${MIN_DECIMAL_12X4_SCALED}, ${MAX_DECIMAL_12X4_SCALED}]`,
    );
  }
  return scaledBigIntToDecimalString(scaled);
}

/**
 * Multiplies two scale-4 numbers: (A * B) / 10000 with Half Away From Zero rounding.
 */
export function multiplyScale4(a: bigint, b: bigint): bigint {
  return roundDiv(a * b, SCALE_FACTOR);
}

/**
 * Divides two scale-4 numbers: (A * 10000) / B with Half Away From Zero rounding.
 */
export function divideScale4(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new RangeError('Division by zero in divideScale4');
  }
  return roundDiv(a * SCALE_FACTOR, b);
}

/**
 * Adds two scale-4 numbers with bounds checking.
 */
export function addScale4(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (result < MIN_DECIMAL_12X4_SCALED || result > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(`Result ${result} exceeds DECIMAL(12,4) range`);
  }
  return result;
}

/**
 * Subtracts two scale-4 numbers with bounds checking.
 */
export function subtractScale4(a: bigint, b: bigint): bigint {
  const result = a - b;
  if (result < MIN_DECIMAL_12X4_SCALED || result > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(`Result ${result} exceeds DECIMAL(12,4) range`);
  }
  return result;
}

/**
 * Negates a scale-4 number with bounds checking.
 */
export function negateScale4(a: bigint): bigint {
  const result = -a;
  if (result < MIN_DECIMAL_12X4_SCALED || result > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(`Result ${result} exceeds DECIMAL(12,4) range`);
  }
  return result;
}

/**
 * Absolute value of a scale-4 number.
 */
export function absScale4(a: bigint): bigint {
  return a < 0n ? -a : a;
}
