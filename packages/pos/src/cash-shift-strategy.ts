/**
 * TRIDENTPOS Shift Assignment Strategy Pattern (WP-016 / DEC-017 / OQ-ARCH-01)
 * Enforces policies for multi-operator access to cash drawers and shifts.
 */

import type { TurnoCaja } from './cash-shift-types.js';

export interface ShiftAssignmentStrategy {
  readonly name: string;
  canOperate(shift: TurnoCaja, operatorUserId: string): boolean;
  canAddOperator(shift: TurnoCaja, operatorUserId: string, requestingUserId: string): boolean;
  canClose(shift: TurnoCaja, requestingUserId: string): boolean;
}

/**
 * DEC-017: Turno de caja compartido con PIN por cobro (OQ-ARCH-01).
 * Varios operadores autorizados pueden cobrar en la misma caja durante un turno,
 * con fondo y arqueo mancomunados. Cada cobro/movimiento exige el PIN del operador
 * y queda ligado a su usuario. El turno tiene un responsable de apertura y cierre;
 * los cortes X/Z muestran el total del turno y el desglose por operador.
 */
export class SharedShiftAssignmentStrategy implements ShiftAssignmentStrategy {
  public readonly name = 'COMPARTIDO';

  public canOperate(shift: TurnoCaja, operatorUserId: string): boolean {
    if (!operatorUserId || operatorUserId.trim().length === 0) {
      return false;
    }
    if (operatorUserId === shift.responsibleUserId || operatorUserId === shift.openedByUserId) {
      return true;
    }
    return shift.participatingOperators.includes(operatorUserId);
  }

  public canAddOperator(
    shift: TurnoCaja,
    operatorUserId: string,
    requestingUserId: string,
  ): boolean {
    if (!operatorUserId || operatorUserId.trim().length === 0) {
      return false;
    }
    if (shift.status !== 'ABIERTO') {
      return false;
    }
    // Only the responsible user or existing participants can add operators
    return (
      requestingUserId === shift.responsibleUserId ||
      shift.participatingOperators.includes(requestingUserId)
    );
  }

  public canClose(shift: TurnoCaja, requestingUserId: string): boolean {
    if (!requestingUserId || requestingUserId.trim().length === 0) {
      return false;
    }
    // Responsible user can always close; participants can close if authorized
    return (
      requestingUserId === shift.responsibleUserId ||
      requestingUserId === shift.openedByUserId ||
      shift.participatingOperators.includes(requestingUserId)
    );
  }
}
