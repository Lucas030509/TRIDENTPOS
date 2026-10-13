/**
 * TRIDENTPOS WP-022 CRM Customer Profiles & Loyalty Rewards Engine
 * Pure Domain Engine: Points Accrual, RestCard Wallet, Expiry & Promotions
 */

import crypto from 'node:crypto';
import type { LoyaltyAccount, LoyaltyTransaction, LoyaltyTier, Promotion } from './types.js';
import {
  addScale4,
  subScale4,
  multiplyScale4,
  divideScale4,
  compareScale4,
  isPositiveScale4,
  toScale4BigInt,
} from './numerics.js';
import {
  LoyaltyAccountInactiveError,
  InsufficientLoyaltyPointsError,
  InsufficientRestCardBalanceError,
} from './errors.js';

export const TIER_MULTIPLIERS: Record<LoyaltyTier, string> = {
  BRONZE: '1.0000',
  SILVER: '1.2500',
  GOLD: '1.5000',
  PLATINUM: '2.0000',
};

export const DEFAULT_POINTS_PER_CURRENCY_UNIT = '0.1000'; // 1 point per $10.0000 spent
export const DEFAULT_REDEMPTION_VALUE_PER_POINT = '0.1000'; // 1 point = $0.1000 discount

/**
 * Resolves the loyalty tier based on cumulative points earned or balance.
 */
export function resolveTierForPoints(pointsBalance: string): LoyaltyTier {
  if (compareScale4(pointsBalance, '5000.0000') >= 0) {
    return 'PLATINUM';
  }
  if (compareScale4(pointsBalance, '2000.0000') >= 0) {
    return 'GOLD';
  }
  if (compareScale4(pointsBalance, '500.0000') >= 0) {
    return 'SILVER';
  }
  return 'BRONZE';
}

/**
 * Calculates points earned from ticket net total based on tier and optional rule multiplier.
 */
export function calculatePointsEarned(
  ticketNetTotal: string,
  tier: LoyaltyTier,
  ruleMultiplier = '1.0000',
  pointsRate = DEFAULT_POINTS_PER_CURRENCY_UNIT,
): string {
  if (!isPositiveScale4(ticketNetTotal)) {
    return '0.0000';
  }
  const tierMultiplier = TIER_MULTIPLIERS[tier];
  const effectiveMultiplier = multiplyScale4(tierMultiplier, ruleMultiplier);
  const basePoints = multiplyScale4(ticketNetTotal, pointsRate);
  return multiplyScale4(basePoints, effectiveMultiplier);
}

/**
 * Applies points accrual to an active loyalty account.
 */
export function applyPointsAccrual(
  account: LoyaltyAccount,
  pointsToAdd: string,
  ticketFolio: string,
  referenceAccountId: string,
  notes?: string,
): { updatedAccount: LoyaltyAccount; transaction: LoyaltyTransaction } {
  if (!account.isActive) {
    throw new LoyaltyAccountInactiveError(account.cardNumber);
  }
  if (!isPositiveScale4(pointsToAdd)) {
    throw new Error('Points to add must be positive');
  }

  const newBalance = addScale4(account.pointsBalance, pointsToAdd);
  const newTier = resolveTierForPoints(newBalance);
  const now = new Date().toISOString();

  const updatedAccount: LoyaltyAccount = {
    ...account,
    pointsBalance: newBalance,
    tier: newTier,
    updatedAt: now,
  };

  const transaction: LoyaltyTransaction = {
    id: crypto.randomUUID(),
    organizationId: account.organizationId,
    loyaltyAccountId: account.id,
    transactionType: 'EARN',
    pointsDelta: pointsToAdd,
    walletDelta: '0.0000',
    referenceAccountId,
    referenceTicketFolio: ticketFolio,
    notes: notes || `Acumulación de puntos por folio ${ticketFolio}`,
    reversalOfTransactionId: null,
    createdAt: now,
  };

  return { updatedAccount, transaction };
}

/**
 * Validates and deducts points from account for redemption at POS.
 */
