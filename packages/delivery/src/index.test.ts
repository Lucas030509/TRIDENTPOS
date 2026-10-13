/**
 * TRIDENTPOS WP-023: Delivery Hub & Aggregator Webhook Integration Engine Suite
 * Validates SEC-VAL-10, provider-specific cryptographic signatures, anti-replay guards, catalog resolution, auto-accept rules, and KDS dispatch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebhookCryptographicVerifier,
  WebhookDeduplicationStore,
  DeliveryOrderTransformer,
  DeliveryKdsDispatcher,
  DeliveryHubService,
  addScale4,
  subScale4,
  multiplyScale4,
  divideScale4,
  compareScale4,
  InvalidWebhookSignatureError,
  StaleWebhookTimestampError,
  DuplicateWebhookEventError,
  IntegrationDisabledError,
  UnmappedCatalogItemError,
} from './index.js';
import type {
  DeliveryIntegrationConfig,
  ExternalOrderPayload,
  IncomingWebhookRequest,
  CatalogMappingProvider,
} from './index.js';

describe('TRIDENTPOS WP-023: Delivery Hub & Aggregator Integration Engine Suite', () => {
  const secretKey = 'test-webhook-secret-uber-2026';
  const orgId = '77777777-7777-7777-7777-777777777777';
  const branchId = '88888888-8888-8888-8888-888888888888';

  const samplePayload: ExternalOrderPayload = {
    eventId: 'evt-uber-99001',
    channel: 'UBER_EATS',
    storeExternalId: 'store-condesa-01',
    externalOrderId: 'UBER-MX-450912',
    orderTimestamp: new Date().toISOString(),
    customer: {
      name: 'Carlos Mendoza',
      phone: '5512345678',
      notes: 'Tocar el timbre 2B',
    },
    deliveryAddress: {
      street: 'Av. Mazatlán 142',
      interior: 'Depto 2B',
      colonia: 'Condesa',
      city: 'CDMX',
      postalCode: '06140',
      deliveryNotes: 'Dejar con el portero si no responde',
    },
    courier: {
      name: 'Jorge Moto',
      phone: '5598765432',
      vehicleType: 'MOTORCYCLE',
      licensePlate: 'MOT-991',
    },
    items: [
      {
        externalItemId: 'ext-tacos-al-pastor',
        sku: 'SKU-TAC-01',
        name: 'Orden de Tacos al Pastor',
        quantity: 2,
        unitPrice: '120.0000',
        totalPrice: '240.0000',
        notes: 'Con todo (piña, cilantro, cebolla)',
        modifiers: [
          {
            externalModifierId: 'mod-extra-salsa',
            name: 'Extra Salsa Verde',
            quantity: 1,
            unitPrice: '15.0000',
          },
        ],
      },
    ],
    financials: {
      subtotal: '255.0000',
      taxTotal: '40.8000',
      platformCommission: '38.2500',
      deliveryFee: '45.0000',
      customerTip: '30.0000',
      grandTotal: '370.8000',
    },
    notes: 'Cliente frecuente Uber One',
  };

  const sampleConfig: DeliveryIntegrationConfig = {
    id: 'cfg-uber-01',
    orgId,
    branchId,
    channel: 'UBER_EATS',
    storeExternalId: 'store-condesa-01',
    webhookSecret: secretKey,
    isEnabled: true,
    autoAcceptEnabled: true,
    minOrderAmount: '50.0000',
    maxOrderAmount: '5000.0000',
  };

  describe('Numerics & Scale-4 Precision (ADR-012)', () => {
    it('performs exact Scale-4 addition, subtraction, multiplication, and division', () => {
      assert.equal(addScale4('255.0000', '40.8000'), '295.8000');
      assert.equal(subScale4('370.8000', '30.0000'), '340.8000');
      assert.equal(multiplyScale4('120.0000', '2.0000'), '240.0000');
      assert.equal(divideScale4('240.0000', '2.0000'), '120.0000');
      assert.equal(compareScale4('100.0000', '100.0000'), 0);
      assert.equal(compareScale4('150.0000', '100.0000'), 1);
      assert.equal(compareScale4('50.0000', '100.0000'), -1);
    });
  });

  describe('SEC-VAL-10: Cryptographic Signature Verification & Replay Protection', () => {
    it('successfully verifies authentic webhook with valid HMAC signature and timestamp', () => {
      const verifier = new WebhookCryptographicVerifier();
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const signature = verifier.generateSignature('UBER_EATS', rawBody, secretKey, now);

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': signature,
          'x-delivery-timestamp': now.toString(),
        },
        rawBody,
      };

      const result = verifier.verify(request, secretKey, samplePayload.eventId, now);
      assert.equal(result.verified, true);
    });

    it('rejects forged webhook signature fail-closed', () => {
      const verifier = new WebhookCryptographicVerifier();
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const forgedSignature = 'bad0000000000000000000000000000000000000000000000000000000000000';

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': forgedSignature,
          'x-delivery-timestamp': now.toString(),
        },
        rawBody,
      };

      assert.throws(
        () => verifier.verify(request, secretKey, samplePayload.eventId, now),
        InvalidWebhookSignatureError,
      );
    });

    it('rejects stale webhook timestamp exceeding provider-defined replay window (>300s)', () => {
      const verifier = new WebhookCryptographicVerifier();
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const staleTimestamp = now - 350_000; // 350 seconds ago (> 300s window)
      const signature = verifier.generateSignature('UBER_EATS', rawBody, secretKey, staleTimestamp);

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': signature,
          'x-delivery-timestamp': staleTimestamp.toString(),
        },
        rawBody,
      };

      assert.throws(
        () => verifier.verify(request, secretKey, samplePayload.eventId, now),
        StaleWebhookTimestampError,
      );
    });

    it('rejects webhook timestamp drifting into the future (>60s clock drift)', () => {
      const verifier = new WebhookCryptographicVerifier();
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const futureTimestamp = now + 90_000; // 90 seconds into future
      const signature = verifier.generateSignature(
        'UBER_EATS',
        rawBody,
        secretKey,
        futureTimestamp,
      );

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': signature,
          'x-delivery-timestamp': futureTimestamp.toString(),
        },
        rawBody,
      };

      assert.throws(
        () => verifier.verify(request, secretKey, samplePayload.eventId, now),
        StaleWebhookTimestampError,
      );
    });

    it('rejects replay of identical eventId fail-closed (Event Deduplication)', () => {
      const dedupStore = new WebhookDeduplicationStore();
      const verifier = new WebhookCryptographicVerifier(dedupStore);
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const signature = verifier.generateSignature('UBER_EATS', rawBody, secretKey, now);

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': signature,
          'x-delivery-timestamp': now.toString(),
        },
        rawBody,
      };

      // First call succeeds
      const firstResult = verifier.verify(request, secretKey, 'unique-event-01', now);
      assert.equal(firstResult.verified, true);

      // Replay of same eventId fails
      assert.throws(
        () => verifier.verify(request, secretKey, 'unique-event-01', now + 1000),
        DuplicateWebhookEventError,
      );
    });

    it('supports Rappi and Didi Food provider connector contracts', () => {
      const verifier = new WebhookCryptographicVerifier();
      const rawBody = JSON.stringify({ ...samplePayload, channel: 'RAPPI' });
      const now = Date.now();
      const rappiSig = verifier.generateSignature('RAPPI', rawBody, 'rappi-secret-2026', now);

      const rappiReq: IncomingWebhookRequest = {
        channel: 'RAPPI',
        headers: {
          'x-rappi-signature': rappiSig,
          'x-rappi-timestamp': now.toString(),
        },
        rawBody,
      };

      const resultRappi = verifier.verify(rappiReq, 'rappi-secret-2026', 'rappi-evt-001', now);
      assert.equal(resultRappi.verified, true);

      const didiSig = verifier.generateSignature('DIDIFOOD', rawBody, 'didi-secret-2026', now);
      const didiReq: IncomingWebhookRequest = {
        channel: 'DIDIFOOD',
        headers: {
          'x-didi-signature': didiSig,
          'x-didi-timestamp': now.toString(),
        },
        rawBody,
      };

      const resultDidi = verifier.verify(didiReq, 'didi-secret-2026', 'didi-evt-001', now);
      assert.equal(resultDidi.verified, true);
    });
  });

  describe('Order Transformation & Catalog Resolution', () => {
    it('maps external aggregator order schema to canonical DeliveryOrder', async () => {
      const mockCatalog: CatalogMappingProvider = {
        async resolveItem(_org, _channel, externalItemId) {
          if (externalItemId === 'ext-tacos-al-pastor') {
            return {
              externalItemId,
              internalProductId: 'prod-internal-tacos-pastor',
              internalRecipeId: 'rec-tacos-pastor-orden',
              internalName: 'Tacos al Pastor (5 pzas)',
              isAvailable: true,
            };
          }
          return null;
        },
      };

      const transformer = new DeliveryOrderTransformer(mockCatalog);
      const order = await transformer.transform(samplePayload, { orgId, branchId });

      assert.equal(order.channel, 'UBER_EATS');
      assert.equal(order.externalOrderId, 'UBER-MX-450912');
      assert.equal(order.customerName, 'Carlos Mendoza');
      assert.equal(order.customerPhone, '5512345678');
      assert.equal(order.deliveryAddress, 'Av. Mazatlán 142, Depto 2B, Condesa, CDMX, 06140');
      assert.equal(order.courierName, 'Jorge Moto');
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0]?.internalProductId, 'prod-internal-tacos-pastor');
      assert.equal(order.items[0]?.internalRecipeId, 'rec-tacos-pastor-orden');
      assert.equal(order.items[0]?.name, 'Tacos al Pastor (5 pzas)');
      assert.equal(order.financials.subtotal, '255.0000');
      assert.equal(order.financials.taxTotal, '40.8000');
      assert.equal(order.financials.grandTotal, '370.8000');
    });

    it('rejects unmapped catalog item when allowUnmappedItems is false', async () => {
      const transformer = new DeliveryOrderTransformer({
        async resolveItem() {
          return null; // Unmapped
        },
      });

      await assert.rejects(
        transformer.transform(samplePayload, { orgId, branchId, allowUnmappedItems: false }),
        UnmappedCatalogItemError,
      );
    });
  });

  describe('Auto-Accept Policy Engine', () => {
    it('approves order when integration is active, within limits, and kitchen is open', async () => {
      const transformer = new DeliveryOrderTransformer();
      const order = await transformer.transform(samplePayload, {
        orgId,
        branchId,
        allowUnmappedItems: true,
      });
      const decision = transformer.evaluateAutoAccept(order, sampleConfig, {
        isKitchenBusy: false,
        isStoreOpen: true,
      });

      assert.equal(decision.accepted, true);
      const finalized = transformer.applyDecision(order, decision);
      assert.equal(finalized.status, 'ACCEPTED');
    });

    it('rejects order when store is closed or kitchen is overloaded', async () => {
      const transformer = new DeliveryOrderTransformer();
      const order = await transformer.transform(samplePayload, {
        orgId,
        branchId,
        allowUnmappedItems: true,
      });

      const closedDecision = transformer.evaluateAutoAccept(order, sampleConfig, {
        isStoreOpen: false,
      });
      assert.equal(closedDecision.accepted, false);
      assert.equal(closedDecision.reason, 'STORE_CLOSED');

      const busyDecision = transformer.evaluateAutoAccept(order, sampleConfig, {
        isKitchenBusy: true,
        isStoreOpen: true,
      });
      assert.equal(busyDecision.accepted, false);
      assert.equal(busyDecision.reason, 'KITCHEN_BUSY');
    });

    it('rejects order outside min/max amount limits', async () => {
      const transformer = new DeliveryOrderTransformer();
      const order = await transformer.transform(samplePayload, {
        orgId,
        branchId,
        allowUnmappedItems: true,
      });

      const configWithHighMin: DeliveryIntegrationConfig = {
        ...sampleConfig,
        minOrderAmount: '500.0000', // order total is 370.8000
      };

      const decision = transformer.evaluateAutoAccept(order, configWithHighMin);
      assert.equal(decision.accepted, false);
      assert.equal(decision.reason, 'ORDER_BELOW_MINIMUM_500.0000');
    });
  });

  describe('KDS Comanda Dispatcher', () => {
    it('creates accurate KDS comanda dispatch from accepted delivery order', async () => {
      const transformer = new DeliveryOrderTransformer();
      const dispatcher = new DeliveryKdsDispatcher();

      const order = await transformer.transform(samplePayload, {
        orgId,
        branchId,
        allowUnmappedItems: true,
      });
      order.status = 'ACCEPTED';

      const comanda = dispatcher.createComanda(order);
      assert.ok(comanda.comandaId);
      assert.equal(comanda.orderType, 'DELIVERY');
      assert.equal(comanda.channel, 'UBER_EATS');
      assert.equal(comanda.customerName, 'Carlos Mendoza');
      assert.equal(comanda.items.length, 1);
      assert.equal(comanda.items[0]?.name, 'Orden de Tacos al Pastor');
      assert.equal(comanda.items[0]?.modifiers.length, 1);
      assert.ok(comanda.notes?.includes('Cliente frecuente Uber One'));
    });

    it('fails closed when attempting to dispatch unaccepted order to KDS', async () => {
      const transformer = new DeliveryOrderTransformer();
      const dispatcher = new DeliveryKdsDispatcher();

      const order = await transformer.transform(samplePayload, {
        orgId,
        branchId,
        allowUnmappedItems: true,
      });
      order.status = 'REJECTED';

      assert.throws(
        () => dispatcher.createComanda(order),
        /Cannot dispatch unaccepted delivery order/,
      );
    });
  });

  describe('DeliveryHubService End-to-End Orchestration', () => {
    it('executes end-to-end webhook receipt, verification, mapping, auto-accept, and KDS generation', async () => {
      const service = new DeliveryHubService();
      const rawBody = JSON.stringify(samplePayload);
      const now = Date.now();
      const signature = service
        .getVerifier()
        .generateSignature('UBER_EATS', rawBody, secretKey, now);

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {
          'x-uber-signature': signature,
          'x-delivery-timestamp': now.toString(),
        },
        rawBody,
      };

      const result = await service.processWebhook(
        request,
        sampleConfig,
        { isStoreOpen: true, isKitchenBusy: false },
        now,
      );

      assert.equal(result.verified, true);
      assert.equal(result.order.status, 'ACCEPTED');
      assert.equal(result.order.externalOrderId, 'UBER-MX-450912');
      assert.ok(result.kdsComanda);
      assert.equal(result.kdsComanda?.orderType, 'DELIVERY');
      assert.equal(result.kdsComanda?.customerName, 'Carlos Mendoza');
    });

    it('rejects incoming webhook when channel integration is disabled', async () => {
      const service = new DeliveryHubService();
      const rawBody = JSON.stringify(samplePayload);

      const disabledConfig: DeliveryIntegrationConfig = {
        ...sampleConfig,
        isEnabled: false,
      };

      const request: IncomingWebhookRequest = {
        channel: 'UBER_EATS',
        headers: {},
        rawBody,
      };

      await assert.rejects(
        service.processWebhook(request, disabledConfig),
        IntegrationDisabledError,
      );
    });
  });
});
