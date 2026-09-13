/**
 * TRIDENTPOS Inventory & Recipes Domain Types
 * Conforms to DATA_MODEL.md Sec 2.3, ADR-013, and MODULE_CATALOG.md.
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
