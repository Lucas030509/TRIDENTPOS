/**
 * TRIDENTPOS Cash Management, Shifts & Cortes Domain Types (WP-016 / DEC-017 / ADR-012)
 * All monetary amounts use scale-4 bigint (factor 10000n) — zero floating point math.
 */

export type TurnoCajaStatus = 'ABIERTO' | 'CERRADO_ARQUEO' | 'CORTE_Z_EMITIDO';

export type MovimientoCajaType =
  'INGRESO' | 'EGRESO' | 'VENTA_EFECTIVO' | 'DEVOLUCION_EFECTIVO' | 'FONDO_INICIAL';

export type CorteCajaType = 'CORTE_X' | 'CORTE_Z';

export interface TurnoCaja {
  readonly id: string;
  readonly stationId: string;
  readonly responsibleUserId: string;
  readonly openedByUserId: string;
  readonly shiftNumber: number;
  readonly openingCashFloat: bigint; // Scale 4
  readonly closingDeclaredCash: bigint | null; // Scale 4
  readonly calculatedCashTotal: bigint | null; // Scale 4
  readonly cashDifference: bigint | null; // Scale 4
  readonly status: TurnoCajaStatus;
  readonly assignmentStrategy: string; // 'COMPARTIDO' (DEC-017)
  readonly participatingOperators: readonly string[];
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly version: number; // OCC Version
  readonly updatedAt: string;
}

export interface MovimientoCaja {
  readonly id: string;
  readonly turnoCajaId: string;
  readonly operatorUserId: string;
  readonly movementType: MovimientoCajaType;
  readonly amount: bigint; // Scale 4 (always positive)
  readonly reason: string;
  readonly referenceId: string | null;
  readonly createdAt: string;
}

export interface ArqueoCiego {
  readonly id: string;
  readonly turnoCajaId: string;
  readonly performedByUserId: string;
  readonly declaredCash: bigint; // Scale 4
  readonly calculatedCash: bigint; // Scale 4
  readonly difference: bigint; // Scale 4 (declared - calculated)
  readonly createdAt: string;
}

export interface OperatorBreakdown {
  readonly operatorUserId: string;
  readonly totalIngresos: bigint;
  readonly totalEgresos: bigint;
  readonly totalVentasEfectivo: bigint;
  readonly netCash: bigint;
  readonly movementsCount: number;
}

export interface CorteCaja {
  readonly id: string;
  readonly turnoCajaId: string;
  readonly tipoCorte: CorteCajaType;
  readonly generatedByUserId: string;
  readonly openingCashFloat: bigint;
  readonly totalIngresos: bigint;
  readonly totalEgresos: bigint;
  readonly totalVentasEfectivo: bigint;
  readonly totalCalculado: bigint;
  readonly totalDeclarado: bigint | null;
  readonly diferencia: bigint | null;
  readonly desgloseOperadores: readonly OperatorBreakdown[];
  readonly generatedAt: string;
}

export interface CorteZGeneradoEventPayload {
  readonly shiftId: string;
  readonly stationId: string;
  readonly responsibleUserId: string;
  readonly shiftNumber: number;
  readonly openingCashFloat: string; // Decimal string scale 4
  readonly totalIngresos: string;
  readonly totalEgresos: string;
  readonly totalVentasEfectivo: string;
  readonly totalCalculado: string;
  readonly totalDeclarado: string;
  readonly diferencia: string;
  readonly desgloseOperadores: ReadonlyArray<{
    readonly operatorUserId: string;
    readonly totalIngresos: string;
    readonly totalEgresos: string;
    readonly totalVentasEfectivo: string;
    readonly netCash: string;
    readonly movementsCount: number;
  }>;
  readonly openedAt: string;
  readonly closedAt: string;
}
