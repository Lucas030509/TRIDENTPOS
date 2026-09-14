/**
 * TRIDENTPOS POS Persistence Ports (Hexagonal Architecture / ADR-013)
 * Implemented by infrastructure adapters in composition root @trident/pos-edge-runtime.
 * @trident/pos defines only ports and domain logic, never importing infrastructure packages.
 */

import type { Cuenta, Mesa } from './types.js';

export interface DiningRoomRepositoryPort {
  getMesaById(id: string): Promise<Mesa | null> | Mesa | null;
  saveMesa(mesa: Mesa, expectedVersion: number): Promise<Mesa> | Mesa;
  listMesas(): Promise<readonly Mesa[]> | readonly Mesa[];
  getMesaByIdSync?(id: string): Mesa | null;
  saveMesaSync?(mesa: Mesa, expectedVersion: number): Mesa;
}

export interface AccountRepositoryPort {
  getCuentaById(id: string): Promise<Cuenta | null> | Cuenta | null;
  saveCuenta(cuenta: Cuenta, expectedVersion: number): Promise<Cuenta> | Cuenta;
  listOpenCuentas(): Promise<readonly Cuenta[]> | readonly Cuenta[];
  getCuentaByIdSync?(id: string): Cuenta | null;
  saveCuentaSync?(cuenta: Cuenta, expectedVersion: number): Cuenta;
}
