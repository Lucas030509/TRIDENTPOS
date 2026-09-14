/**
 * TRIDENTPOS Inventory Fixed-Point Arithmetic Engine
 *
 * Cloud PostgreSQL numeric arithmetic per DECIMAL(12,4).
 * Uses internal scale-4 bigint operations to ensure zero floating-point drift.
 * Note: Scoped strictly to inventory domain arithmetic per ADR-012/WP-017.
 */

const SCALE_FACTOR = 10000n;
const DECIMAL_STRING_REGEX = /^-?\d+\.\d{4}$/;
export const MIN_DECIMAL_12X4_SCALED = -999_999_999_999n;
export const MAX_DECIMAL_12X4_SCALED = 999_999_999_999n;

/**
 * Parses a decimal string (strictly 4 decimal places) into a scale-4 bigint.
 * Enforces DECIMAL(12,4) bounds: [-99999999.9999, +99999999.9999].
 */
export function parseDecimal12x4(input: string): bigint {
  if (typeof input !== 'string') {
    throw new RangeError(`Invalid decimal input '${String(input)}'. Must be a string.`);
  }
  const trimmed = input.trim();
  if (!DECIMAL_STRING_REGEX.test(trimmed)) {
    throw new RangeError(
      `Invalid decimal string '${input}'. Must be numeric with exactly 4 decimal places (e.g. '1.0000').`,
    );
  }

  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split('.');
  const integerPart = parts[0] || '0';
  const fractionalPart = parts[1] || '0000';

  const intBig = BigInt(integerPart);
  const fracBig = BigInt(fractionalPart);
  const scaled = intBig * SCALE_FACTOR + fracBig;
  const finalScaled = isNegative ? -scaled : scaled;

  if (finalScaled < MIN_DECIMAL_12X4_SCALED || finalScaled > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(
      `Decimal value '${input}' exceeds DECIMAL(12,4) range [-99999999.9999, 99999999.9999]`,
    );
  }

  return finalScaled;
}

/**
 * Formats a scale-4 bigint to an exact 4-decimal canonical string (e.g. "12.5000").
 * Enforces DECIMAL(12,4) bounds: [-99999999.9999, +99999999.9999].
 */
export function formatDecimal12x4(scaled: bigint): string {
  if (scaled < MIN_DECIMAL_12X4_SCALED || scaled > MAX_DECIMAL_12X4_SCALED) {
    throw new RangeError(
      `Scaled value ${scaled} exceeds DECIMAL(12,4) range [-99999999.9999, 99999999.9999]`,
    );
  }

  const isNegative = scaled < 0n;
  const abs = isNegative ? -scaled : scaled;

  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  const fracStr = fracPart.toString().padStart(4, '0');

  const prefix = isNegative && (intPart > 0n || fracPart > 0n) ? '-' : '';
  return `${prefix}${intPart.toString()}.${fracStr}`;
}

/**
 * Performs integer division with commercial Half Away From Zero rounding.
 */
export function roundDivHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero');
  }

  const isNeg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  // Remainder * 2 >= Denominator -> round up
  const quotient = n / d;
  const remainder = n % d;
  const half = d / 2n;
  const isOdd = d % 2n !== 0n;

  let rounded = quotient;
  if (isOdd) {
    if (remainder > half) {
      rounded += 1n;
    }
  } else {
    if (remainder >= half) {
      rounded += 1n;
    }
  }

  return isNeg ? -rounded : rounded;
}

/**
 * Multiplies two scale-4 numbers: (A * B) / 10000 with commercial rounding.
 */
export function multiplyScale4(a: bigint, b: bigint): bigint {
  return roundDivHalfAwayFromZero(a * b, SCALE_FACTOR);
}

/**
 * Divides two scale-4 numbers: (A * 10000) / B with commercial rounding.
 */
export function divideScale4(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new RangeError('Division by zero in divideScale4');
  }
  return roundDivHalfAwayFromZero(a * SCALE_FACTOR, b);
}
