import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatKdsTicketEscPos } from './escpos-formatter.js';

describe('TRIDENTPOS WP-015: formatKdsTicketEscPos', () => {
  it('WP015-T10: formats a deterministic ESC/POS buffer containing init, cut, and ticket content', () => {
    const buf1 = formatKdsTicketEscPos({
      ticketId: 'ticket-1',
      mesaReference: 'Mesa 5',
      urgencyLevel: 'NORMAL',
      createdAt: '2026-09-17T00:00:00.000Z',
      partidas: [
        {
          quantity: '2.0000',
          productNameSnapshot: 'Tacos al Pastor',
          modifiers: [{ modifierNameSnapshot: 'Sin cebolla' }],
          comments: 'Bien dorados',
        },
      ],
    });

    const buf2 = formatKdsTicketEscPos({
      ticketId: 'ticket-1',
      mesaReference: 'Mesa 5',
      urgencyLevel: 'NORMAL',
      createdAt: '2026-09-17T00:00:00.000Z',
      partidas: [
        {
          quantity: '2.0000',
          productNameSnapshot: 'Tacos al Pastor',
          modifiers: [{ modifierNameSnapshot: 'Sin cebolla' }],
          comments: 'Bien dorados',
        },
      ],
    });

    // Deterministic: identical input produces byte-identical output.
    assert.ok(buf1.equals(buf2));

    // ESC @ init sequence present at start.
    assert.equal(buf1[0], 0x1b);
    assert.equal(buf1[1], 0x40);

    // GS V cut sequence present near the end.
    const cutIndex = buf1.indexOf(Buffer.from([0x1d, 0x56, 0x00]));
    assert.ok(cutIndex > 0, 'expected GS V cut sequence to be present');

    const text = buf1.toString('ascii');
    assert.match(text, /Mesa 5/);
    assert.match(text, /ticket-1/);
    assert.match(text, /2\.0000 x Tacos al Pastor/);
    assert.match(text, /Sin cebolla/);
    assert.match(text, /Bien dorados/);
  });

  it('WP015-T11: includes urgency banner only for non-NORMAL urgency', () => {
    const normal = formatKdsTicketEscPos({
      ticketId: 't1',
      mesaReference: 'M1',
      urgencyLevel: 'NORMAL',
      createdAt: '2026-09-17T00:00:00.000Z',
      partidas: [{ quantity: '1.0000', productNameSnapshot: 'Item' }],
    });
    const urgent = formatKdsTicketEscPos({
      ticketId: 't1',
      mesaReference: 'M1',
      urgencyLevel: 'URGENTE',
      createdAt: '2026-09-17T00:00:00.000Z',
      partidas: [{ quantity: '1.0000', productNameSnapshot: 'Item' }],
    });

    assert.doesNotMatch(normal.toString('ascii'), /URGENCIA/);
    assert.match(urgent.toString('ascii'), /URGENCIA: URGENTE/);
  });

  it('WP015-T12: strips non-ASCII characters to avoid undefined codepage bytes', () => {
    const buf = formatKdsTicketEscPos({
      ticketId: 't1',
      mesaReference: 'Mesa Ñ',
      urgencyLevel: 'NORMAL',
      createdAt: '2026-09-17T00:00:00.000Z',
      partidas: [{ quantity: '1.0000', productNameSnapshot: 'Salsa Habanera' }],
    });
    for (const byte of buf) {
      // Allow the known control bytes (ESC, GS, LF, etc.) or printable ASCII.
      assert.ok(
        byte <= 0x7e,
        `unexpected byte outside printable ASCII/control range: 0x${byte.toString(16)}`,
      );
    }
  });
});
