/**
 * TRIDENTPOS POS Persistence Ports (Hexagonal Architecture / ADR-013)
 * Implemented by infrastructure adapters in composition root @trident/pos-edge-runtime.
 * @trident/pos defines only ports and domain logic, never importing infrastructure packages.
 */

import type { Cuenta, Mesa } from './types.js';

export interface DiningRoomRepositoryPort {
  getMesaById(id: string): Promise<Mesa | null>;
  saveMesa(mesa: Mesa, expectedVersion: number): Promise<Mesa>;
  listMesas(): Promise<readonly Mesa[]>;
}

export interface AccountRepositoryPort {
  getCuentaById(id: string): Promise<Cuenta | null>;
  saveCuenta(cuenta: Cuenta, expectedVersion: number): Promise<Cuenta>;
  listOpenCuentas(): Promise<readonly Cuenta[]>;
}
