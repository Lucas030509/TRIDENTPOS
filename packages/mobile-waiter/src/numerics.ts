/**
 * TRIDENTPOS WP-025: ADR-012 Scale-4 UI Numerics & DEC-015 Proportional Bill Splitting Engine
 * Exact fixed-point scale-4 integer math backed by BigInt for Mobile Handheld.
 */

import type { BillSplitMode, BillSplitResult, ComandaItemDraft, SubAccountDraft } from './types.js';

export const SCALE_4_MULTIPLIER = 10000n;

export function toScale4BigInt(val: string | number | bigint): bigint {
  if (typeof val === 'bigint') return val;
  const str = String(val).trim();
  if (!str) return 0n;

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
  const product = toScale4BigInt(a) * toScale4BigInt(b);
  const rounded = product / SCALE_4_MULTIPLIER;
  return fromScale4BigInt(rounded);
}

export function divideScale4(numerator: string | bigint, denominator: string | bigint): string {
  const denBig = toScale4BigInt(denominator);
  if (denBig === 0n) {
    throw new Error('DIVISION_BY_ZERO: Cannot divide by scale-4 zero.');
  }
  const scaledNumerator = toScale4BigInt(numerator) * SCALE_4_MULTIPLIER;
  const quotient = scaledNumerator / denBig;
  return fromScale4BigInt(quotient);
}

