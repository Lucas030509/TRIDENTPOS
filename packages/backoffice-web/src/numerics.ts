/**
 * TRIDENTPOS WP-024: ADR-012 Scale-4 UI Numerics & Exact Currency Engine
 * Zero floating-point math, fixed-point scale-4 integer arithmetic backed by BigInt for Backoffice UI.
 */

export const SCALE_4_MULTIPLIER = 10000n;

/**
 * Converts scale-4 string or number representation to BigInt.
 */
export function toScale4BigInt(val: string | number | bigint): bigint {
  if (typeof val === 'bigint') {
    return val;
  }

  const str = String(val).trim();
  if (!str) {
    return 0n;
  }

  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;

  const parts = cleanStr.split('.');
  const integerPart = parts[0] || '0';
  let fractionalPart = parts[1] || '';

  if (fractionalPart.length > 4) {
    fractionalPart = fractionalPart.slice(0, 4);
  } else {
    fractionalPart = fractionalPart.padEnd(4, '0');
  }

  const combined = BigInt(integerPart) * SCALE_4_MULTIPLIER + BigInt(fractionalPart);
  return isNegative ? -combined : combined;
}

/**
 * Converts BigInt scale-4 back to canonical 4-decimal string (e.g. 12500000n -> "1250.0000").
 */
export function fromScale4BigInt(val: bigint): string {
  const isNegative = val < 0n;
  const absVal = isNegative ? -val : val;

  const integerPart = absVal / SCALE_4_MULTIPLIER;
  const remainder = absVal % SCALE_4_MULTIPLIER;
  const fractionalPart = remainder.toString().padStart(4, '0');

  const formatted = `${integerPart}.${fractionalPart}`;
  return isNegative ? `-${formatted}` : formatted;
}

export function addScale4(a: string | bigint, b: string | bigint): string {
  return fromScale4BigInt(toScale4BigInt(a) + toScale4BigInt(b));
}

export function subScale4(a: string | bigint, b: string | bigint): string {
  return fromScale4BigInt(toScale4BigInt(a) - toScale4BigInt(b));
}

export function multiplyScale4(a: string | bigint, b: string | bigint): string {
  const bigA = toScale4BigInt(a);
  const bigB = toScale4BigInt(b);
  const result = (bigA * bigB) / SCALE_4_MULTIPLIER;
  return fromScale4BigInt(result);
}

export function divideScale4(a: string | bigint, b: string | bigint): string {
  const bigA = toScale4BigInt(a);
  const bigB = toScale4BigInt(b);
  if (bigB === 0n) {
    throw new Error('Division by zero in Scale-4 arithmetic');
  }
  const result = (bigA * SCALE_4_MULTIPLIER) / bigB;
  return fromScale4BigInt(result);
}

export function compareScale4(a: string | bigint, b: string | bigint): number {
  const bigA = toScale4BigInt(a);
  const bigB = toScale4BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

/**
 * Formats scale-4 string into human-friendly 2-decimal currency string (e.g. "1250.0000" -> "$1,250.00").
 */
export function formatCurrencyScale4(scale4Val: string | bigint, symbol = '$'): string {
  const big = toScale4BigInt(scale4Val);
  const isNegative = big < 0n;
  const absBig = isNegative ? -big : big;

  const integerPart = absBig / SCALE_4_MULTIPLIER;
  const remainder = absBig % SCALE_4_MULTIPLIER;
  // Round to 2 decimals
  const twoDecimalCents = Math.round(Number(remainder) / 100);

  let intStr = integerPart.toLocaleString('en-US');
  let centStr = twoDecimalCents.toString().padStart(2, '0');

  if (twoDecimalCents === 100) {
    intStr = (integerPart + 1n).toLocaleString('en-US');
    centStr = '00';
  }

  const formatted = `${symbol}${intStr}.${centStr}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Parses user input currency (e.g. "$1,250.50", "1250.5") into canonical Scale-4 string.
 */
export function parseCurrencyToScale4(input: string): string {
  if (!input) return '0.0000';
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return '0.0000';
  return fromScale4BigInt(toScale4BigInt(cleaned));
}

/**
 * Calculates per-portion cost from batch total and portion yield.
 */
export function calculatePortionCostScale4(
  totalBatchCostScale4: string,
  portionYield: number,
): string {
  if (portionYield <= 0) return '0.0000';
  const yieldScale4 = fromScale4BigInt(BigInt(portionYield) * SCALE_4_MULTIPLIER);
  return divideScale4(totalBatchCostScale4, yieldScale4);
}

/**
 * Calculates gross quantity needed from net requirement and waste/merma factor.
 * Formula: Gross = Net / (1 - WastePercent / 100)
 */
export function calculateGrossQuantityScale4(
  netQuantityScale4: string,
  wasteFactorPercent: string,
): string {
  const wasteBig = toScale4BigInt(wasteFactorPercent);
  const hundredBig = 100n * SCALE_4_MULTIPLIER;

  if (wasteBig >= hundredBig) {
    throw new Error('Waste factor cannot be 100% or greater');
  }

  const divisorScale4 = fromScale4BigInt(hundredBig - wasteBig);
  const numeratorScale4 = multiplyScale4(netQuantityScale4, '100.0000');

  return divideScale4(numeratorScale4, divisorScale4);
}
