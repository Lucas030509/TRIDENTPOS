/**
 * TRIDENTPOS POS Domain Types & Entities (ADR-012, ADR-013, DATA_MODEL.md)
 * All financial / rate fields use scale-4 bigint (factor 10000n) — zero floats.
 */

export type MesaStatus = 'DISPONIBLE' | 'OCUPADA' | 'EN_CUENTA' | 'BLOQUEADA';

export type AccountType = 'COMEDOR' | 'MOSTRADOR' | 'RAPPI' | 'UBER' | 'DOMICILIO';

export type CuentaStatus = 'ABIERTA' | 'IMPRESA' | 'PAGADA' | 'ANULADA';

export type CuentaItemStatus = 'ORDENADO' | 'EN_COCINA' | 'PREPARADO' | 'ENTREGADO' | 'CANCELADO';

export interface Mesa {
  readonly id: string;
  readonly roomName: string;
  readonly tableNumber: string;
  readonly status: MesaStatus;
  readonly currentAccountId: string | null;
  readonly posX?: number | null;
  readonly posY?: number | null;
  readonly capacity?: number | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface CuentaItemModificador {
  readonly id: string;
  readonly cuentaItemId: string;
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
  readonly modifierPriceApplied: bigint; // Scale 4
}

export interface CuentaItem {
  readonly id: string;
  readonly cuentaId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPriceApplied: bigint; // Scale 4
  readonly quantity: bigint; // Scale 4 (e.g. 1.0000 = 10000n)
  readonly taxRateApplied: bigint; // Scale 4 (e.g. 16% = 1600n)
  readonly taxAmountApplied: bigint; // Scale 4
  readonly discountAmountApplied: bigint; // Scale 4
  readonly subtotal: bigint; // Scale 4
  readonly total: bigint; // Scale 4
  readonly status: CuentaItemStatus;
  readonly cancellationReason?: string | null;
  readonly cancelledByUserId?: string | null;
  readonly cancelledAt?: string | null;
  readonly requiresWasteRecord?: boolean;
  readonly createdAt: string;
  readonly modifiers: readonly CuentaItemModificador[];
}

export interface Cuenta {
  readonly id: string;
  readonly folioNumber: number | null;
  readonly epochId: string;
  readonly mesaId: string | null;
  readonly accountType: AccountType;
  readonly status: CuentaStatus;
  readonly subtotal: bigint; // Scale 4
  readonly taxTotal: bigint; // Scale 4
  readonly discountsTotal: bigint; // Scale 4
  readonly tipsTotal: bigint; // Scale 4
  readonly totalAmount: bigint; // Scale 4
  readonly openedByUserId: string;
  readonly currentWaiterUserId?: string | null;
  readonly guestCount?: number | null;
  readonly openedAt: string;
  readonly printedAt?: string | null;
  readonly closedAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
  readonly parentCuentaId?: string | null;
  readonly splitSequence?: number | null;
  readonly items: readonly CuentaItem[];
}

export interface AttentionSignal {
  readonly flagged: boolean;
  readonly reason: string | null;
  readonly elapsedMinutes: number;
}

export interface MesaSummary {
  readonly id: string;
  readonly roomName: string;
  readonly tableNumber: string;
  readonly status: MesaStatus;
  readonly currentAccountId: string | null;
  readonly assignedWaiterUserId: string | null;
  readonly guestCount: number;
  readonly subtotal: bigint; // Scale 4
  readonly totalAmount: bigint; // Scale 4
  readonly openedAt: string | null;
  readonly attentionSignal: AttentionSignal;
  readonly version: number;
  readonly updatedAt: string;
}

export interface SalonRoomSummary {
  readonly name: string;
  readonly tables: readonly MesaSummary[];
}

export interface SalonReadModel {
  readonly rooms: readonly SalonRoomSummary[];
  readonly totalTables: number;
  readonly occupiedTables: number;
  readonly inCheckTables: number;
  readonly availableTables: number;
  readonly generatedAt: string;
}
