import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KdsDomainService,
  DomainError,
  mapKdsTicketToWire,
  parseComandaWireItem,
  type KdsEstacion,
  type KdsRepositoryPort,
  type KdsEventPublisherPort,
  type KdsTicket,
  type KdsDomainEvent,
} from './index.js';

class InMemoryKdsRepo implements KdsRepositoryPort {
  private estaciones = new Map<string, KdsEstacion>();
  private tickets = new Map<string, KdsTicket>();

  addEstacion(estacion: KdsEstacion): void {
    this.estaciones.set(estacion.id, estacion);
  }

  getEstacionById(id: string): KdsEstacion | null {
    return this.estaciones.get(id) ?? null;
  }

  listEstaciones(): readonly KdsEstacion[] {
    return Array.from(this.estaciones.values());
  }

  getTicketById(id: string): KdsTicket | null {
    const t = this.tickets.get(id);
    return t ? { ...t, partidas: t.partidas.map((p) => ({ ...p })) } : null;
  }

  saveTicket(ticket: KdsTicket): KdsTicket {
    const cloned: KdsTicket = { ...ticket, partidas: ticket.partidas.map((p) => ({ ...p })) };
    this.tickets.set(ticket.id, cloned);
    return { ...cloned, partidas: cloned.partidas.map((p) => ({ ...p })) };
  }

  listActiveTicketsByEstacion(kdsEstacionId: string): readonly KdsTicket[] {
    return Array.from(this.tickets.values())
      .filter((t) => t.kdsEstacionId === kdsEstacionId && t.status !== 'ENTREGADO')
      .map((t) => ({ ...t, partidas: t.partidas.map((p) => ({ ...p })) }));
  }

  getTicketForRecall(ordenProduccionId: string, windowMinutes: number): KdsTicket | null {
    const t = this.tickets.get(ordenProduccionId);
    if (!t || !t.completedAt) {
      return null;
    }
    const completedEpoch = Date.parse(t.completedAt);
    if (Number.isNaN(completedEpoch)) {
      return null;
    }
    const now = Date.now();
    const elapsedMinutes = (now - completedEpoch) / 60_000;
    if (elapsedMinutes < 0 || elapsedMinutes > windowMinutes) {
      return null;
    }
    return { ...t, partidas: t.partidas.map((p) => ({ ...p })) };
  }
}

class RecordingPublisher implements KdsEventPublisherPort {
  public events: KdsDomainEvent[] = [];
  publishTicketEvent(event: KdsDomainEvent): void {
    this.events.push(event);
  }
}

const COCINA: KdsEstacion = {
  id: 'estacion-cocina-1',
  name: 'Cocina Principal',
  stationType: 'COCINA',
  status: 'ACTIVA',
  createdAt: new Date().toISOString(),
};

