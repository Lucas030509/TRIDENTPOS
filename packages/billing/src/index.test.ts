import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  addBillingScale4,
  subBillingScale4,
  mulBillingScale4,
  divBillingScale4,
  cmpBillingScale4,
  assertValidBillingScale4,
  isValidRfc,
  assertValidRfc,
  isValidPostalCode,
  isValidRegimenFiscal,
  calculateItemTaxes,
  generateCfdi40Xml,
  buildCadenaOriginal40,
  signCadenaOriginal,
  verifyCadenaOriginalSignature,
  cleanCertificateToSingleLineBase64,
  MockPacConnector,
  UnavailablePacConnector,
  PacCircuitBreaker,
  UnavailableCsdVault,
  InMemoryCsdVault,
  CsdCredentialsMissingError,
  validateInvoiceForStamping,
  applyStampToInvoice,
  applyCancellationToInvoice,
  groupUnclaimedFoliosIntoBatchCandidate,
  InvalidRfcError,
  FiscalInvoiceInvalidStateError,
  FiscalInvoiceAlreadyStampedError,
  FiscalInvoiceAlreadyCancelledError,
  PacCircuitBreakerOpenError,
  PacTimeoutError,
  type FiscalInvoice,
  type FiscalInvoiceItem,
  type EmisorFiscalConfig,
  type TaxScheme,
  type UnclaimedFiscalTicket,
} from './index.js';

