/**
 * TRIDENTPOS Inventory & Recipes Domain Types
 * Conforms to DATA_MODEL.md Sec 2.3, ADR-013, ACR-2026-017, and MODULE_CATALOG.md.
 * All monetary and quantity values are represented as canonical fixed 4-decimal strings (DECIMAL(12,4)).
 */

export type WarehouseType = 'PRINCIPAL' | 'PRODUCCION' | 'BARRA' | 'COCINA';

export type UnitOfMeasure = 'KG' | 'LT' | 'PZ' | 'GR' | 'ML';

export interface Warehouse {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly code: string;
  readonly name: string;
  readonly warehouseType: WarehouseType;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Ingredient {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly unitOfMeasure: UnitOfMeasure;
  readonly currentAverageCost: string; // Canonical 4-decimal string
  readonly lastPurchaseCost: string; // Canonical 4-decimal string
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecipeItem {
  readonly id: string;
  readonly organizationId: string;
  readonly recipeId: string;
  readonly ingredientId: string | null;
  readonly subRecipeId: string | null;
  readonly quantity: string; // Net quantity (4-decimal string)
  readonly grossQuantity: string; // Gross quantity including waste factor (4-decimal string)
  readonly unitCostSnapshot: string; // 4-decimal string
  readonly createdAt: string;
}

export interface Recipe {
  readonly id: string;
  readonly organizationId: string;
  readonly productId: string | null;
  readonly code: string;
  readonly name: string;
  readonly yieldQuantity: string; // 4-decimal string, default '1.0000'
  readonly yieldUnit: string;
  readonly totalCost: string; // Theoretical batch cost (4-decimal string)
  readonly isActive: boolean;
  readonly items: readonly RecipeItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExplodedIngredient {
  readonly ingredientId: string;
  readonly totalQuantity: string; // Aggregated net quantity (4-decimal string)
  readonly totalGrossQuantity: string; // Aggregated gross quantity (4-decimal string)
}

export interface RecipeItemCostBreakdown {
  readonly id: string;
  readonly targetType: 'INGREDIENT' | 'SUB_RECIPE';
  readonly targetId: string;
  readonly grossQuantity: string;
  readonly unitCost: string;
  readonly totalLineCost: string;
}

export interface RecipeCostCalculationResult {
  readonly recipeId: string;
  readonly totalCost: string; // Total batch cost (4-decimal string)
  readonly unitCost: string; // Cost per yield unit = totalCost / yieldQuantity (4-decimal string)
  readonly yieldQuantity: string;
  readonly lineItems: readonly RecipeItemCostBreakdown[];
}

// ============================================================================
// WP-018: Real-Time Kárdex, Waste Tracking & KDS Depletion Types
// ============================================================================

export type StockMovementType =
  'COMPRA' | 'CONSUMO_KDS' | 'MERMA' | 'AJUSTE_FISICO' | 'TRANSFERENCIA';

export const CANONICAL_STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  'COMPRA',
  'CONSUMO_KDS',
  'MERMA',
  'AJUSTE_FISICO',
  'TRANSFERENCIA',
] as const;

export interface StockLedgerEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly ingredientId: string;
  readonly movementType: StockMovementType;
  readonly referenceEventId: string;
  readonly quantityDelta: string; // 4-decimal string (negative for exit, positive for entrance)
  readonly unitCost: string; // 4-decimal string
  readonly totalCost: string; // 4-decimal string
  readonly balanceAfter: string; // 4-decimal string
  readonly movementSequenceNumber: string; // BigInt as string
  readonly createdAt: string;
}

export interface RegisterWasteCommand {
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly ingredientId: string;
  readonly quantity: string; // Positive physical waste quantity (4-decimal string)
  readonly reasonCode: string;
  readonly photoAttachmentUrl: string;
  readonly commandId: string;
  readonly notes?: string | null;
  readonly actorId?: string | null;
}

export interface WasteRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly ingredientId: string;
  readonly stockLedgerId: string;
  readonly commandId: string;
  readonly reasonCode: string;
  readonly photoAttachmentUrl: string;
  readonly notes: string | null;
  readonly actorId: string | null;
  readonly createdAt: string;
}

export interface NegativeStockSignal {
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly ingredientId: string;
  readonly balanceAfter: string; // 4-decimal string (< 0)
  readonly timestamp: string;
}

export interface KdsOrderProducedItemDTO {
  readonly productoId: string;
  readonly cantidad: string; // scale-4 decimal string (e.g. "1.0000")
  readonly selectedModifiers?: readonly {
    readonly modifierId: string;
    readonly quantity?: string;
  }[];
}

export interface KdsOrderProducedEventDTO {
  readonly organizacionId: string;
  readonly sucursalId: string;
  readonly centroConsumoId: string; // Maps to warehouseId
  readonly ordenId: string;
  readonly fechaHora: string;
  readonly tiempoPreparacionMinutos: number;
  readonly items: readonly KdsOrderProducedItemDTO[];
}

export interface InventarioDescontadoMovementItem {
  readonly ledgerId: string;
  readonly ingredientId: string;
  readonly quantityDelta: string;
  readonly unitCost: string;
  readonly totalCost: string;
  readonly balanceAfter: string;
}

export interface InventarioDescontadoPorRecetaPayload {
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly ordenId: string;
  readonly movements: readonly InventarioDescontadoMovementItem[];
  readonly negativeStockAlerts: readonly NegativeStockSignal[];
  readonly timestamp: string;
}

export type KdsDepletionResult =
  | {
      readonly status: 'APPLIED';
      readonly ordenId: string;
      readonly movements: readonly StockLedgerEntry[];
      readonly negativeStockAlerts: readonly NegativeStockSignal[];
      readonly outboxEventId: string;
    }
  | {
      readonly status: 'DUPLICATE_ACCEPTED';
      readonly ordenId: string;
      readonly movements: readonly StockLedgerEntry[];
      readonly negativeStockAlerts: readonly NegativeStockSignal[];
      readonly outboxEventId: string;
    }
  | {
      readonly status: 'QUARANTINED';
      readonly ordenId: string;
      readonly quarantineId: string;
      readonly reason: string;
    };

export interface QuarantineRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly sourceEventId: string;
  readonly payload: KdsOrderProducedEventDTO;
  readonly reason: string;
  readonly status: 'PENDING' | 'REPLAYED' | 'REJECTED';
  readonly createdAt: string;
  readonly replayedAt: string | null;
}
