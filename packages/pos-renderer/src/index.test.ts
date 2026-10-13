import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPosRendererPackageInfo,
  POS_RENDERER_PACKAGE_NAME,
  createMockTridentBridge,
  EventInvalidator,
  QueryInvalidationHandler,
  DomainEvent,
  getInitialRouteFromHash,
} from './index.js';

describe('@trident/pos-renderer Architecture & Shell Harness', () => {
  it('returns valid package metadata and strictly governed dependencies', () => {
    const info = getPosRendererPackageInfo();
    assert.equal(info.name, POS_RENDERER_PACKAGE_NAME);
    assert.equal(info.version, '0.1.0');
    assert.equal(info.coreDependency, '@trident/core');
    assert.equal(info.uiDependency, '@trident/ui');
  });

  describe('Typed IPC Bridge Client & Session Contracts', () => {
    it('authenticates valid operator credentials and returns sanitized session view', async () => {
      const bridge = createMockTridentBridge();
      const loginRes = await bridge.session.login({ userCode: 'admin', pin: '1234' });
      assert.ok(loginRes.ok);
      if (loginRes.ok) {
        assert.equal(loginRes.data.userId, 'usr-1');
        assert.equal(loginRes.data.displayName, 'Gerente Principal');
        assert.ok(loginRes.data.roles.includes('GERENTE'));
        assert.ok(loginRes.data.permissions.includes('salon.access'));
        assert.equal(loginRes.data.stationId, 'st-01');
      }
    });

    it('rejects invalid PIN with FORBIDDEN error and no credential leakage', async () => {
      const bridge = createMockTridentBridge();
      const failRes = await bridge.session.login({ userCode: 'cajero', pin: '9876' });
      assert.equal(failRes.ok, false);
      if (!failRes.ok) {
        assert.equal(failRes.error.code, 'FORBIDDEN');
        assert.equal(failRes.error.retryable, false);
      }
    });

    it('handles step-up supervisor PIN authorization (DEC-010/012/013)', async () => {
      const bridge = createMockTridentBridge();
      const authRes = await bridge.session.authorize({ commandRef: 'cmd-cancel-1', pin: '9999' });
      assert.ok(authRes.ok);
      if (authRes.ok) {
        assert.equal(authRes.data.authorized, true);
      }

      const badAuth = await bridge.session.authorize({ commandRef: 'cmd-cancel-1', pin: '1111' });
      assert.equal(badAuth.ok, false);
    });

    it('returns enrolled station profile and connectivity signals', async () => {
      const bridge = createMockTridentBridge();
      const profRes = await bridge.station.getStationProfile();
      assert.ok(profRes.ok);
      if (profRes.ok) {
        assert.equal(profRes.data.mode, 'POS+CAJA');
        assert.equal(profRes.data.stationId, 'st-01');
      }

      const connRes = await bridge.station.getConnectivityStatus();
      assert.ok(connRes.ok);
      if (connRes.ok) {
        assert.equal(connRes.data.edge, 'online');
        assert.equal(connRes.data.lan, 'online');
        assert.equal(connRes.data.cloud, 'online');
      }
    });
  });

  describe('EventInvalidator & Cache Sychronization Policy', () => {
    it('invalidates salon queries on dining events', () => {
      const invalidatedKeys: unknown[][] = [];
      let fullInvalidated = false;

      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries(key) {
          invalidatedKeys.push([...key]);
        },
        invalidateAll() {
          fullInvalidated = true;
        },
      };

      const bridge = createMockTridentBridge();
      const invalidator = new EventInvalidator(bridge, cacheHandler);

      const diningEvent: DomainEvent = {
        eventType: 'PartidaAgregada',
        eventContractVersion: 1,
        entityId: 'cuenta-101',
        payload: { itemId: 'item-1' },
        timestamp: new Date().toISOString(),
      };

      invalidator.handleDomainEvent(diningEvent);

      assert.equal(fullInvalidated, false);
      assert.equal(invalidatedKeys.length, 2);
      assert.deepEqual(invalidatedKeys[0], ['salon', 'floor-plan']);
      assert.deepEqual(invalidatedKeys[1], ['salon', 'cuenta', 'cuenta-101']);
    });

    it('invalidates KDS queries on kitchen ticket events', () => {
      const invalidatedKeys: unknown[][] = [];
      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries(key) {
          invalidatedKeys.push([...key]);
        },
        invalidateAll() {},
      };

      const bridge = createMockTridentBridge();
      const invalidator = new EventInvalidator(bridge, cacheHandler);

      const kdsEvent: DomainEvent = {
        eventType: 'KdsTicketListo',
        eventContractVersion: 1,
        entityId: 'ticket-9',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      invalidator.handleDomainEvent(kdsEvent);
      assert.equal(invalidatedKeys.length, 1);
      assert.deepEqual(invalidatedKeys[0], ['kds', 'tickets']);
    });

    it('invalidates cash and floor-plan queries on payment settlement (CuentaPagada)', () => {
      const invalidatedKeys: unknown[][] = [];
      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries(key) {
          invalidatedKeys.push([...key]);
        },
        invalidateAll() {},
      };

      const bridge = createMockTridentBridge();
      const invalidator = new EventInvalidator(bridge, cacheHandler);

      const paidEvent: DomainEvent = {
        eventType: 'CuentaPagada',
        eventContractVersion: 1,
        entityId: 'cuenta-55',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      invalidator.handleDomainEvent(paidEvent);
      assert.equal(invalidatedKeys.length, 4);
      assert.deepEqual(invalidatedKeys[0], ['caja', 'shift']);
      assert.deepEqual(invalidatedKeys[1], ['salon', 'floor-plan']);
      assert.deepEqual(invalidatedKeys[2], ['caja', 'payments', 'cuenta-55']);
      assert.deepEqual(invalidatedKeys[3], ['salon', 'cuenta', 'cuenta-55']);
    });

    it('triggers full resync (invalidateAll) on connectivity.restored (ADR-005)', () => {
      let fullInvalidated = false;
      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries() {},
        invalidateAll() {
          fullInvalidated = true;
        },
      };

      const bridge = createMockTridentBridge();
      const invalidator = new EventInvalidator(bridge, cacheHandler);

      invalidator.handleDomainEvent({
        eventType: 'connectivity.restored',
        eventContractVersion: 1,
        entityId: '',
        payload: {},
        timestamp: new Date().toISOString(),
      });

      assert.equal(fullInvalidated, true);
    });

    it('fails closed and invalidates all on unknown major eventContractVersion (ACR-2026-020)', () => {
      let fullInvalidated = false;
      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries() {},
        invalidateAll() {
          fullInvalidated = true;
        },
      };

      const bridge = createMockTridentBridge();
      const invalidator = new EventInvalidator(bridge, cacheHandler);

      invalidator.handleDomainEvent({
        eventType: 'CuentaAbierta',
        eventContractVersion: 99, // Unknown contract version
        entityId: 'cuenta-1',
        payload: {},
        timestamp: new Date().toISOString(),
      });

      assert.equal(fullInvalidated, true);
    });
  });

  describe('Routing & Hash Path Helpers', () => {
    it('extracts initial route cleanly from hash', () => {
      assert.equal(getInitialRouteFromHash(), '/');
    });
  });
});
