/**
 * TRIDENTPOS Payment Ports (WP-016C / ADR-013)
 * Pure domain ports for POS Payment Orchestration & Settlement.
 */

import type { CuentaPagadaEventPayload } from '@trident/core';
import type { MovimientoCaja, TurnoCaja } from './cash-shift-types.js';
import type { Pago } from './payment-types.js';
import type { IamPinValidatorPort } from './ports.js';
import type { Cuenta } from './types.js';

export { type IamPinValidatorPort };

export interface AtomicSettlementParams {
  readonly pago: Pago;
  readonly updatedCuenta: Cuenta;
  readonly cashMovement?: MovimientoCaja;
  readonly cuentaPagadaEvent?: CuentaPagadaEventPayload;
  readonly auditRecord: {
    readonly actorId: string;
    readonly action: string;
    readonly details: unknown;
  };
}

export interface PaymentRepositoryPort {
  findPaymentById(id: string): Promise<Pago | null>;
  findPaymentByClientOpId(cuentaId: string, clientOpId: string): Promise<Pago | null>;
  listPaymentsByCuentaId(cuentaId: string): Promise<readonly Pago[]>;
  executeAtomicSettlement(params: AtomicSettlementParams): Promise<Pago>;
}

export interface CashShiftLookupPort {
  getShiftById(shiftId: string): Promise<TurnoCaja | null> | TurnoCaja | null;
}