describe('TRIDENTPOS WP-021 Billing & Fiscal Invoicing Unit Suite', () => {
  let testKeyPair: crypto.KeyPairSyncResult<string, string>;

  before(() => {
    // Generate valid RSA 2048-bit key pair for CSD test signing
    testKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  describe('1. Exact Scale-4 Monetary Arithmetic', () => {
    it('WP021-NUM-01: scale-4 additions and subtractions', () => {
      assert.equal(addBillingScale4('100.5000', '25.2500'), '125.7500');
      assert.equal(subBillingScale4('100.5000', '25.2500'), '75.2500');
      assert.equal(cmpBillingScale4('100.5000', '100.5000'), 0);
      assert.equal(cmpBillingScale4('100.5000', '100.5001'), -1);
      assert.equal(cmpBillingScale4('100.5001', '100.5000'), 1);
    });

    it('WP021-NUM-02: scale-4 multiplication and division with Half Away From Zero rounding', () => {
      assert.equal(mulBillingScale4('100.0000', '0.1600'), '16.0000');
      assert.equal(divBillingScale4('116.0000', '1.1600'), '100.0000');
      assert.throws(() => divBillingScale4('100.0000', '0.0000'), RangeError);
    });

    it('WP021-NUM-03: scale-4 string validation', () => {
      assert.doesNotThrow(() => assertValidBillingScale4('123.4567'));
      assert.throws(() => assertValidBillingScale4('123.45'), TypeError);
      assert.throws(() => assertValidBillingScale4('abc'), TypeError);
    });
  });

  describe('2. RFC and Fiscal Field Validators', () => {
    it('WP021-RFC-01: Persona Moral RFC validation', () => {
      assert.ok(isValidRfc('TRI200101ABC'));
      assert.ok(isValidRfc('AAA010101AAA'));
      assert.doesNotThrow(() => assertValidRfc('TRI200101ABC'));
    });

    it('WP021-RFC-02: Persona Física RFC validation', () => {
      assert.ok(isValidRfc('SALS800101XYZ'));
      assert.ok(isValidRfc('GODE561231GR8'));
      assert.doesNotThrow(() => assertValidRfc('SALS800101XYZ'));
    });

    it('WP021-RFC-03: Generic SAT RFCs validation', () => {
      assert.ok(isValidRfc('XAXX010101000'));
      assert.ok(isValidRfc('XEXX010101000'));
    });

    it('WP021-RFC-04: Invalid RFC fails closed', () => {
      assert.equal(isValidRfc('INVALID_RFC'), false);
      assert.equal(isValidRfc('123456789012'), false);
      assert.throws(() => assertValidRfc('INVALID_RFC'), InvalidRfcError);
    });

    it('WP021-RFC-05: Postal code & regimen fiscal validation', () => {
      assert.ok(isValidPostalCode('06000'));
      assert.equal(isValidPostalCode('0600'), false);
      assert.equal(isValidPostalCode('060001'), false);
      assert.equal(isValidPostalCode('ABCDE'), false);

      assert.ok(isValidRegimenFiscal('601'));
      assert.ok(isValidRegimenFiscal('626'));
      assert.equal(isValidRegimenFiscal('60'), false);
      assert.equal(isValidRegimenFiscal('6011'), false);
    });
  });

  describe('3. Multi-Tier Tax Calculations', () => {
    const iva16Inclusive: TaxScheme = {
      id: 'tax-1',
      organizationId: 'org-1',
      code: 'IVA16_INC',
      name: 'IVA 16% Incluido',
      rate: '0.1600',
      isInclusive: true,
      taxType: 'IVA',
    };

    const iva16Exclusive: TaxScheme = {
      id: 'tax-2',
      organizationId: 'org-1',
      code: 'IVA16_EXC',
      name: 'IVA 16% Trasladado',
      rate: '0.1600',
      isInclusive: false,
      taxType: 'IVA',
    };

    const ieps8Exclusive: TaxScheme = {
      id: 'tax-3',
      organizationId: 'org-1',
      code: 'IEPS8',
      name: 'IEPS 8%',
      rate: '0.0800',
      isInclusive: false,
      taxType: 'IEPS',
    };

    it('WP021-TAX-01: single inclusive 16% tax computes exact subtotal and tax', () => {
      const calc = calculateItemTaxes('116.0000', '1.0000', [iva16Inclusive]);
      assert.equal(calc.totalAmount, '116.0000');
      assert.equal(calc.subtotal, '100.0000');
      assert.equal(calc.taxAmount, '16.0000');
    });

    it('WP021-TAX-02: single exclusive 16% tax computes exact subtotal and total', () => {
      const calc = calculateItemTaxes('100.0000', '1.0000', [iva16Exclusive]);
      assert.equal(calc.subtotal, '100.0000');
      assert.equal(calc.taxAmount, '16.0000');
      assert.equal(calc.totalAmount, '116.0000');
    });

    it('WP021-TAX-03: multi-tier exclusive taxes (IVA 16% + IEPS 8%)', () => {
      const calc = calculateItemTaxes('100.0000', '2.0000', [iva16Exclusive, ieps8Exclusive]);
      assert.equal(calc.subtotal, '200.0000');
      assert.equal(calc.taxAmount, '48.0000'); // 32.0000 IVA + 16.0000 IEPS
      assert.equal(calc.totalAmount, '248.0000');
      assert.equal(calc.taxBreakdown.length, 2);
    });

    it('WP021-TAX-04: zero tax scheme returns subtotal equals total', () => {
      const calc = calculateItemTaxes('50.0000', '2.0000', []);
      assert.equal(calc.subtotal, '100.0000');
      assert.equal(calc.taxAmount, '0.0000');
      assert.equal(calc.totalAmount, '100.0000');
    });
  });

  describe('4. CFDI 4.0 XML Generation & RSA-SHA256 CSD Signatures', () => {
    const sampleEmisor: EmisorFiscalConfig = {
      id: 'emisor-1',
      organizationId: 'org-1',
      rfc: 'TRI200101ABC',
      razonSocial: 'TRIDENT RESTAURANTES S.A. DE C.V.',
      regimenFiscal: '601',
      codigoPostal: '06000',
      certificateNumber: '30001000000500003415',
      certificatePem: '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----',
      privateKeyVaultId: 'vault-key-1',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: '2028-01-01T00:00:00Z',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    };

    const sampleInvoice: FiscalInvoice = {
      id: 'inv-1',
      organizationId: 'org-1',
      branchId: 'branch-1',
      invoiceUuid: null,
      series: 'F',
      folio: '1001',
      customerTaxId: 'XAXX010101000',
      customerName: 'PUBLICO EN GENERAL',
      customerRegimenFiscal: '616',
      customerPostalCode: '06000',
      cfdiUse: 'S01',
      paymentMethod: 'PUE',
      paymentWay: '01',
      subtotal: '100.0000',
      taxTotal: '16.0000',
      totalAmount: '116.0000',
      status: 'DRAFT',
      cancellationReason: null,
      cancellationReplacementUuid: null,
      stampedAt: null,
      cancelledAt: null,
      xmlPayload: null,
      stampedXml: null,
      selloEmisor: null,
      selloSat: null,
      cadenaOriginalHash: null,
      pacRequestReferenceId: 'ref-inv-1001',
      createdAt: '2026-09-21T10:00:00Z',
      updatedAt: '2026-09-21T10:00:00Z',
    };

    const sampleItems: FiscalInvoiceItem[] = [
      {
        id: 'item-1',
        invoiceId: 'inv-1',
        lineNumber: 1,
        productCode: 'PROD-01',
        description: 'Hamburguesa Clásica',
        satProductCode: '90101501',
        satUnitCode: 'E48',
        quantity: '1.0000',
        unitPrice: '100.0000',
        subtotal: '100.0000',
        taxAmount: '16.0000',
        totalAmount: '116.0000',
        taxRate: '0.1600',
      },
    ];

    it('WP021-CFDI-01: builds Cadena Original 4.0 pipe format correctly', () => {
      const cadena = buildCadenaOriginal40(
        sampleInvoice,
        sampleItems,
        sampleEmisor,
        '30001000000500003415',
        '2026-09-21T10:00:00',
      );
      assert.ok(
        cadena.startsWith(
          '||4.0|F|1001|2026-09-21T10:00:00|01|30001000000500003415|100.00|MXN|116.00|I|01|PUE|06000|TRI200101ABC|TRIDENT RESTAURANTES S.A. DE C.V.|601|XAXX010101000|PUBLICO EN GENERAL|06000|616|S01|90101501|PROD-01|1.00|E48|Hamburguesa Clásica|100.00|100.00|02|100.00|002|Tasa|0.160000|16.00|002|Tasa|0.160000|16.00|16.00||',
        ),
      );
    });

    it('WP021-CFDI-02: signs Cadena Original with RSA-SHA256 and verifies signature', () => {
      const cadena = buildCadenaOriginal40(
        sampleInvoice,
        sampleItems,
        sampleEmisor,
        '30001000000500003415',
        '2026-09-21T10:00:00',
      );
      const signature = signCadenaOriginal(cadena, testKeyPair.privateKey);
      assert.ok(typeof signature === 'string' && signature.length > 50);

      const isValid = verifyCadenaOriginalSignature(cadena, signature, testKeyPair.publicKey);
      assert.equal(isValid, true);

      const isInvalid = verifyCadenaOriginalSignature(
        cadena + 'TAMPERED',
        signature,
        testKeyPair.publicKey,
      );
      assert.equal(isInvalid, false);
    });

    it('WP021-CFDI-03: generates schema-valid CFDI 4.0 XML with Sello', () => {
      const cadena = buildCadenaOriginal40(
        sampleInvoice,
        sampleItems,
        sampleEmisor,
        '30001000000500003415',
        '2026-09-21T10:00:00',
      );
      const signature = signCadenaOriginal(cadena, testKeyPair.privateKey);
      const certBase64 = cleanCertificateToSingleLineBase64(testKeyPair.publicKey);

      const xml = generateCfdi40Xml({
        invoice: sampleInvoice,
        items: sampleItems,
        emisor: sampleEmisor,
        certificateNumber: '30001000000500003415',
        certificateBase64: certBase64,
        sello: signature,
        issuedAtIso: '2026-09-21T10:00:00Z',
      });

      assert.ok(xml.includes('<cfdi:Comprobante'));
      assert.ok(xml.includes('Version="4.0"'));
      assert.ok(xml.includes('Serie="F"'));
      assert.ok(xml.includes('Folio="1001"'));
      assert.ok(xml.includes('Rfc="TRI200101ABC"'));
      assert.ok(xml.includes('Rfc="XAXX010101000"'));
      assert.ok(xml.includes('ClaveProdServ="90101501"'));
      assert.ok(xml.includes('</cfdi:Comprobante>'));
    });
  });

  describe('5. PAC Connector & Circuit Breaker', () => {
    it('WP021-PAC-01: successful mock timbrado generates stamped XML and UUID', async () => {
      const pac = new MockPacConnector();
      const res = await pac.timbrar({
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        referenceId: 'ref-1',
        xmlPayload: '<cfdi:Comprobante></cfdi:Comprobante>',
      });

      assert.equal(res.status, 'STAMPED');
      assert.ok(res.uuid);
      assert.ok(res.selloSat);
      assert.ok(res.stampedXml?.includes('<tfd:TimbreFiscalDigital'));
    });

    it('WP021-PAC-02: idempotent retry with same reference returns identical UUID', async () => {
      const pac = new MockPacConnector();
      const res1 = await pac.timbrar({
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        referenceId: 'ref-1',
        xmlPayload: '<cfdi:Comprobante></cfdi:Comprobante>',
      });

      const res2 = await pac.timbrar({
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        referenceId: 'ref-1',
        xmlPayload: '<cfdi:Comprobante></cfdi:Comprobante>',
      });

      assert.equal(res1.uuid, res2.uuid);
      assert.equal(res1.selloSat, res2.selloSat);
    });

    it('WP021-PAC-03: invalid RFC rejection simulation returns REJECTED status', async () => {
      const pac = new MockPacConnector();
      pac.setBehavior({
        simulateReject: true,
        rejectErrorCode: '301',
        rejectErrorMessage: 'RFC del receptor no existe en la lista del SAT',
      });

      const res = await pac.timbrar({
        organizationId: 'org-1',
        invoiceId: 'inv-2',
        referenceId: 'ref-2',
        xmlPayload: '<cfdi:Comprobante></cfdi:Comprobante>',
      });

      assert.equal(res.status, 'REJECTED');
      assert.equal(res.errorCode, '301');
    });

    it('WP021-PAC-04: simulated PAC timeout throws PacTimeoutError', async () => {
      const pac = new MockPacConnector();
      pac.setBehavior({ simulateTimeout: true });

      await assert.rejects(
        () =>
          pac.timbrar({
            organizationId: 'org-1',
            invoiceId: 'inv-3',
            referenceId: 'ref-3',
            xmlPayload: '<cfdi:Comprobante></cfdi:Comprobante>',
          }),
        PacTimeoutError,
      );
    });

    it('WP021-PAC-05: circuit breaker trips to OPEN after threshold failures', async () => {
      const cb = new PacCircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
      assert.equal(cb.getState(), 'CLOSED');

      cb.recordFailure();
      assert.equal(cb.getState(), 'CLOSED');
      cb.recordFailure();
      assert.equal(cb.getState(), 'CLOSED');
      cb.recordFailure();
      assert.equal(cb.getState(), 'OPEN');

      assert.throws(() => cb.checkExecutionAllowed(), PacCircuitBreakerOpenError);

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(cb.getState(), 'HALF_OPEN');

      cb.recordSuccess();
      assert.equal(cb.getState(), 'CLOSED');
    });
  });

  describe('6. Invoicing Lifecycle Transitions & OQ-ARCH-02 Batch Grouping', () => {
    const sampleEmisor: EmisorFiscalConfig = {
      id: 'emisor-1',
      organizationId: 'org-1',
      rfc: 'TRI200101ABC',
      razonSocial: 'TRIDENT RESTAURANTES S.A. DE C.V.',
      regimenFiscal: '601',
      codigoPostal: '06000',
      certificateNumber: '30001000000500003415',
      certificatePem: 'cert-pem',
      privateKeyVaultId: 'key-1',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: '2028-01-01T00:00:00Z',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    };

    const draftInvoice: FiscalInvoice = {
      id: 'inv-1',
      organizationId: 'org-1',
      branchId: 'branch-1',
      invoiceUuid: null,
      series: 'F',
      folio: '1001',
      customerTaxId: 'XAXX010101000',
      customerName: 'PUBLICO EN GENERAL',
      customerRegimenFiscal: '616',
      customerPostalCode: '06000',
      cfdiUse: 'S01',
      paymentMethod: 'PUE',
      paymentWay: '01',
      subtotal: '100.0000',
      taxTotal: '16.0000',
      totalAmount: '116.0000',
      status: 'DRAFT',
      cancellationReason: null,
      cancellationReplacementUuid: null,
      stampedAt: null,
      cancelledAt: null,
      xmlPayload: null,
      stampedXml: null,
      selloEmisor: null,
      selloSat: null,
      cadenaOriginalHash: null,
      pacRequestReferenceId: 'ref-1',
      createdAt: '2026-09-21T10:00:00Z',
      updatedAt: '2026-09-21T10:00:00Z',
    };

    const items: FiscalInvoiceItem[] = [
      {
        id: 'item-1',
        invoiceId: 'inv-1',
        lineNumber: 1,
        productCode: 'PROD-1',
        description: 'Taco de Asada',
        satProductCode: '90101501',
        satUnitCode: 'E48',
        quantity: '1.0000',
        unitPrice: '100.0000',
        subtotal: '100.0000',
        taxAmount: '16.0000',
        totalAmount: '116.0000',
        taxRate: '0.1600',
      },
    ];

    it('WP021-LIFE-01: validates DRAFT invoice for stamping', () => {
      assert.doesNotThrow(() => validateInvoiceForStamping(draftInvoice, items, sampleEmisor));
    });

    it('WP021-LIFE-02: applies stamp to transition DRAFT -> STAMPED', () => {
      const stamped = applyStampToInvoice(draftInvoice, {
        status: 'STAMPED',
        uuid: 'UUID-123-ABC',
        selloSat: 'sello-sat-xyz',
        stampedXml: '<stampedXml/>',
        fechaTimbrado: '2026-09-21T10:05:00Z',
      });

      assert.equal(stamped.status, 'STAMPED');
      assert.equal(stamped.invoiceUuid, 'UUID-123-ABC');
      assert.equal(stamped.selloSat, 'sello-sat-xyz');
      assert.equal(stamped.stampedAt, '2026-09-21T10:05:00Z');

      // Attempting to stamp again fails closed
      assert.throws(
        () => validateInvoiceForStamping(stamped, items, sampleEmisor),
        FiscalInvoiceAlreadyStampedError,
      );
    });

    it('WP021-LIFE-03: applies cancellation to transition STAMPED -> CANCELLED', () => {
      const stamped = applyStampToInvoice(draftInvoice, {
        status: 'STAMPED',
        uuid: 'UUID-123-ABC',
      });

      const cancelled = applyCancellationToInvoice(stamped, '02');
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancellationReason, '02');
      assert.ok(cancelled.cancelledAt);

      // Attempting to cancel already cancelled invoice fails closed
      assert.throws(
        () => applyCancellationToInvoice(cancelled, '02'),
        FiscalInvoiceAlreadyCancelledError,
      );

      // Attempting to cancel DRAFT invoice fails closed
      assert.throws(
        () => applyCancellationToInvoice(draftInvoice, '02'),
        FiscalInvoiceInvalidStateError,
      );
    });

    it('WP021-LIFE-04: OQ-ARCH-02 groups unclaimed folios into batch candidate', () => {
      const tickets: UnclaimedFiscalTicket[] = [
        {
          ticketFolio: 'T-101',
          branchId: 'branch-1',
          paidAt: '2026-09-20T12:00:00Z',
          subtotal: '200.0000',
          taxTotal: '32.0000',
          totalAmount: '232.0000',
          isClaimed: false,
        },
        {
          ticketFolio: 'T-102',
          branchId: 'branch-1',
          paidAt: '2026-09-20T13:00:00Z',
          subtotal: '100.0000',
          taxTotal: '16.0000',
          totalAmount: '116.0000',
          isClaimed: false,
        },
        {
          ticketFolio: 'T-103',
          branchId: 'branch-1',
          paidAt: '2026-09-20T14:00:00Z',
          subtotal: '50.0000',
          taxTotal: '8.0000',
          totalAmount: '58.0000',
          isClaimed: true, // Already invoiced individually
        },
      ];

      const batch = groupUnclaimedFoliosIntoBatchCandidate(
        'org-1',
        'branch-1',
        '2026-09-01T00:00:00Z',
        '2026-09-30T23:59:59Z',
        tickets,
      );

      assert.deepEqual(batch.ticketFolios, ['T-101', 'T-102']);
      assert.equal(batch.subtotal, '300.0000');
      assert.equal(batch.taxTotal, '48.0000');
      assert.equal(batch.totalAmount, '348.0000');
    });
  });

  describe('7. CSD Vault and Runtime Connectors (SEC-VAL-05 & QI-BLK-021-R1-01/02)', () => {
    it('WP021-VAULT-01: UnavailableCsdVault fails closed', async () => {
      const vault = new UnavailableCsdVault();
      await assert.rejects(
        () => vault.getPrivateKeyPem('org-1', 'vault-1'),
        CsdCredentialsMissingError,
      );
    });

    it('WP021-VAULT-02: InMemoryCsdVault stores and retrieves private key pem', async () => {
      const vault = new InMemoryCsdVault();
      await vault.storePrivateKeyPem('org-1', 'vault-1', testKeyPair.privateKey);
      const retrieved = await vault.getPrivateKeyPem('org-1', 'vault-1');
      assert.equal(retrieved, testKeyPair.privateKey);

      // Non-existent key returns null
      const missing = await vault.getPrivateKeyPem('org-1', 'non-existent');
      assert.equal(missing, null);
    });

    it('WP021-PAC-06: UnavailablePacConnector fails closed on stamping and cancellation', async () => {
      const pac = new UnavailablePacConnector();
      assert.equal(pac.providerName, 'UNAVAILABLE_PAC');

      await assert.rejects(
        () =>
          pac.timbrar({
            organizationId: 'org-1',
            invoiceId: 'inv-1',
          }),
        PacTimeoutError,
      );

      await assert.rejects(
        () =>
          pac.cancelar({
            organizationId: 'org-1',
            uuid: 'UUID-123',
            rfcEmisor: 'TRI200101ABC',
          }),
        PacTimeoutError,
      );
    });
  });
});
