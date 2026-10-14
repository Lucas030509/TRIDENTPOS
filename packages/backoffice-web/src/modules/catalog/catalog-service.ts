/**
 * TRIDENTPOS WP-024: Catalog & Recipe Builder Service
 * Formulates recipe ingredients with waste/merma factors, portion costing, and suggested price calculations.
 */

import type { CategoryItem, ProductItem, RecipeDefinition, RecipeItemEntry } from '../../types.js';
import {
  toScale4BigInt,
  fromScale4BigInt,
  addScale4,
  multiplyScale4,
  divideScale4,
  calculatePortionCostScale4,
  calculateGrossQuantityScale4,
} from '../../numerics.js';

export interface CreateRecipeItemParams {
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  unitOfMeasure: string;
  netQuantityScale4: string;
  wasteFactorPercent: string; // e.g. "5.0000" for 5%
  unitCostScale4: string;
}

export interface FormulateRecipeParams {
  productId: string;
  productName: string;
  portionYield: number;
  items: readonly CreateRecipeItemParams[];
  targetMarginPercent: string; // e.g. "65.0000" for 65% target margin
}

export class CatalogService {
  private categories: CategoryItem[] = [];
  private products: ProductItem[] = [];
  private recipes: Map<string, RecipeDefinition> = new Map();

  constructor(initialData?: {
    categories?: CategoryItem[];
    products?: ProductItem[];
    recipes?: RecipeDefinition[];
  }) {
    if (initialData?.categories) this.categories = [...initialData.categories];
    if (initialData?.products) this.products = [...initialData.products];
    if (initialData?.recipes) {
      for (const recipe of initialData.recipes) {
        this.recipes.set(recipe.productId, recipe);
      }
    }
  }

  public getCategories(): readonly CategoryItem[] {
    return this.categories;
  }

  public getProducts(categoryId?: string): readonly ProductItem[] {
    if (categoryId) {
      return this.products.filter((p) => p.categoryId === categoryId);
    }
    return this.products;
  }

  public getRecipe(productId: string): RecipeDefinition | undefined {
    return this.recipes.get(productId);
  }

  /**
   * Formulates recipe by computing gross quantities, ingredient line costs,
   * portion costs, and suggested retail price based on target food cost margin.
   */
  public formulateRecipe(params: FormulateRecipeParams): RecipeDefinition {
    if (params.portionYield <= 0) {
      throw new Error('Portion yield must be greater than zero');
    }

    let totalBatchCostScale4 = '0.0000';
    const computedItems: RecipeItemEntry[] = [];

    for (const item of params.items) {
      // 1. Calculate Gross Quantity considering waste / merma
      const grossQuantityScale4 = calculateGrossQuantityScale4(
        item.netQuantityScale4,
        item.wasteFactorPercent,
      );

      // 2. Line subtotal = grossQuantity * unitCost
      const subtotalCostScale4 = multiplyScale4(grossQuantityScale4, item.unitCostScale4);

      computedItems.push({
        ingredientId: item.ingredientId,
        ingredientCode: item.ingredientCode,
        ingredientName: item.ingredientName,
        unitOfMeasure: item.unitOfMeasure,
        grossQuantityScale4,
        netQuantityScale4: item.netQuantityScale4,
        wasteFactorPercent: item.wasteFactorPercent,
        unitCostScale4: item.unitCostScale4,
        subtotalCostScale4,
      });

      totalBatchCostScale4 = addScale4(totalBatchCostScale4, subtotalCostScale4);
    }

    // 3. Portion cost = totalBatchCost / portionYield
    const portionCostScale4 = calculatePortionCostScale4(totalBatchCostScale4, params.portionYield);

    // 4. Suggested price based on target food margin:
    // FoodCost% = 100% - Margin%
    // SuggestedPrice = PortionCost / (FoodCost% / 100)
    let suggestedPriceScale4 = portionCostScale4;
    const marginBig = toScale4BigInt(params.targetMarginPercent);
    const hundredBig = 100n * 10000n;

    if (marginBig > 0n && marginBig < hundredBig) {
      const foodCostFactorScale4 = fromScale4BigInt(hundredBig - marginBig);
      const numerator = multiplyScale4(portionCostScale4, '100.0000');
      suggestedPriceScale4 = divideScale4(numerator, foodCostFactorScale4);
    }

    const recipe: RecipeDefinition = {
      id: `rcp-${params.productId}`,
      productId: params.productId,
      productName: params.productName,
      portionYield: params.portionYield,
      items: computedItems,
      totalBatchCostScale4,
      portionCostScale4,
      targetMarginPercent: params.targetMarginPercent,
      suggestedPriceScale4,
    };

    this.recipes.set(params.productId, recipe);
    return recipe;
  }
}
