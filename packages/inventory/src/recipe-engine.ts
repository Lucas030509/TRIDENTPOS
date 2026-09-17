/**
 * TRIDENTPOS Recipe Explosion & Cost Calculation Engine
 *
 * Implements pure domain algorithms for:
 * 1. Recursive subrecipe explosion to base raw ingredients.
 * 2. Deterministic duplicate ingredient aggregation.
 * 3. Direct and indirect cycle detection in recipe graphs.
 * 4. Theoretical recipe unit and batch costing using current average cost.
 * 5. Zero-divisor protection and zero-cost ingredient handling.
 */

import type {
  ExplodedIngredient,
  Recipe,
  RecipeCostCalculationResult,
  RecipeItem,
  RecipeItemCostBreakdown,
} from './types.js';
import {
  CycleDetectedError,
  InvalidRecipeItemError,
  RecipeNotFoundError,
  ZeroDivisorError,
} from './errors.js';
import { divideScale4, formatDecimal12x4, multiplyScale4, parseDecimal12x4 } from './numerics.js';

export type RecipeResolverFn = (recipeId: string) => Promise<Recipe | null> | Recipe | null;
export type IngredientCostResolverFn = (ingredientId: string) => Promise<string> | string;

export interface RecipeCostResolver {
  readonly getIngredientCost: IngredientCostResolverFn;
  readonly getSubRecipe: RecipeResolverFn;
}

export class RecipeEngine {
  /**
   * Recursively explodes a recipe into its constituent base raw ingredients.
   * Duplicate ingredients across different branches are deterministically aggregated.
   * Throws CycleDetectedError upon encountering direct or indirect recursion.
   */
  public static async explodeIngredients(
    recipe: Recipe,
    recipeResolver: RecipeResolverFn,
  ): Promise<readonly ExplodedIngredient[]> {
    const ingredientMap = new Map<string, { netScaled: bigint; grossScaled: bigint }>();
    const visitedStack = [recipe.id];

    await RecipeEngine.#explodeRecursive(
      recipe,
      10000n, // Initial scale-4 factor = 1.0000
      recipeResolver,
      visitedStack,
      ingredientMap,
    );

