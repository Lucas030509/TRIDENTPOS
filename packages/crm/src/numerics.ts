/**
 * TRIDENTPOS WP-022 CRM & Loyalty
 * Scale 4 Fixed-Point BigInt Numerics per ADR-012 / SYS-INV-001
 */

const SCALE = 4;
const MULTIPLIER = 10000n;

/**
 * Converts scale-4 decimal string (e.g. "120.5000", "-5.0000") to BigInt base units.
 */
export function toScale4BigInt(val: string): bigint {
  const trimmed = val.trim();
  const isNegative = trimmed.startsWith('-');
  const clean = isNegative ? trimmed.slice(1) : trimmed;

  const parts = clean.split('.');
  const wholePart = parts[0] || '0';
  const fracPart = (parts[1] || '').padEnd(SCALE, '0').slice(0, SCALE);

  const wholeBig = BigInt(wholePart) * MULTIPLIER;
  const fracBig = BigInt(fracPart);
  const total = wholeBig + fracBig;

  return isNegative ? -total : total;
}

/**
 * Converts BigInt base units back to canonical Scale-4 decimal string.
 */
export function fromScale4BigInt(units: bigint): string {
  const isNegative = units < 0n;
  const abs = isNegative ? -units : units;

  const whole = abs / MULTIPLIER;
  const frac = abs % MULTIPLIER;
  const fracStr = frac.toString().padStart(SCALE, '0');

  return `${isNegative ? '-' : ''}${whole}.${fracStr}`;
}

export function addScale4(a: string, b: string): string {
  return fromScale4BigInt(toScale4BigInt(a) + toScale4BigInt(b));
}

export function subScale4(a: string, b: string): string {
  return fromScale4BigInt(toScale4BigInt(a) - toScale4BigInt(b));
}

export function compareScale4(a: string, b: string): number {
  const diff = toScale4BigInt(a) - toScale4BigInt(b);
  if (diff > 0n) return 1;
  if (diff < 0n) return -1;
  return 0;
}

export function isZeroScale4(a: string): boolean {
  return toScale4BigInt(a) === 0n;
}

export function isPositiveScale4(a: string): boolean {
  return toScale4BigInt(a) > 0n;
}

export function multiplyScale4(amount: string, factor: string): string {
  const aBig = toScale4BigInt(amount);
  const fBig = toScale4BigInt(factor);
  const product = (aBig * fBig) / MULTIPLIER;
  return fromScale4BigInt(product);
}

export function divideScale4(amount: string, divisor: string): string {
  const aBig = toScale4BigInt(amount);
  const dBig = toScale4BigInt(divisor);
  if (dBig === 0n) {
    throw new Error('Division by zero in Scale-4 fixed point');
  }
  const quotient = (aBig * MULTIPLIER) / dBig;
  return fromScale4BigInt(quotient);
}

export function absScale4(val: string): string {
  const big = toScale4BigInt(val);
  return fromScale4BigInt(big < 0n ? -big : big);
}
