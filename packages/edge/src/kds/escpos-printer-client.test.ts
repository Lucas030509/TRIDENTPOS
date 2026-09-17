import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EscPosPrinterClient, PrinterConnectionError } from './escpos-printer-client.js';

describe('TRIDENTPOS WP-015: EscPosPrinterClient', () => {
  it('WP015-T13: successfully delivers payload to a listening TCP printer stub', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const client = new EscPosPrinterClient({ host: '127.0.0.1', port });
    const payload = Buffer.from('ESC/POS TICKET PAYLOAD');
    await client.printTicket(payload);

    const all = Buffer.concat(received);
    assert.ok(all.equals(payload));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('WP015-T14 (printer disconnect / network unreachable test): rejects with PrinterConnectionError when nothing is listening', async () => {
    // Port 1 is a privileged/unassigned port extremely unlikely to have a
    // listener in any test environment -- connection is refused immediately.
    const client = new EscPosPrinterClient({
      host: '127.0.0.1',
      port: 39, // reserved, unassigned -- guaranteed connection refused on loopback
      connectTimeoutMs: 2000,
    });

    await assert.rejects(
      () => client.printTicket(Buffer.from('X')),
      (err: unknown) => {
        assert.ok(err instanceof PrinterConnectionError);
        assert.equal(err.reason, 'REFUSED');
        return true;
      },
    );
  });

  it('WP015-T15 (printer paper-out / mid-transfer failure simulation): rejects with RESET, order flow survives (no throw escapes as uncaught)', async () => {
    // Simulate a printer that accepts the TCP connection (as if online / paper
    // physically loaded) but then abruptly resets mid-transfer -- the
    // real-world signature of a paper-out/jam fault on many ESC/POS network
    // printers, which drop the connection rather than sending a structured
    // "out of paper" application-level reply.
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        socket.resetAndDestroy ? socket.resetAndDestroy() : socket.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const client = new EscPosPrinterClient({ host: '127.0.0.1', port, writeTimeoutMs: 2000 });

    let caught: unknown;
    try {
      await client.printTicket(Buffer.from('TICKET'));
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof PrinterConnectionError);
    assert.ok(['RESET', 'UNKNOWN'].includes((caught as PrinterConnectionError).reason));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('WP015-T16: rejects with TIMEOUT reason if connection never completes', async () => {
    // Server accepts the TCP connection but deliberately never reads from or
    // writes to the socket -- exercising the client's own writeTimeoutMs
    // bound deterministically and offline-safely (no external network
    // dependency). NOTE: the accepted socket is intentionally left paused
    // (no 'data' listener / no resume()) to hold the connection open; the
    // server-side socket is tracked and force-destroyed in cleanup below
    // instead of relying on a graceful server.close(), since a paused
    // Node stream will not observe the client's FIN until something reads
    // it -- that is a test-harness cleanup detail, not a behavior of the
    // client under test.
    const serverSockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
      serverSockets.push(socket);
      // Deliberately no listeners attached: simulates a printer that
      // accepted the connection but is not responding at all.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const client = new EscPosPrinterClient({ host: '127.0.0.1', port, writeTimeoutMs: 300 });

    await assert.rejects(
      () => client.printTicket(Buffer.from('TICKET')),
      (err: unknown) => {
        assert.ok(err instanceof PrinterConnectionError);
        assert.equal(err.reason, 'TIMEOUT');
        return true;
      },
    );

    for (const s of serverSockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
