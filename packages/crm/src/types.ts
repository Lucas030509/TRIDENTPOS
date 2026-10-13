/**
 * TRIDENTPOS WP-022 CRM Customer Profiles & Loyalty Rewards Engine
 * Domain Types & Value Objects (Bounded Context: CRM / Loyalty)
 */

export type LoyaltyTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export type LoyaltyTransactionType = 'EARN' | 'REDEEM' | 'TOP_UP' | 'EXPIRE' | 'REVERSAL';

export type PromotionType =
  'PERCENTAGE' | 'FIXED_AMOUNT' | '2X1' | 'BIRTHDAY' | 'POINTS_MULTIPLIER';

export interface Customer {
  id: string;
  organizationId: string;
  code: string;
  fullName: string;
  taxId: string | null; // RFC
  email: string | null;
  phone: string | null; // Normalized 10 digits
  creditLimit: string; // Scale 4
  currentBalance: string; // Scale 4
  allowOverdraft: boolean;
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDeliveryAddress {
  id: string;
  organizationId: string;
  customerId: string;
  streetAndNumber: string;
  neighborhood: string;
  postalCode: string;
  city: string;
  state: string;
  referenceNotes: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface LoyaltyAccount {
  id: string;
  organizationId: string;
  customerId: string;
  cardNumber: string; // Unique card number e.g. "RC-100234"
  pointsBalance: string; // Scale 4
  walletBalance: string; // Scale 4 (RestCard prepaid cash balance)
  tier: LoyaltyTier;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  organizationId: string;
  loyaltyAccountId: string;
  transactionType: LoyaltyTransactionType;
  pointsDelta: string; // Scale 4 (positive or negative)
  walletDelta: string; // Scale 4 (positive or negative)
  referenceAccountId: string; // POS sale or operation ID
  referenceTicketFolio: string | null;
  notes?: string | null;
  reversalOfTransactionId?: string | null;
  createdAt: string;
}

export interface Promotion {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  promoType: PromotionType;
  discountValue: string; // Scale 4 (e.g. 15.0000 for 15% or 50.0000 for $50 off)
  startDate: string; // ISO date
  endDate: string; // ISO date
  isActive: boolean;
  createdAt: string;
}

export interface AccruePointsInput {
  organizationId: string;
  loyaltyAccountId: string;
  ticketFolio: string;
  referenceAccountId: string;
  ticketNetTotal: string; // Scale 4
  asOfDate?: Date;
}

export interface AccruePointsResult {
  loyaltyAccountId: string;
  pointsAccrued: string; // Scale 4
  previousPointsBalance: string;
  newPointsBalance: string;
  tier: LoyaltyTier;
  transactionId: string;
}

export interface RedeemPointsInput {
  organizationId: string;
  loyaltyAccountId: string;
  referenceAccountId: string;
  pointsToRedeem: string; // Scale 4
  pointsConversionRate?: string; // Conversion rate e.g. 1 point = $0.1000 cash discount
}

export interface RedeemPointsResult {
  loyaltyAccountId: string;
  pointsRedeemed: string;
  discountMonetaryValue: string;
  previousPointsBalance: string;
  newPointsBalance: string;
  transactionId: string;
}

export interface RestCardTopUpInput {
  organizationId: string;
  loyaltyAccountId: string;
  amount: string; // Scale 4
  referenceId: string;
}

export interface RestCardTopUpResult {
  loyaltyAccountId: string;
  amountAdded: string;
  previousWalletBalance: string;
  newWalletBalance: string;
  transactionId: string;
}

export interface RestCardPaymentInput {
  organizationId: string;
  loyaltyAccountId: string;
  amountToPay: string; // Scale 4
  referenceAccountId: string;
}

export interface RestCardPaymentResult {
  loyaltyAccountId: string;
  amountCharged: string;
  previousWalletBalance: string;
  newWalletBalance: string;
  transactionId: string;
}

export interface CustomerDataPurgeResult {
  customerId: string;
  anonymized: boolean;
  purgedAt: string;
}
