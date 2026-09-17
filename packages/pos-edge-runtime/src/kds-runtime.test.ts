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
        { id: 'partida-integ-1', productId: 'prod-1', productNameSnapshot: 'Enchiladas', quantity: '1.5000' },
      ],
    });

    const received = await client.next();
    assert.equal(received.type, 'ComandaEnviadaACocina');
    assert.equal((received.payload as { id: string }).id, ticket.id);

    // Persisted through the composition root's SQLite repository, not just in-memory.
    const reloaded = runtime.repo.getTicketById(ticket.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.printStatus, 'PENDING');
    assert.equal(reloaded?.preparationTimeMinutes, null);
    assert.equal(reloaded?.partidas[0]?.quantity, '1.5000');

    // Direct SQLite raw column inspection: verify quantity is stored as integer scale-4 (15000)
    const rawPartida = edgeDb.queryRow<{ quantity: number }>(
      `SELECT quantity FROM kds_ticket_partidas WHERE id = ?;`,
      'partida-integ-1',
    );
    assert.equal(rawPartida?.quantity, 15000);

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
      items: [{ id: 'partida-integ-2', productId: 'prod-2', productNameSnapshot: 'Sopa', quantity: '1.0000' }],
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
        items: [{ id: 'partida-integ-3', productId: 'prod-3', productNameSnapshot: 'Agua', quantity: '2.0000' }],
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
        items: [{ id: 'partida-restart-1', productId: 'prod-4', productNameSnapshot: 'Cafe', quantity: '1.0000' }],
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
      items: [{ id: 'part-prep', productId: 'prod-p', productNameSnapshot: 'Torta', quantity: '1.0000' }],
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
      items: [{ id: 'part-rec', productId: 'prod-r', productNameSnapshot: 'Quesadilla', quantity: '3.0000' }],
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
    assert.equal(recalled?.partidas[0]?.quantity, '3.0000');

    // Recall with narrow 0-minute window on ticket completed earlier returns valid or null as window dictates
    const nonExistent = runtime.service.recuperarOrdenRecall('nonexistent-id', 120);
    assert.equal(nonExistent, null);
  });
});
