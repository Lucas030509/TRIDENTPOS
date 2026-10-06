/**
 * TRIDENTPOS ESC/POS Cash Drawer Trigger Adapter (WP-016 / ADR-013)
 * Sends the standard ESC/POS drawer kick pulse command (ESC p m t1 t2)
 * to a network thermal printer configured on the POS station.
 */

import { EscPosPrinterClient } from '@trident/edge';
import type { CashDrawerPort } from '@trident/pos';

// ESC p 0 25 250 -- Standard cash drawer kick pulse (pin 2, 50ms ON, 500ms OFF)
const CMD_DRAWER_KICK_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

export class EscposCashDrawerAdapter implements CashDrawerPort {
  readonly #printerClient: EscPosPrinterClient;

  constructor(printerClient: EscPosPrinterClient) {
    this.#printerClient = printerClient;
  }

  public async kickDrawer(): Promise<void> {
    await this.#printerClient.printTicket(CMD_DRAWER_KICK_PULSE);
  }
}