export function validateAndApplyRedemption(
  account: LoyaltyAccount,
  pointsToRedeem: string,
  referenceAccountId: string,
  conversionRate = DEFAULT_REDEMPTION_VALUE_PER_POINT,
  notes?: string,
): {
  updatedAccount: LoyaltyAccount;
  transaction: LoyaltyTransaction;
  discountMonetaryValue: string;
} {
  if (!account.isActive) {
    throw new LoyaltyAccountInactiveError(account.cardNumber);
  }
  if (!isPositiveScale4(pointsToRedeem)) {
    throw new Error('Points to redeem must be greater than zero');
  }
  if (compareScale4(account.pointsBalance, pointsToRedeem) < 0) {
    throw new InsufficientLoyaltyPointsError(pointsToRedeem, account.pointsBalance);
  }

  const discountMonetaryValue = multiplyScale4(pointsToRedeem, conversionRate);
  const newPointsBalance = subScale4(account.pointsBalance, pointsToRedeem);
  const now = new Date().toISOString();

  const updatedAccount: LoyaltyAccount = {
    ...account,
    pointsBalance: newPointsBalance,
    tier: resolveTierForPoints(newPointsBalance),
    updatedAt: now,
  };

  const transaction: LoyaltyTransaction = {
    id: crypto.randomUUID(),
    organizationId: account.organizationId,
    loyaltyAccountId: account.id,
    transactionType: 'REDEEM',
    pointsDelta: `-${pointsToRedeem}`,
    walletDelta: '0.0000',
    referenceAccountId,
    referenceTicketFolio: null,
    notes: notes || `Redención de ${pointsToRedeem} puntos ($${discountMonetaryValue})`,
    reversalOfTransactionId: null,
    createdAt: now,
  };

  return { updatedAccount, transaction, discountMonetaryValue };
}

/**
 * Top-up prepaid balance on a RestCard wallet.
 */
export function applyRestCardTopUp(
  account: LoyaltyAccount,
  amount: string,
  referenceId: string,
  notes?: string,
): { updatedAccount: LoyaltyAccount; transaction: LoyaltyTransaction } {
  if (!account.isActive) {
    throw new LoyaltyAccountInactiveError(account.cardNumber);
  }
  if (!isPositiveScale4(amount)) {
    throw new Error('Top up amount must be positive');
  }

  const newWalletBalance = addScale4(account.walletBalance, amount);
  const now = new Date().toISOString();

  const updatedAccount: LoyaltyAccount = {
    ...account,
    walletBalance: newWalletBalance,
    updatedAt: now,
  };

  const transaction: LoyaltyTransaction = {
    id: crypto.randomUUID(),
    organizationId: account.organizationId,
    loyaltyAccountId: account.id,
    transactionType: 'TOP_UP',
    pointsDelta: '0.0000',
    walletDelta: amount,
    referenceAccountId: referenceId,
    referenceTicketFolio: null,
    notes: notes || `Recarga de monedero RestCard: $${amount}`,
    reversalOfTransactionId: null,
    createdAt: now,
  };

  return { updatedAccount, transaction };
}

/**
 * Charges prepaid RestCard wallet balance for a meal/sale payment.
 */
export function applyRestCardPayment(
  account: LoyaltyAccount,
  amountToCharge: string,
  referenceAccountId: string,
  notes?: string,
): { updatedAccount: LoyaltyAccount; transaction: LoyaltyTransaction } {
  if (!account.isActive) {
    throw new LoyaltyAccountInactiveError(account.cardNumber);
  }
  if (!isPositiveScale4(amountToCharge)) {
    throw new Error('Payment amount must be positive');
  }
  if (compareScale4(account.walletBalance, amountToCharge) < 0) {
    throw new InsufficientRestCardBalanceError(amountToCharge, account.walletBalance);
  }

  const newWalletBalance = subScale4(account.walletBalance, amountToCharge);
  const now = new Date().toISOString();

  const updatedAccount: LoyaltyAccount = {
    ...account,
    walletBalance: newWalletBalance,
    updatedAt: now,
  };

  const transaction: LoyaltyTransaction = {
    id: crypto.randomUUID(),
    organizationId: account.organizationId,
    loyaltyAccountId: account.id,
    transactionType: 'REDEEM',
    pointsDelta: '0.0000',
    walletDelta: `-${amountToCharge}`,
    referenceAccountId,
    referenceTicketFolio: null,
    notes: notes || `Pago con monedero RestCard: $${amountToCharge}`,
    reversalOfTransactionId: null,
    createdAt: now,
  };

  return { updatedAccount, transaction };
}

/**
 * Creates a compensating reversal for a previous loyalty transaction.
 */
