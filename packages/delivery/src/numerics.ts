/**
 * TRIDENTPOS WP-023: Fixed-Point Scale-4 Numerics (ADR-012 & SYS-INV-001)
 * Delivery financials and monetary arithmetic backed by BigInt without floating-point inaccuracies.
 */

export const SCALE_DECIMALS = 4;
export const SCALE_FACTOR = 10_000n;

export function toScale4BigInt(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cannot convert non-finite number to Scale-4 BigInt');
    }
    const [intPart = '0', fracPart = ''] = value.toFixed(SCALE_DECIMALS).split('.');
    const sign = value < 0 ? -1n : 1n;
    const absInt = BigInt(intPart.replace('-', ''));
    const paddedFrac = fracPart.slice(0, SCALE_DECIMALS).padEnd(SCALE_DECIMALS, '0');
    return sign * (absInt * SCALE_FACTOR + BigInt(paddedFrac));
  }

  const str = value.trim();
  if (!str) return 0n;

  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;
  const parts = cleanStr.split('.');

  if (parts.length > 2) {
    throw new TypeError(`Invalid decimal string format: ${value}`);
  }

  const intPart = BigInt(parts[0] || '0');
  const rawFrac = parts[1] || '';
  const paddedFrac = rawFrac.slice(0, SCALE_DECIMALS).padEnd(SCALE_DECIMALS, '0');
  const fracPart = BigInt(paddedFrac);

  const total = intPart * SCALE_FACTOR + fracPart;
  return isNegative ? -total : total;
}

export function fromScale4BigInt(value: bigint): string {
  const isNegative = value < 0n;
  const absVal = isNegative ? -value : value;
  const intPart = absVal / SCALE_FACTOR;
  const fracPart = absVal % SCALE_FACTOR;
  const fracStr = fracPart.toString().padStart(SCALE_DECIMALS, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracStr}`;
}

export function addScale4(a: string, b: string): string {
  return fromScale4BigInt(toScale4BigInt(a) + toScale4BigInt(b));
}

export function subScale4(a: string, b: string): string {
  return fromScale4BigInt(toScale4BigInt(a) - toScale4BigInt(b));
}

export function multiplyScale4(amount: string, multiplier: string | number): string {
  const aBig = toScale4BigInt(amount);
  const mBig = toScale4BigInt(multiplier);
  const prod = (aBig * mBig) / SCALE_FACTOR;
  return fromScale4BigInt(prod);
}

export function divideScale4(amount: string, divisor: string | number): string {
  const aBig = toScale4BigInt(amount);
  const dBig = toScale4BigInt(divisor);
  if (dBig === 0n) {
    throw new RangeError('Division by zero in Scale-4 arithmetic');
  }
  const quotient = (aBig * SCALE_FACTOR) / dBig;
  return fromScale4BigInt(quotient);
}

export function compareScale4(a: string, b: string): number {
  const aBig = toScale4BigInt(a);
  const bBig = toScale4BigInt(b);
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}
