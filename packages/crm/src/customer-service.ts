/**
 * TRIDENTPOS WP-022 CRM Customer Profiles & Loyalty Rewards Engine
 * Customer Management, Caller-ID Phone Normalization, RFC Validation & Data Retention Purge
 */

import crypto from 'node:crypto';
import type { Customer, CustomerDeliveryAddress } from './types.js';
import {
  InvalidCustomerPhoneError,
  InvalidCustomerRfcError,
  CreditLimitExceededError,
} from './errors.js';
import { addScale4, compareScale4, isPositiveScale4 } from './numerics.js';

// Mexican RFC regex: 3-4 letters, 6 digits (YYMMDD), 3 alphanumeric characters
const RFC_REGEX = /^([A-ZÑ&]{3,4})([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([A-Z0-9]{3})$/i;

/**
 * Normalizes a phone number to exactly 10 digits for fast Caller-ID indexing and lookup at POS.
 * Strips whitespace, dashes, parentheses, and leading country code '+52'.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new InvalidCustomerPhoneError(String(rawPhone));
  }

  // Remove non-digit characters
  let digits = rawPhone.replace(/\D/g, '');

  // Strip leading Mexico country code +52 (or +521 for mobile)
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('52')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    throw new InvalidCustomerPhoneError(rawPhone);
  }

  return digits;
}

/**
 * Validates Mexican Tax ID (RFC).
 */
export function validateRfc(taxId: string): boolean {
  if (!taxId || typeof taxId !== 'string') return false;
  const upper = taxId.trim().toUpperCase();
  // Standard generic RFCs for público en general / extranjeros
  if (upper === 'XAXX010101000' || upper === 'XEXX010101000') {
    return true;
  }
  return RFC_REGEX.test(upper);
}

/**
 * Validates and normalizes customer input data prior to registration.
 */
export function sanitizeCustomerInput(input: {
  fullName: string;
  phone?: string | null;
  taxId?: string | null;
  email?: string | null;
}): {
  fullName: string;
  phone: string | null;
  taxId: string | null;
  email: string | null;
} {
  const fullName = input.fullName.trim();
  if (!fullName) {
    throw new Error('El nombre completo del cliente es obligatorio');
  }

  let phone: string | null = null;
  if (input.phone && input.phone.trim()) {
    phone = normalizePhoneNumber(input.phone);
  }

  let taxId: string | null = null;
  if (input.taxId && input.taxId.trim()) {
    const trimmedRfc = input.taxId.trim().toUpperCase();
    if (!validateRfc(trimmedRfc)) {
      throw new InvalidCustomerRfcError(trimmedRfc);
    }
    taxId = trimmedRfc;
  }

  let email: string | null = null;
  if (input.email && input.email.trim()) {
    const trimmedEmail = input.email.trim().toLowerCase();
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      throw new Error(`Email inválido: ${input.email}`);
    }
    email = trimmedEmail;
  }

  return { fullName, phone, taxId, email };
}

/**
 * Validates customer credit check for account charge.
 */
export function validateCustomerCredit(
  customer: Customer,
  chargeAmount: string,
): { newBalance: string } {
  if (!customer.isActive) {
    throw new Error(`El cliente ${customer.fullName} se encuentra inactivo`);
  }
  if (!isPositiveScale4(chargeAmount)) {
    throw new Error('El monto a cargar a crédito debe ser mayor a cero');
  }

  const projectedBalance = addScale4(customer.currentBalance, chargeAmount);

  // If overdraft is not allowed and projected balance exceeds credit limit, throw error
  if (!customer.allowOverdraft && compareScale4(projectedBalance, customer.creditLimit) > 0) {
    throw new CreditLimitExceededError(chargeAmount, customer.creditLimit, customer.currentBalance);
  }

  return { newBalance: projectedBalance };
}

/**
 * Implements SEC-VAL-11: Technical data retention and PII anonymization purge routine.
 * Anonymizes customer data to comply with privacy regulations (GDPR / LFPDPPP) while
 * preserving transactional foreign key consistency in sales and accounting records.
 */
export function anonymizeCustomerForPurge(
  customer: Customer,
  addresses: CustomerDeliveryAddress[] = [],
): {
  anonymizedCustomer: Customer;
  anonymizedAddresses: CustomerDeliveryAddress[];
} {
  const hash = crypto.createHash('sha256').update(customer.id).digest('hex').slice(0, 8);
  const now = new Date().toISOString();

  const anonymizedCustomer: Customer = {
    ...customer,
    fullName: `CLIENTE_ANONIMIZADO_${hash.toUpperCase()}`,
    taxId: null,
    email: null,
    phone: null,
    isActive: false,
    metadata: {
      purged: true,
      purgedAt: now,
      retentionReason: 'SEC-VAL-11-TECHNICAL-PURGE',
    },
    updatedAt: now,
  };

  const anonymizedAddresses: CustomerDeliveryAddress[] = addresses.map((addr) => ({
    ...addr,
    streetAndNumber: '[DIRECCION_PURGADA]',
    neighborhood: '[PURGADO]',
    postalCode: '00000',
    referenceNotes: null,
  }));

  return { anonymizedCustomer, anonymizedAddresses };
}
