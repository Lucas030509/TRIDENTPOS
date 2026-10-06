/**
 * TRIDENTPOS Billing: Multi-Tier & Inclusive / Exclusive Tax Calculator
 * Implements ADR-012 exact scale-4 arithmetic.
 */

import {
  addBillingScale4,
  subBillingScale4,
  mulBillingScale4,
  divBillingScale4,
  assertValidBillingScale4,
} from './numerics.js';
import type { TaxScheme } from './types.js';

export interface ItemTaxCalculation {
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  taxBreakdown: Array<{
    code: string;
    name: string;
    rate: string;
    taxType: string;
    amount: string;
  }>;
}

export function calculateItemTaxes(
  unitPrice: string,
  quantity: string,
  taxSchemes: TaxScheme[],
): ItemTaxCalculation {
  assertValidBillingScale4(unitPrice);
  assertValidBillingScale4(quantity);

  const rawLineAmount = mulBillingScale4(unitPrice, quantity);

  if (!taxSchemes || taxSchemes.length === 0) {
    return {
      subtotal: rawLineAmount,
      taxAmount: '0.0000',
      totalAmount: rawLineAmount,
      taxBreakdown: [],
    };
  }

  // Check if any scheme is inclusive
  const hasInclusive = taxSchemes.some((t) => t.isInclusive);

  if (hasInclusive) {
    // In inclusive mode, rawLineAmount is the total amount (tax included).
    // Sum all rates: divisor = 1.0000 + sum(rates)
    let totalRate = '0.0000';
    for (const scheme of taxSchemes) {
      assertValidBillingScale4(scheme.rate);
      totalRate = addBillingScale4(totalRate, scheme.rate);
    }

    const divisor = addBillingScale4('1.0000', totalRate);
    const subtotal = divBillingScale4(rawLineAmount, divisor);
    const totalTax = subBillingScale4(rawLineAmount, subtotal);

    const breakdown = taxSchemes.map((scheme) => {
      const taxPart = mulBillingScale4(subtotal, scheme.rate);
      return {
        code: scheme.code,
        name: scheme.name,
        rate: scheme.rate,
        taxType: scheme.taxType,
        amount: taxPart,
      };
    });

    return {
      subtotal,
      taxAmount: totalTax,
      totalAmount: rawLineAmount,
      taxBreakdown: breakdown,
    };
  } else {
    // Exclusive mode: rawLineAmount is subtotal, taxes added on top
    let totalTax = '0.0000';
    const breakdown = taxSchemes.map((scheme) => {
      assertValidBillingScale4(scheme.rate);
      const taxPart = mulBillingScale4(rawLineAmount, scheme.rate);
      totalTax = addBillingScale4(totalTax, taxPart);
      return {
        code: scheme.code,
        name: scheme.name,
        rate: scheme.rate,
        taxType: scheme.taxType,
        amount: taxPart,
      };
    });

    const totalAmount = addBillingScale4(rawLineAmount, totalTax);

    return {
      subtotal: rawLineAmount,
      taxAmount: totalTax,
      totalAmount,
      taxBreakdown: breakdown,
    };
  }
}

export const calculateLineTaxes = calculateItemTaxes;

export function calculateInvoiceTaxes(
  items: Array<{ unitPrice: string; quantity: string; taxSchemes: TaxScheme[] }>,
): { subtotal: string; taxAmount: string; totalAmount: string } {
  let subtotal = '0.0000';
  let taxAmount = '0.0000';
  let totalAmount = '0.0000';

  for (const item of items) {
    const calc = calculateItemTaxes(item.unitPrice, item.quantity, item.taxSchemes);
    subtotal = addBillingScale4(subtotal, calc.subtotal);
    taxAmount = addBillingScale4(taxAmount, calc.taxAmount);
    totalAmount = addBillingScale4(totalAmount, calc.totalAmount);
  }

  return { subtotal, taxAmount, totalAmount };
}
