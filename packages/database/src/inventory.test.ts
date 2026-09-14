import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { getPool } from './connection.js';
import { migrateUp } from './runner.js';
import { setTenantContext } from './tenant.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-017 Inventory & Recipes Database Suite', () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const testRole = 'trident_wp017_test_role';

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // Rollback safety
      }
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Reset role safety
      }
      client.release();
    }
  }

  async function assertQueryRejects(
    client: pg.PoolClient,
    sql: string,
    params: unknown[],
    pattern: RegExp,
  ): Promise<void> {
    await client.query('SAVEPOINT sp_neg;');
    try {
      await client.query(sql, params);
      await client.query('RELEASE SAVEPOINT sp_neg;');
      assert.fail('Expected query to fail but it succeeded');
    } catch (err: unknown) {
      await client.query('ROLLBACK TO SAVEPOINT sp_neg;');
      assert(err instanceof Error);
      assert.match(err.message, pattern);
    }
  }

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

    // 2. Ensure all migrations up to WP-017 are applied
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      // Create test role with NOSUPERUSER NOBYPASSRLS
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            CREATE ROLE ${testRole} NOSUPERUSER NOBYPASSRLS NOINHERIT;
          END IF;
        END
        $$;

        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${testRole};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${testRole};

        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP017 Org A', 'Org A', 'TAX-WP017-A-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'WP017 Org B', 'Org B', 'TAX-WP017-B-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-017-A1', 'Branch 017 A1'),
          ('${branchBId}', '${tenantBId}', 'BR-017-B1', 'Branch 017 B1')
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

        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            EXECUTE 'DROP OWNED BY ${testRole}';
            EXECUTE 'DROP ROLE ${testRole}';
          END IF;
        END
        $$;
      `);
    } finally {
      client.release();
    }
  });

  it('WP017-DB-01: Canonical inventory tables exist and no duplicate Spanish tables exist', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('warehouses', 'ingredients', 'recipes', 'recipe_items', 'products', 'almacenes', 'insumos', 'recetas', 'subrecetas');
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    assert.ok(tableNames.includes('products'), 'products table must exist');
    assert.ok(tableNames.includes('warehouses'), 'warehouses table must exist');
    assert.ok(tableNames.includes('ingredients'), 'ingredients table must exist');
    assert.ok(tableNames.includes('recipes'), 'recipes table must exist');
    assert.ok(tableNames.includes('recipe_items'), 'recipe_items table must exist');

    assert.ok(
      !tableNames.includes('almacenes'),
      'duplicate Spanish table almacenes must NOT exist',
    );
    assert.ok(!tableNames.includes('insumos'), 'duplicate Spanish table insumos must NOT exist');
    assert.ok(!tableNames.includes('recetas'), 'duplicate Spanish table recetas must NOT exist');
    assert.ok(
      !tableNames.includes('subrecetas'),
      'duplicate Spanish table subrecetas must NOT exist',
    );
  });

  it('WP017-DB-02: RLS and FORCE RLS are enabled on all canonical tables', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('warehouses', 'ingredients', 'recipes', 'recipe_items', 'products');
    `);

    assert.equal(res.rows.length, 5);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
      assert.equal(row.relforcerowsecurity, true, `FORCE RLS must be enabled on ${row.relname}`);
    }
  });

  it('WP017-DB-03: chk_recipe_items_exclusive_source XOR constraint enforces mutual exclusivity', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();
      const subRecipeId = crypto.randomUUID();

      // Insert parent recipe, sub recipe, and ingredient
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, 'REC-PAR', 'Parent Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, 'REC-SUB', 'Sub Recipe', 1.0000, 'PZ');`,
        [subRecipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES ($1, $2, 'ING-01', 'Ingredient 1', 'KG', 10.0000);`,
        [ingredientId, tenantAId],
      );

      // 1. Setting BOTH ingredient_id and sub_recipe_id MUST FAIL
      await assertQueryRejects(
        client,
        `
          INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
          VALUES ($1, $2, $3, $4, $5, 1.0000, 1.0000, 10.0000);
        `,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId, subRecipeId],
        /chk_recipe_items_exclusive_source/,
      );

      // 2. Setting NEITHER ingredient_id nor sub_recipe_id (both NULL) MUST FAIL
      await assertQueryRejects(
        client,
        `
          INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
          VALUES ($1, $2, $3, NULL, NULL, 1.0000, 1.0000, 10.0000);
        `,
        [crypto.randomUUID(), tenantAId, recipeId],
        /chk_recipe_items_exclusive_source/,
      );

      // 3. Setting ONLY ingredient_id SUCCEEDS
      const ingItemId = crypto.randomUUID();
      const ingRes = await client.query(
        `
        INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
        VALUES ($1, $2, $3, $4, NULL, 0.5000, 0.5500, 10.0000)
        RETURNING id;
      `,
        [ingItemId, tenantAId, recipeId, ingredientId],
      );
      assert.equal(ingRes.rows[0].id, ingItemId);

      // 4. Setting ONLY sub_recipe_id SUCCEEDS
      const subItemId = crypto.randomUUID();
      const subRes = await client.query(
        `
        INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
        VALUES ($1, $2, $3, NULL, $4, 0.2000, 0.2000, 5.0000)
        RETURNING id;
      `,
        [subItemId, tenantAId, recipeId, subRecipeId],
      );
      assert.equal(subRes.rows[0].id, subItemId);

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-DB-04: Composite foreign keys enforce cross-tenant isolation fail-closed', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');

      const recAId = crypto.randomUUID();
      const ingBId = crypto.randomUUID();
      const recBId = crypto.randomUUID();

      // Seed Org A recipe and Org B ingredient & recipe
      await setTenantContext(client, tenantAId);
      await client.query(
        `
        INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
        VALUES ($1, $2, 'REC-A', 'Recipe A', 1.0000, 'PZ');
      `,
        [recAId, tenantAId],
      );

      await setTenantContext(client, tenantBId);
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES ($1, $2, 'ING-B', 'Ingredient B', 'KG', 25.0000);`,
        [ingBId, tenantBId],
      );
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, 'REC-B', 'Recipe B', 1.0000, 'PZ');`,
        [recBId, tenantBId],
      );

      // Switch back to Tenant A context
      await setTenantContext(client, tenantAId);

      // Org A attempts to add recipe_item referencing Org B's ingredient -> Foreign Key violation!
      await assertQueryRejects(
        client,
        `
          INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
          VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 25.0000);
        `,
        [crypto.randomUUID(), tenantAId, recAId, ingBId],
        /fk_recipe_items_ingredient|violates foreign key constraint/,
      );

      // Org A attempts to add recipe_item referencing Org B's subrecipe -> Foreign Key violation!
      await assertQueryRejects(
        client,
        `
          INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
          VALUES ($1, $2, $3, NULL, $4, 1.0000, 1.0000, 10.0000);
        `,
        [crypto.randomUUID(), tenantAId, recAId, recBId],
        /fk_recipe_items_sub_recipe|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-DB-05: Real RLS default-deny and cross-tenant isolation with unprivileged role', async () => {
    // 1. Under unprivileged role without tenant context: all queries return 0 rows (default-deny)
    await asTestRole(async (client) => {
      const p = await client.query('SELECT * FROM products;');
      assert.equal(p.rows.length, 0);

      const w = await client.query('SELECT * FROM warehouses;');
      assert.equal(w.rows.length, 0);

      const ing = await client.query('SELECT * FROM ingredients;');
      assert.equal(ing.rows.length, 0);

      const r = await client.query('SELECT * FROM recipes;');
      assert.equal(r.rows.length, 0);

      const ri = await client.query('SELECT * FROM recipe_items;');
      assert.equal(ri.rows.length, 0);
    });

    // 2. Under unprivileged role with Tenant A context:
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const prodAId = crypto.randomUUID();
      const whAId = crypto.randomUUID();
      const ingAId = crypto.randomUUID();
      const recAId = crypto.randomUUID();

      await client.query(
        `INSERT INTO products (id, organization_id, code, name, base_price) VALUES ($1, $2, 'PROD-A1', 'Product A1', 100.0000);`,
        [prodAId, tenantAId],
      );

      await client.query(
        `INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type) VALUES ($1, $2, $3, 'WH-A1', 'Warehouse A1', 'PRINCIPAL');`,
        [whAId, tenantAId, branchAId],
      );

      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES ($1, $2, 'ING-A1', 'Ingredient A1', 'KG', 15.0000);`,
        [ingAId, tenantAId],
      );

      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, $3, 'REC-A1', 'Recipe A1', 1.0000, 'PZ');`,
        [recAId, tenantAId, prodAId],
      );

      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot) VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 15.0000);`,
        [crypto.randomUUID(), tenantAId, recAId, ingAId],
      );

      // Tenant A can query its own records
      const prodA = await client.query('SELECT * FROM products WHERE organization_id = $1;', [
        tenantAId,
      ]);
      assert.ok(prodA.rows.length >= 1);
      assert.equal(prodA.rows[0].organization_id, tenantAId);

      const whA = await client.query('SELECT * FROM warehouses WHERE organization_id = $1;', [
        tenantAId,
      ]);
      assert.ok(whA.rows.length >= 1);
      assert.equal(whA.rows[0].organization_id, tenantAId);

      const ingsA = await client.query('SELECT * FROM ingredients WHERE organization_id = $1;', [
        tenantAId,
      ]);
      assert.ok(ingsA.rows.length >= 1);
      assert.equal(ingsA.rows[0].organization_id, tenantAId);

      // Now switch transaction context to Tenant B within same role
      await setTenantContext(client, tenantBId);

      // Tenant A's records MUST NOT be visible to Tenant B
      const prodB = await client.query('SELECT * FROM products WHERE id = $1;', [prodAId]);
      assert.equal(prodB.rows.length, 0, 'Tenant B must not see Tenant A product');

      const whB = await client.query('SELECT * FROM warehouses WHERE id = $1;', [whAId]);
      assert.equal(whB.rows.length, 0, 'Tenant B must not see Tenant A warehouse');

      const ingsB = await client.query('SELECT * FROM ingredients WHERE id = $1;', [ingAId]);
      assert.equal(ingsB.rows.length, 0, 'Tenant B must not see Tenant A ingredient');

      const recsB = await client.query('SELECT * FROM recipes WHERE id = $1;', [recAId]);
      assert.equal(recsB.rows.length, 0, 'Tenant B must not see Tenant A recipe');

      await client.query('ROLLBACK;');
    });
  });

  it('WP017-DB-06: Tenant-safe composite FK fk_recipes_product enforces same-tenant product matrix', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');

      const prodAId = crypto.randomUUID();
      const prodBId = crypto.randomUUID();

      // Seed Product in Org A
      await setTenantContext(client, tenantAId);
      await client.query(
        `INSERT INTO products (id, organization_id, code, name, base_price) VALUES ($1, $2, 'PROD-A2', 'Product A2', 50.0000);`,
        [prodAId, tenantAId],
      );

      // Seed Product in Org B
      await setTenantContext(client, tenantBId);
      await client.query(
        `INSERT INTO products (id, organization_id, code, name, base_price) VALUES ($1, $2, 'PROD-B2', 'Product B2', 75.0000);`,
        [prodBId, tenantBId],
      );

      // Back to Org A
      await setTenantContext(client, tenantAId);

      // 1. Same-tenant product_id: PASS
      const recSameTenantId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, $3, 'REC-SAME', 'Same Tenant Recipe', 1.0000, 'PZ');`,
        [recSameTenantId, tenantAId, prodAId],
      );
      const insertedRec = await client.query('SELECT id, product_id FROM recipes WHERE id = $1;', [
        recSameTenantId,
      ]);
      assert.equal(insertedRec.rows[0].product_id, prodAId);

      // 2. NULL product_id (subrecipe): PASS
      const recNullProductId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, NULL, 'REC-NULL-PROD', 'Subrecipe without product', 1.0000, 'PZ');`,
        [recNullProductId, tenantAId],
      );
      const insertedNullRec = await client.query(
        'SELECT id, product_id FROM recipes WHERE id = $1;',
        [recNullProductId],
      );
      assert.equal(insertedNullRec.rows[0].product_id, null);

      // 3. Cross-tenant product_id: REJECT
      await assertQueryRejects(
        client,
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, $3, 'REC-CROSS', 'Cross Tenant Recipe', 1.0000, 'PZ');`,
        [crypto.randomUUID(), tenantAId, prodBId],
        /fk_recipes_product|violates foreign key constraint/,
      );

      // 4. Non-existent product_id: REJECT
      const nonexistentProdId = crypto.randomUUID();
      await assertQueryRejects(
        client,
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, $3, 'REC-NONEXIST', 'Nonexistent Product Recipe', 1.0000, 'PZ');`,
        [crypto.randomUUID(), tenantAId, nonexistentProdId],
        /fk_recipes_product|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-DB-07: unit_cost_snapshot rejects omission or NULL (no unauthorized default)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();

      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, 'REC-COST-TEST', 'Cost Test Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES ($1, $2, 'ING-COST-TEST', 'Cost Test Ingredient', 'KG', 12.0000);`,
        [ingredientId, tenantAId],
      );

      // 1. Omission of unit_cost_snapshot fails NOT NULL constraint
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity) VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId],
        /null value in column "unit_cost_snapshot".*violates not-null constraint/,
      );

      // 2. Explicit NULL fails NOT NULL constraint
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot) VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, NULL);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId],
        /null value in column "unit_cost_snapshot".*violates not-null constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('WP017-DB-08: fk_recipe_items_recipe restricts deletion of recipes when recipe_items exist', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();

      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit) VALUES ($1, $2, 'REC-NO-CASCADE', 'No Cascade Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES ($1, $2, 'ING-NO-CASCADE', 'No Cascade Ingredient', 'KG', 12.0000);`,
        [ingredientId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot) VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 12.0000);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId],
      );

      // Attempting to DELETE recipe without deleting recipe_items must FAIL (RESTRICT per DATA_MODEL.md)
      await assertQueryRejects(
        client,
        `DELETE FROM recipes WHERE id = $1;`,
        [recipeId],
        /fk_recipe_items_recipe|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });
});
