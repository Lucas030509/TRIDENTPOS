import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { getPool, setTenantContext, migrateUp } from '@trident/database';
import { RecipeNotFoundError } from '@trident/inventory';
import { PostgresCloudInventoryService } from './index.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-017 Cloud Server Composition & Application Suite', () => {
  const pool = getPool();
  const service = new PostgresCloudInventoryService();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();

  before(async () => {
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP017 Cloud Org A', 'Cloud Org A', 'TAX-WP017-CA-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'WP017 Cloud Org B', 'Cloud Org B', 'TAX-WP017-CB-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-017-CA1', 'Cloud Branch A1'),
          ('${branchBId}', '${tenantBId}', 'BR-017-CB1', 'Cloud Branch B1')
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM recipe_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM recipes WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM products WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM ingredients WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM warehouses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
      `);
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('WP017-CLOUD-01: Architectural integrity — zero dependency on @trident/pos', () => {
    const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    const allDeclaredDeps = [
      ...Object.keys(pkgJson.dependencies || {}),
      ...Object.keys(pkgJson.devDependencies || {}),
      ...Object.keys(pkgJson.peerDependencies || {}),
    ];

    assert.ok(
      !allDeclaredDeps.includes('@trident/pos'),
      '@trident/cloud-server package.json must not declare @trident/pos',
    );

    const srcDir = path.resolve(process.cwd(), 'src');
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      assert.ok(
        !/(?:import|require|from)\s+['"]@trident\/pos['"]/.test(content),
        `File src/${file} must NOT import from @trident/pos`,
      );
    }
  });

  it('WP017-CLOUD-02: Deterministic subrecipe explosion with nested PostgreSQL records', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const prodId = crypto.randomUUID();
      const parentRecipeId = crypto.randomUUID();
      const subRecipeId = crypto.randomUUID();
      const ingTomatoId = crypto.randomUUID();
      const ingCheeseId = crypto.randomUUID();

      // 1. Seed Product
      await client.query(
        `INSERT INTO products (id, organization_id, code, name, base_price) VALUES ($1, $2, 'PROD-PIZZA', 'Pizza Margherita', 150.0000);`,
        [prodId, tenantAId],
      );

      // 2. Seed Ingredients
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES
           ($1, $2, 'ING-TOM', 'Tomato', 'KG', 20.0000),
           ($3, $2, 'ING-CHS', 'Cheese', 'KG', 80.0000);`,
        [ingTomatoId, tenantAId, ingCheeseId],
      );

      // 3. Seed Subrecipe (Tomato Sauce batch, yield 2.0000 LT)
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, NULL, 'REC-SAUCE', 'Tomato Sauce Batch', 2.0000, 'LT');`,
        [subRecipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.1000, 20.0000);`,
        [crypto.randomUUID(), tenantAId, subRecipeId, ingTomatoId],
      );

      // 4. Seed Parent Recipe (Pizza, yield 1.0000 PZ, consumes 0.2000 LT Sauce + 0.1500 KG Cheese)
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-PIZZA', 'Pizza Recipe', 1.0000, 'PZ');`,
        [parentRecipeId, tenantAId, prodId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES
           ($1, $2, $3, NULL, $4, 0.2000, 0.2000, 0.0000),
           ($5, $2, $3, $6, NULL, 0.1500, 0.1500, 80.0000);`,
        [
          crypto.randomUUID(),
          tenantAId,
          parentRecipeId,
          subRecipeId,
          crypto.randomUUID(),
          ingCheeseId,
        ],
      );

      // 5. Execute explosion via service
      const exploded = await service.explodeRecipeIngredients(client, tenantAId, parentRecipeId);

      assert.equal(exploded.length, 2);
      // Sorted deterministically by ingredientId
      const expectedIds = [ingCheeseId, ingTomatoId].sort();
      assert.equal(exploded[0]!.ingredientId, expectedIds[0]);
      assert.equal(exploded[1]!.ingredientId, expectedIds[1]);

      const tomatoExploded = exploded.find((e) => e.ingredientId === ingTomatoId)!;
      // 0.2000 consumed / 2.0000 subrecipe yield = 0.1000 factor. Net = 0.1000 * 1.0000 = 0.1000, Gross = 0.1000 * 1.1000 = 0.1100
      assert.equal(tomatoExploded.totalQuantity, '0.1000');
      assert.equal(tomatoExploded.totalGrossQuantity, '0.1100');

      const cheeseExploded = exploded.find((e) => e.ingredientId === ingCheeseId)!;
      assert.equal(cheeseExploded.totalQuantity, '0.1500');
      assert.equal(cheeseExploded.totalGrossQuantity, '0.1500');

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-CLOUD-03: Theoretical recipe cost calculation using PostgreSQL average costs', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const prodId = crypto.randomUUID();
      const parentRecipeId = crypto.randomUUID();
      const subRecipeId = crypto.randomUUID();
      const ingTomatoId = crypto.randomUUID();
      const ingCheeseId = crypto.randomUUID();

      await client.query(
        `INSERT INTO products (id, organization_id, code, name, base_price) VALUES ($1, $2, 'PROD-PIZZA-2', 'Pizza 2', 160.0000);`,
        [prodId, tenantAId],
      );

      // Tomato avg cost = 20.0000/KG, Cheese avg cost = 80.0000/KG
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES
           ($1, $2, 'ING-TOM-2', 'Tomato 2', 'KG', 20.0000),
           ($3, $2, 'ING-CHS-2', 'Cheese 2', 'KG', 80.0000);`,
        [ingTomatoId, tenantAId, ingCheeseId],
      );

      // Subrecipe Sauce (Yield 2.0000 LT): 1.1000 gross Tomato @ 20.0000 = 22.0000 batch cost. Unit cost = 11.0000/LT
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, NULL, 'REC-SAUCE-2', 'Sauce 2', 2.0000, 'LT');`,
        [subRecipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.1000, 20.0000);`,
        [crypto.randomUUID(), tenantAId, subRecipeId, ingTomatoId],
      );

      // Parent Pizza (Yield 1.0000 PZ):
      // - 0.2000 LT Sauce @ 11.0000 = 2.2000
      // - 0.1500 KG Cheese @ 80.0000 = 12.0000
      // Total Batch = 14.2000, Unit Cost = 14.2000
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-PIZZA-2', 'Pizza Recipe 2', 1.0000, 'PZ');`,
        [parentRecipeId, tenantAId, prodId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES
           ($1, $2, $3, NULL, $4, 0.2000, 0.2000, 0.0000),
           ($5, $2, $3, $6, NULL, 0.1500, 0.1500, 80.0000);`,
        [
          crypto.randomUUID(),
          tenantAId,
          parentRecipeId,
          subRecipeId,
          crypto.randomUUID(),
          ingCheeseId,
        ],
      );

      const costResult = await service.calculateRecipeCost(client, tenantAId, parentRecipeId);

      assert.equal(costResult.recipeId, parentRecipeId);
      assert.equal(costResult.yieldQuantity, '1.0000');
      assert.equal(costResult.totalCost, '14.2000');
      assert.equal(costResult.unitCost, '14.2000');
      assert.equal(costResult.lineItems.length, 2);

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-CLOUD-04: Cross-tenant RLS isolation fails closed against unauthorized tenant access', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');

      // Seed Recipe in Org A
      await setTenantContext(client, tenantAId);
      const recipeAId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-ORG-A', 'Org A Recipe', 1.0000, 'PZ');`,
        [recipeAId, tenantAId],
      );

      // Attempt to access Org A recipe using Tenant B context -> RecipeNotFoundError
      await assert.rejects(
        async () => {
          await service.explodeRecipeIngredients(client, tenantBId, recipeAId);
        },
        (err: unknown) => {
          assert(err instanceof RecipeNotFoundError);
          assert.equal(err.recipeId, recipeAId);
          return true;
        },
      );

      await assert.rejects(
        async () => {
          await service.calculateRecipeCost(client, tenantBId, recipeAId);
        },
        (err: unknown) => {
          assert(err instanceof RecipeNotFoundError);
          assert.equal(err.recipeId, recipeAId);
          return true;
        },
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });
});
