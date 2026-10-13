import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addScale4,
  subScale4,
  multiplyScale4,
  divideScale4,
  compareScale4,
  resolveTierForPoints,
  calculatePointsEarned,
  applyPointsAccrual,
  validateAndApplyRedemption,
  applyRestCardTopUp,
  applyRestCardPayment,
  createCompensatingReversal,
  calculatePointsExpiration,
  evaluatePromotion,
  normalizePhoneNumber,
  validateRfc,
  sanitizeCustomerInput,
  validateCustomerCredit,
  anonymizeCustomerForPurge,
  InsufficientLoyaltyPointsError,
  InsufficientRestCardBalanceError,
  LoyaltyAccountInactiveError,
  InvalidCustomerPhoneError,
  InvalidCustomerRfcError,
  CreditLimitExceededError,
  type LoyaltyAccount,
  type Customer,
  type CustomerDeliveryAddress,
  type Promotion,
} from './index.js';

describe('TRIDENTPOS WP-022: CRM & Loyalty Rewards Engine Suite', () => {
  describe('Numerics & Scale-4 Precision', () => {
    it('performs exact Scale-4 addition, subtraction, multiplication, and division', () => {
      assert.equal(addScale4('100.5000', '25.2500'), '125.7500');
      assert.equal(subScale4('100.0000', '35.5000'), '64.5000');
      assert.equal(multiplyScale4('50.0000', '1.5000'), '75.0000');
      assert.equal(divideScale4('100.0000', '4.0000'), '25.0000');
      assert.equal(compareScale4('50.0000', '20.0000'), 1);
      assert.equal(compareScale4('20.0000', '50.0000'), -1);
      assert.equal(compareScale4('20.0000', '20.0000'), 0);
    });
  });

  describe('Loyalty Tier Resolution & Accrual', () => {
    it('resolves tiers monotonically according to points thresholds', () => {
      assert.equal(resolveTierForPoints('0.0000'), 'BRONZE');
      assert.equal(resolveTierForPoints('499.9999'), 'BRONZE');
      assert.equal(resolveTierForPoints('500.0000'), 'SILVER');
      assert.equal(resolveTierForPoints('1999.0000'), 'SILVER');
      assert.equal(resolveTierForPoints('2000.0000'), 'GOLD');
      assert.equal(resolveTierForPoints('4999.0000'), 'GOLD');
      assert.equal(resolveTierForPoints('5000.0000'), 'PLATINUM');
      assert.equal(resolveTierForPoints('10000.0000'), 'PLATINUM');
    });

    it('calculates points earned applying tier multiplier and rule bonus', () => {
      // $100.0000 net spend @ 0.1000 base rate = 10 base points
      // Bronze (1.0x) => 10 points
      assert.equal(calculatePointsEarned('100.0000', 'BRONZE'), '10.0000');
      // Silver (1.25x) => 12.5 points
      assert.equal(calculatePointsEarned('100.0000', 'SILVER'), '12.5000');
      // Gold (1.5x) => 15 points
      assert.equal(calculatePointsEarned('100.0000', 'GOLD'), '15.0000');
      // Platinum (2.0x) => 20 points
      assert.equal(calculatePointsEarned('100.0000', 'PLATINUM'), '20.0000');
      // With rule multiplier 2x bonus (Double Points Tuesday)
      assert.equal(calculatePointsEarned('100.0000', 'GOLD', '2.0000'), '30.0000');
    });

    it('applies points accrual and upgrades tier automatically', () => {
      const account: LoyaltyAccount = {
        id: 'acc-1',
        organizationId: 'org-1',
        customerId: 'cust-1',
        cardNumber: 'RC-1001',
        pointsBalance: '480.0000',
        walletBalance: '0.0000',
        tier: 'BRONZE',
        isActive: true,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const { updatedAccount, transaction } = applyPointsAccrual(
        account,
        '30.0000',
        'FOLIO-5001',
        'acc-pos-1',
      );

      assert.equal(updatedAccount.pointsBalance, '510.0000');
      assert.equal(updatedAccount.tier, 'SILVER'); // Upgraded from BRONZE
      assert.equal(transaction.transactionType, 'EARN');
      assert.equal(transaction.pointsDelta, '30.0000');
      assert.equal(transaction.referenceTicketFolio, 'FOLIO-5001');
    });
  });

  describe('Points Redemption & Double Spend Prevention', () => {
    const baseAccount: LoyaltyAccount = {
      id: 'acc-2',
      organizationId: 'org-1',
      customerId: 'cust-2',
      cardNumber: 'RC-1002',
      pointsBalance: '150.0000',
      walletBalance: '200.0000',
      tier: 'BRONZE',
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };

    it('redeems points within available balance and calculates monetary discount', () => {
      // 100 points @ $0.1000/pt = $10.0000 discount
      const { updatedAccount, transaction, discountMonetaryValue } = validateAndApplyRedemption(
        baseAccount,
        '100.0000',
        'pos-sale-99',
      );

      assert.equal(updatedAccount.pointsBalance, '50.0000');
      assert.equal(discountMonetaryValue, '10.0000');
      assert.equal(transaction.transactionType, 'REDEEM');
      assert.equal(transaction.pointsDelta, '-100.0000');
    });

    it('rejects points redemption exceeding available balance fail-closed', () => {
      assert.throws(
        () => validateAndApplyRedemption(baseAccount, '200.0000', 'pos-sale-99'),
        InsufficientLoyaltyPointsError,
      );
    });

    it('rejects points redemption when loyalty account is suspended/inactive', () => {
      const inactive = { ...baseAccount, isActive: false };
      assert.throws(
        () => validateAndApplyRedemption(inactive, '50.0000', 'pos-sale-99'),
        LoyaltyAccountInactiveError,
      );
    });
  });

  describe('RestCard Prepaid Cash Wallet', () => {
    const baseAccount: LoyaltyAccount = {
      id: 'acc-3',
      organizationId: 'org-1',
      customerId: 'cust-3',
      cardNumber: 'RC-1003',
      pointsBalance: '0.0000',
      walletBalance: '300.0000',
      tier: 'BRONZE',
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };

    it('tops up RestCard prepaid balance and generates audit transaction', () => {
      const { updatedAccount, transaction } = applyRestCardTopUp(
        baseAccount,
        '500.0000',
        'caja-topup-01',
      );
      assert.equal(updatedAccount.walletBalance, '800.0000');
      assert.equal(transaction.transactionType, 'TOP_UP');
      assert.equal(transaction.walletDelta, '500.0000');
    });

    it('charges payment against RestCard wallet successfully', () => {
      const { updatedAccount, transaction } = applyRestCardPayment(
        baseAccount,
        '120.5000',
        'pos-order-88',
      );
      assert.equal(updatedAccount.walletBalance, '179.5000');
      assert.equal(transaction.transactionType, 'REDEEM');
      assert.equal(transaction.walletDelta, '-120.5000');
    });

    it('rejects RestCard payment exceeding prepaid balance fail-closed', () => {
      assert.throws(
        () => applyRestCardPayment(baseAccount, '350.0000', 'pos-order-88'),
        InsufficientRestCardBalanceError,
      );
    });
  });

  describe('Compensating Reversals', () => {
    it('creates accurate compensating reversal restoring balances and downgrading tier if applicable', () => {
      const account: LoyaltyAccount = {
        id: 'acc-4',
        organizationId: 'org-1',
        customerId: 'cust-4',
        cardNumber: 'RC-1004',
        pointsBalance: '550.0000',
        walletBalance: '100.0000',
        tier: 'SILVER',
        isActive: true,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const originalEarnTx = {
        id: 'tx-orig-1',
        organizationId: 'org-1',
        loyaltyAccountId: 'acc-4',
        transactionType: 'EARN' as const,
        pointsDelta: '100.0000',
        walletDelta: '0.0000',
        referenceAccountId: 'sale-1',
        referenceTicketFolio: 'F-1',
        createdAt: '2026-10-01T00:00:00Z',
      };

      const { updatedAccount, transaction } = createCompensatingReversal(
        account,
        originalEarnTx,
        'Devolución de platillo por comensal',
      );

      assert.equal(updatedAccount.pointsBalance, '450.0000');
      assert.equal(updatedAccount.tier, 'BRONZE'); // Downgraded back to BRONZE
      assert.equal(transaction.transactionType, 'REVERSAL');
      assert.equal(transaction.pointsDelta, '-100.0000');
      assert.equal(transaction.reversalOfTransactionId, 'tx-orig-1');
    });
  });

  describe('Points Expiry & Retention Calculation', () => {
    it('identifies expired EARN transactions older than configured validity window', () => {
      const asOfDate = new Date('2026-10-15T00:00:00Z');
      const transactions = [
        {
          id: 'tx-old-1',
          organizationId: 'org-1',
          loyaltyAccountId: 'acc-5',
          transactionType: 'EARN' as const,
          pointsDelta: '50.0000',
          walletDelta: '0.0000',
          referenceAccountId: 'ref-1',
          referenceTicketFolio: 'F-1',
          createdAt: '2025-01-01T00:00:00Z', // Very old (> 1 year)
        },
        {
          id: 'tx-new-2',
          organizationId: 'org-1',
          loyaltyAccountId: 'acc-5',
          transactionType: 'EARN' as const,
          pointsDelta: '30.0000',
          walletDelta: '0.0000',
          referenceAccountId: 'ref-2',
          referenceTicketFolio: 'F-2',
          createdAt: '2026-10-10T00:00:00Z', // 5 days old
        },
      ];

      const { expiredPointsTotal, expiredTransactionIds } = calculatePointsExpiration(
        transactions,
        365,
        asOfDate,
      );

      assert.equal(expiredPointsTotal, '50.0000');
      assert.deepEqual(expiredTransactionIds, ['tx-old-1']);
    });
  });

  describe('Promotions Engine', () => {
    it('evaluates percentage discount promotion during validity window', () => {
      const promo: Promotion = {
        id: 'promo-1',
        organizationId: 'org-1',
        code: 'PROMO15',
        name: '15% Descuento Alimentos',
        promoType: 'PERCENTAGE',
        discountValue: '15.0000',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        isActive: true,
        createdAt: '2026-10-01T00:00:00Z',
      };

      const result = evaluatePromotion(promo, null, new Date('2026-10-13T12:00:00Z'), '400.0000');
      assert.equal(result.applicable, true);
      assert.equal(result.discountAmount, '60.0000'); // 15% of 400
    });

    it('evaluates birthday promotion matching customer birth month', () => {
      const birthdayPromo: Promotion = {
        id: 'promo-2',
        organizationId: 'org-1',
        code: 'CUMPLE',
        name: 'Cortesía de Cumpleaños',
        promoType: 'BIRTHDAY',
        discountValue: '20.0000', // 20%
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
      };

      // Match: customer born in October
      const matchResult = evaluatePromotion(
        birthdayPromo,
        '1990-10-25',
        new Date('2026-10-13T12:00:00Z'),
        '500.0000',
      );
      assert.equal(matchResult.applicable, true);
      assert.equal(matchResult.discountAmount, '100.0000');

      // No match: customer born in March
      const noMatchResult = evaluatePromotion(
        birthdayPromo,
        '1990-03-25',
        new Date('2026-10-13T12:00:00Z'),
        '500.0000',
      );
      assert.equal(noMatchResult.applicable, false);
    });
  });

  describe('Customer Phone Normalization & Caller-ID Optimization', () => {
    it('normalizes various phone input formats to clean 10-digit format', () => {
      assert.equal(normalizePhoneNumber('55 1234 5678'), '5512345678');
      assert.equal(normalizePhoneNumber('(55) 1234-5678'), '5512345678');
      assert.equal(normalizePhoneNumber('+52 55 1234 5678'), '5512345678');
      assert.equal(normalizePhoneNumber('+5215512345678'), '5512345678');
    });

    it('rejects invalid phone numbers fail-closed', () => {
      assert.throws(() => normalizePhoneNumber('12345'), InvalidCustomerPhoneError);
      assert.throws(() => normalizePhoneNumber('551234567890999'), InvalidCustomerPhoneError);
    });
  });

  describe('Mexican RFC Validation & Customer Sanitization', () => {
    it('validates personas físicas, morales and generic RFCs', () => {
      assert.equal(validateRfc('XAXX010101000'), true); // Público general
      assert.equal(validateRfc('XEXX010101000'), true); // Extranjeros
      assert.equal(validateRfc('MECJ8801011A2'), true); // Física (13)
      assert.equal(validateRfc('ABC850101123'), true); // Moral (12)
      assert.equal(validateRfc('RFC_INVALIDO_XYZ'), false);
    });

    it('sanitizes customer registration input and rejects malformed RFC', () => {
      const valid = sanitizeCustomerInput({
        fullName: '  Juan Perez  ',
        phone: '55-1234-5678',
        taxId: 'MECJ8801011A2',
        email: 'juan@test.com',
      });
      assert.equal(valid.fullName, 'Juan Perez');
      assert.equal(valid.phone, '5512345678');
      assert.equal(valid.taxId, 'MECJ8801011A2');

      assert.throws(
        () => sanitizeCustomerInput({ fullName: 'Pedro', taxId: 'INVALID_RFC' }),
        InvalidCustomerRfcError,
      );
    });
  });

  describe('Customer Credit Limit & Overdraft Controls', () => {
    const customerWithCredit: Customer = {
      id: 'cust-cred-1',
      organizationId: 'org-1',
      code: 'CLI-001',
      fullName: 'Empresa Corporativa SA',
      taxId: 'ABC850101123',
      email: 'corp@empresa.com',
      phone: '5512345678',
      creditLimit: '10000.0000',
      currentBalance: '8000.0000',
      allowOverdraft: false,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };

    it('permits credit charge within authorized limit', () => {
      const { newBalance } = validateCustomerCredit(customerWithCredit, '1500.0000');
      assert.equal(newBalance, '9500.0000');
    });

    it('rejects credit charge exceeding credit limit when overdraft is disallowed', () => {
      assert.throws(
        () => validateCustomerCredit(customerWithCredit, '2500.0000'),
        CreditLimitExceededError,
      );
    });

    it('permits credit charge exceeding limit when allowOverdraft is enabled', () => {
      const overdraftAllowed = { ...customerWithCredit, allowOverdraft: true };
      const { newBalance } = validateCustomerCredit(overdraftAllowed, '3000.0000');
      assert.equal(newBalance, '11000.0000');
    });
  });

  describe('SEC-VAL-11: Technical Data Retention Purge Routine', () => {
    it('anonymizes customer PII and scrubs delivery addresses while preserving ledger IDs', () => {
      const customer: Customer = {
        id: 'cust-purge-1',
        organizationId: 'org-1',
        code: 'CLI-999',
        fullName: 'Carlos Santana Privado',
        taxId: 'SANC800101ABC',
        email: 'carlos@privado.com',
        phone: '5598765432',
        creditLimit: '0.0000',
        currentBalance: '0.0000',
        allowOverdraft: false,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const addresses: CustomerDeliveryAddress[] = [
        {
          id: 'addr-1',
          organizationId: 'org-1',
          customerId: 'cust-purge-1',
          streetAndNumber: 'Av. Reforma 123 Depto 4',
          neighborhood: 'Juárez',
          postalCode: '06600',
          city: 'CDMX',
          state: 'CDMX',
          referenceNotes: 'Portón negro',
          isDefault: true,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      const { anonymizedCustomer, anonymizedAddresses } = anonymizeCustomerForPurge(
        customer,
        addresses,
      );

      assert.ok(anonymizedCustomer.fullName.startsWith('CLIENTE_ANONIMIZADO_'));
      assert.equal(anonymizedCustomer.taxId, null);
      assert.equal(anonymizedCustomer.email, null);
      assert.equal(anonymizedCustomer.phone, null);
      assert.equal(anonymizedCustomer.isActive, false);
      assert.equal(anonymizedCustomer.metadata?.['purged'], true);

      assert.equal(anonymizedAddresses[0]?.streetAndNumber, '[DIRECCION_PURGADA]');
      assert.equal(anonymizedAddresses[0]?.referenceNotes, null);
      assert.equal(anonymizedAddresses[0]?.postalCode, '00000');
    });
  });
});
