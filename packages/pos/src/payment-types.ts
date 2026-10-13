/**
 * TRIDENTPOS Payment Orchestration & Account Settlement Types (WP-016C / DEC-012 / DEC-015 / DEC-017 / ADR-012)
 * All monetary amounts use scale-4 bigint (factor 10000n) — zero floating point math.
 */

import type { CuentaPagadaEventPayload, PaymentMethod } from '@trident/core';
import type { MovimientoCaja } from './cash-shift-types.js';
import type { CuentaStatus } from './types.js';

export { type PaymentMethod };

export interface Pago {
  readonly id: string;
  readonly cuentaId: string;
  readonly turnoCajaId: string;
  readonly operatorUserId: string;
  readonly paymentMethod: PaymentMethod;
  readonly amount: bigint; // Scale 4
  readonly tipAmount: bigint; // Scale 4
  readonly cashGiven: bigint | null; // Scale 4 (EFECTIVO only)
  readonly changeDue: bigint | null; // Scale 4 (EFECTIVO only)
  readonly referenceAuthCode: string | null;
  readonly clientOpId: string; // Idempotency key
  readonly createdAt: string;
}

export interface SubmitTenderCommand {
  readonly cuentaId: string;
  readonly turnoCajaId: string;
  readonly operatorUserId: string;
  readonly operatorPin: string;
  readonly paymentMethod: PaymentMethod;
  readonly amount: bigint; // Scale 4
  readonly tipAmount?: bigint; // Scale 4
  readonly cashGiven?: bigint; // Scale 4 (EFECTIVO only)
  readonly referenceAuthCode?: string | null;
  readonly clientOpId: string; // Idempotency key
}

export interface PaymentSettlementResult {
  readonly pago: Pago;
  readonly totalAmount: bigint; // Scale 4
  readonly totalPaid: bigint; // Scale 4
  readonly totalTips: bigint; // Scale 4
  readonly remainingBalance: bigint; // Scale 4
  readonly accountSettled: boolean;
  readonly accountStatus: CuentaStatus;
  readonly closedAt: string | null;
  readonly isIdempotentReplay: boolean;
  readonly cashMovement?: MovimientoCaja;
  readonly cuentaPagadaEvent?: CuentaPagadaEventPayload;
}

export interface AccountPaymentsSummary {
  readonly cuentaId: string;
  readonly totalAmount: bigint; // Scale 4
  readonly totalPaid: bigint; // Scale 4
  readonly totalTips: bigint; // Scale 4
  readonly remainingBalance: bigint; // Scale 4
  readonly isSettled: boolean;
  readonly accountStatus: CuentaStatus;
  readonly payments: readonly Pago[];
}
