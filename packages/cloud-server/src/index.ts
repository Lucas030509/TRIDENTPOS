/**
 * TRIDENTPOS Cloud Server Composition Root
 *
 * Provides Cloud-tier application services wiring PostgreSQL repositories
 * to pure domain calculation engines under strict tenant context (RLS).
 *
 * HTTP route naming: NOT FROZEN / NOT INVENTED BY BUILDER.
 * Architectural governance: Layer 4 Composition Root.
 * Zero dependency on @trident/pos per WP-017 / ACR-2026-013.
 */

import type pg from 'pg';
import {
  RecipeEngine,
  type Recipe,
  type RecipeItem,
  type ExplodedIngredient,
  type RecipeCostCalculationResult,
  RecipeNotFoundError,
} from '@trident/inventory';
import { setTenantContext } from '@trident/database';

export interface CloudInventoryCompositionService {
  getRecipe(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<Recipe | null>;
  getIngredientAverageCost(
    client: pg.PoolClient,
    organizationId: string,
    ingredientId: string,
  ): Promise<string>;
  explodeRecipeIngredients(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]>;
  calculateRecipeCost(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult>;
}

export class PostgresCloudInventoryService implements CloudInventoryCompositionService {
  /**
   * Fetches a Recipe with its RecipeItems from PostgreSQL within tenant context.
   * RLS automatically ensures cross-tenant isolation.
   */
  public async getRecipe(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<Recipe | null> {
    await setTenantContext(client, organizationId);

    const recipeRes = await client.query<{
      id: string;
      organization_id: string;
      product_id: string | null;
      code: string;
      name: string;
      yield_quantity: string;
      yield_unit: string;
      total_cost: string;
      is_active: boolean;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, organization_id, product_id, code, name, yield_quantity::text, yield_unit, total_cost::text, is_active, created_at, updated_at
       FROM recipes
       WHERE organization_id = $1 AND id = $2;`,
      [organizationId, recipeId],
    );

    if (recipeRes.rows.length === 0) {
      return null;
    }

    const r = recipeRes.rows[0]!;

    const itemsRes = await client.query<{
      id: string;
      organization_id: string;
      recipe_id: string;
      ingredient_id: string | null;
      sub_recipe_id: string | null;
      quantity: string;
      gross_quantity: string;
      unit_cost_snapshot: string;
      created_at: Date | string;
    }>(
      `SELECT id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity::text, gross_quantity::text, unit_cost_snapshot::text, created_at
       FROM recipe_items
       WHERE organization_id = $1 AND recipe_id = $2
       ORDER BY created_at ASC, id ASC;`,
      [organizationId, recipeId],
    );

    const items: RecipeItem[] = itemsRes.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      recipeId: row.recipe_id,
      ingredientId: row.ingredient_id,
      subRecipeId: row.sub_recipe_id,
      quantity: row.quantity,
      grossQuantity: row.gross_quantity,
      unitCostSnapshot: row.unit_cost_snapshot,
      createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    }));

    return {
      id: r.id,
      organizationId: r.organization_id,
      productId: r.product_id,
      code: r.code,
      name: r.name,
      yieldQuantity: r.yield_quantity,
      yieldUnit: r.yield_unit,
      totalCost: r.total_cost,
      isActive: r.is_active,
      items,
      createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
    };
  }

  /**
   * Retrieves current_average_cost for an ingredient from PostgreSQL within tenant context.
   */
  public async getIngredientAverageCost(
    client: pg.PoolClient,
    organizationId: string,
    ingredientId: string,
  ): Promise<string> {
    await setTenantContext(client, organizationId);

    const res = await client.query<{ current_average_cost: string }>(
      `SELECT current_average_cost::text FROM ingredients WHERE organization_id = $1 AND id = $2;`,
      [organizationId, ingredientId],
    );

    if (res.rows.length === 0) {
      throw new Error(`Ingredient '${ingredientId}' not found in organization '${organizationId}'`);
    }

    return res.rows[0]!.current_average_cost;
  }

  /**
   * Explodes recipe into base raw materials using recursive DB lookups and RecipeEngine.
   */
  public async explodeRecipeIngredients(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]> {
    const rootRecipe = await this.getRecipe(client, organizationId, recipeId);
    if (!rootRecipe) {
      throw new RecipeNotFoundError(recipeId);
    }

    const recipeResolver = async (subId: string) => {
      return this.getRecipe(client, organizationId, subId);
    };

    return RecipeEngine.explodeIngredients(rootRecipe, recipeResolver);
  }

  /**
   * Computes theoretical recipe costing using real average costs from PostgreSQL.
   */
  public async calculateRecipeCost(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult> {
    const rootRecipe = await this.getRecipe(client, organizationId, recipeId);
    if (!rootRecipe) {
      throw new RecipeNotFoundError(recipeId);
    }

    const costResolver = {
      getIngredientCost: async (ingId: string) => {
        return this.getIngredientAverageCost(client, organizationId, ingId);
      },
      getSubRecipe: async (subId: string) => {
        return this.getRecipe(client, organizationId, subId);
      },
    };

    return RecipeEngine.calculateRecipeCost(rootRecipe, costResolver);
  }
}
