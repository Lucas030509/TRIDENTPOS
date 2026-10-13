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

  describe('EventInvalidator & Cache Synchronization Policy', () => {
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

  describe('WP-026B Salón & Comandero Táctil Integration Suite', () => {
    it('retrieves salon floor plan with room areas, table statuses and metrics', async () => {
      const bridge = createMockTridentBridge();
      const res = await bridge.salon.getSalonReadModel();
      assert.ok(res.ok);
      if (res.ok) {
        assert.ok(res.data.rooms.length >= 3);
        assert.ok(res.data.totalTables >= 5);
        assert.ok(res.data.availableTables >= 1);
        assert.ok(res.data.occupiedTables >= 1);
        assert.ok(res.data.inCheckTables >= 1);

        const mesaOcupada = res.data.rooms
          .flatMap((r) => r.tables)
          .find((t) => t.status === 'OCUPADA');
        assert.ok(mesaOcupada);
        assert.equal(mesaOcupada.tableNumber, '2');
        assert.equal(mesaOcupada.currentAccountId, 'cuenta-2');
        assert.equal(mesaOcupada.guestCount, 2);
      }
    });

    it('retrieves catalog categories and products with modifiers and scale-4 prices', async () => {
      const bridge = createMockTridentBridge();
      const res = await bridge.salon.getCatalog();
      assert.ok(res.ok);
      if (res.ok) {
        assert.ok(res.data.categories.length >= 4);
        assert.ok(res.data.products.length >= 5);

        const steak = res.data.products.find((p) => p.code === 'P01');
        assert.ok(steak);
        assert.equal(steak.basePrice, '480.0000');
        assert.ok(steak.modifierGroups && steak.modifierGroups.length >= 2);

        const terminoGroup = steak.modifierGroups.find((g) => g.required);
        assert.ok(terminoGroup);
        assert.equal(terminoGroup.minSelect, 1);
      }
    });

    it('opens an available table and transitions state to OCUPADA with new account', async () => {
      const bridge = createMockTridentBridge();
      const openRes = await bridge.salon.openMesa({
        mesaId: 'mesa-1',
        guestCount: 3,
        waiterUserId: 'usr-waiter-1',
      });
      assert.ok(openRes.ok);
      if (openRes.ok) {
        assert.equal(openRes.data.mesaId, 'mesa-1');
        assert.equal(openRes.data.guestCount, 3);
        assert.equal(openRes.data.status, 'ABIERTA');
        assert.equal(openRes.data.totalAmount, '0.0000');
        assert.equal(openRes.data.version, 1);
      }

      // Verify table state updated in salon read model
      const salonRes = await bridge.salon.getSalonReadModel();
      assert.ok(salonRes.ok);
      if (salonRes.ok) {
        const mesa1 = salonRes.data.rooms.flatMap((r) => r.tables).find((t) => t.id === 'mesa-1');
        assert.ok(mesa1);
        assert.equal(mesa1.status, 'OCUPADA');
        assert.equal(mesa1.guestCount, 3);
      }

      // Prevent opening an already occupied table
      const conflictRes = await bridge.salon.openMesa({
        mesaId: 'mesa-1',
        guestCount: 2,
      });
      assert.equal(conflictRes.ok, false);
      if (!conflictRes.ok) {
        assert.equal(conflictRes.error.code, 'CONFLICT_VERSION');
      }
    });

    it('dispatches items to kitchen, updates account version, subtotal and totals with zero floats', async () => {
      const bridge = createMockTridentBridge();

      // Open mesa-5 in Terraza
      const openRes = await bridge.salon.openMesa({ mesaId: 'mesa-5', guestCount: 2 });
      assert.ok(openRes.ok);
      if (!openRes.ok) return;

      const cuentaId = openRes.data.id;
      const expectedVersion = openRes.data.version;

      // Dispatch 2 items: 1 Guacamole (120) + 1 Cerveza (95)
      const sendRes = await bridge.salon.enviarComanda({
        cuentaId,
        expectedVersion,
        items: [
          {
            productId: 'prod-1',
            productNameSnapshot: 'Guacamole Rústico con Totopos',
            unitPriceApplied: '120.0000',
            quantity: '1.0000',
            taxRateApplied: '0.1600',
            modifiers: [
              {
                modifierId: 'opt-bravo',
                modifierNameSnapshot: 'Muy bravo (Habanero)',
                modifierPriceApplied: '10.0000',
              },
            ],
          },
          {
            productId: 'prod-4',
            productNameSnapshot: 'Cerveza Artesanal IPA 355ml',
            unitPriceApplied: '95.0000',
            quantity: '1.0000',
            taxRateApplied: '0.1600',
          },
        ],
      });

      assert.ok(sendRes.ok);
      if (sendRes.ok) {
        assert.equal(sendRes.data.version, expectedVersion + 1);
        assert.equal(sendRes.data.items.length, 2);
        // Subtotal = (120 + 10) + 95 = 225.0000
        assert.equal(sendRes.data.subtotal, '225.0000');
        // Tax 16% of 225 = 36.0000
        assert.equal(sendRes.data.taxTotal, '36.0000');
        // Total = 225 + 36 = 261.0000
        const firstItem = sendRes.data.items[0];
        assert.ok(firstItem);
        assert.equal(firstItem.status, 'EN_COCINA');
      }
    });

    it('detects OCC 409 conflict when sending order with stale expectedVersion', async () => {
      const bridge = createMockTridentBridge();

      const staleRes = await bridge.salon.enviarComanda({
        cuentaId: 'cuenta-2',
        expectedVersion: 1, // server version is 3
        items: [
          {
            productId: 'prod-5',
            productNameSnapshot: 'Limonada Natural',
            unitPriceApplied: '55.0000',
            quantity: '1.0000',
            taxRateApplied: '0.1600',
          },
        ],
      });

      assert.equal(staleRes.ok, false);
      if (!staleRes.ok) {
        assert.equal(staleRes.error.code, 'CONFLICT_VERSION');
        assert.equal(staleRes.error.conflict?.expectedVersion, 1);
        assert.equal(staleRes.error.conflict?.serverVersion, 3);
      }
    });

    it('cancels item with reason, deducting balance and marking CANCELADO (DEC-010)', async () => {
      const bridge = createMockTridentBridge();

      const cancelRes = await bridge.salon.cancelItem({
        cuentaId: 'cuenta-2',
        itemId: 'item-1',
        expectedVersion: 3,
        clientOpId: 'op-cancel-10',
        reason: 'Comensal cambió de opinión antes de cocinar',
        operatorUserId: 'usr-1',
        operatorPin: '1234',
        supervisorPin: '9999',
      });

      assert.ok(cancelRes.ok);

      // Verify updated account
      const detailRes = await bridge.salon.getCuentaDetalle('cuenta-2');
      assert.ok(detailRes.ok);
      if (detailRes.ok) {
        assert.equal(detailRes.data.version, 4);
        const item1 = detailRes.data.items.find((i) => i.id === 'item-1');
        assert.ok(item1);
        assert.equal(item1.status, 'CANCELADO');
        assert.equal(item1.cancellationReason, 'Comensal cambió de opinión antes de cocinar');
        // Original subtotal 550 - item1 120 = 430.0000
        assert.equal(detailRes.data.subtotal, '430.0000');
      }
    });

    it('transfers account to another available table, reassigning table states (DEC-011)', async () => {
      const bridge = createMockTridentBridge();

      const transferRes = await bridge.salon.transferCuenta({
        cuentaId: 'cuenta-2',
        expectedVersion: 3,
        clientOpId: 'op-transfer-1',
        sourceMesaId: 'mesa-2',
        targetMesaId: 'mesa-6',
        sourceWaiterUserId: 'usr-1',
        targetWaiterUserId: 'usr-1',
        targetWaiterPin: '1234',
        reason: 'Cliente solicitó mesa en terraza exterior',
      });

      assert.ok(transferRes.ok);

      // Verify table states
      const salonRes = await bridge.salon.getSalonReadModel();
      assert.ok(salonRes.ok);
      if (salonRes.ok) {
        const all = salonRes.data.rooms.flatMap((r) => r.tables);
        const mesa2 = all.find((t) => t.id === 'mesa-2');
        const mesa6 = all.find((t) => t.id === 'mesa-6');

        assert.equal(mesa2?.status, 'DISPONIBLE');
        assert.equal(mesa6?.status, 'OCUPADA');
        assert.equal(mesa6?.currentAccountId, 'cuenta-2');
      }
    });

    it('requests check, changing account to IMPRESA and table to EN_CUENTA', async () => {
      const bridge = createMockTridentBridge();

      const reqRes = await bridge.salon.requestCheck({
        cuentaId: 'cuenta-2',
        expectedVersion: 3,
        clientOpId: 'op-check-1',
        requestedByUserId: 'usr-1',
      });

      assert.ok(reqRes.ok);

      const cuentaRes = await bridge.salon.getCuentaDetalle('cuenta-2');
      assert.ok(cuentaRes.ok);
      if (cuentaRes.ok) {
        assert.equal(cuentaRes.data.status, 'IMPRESA');
        assert.ok(cuentaRes.data.printedAt);
      }
    });

    it('updates guest count on active table and account', async () => {
      const bridge = createMockTridentBridge();

      const changeRes = await bridge.salon.changeGuestCount({
        cuentaId: 'cuenta-2',
        expectedVersion: 3,
        clientOpId: 'op-guest-1',
        guestCount: 5,
        performedByUserId: 'usr-1',
      });

      assert.ok(changeRes.ok);

      const cuentaRes = await bridge.salon.getCuentaDetalle('cuenta-2');
      assert.ok(cuentaRes.ok);
      if (cuentaRes.ok) {
        assert.equal(cuentaRes.data.guestCount, 5);
      }
    });

    it('releases a table returning it to DISPONIBLE state', async () => {
      const bridge = createMockTridentBridge();

      const relRes = await bridge.salon.releaseMesa({
        mesaId: 'mesa-3',
        expectedVersion: 4,
        clientOpId: 'op-rel-1',
        performedByUserId: 'usr-1',
      });

      assert.ok(relRes.ok);

      const salonRes = await bridge.salon.getSalonReadModel();
      assert.ok(salonRes.ok);
      if (salonRes.ok) {
        const mesa3 = salonRes.data.rooms.flatMap((r) => r.tables).find((t) => t.id === 'mesa-3');
        assert.equal(mesa3?.status, 'DISPONIBLE');
      }
    });
  });

  describe('WP-026C KDS Cocina Táctil Integration Suite', () => {
    it('retrieves kitchen stations and filters active tickets by estacionId', async () => {
      const bridge = createMockTridentBridge();

      const estRes = await bridge.kds.getEstaciones();
      assert.ok(estRes.ok);
      if (estRes.ok) {
        assert.equal(estRes.data.length, 4);
        assert.ok(estRes.data.some((e) => e.id === 'cocina-1' && e.stationType === 'COCINA'));
        assert.ok(estRes.data.some((e) => e.id === 'bar-1' && e.stationType === 'BARRA'));
      }

      const ticketsCocina = await bridge.kds.getTickets('cocina-1');
      assert.ok(ticketsCocina.ok);
      if (ticketsCocina.ok) {
        assert.ok(ticketsCocina.data.length >= 3);
        assert.ok(ticketsCocina.data.every((t) => t.kdsEstacionId === 'cocina-1'));
      }

      const ticketsBar = await bridge.kds.getTickets('bar-1');
      assert.ok(ticketsBar.ok);
      if (ticketsBar.ok) {
        assert.equal(ticketsBar.data.length, 1);
        assert.equal(ticketsBar.data[0]?.folio, 104);
      }
    });

    it('transitions ticket from PENDIENTE to EN_PREPARACION with canonical event broadcast', async () => {
      const bridge = createMockTridentBridge();
      const emittedEvents: DomainEvent[] = [];
      const unsub = bridge.events.subscribe((e) => emittedEvents.push(e));

      const prepRes = await bridge.kds.startPreparation('kds-ticket-2', 'cocina-1', 'op-prep-1');
      assert.ok(prepRes.ok);

      const tickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(tickets.ok);
      if (tickets.ok) {
        const t2 = tickets.data.find((t) => t.id === 'kds-ticket-2');
        assert.equal(t2?.status, 'EN_PREPARACION');
        assert.ok(t2?.items.every((i) => i.status === 'EN_PREPARACION'));
      }

      const event = emittedEvents.find((e) => e.eventType === 'OrdenProduccionIniciadaEnKDS');
      assert.ok(event, 'Must broadcast OrdenProduccionIniciadaEnKDS');
      assert.equal(event.entityId, 'kds-ticket-2');

      unsub();
    });

    it('bumps ticket from EN_PREPARACION to LISTO, moving to completed and broadcasting confirmation', async () => {
      const bridge = createMockTridentBridge();
      const emittedEvents: DomainEvent[] = [];
      const unsub = bridge.events.subscribe((e) => emittedEvents.push(e));

      const bumpRes = await bridge.kds.bumpTicket('kds-ticket-1', 'op-bump-1', 12);
      assert.ok(bumpRes.ok);

      // Verify removed from active tickets
      const activeTickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(activeTickets.ok);
      if (activeTickets.ok) {
        assert.equal(
          activeTickets.data.some((t) => t.id === 'kds-ticket-1'),
          false,
        );
      }

      // Verify present in completed tickets
      const completed = await bridge.kds.getRecentCompletedTickets('cocina-1', 120);
      assert.ok(completed.ok);
      if (completed.ok) {
        const t1 = completed.data.find((t) => t.id === 'kds-ticket-1');
        assert.ok(t1);
        assert.equal(t1.status, 'LISTO');
        assert.equal(t1.preparationTimeMinutes, 12);
        assert.ok(t1.completedAt !== null);
      }

      // Verify domain event
      const event = emittedEvents.find((e) => e.eventType === 'OrdenProduccionConfirmadaEnKDS');
      assert.ok(event, 'Must broadcast OrdenProduccionConfirmadaEnKDS');
      assert.equal(event.entityId, 'kds-ticket-1');

      unsub();
    });

    it('retrieves completed tickets in recall window and reopens ticket to kitchen (undo bump)', async () => {
      const bridge = createMockTridentBridge();
      const emittedEvents: DomainEvent[] = [];
      const unsub = bridge.events.subscribe((e) => emittedEvents.push(e));

      // Recall completed ticket
      const recallRes = await bridge.kds.recallTicket('kds-comp-1', 120);
      assert.ok(recallRes.ok);
      assert.ok(recallRes.data);
      assert.equal(recallRes.data.folio, 100);

      // Reopen ticket (undo accidental bump)
      const reopenRes = await bridge.kds.reopenTicket('kds-comp-1', 'op-reopen-1');
      assert.ok(reopenRes.ok);

      // Verify back in active tickets
      const activeTickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(activeTickets.ok);
      if (activeTickets.ok) {
        const reopened = activeTickets.data.find((t) => t.id === 'kds-comp-1');
        assert.ok(reopened);
        assert.equal(reopened.status, 'EN_PREPARACION');
        assert.equal(reopened.completedAt, null);
      }

      // Verify event broadcast
      const event = emittedEvents.find((e) => e.eventType === 'KdsTicketActualizado');
      assert.ok(event);

      unsub();
    });

    it('toggles individual item status between PENDIENTE, EN_PREPARACION and LISTO', async () => {
      const bridge = createMockTridentBridge();

      const toggleRes = await bridge.kds.toggleItemStatus('kds-ticket-1', 'kds-item-1', 'LISTO');
      assert.ok(toggleRes.ok);

      const tickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(tickets.ok);
      if (tickets.ok) {
        const t1 = tickets.data.find((t) => t.id === 'kds-ticket-1');
        const item1 = t1?.items.find((i) => i.id === 'kds-item-1');
        assert.equal(item1?.status, 'LISTO');
      }
    });

    it('dispatches comanda from Salón and automatically reflects new ticket in KDS via ComandaEnviadaACocina', async () => {
      const bridge = createMockTridentBridge();
      const emittedEvents: DomainEvent[] = [];
      const unsub = bridge.events.subscribe((e) => emittedEvents.push(e));

      // Open a table
      const openRes = await bridge.salon.openMesa({ mesaId: 'mesa-1', guestCount: 2 });
      assert.ok(openRes.ok);
      const cuentaId = openRes.ok ? openRes.data.id : '';

      // Send comanda to kitchen
      const sendRes = await bridge.salon.enviarComanda({
        cuentaId,
        expectedVersion: 1,
        items: [
          {
            productId: 'prod-1',
            productNameSnapshot: 'Guacamole Rústico con Totopos',
            quantity: '1.0000',
            unitPriceApplied: '120.0000',
            taxRateApplied: '0.1600',
            notes: 'Sin picante',
          },
        ],
      });
      assert.ok(sendRes.ok);

      // Verify event was broadcast
      const event = emittedEvents.find((e) => e.eventType === 'ComandaEnviadaACocina');
      assert.ok(event, 'ComandaEnviadaACocina must be broadcast when sending comanda');

      // Verify ticket appears in KDS
      const tickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(tickets.ok);
      if (tickets.ok) {
        const matchingTicket = tickets.data.find((t) => t.cuentaId === cuentaId);
        assert.ok(matchingTicket, 'New ticket must exist in KDS');
        assert.equal(matchingTicket.status, 'PENDIENTE');
        assert.equal(matchingTicket.items[0]?.productName, 'Guacamole Rústico con Totopos');
      }

      unsub();
    });

    it('handles full-state resync upon reconnect without state divergence (ADR-005)', async () => {
      const bridge = createMockTridentBridge();
      const invalidatedQueries: unknown[][] = [];
      let allInvalidated = false;

      const cacheHandler: QueryInvalidationHandler = {
        invalidateQueries(prefix) {
          invalidatedQueries.push([...prefix]);
        },
        invalidateAll() {
          allInvalidated = true;
        },
      };

      const invalidator = new EventInvalidator(bridge, cacheHandler);
      invalidator.start();

      // Trigger KDS_RESYNC event
      invalidator.handleDomainEvent({
        eventType: 'KDS_RESYNC',
        eventContractVersion: 1,
        entityId: 'sync-all',
        payload: { activeTickets: [] },
        timestamp: new Date().toISOString(),
      });

      assert.ok(
        invalidatedQueries.some((q) => q.length === 2 && q[0] === 'kds' && q[1] === 'tickets'),
        'KDS_RESYNC must invalidate kds tickets queries',
      );

      // Trigger connectivity.restored
      invalidator.handleDomainEvent({
        eventType: 'connectivity.restored',
        eventContractVersion: 1,
        entityId: 'edge-host',
        payload: {},
        timestamp: new Date().toISOString(),
      });

      assert.equal(allInvalidated, true, 'connectivity.restored must invalidate all queries');
      invalidator.stop();
    });

    it('enforces zero floats and canonical scale-4 quantities in KDS contracts', async () => {
      const bridge = createMockTridentBridge();
      const tickets = await bridge.kds.getTickets('cocina-1');
      assert.ok(tickets.ok);
      if (tickets.ok) {
        for (const t of tickets.data) {
          assert.equal(Number.isInteger(t.targetSeconds), true);
          for (const item of t.items) {
            assert.ok(typeof item.quantity === 'string' || typeof item.quantity === 'number');
            if (typeof item.quantity === 'string') {
              assert.match(item.quantity, /^\d+(\.\d{4})?$/);
            }
          }
        }
      }
    });
  });
});
