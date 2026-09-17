/**
 * TRIDENTPOS ESC/POS Ticket Formatter (WP-015)
 * Pure, deterministic byte-sequence formatting for thermal kitchen printers.
 * No I/O, no business-rule ownership -- consumes an already-decided ticket
 * snapshot handed to it by the composition root and renders bytes only.
 */

const ESC = 0x1b;
const GS = 0x1d;

// ESC @ -- initialize printer
const CMD_INIT = Buffer.from([ESC, 0x40]);
// ESC E n -- bold on/off
const CMD_BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const CMD_BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
// ESC a n -- justification (0 = left, 1 = center)
const CMD_ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const CMD_ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
// GS V m -- full paper cut
const CMD_CUT = Buffer.from([GS, 0x56, 0x00]);
const LF = Buffer.from('\n', 'ascii');

export interface EscPosTicketPartida {
  readonly quantity: string;
  readonly productNameSnapshot: string;
  readonly comments?: string | null;
  readonly modifiers?: ReadonlyArray<{ readonly modifierNameSnapshot: string }>;
}

export interface EscPosTicketInput {
  readonly ticketId: string;
  readonly mesaReference: string;
  readonly urgencyLevel: 'NORMAL' | 'ALTA' | 'URGENTE';
  readonly createdAt: string;
  readonly partidas: readonly EscPosTicketPartida[];
}

function ascii(text: string): Buffer {
  // ESC/POS thermal printers commonly expect ASCII/CP437; strip characters
  // outside printable ASCII to avoid undefined codepage behavior on real hardware.
  // eslint-disable-next-line no-control-regex
  const sanitized = text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  return Buffer.from(sanitized, 'ascii');
}

/**
 * Formats a KDS ticket into a raw ESC/POS byte buffer ready to write to a
 * network printer's TCP socket (port 9100 per WP-015 spec).
 */
export function formatKdsTicketEscPos(ticket: EscPosTicketInput): Buffer {
  const parts: Buffer[] = [CMD_INIT];

  parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON, ascii('*** COMANDA COCINA ***'), LF, CMD_BOLD_OFF);
  if (ticket.urgencyLevel !== 'NORMAL') {
    parts.push(ascii(`** URGENCIA: ${ticket.urgencyLevel} **`), LF);
  }
  parts.push(CMD_ALIGN_LEFT);
  parts.push(ascii(`Mesa: ${ticket.mesaReference}`), LF);
  parts.push(ascii(`Ticket: ${ticket.ticketId}`), LF);
  parts.push(ascii(`Hora: ${ticket.createdAt}`), LF);
  parts.push(ascii('------------------------------'), LF);

  for (const partida of ticket.partidas) {
    parts.push(
      CMD_BOLD_ON,
      ascii(`${partida.quantity} x ${partida.productNameSnapshot}`),
      LF,
      CMD_BOLD_OFF,
    );
    for (const mod of partida.modifiers ?? []) {
      parts.push(ascii(`   + ${mod.modifierNameSnapshot}`), LF);
    }
    if (partida.comments) {
      parts.push(ascii(`   Nota: ${partida.comments}`), LF);
    }
  }

  parts.push(ascii('------------------------------'), LF, LF, LF);
  parts.push(CMD_CUT);

  return Buffer.concat(parts);
}
