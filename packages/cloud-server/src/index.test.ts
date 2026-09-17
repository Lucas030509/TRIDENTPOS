import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPool, migrateUp, withTenantTransaction } from '@trident/database';
import { RecipeNotFoundError } from '@trident/inventory';
import { PostgresCloudInventoryService } from './index.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-017 Cloud Server Composition & Transaction Boundary Suite', () => {
  const pool = getPool();
  const service = new PostgresCloudInventoryService(pool);

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const categoryAId = crypto.randomUUID();
  const categoryBId = crypto.randomUUID();
  const taxSchemeId = crypto.randomUUID();

  before(async () => {
    // 1. Ensure clean migration state if previous test suite dropped tables
    const prepClient = await pool.connect();
    try {
      const orgCheck = await prepClient.query<{ reg: string | null }>(
        "SELECT to_regclass('organizations') as reg;",
      );
      if (!orgCheck.rows[0]?.reg) {
        await prepClient.query(`
          DROP TABLE IF EXISTS
            recipe_items,
            recipes,
            ingredients,
            warehouses,
            products,
            categories,
            sync_telemetry,
            sync_checkpoints,
            wp012_test_domain_fixtures,
            cloud_integration_dlq,
            cloud_integration_outbox,
            reordering_buffer_queue,
            aggregate_sequences,
            ingested_idempotency_log,
            folio_leases,
            security_telemetry_events,
            audit_log_events,
            stations,
            user_branch_credentials,
            user_roles,
            roles,
            users,
            test_composite_ref,
            branches,
            organizations,
            _migrations CASCADE;
        `);
      }
    } finally {
      prepClient.release();
    }

    // 2. Ensure migrations are applied
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

        INSERT INTO categories (id, organization_id, code, name)
        VALUES
          ('${categoryAId}', '${tenantAId}', 'CAT-017-CA1', 'Category A1'),
          ('${categoryBId}', '${tenantBId}', 'CAT-017-CB1', 'Category B1')
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
        DELETE FROM categories WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM ingredients WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM warehouses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
      `);
    } finally {
      client.release();
    }
  });

  it('WP017-CLOUD-01: Architectural integrity — zero dependency on @trident/pos', () => {
    const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const pkgJsonPath = path.resolve(pkgRoot, 'package.json');
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

    const srcDir = path.resolve(pkgRoot, 'src');
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      assert.ok(
        !/(?:import|require|from)\s+['"]@trident\/pos['"]/.test(content),
        `File src/${file} must NOT import from @trident/pos`,
      );
    }
  });

  it('TX-017-01 & TX-017-02: Public getRecipe operates WITHOUT caller manual BEGIN / setTenantContext', async () => {
    // Seed recipe inside Tenant A via helper
    const recipeId = crypto.randomUUID();
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-TX-01', 'Direct Recipe Test', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
    });

    // Invoke public service method directly without passing client, BEGIN, or setTenantContext
    const recipe = await service.getRecipe(tenantAId, recipeId);
    assert.ok(recipe !== null);
    assert.equal(recipe.id, recipeId);
    assert.equal(recipe.organizationId, tenantAId);
    assert.equal(recipe.code, 'REC-TX-01');
  });

  it('TX-017-03 & WP017-CLOUD-04: Cross-tenant isolation — Tenant B cannot access Tenant A recipe', async () => {
    const recipeId = crypto.randomUUID();
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-TX-03', 'Tenant A Secret Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
    });

    // Query with Tenant B credentials
    const recipeForTenantB = await service.getRecipe(tenantBId, recipeId);
    assert.equal(recipeForTenantB, null, 'Tenant B must receive null for Tenant A recipe');

    await assert.rejects(
      async () => {
        await service.explodeRecipeIngredients(tenantBId, recipeId);
      },
      (err: unknown) => {
        assert(err instanceof RecipeNotFoundError);
        assert.equal(err.recipeId, recipeId);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await service.calculateRecipeCost(tenantBId, recipeId);
      },
      (err: unknown) => {
        assert(err instanceof RecipeNotFoundError);
        assert.equal(err.recipeId, recipeId);
        return true;
      },
    );
  });

  it('TX-017-04: Transaction failure triggers ROLLBACK without partial state mutation', async () => {
    const controlledIngId = crypto.randomUUID();

    // Verify error thrown inside withTenantTransaction rolls back write
    await assert.rejects(async () => {
      await withTenantTransaction(pool, tenantAId, async (client) => {
        await client.query(
          `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
             VALUES ($1, $2, 'ING-FAIL', 'Failing Ingredient', 'KG', 50.0000);`,
          [controlledIngId, tenantAId],
        );
        throw new Error('Controlled transaction failure');
      });
    }, /Controlled transaction failure/);

    // Verify ingredient was rolled back and does not exist
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const check = await client.query(
        `SELECT id FROM ingredients WHERE organization_id = $1 AND id = $2;`,
        [tenantAId, controlledIngId],
      );
      assert.equal(check.rows.length, 0, 'Ingredient must have been rolled back');
    });
  });

  it('TX-017-05: Transaction-local tenant context does not leak into next pooled connection', async () => {
    // 1. Run an operation with Tenant A
    await withTenantTransaction(pool, tenantAId, async (client) => {
      const cfg = await client.query<{ val: string }>(
        "SELECT current_setting('app.current_organization_id', true) AS val;",
      );
      assert.equal(cfg.rows[0]?.val, tenantAId);
    });

    // 2. Grab a raw connection from pool without setting tenant context
    const rawClient = await pool.connect();
    try {
      const check = await rawClient.query<{ val: string }>(
        "SELECT current_setting('app.current_organization_id', true) AS val;",
      );
      assert.equal(
        check.rows[0]?.val,
        '',
        'Transaction-local setting must have reverted, leaving no tenant context leakage',
      );
    } finally {
      rawClient.release();
    }
  });

  it('TX-017-06 & WP017-CLOUD-02: Nested subrecipe explosion executes in a single tenant transaction', async () => {
    const prodId = crypto.randomUUID();
    const parentRecipeId = crypto.randomUUID();
    const subRecipeId = crypto.randomUUID();
    const ingTomatoId = crypto.randomUUID();
    const ingCheeseId = crypto.randomUUID();

    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
         VALUES ($1, $2, $3, 'PROD-PIZZA-TX', 'Pizza Margherita TX', 'COMPOSITE', 150.0000, $4);`,
        [prodId, tenantAId, categoryAId, taxSchemeId],
      );

      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES
           ($1, $2, 'ING-TOM-TX', 'Tomato TX', 'KG', 20.0000),
           ($3, $2, 'ING-CHS-TX', 'Cheese TX', 'KG', 80.0000);`,
        [ingTomatoId, tenantAId, ingCheeseId],
      );

      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, NULL, 'REC-SAUCE-TX', 'Tomato Sauce Batch TX', 2.0000, 'LT');`,
        [subRecipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.1000, 20.0000);`,
        [crypto.randomUUID(), tenantAId, subRecipeId, ingTomatoId],
      );

      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-PIZZA-TX', 'Pizza Recipe TX', 1.0000, 'PZ');`,
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
    });

    // Call public method directly without providing client
    const exploded = await service.explodeRecipeIngredients(tenantAId, parentRecipeId);

    assert.equal(exploded.length, 2);
    const expectedIds = [ingCheeseId, ingTomatoId].sort();
    assert.equal(exploded[0]!.ingredientId, expectedIds[0]);
    assert.equal(exploded[1]!.ingredientId, expectedIds[1]);

    const tomatoExploded = exploded.find((e) => e.ingredientId === ingTomatoId)!;
    assert.equal(tomatoExploded.totalQuantity, '0.1000');
    assert.equal(tomatoExploded.totalGrossQuantity, '0.1100');

    const cheeseExploded = exploded.find((e) => e.ingredientId === ingCheeseId)!;
    assert.equal(cheeseExploded.totalQuantity, '0.1500');
    assert.equal(cheeseExploded.totalGrossQuantity, '0.1500');
  });

  it('TX-017-07 & WP017-CLOUD-03: Theoretical recipe cost calculation within tenant transaction', async () => {
    const prodId = crypto.randomUUID();
    const parentRecipeId = crypto.randomUUID();
    const subRecipeId = crypto.randomUUID();
    const ingTomatoId = crypto.randomUUID();
    const ingCheeseId = crypto.randomUUID();

    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
         VALUES ($1, $2, $3, 'PROD-PIZZA-CST', 'Pizza Cost TX', 'COMPOSITE', 160.0000, $4);`,
        [prodId, tenantAId, categoryAId, taxSchemeId],
      );

      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES
           ($1, $2, 'ING-TOM-CST', 'Tomato Cost', 'KG', 20.0000),
           ($3, $2, 'ING-CHS-CST', 'Cheese Cost', 'KG', 80.0000);`,
        [ingTomatoId, tenantAId, ingCheeseId],
      );

      // Subrecipe Sauce (Yield 2.0000 LT): 1.1000 gross Tomato @ 20.0000 = 22.0000 batch cost. Unit cost = 11.0000/LT
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, NULL, 'REC-SAUCE-CST', 'Sauce Cost', 2.0000, 'LT');`,
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
         VALUES ($1, $2, $3, 'REC-PIZZA-CST', 'Pizza Recipe Cost', 1.0000, 'PZ');`,
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
    });

    // Call public method directly without providing client
    const costResult = await service.calculateRecipeCost(tenantAId, parentRecipeId);

    assert.equal(costResult.recipeId, parentRecipeId);
    assert.equal(costResult.yieldQuantity, '1.0000');
    assert.equal(costResult.totalCost, '14.2000');
    assert.equal(costResult.unitCost, '14.2000');
    assert.equal(costResult.lineItems.length, 2);
  });
});