describe('TRIDENTPOS WP-015 / ACR-2026-016: KdsDomainService', () => {
  it('WP015-T01: enviarComandaACocina creates a PENDIENTE ticket with bigint quantity and emits ComandaEnviadaACocina', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const publisher = new RecordingPublisher();
    const service = new KdsDomainService({ kdsRepo: repo, eventPublisher: publisher });

    const ticket = service.enviarComandaACocina({
      id: 'ticket-1',
      cuentaId: 'cuenta-1',
      mesaReference: 'Mesa 5',
      kdsEstacionId: COCINA.id,
      items: [
        {
          id: 'partida-1',
          productId: 'prod-1',
          productNameSnapshot: 'Tacos al Pastor',
          quantity: 20000n, // 2.0000 authoritative bigint
        },
      ],
    });

    assert.equal(ticket.status, 'PENDIENTE');
    assert.equal(ticket.printStatus, 'PENDING');
    assert.equal(ticket.preparationTimeMinutes, null);
    assert.equal(ticket.partidas.length, 1);
    assert.equal(typeof ticket.partidas[0]?.quantity, 'bigint');
    assert.equal(ticket.partidas[0]?.quantity, 20000n);
    assert.equal(publisher.events.length, 1);
    assert.equal(publisher.events[0]?.type, 'ComandaEnviadaACocina');
  });

  it('WP015-T02: enviarComandaACocina rejects duplicate ticket id', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    const input = {
      id: 'ticket-dup',
      cuentaId: 'cuenta-1',
      mesaReference: 'Mesa 1',
      kdsEstacionId: COCINA.id,
      items: [
        { id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n },
      ],
    };
    service.enviarComandaACocina(input);
    assert.throws(() => service.enviarComandaACocina(input), DomainError);
  });

  it('WP015-T03: enviarComandaACocina rejects empty comanda', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 'ticket-empty',
          cuentaId: 'cuenta-1',
          mesaReference: 'Mesa 1',
          kdsEstacionId: COCINA.id,
          items: [],
        }),
      DomainError,
    );
  });

  it('WP015-T04: full lifecycle iniciarPreparacion -> confirmarOrdenSurtida emits discriminated events with explicit fields', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const publisher = new RecordingPublisher();
    const service = new KdsDomainService({ kdsRepo: repo, eventPublisher: publisher });

    const ticket = service.enviarComandaACocina({
      id: 'ticket-2',
      cuentaId: 'cuenta-2',
      mesaReference: 'Mesa 2',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
    });

    const started = service.iniciarPreparacionOrden(ticket.id, COCINA.id);
    assert.equal(started.status, 'EN_PREPARACION');
    assert.equal(started.partidas[0]?.status, 'EN_PREPARACION');

    const confirmed = service.confirmarOrdenSurtida(ticket.id, COCINA.id, 8);
    assert.equal(confirmed.status, 'LISTO');
    assert.equal(confirmed.preparationTimeMinutes, 8);
    assert.ok(confirmed.completedAt);

    assert.deepEqual(
      publisher.events.map((e) => e.type),
      ['ComandaEnviadaACocina', 'OrdenProduccionIniciadaEnKDS', 'OrdenProduccionConfirmadaEnKDS'],
    );
    const confirmedEvent = publisher.events[2];
    assert.equal(confirmedEvent?.type, 'OrdenProduccionConfirmadaEnKDS');
    if (confirmedEvent?.type === 'OrdenProduccionConfirmadaEnKDS') {
      assert.equal(confirmedEvent.ordenProduccionId, ticket.id);
      assert.equal(confirmedEvent.completedAt, confirmed.completedAt);
      assert.equal(confirmedEvent.tiempoPreparacionMinutos, 8);
      assert.equal(confirmedEvent.ticket.preparationTimeMinutes, 8);
    }
  });

  it('WP015-T05: iniciarPreparacionOrden rejects wrong estacion (KDS_ESTACION_MISMATCH)', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    repo.addEstacion({ ...COCINA, id: 'estacion-barra-1', stationType: 'BARRA', name: 'Barra' });
    const service = new KdsDomainService({ kdsRepo: repo });

    const ticket = service.enviarComandaACocina({
      id: 'ticket-3',
      cuentaId: 'cuenta-3',
      mesaReference: 'Mesa 3',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
    });

    assert.throws(
      () => service.iniciarPreparacionOrden(ticket.id, 'estacion-barra-1'),
      (err: unknown) => err instanceof DomainError && err.code === 'KDS_ESTACION_MISMATCH',
    );
  });

  it('WP015-T06: confirmarOrdenSurtida rejects out-of-order transition (PENDIENTE -> LISTO)', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    const ticket = service.enviarComandaACocina({
      id: 'ticket-4',
      cuentaId: 'cuenta-4',
      mesaReference: 'Mesa 4',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
    });

    assert.throws(
      () => service.confirmarOrdenSurtida(ticket.id, COCINA.id, 5),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_KDS_TICKET_STATUS',
    );
  });

  it('WP015-T07: consultarOrdenesActivas returns only tickets for the requested estacion', () => {
    const repo = new InMemoryKdsRepo();
    const barra: KdsEstacion = { ...COCINA, id: 'estacion-barra-2', stationType: 'BARRA', name: 'Barra' };
    repo.addEstacion(COCINA);
    repo.addEstacion(barra);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ticket-5',
      cuentaId: 'cuenta-5',
      mesaReference: 'Mesa 5',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
    });
    service.enviarComandaACocina({
      id: 'ticket-6',
      cuentaId: 'cuenta-6',
      mesaReference: 'Mesa 6',
      kdsEstacionId: barra.id,
      items: [{ id: 'p2', productId: 'prod-2', productNameSnapshot: 'Bebida', quantity: 10000n }],
    });

    const activeCocina = service.consultarOrdenesActivas(COCINA.id);
    assert.equal(activeCocina.length, 1);
    assert.equal(activeCocina[0]?.id, 'ticket-5');
  });

  it('WP015-T08: enviarComandaACocina rejects unknown estacion', () => {
    const repo = new InMemoryKdsRepo();
    const service = new KdsDomainService({ kdsRepo: repo });

    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 'ticket-7',
          cuentaId: 'cuenta-7',
          mesaReference: 'Mesa 7',
          kdsEstacionId: 'unknown-estacion',
          items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'KDS_ESTACION_NOT_FOUND',
    );
  });

  it('WP015-T09: enviarComandaACocina rejects INACTIVA estacion', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion({ ...COCINA, id: 'estacion-inactiva', status: 'INACTIVA' });
    const service = new KdsDomainService({ kdsRepo: repo });

    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 'ticket-8',
          cuentaId: 'cuenta-8',
          mesaReference: 'Mesa 8',
          kdsEstacionId: 'estacion-inactiva',
          items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: 10000n }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'KDS_ESTACION_INACTIVE',
    );
  });

  // ==========================================
  // ACR-2026-016: PREPARATION TIME TESTS
  // ==========================================

  it('WP015-R2-01: preparation time allows valid zero minutes and persists it', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ticket-prep-0',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Agua', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ticket-prep-0', COCINA.id);
    const confirmed = service.confirmarOrdenSurtida('ticket-prep-0', COCINA.id, 0);

    assert.equal(confirmed.preparationTimeMinutes, 0);
    const reloaded = repo.getTicketById('ticket-prep-0');
    assert.equal(reloaded?.preparationTimeMinutes, 0);
  });

  it('WP015-R2-02: preparation time rejects negative integers and non-integers', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ticket-prep-invalid',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Taco', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ticket-prep-invalid', COCINA.id);

    assert.throws(
      () => service.confirmarOrdenSurtida('ticket-prep-invalid', COCINA.id, -1),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_PREPARATION_TIME',
    );
    assert.throws(
      () => service.confirmarOrdenSurtida('ticket-prep-invalid', COCINA.id, 5.5),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_PREPARATION_TIME',
    );
    assert.throws(
      () => service.confirmarOrdenSurtida('ticket-prep-invalid', COCINA.id, NaN),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_PREPARATION_TIME',
    );
  });

  // ==========================================
  // ACR-2026-016: RECALL CONTRACT TESTS
  // ==========================================

  it('WP015-R1-01: recuperarOrdenRecall returns exact completed ticket within window', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ord-recall-1',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Taco', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ord-recall-1', COCINA.id);
    service.confirmarOrdenSurtida('ord-recall-1', COCINA.id, 10);

    const recalled = service.recuperarOrdenRecall('ord-recall-1', 120);
    assert.ok(recalled);
    assert.equal(recalled?.id, 'ord-recall-1');
    assert.equal(recalled?.status, 'LISTO');
    assert.equal(recalled?.preparationTimeMinutes, 10);
  });

  it('WP015-R1-02: recuperarOrdenRecall returns null for ticket outside recall window', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    const ticket: KdsTicket = {
      id: 'ord-recall-expired',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      urgencyLevel: 'NORMAL',
      status: 'LISTO',
      printStatus: 'PRINTED',
      printAttempts: 1,
      printerId: null,
      lastPrintError: null,
      aggregateSequenceNumber: 1,
      createdAt: new Date(Date.now() - 300 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 200 * 60_000).toISOString(),
      completedAt: new Date(Date.now() - 200 * 60_000).toISOString(), // completed 200 min ago
      preparationTimeMinutes: 12,
      partidas: [],
    };
    repo.saveTicket(ticket);

    const recalled = service.recuperarOrdenRecall('ord-recall-expired', 120); // 120 min max window
    assert.equal(recalled, null);
  });

  it('WP015-R1-03: recuperarOrdenRecall returns null for non-existent order id or incomplete order', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ord-in-prep',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Taco', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ord-in-prep', COCINA.id);

    // Incomplete order (completedAt is null)
    assert.equal(service.recuperarOrdenRecall('ord-in-prep', 120), null);
    // Non-existent order
    assert.equal(service.recuperarOrdenRecall('ord-nonexistent', 120), null);
  });

  it('WP015-R1-04: recuperarOrdenRecall is strictly non-mutating', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ord-recall-immut',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Taco', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ord-recall-immut', COCINA.id);
    service.confirmarOrdenSurtida('ord-recall-immut', COCINA.id, 7);

    const before = repo.getTicketById('ord-recall-immut');
    service.recuperarOrdenRecall('ord-recall-immut', 120);
    const after = repo.getTicketById('ord-recall-immut');

    assert.deepEqual(before, after);
  });

  it('WP015-R1-05: station identity cannot substitute ordenProduccionId in recall', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    service.enviarComandaACocina({
      id: 'ord-ticket-actual-id',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Taco', quantity: 10000n }],
    });
    service.iniciarPreparacionOrden('ord-ticket-actual-id', COCINA.id);
    service.confirmarOrdenSurtida('ord-ticket-actual-id', COCINA.id, 7);

    // Querying with station ID should return null, not a list or ticket
    assert.equal(service.recuperarOrdenRecall(COCINA.id, 120), null);
  });

  // ==========================================
  // ACR-2026-016: QUANTITY DOMAIN & WIRE TESTS (ADR-012)
  // ==========================================

  it('WP015-R3-01: domain quantity is strictly bigint and maps to canonical wire decimal strings', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    // Prove domain representation: 1.5000 -> 15000n, 0.1250 -> 1250n, 12.3456 -> 123456n
    const item1 = parseComandaWireItem({
      id: 'p1',
      productId: 'pr1',
      productNameSnapshot: 'Kg Carne',
      quantity: '1.5000',
    });
    const item2 = parseComandaWireItem({
      id: 'p2',
      productId: 'pr2',
      productNameSnapshot: 'Fractional',
      quantity: '0.1250',
    });
    const item3 = parseComandaWireItem({
      id: 'p3',
      productId: 'pr3',
      productNameSnapshot: 'Precise',
      quantity: '12.3456',
    });

    assert.equal(item1.quantity, 15000n);
    assert.equal(item2.quantity, 1250n);
    assert.equal(item3.quantity, 123456n);

    const ticket = service.enviarComandaACocina({
      id: 'ticket-quantities',
      cuentaId: 'c1',
      mesaReference: 'M1',
      kdsEstacionId: COCINA.id,
      items: [item1, item2, item3],
    });

    assert.equal(ticket.partidas[0]?.quantity, 15000n);
    assert.equal(ticket.partidas[1]?.quantity, 1250n);
    assert.equal(ticket.partidas[2]?.quantity, 123456n);

    // Wire serialization maps bigint back to canonical decimal string
    const wire = mapKdsTicketToWire(ticket);
    assert.equal(wire.partidas[0]?.quantity, '1.5000');
    assert.equal(wire.partidas[1]?.quantity, '0.1250');
    assert.equal(wire.partidas[2]?.quantity, '12.3456');
  });

  it('WP015-R3-02: quantity rejects non-bigint, zero, or negative domain values', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const service = new KdsDomainService({ kdsRepo: repo });

    // Zero quantity
    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 't-zero',
          cuentaId: 'c1',
          mesaReference: 'M1',
          kdsEstacionId: COCINA.id,
          items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Item', quantity: 0n }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_QUANTITY',
    );

    // Negative quantity
    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 't-neg',
          cuentaId: 'c1',
          mesaReference: 'M1',
          kdsEstacionId: COCINA.id,
          items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Item', quantity: -10000n }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_QUANTITY',
    );

    // Non-bigint (e.g. number or string passed directly to domain method)
    assert.throws(
      () =>
        service.enviarComandaACocina({
          id: 't-num',
          cuentaId: 'c1',
          mesaReference: 'M1',
          kdsEstacionId: COCINA.id,
          // @ts-expect-error test non-bigint runtime rejection
          items: [{ id: 'p1', productId: 'pr1', productNameSnapshot: 'Item', quantity: 1.5 }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'INVALID_QUANTITY',
    );
  });
});
