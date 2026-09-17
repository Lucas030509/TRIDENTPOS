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
import { getPool, withTenantTransaction } from '@trident/database';

export interface CloudInventoryCompositionService {
  getRecipe(organizationId: string, recipeId: string): Promise<Recipe | null>;
  getIngredientAverageCost(organizationId: string, ingredientId: string): Promise<string>;
  explodeRecipeIngredients(
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]>;
  calculateRecipeCost(
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult>;
}

export class PostgresCloudInventoryService implements CloudInventoryCompositionService {
  private readonly pool: pg.Pool;

  public constructor(pool?: pg.Pool) {
    this.pool = pool ?? getPool();
  }

  /**
   * Fetches a Recipe with its RecipeItems within a tenant transaction boundary.
   */
  public async getRecipe(organizationId: string, recipeId: string): Promise<Recipe | null> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getRecipeWithClient(client, organizationId, recipeId);
    });
  }

  /**
   * Retrieves current_average_cost for an ingredient within a tenant transaction boundary.
   */
  public async getIngredientAverageCost(
    organizationId: string,
    ingredientId: string,
  ): Promise<string> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      return this.getIngredientAverageCostWithClient(client, organizationId, ingredientId);
    });
  }

  /**
   * Explodes recipe into base raw materials within a single tenant transaction.
   * Recursive subrecipe lookups execute within the same active transaction.
   */
  public async explodeRecipeIngredients(
    organizationId: string,
    recipeId: string,
  ): Promise<readonly ExplodedIngredient[]> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const rootRecipe = await this.getRecipeWithClient(client, organizationId, recipeId);
      if (!rootRecipe) {
        throw new RecipeNotFoundError(recipeId);
      }

      const recipeResolver = async (subId: string) => {
        return this.getRecipeWithClient(client, organizationId, subId);
      };

      return RecipeEngine.explodeIngredients(rootRecipe, recipeResolver);
    });
  }

  /**
   * Computes theoretical recipe costing within a single tenant transaction.
   * Recursive subrecipe and ingredient lookups execute within the same active transaction.
   */
  public async calculateRecipeCost(
    organizationId: string,
    recipeId: string,
  ): Promise<RecipeCostCalculationResult> {
    return withTenantTransaction(this.pool, organizationId, async (client) => {
      const rootRecipe = await this.getRecipeWithClient(client, organizationId, recipeId);
      if (!rootRecipe) {
        throw new RecipeNotFoundError(recipeId);
      }

      const costResolver = {
        getIngredientCost: async (ingId: string) => {
          return this.getIngredientAverageCostWithClient(client, organizationId, ingId);
        },
        getSubRecipe: async (subId: string) => {
          return this.getRecipeWithClient(client, organizationId, subId);
        },
      };

      return RecipeEngine.calculateRecipeCost(rootRecipe, costResolver);
    });
  }

  /**
   * Internal helper to fetch a Recipe using an existing transaction-scoped client.
   */
  private async getRecipeWithClient(
    client: pg.PoolClient,
    organizationId: string,
    recipeId: string,
  ): Promise<Recipe | null> {
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
   * Internal helper to retrieve ingredient average cost using an existing transaction-scoped client.
   */
  private async getIngredientAverageCostWithClient(
    client: pg.PoolClient,
    organizationId: string,
    ingredientId: string,
  ): Promise<string> {
    const res = await client.query<{ current_average_cost: string }>(
      `SELECT current_average_cost::text FROM ingredients WHERE organization_id = $1 AND id = $2;`,
      [organizationId, ingredientId],
    );

    if (res.rows.length === 0) {
      throw new Error(`Ingredient '${ingredientId}' not found in organization '${organizationId}'`);
    }

    return res.rows[0]!.current_average_cost;
  }
}
