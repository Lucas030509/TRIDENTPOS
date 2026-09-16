import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KdsDomainService,
  DomainError,
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
    return this.tickets.get(id) ?? null;
  }

  saveTicket(ticket: KdsTicket): KdsTicket {
    this.tickets.set(ticket.id, { ...ticket });
    return { ...ticket };
  }

  listActiveTicketsByEstacion(kdsEstacionId: string): readonly KdsTicket[] {
    return Array.from(this.tickets.values()).filter(
      (t) => t.kdsEstacionId === kdsEstacionId && t.status !== 'ENTREGADO',
    );
  }

  listTicketsForRecall(kdsEstacionId: string, _windowMinutes: number): readonly KdsTicket[] {
    return Array.from(this.tickets.values()).filter((t) => t.kdsEstacionId === kdsEstacionId);
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

describe('TRIDENTPOS WP-015: KdsDomainService', () => {
  it('WP015-T01: enviarComandaACocina creates a PENDIENTE ticket and emits ComandaEnviadaACocina', () => {
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
          quantity: '2.0000',
        },
      ],
    });

    assert.equal(ticket.status, 'PENDIENTE');
    assert.equal(ticket.printStatus, 'PENDING');
    assert.equal(ticket.partidas.length, 1);
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
        { id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' },
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

  it('WP015-T04: full lifecycle iniciarPreparacion -> confirmarOrdenSurtida emits both events in order', () => {
    const repo = new InMemoryKdsRepo();
    repo.addEstacion(COCINA);
    const publisher = new RecordingPublisher();
    const service = new KdsDomainService({ kdsRepo: repo, eventPublisher: publisher });

    const ticket = service.enviarComandaACocina({
      id: 'ticket-2',
      cuentaId: 'cuenta-2',
      mesaReference: 'Mesa 2',
      kdsEstacionId: COCINA.id,
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
    });

    const started = service.iniciarPreparacionOrden(ticket.id, COCINA.id);
    assert.equal(started.status, 'EN_PREPARACION');
    assert.equal(started.partidas[0]?.status, 'EN_PREPARACION');

    const confirmed = service.confirmarOrdenSurtida(ticket.id, COCINA.id, 8);
    assert.equal(confirmed.status, 'LISTO');
    assert.ok(confirmed.completedAt);

    assert.deepEqual(
      publisher.events.map((e) => e.type),
      ['ComandaEnviadaACocina', 'OrdenProduccionIniciadaEnKDS', 'OrdenProduccionConfirmadaEnKDS'],
    );
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
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
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
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
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
      items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
    });
    service.enviarComandaACocina({
      id: 'ticket-6',
      cuentaId: 'cuenta-6',
      mesaReference: 'Mesa 6',
      kdsEstacionId: barra.id,
      items: [{ id: 'p2', productId: 'prod-2', productNameSnapshot: 'Bebida', quantity: '1.0000' }],
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
          items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
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
          items: [{ id: 'p1', productId: 'prod-1', productNameSnapshot: 'Item', quantity: '1.0000' }],
        }),
      (err: unknown) => err instanceof DomainError && err.code === 'KDS_ESTACION_INACTIVE',
    );
  });
});
