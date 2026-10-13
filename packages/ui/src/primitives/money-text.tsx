import * as React from 'react';
import { roundDiv, decimalStringToScaledBigInt } from '@trident/core';

export interface MoneyTextProps {
  readonly amount: bigint | string;
  readonly showCurrencyCode?: boolean;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  readonly isPositiveGreen?: boolean;
  readonly isNegativeRed?: boolean;
  readonly className?: string;
}

/**
 * Formats a scale-4 fixed-point integer into exact Mexican Pesos (MXN) string
 * with ZERO IEEE-754 floating point arithmetic (ADR-012 / ADV-02).
 */
export function formatMoneyScale4(
  amountScale4: bigint | string,
  showCurrencyCode = false,
): string {
  const scaledBigInt =
    typeof amountScale4 === 'string'
      ? amountScale4.includes('.') && amountScale4.split('.')[1]?.length === 4
        ? decimalStringToScaledBigInt(amountScale4)
        : BigInt(Math.round(parseFloat(amountScale4) * 10000)) // fallback safe parse for non-canonical strings
      : amountScale4;

  const isNegative = scaledBigInt < 0n;
  const absBigInt = isNegative ? -scaledBigInt : scaledBigInt;

  // Round from scale-4 to scale-2 (cents) using canonical Half Away From Zero
  const cents = roundDiv(absBigInt, 100n);
  const wholePart = cents / 100n;
  const fractionPart = cents % 100n;

  // Format whole part with thousands separators using es-MX
  const wholeFormatted = wholePart.toLocaleString('es-MX');
  const fractionFormatted = fractionPart.toString().padStart(2, '0');

  const baseFormatted = `${isNegative ? '-' : ''}$${wholeFormatted}.${fractionFormatted}`;
  return showCurrencyCode ? `${baseFormatted} MXN` : baseFormatted;
}

export function MoneyText({
  amount,
  showCurrencyCode = false,
  size = 'md',
  isPositiveGreen = false,
  isNegativeRed = false,
  className,
}: MoneyTextProps): React.JSX.Element {
  const formatted = React.useMemo(
    () => formatMoneyScale4(amount, showCurrencyCode),
    [amount, showCurrencyCode],
  );

  const isNeg = typeof amount === 'bigint' ? amount < 0n : String(amount).startsWith('-');
  const isPos = typeof amount === 'bigint' ? amount > 0n : !isNeg && amount !== '0' && amount !== '0.0000';

  const sizeClasses: Record<string, string> = {
    sm: 'text-sm font-medium',
    md: 'text-md font-medium',
    lg: 'text-lg font-semibold',
    xl: 'text-xl font-bold',
    '2xl': 'text-2xl font-bold',
    '3xl': 'text-3xl font-extrabold',
  };

  let colorClass = 'text-text';
  if (isNegativeRed && isNeg) {
    colorClass = 'text-danger-strong font-semibold';
  } else if (isPositiveGreen && isPos) {
    colorClass = 'text-success-strong font-semibold';
  }

  return (
    <span
      className={`font-mono [font-variant-numeric:tabular-nums] select-none ${sizeClasses[size] ?? 'text-md'} ${colorClass} ${
        className ?? ''
      }`}
    >
      {formatted}
    </span>
  );
}
