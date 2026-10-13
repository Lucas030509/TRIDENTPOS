/**
 * TRIDENTPOS Edge REST API Contracts & Validation Schemas (Decision FE-08)
 * Canonical DTOs and Zod validation schemas for POS Edge Dining & Cash Operations.
 */

import { z } from 'zod';

// ==========================================
// Primitives & Shared Schemas
// ==========================================

export const UuidSchema = z.string().uuid();
export const PinSchema = z.string().min(1).max(12);
export const ReasonSchema = z.string().min(1).max(500);
export const VersionSchema = z.number().int().nonnegative();
export const Scale4AmountStringSchema = z.string().regex(/^-?\d+(\.\d{1,4})?$/, {
  message: 'Amount must be a valid scale-4 decimal string (e.g. "150.00" or "150.0000")',
});

// ==========================================
// DEC-010: Item Cancellation
// ==========================================

export const CancelCuentaItemSchema = z.object({
  cuentaId: z.string().min(1),
  itemId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  reason: ReasonSchema,
  operatorUserId: z.string().min(1),
  operatorPin: PinSchema,
  supervisorPin: PinSchema.optional(),
  kitchenStatus: z
    .enum(['SIN_INICIAR', 'PENDIENTE', 'RECIBIDO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO'])
    .optional(),
});

export type CancelCuentaItemDTO = z.infer<typeof CancelCuentaItemSchema>;

// ==========================================
// DEC-011: Account / Table Transfer
// ==========================================

export const TransferCuentaSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  sourceMesaId: z.string().min(1),
  targetMesaId: z.string().min(1),
  sourceWaiterUserId: z.string().min(1),
  targetWaiterUserId: z.string().min(1),
  targetWaiterPin: PinSchema,
  reason: ReasonSchema.optional(),
});

export type TransferCuentaDTO = z.infer<typeof TransferCuentaSchema>;

// ==========================================
// DEC-013: Account Cancellation (Printed or Open)
// ==========================================

export const CancelCuentaSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  reason: ReasonSchema,
  requestedByUserId: z.string().min(1),
  requestedByPin: PinSchema,
  managerPin: PinSchema.optional(),
});

export type CancelCuentaDTO = z.infer<typeof CancelCuentaSchema>;

// ==========================================
// DEC-015: Account Split & Proration
// ==========================================

export const SplitPartitionItemPlanSchema = z.object({
  partitionId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).optional(),
  ratioScale4: Scale4AmountStringSchema.optional(),
});

export const SplitCuentaSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  splitType: z.enum(['BY_ITEMS', 'EQUAL_PARTS', 'BY_RATIO']),
  partitions: z.array(SplitPartitionItemPlanSchema).min(2),
  performedByUserId: z.string().min(1),
  operatorPin: PinSchema,
});

export type SplitCuentaDTO = z.infer<typeof SplitCuentaSchema>;

// ==========================================
// Operational Dining Commands
// ==========================================

export const ReassignWaiterSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  newWaiterUserId: z.string().min(1),
  requestingUserId: z.string().min(1),
  requestingPin: PinSchema,
  reason: ReasonSchema.optional(),
});

export type ReassignWaiterDTO = z.infer<typeof ReassignWaiterSchema>;

export const ChangeGuestCountSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  guestCount: z.number().int().min(1).max(999),
  performedByUserId: z.string().min(1),
  operatorPin: PinSchema.optional(),
});

export type ChangeGuestCountDTO = z.infer<typeof ChangeGuestCountSchema>;

export const RequestCheckSchema = z.object({
  cuentaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  requestedByUserId: z.string().min(1),
  operatorPin: PinSchema.optional(),
});

export type RequestCheckDTO = z.infer<typeof RequestCheckSchema>;

export const ReleaseMesaSchema = z.object({
  mesaId: z.string().min(1),
  expectedVersion: VersionSchema,
  clientOpId: UuidSchema,
  performedByUserId: z.string().min(1),
  force: z.boolean().optional(),
});

export type ReleaseMesaDTO = z.infer<typeof ReleaseMesaSchema>;

// ==========================================
// Salón Read Model DTOs
// ==========================================

export interface AttentionSignalDTO {
  readonly flagged: boolean;
  readonly reason: string | null;
  readonly elapsedMinutes: number;
}

export interface MesaSummaryDTO {
  readonly id: string;
  readonly roomName: string;
  readonly tableNumber: string;
  readonly status: 'DISPONIBLE' | 'OCUPADA' | 'EN_CUENTA' | 'BLOQUEADA';
  readonly currentAccountId: string | null;
  readonly assignedWaiterUserId: string | null;
  readonly guestCount: number;
  readonly subtotal: string;
  readonly totalAmount: string;
  readonly openedAt: string | null;
  readonly attentionSignal: AttentionSignalDTO;
  readonly version: number;
  readonly updatedAt: string;
}

export interface SalonReadModelDTO {
  readonly rooms: readonly {
    readonly name: string;
    readonly tables: readonly MesaSummaryDTO[];
  }[];
  readonly totalTables: number;
  readonly occupiedTables: number;
  readonly inCheckTables: number;
  readonly availableTables: number;
  readonly generatedAt: string;
}
