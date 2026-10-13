/**
 * TRIDENTPOS Edge REST API Payment & Settlement Contracts (WP-016C / DEC-012 / DEC-015 / DEC-017 / ADR-012)
 * Canonical DTOs and Zod validation schemas for POS Payment Orchestration & Account Settlement.
 */

import { z } from 'zod';
import { PinSchema, Scale4AmountStringSchema, UuidSchema } from './dining-contracts.js';

// ==========================================
// Payment Method Enum
// Explicit first slice per WP-016C:
// EFECTIVO, TARJETA, TRANSFERENCIA.
// RESTCARD and CXC are strictly rejected at the API boundary in this slice.
// ==========================================

export const PaymentMethodSchema = z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// ==========================================
// Submit Tender Request Schema (DEC-017 Operator PIN)
// ==========================================

export const SubmitTenderRequestSchema = z.object({
  cuentaId: z.string().min(1),
  turnoCajaId: z.string().min(1),
  operatorUserId: z.string().min(1),
  operatorPin: PinSchema,
  paymentMethod: PaymentMethodSchema,
  amount: Scale4AmountStringSchema,
  tipAmount: Scale4AmountStringSchema.optional().default('0.0000'),
  cashGiven: Scale4AmountStringSchema.optional(),
  referenceAuthCode: z.string().max(100).optional().nullable(),
  clientOpId: UuidSchema,
});

export type SubmitTenderRequestDTO = z.infer<typeof SubmitTenderRequestSchema>;

// ==========================================
// Tender Result DTO
// ==========================================

export const TenderResultSchema = z.object({
  id: z.string().min(1),
  cuentaId: z.string().min(1),
  turnoCajaId: z.string().min(1),
  operatorUserId: z.string().min(1),
  paymentMethod: PaymentMethodSchema,
  amount: Scale4AmountStringSchema,
  tipAmount: Scale4AmountStringSchema,
  cashGiven: Scale4AmountStringSchema.optional().nullable(),
  changeDue: Scale4AmountStringSchema.optional().nullable(),
  referenceAuthCode: z.string().optional().nullable(),
  clientOpId: z.string().min(1),
  remainingBalance: Scale4AmountStringSchema,
  accountSettled: z.boolean(),
  accountStatus: z.string(),
  closedAt: z.string().optional().nullable(),
  createdAt: z.string(),
});

export type TenderResultDTO = z.infer<typeof TenderResultSchema>;

// ==========================================
// Account Payments Summary DTO
// ==========================================

export const AccountPaymentsSummarySchema = z.object({
  cuentaId: z.string().min(1),
  totalAmount: Scale4AmountStringSchema,
  totalPaid: Scale4AmountStringSchema,
  totalTips: Scale4AmountStringSchema,
  remainingBalance: Scale4AmountStringSchema,
  isSettled: z.boolean(),
  accountStatus: z.string(),
  payments: z.array(TenderResultSchema),
});

export type AccountPaymentsSummaryDTO = z.infer<typeof AccountPaymentsSummarySchema>;

// ==========================================
// Domain Event: CuentaPagada Payload (FUNCTIONAL_ARCHITECTURE.md Sec 6.3)
// ==========================================

export const CuentaPagadaEventPayloadSchema = z.object({
  organizacionId: z.string().min(1),
  sucursalId: z.string().min(1),
  estacionId: z.string().min(1),
  cuentaId: z.string().min(1),
  folioVenta: z.number().int().nullable(),
  montos: z.object({
    subtotal: Scale4AmountStringSchema,
    taxTotal: Scale4AmountStringSchema,
    discountsTotal: Scale4AmountStringSchema,
    total: Scale4AmountStringSchema,
  }),
  impuestos: z.array(
    z.object({
      rate: Scale4AmountStringSchema,
      amount: Scale4AmountStringSchema,
    }),
  ),
  propina: Scale4AmountStringSchema,
  formasPago: z.array(
    z.object({
      method: PaymentMethodSchema,
      amount: Scale4AmountStringSchema,
      reference: z.string().nullable(),
    }),
  ),
  meseroId: z.string().nullable(),
  clienteId: z.string().nullable(),
  settledAt: z.string(),
});

export type CuentaPagadaEventPayload = z.infer<typeof CuentaPagadaEventPayloadSchema>;