    // Return deterministically sorted by ingredientId
    const sortedIds = Array.from(ingredientMap.keys()).sort();
    return sortedIds.map((id) => {
      const entry = ingredientMap.get(id)!;
      return {
        ingredientId: id,
        totalQuantity: formatDecimal12x4(entry.netScaled),
        totalGrossQuantity: formatDecimal12x4(entry.grossScaled),
      };
    });
  }

  static async #explodeRecursive(
    currentRecipe: Recipe,
    factorScale4: bigint,
    recipeResolver: RecipeResolverFn,
    visitedStack: string[],
    acc: Map<string, { netScaled: bigint; grossScaled: bigint }>,
  ): Promise<void> {
    if (!currentRecipe.yieldQuantity) {
      throw new ZeroDivisorError(
        `Recipe '${currentRecipe.id}' has invalid or missing yieldQuantity '${currentRecipe.yieldQuantity}'`,
      );
    }
    const recipeYieldScaled = parseDecimal12x4(currentRecipe.yieldQuantity);
    if (recipeYieldScaled <= 0n) {
      throw new ZeroDivisorError(
        `Recipe '${currentRecipe.id}' has invalid or non-positive yieldQuantity '${currentRecipe.yieldQuantity}'`,
      );
    }

    for (const item of currentRecipe.items) {
      RecipeEngine.#validateRecipeItem(item);

      const itemNetScaled = parseDecimal12x4(item.quantity);
      const itemGrossScaled = parseDecimal12x4(item.grossQuantity);

      // Multiplier relative to current recipe yield: factor * (itemQuantity / recipeYield)
      // Effective scale = (factor * itemQuantity) / recipeYield
      const effectiveNet = divideScale4(
        multiplyScale4(factorScale4, itemNetScaled),
        recipeYieldScaled,
      );
      const effectiveGross = divideScale4(
        multiplyScale4(factorScale4, itemGrossScaled),
        recipeYieldScaled,
      );

      if (item.ingredientId) {
        // Base raw material leaf node
        const existing = acc.get(item.ingredientId) ?? { netScaled: 0n, grossScaled: 0n };
        acc.set(item.ingredientId, {
          netScaled: existing.netScaled + effectiveNet,
          grossScaled: existing.grossScaled + effectiveGross,
        });
      } else if (item.subRecipeId) {
        // Subrecipe node — cycle detection guard
        if (visitedStack.includes(item.subRecipeId)) {
          const cyclePath = [...visitedStack, item.subRecipeId];
          throw new CycleDetectedError(cyclePath);
        }

        const subRecipe = await recipeResolver(item.subRecipeId);
        if (!subRecipe) {
          throw new RecipeNotFoundError(item.subRecipeId);
        }

        visitedStack.push(item.subRecipeId);
        try {
          await RecipeEngine.#explodeRecursive(
            subRecipe,
            effectiveGross, // Subrecipe expands proportionally to gross quantity consumed
            recipeResolver,
            visitedStack,
            acc,
          );
        } finally {
          visitedStack.pop();
        }
      }
    }
  }

  /**
   * Calculates theoretical recipe cost using current average cost for ingredients
   * and recursive costing for subrecipes.
   */
  public static async calculateRecipeCost(
    recipe: Recipe,
    resolver: RecipeCostResolver,
  ): Promise<RecipeCostCalculationResult> {
    const visitedStack = [recipe.id];
    return RecipeEngine.#calculateCostRecursive(recipe, resolver, visitedStack);
  }

  static async #calculateCostRecursive(
    currentRecipe: Recipe,
    resolver: RecipeCostResolver,
    visitedStack: string[],
  ): Promise<RecipeCostCalculationResult> {
    if (!currentRecipe.yieldQuantity) {
      throw new ZeroDivisorError(
        `Cannot calculate recipe cost: Recipe '${currentRecipe.id}' has missing yieldQuantity`,
      );
    }
    const yieldScaled = parseDecimal12x4(currentRecipe.yieldQuantity);
    if (yieldScaled <= 0n) {
      throw new ZeroDivisorError(
        `Cannot calculate recipe cost: Recipe '${currentRecipe.id}' has non-positive yieldQuantity '${currentRecipe.yieldQuantity}'`,
      );
    }

    let totalBatchCostScaled = 0n;
    const lineItems: RecipeItemCostBreakdown[] = [];

    for (const item of currentRecipe.items) {
      RecipeEngine.#validateRecipeItem(item);

      const grossQtyScaled = parseDecimal12x4(item.grossQuantity);
      if (grossQtyScaled < 0n) {
        throw new InvalidRecipeItemError(
          `Recipe item grossQuantity cannot be negative: '${item.grossQuantity}'`,
        );
      }

      if (item.ingredientId) {
        const costStr = await resolver.getIngredientCost(item.ingredientId);
        if (costStr === undefined || costStr === null || costStr === '') {
          throw new InvalidRecipeItemError(
            `Missing cost for ingredient '${item.ingredientId}' in recipe '${currentRecipe.id}'`,
          );
        }
        const unitCostScaled = parseDecimal12x4(costStr);
        if (unitCostScaled < 0n) {
          throw new InvalidRecipeItemError(`Ingredient cost cannot be negative: '${costStr}'`);
        }

        const lineCostScaled = multiplyScale4(grossQtyScaled, unitCostScaled);
        totalBatchCostScaled += lineCostScaled;

        lineItems.push({
          id: item.id,
          targetType: 'INGREDIENT',
          targetId: item.ingredientId,
          grossQuantity: item.grossQuantity,
          unitCost: formatDecimal12x4(unitCostScaled),
          totalLineCost: formatDecimal12x4(lineCostScaled),
        });
      } else if (item.subRecipeId) {
        if (visitedStack.includes(item.subRecipeId)) {
          const cyclePath = [...visitedStack, item.subRecipeId];
          throw new CycleDetectedError(cyclePath);
        }

        const subRecipe = await resolver.getSubRecipe(item.subRecipeId);
        if (!subRecipe) {
          throw new RecipeNotFoundError(item.subRecipeId);
        }

        visitedStack.push(item.subRecipeId);
        let subCostResult: RecipeCostCalculationResult;
        try {
          subCostResult = await RecipeEngine.#calculateCostRecursive(
            subRecipe,
            resolver,
            visitedStack,
          );
        } finally {
          visitedStack.pop();
        }

        const subUnitCostScaled = parseDecimal12x4(subCostResult.unitCost);
        const lineCostScaled = multiplyScale4(grossQtyScaled, subUnitCostScaled);
        totalBatchCostScaled += lineCostScaled;

        lineItems.push({
          id: item.id,
          targetType: 'SUB_RECIPE',
          targetId: item.subRecipeId,
          grossQuantity: item.grossQuantity,
          unitCost: subCostResult.unitCost,
          totalLineCost: formatDecimal12x4(lineCostScaled),
        });
      }
    }

    const unitCostScaled = divideScale4(totalBatchCostScaled, yieldScaled);

    return {
      recipeId: currentRecipe.id,
      totalCost: formatDecimal12x4(totalBatchCostScaled),
      unitCost: formatDecimal12x4(unitCostScaled),
      yieldQuantity: currentRecipe.yieldQuantity,
      lineItems,
    };
  }

  static #validateRecipeItem(item: RecipeItem): void {
    const hasIngredient = Boolean(item.ingredientId);
    const hasSubRecipe = Boolean(item.subRecipeId);

    // Database XOR CHECK constraint mirror
    if ((hasIngredient && hasSubRecipe) || (!hasIngredient && !hasSubRecipe)) {
      throw new InvalidRecipeItemError(
        `Recipe item '${item.id}' violates exclusive target constraint: exactly one of ingredientId or subRecipeId must be set.`,
      );
    }
  }
}

/**
 * Functional convenience alias for RecipeEngine.explodeIngredients.
 */
export async function explodeIngredients(
  recipe: Recipe,
  recipeResolver: RecipeResolverFn,
): Promise<readonly ExplodedIngredient[]> {
  return RecipeEngine.explodeIngredients(recipe, recipeResolver);
}

/**
 * Functional convenience alias for RecipeEngine.calculateRecipeCost.
 */
export async function calculateRecipeCost(
  recipe: Recipe,
  resolver: RecipeCostResolver,
): Promise<RecipeCostCalculationResult> {
  return RecipeEngine.calculateRecipeCost(recipe, resolver);
}
