import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { WebSocket } from 'ws';

import { EdgeDatabaseService } from '@trident/edge';
import { createKdsRuntime, type KdsRuntime } from './index.js';
import { SqliteKdsRepository } from './kds-sqlite-repository.js';
import { PrinterQueueRunner } from './printer-queue-runner.js';

/**
 * Connects and immediately starts buffering every incoming message from
 * socket creation time -- the server may push a frame (e.g. KDS_RESYNC)
 * synchronously within the same tick as the 'open' event, which would race
 * (and lose messages against) a listener attached only after `await`ing
 * connection open.
 */
class BufferingClient {
  public readonly ws: WebSocket;
  readonly #queue: Record<string, unknown>[] = [];
  readonly #waiters: Array<(msg: Record<string, unknown>) => void> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = this.#waiters.shift();
      if (waiter) {
        waiter(parsed);
      } else {
        this.#queue.push(parsed);
      }
    });
  }

  static connect(port: number, wsPath = '/kds/events'): Promise<BufferingClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
      const client = new BufferingClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  public next(): Promise<Record<string, unknown>> {
    const queued = this.#queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  public close(): void {
    this.ws.close();
  }
}

describe('TRIDENTPOS WP-015 / ACR-2026-016: KDS Runtime Integration Suite', () => {
  let tempDir: string;
  let edgeDb: EdgeDatabaseService;
  let runtime: KdsRuntime;
  const COCINA_ID = 'estacion-cocina-integ';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp015-test-'));
    const dbPath = path.join(tempDir, 'kds-edge.db');
    edgeDb = new EdgeDatabaseService({ databasePath: dbPath });

    runtime = createKdsRuntime({
      edgeDb,
      wsPort: 0,
      authenticateStation: () => true,
    });
    runtime.repo.createEstacion({ id: COCINA_ID, name: 'Cocina Integracion', stationType: 'COCINA' });
    await runtime.dispatcher.whenListening();
  });

  after(async () => {
    await runtime.dispatcher.close();
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('WP015-T23 (end-to-end LAN broadcast & SQLite storage): enviarComandaACocina reaches KDS station and stores scale-4 integers', async () => {
    const port = runtime.dispatcher.getPort();
    const client = await BufferingClient.connect(port);

    const resync = await client.next(); // the KDS_RESYNC frame sent on connect
    assert.equal(resync.type, 'KDS_RESYNC');

    const ticket = runtime.service.enviarComandaACocina({
      id: 'ticket-integ-1',
      cuentaId: 'cuenta-integ-1',
      mesaReference: 'Mesa 9',
      kdsEstacionId: COCINA_ID,
      items: [
        { id: 'partida-integ-1', productId: 'prod-1', productNameSnapshot: 'Enchiladas', quantity: 15000n },
      ],
    });

    const received = await client.next();
    assert.equal(received.type, 'ComandaEnviadaACocina');
    const payload = received.payload as { ticket: { id: string; partidas: Array<{ quantity: string }> } };
    assert.equal(payload.ticket.id, ticket.id);
    assert.equal(payload.ticket.partidas[0]?.quantity, '1.5000'); // Wire DTO has canonical decimal string

    // Persisted through the composition root's SQLite repository, not just in-memory.
    const reloaded = runtime.repo.getTicketById(ticket.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.printStatus, 'PENDING');
    assert.equal(reloaded?.preparationTimeMinutes, null);
    assert.equal(typeof reloaded?.partidas[0]?.quantity, 'bigint');
    assert.equal(reloaded?.partidas[0]?.quantity, 15000n);

    // Direct SQLite raw column inspection: verify quantity is stored as integer scale-4 (15000)
    const rawPartida = edgeDb.queryRow<{ quantity: number | bigint }>(
      `SELECT quantity FROM kds_ticket_partidas WHERE id = ?;`,
      'partida-integ-1',
    );
    assert.equal(Number(rawPartida?.quantity), 15000);

    client.close();
  });

  it('WP015-T24 (printer disconnect / network unreachable test, queue survives): failed print stays queued and records failure', async () => {
    const printer = runtime.repo.createPrinter({
      id: 'printer-unreachable',
      name: 'Cocina Impresora',
      host: '127.0.0.1',
      port: 41, // reserved/unassigned port -- guaranteed refused, no server needed
      kdsEstacionId: COCINA_ID,
    });

    const ticket = runtime.service.enviarComandaACocina({
      id: 'ticket-integ-2',
      cuentaId: 'cuenta-integ-2',
      mesaReference: 'Mesa 10',
      kdsEstacionId: COCINA_ID,
      items: [{ id: 'partida-integ-2', productId: 'prod-2', productNameSnapshot: 'Sopa', quantity: 10000n }],
    });
    runtime.repo.assignPrinterToTicket(ticket.id, printer.id);

    assert.equal(ticket.status, 'PENDIENTE');

    const runner = new PrinterQueueRunner({ printerRepo: runtime.repo, maxAttempts: 5, connectTimeoutMs: 1000 });
    const results = await runner.runPendingQueueOnce();
    const thisResult = results.find((r) => r.ticketId === ticket.id);
    assert.ok(thisResult);
    assert.equal(thisResult?.outcome, 'FAILED');

    const afterAttempt = runtime.repo.getTicketById(ticket.id);
    assert.equal(afterAttempt?.printStatus, 'QUEUED'); // still eligible for retry, not silently dropped
    assert.equal(afterAttempt?.printAttempts, 1);
    assert.ok(afterAttempt?.lastPrintError);

    const printerAfter = runtime.repo.getPrinterById(printer.id);
    assert.equal(printerAfter?.status, 'OFFLINE');
  });

  it('WP015-T25 (paper-out / mid-print failure simulation with retry-to-success): retries succeed once printer recovers', async () => {
    let connectionCount = 0;
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        socket.on('data', () => (socket.resetAndDestroy ? socket.resetAndDestroy() : socket.destroy()));
        return;
      }
      socket.on('data', (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const printer = runtime.repo.createPrinter({
      id: 'printer-flaky',
      name: 'Impresora Intermitente',
      host: '127.0.0.1',
      port,
      kdsEstacionId: COCINA_ID,
    });

    try {
      const ticket = runtime.service.enviarComandaACocina({
        id: 'ticket-integ-3',
        cuentaId: 'cuenta-integ-3',
        mesaReference: 'Mesa 11',
        kdsEstacionId: COCINA_ID,
        items: [{ id: 'partida-integ-3', productId: 'prod-3', productNameSnapshot: 'Agua', quantity: 20000n }],
      });
      runtime.repo.assignPrinterToTicket(ticket.id, printer.id);

      const runner = new PrinterQueueRunner({ printerRepo: runtime.repo, connectTimeoutMs: 1000, writeTimeoutMs: 1000 });

      const firstPass = await runner.runPendingQueueOnce();
      const first = firstPass.find((r) => r.ticketId === ticket.id);
      assert.equal(first?.outcome, 'FAILED');
      assert.equal(runtime.repo.getTicketById(ticket.id)?.printStatus, 'QUEUED');

      const secondPass = await runner.runPendingQueueOnce();
      const second = secondPass.find((r) => r.ticketId === ticket.id);
      assert.equal(second?.outcome, 'PRINTED');

      const finalTicket = runtime.repo.getTicketById(ticket.id);
      assert.equal(finalTicket?.printStatus, 'PRINTED');
      assert.equal(finalTicket?.printAttempts, 2);
      assert.ok(Buffer.concat(received).length > 0, 'expected the recovered printer to actually receive ESC/POS bytes');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('WP015-T26 (queue persistence / restart-recovery test): FAILED print jobs survive an Edge database close+reopen', async () => {
    const dbPath = path.join(tempDir, 'restart-recovery.db');
    let db1: EdgeDatabaseService | undefined;
    try {
      db1 = new EdgeDatabaseService({ databasePath: dbPath });
      const repo1 = new SqliteKdsRepository(db1);
      repo1.createEstacion({ id: 'estacion-restart', name: 'Cocina Restart', stationType: 'COCINA' });
      repo1.createPrinter({ id: 'printer-restart', name: 'Printer Restart', host: '127.0.0.1', port: 41, kdsEstacionId: 'estacion-restart' });

      const runtime1 = createKdsRuntime({ edgeDb: db1, wsPort: 0, authenticateStation: () => true });
      await runtime1.dispatcher.whenListening();

      const ticket = runtime1.service.enviarComandaACocina({
        id: 'ticket-restart-1',
        cuentaId: 'cuenta-restart-1',
        mesaReference: 'Mesa 12',
        kdsEstacionId: 'estacion-restart',
        items: [{ id: 'partida-restart-1', productId: 'prod-4', productNameSnapshot: 'Cafe', quantity: 10000n }],
      });

      const runner1 = new PrinterQueueRunner({ printerRepo: runtime1.repo, connectTimeoutMs: 500 });
      const result = await runner1.runPendingQueueOnce();
      assert.equal(result.find((r) => r.ticketId === ticket.id)?.outcome, 'FAILED');
      assert.equal(runtime1.repo.getTicketById(ticket.id)?.printStatus, 'QUEUED');

      await runtime1.dispatcher.close();
      db1.close();
      db1 = undefined;

      // Reopen a fresh service instance against the SAME on-disk database file.
      const db2 = new EdgeDatabaseService({ databasePath: dbPath });
      try {
        const repo2 = new SqliteKdsRepository(db2);
        const reloadedTicket = repo2.getTicketById(ticket.id);
        assert.ok(reloadedTicket, 'expected the queued print job to survive process restart');
        assert.equal(reloadedTicket?.printStatus, 'QUEUED');
        assert.equal(reloadedTicket?.printAttempts, 1);

        const pending = repo2.listPendingPrintJobs();
        assert.ok(pending.some((t) => t.id === ticket.id), 'ticket must remain enqueued for retry after restart');
      } finally {
        db2.close();
      }
    } finally {
      db1?.close();
    }
  });

  it('WP015-T27 (preparation time persistence in SQLite): confirmarOrdenSurtida stores and reloads whole-minute duration', () => {
    const ticket = runtime.service.enviarComandaACocina({
      id: 'ticket-prep-integ',
      cuentaId: 'c-prep',
      mesaReference: 'Mesa 15',
      kdsEstacionId: COCINA_ID,
      items: [{ id: 'part-prep', productId: 'prod-p', productNameSnapshot: 'Torta', quantity: 10000n }],
    });

    runtime.service.iniciarPreparacionOrden(ticket.id, COCINA_ID);
    const confirmed = runtime.service.confirmarOrdenSurtida(ticket.id, COCINA_ID, 14);
    assert.equal(confirmed.preparationTimeMinutes, 14);

    const reloaded = runtime.repo.getTicketById(ticket.id);
    assert.equal(reloaded?.preparationTimeMinutes, 14);

    // Raw SQL inspection
    const raw = edgeDb.queryRow<{ preparation_time_minutes: number }>(
      `SELECT preparation_time_minutes FROM kds_tickets WHERE id = ?;`,
      ticket.id,
    );
    assert.equal(raw?.preparation_time_minutes, 14);
  });

  it('WP015-T28 (recall contract integration in SQLite): getTicketForRecall retrieves completed order within window without mutation', () => {
    const ticket = runtime.service.enviarComandaACocina({
      id: 'ticket-recall-integ',
      cuentaId: 'c-recall',
      mesaReference: 'Mesa 16',
      kdsEstacionId: COCINA_ID,
      items: [{ id: 'part-rec', productId: 'prod-r', productNameSnapshot: 'Quesadilla', quantity: 30000n }],
    });

    // Incomplete ticket returns null
    assert.equal(runtime.service.recuperarOrdenRecall(ticket.id, 120), null);

    runtime.service.iniciarPreparacionOrden(ticket.id, COCINA_ID);
    runtime.service.confirmarOrdenSurtida(ticket.id, COCINA_ID, 6);

    const recalled = runtime.service.recuperarOrdenRecall(ticket.id, 120);
    assert.ok(recalled);
    assert.equal(recalled?.id, ticket.id);
    assert.equal(recalled?.status, 'LISTO');
    assert.equal(recalled?.preparationTimeMinutes, 6);
    assert.equal(typeof recalled?.partidas[0]?.quantity, 'bigint');
    assert.equal(recalled?.partidas[0]?.quantity, 30000n);

    // Recall with non-existent id returns null
    const nonExistent = runtime.service.recuperarOrdenRecall('nonexistent-id', 120);
    assert.equal(nonExistent, null);
  });

  // ==========================================
  // QI-R2-015-02: INTERRUPTED PRINTING RECOVERY TEST
  // ==========================================

  it('WP015-T29 (interrupted PRINTING restart recovery in SQLite): crash during PRINTING recovers to QUEUED with durable attempt count and error', async () => {
    const dbPath = path.join(tempDir, 'interrupted-printing-recovery.db');
    let db1: EdgeDatabaseService | undefined;

    try {
      db1 = new EdgeDatabaseService({ databasePath: dbPath });
      const repo1 = new SqliteKdsRepository(db1);
      repo1.createEstacion({ id: 'estacion-crash', name: 'Cocina Crash', stationType: 'COCINA' });
      const printer = repo1.createPrinter({ id: 'printer-crash', name: 'Printer Crash', host: '127.0.0.1', port: 9100, kdsEstacionId: 'estacion-crash' });

      const runtime1 = createKdsRuntime({ edgeDb: db1, wsPort: 0, authenticateStation: () => true });

      const ticket = runtime1.service.enviarComandaACocina({
        id: 'ticket-crash-1',
        cuentaId: 'c-crash',
        mesaReference: 'Mesa Crash',
        kdsEstacionId: 'estacion-crash',
        items: [{ id: 'part-crash', productId: 'prod-c', productNameSnapshot: 'Carne', quantity: 10000n }],
      });
      repo1.assignPrinterToTicket(ticket.id, printer.id);

      // Simulate entering PRINTING state with attempt count = 1 durably recorded before I/O
      repo1.markTicketPrintAttempt(ticket.id, {
        status: 'PRINTING',
        attempts: 1,
        lastPrintError: null,
      });

      // Verify active state is PRINTING before crash
      const preCrashTicket = repo1.getTicketById(ticket.id);
      assert.equal(preCrashTicket?.printStatus, 'PRINTING');
      assert.equal(preCrashTicket?.printAttempts, 1);

      // Simulate crash: close database connection abruptly without completing print
      await runtime1.dispatcher.close();
      db1.close();
      db1 = undefined;

      // Reopen fresh database instance / restart runtime
      const db2 = new EdgeDatabaseService({ databasePath: dbPath });
      try {
        const repo2 = new SqliteKdsRepository(db2); // constructor automatically triggers recoverInterruptedPrintingJobs()

        const recoveredTicket = repo2.getTicketById(ticket.id);
        assert.ok(recoveredTicket, 'ticket must survive crash');
        // Must be QUEUED, NOT PRINTED
        assert.equal(recoveredTicket?.printStatus, 'QUEUED');
        assert.notEqual(recoveredTicket?.printStatus, 'PRINTED');
        // Durable attempt count preserved
        assert.equal(recoveredTicket?.printAttempts, 1);
        // Error recorded
        assert.equal(recoveredTicket?.lastPrintError, 'RECOVERED_AFTER_RESTART_DURING_PRINTING');

        // Verify ticket appears in retry-eligible queue
        const pendingJobs = repo2.listPendingPrintJobs();
        assert.ok(pendingJobs.some((t) => t.id === ticket.id), 'ticket must appear in pending print queue for retry');
      } finally {
        db2.close();
      }
    } finally {
      db1?.close();
    }
  });

  // ==========================================
  // QI-R2-015-03: CONFIRMATION EVENT TRANSPORT & WIRE SERIALIZATION TEST
  // ==========================================

  it('WP015-T30 (WebSocket confirmation event transport & wire DTO mapping): broadcasts explicit fields and canonical decimal string quantities', async () => {
    const port = runtime.dispatcher.getPort();
    const client = await BufferingClient.connect(port);

    const resync = await client.next(); // KDS_RESYNC
    assert.equal(resync.type, 'KDS_RESYNC');

    // 1. Enviar Comanda
    const ticket = runtime.service.enviarComandaACocina({
      id: 'ticket-ws-events',
      cuentaId: 'cuenta-ws-1',
      mesaReference: 'Mesa 42',
      kdsEstacionId: COCINA_ID,
      items: [
        { id: 'part-ws-1', productId: 'p1', productNameSnapshot: 'Ribeye', quantity: 15000n }, // 1.5000
        { id: 'part-ws-2', productId: 'p2', productNameSnapshot: 'Papas', quantity: 1250n },  // 0.1250
      ],
    });

    const event1 = await client.next();
    assert.equal(event1.type, 'ComandaEnviadaACocina');
    const payload1 = event1.payload as { ticket: { id: string; partidas: Array<{ quantity: string }> } };
    assert.equal(payload1.ticket.id, ticket.id);
    assert.equal(payload1.ticket.partidas[0]?.quantity, '1.5000');
    assert.equal(payload1.ticket.partidas[1]?.quantity, '0.1250');

    // 2. Iniciar Preparacion
    runtime.service.iniciarPreparacionOrden(ticket.id, COCINA_ID);
    const event2 = await client.next();
    assert.equal(event2.type, 'OrdenProduccionIniciadaEnKDS');

    // 3. Confirmar Orden Surtida
    runtime.service.confirmarOrdenSurtida(ticket.id, COCINA_ID, 15);
    const event3 = await client.next();

    // Assert explicit required canonical event fields
    assert.equal(event3.type, 'OrdenProduccionConfirmadaEnKDS');
    assert.equal(event3.kdsEstacionId, COCINA_ID);

    const payload3 = event3.payload as {
      ordenProduccionId: string;
      completedAt: string;
      tiempoPreparacionMinutos: number;
      ticket: {
        id: string;
        preparationTimeMinutes: number;
        partidas: Array<{ quantity: string; productNameSnapshot: string }>;
      };
    };

    assert.equal(payload3.ordenProduccionId, ticket.id);
    assert.ok(payload3.completedAt);
    assert.equal(payload3.tiempoPreparacionMinutos, 15);
    assert.equal(payload3.ticket.id, ticket.id);
    assert.equal(payload3.ticket.preparationTimeMinutes, 15);
    assert.equal(payload3.ticket.partidas[0]?.quantity, '1.5000');
    assert.equal(payload3.ticket.partidas[1]?.quantity, '0.1250');

    client.close();
  });
});