export function compareScale4(a: string | bigint, b: string | bigint): number {
  const aBig = toScale4BigInt(a);
  const bBig = toScale4BigInt(b);
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

export function formatCurrencyScale4(val: string | bigint, currency = '$'): string {
  const big = toScale4BigInt(val);
  const isNegative = big < 0n;
  const absBig = isNegative ? -big : big;

  // Round scale-4 to 2 decimal places for human viewing
  const roundedCents = (absBig + 50n) / 100n;
  const pesos = roundedCents / 100n;
  const cents = roundedCents % 100n;

  const pesosStr = pesos.toLocaleString('en-US');
  const centsStr = cents.toString().padStart(2, '0');

  return `${isNegative ? '-' : ''}${currency}${pesosStr}.${centsStr}`;
}

export function calculateItemSubtotalScale4(
  unitPriceScale4: string,
  quantityScale4: string,
  modifiersDeltaScale4 = '0.0000',
): string {
  const effectiveUnitPrice = addScale4(unitPriceScale4, modifiersDeltaScale4);
  return multiplyScale4(effectiveUnitPrice, quantityScale4);
}

/**
 * DEC-015 / OQ-SSOT-06: Proportional Bill Splitting Algorithm
 * Evenly distributes or apportions bill amounts, proportionally allocating discounts and tips,
 * and assigns rounding residual to the last subaccount to ensure 100% exact parity with the original total.
 */
export function calculateProportionalSplit(params: {
  mode: BillSplitMode;
  splitCount?: number; // Used for EQUAL mode (e.g. 3 people)
  itemAssignments?: readonly { subAccountIndex: number; item: ComandaItemDraft }[];
  originalTotalScale4: string;
  totalDiscountScale4?: string;
  totalTipScale4?: string;
}): BillSplitResult {
  const totalBig = toScale4BigInt(params.originalTotalScale4);
  const discountBig = toScale4BigInt(params.totalDiscountScale4 || '0.0000');
  const tipBig = toScale4BigInt(params.totalTipScale4 || '0.0000');

  const subAccounts: SubAccountDraft[] = [];

  if (params.mode === 'EQUAL') {
    const n = Math.max(1, params.splitCount || 2);
    const nBig = BigInt(n);

    const baseAmount = totalBig / nBig;
    const baseDiscount = discountBig / nBig;
    const baseTip = tipBig / nBig;

    let accumulatedTotal = 0n;
    let accumulatedDiscount = 0n;
    let accumulatedTip = 0n;

    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      // Last subaccount absorbs the residue
      const subTotal = isLast ? totalBig - accumulatedTotal : baseAmount;
      const subDiscount = isLast ? discountBig - accumulatedDiscount : baseDiscount;
      const subTip = isLast ? tipBig - accumulatedTip : baseTip;

      accumulatedTotal += subTotal;
      accumulatedDiscount += subDiscount;
      accumulatedTip += subTip;

      subAccounts.push({
        subAccountId: `sub-${i + 1}`,
        label: `Persona ${i + 1}`,
        items: [],
        rawSubtotalScale4: fromScale4BigInt(subTotal),
        proratedDiscountScale4: fromScale4BigInt(subDiscount),
        proratedTipScale4: fromScale4BigInt(subTip),
        totalToPayScale4: fromScale4BigInt(subTotal),
      });
    }
  } else if (params.mode === 'BY_ITEM') {
    const assignments = params.itemAssignments || [];
    // Group items by subAccountIndex
    const groups = new Map<number, ComandaItemDraft[]>();
    for (const a of assignments) {
      const list = groups.get(a.subAccountIndex) || [];
      list.push(a.item);
      groups.set(a.subAccountIndex, list);
    }

    const sortedIndices = Array.from(groups.keys()).sort((a, b) => a - b);

    // Calculate gross subtotal of all items
    let grossAllItemsBig = 0n;
    const subTotalsMap = new Map<number, bigint>();
    for (const [idx, items] of groups.entries()) {
      let subTotal = 0n;
      for (const it of items) {
        subTotal += toScale4BigInt(it.subtotalScale4);
      }
      subTotalsMap.set(idx, subTotal);
      grossAllItemsBig += subTotal;
    }

    if (grossAllItemsBig === 0n) {
      grossAllItemsBig = 1n; // Avoid div by zero
    }

    let accumulatedTotal = 0n;
    let accumulatedDiscount = 0n;
    let accumulatedTip = 0n;

    for (let i = 0; i < sortedIndices.length; i++) {
      const idx = sortedIndices[i]!;
      const isLast = i === sortedIndices.length - 1;
      const subItems = groups.get(idx) || [];
      const subGrossBig = subTotalsMap.get(idx) || 0n;

      // Proportional discount and tip based on subGross / grossAll
      const subDiscount = isLast
        ? discountBig - accumulatedDiscount
        : (discountBig * subGrossBig) / grossAllItemsBig;

      const subTip = isLast ? tipBig - accumulatedTip : (tipBig * subGrossBig) / grossAllItemsBig;

      accumulatedDiscount += subDiscount;
      accumulatedTip += subTip;

      // Net total to pay for this subaccount = gross - discount + tip
      const rawNet = subGrossBig - subDiscount + subTip;
      const subTotal = isLast ? totalBig - accumulatedTotal : rawNet;
      accumulatedTotal += subTotal;

      subAccounts.push({
        subAccountId: `sub-${idx + 1}`,
        label: `Comensal ${idx + 1}`,
        items: subItems,
        rawSubtotalScale4: fromScale4BigInt(subGrossBig),
        proratedDiscountScale4: fromScale4BigInt(subDiscount),
        proratedTipScale4: fromScale4BigInt(subTip),
        totalToPayScale4: fromScale4BigInt(subTotal),
      });
    }
  }

  // Verification of the architectural invariant (sum == original total)
  let sumOfSubAccountsBig = 0n;
  for (const s of subAccounts) {
    sumOfSubAccountsBig += toScale4BigInt(s.totalToPayScale4);
  }

  const residueBig = totalBig - sumOfSubAccountsBig;
  const balanced = residueBig === 0n;

  return {
    originalTotalScale4: fromScale4BigInt(totalBig),
    subAccounts,
    sumOfSubAccountsScale4: fromScale4BigInt(sumOfSubAccountsBig),
    roundingResidueScale4: fromScale4BigInt(residueBig),
    balanced,
  };
}
