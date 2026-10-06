/**
 * TRIDENTPOS Cash Shift Persistence & Hardware Ports (Hexagonal Architecture / ADR-013)
 * Infrastructure adapters in @trident/pos-edge-runtime implement these ports.
 */

import type { ArqueoCiego, CorteCaja, MovimientoCaja, TurnoCaja } from './cash-shift-types.js';

export interface CashShiftRepositoryPort {
  getActiveShift(stationId: string): Promise<TurnoCaja | null> | TurnoCaja | null;
  getShiftById(id: string): Promise<TurnoCaja | null> | TurnoCaja | null;
  saveShift(shift: TurnoCaja, expectedVersion: number): Promise<TurnoCaja> | TurnoCaja;
  addMovement(
    movement: MovimientoCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<MovimientoCaja> | MovimientoCaja;
  listMovements(shiftId: string): Promise<readonly MovimientoCaja[]> | readonly MovimientoCaja[];
  saveArqueoCiego(
    arqueo: ArqueoCiego,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<ArqueoCiego> | ArqueoCiego;
  saveCorteZ(
    corte: CorteCaja,
    shift: TurnoCaja,
    expectedVersion: number,
  ): Promise<CorteCaja> | CorteCaja;
}

export interface CashDrawerPort {
  kickDrawer(): Promise<void> | void;
}

export interface IamPinValidatorPort {
  validatePin(userId: string, pin: string, stationId?: string): Promise<boolean> | boolean;
}
