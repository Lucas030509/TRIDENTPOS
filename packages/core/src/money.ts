/**
 * TRIDENTPOS Platform Core: Canonical Exact Fixed-Point Monetary Primitive
 * Implements ADR-012 (Project Canonical Rounding Mode: Half Away From Zero).
 * Authoritative storage: signed 64-bit integer at scale 4 (factor 10000n).
 * Zero IEEE 754 floating-point numbers in authoritative financial paths.
 */

export const MONEY_SCALE = 4;
export const SCALE_FACTOR = 10000n;

/**
 * Cloud PostgreSQL DECIMAL(12,4) canonical interoperable range.
 * 12 total digits, 4 fractional, 8 integer: [-99,999,999.9999, +99,999,999.9999]
 */
export const MIN_SCALE4_BIGINT = -999_999_999_999n;
export const MAX_SCALE4_BIGINT = 999_999_999_999n;

const DECIMAL_STRING_REGEX = /^-?\d+\.\d{4}$/;

/**
 * Sign-safe Half Away From Zero integer division:
 * roundDiv(A, B) = sign(A * B) * floor((|A| + floor(|B| / 2)) / |B|)
 */
export function roundDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new RangeError('Division by zero');
  }
  const sign = a < 0n !== b < 0n ? -1n : 1n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const halfB = absB / 2n;
  const quotient = (absA + halfB) / absB;
  return sign * quotient;
}

/**
 * Converts a scale-4 signed bigint to canonical fixed 4-decimal string.
 * Strictly integer arithmetic — zero floating point.
 */
export function scaledBigIntToDecimalString(scaled: bigint): string {
  const sign = scaled < 0n ? '-' : '';
  const abs = scaled < 0n ? -scaled : scaled;
  const whole = abs / SCALE_FACTOR;
  const fraction = abs % SCALE_FACTOR;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(4, '0')}`;
}

/**
 * Parses a canonical fixed 4-decimal string to scale-4 signed bigint.
 * Strict lexical parsing against /^-?\d+\.\d{4}$/ — zero parseFloat/Number().
 */
export function decimalStringToScaledBigInt(str: string): bigint {
  if (typeof str !== 'string' || !DECIMAL_STRING_REGEX.test(str)) {
    throw new TypeError(
      `Invalid canonical decimal string format '${str}'. Expected exact format: ^-?\\d+\\.\\d{4}$`,
    );
  }

  const isNegative = str.startsWith('-');
  const clean = isNegative ? str.slice(1) : str;
  const dotIndex = clean.indexOf('.');
  const wholeStr = clean.slice(0, dotIndex);
  const fracStr = clean.slice(dotIndex + 1);

  const whole = BigInt(wholeStr);
  const fraction = BigInt(fracStr);
  const scaled = whole * SCALE_FACTOR + fraction;
  const result = isNegative ? -scaled : scaled;

  if (result < MIN_SCALE4_BIGINT || result > MAX_SCALE4_BIGINT) {
    throw new RangeError(
      `Value '${str}' (${result}n) exceeds canonical scale-4 range [${MIN_SCALE4_BIGINT}n, ${MAX_SCALE4_BIGINT}n]`,
    );
  }

  return result;
}

/**
 * Validates whether a scale-4 bigint falls within the canonical interoperable range.
 */
export function isValidScale4Range(amountScale4: bigint): boolean {
  return amountScale4 >= MIN_SCALE4_BIGINT && amountScale4 <= MAX_SCALE4_BIGINT;
}

/**
 * Line item financial calculation functions per ADR-012 Sec 4.3 & WP-014 Sec 8.
 */
export function calculateLineSubtotal(unitPriceScale4: bigint, quantityScale4: bigint): bigint {
  return roundDiv(unitPriceScale4 * quantityScale4, SCALE_FACTOR);
}

export function calculateNetSubtotal(
  lineSubtotalScale4: bigint,
  discountAmountScale4: bigint,
): bigint {
  return lineSubtotalScale4 - discountAmountScale4;
}

export function calculateTaxAmount(netSubtotalScale4: bigint, taxRateScale4: bigint): bigint {
  return roundDiv(netSubtotalScale4 * taxRateScale4, SCALE_FACTOR);
}

export function calculateLineTotal(netSubtotalScale4: bigint, taxAmountScale4: bigint): bigint {
  return netSubtotalScale4 + taxAmountScale4;
}

/**
 * Immutable Money Value Object (ADR-012 Sec 4.5).
 */
export class Money {
  public readonly amountScale4: bigint;

  private constructor(amountScale4: bigint) {
    if (!isValidScale4Range(amountScale4)) {
      throw new RangeError(
        `Amount ${amountScale4}n exceeds canonical scale-4 range [${MIN_SCALE4_BIGINT}n, ${MAX_SCALE4_BIGINT}n]`,
      );
    }
    this.amountScale4 = amountScale4;
  }

  public static fromScale4(amountScale4: bigint): Money {
    return new Money(amountScale4);
  }

  public static fromDecimalString(str: string): Money {
    return new Money(decimalStringToScaledBigInt(str));
  }

  public static zero(): Money {
    return new Money(0n);
  }

  public plus(other: Money): Money {
    return new Money(this.amountScale4 + other.amountScale4);
  }

  public minus(other: Money): Money {
    return new Money(this.amountScale4 - other.amountScale4);
  }

  public times(quantityScale4: bigint): Money {
    return new Money(calculateLineSubtotal(this.amountScale4, quantityScale4));
  }

  public divide(divisor: bigint): Money {
    return new Money(roundDiv(this.amountScale4, divisor));
  }

  public toDecimalString(): string {
    return scaledBigIntToDecimalString(this.amountScale4);
  }

  public equals(other: Money): boolean {
    return this.amountScale4 === other.amountScale4;
  }

  public isZero(): boolean {
    return this.amountScale4 === 0n;
  }

  public isPositive(): boolean {
    return this.amountScale4 > 0n;
  }

  public isNegative(): boolean {
    return this.amountScale4 < 0n;
  }

  public compare(other: Money): number {
    if (this.amountScale4 < other.amountScale4) return -1;
    if (this.amountScale4 > other.amountScale4) return 1;
    return 0;
  }

  public toJSON(): string {
    return this.toDecimalString();
  }
}