export function createCompensatingReversal(
  account: LoyaltyAccount,
  originalTx: LoyaltyTransaction,
  reason: string,
): { updatedAccount: LoyaltyAccount; transaction: LoyaltyTransaction } {
  if (!account.isActive) {
    throw new LoyaltyAccountInactiveError(account.cardNumber);
  }

  // Invert deltas: if original was +points, reversal is -points; if original was -points, reversal is +points
  const pointsDeltaBig = toScale4BigInt(originalTx.pointsDelta);
  const reversedPointsDelta =
    pointsDeltaBig === 0n ? '0.0000' : subScale4('0.0000', originalTx.pointsDelta);

  const walletDeltaBig = toScale4BigInt(originalTx.walletDelta);
  const reversedWalletDelta =
    walletDeltaBig === 0n ? '0.0000' : subScale4('0.0000', originalTx.walletDelta);

  const newPointsBalance = addScale4(account.pointsBalance, reversedPointsDelta);
  const newWalletBalance = addScale4(account.walletBalance, reversedWalletDelta);

  if (compareScale4(newPointsBalance, '0.0000') < 0) {
    throw new Error('Reversal would result in negative points balance');
  }
  if (compareScale4(newWalletBalance, '0.0000') < 0) {
    throw new Error('Reversal would result in negative wallet balance');
  }

  const now = new Date().toISOString();

  const updatedAccount: LoyaltyAccount = {
    ...account,
    pointsBalance: newPointsBalance,
    walletBalance: newWalletBalance,
    tier: resolveTierForPoints(newPointsBalance),
    updatedAt: now,
  };

  const transaction: LoyaltyTransaction = {
    id: crypto.randomUUID(),
    organizationId: account.organizationId,
    loyaltyAccountId: account.id,
    transactionType: 'REVERSAL',
    pointsDelta: reversedPointsDelta,
    walletDelta: reversedWalletDelta,
    referenceAccountId: originalTx.referenceAccountId,
    referenceTicketFolio: originalTx.referenceTicketFolio,
    notes: `Reversión de transacción ${originalTx.id}: ${reason}`,
    reversalOfTransactionId: originalTx.id,
    createdAt: now,
  };

  return { updatedAccount, transaction };
}

/**
 * Evaluates points expiration for transactions older than expiryDays.
 */
export function calculatePointsExpiration(
  transactions: LoyaltyTransaction[],
  expiryDays: number,
  asOfDate: Date = new Date(),
): { expiredPointsTotal: string; expiredTransactionIds: string[] } {
  const cutoffTime = asOfDate.getTime() - expiryDays * 24 * 60 * 60 * 1000;
  let expiredBig = 0n;
  const expiredIds: string[] = [];

  for (const tx of transactions) {
    if (tx.transactionType === 'EARN' && isPositiveScale4(tx.pointsDelta)) {
      const txTime = new Date(tx.createdAt).getTime();
      if (txTime <= cutoffTime) {
        expiredBig += toScale4BigInt(tx.pointsDelta);
        expiredIds.push(tx.id);
      }
    }
  }

  // In Scale 4 format
  const whole = expiredBig / 10000n;
  const frac = expiredBig % 10000n;
  const expiredPointsTotal = `${whole}.${frac.toString().padStart(4, '0')}`;

  return { expiredPointsTotal, expiredTransactionIds: expiredIds };
}

/**
 * Evaluates whether a promotion applies to a ticket or customer context.
 */
export function evaluatePromotion(
  promotion: Promotion,
  customerBirthday: string | null,
  checkDate: Date,
  ticketTotal: string,
): { applicable: boolean; discountAmount: string; reason?: string } {
  if (!promotion.isActive) {
    return { applicable: false, discountAmount: '0.0000', reason: 'Promoción inactiva' };
  }

  const checkIso = checkDate.toISOString().slice(0, 10);
  if (checkIso < promotion.startDate.slice(0, 10) || checkIso > promotion.endDate.slice(0, 10)) {
    return { applicable: false, discountAmount: '0.0000', reason: 'Fuera de vigencia' };
  }

  if (promotion.promoType === 'BIRTHDAY') {
    if (!customerBirthday) {
      return {
        applicable: false,
        discountAmount: '0.0000',
        reason: 'Cliente sin fecha de cumpleaños registrada',
      };
    }
    const bMonth = customerBirthday.slice(5, 7);
    const cMonth = (checkDate.getMonth() + 1).toString().padStart(2, '0');

    // Birthday month matching
    if (bMonth !== cMonth) {
      return {
        applicable: false,
        discountAmount: '0.0000',
        reason: 'No coincide el mes de cumpleaños',
      };
    }
  }

  if (promotion.promoType === 'PERCENTAGE') {
    // discountValue is percentage e.g. 15.0000 = 15%
    const rate = divideScale4(promotion.discountValue, '100.0000');
    const discount = multiplyScale4(ticketTotal, rate);
    return { applicable: true, discountAmount: discount };
  }

  if (promotion.promoType === 'FIXED_AMOUNT') {
    const discount =
      compareScale4(ticketTotal, promotion.discountValue) > 0
        ? promotion.discountValue
        : ticketTotal;
    return { applicable: true, discountAmount: discount };
  }

  if (promotion.promoType === 'BIRTHDAY') {
    // If it's birthday, apply the discount value (either fixed or percentage based on value magnitude)
    if (compareScale4(promotion.discountValue, '100.0000') <= 0) {
      const rate = divideScale4(promotion.discountValue, '100.0000');
      const discount = multiplyScale4(ticketTotal, rate);
      return { applicable: true, discountAmount: discount };
    }
    return { applicable: true, discountAmount: promotion.discountValue };
  }

  return { applicable: true, discountAmount: '0.0000' };
}
