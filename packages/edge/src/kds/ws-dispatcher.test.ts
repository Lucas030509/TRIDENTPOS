import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { KdsWebSocketDispatcher } from './ws-dispatcher.js';

function connectClient(port: number, path = '/kds/events'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<{ data: string; receivedAt: number }> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve({ data: data.toString(), receivedAt: performance.now() });
    });
  });
}

describe('TRIDENTPOS WP-015: KdsWebSocketDispatcher (WS /kds/events)', () => {
  it('WP015-T17 (LAN broadcast test): a connected KDS client receives a broadcast domain event', async () => {
    const dispatcher = new KdsWebSocketDispatcher({
      port: 0,
      authenticateStation: () => true,
    });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();
    const client = await connectClient(port);

    const messagePromise = waitForMessage(client);
    const sent = dispatcher.broadcast({
      type: 'ComandaEnviadaACocina',
      kdsEstacionId: 'estacion-1',
      payload: { ticketId: 'ticket-1' },
      emittedAt: new Date().toISOString(),
    });
    assert.equal(sent, 1);

    const { data } = await messagePromise;
    const parsed = JSON.parse(data);
    assert.equal(parsed.type, 'ComandaEnviadaACocina');
    assert.equal(parsed.kdsEstacionId, 'estacion-1');
    assert.equal(parsed.payload.ticketId, 'ticket-1');

    client.close();
    await dispatcher.close();
  });

  it('WP015-T18 (multi-client broadcast test): all connected stations receive exactly one copy, no domain mutation duplication', async () => {
    const dispatcher = new KdsWebSocketDispatcher({ port: 0, authenticateStation: () => true });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();

    const clientCount = 5;
    const clients = await Promise.all(Array.from({ length: clientCount }, () => connectClient(port)));
    assert.equal(dispatcher.getClientCount(), clientCount);

    const messagePromises = clients.map((c) => waitForMessage(c));
    const event = {
      type: 'OrdenProduccionConfirmadaEnKDS' as const,
      kdsEstacionId: 'estacion-multi',
      payload: { ticketId: 'ticket-multi' },
      emittedAt: new Date().toISOString(),
    };
    const sentCount = dispatcher.broadcast(event);
    assert.equal(sentCount, clientCount);

    const results = await Promise.all(messagePromises);
    assert.equal(results.length, clientCount);
    for (const { data } of results) {
      const parsed = JSON.parse(data);
      assert.equal(parsed.payload.ticketId, 'ticket-multi');
    }

    // Every client receives exactly one message for one broadcast call --
    // the dispatcher never invokes the domain layer, so there is no
    // possibility of a duplicate domain mutation from this fan-out.
    for (const c of clients) {
      let extraMessages = 0;
      const onExtra = () => {
        extraMessages += 1;
      };
      c.on('message', onExtra);
      await new Promise((r) => setTimeout(r, 50));
      c.off('message', onExtra);
      assert.equal(extraMessages, 0);
    }

    for (const c of clients) c.close();
    await dispatcher.close();
  });

  it('WP015-T19 (LAN latency test): measures broadcast-to-reception latency and records actual timing', async () => {
    const dispatcher = new KdsWebSocketDispatcher({ port: 0, authenticateStation: () => true });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();
    const client = await connectClient(port);

    const samples: number[] = [];
    const iterations = 20;
    for (let i = 0; i < iterations; i += 1) {
      const messagePromise = waitForMessage(client);
      const sentAt = performance.now();
      dispatcher.broadcast({
        type: 'OrdenProduccionIniciadaEnKDS',
        kdsEstacionId: 'estacion-latency',
        payload: { i },
        emittedAt: new Date().toISOString(),
      });
      const { receivedAt } = await messagePromise;
      samples.push(receivedAt - sentAt);
    }

    const avgMs = samples.reduce((a, b) => a + b, 0) / samples.length;
    const maxMs = Math.max(...samples);

    // ADR-005 Option B cites a <5ms LAN-dedicated hardware target explicitly
    // marked "REQUIRES BENCHMARK" -- that figure describes real Wi-Fi/Ethernet
    // hardware, not a CI loopback socket, so it is not directly asserted here
    // as a pass/fail bound (asserting it in CI would either be trivially true
    // for the wrong reason on loopback, or spuriously fail under CI jitter --
    // both would be a fabricated signal). Instead we record the actual
    // measured loopback latency (typically sub-millisecond to low
    // single-digit milliseconds) and assert only a generous CI-environment
    // regression bound to catch gross dispatcher defects, while being
    // explicit in evidence that this is not a substitute for the ADR-005
    // Sec. 11 physical-LAN, 20-concurrent-client benchmark.
    // eslint-disable-next-line no-console
    console.log(
      `[WP-015 LAN latency] samples=${iterations} avgMs=${avgMs.toFixed(3)} maxMs=${maxMs.toFixed(3)}`,
    );
    assert.ok(maxMs < 250, `expected loopback broadcast latency well under 250ms, observed ${maxMs}ms`);

    client.close();
    await dispatcher.close();
  });

  it('WP015-T20: connection is refused when no station authenticator accepts it (fail-closed)', async () => {
    const dispatcher = new KdsWebSocketDispatcher({ port: 0, authenticateStation: () => false });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();

    await assert.rejects(() => connectClient(port));
    await dispatcher.close();
  });

  it('WP015-T21: connection is refused when no authenticator is configured at all (fail-closed default)', async () => {
    const dispatcher = new KdsWebSocketDispatcher({ port: 0 });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();

    await assert.rejects(() => connectClient(port));
    await dispatcher.close();
  });

  it('WP015-T22: getResyncSnapshot sends a full-state resync frame on connection', async () => {
    const dispatcher = new KdsWebSocketDispatcher({
      port: 0,
      authenticateStation: () => true,
      getResyncSnapshot: () => ({ activeTickets: [{ id: 'ticket-resync' }] }),
    });
    await dispatcher.whenListening();
    const port = dispatcher.getPort();

    // The server may push the resync frame immediately upon 'connection',
    // which can race the client's own 'open' event firing -- attach the
    // 'message' listener BEFORE awaiting 'open' so no frame can be emitted
    // and lost prior to this test observing it.
    const client = new WebSocket(`ws://127.0.0.1:${port}/kds/events`);
    const messagePromise = waitForMessage(client);
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });

    const { data } = await messagePromise;
    const parsed = JSON.parse(data);
    assert.equal(parsed.type, 'KDS_RESYNC');
    assert.equal(parsed.payload.activeTickets[0].id, 'ticket-resync');

    client.close();
    await dispatcher.close();
  });
});
