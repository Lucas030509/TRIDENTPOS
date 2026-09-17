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
  const categoryAId = crypto.randomUUID();
  const categoryBId = crypto.randomUUID();
  const taxSchemeId = crypto.randomUUID();
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

        INSERT INTO categories (id, organization_id, code, name)
        VALUES
          ('${categoryAId}', '${tenantAId}', 'CAT-017-A1', 'Category 017 A1'),
          ('${categoryBId}', '${tenantBId}', 'CAT-017-B1', 'Category 017 B1')
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

  it('DB-01 & DB-02: Exact four WP-017 tables exist and no alternate duplicate tables exist', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('warehouses', 'ingredients', 'recipes', 'recipe_items', 'products', 'categories', 'almacenes', 'insumos', 'recetas', 'subrecetas');
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    assert.ok(tableNames.includes('warehouses'), 'warehouses table must exist');
    assert.ok(tableNames.includes('ingredients'), 'ingredients table must exist');
    assert.ok(tableNames.includes('recipes'), 'recipes table must exist');
    assert.ok(tableNames.includes('recipe_items'), 'recipe_items table must exist');

    assert.ok(!tableNames.includes('almacenes'), 'duplicate table almacenes must NOT exist');
    assert.ok(!tableNames.includes('insumos'), 'duplicate table insumos must NOT exist');
    assert.ok(!tableNames.includes('recetas'), 'duplicate table recetas must NOT exist');
    assert.ok(!tableNames.includes('subrecetas'), 'duplicate table subrecetas must NOT exist');
  });

  it('DB-03: RLS and FORCE RLS are enabled on all four WP-017 physical tables', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('warehouses', 'ingredients', 'recipes', 'recipe_items');
    `);

    assert.equal(res.rows.length, 4);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
      assert.equal(row.relforcerowsecurity, true, `FORCE RLS must be enabled on ${row.relname}`);
    }
  });

  it('DB-04: Tenant default-deny returns 0 visible rows without tenant context', async () => {
    await asTestRole(async (client) => {
      const w = await client.query('SELECT * FROM warehouses;');
      assert.equal(w.rows.length, 0);

      const ing = await client.query('SELECT * FROM ingredients;');
      assert.equal(ing.rows.length, 0);

      const r = await client.query('SELECT * FROM recipes;');
      assert.equal(r.rows.length, 0);

      const ri = await client.query('SELECT * FROM recipe_items;');
      assert.equal(ri.rows.length, 0);
    });
  });

  it('DB-05: Tenant visibility separation enforces strict isolation between Tenant A and Tenant B', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const prodAId = crypto.randomUUID();
      const whAId = crypto.randomUUID();
      const ingAId = crypto.randomUUID();
      const recAId = crypto.randomUUID();

      await client.query(
        `INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
         VALUES ($1, $2, $3, 'PROD-A1', 'Product A1', 'COMPOSITE', 100.0000, $4);`,
        [prodAId, tenantAId, categoryAId, taxSchemeId],
      );

      await client.query(
        `INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
         VALUES ($1, $2, $3, 'WH-A1', 'Warehouse A1', 'PRINCIPAL');`,
        [whAId, tenantAId, branchAId],
      );

      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES ($1, $2, 'ING-A1', 'Ingredient A1', 'KG', 15.0000);`,
        [ingAId, tenantAId],
      );

      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-A1', 'Recipe A1', 1.0000, 'PZ');`,
        [recAId, tenantAId, prodAId],
      );

      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 15.0000);`,
        [crypto.randomUUID(), tenantAId, recAId, ingAId],
      );

      // Tenant A can query its own records
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

      // Switch context to Tenant B
      await setTenantContext(client, tenantBId);

      // Tenant A records invisible to Tenant B
      const whB = await client.query('SELECT * FROM warehouses WHERE id = $1;', [whAId]);
      assert.equal(whB.rows.length, 0, 'Tenant B must not see Tenant A warehouse');

      const ingsB = await client.query('SELECT * FROM ingredients WHERE id = $1;', [ingAId]);
      assert.equal(ingsB.rows.length, 0, 'Tenant B must not see Tenant A ingredient');

      const recsB = await client.query('SELECT * FROM recipes WHERE id = $1;', [recAId]);
      assert.equal(recsB.rows.length, 0, 'Tenant B must not see Tenant A recipe');

      await client.query('ROLLBACK;');
    });
  });

  it('DB-06: Cross-tenant warehouse/branch FK rejected by composite candidate key', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      // Tenant A attempts to create warehouse referencing Tenant B's branch -> REJECT
      await assertQueryRejects(
        client,
        `INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
         VALUES ($1, $2, $3, 'WH-CROSS', 'Cross Warehouse', 'PRINCIPAL');`,
        [crypto.randomUUID(), tenantAId, branchBId],
        /fk_warehouses_branch|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('DB-07: Cross-tenant recipe/product FK rejected by composite fk_recipes_product', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');

      const prodAId = crypto.randomUUID();
      const prodBId = crypto.randomUUID();

      // Seed Product in Org A
      await setTenantContext(client, tenantAId);
      await client.query(
        `INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
         VALUES ($1, $2, $3, 'PROD-A2', 'Product A2', 'COMPOSITE', 50.0000, $4);`,
        [prodAId, tenantAId, categoryAId, taxSchemeId],
      );

      // Seed Product in Org B
      await setTenantContext(client, tenantBId);
      await client.query(
        `INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
         VALUES ($1, $2, $3, 'PROD-B2', 'Product B2', 'COMPOSITE', 75.0000, $4);`,
        [prodBId, tenantBId, categoryBId, taxSchemeId],
      );

      // Back to Org A
      await setTenantContext(client, tenantAId);

      // 1. Same-tenant product_id: PASS
      const recSameTenantId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-SAME', 'Same Tenant Recipe', 1.0000, 'PZ');`,
        [recSameTenantId, tenantAId, prodAId],
      );
      const insertedRec = await client.query('SELECT id, product_id FROM recipes WHERE id = $1;', [
        recSameTenantId,
      ]);
      assert.equal(insertedRec.rows[0].product_id, prodAId);

      // 2. NULL product_id (intermediate subrecipe): PASS
      const recNullProductId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, NULL, 'REC-NULL-PROD', 'Subrecipe without product', 1.0000, 'PZ');`,
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
        `INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, $3, 'REC-CROSS', 'Cross Tenant Recipe', 1.0000, 'PZ');`,
        [crypto.randomUUID(), tenantAId, prodBId],
        /fk_recipes_product|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('DB-08 & DB-09: Cross-tenant ingredient and subrecipe FKs in recipe_items rejected', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');

      const recAId = crypto.randomUUID();
      const ingBId = crypto.randomUUID();
      const recBId = crypto.randomUUID();

      // Seed Org A recipe and Org B ingredient & recipe
      await setTenantContext(client, tenantAId);
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-A', 'Recipe A', 1.0000, 'PZ');`,
        [recAId, tenantAId],
      );

      await setTenantContext(client, tenantBId);
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES ($1, $2, 'ING-B', 'Ingredient B', 'KG', 25.0000);`,
        [ingBId, tenantBId],
      );
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-B', 'Recipe B', 1.0000, 'PZ');`,
        [recBId, tenantBId],
      );

      // Switch back to Tenant A context
      await setTenantContext(client, tenantAId);

      // DB-08: Org A attempts to add recipe_item referencing Org B's ingredient -> REJECT
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 25.0000);`,
        [crypto.randomUUID(), tenantAId, recAId, ingBId],
        /fk_recipe_items_ingredient|violates foreign key constraint/,
      );

      // DB-09: Org A attempts to add recipe_item referencing Org B's subrecipe -> REJECT
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, NULL, $4, 1.0000, 1.0000, 10.0000);`,
        [crypto.randomUUID(), tenantAId, recAId, recBId],
        /fk_recipe_items_sub_recipe|violates foreign key constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('DB-10: chk_recipe_items_exclusive_source XOR invariant enforces exactly one source', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();
      const subRecipeId = crypto.randomUUID();

      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-PAR', 'Parent Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-SUB', 'Sub Recipe', 1.0000, 'PZ');`,
        [subRecipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES ($1, $2, 'ING-01', 'Ingredient 1', 'KG', 10.0000);`,
        [ingredientId, tenantAId],
      );

      // 1. Setting BOTH ingredient_id and sub_recipe_id MUST FAIL
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, $5, 1.0000, 1.0000, 10.0000);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId, subRecipeId],
        /chk_recipe_items_exclusive_source/,
      );

      // 2. Setting NEITHER ingredient_id nor sub_recipe_id (both NULL) MUST FAIL
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, NULL, NULL, 1.0000, 1.0000, 10.0000);`,
        [crypto.randomUUID(), tenantAId, recipeId],
        /chk_recipe_items_exclusive_source/,
      );

      // 3. Setting ONLY ingredient_id SUCCEEDS
      const ingItemId = crypto.randomUUID();
      const ingRes = await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 0.5000, 0.5500, 10.0000)
         RETURNING id;`,
        [ingItemId, tenantAId, recipeId, ingredientId],
      );
      assert.equal(ingRes.rows[0].id, ingItemId);

      // 4. Setting ONLY sub_recipe_id SUCCEEDS
      const subItemId = crypto.randomUUID();
      const subRes = await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, NULL, $4, 0.2000, 0.2000, 5.0000)
         RETURNING id;`,
        [subItemId, tenantAId, recipeId, subRecipeId],
      );
      assert.equal(subRes.rows[0].id, subItemId);

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('DB-11: fk_recipe_items_recipe restricts deletion of recipes when recipe_items exist (no unauthorized cascade)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();

      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-NO-CASCADE', 'No Cascade Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES ($1, $2, 'ING-NO-CASCADE', 'No Cascade Ingredient', 'KG', 12.0000);`,
        [ingredientId, tenantAId],
      );
      await client.query(
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, 12.0000);`,
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

  it('DB-12: unit_cost_snapshot precision/not-null behavior rejects NULL or omission', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const recipeId = crypto.randomUUID();
      const ingredientId = crypto.randomUUID();

      await client.query(
        `INSERT INTO recipes (id, organization_id, code, name, yield_quantity, yield_unit)
         VALUES ($1, $2, 'REC-COST-TEST', 'Cost Test Recipe', 1.0000, 'PZ');`,
        [recipeId, tenantAId],
      );
      await client.query(
        `INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
         VALUES ($1, $2, 'ING-COST-TEST', 'Cost Test Ingredient', 'KG', 12.0000);`,
        [ingredientId, tenantAId],
      );

      // 1. Omission of unit_cost_snapshot fails NOT NULL constraint
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId],
        /null value in column "unit_cost_snapshot".*violates not-null constraint/,
      );

      // 2. Explicit NULL fails NOT NULL constraint
      await assertQueryRejects(
        client,
        `INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
         VALUES ($1, $2, $3, $4, NULL, 1.0000, 1.0000, NULL);`,
        [crypto.randomUUID(), tenantAId, recipeId, ingredientId],
        /null value in column "unit_cost_snapshot".*violates not-null constraint/,
      );

      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }
  });

  it('Section 42: Platform Core ownership test — WP-017 migration does NOT define products or categories', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'migrations/20260904230000_inventory_catalog_and_recipes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(
      !/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?products\b/i.test(sql),
      'WP-017 migration must NOT contain CREATE TABLE products',
    );
    assert.ok(
      !/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?categories\b/i.test(sql),
      'WP-017 migration must NOT contain CREATE TABLE categories',
    );
    assert.ok(
      !/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?products\b/i.test(sql),
      'WP-017 migration must NOT drop products',
    );
    assert.ok(
      !/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?categories\b/i.test(sql),
      'WP-017 migration must NOT drop categories',
    );
    assert.ok(
      /REFERENCES\s+products\s*\(\s*organization_id\s*,\s*id\s*\)/i.test(sql),
      'recipes.product_id must reference Platform Core products(organization_id, id)',
    );
  });

  it('QI-ADV-017-01: WP-017 Down migration contains no destructive CASCADE and preserves Platform Core', async () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'migrations/20260904230000_inventory_catalog_and_recipes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const downSection = sql.split(/--\s*Down/i)[1] || '';

    assert.ok(
      !/DROP\s+TABLE[^\n;]*CASCADE/i.test(downSection),
      'WP-017 Down migration must NOT contain DROP TABLE ... CASCADE',
    );
  });
});
