/**
 * TRIDENTPOS WP-025: Mobile Waiter Handheld Client Suite
 * Validates ADR-012 Scale-4 numerics, DEC-015 bill splitting invariants, SEC-VAL-03 QR trust bootstrap,
 * ADR-005 LAN dead-zone queue & OCC 409 conflict handling, DEC-011 receiver PIN transfers, and DEC-013 manager voids.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toScale4BigInt,
  fromScale4BigInt,
  addScale4,
  subScale4,
  multiplyScale4,
  divideScale4,
  compareScale4,
  formatCurrencyScale4,
  calculateItemSubtotalScale4,
  calculateProportionalSplit,
  StationEnrollmentService,
  MobileLanClient,
  DiningFloorService,
  BillSplitService,
  TableTransferService,
  MobileVoidService,
  type DiningTable,
  type TableArea,
  type WaiterProfile,
} from './index.js';

describe('TRIDENTPOS WP-025: Mobile Waiter Handheld Client Suite', () => {
  // =========================================================================
  // 1. ADR-012 Scale-4 UI Numerics & Exact Currency
  // =========================================================================
  describe('ADR-012 Scale-4 UI Numerics & Exact Money', () => {
    it('converts between BigInt and canonical scale-4 strings without float drift', () => {
      assert.equal(toScale4BigInt('0.0000'), 0n);
      assert.equal(toScale4BigInt('125.5000'), 1255000n);
      assert.equal(toScale4BigInt('-42.1234'), -421234n);
      assert.equal(fromScale4BigInt(1255000n), '125.5000');
      assert.equal(fromScale4BigInt(-421234n), '-42.1234');
    });

    it('performs exact scale-4 arithmetic', () => {
      assert.equal(addScale4('10.2500', '5.7500'), '16.0000');
      assert.equal(subScale4('20.0000', '4.2500'), '15.7500');
      assert.equal(multiplyScale4('15.0000', '3.0000'), '45.0000');
      assert.equal(divideScale4('100.0000', '4.0000'), '25.0000');
      assert.equal(compareScale4('10.0000', '15.0000'), -1);
      assert.equal(compareScale4('20.0000', '20.0000'), 0);
    });

    it('formats scale-4 values into localized human currency string', () => {
      assert.equal(formatCurrencyScale4('1250.0000'), '$1,250.00');
      assert.equal(formatCurrencyScale4('45.5000'), '$45.50');
      assert.equal(formatCurrencyScale4('-10.0000'), '-$10.00');
    });

    it('calculates item subtotal including additive and subtractive modifiers (DEC-016)', () => {
      // Base burger $120.00 + Extra bacon $25.00 = $145.00 x 2 = $290.00
      const subtotal = calculateItemSubtotalScale4('120.0000', '2.0000', '25.0000');
      assert.equal(subtotal, '290.0000');
    });
  });

  // =========================================================================
  // 2. DEC-015 / OQ-SSOT-06: Proportional Bill Splitting Invariant
  // =========================================================================
  describe('DEC-015 / OQ-SSOT-06: Proportional Bill Splitting Engine', () => {
    it('splits bill equally across N diners and absorbs residue in the last subaccount', () => {
      // 3-way split of $100.0000
      // 100 / 3 = 33.3333, residue allocated to diner 3 = 33.3334
      const res = calculateProportionalSplit({
        mode: 'EQUAL',
        splitCount: 3,
        originalTotalScale4: '100.0000',
      });

      assert.equal(res.balanced, true);
      assert.equal(res.subAccounts.length, 3);
      assert.equal(res.subAccounts[0]?.totalToPayScale4, '33.3333');
      assert.equal(res.subAccounts[1]?.totalToPayScale4, '33.3333');
      assert.equal(res.subAccounts[2]?.totalToPayScale4, '33.3334');
      assert.equal(res.sumOfSubAccountsScale4, '100.0000');
    });

    it('prorates discounts and tips proportionally and preserves exact total balance', () => {
      // Total $300.0000 split across 2 people, with $30.0000 discount and $30.0000 tip
      const res = calculateProportionalSplit({
        mode: 'EQUAL',
        splitCount: 2,
        originalTotalScale4: '300.0000',
        totalDiscountScale4: '30.0000',
        totalTipScale4: '30.0000',
      });

      assert.equal(res.balanced, true);
      assert.equal(res.subAccounts[0]?.proratedDiscountScale4, '15.0000');
      assert.equal(res.subAccounts[0]?.proratedTipScale4, '15.0000');
      assert.equal(res.subAccounts[1]?.proratedDiscountScale4, '15.0000');
      assert.equal(res.subAccounts[1]?.proratedTipScale4, '15.0000');
      assert.equal(res.sumOfSubAccountsScale4, '300.0000');
    });

    it('splits by individual items with proportional discount allocation', () => {
      const items = [
        {
          subAccountIndex: 0,
          item: {
            draftItemId: 'it-1',
            productId: 'p-ribeye',
            productCode: 'RIB-01',
            productName: 'Ribeye Steak',
            unitPriceScale4: '400.0000',
            quantityScale4: '1.0000',
            selectedModifiers: [],
            subtotalScale4: '400.0000',
          },
        },
        {
          subAccountIndex: 1,
          item: {
            draftItemId: 'it-2',
            productId: 'p-salad',
            productCode: 'SAL-01',
            productName: 'Ensalada César',
            unitPriceScale4: '100.0000',
            quantityScale4: '1.0000',
            selectedModifiers: [],
            subtotalScale4: '100.0000',
          },
        },
      ];

      // Total items = 500.0000, 10% overall discount ($50.0000)
      // Diner 1 (400) gets 80% discount ($40.0000), Diner 2 (100) gets 20% discount ($10.0000)
      const res = calculateProportionalSplit({
        mode: 'BY_ITEM',
        itemAssignments: items,
        originalTotalScale4: '450.0000', // 500 - 50 = 450
        totalDiscountScale4: '50.0000',
      });

      assert.equal(res.balanced, true);
      assert.equal(res.subAccounts[0]?.proratedDiscountScale4, '40.0000');
      assert.equal(res.subAccounts[0]?.totalToPayScale4, '360.0000'); // 400 - 40
      assert.equal(res.subAccounts[1]?.proratedDiscountScale4, '10.0000');
      assert.equal(res.subAccounts[1]?.totalToPayScale4, '90.0000'); // 100 - 10
      assert.equal(res.sumOfSubAccountsScale4, '450.0000');
    });

    it('BillSplitService wraps calculation and preserves dining table invariants', () => {
      const service = new BillSplitService();
      const mockTable: DiningTable = {
        id: 't-01',
        code: 'M-01',
        areaId: 'a-salon',
        areaName: 'Salón Principal',
        capacity: 4,
        status: 'OCCUPIED',
        totalBalanceScale4: '250.0000',
        version: 3,
      };

      const result = service.splitTableBill({
        table: mockTable,
        mode: 'EQUAL',
        splitCount: 2,
      });

      assert.equal(result.balanced, true);
      assert.equal(result.sumOfSubAccountsScale4, '250.0000');
      assert.equal(result.subAccounts[0]?.totalToPayScale4, '125.0000');
      assert.equal(result.subAccounts[1]?.totalToPayScale4, '125.0000');
    });
  });

  // =========================================================================
  // 3. SEC-VAL-03: QR Station Enrollment & Trust Bootstrap
  // =========================================================================
  describe('SEC-VAL-03: QR Station Enrollment & Trust Bootstrap', () => {
    const validFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    it('parses valid QR payload and rejects malformed formats', () => {
      const enrollmentService = new StationEnrollmentService();
      const validQrJson = JSON.stringify({
        edgeHostUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        pairingToken: 'pair-tok-xyz789',
        serverFingerprintSha256: validFingerprint,
        issuedAt: Date.now() - 5000,
      });

      const parsed = enrollmentService.parseQrPayload(validQrJson);
      assert.equal(parsed.stationId, 'handheld-01');
      assert.equal(parsed.edgeHostUrl, 'https://192.168.1.100:8443');

      // Rejects insecure HTTP
      assert.throws(
        () =>
          enrollmentService.parseQrPayload(
            JSON.stringify({ ...parsed, edgeHostUrl: 'http://insecure-host.lan' }),
          ),
        /INSECURE_EDGE_URL/,
      );

      // Rejects future clock drift
      assert.throws(
        () =>
          enrollmentService.parseQrPayload(
            JSON.stringify({ ...parsed, issuedAt: Date.now() + 120000 }),
          ),
        /CLOCK_DRIFT_VIOLATION/,
      );

      // Rejects expired QR codes
      assert.throws(
        () =>
          enrollmentService.parseQrPayload(
            JSON.stringify({ ...parsed, issuedAt: Date.now() - 20 * 60 * 1000 }),
          ),
        /EXPIRED_QR_TOKEN/,
      );
    });

    it('performs timing-safe TLS fingerprint verification', () => {
      const enrollmentService = new StationEnrollmentService();
      const expected = validFingerprint;
      const matchingPresented = validFingerprint;
      const forgedPresented = 'a3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      assert.equal(enrollmentService.verifyTlsFingerprint(expected, matchingPresented), true);
      assert.equal(enrollmentService.verifyTlsFingerprint(expected, forgedPresented), false);
      assert.equal(enrollmentService.verifyTlsFingerprint(expected, 'short-hash'), false);
    });

    it('completes enrollment atomically and stores station pairing credentials', () => {
      const enrollmentService = new StationEnrollmentService();
      const qrPayload = {
        edgeHostUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        pairingToken: 'tok-123',
        serverFingerprintSha256: validFingerprint,
        issuedAt: Date.now(),
      };

      const state = enrollmentService.completeEnrollment({
        qrPayload,
        presentedServerCertificateFingerprint: validFingerprint,
        stationToken: 'jwt-station-token-abc',
      });

      assert.equal(state.isEnrolled, true);
      assert.equal(state.stationId, 'handheld-01');
      assert.equal(state.stationToken, 'jwt-station-token-abc');

      // Purge credentials
      enrollmentService.purgeEnrollment();
      assert.equal(enrollmentService.getPairingState().isEnrolled, false);
      assert.equal(enrollmentService.getPairingState().stationToken, null);
    });

    it('rejects rogue Edge server when TLS certificate fingerprint does not match trust anchor (SEC-VAL-03 fail-closed)', () => {
      const enrollmentService = new StationEnrollmentService();
      const qrPayload = {
        edgeHostUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        pairingToken: 'tok-123',
        serverFingerprintSha256: validFingerprint,
        issuedAt: Date.now(),
      };

      const rogueFingerprint = '1111111111111111111111111111111111111111111111111111111111111111';

      assert.throws(
        () =>
          enrollmentService.completeEnrollment({
            qrPayload,
            presentedServerCertificateFingerprint: rogueFingerprint,
            stationToken: 'fake-token',
          }),
        /SEC_VAL_03_FAIL_CLOSED/,
      );
    });
  });

  // =========================================================================
  // 4. ADR-005: Local LAN Client, Dead-Zone & OCC 409 Engine
  // =========================================================================
  describe('ADR-005: Local LAN Client, Dead-Zone & OCC 409 Engine', () => {
    it('dispatches mutation with OCC expectedVersion and returns response', async () => {
      let capturedHeaders: unknown;
      const mockFetch: typeof fetch = async (_input, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ success: true, newVersion: 4 }), { status: 200 });
      };

      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
        fetchFn: mockFetch,
      });

      const res = await client.executeMutation({
        endpoint: '/api/v1/dining/tables/t-01/orders',
        body: { items: [] },
        expectedVersion: 3,
        mutationType: 'DISPATCH_COMANDA',
      });

      assert.equal(res.ok, true);
      assert.equal((capturedHeaders as Record<string, string>)['if-match'], '3');
    });

    it('detects OCC 409 stale version conflict and triggers conflict handler', async () => {
      let conflictDetected = false;
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ tableId: 't-01', currentVersion: 5 }), {
          status: 409,
        });
      };

      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
        fetchFn: mockFetch,
      });

      const res = await client.executeMutation({
        endpoint: '/api/v1/dining/tables/t-01/orders',
        body: { items: [] },
        expectedVersion: 3,
        mutationType: 'DISPATCH_COMANDA',
        onConflict: async (conflict) => {
          conflictDetected = true;
          assert.equal(conflict.remoteVersion, 5);
          assert.equal(conflict.expectedVersion, 3);
          return false; // Do not auto-retry
        },
      });

      assert.equal(res.ok, false);
      assert.equal(conflictDetected, true);
      assert.match(res.error, /OCC_409_CONFLICT/);
    });

    it('queues mutations when in Wi-Fi dead-zone and triggers full resync on reconnect (ADR-005)', async () => {
      let fullResyncFired = false;
      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
      });

      client.onFullResync(() => {
        fullResyncFired = true;
      });

      // Simulate entering Wi-Fi dead zone
      client.setNetworkState('DEAD_ZONE');
      assert.equal(client.getNetworkState(), 'DEAD_ZONE');

      // Dispatch comanda while in dead zone
      const res = await client.executeMutation({
        endpoint: '/api/v1/dining/tables/t-01/orders',
        body: { items: ['burger'] },
        expectedVersion: 2,
        mutationType: 'DISPATCH_COMANDA',
      });

      assert.equal(res.ok, true);
      assert.equal(res.fromQueue, true);
      assert.equal(client.getPendingQueueCount(), 1);

      // Reconnect to LAN Wi-Fi
      client.setNetworkState('ONLINE');
      assert.equal(client.getNetworkState(), 'ONLINE');
      assert.equal(fullResyncFired, true); // ADR-005 Full-State Resync verified!

      // Verify queue was auto-drained upon reconnection
      assert.equal(client.getPendingQueueCount(), 0);
    });
  });

  // =========================================================================
  // 5. Dining Floor Service
  // =========================================================================
  describe('Dining Floor Service', () => {
    it('manages floor plan areas, tables, and comanda assembly', () => {
      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
      });

      const areas: TableArea[] = [
        { id: 'a-salon', code: 'SALON', name: 'Salón', displayOrder: 1 },
        { id: 'a-terraza', code: 'TERRAZA', name: 'Terraza', displayOrder: 2 },
      ];

      const tables: DiningTable[] = [
        {
          id: 't-01',
          code: 'M-01',
          areaId: 'a-salon',
          areaName: 'Salón',
          capacity: 4,
          status: 'AVAILABLE',
          totalBalanceScale4: '0.0000',
          version: 1,
        },
        {
          id: 't-02',
          code: 'M-02',
          areaId: 'a-terraza',
          areaName: 'Terraza',
          capacity: 6,
          status: 'OCCUPIED',
          totalBalanceScale4: '350.0000',
          version: 2,
        },
      ];

      const service = new DiningFloorService(client, { areas, tables });
      assert.equal(service.getAreas().length, 2);
      assert.equal(service.getTables('a-salon').length, 1);

      // Create item draft with modifier
      const item = service.createItemDraft({
        productId: 'prod-taco',
        productCode: 'TAC-01',
        productName: 'Orden de Tacos al Pastor',
        unitPriceScale4: '85.0000',
        quantityScale4: '2.0000',
        selectedModifiers: [
          {
            id: 'mod-queso',
            name: 'Con Queso Extra',
            kind: 'ADDITIVE',
            priceDeltaScale4: '15.0000',
          },
        ],
        cookingNote: 'Bien dorados',
      });

      // Subtotal = (85 + 15) * 2 = 200.0000
      assert.equal(item.subtotalScale4, '200.0000');

      const comanda = service.assembleComandaDraft({
        tableId: 't-01',
        waiterId: 'w-carlos',
        waiterName: 'Carlos M.',
        items: [item],
      });

      assert.equal(comanda.totalComandaScale4, '200.0000');
      assert.equal(comanda.expectedTableVersion, 1);
    });
  });

  // =========================================================================
  // 6. DEC-011 / OQ-SSOT-02: Table Transfer with Receiver PIN
  // =========================================================================
  describe('DEC-011 / OQ-SSOT-02: Table Transfer with Receiver PIN', () => {
    it('applies table transfer strictly when receiving waiter enters valid PIN', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };

      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
        fetchFn: mockFetch,
      });

      const pinValidator = {
        verifyWaiterPin: (_waiterId: string, pin: string) => pin === '4321',
      };

      const waiters: WaiterProfile[] = [
        { id: 'w-01', name: 'Carlos E.', pinHash: 'hash1', activeBranchId: 'br-01' },
        { id: 'w-02', name: 'Laura R.', pinHash: 'hash2', activeBranchId: 'br-01' },
      ];

      const service = new TableTransferService(client, pinValidator, waiters);
      assert.equal(service.getAvailableWaiters('w-01').length, 1);

      // Successful transfer with correct receiver PIN
      const resSuccess = await service.transferTable({
        tableId: 't-01',
        fromWaiterId: 'w-01',
        toWaiterId: 'w-02',
        receiverPin: '4321',
      });

      assert.equal(resSuccess.success, true);
      assert.equal(resSuccess.newWaiterId, 'w-02');

      // Failed transfer with wrong receiver PIN -> Account stays with current waiter
      const resFailed = await service.transferTable({
        tableId: 't-01',
        fromWaiterId: 'w-01',
        toWaiterId: 'w-02',
        receiverPin: '9999',
      });

      assert.equal(resFailed.success, false);
      assert.equal(resFailed.previousWaiterId, 'w-01');
      assert.match(resFailed.error || '', /RECEIVER_PIN_REJECTED/);
    });
  });

  // =========================================================================
  // 7. DEC-013 / OQ-SSOT-04: Manager Void from Mobile
  // =========================================================================
  describe('DEC-013 / OQ-SSOT-04: Manager Void from Mobile', () => {
    it('cancels account requiring manager PIN and mandatory reason catalog', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };

      const client = new MobileLanClient({
        baseUrl: 'https://192.168.1.100:8443',
        stationId: 'handheld-01',
        stationToken: 'token-xyz',
        fetchFn: mockFetch,
      });

      const managerValidator = {
        verifyManagerPin: async (pin: string) =>
          pin === '8888' ? { valid: true, managerId: 'mgr-admin' } : { valid: false },
      };

      const service = new MobileVoidService(client, managerValidator);
      assert.ok(service.getCancellationReasons().length >= 4);

      // Rejects missing reason
      const resNoReason = await service.voidAccount({
        tableId: 't-01',
        accountId: 'acc-t01',
        managerPin: '8888',
        reasonCode: '',
        reasonNotes: '',
        hadPrecuentaPrinted: false,
      });
      assert.equal(resNoReason.success, false);
      assert.match(resNoReason.error || '', /MANDATORY_REASON_REQUIRED/);

      // Rejects incorrect manager PIN
      const resBadPin = await service.voidAccount({
        tableId: 't-01',
        accountId: 'acc-t01',
        managerPin: '0000',
        reasonCode: 'CLIENT_LEFT',
        reasonNotes: 'Se fue',
        hadPrecuentaPrinted: false,
      });
      assert.equal(resBadPin.success, false);
      assert.match(resBadPin.error || '', /MANAGER_PIN_REJECTED/);

      // Successful void with precuenta annulled
      const resSuccess = await service.voidAccount({
        tableId: 't-01',
        accountId: 'acc-t01',
        managerPin: '8888',
        reasonCode: 'CLIENT_LEFT',
        reasonNotes: 'Cliente canceló consumo',
        hadPrecuentaPrinted: true,
      });
      assert.equal(resSuccess.success, true);
      assert.equal(resSuccess.authorizedByManagerId, 'mgr-admin');
      assert.equal(resSuccess.folioAnnulled, 'FOLIO-VOID-acc-t01');
    });
  });
});
