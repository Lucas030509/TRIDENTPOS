import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { getPool } from './connection.js';
import { migrateUp, migrateDown, getAppliedMigrations, DEFAULT_MIGRATIONS_DIR } from './runner.js';
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
            lotes_facturacion_global,
            fiscal_invoice_items,
            fiscal_invoices,
            emisor_fiscal_config,
            tax_schemes,
            accounts_receivable_settlements,
            accounts_payable_payments,
            cash_reconciliations,
            branch_operating_expenses,
            accounts_receivable,
            scheduled_payments,
            accounts_payable,
            purchase_receipt_items,
            purchase_receipts,
            receiving_voucher_items,
            receiving_vouchers,
            purchase_order_items,
            purchase_orders,
            suppliers,
            inventory_quarantine_records,
            inventory_waste_records,
            stock_ledger,
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
      DEFAULT_MIGRATIONS_DIR,
      '20260904230000_inventory_catalog_and_recipes.sql',
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
      DEFAULT_MIGRATIONS_DIR,
      '20260904230000_inventory_catalog_and_recipes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const downSection = sql.split(/--\s*Down/i)[1] || '';

    assert.ok(
      !/DROP\s+TABLE[^\n;]*CASCADE/i.test(downSection),
      'WP-017 Down migration must NOT contain DROP TABLE ... CASCADE',
    );
  });

  it('WP017-DOWN-01: Actual migrateDown execution reverts WP-017 while preserving Platform Core tables and marker data', async () => {
    const markerOrgId = crypto.randomUUID();
    const markerBranchId = crypto.randomUUID();
    const markerCatId = crypto.randomUUID();
    const markerProdId = crypto.randomUUID();
    const markerWhId = crypto.randomUUID();
    const markerIngId = crypto.randomUUID();
    const markerRecId = crypto.randomUUID();
    const markerItemId = crypto.randomUUID();

    // 1. Ensure migrations are up and seed Platform Core and WP-017 records
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES ('${markerOrgId}', 'Rollback Test Org', 'Rollback Org', 'TAX-RB-${markerOrgId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${markerBranchId}', '${markerOrgId}', 'BR-RB', 'Rollback Branch')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO categories (id, organization_id, code, name)
        VALUES ('${markerCatId}', '${markerOrgId}', 'CAT-RB', 'Rollback Category')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
        VALUES ('${markerProdId}', '${markerOrgId}', '${markerCatId}', 'PROD-RB', 'Rollback Product', 'COMPOSITE', 199.0000, '${crypto.randomUUID()}');

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES ('${markerWhId}', '${markerOrgId}', '${markerBranchId}', 'WH-RB', 'Rollback Warehouse', 'PRINCIPAL');

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES ('${markerIngId}', '${markerOrgId}', 'ING-RB', 'Rollback Ingredient', 'KG', 45.0000);

        INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
        VALUES ('${markerRecId}', '${markerOrgId}', '${markerProdId}', 'REC-RB', 'Rollback Recipe', 1.0000, 'PZ');

        INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
        VALUES ('${markerItemId}', '${markerOrgId}', '${markerRecId}', '${markerIngId}', NULL, 1.0000, 1.0000, 45.0000);
      `);
    } finally {
      client.release();
    }

    // 2. Pre-rollback assertions: all 8 tables exist
    const preCheck = await pool.query<{
      warehouses: string | null;
      ingredients: string | null;
      recipes: string | null;
      recipe_items: string | null;
      products: string | null;
      categories: string | null;
      organizations: string | null;
      branches: string | null;
    }>(`
      SELECT
        to_regclass('warehouses')::text as warehouses,
        to_regclass('ingredients')::text as ingredients,
        to_regclass('recipes')::text as recipes,
        to_regclass('recipe_items')::text as recipe_items,
        to_regclass('products')::text as products,
        to_regclass('categories')::text as categories,
        to_regclass('organizations')::text as organizations,
        to_regclass('branches')::text as branches;
    `);
    const pre = preCheck.rows[0]!;
    assert.ok(pre.warehouses !== null, 'warehouses must exist before rollback');
    assert.ok(pre.ingredients !== null, 'ingredients must exist before rollback');
    assert.ok(pre.recipes !== null, 'recipes must exist before rollback');
    assert.ok(pre.recipe_items !== null, 'recipe_items must exist before rollback');
    assert.ok(pre.products !== null, 'products must exist before rollback');
    assert.ok(pre.categories !== null, 'categories must exist before rollback');
    assert.ok(pre.organizations !== null, 'organizations must exist before rollback');
    assert.ok(pre.branches !== null, 'branches must exist before rollback');

    try {
      // 3. Execute authorized non-production migrateDown (roll down any migrations newer than WP-017 first)
      const checkClientBefore = await pool.connect();
      try {
        const appliedBefore = await getAppliedMigrations(checkClientBefore);
        for (let i = appliedBefore.length - 1; i >= 0; i--) {
          const entry = appliedBefore[i];
          if (entry && entry.id > '20260904230000') {
            await migrateDown(pool, { allowDestructiveDown: true });
          }
        }
      } finally {
        checkClientBefore.release();
      }

      const revertResult = await migrateDown(pool, { allowDestructiveDown: true });
      assert.equal(
        revertResult.reverted,
        '20260904230000_inventory_catalog_and_recipes',
        'migrateDown must revert exactly WP-017 migration',
      );

      // 4. Verify WP-017 physical tables are removed
      const postCheck = await pool.query<{
        warehouses: string | null;
        ingredients: string | null;
        recipes: string | null;
        recipe_items: string | null;
        products: string | null;
        categories: string | null;
        organizations: string | null;
        branches: string | null;
      }>(`
        SELECT
          to_regclass('warehouses')::text as warehouses,
          to_regclass('ingredients')::text as ingredients,
          to_regclass('recipes')::text as recipes,
          to_regclass('recipe_items')::text as recipe_items,
          to_regclass('products')::text as products,
          to_regclass('categories')::text as categories,
          to_regclass('organizations')::text as organizations,
          to_regclass('branches')::text as branches;
      `);
      const post = postCheck.rows[0]!;
      assert.equal(post.warehouses, null, 'warehouses must be removed by rollback');
      assert.equal(post.ingredients, null, 'ingredients must be removed by rollback');
      assert.equal(post.recipes, null, 'recipes must be removed by rollback');
      assert.equal(post.recipe_items, null, 'recipe_items must be removed by rollback');

      // 5. Verify Platform Core tables and marker data survived intact
      assert.ok(post.products !== null, 'products table must survive WP-017 rollback');
      assert.ok(post.categories !== null, 'categories table must survive WP-017 rollback');
      assert.ok(post.organizations !== null, 'organizations table must survive WP-017 rollback');
      assert.ok(post.branches !== null, 'branches table must survive WP-017 rollback');

      const dataCheck = await pool.query<{ id: string }>(`SELECT id FROM products WHERE id = $1;`, [
        markerProdId,
      ]);
      assert.equal(dataCheck.rows.length, 1, 'Platform Core marker product data must survive');

      const catDataCheck = await pool.query<{ id: string }>(
        `SELECT id FROM categories WHERE id = $1;`,
        [markerCatId],
      );
      assert.equal(catDataCheck.rows.length, 1, 'Platform Core marker category data must survive');

      // 6. Verify ledger state: WP-017 is no longer in applied ledger
      const checkClient = await pool.connect();
      try {
        const applied = await getAppliedMigrations(checkClient);
        const hasWp017 = applied.some((m) => m.id === '20260904230000');
        assert.equal(hasWp017, false, 'WP-017 must no longer be recorded in applied migrations');
        const lastApplied = applied[applied.length - 1];
        assert.equal(
          lastApplied?.id,
          '20260904223000',
          'Preceding migration must be the latest applied migration',
        );
      } finally {
        checkClient.release();
      }
    } finally {
      // 7. Restore migration environment with migrateUp
      await migrateUp(pool);

      // Verify WP-017 tables are restored
      const restoreCheck = await pool.query<{
        warehouses: string | null;
        ingredients: string | null;
        recipes: string | null;
        recipe_items: string | null;
      }>(`
        SELECT
          to_regclass('warehouses')::text as warehouses,
          to_regclass('ingredients')::text as ingredients,
          to_regclass('recipes')::text as recipes,
          to_regclass('recipe_items')::text as recipe_items;
      `);
      const restored = restoreCheck.rows[0]!;
      assert.ok(restored.warehouses !== null, 'warehouses must be restored');
      assert.ok(restored.ingredients !== null, 'ingredients must be restored');
      assert.ok(restored.recipes !== null, 'recipes must be restored');
      assert.ok(restored.recipe_items !== null, 'recipe_items must be restored');

      // Cleanup marker rows
      const cleanClient = await pool.connect();
      try {
        await cleanClient.query(`
          DELETE FROM products WHERE id = '${markerProdId}';
          DELETE FROM categories WHERE id = '${markerCatId}';
          DELETE FROM branches WHERE id = '${markerBranchId}';
          DELETE FROM organizations WHERE id = '${markerOrgId}';
        `);
      } finally {
        cleanClient.release();
      }
    }
  });
});

describe('TRIDENTPOS WP-018 Real-Time Kárdex, Waste & KDS Depletion Database Suite', () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const whAId = crypto.randomUUID();
  const whBId = crypto.randomUUID();
  const ingAId = crypto.randomUUID();
  const ingBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const testRole = 'trident_wp018_test_role';

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
    await migrateUp(pool);

    const client = await pool.connect();
    try {
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
          ('${tenantAId}', 'WP018 Org A', 'Org A', 'TAX-WP018-A-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'WP018 Org B', 'Org B', 'TAX-WP018-B-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-018-A1', 'Branch 018 A1'),
          ('${branchBId}', '${tenantBId}', 'BR-018-B1', 'Branch 018 B1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO users (id, organization_id, email, full_name)
        VALUES
          ('${userAId}', '${tenantAId}', 'user-a@wp018.local', 'User A'),
          ('${userBId}', '${tenantBId}', 'user-b@wp018.local', 'User B')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES
          ('${whAId}', '${tenantAId}', '${branchAId}', 'WH-018-A1', 'Warehouse 018 A1', 'PRINCIPAL'),
          ('${whBId}', '${tenantBId}', '${branchBId}', 'WH-018-B1', 'Warehouse 018 B1', 'PRINCIPAL')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES
          ('${ingAId}', '${tenantAId}', 'ING-018-A1', 'Ingredient 018 A1', 'KG', 50.0000),
          ('${ingBId}', '${tenantBId}', 'ING-018-B1', 'Ingredient 018 B1', 'KG', 75.0000)
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
        DELETE FROM inventory_quarantine_records WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM inventory_waste_records WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM ingredients WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM warehouses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM users WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
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

  it('WP018-DB-01: Exact three WP-018 physical tables exist and stock_actual writable table does NOT exist', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('stock_ledger', 'inventory_waste_records', 'inventory_quarantine_records',
                           'stock_actual', 'current_stock', 'inventory_balance', 'stock_balance', 'movimientos_inventario');
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    assert.ok(tableNames.includes('stock_ledger'), 'stock_ledger table must exist');
    assert.ok(
      tableNames.includes('inventory_waste_records'),
      'inventory_waste_records table must exist',
    );
    assert.ok(
      tableNames.includes('inventory_quarantine_records'),
      'inventory_quarantine_records table must exist',
    );

    assert.ok(!tableNames.includes('stock_actual'), 'stock_actual writable table must NOT exist');
    assert.ok(!tableNames.includes('current_stock'), 'current_stock writable table must NOT exist');
    assert.ok(
      !tableNames.includes('inventory_balance'),
      'inventory_balance writable table must NOT exist',
    );
    assert.ok(!tableNames.includes('stock_balance'), 'stock_balance writable table must NOT exist');
    assert.ok(
      !tableNames.includes('movimientos_inventario'),
      'movimientos_inventario table must NOT exist',
    );
  });

  it('WP018-DB-02: RLS and FORCE RLS are enabled on all three WP-018 physical tables', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('stock_ledger', 'inventory_waste_records', 'inventory_quarantine_records');
    `);

    assert.equal(res.rows.length, 3);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
      assert.equal(row.relforcerowsecurity, true, `FORCE RLS must be enabled on ${row.relname}`);
    }
  });

  it('WP018-DB-03: Tenant default-deny returns 0 visible rows without tenant context', async () => {
    await asTestRole(async (client) => {
      const sl = await client.query('SELECT * FROM stock_ledger;');
      assert.equal(sl.rows.length, 0);

      const wr = await client.query('SELECT * FROM inventory_waste_records;');
      assert.equal(wr.rows.length, 0);

      const qr = await client.query('SELECT * FROM inventory_quarantine_records;');
      assert.equal(qr.rows.length, 0);
    });
  });

  it('WP018-DB-04: Tenant visibility separation between Tenant A and Tenant B', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const ledgerAId = crypto.randomUUID();
      const wasteAId = crypto.randomUUID();
      const qrAId = crypto.randomUUID();

      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${ledgerAId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'MERMA', 'EVT-A1', -10.0000, 50.0000, 500.0000, -10.0000, 1
        );

        INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES (
          '${wasteAId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          '${ledgerAId}', 'CMD-A1', 'EXPIRED', 'https://photo.local/1.jpg'
        );

        INSERT INTO inventory_quarantine_records (
          id, organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES (
          '${qrAId}', '${tenantAId}', '${branchAId}', 'ORD-A1', '{"test": true}', 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING'
        );
      `);

      // Under Tenant A, rows are visible
      const slA = await client.query('SELECT id FROM stock_ledger;');
      assert.ok(slA.rows.some((r) => r.id === ledgerAId));

      const wrA = await client.query('SELECT id FROM inventory_waste_records;');
      assert.ok(wrA.rows.some((r) => r.id === wasteAId));

      const qrA = await client.query('SELECT id FROM inventory_quarantine_records;');
      assert.ok(qrA.rows.some((r) => r.id === qrAId));

      // Switch context to Tenant B -> Tenant A rows MUST NOT be visible
      await setTenantContext(client, tenantBId);

      const slB = await client.query('SELECT id FROM stock_ledger WHERE id = $1;', [ledgerAId]);
      assert.equal(slB.rows.length, 0);

      const wrB = await client.query('SELECT id FROM inventory_waste_records WHERE id = $1;', [
        wasteAId,
      ]);
      assert.equal(wrB.rows.length, 0);

      const qrB = await client.query('SELECT id FROM inventory_quarantine_records WHERE id = $1;', [
        qrAId,
      ]);
      assert.equal(qrB.rows.length, 0);

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-05: stock_ledger candidate key and tenant-safe composite FKs reject cross-tenant references', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const slId = crypto.randomUUID();

      // Cross-tenant branch (Branch B with Org A) rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'COMPRA', 'EVT-1', 1.0000, 50.0000, 50.0000, 1.0000, 1);`,
        [slId, tenantAId, branchBId, whAId, ingAId],
        /violates foreign key constraint "fk_stock_ledger_branch"/,
      );

      // Cross-tenant warehouse (Warehouse B with Org A) rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'COMPRA', 'EVT-1', 1.0000, 50.0000, 50.0000, 1.0000, 1);`,
        [slId, tenantAId, branchAId, whBId, ingAId],
        /violates foreign key constraint "fk_stock_ledger_warehouse"/,
      );

      // Cross-tenant ingredient (Ingredient B with Org A) rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'COMPRA', 'EVT-1', 1.0000, 50.0000, 50.0000, 1.0000, 1);`,
        [slId, tenantAId, branchAId, whAId, ingBId],
        /violates foreign key constraint "fk_stock_ledger_ingredient"/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-06: stock_ledger check constraints reject invalid movement_type and zero quantity_delta', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const slId = crypto.randomUUID();

      // Invalid movement type rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'VENTA_INVALIDA', 'EVT-1', 1.0000, 50.0000, 50.0000, 1.0000, 1);`,
        [slId, tenantAId, branchAId, whAId, ingAId],
        /violates check constraint "chk_stock_ledger_movement_type"/,
      );

      // Zero quantity delta rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'COMPRA', 'EVT-1', 0.0000, 50.0000, 0.0000, 0.0000, 1);`,
        [slId, tenantAId, branchAId, whAId, ingAId],
        /violates check constraint "chk_stock_ledger_quantity_delta_nonzero"/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-07: stock_ledger append-only trigger rejects UPDATE and DELETE at DB level', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const slId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${slId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'COMPRA', 'EVT-AO1', 10.0000, 50.0000, 500.0000, 10.0000, 1
        );
      `);

      // UPDATE rejected
      await assertQueryRejects(
        client,
        `UPDATE stock_ledger SET quantity_delta = 15.0000 WHERE id = $1;`,
        [slId],
        /Stock ledger is append-only: UPDATE and DELETE operations are strictly prohibited/,
      );

      // DELETE rejected
      await assertQueryRejects(
        client,
        `DELETE FROM stock_ledger WHERE id = $1;`,
        [slId],
        /Stock ledger is append-only: UPDATE and DELETE operations are strictly prohibited/,
      );

      // Compensating counter-movement succeeds
      const compId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${compId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'AJUSTE_FISICO', 'EVT-COMP-1', -10.0000, 50.0000, 500.0000, 0.0000, 2
        );
      `);

      const sumRes = await client.query<{ balance: string }>(
        `SELECT SUM(quantity_delta)::text as balance FROM stock_ledger WHERE id IN ($1, $2);`,
        [slId, compId],
      );
      assert.equal(sumRes.rows[0]!.balance, '0.0000');

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-08: stock_ledger sequence uniqueness rejects duplicate sequence numbers', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const sl1 = crypto.randomUUID();
      const sl2 = crypto.randomUUID();

      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${sl1}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'COMPRA', 'EVT-SEQ1', 5.0000, 50.0000, 250.0000, 5.0000, 1
        );
      `);

      // Duplicate sequence number 1 for same aggregate rejected
      await assertQueryRejects(
        client,
        `INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, $5, 'COMPRA', 'EVT-SEQ2', 5.0000, 50.0000, 250.0000, 10.0000, 1);`,
        [sl2, tenantAId, branchAId, whAId, ingAId],
        /violates unique constraint "uq_stock_ledger_seq"/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-09: concurrent same-aggregate movements serialize monotonically with exact balance', async () => {
    const concOrgId = crypto.randomUUID();
    const concBranchId = crypto.randomUUID();
    const concWhId = crypto.randomUUID();
    const concIngId = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES ('${concOrgId}', 'Concurrent Org', 'Conc Org', 'TAX-CONC-${concOrgId.slice(0, 8)}');

        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${concBranchId}', '${concOrgId}', 'BR-CONC', 'Concurrent Branch');

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES ('${concWhId}', '${concOrgId}', '${concBranchId}', 'WH-CONC', 'Concurrent Warehouse', 'PRINCIPAL');

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES ('${concIngId}', '${concOrgId}', 'ING-CONC', 'Concurrent Ingredient', 'KG', 10.0000);
      `);
    } finally {
      client.release();
    }

    // Run 5 concurrent workers inserting movements
    const workerCount = 5;
    const workers = Array.from({ length: workerCount }, (_, i) => async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN;');
        await setTenantContext(c, concOrgId);

        // Lock aggregate
        const lockKey = `${concOrgId}:${concBranchId}:${concWhId}:${concIngId}`;
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1));', [lockKey]);

        // Prior balance & next sequence
        const balRes = await c.query<{ balance: string }>(
          `SELECT COALESCE(SUM(quantity_delta), 0.0000)::text as balance FROM stock_ledger
           WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
          [concOrgId, concBranchId, concWhId, concIngId],
        );
        const seqRes = await c.query<{ next_seq: string }>(
          `SELECT (COALESCE(MAX(movement_sequence_number), 0) + 1)::text as next_seq FROM stock_ledger
           WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
          [concOrgId, concBranchId, concWhId, concIngId],
        );

        const prior = parseFloat(balRes.rows[0]!.balance);
        const seq = parseInt(seqRes.rows[0]!.next_seq, 10);
        const delta = 2.0;
        const balanceAfter = (prior + delta).toFixed(4);

        await c.query(
          `INSERT INTO stock_ledger (
            organization_id, branch_id, warehouse_id, ingredient_id,
            movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
            balance_after, movement_sequence_number
          ) VALUES ($1, $2, $3, $4, 'COMPRA', $5, 2.0000, 10.0000, 20.0000, $6, $7);`,
          [concOrgId, concBranchId, concWhId, concIngId, `EVT-CONC-W${i}`, balanceAfter, seq],
        );

        await c.query('COMMIT;');
      } catch (err) {
        await c.query('ROLLBACK;');
        throw err;
      } finally {
        c.release();
      }
    });

    await Promise.all(workers.map((w) => w()));

    // Verify sequences and cumulative balance
    const verifyClient = await pool.connect();
    try {
      const rows = await verifyClient.query<{
        movement_sequence_number: string;
        quantity_delta: string;
        balance_after: string;
      }>(
        `SELECT movement_sequence_number::text, quantity_delta::text, balance_after::text
         FROM stock_ledger
         WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4
         ORDER BY movement_sequence_number ASC;`,
        [concOrgId, concBranchId, concWhId, concIngId],
      );

      assert.equal(rows.rows.length, 5);
      const sequences = rows.rows.map((r) => parseInt(r.movement_sequence_number, 10));
      assert.deepEqual(
        sequences,
        [1, 2, 3, 4, 5],
        'Sequences must be gapless and strictly monotonic',
      );

      const sumRes = await verifyClient.query<{ balance: string }>(
        `SELECT SUM(quantity_delta)::text as balance FROM stock_ledger
         WHERE organization_id = $1 AND branch_id = $2 AND warehouse_id = $3 AND ingredient_id = $4;`,
        [concOrgId, concBranchId, concWhId, concIngId],
      );
      assert.equal(sumRes.rows[0]!.balance, '10.0000');
      assert.equal(rows.rows[4]!.balance_after, '10.0000');

      // Note: stock_ledger is immutable append-only, so rows are retained within test tenant fixture
    } finally {
      verifyClient.release();
    }
  });

  it('WP018-DB-10 & WP018-DB-11: inventory_waste_records candidate keys, composite FKs, and mandatory fields', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const slId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${slId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'MERMA', 'CMD-WTEST-1', -2.0000, 50.0000, 100.0000, -2.0000, 1
        );
      `);

      const wrId = crypto.randomUUID();

      // Blank reason_code rejected
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CMD-WTEST-1', '   ', 'https://photo.local/w.jpg');`,
        [wrId, tenantAId, branchAId, whAId, ingAId, slId],
        /violates check constraint "chk_waste_records_reason_nonempty"/,
      );

      // Blank photo_attachment_url rejected
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CMD-WTEST-1', 'SPOILED', '   ');`,
        [wrId, tenantAId, branchAId, whAId, ingAId, slId],
        /violates check constraint "chk_waste_records_photo_nonempty"/,
      );

      // Cross-tenant stock_ledger reference rejected by FK or trigger
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CMD-WTEST-1', 'SPOILED', 'https://photo.local/w.jpg');`,
        [wrId, tenantAId, branchAId, whAId, ingAId, crypto.randomUUID()],
        /Referenced stock_ledger entry .* not found|violates foreign key constraint "fk_waste_records_ledger"/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-12: inventory_waste_records semantic integrity trigger enforces MERMA and negative delta', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      // 1. COMPRA ledger entry
      const compraId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${compraId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'COMPRA', 'EVT-COMPRA', 10.0000, 50.0000, 500.0000, 10.0000, 1
        );
      `);

      // Pointing waste record to COMPRA movement rejected
      const wr1 = crypto.randomUUID();
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CMD-T1', 'EXPIRED', 'https://photo.local/1.jpg');`,
        [wr1, tenantAId, branchAId, whAId, ingAId, compraId],
        /Waste record must reference a stock_ledger movement of type MERMA/,
      );

      // 2. Positive MERMA ledger entry (if artificially attempted)
      const posMermaId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${posMermaId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'MERMA', 'EVT-POSMERMA', 5.0000, 50.0000, 250.0000, 15.0000, 2
        );
      `);

      // Pointing waste record to positive delta rejected
      const wr2 = crypto.randomUUID();
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CMD-T2', 'EXPIRED', 'https://photo.local/2.jpg');`,
        [wr2, tenantAId, branchAId, whAId, ingAId, posMermaId],
        /Waste record must reference a negative stock_ledger quantity_delta/,
      );

      // 3. Valid negative MERMA entry succeeds
      const validMermaId = crypto.randomUUID();
      await client.query(`
        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${validMermaId}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          'MERMA', 'CMD-VAL1', -1.0000, 50.0000, 50.0000, 14.0000, 3
        );
      `);

      const wr3 = crypto.randomUUID();
      await client.query(`
        INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES (
          '${wr3}', '${tenantAId}', '${branchAId}', '${whAId}', '${ingAId}',
          '${validMermaId}', 'CMD-VAL1', 'EXPIRED', 'https://photo.local/valid.jpg'
        );
      `);

      const check = await client.query('SELECT id FROM inventory_waste_records WHERE id = $1;', [
        wr3,
      ]);
      assert.equal(check.rows.length, 1);

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DB-13: inventory_quarantine_records candidate keys and status constraint', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const qrId = crypto.randomUUID();

      // Valid quarantine record
      await client.query(`
        INSERT INTO inventory_quarantine_records (
          id, organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES (
          '${qrId}', '${tenantAId}', '${branchAId}', 'ORD-Q1', '{"test": true}', 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING'
        );
      `);

      // Duplicate source_event_id rejected by uniqueness
      const qrId2 = crypto.randomUUID();
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_quarantine_records (
          id, organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES ($1, $2, $3, 'ORD-Q1', '{"test": 2}', 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING');`,
        [qrId2, tenantAId, branchAId],
        /violates unique constraint "uq_quarantine_records_source"/,
      );

      // Invalid status rejected
      const qrId3 = crypto.randomUUID();
      await assertQueryRejects(
        client,
        `INSERT INTO inventory_quarantine_records (
          id, organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES ($1, $2, $3, 'ORD-Q3', '{"test": 3}', 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'INVALID_STATUS');`,
        [qrId3, tenantAId, branchAId],
        /violates check constraint "chk_quarantine_records_status"/,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP018-DOWN-01: Authorized non-production rollback of WP-018 removes WP-018 tables and preserves WP-017 / Platform Core / Outbox', async () => {
    const markerOrgId = crypto.randomUUID();
    const markerBranchId = crypto.randomUUID();
    const markerWhId = crypto.randomUUID();
    const markerIngId = crypto.randomUUID();
    const markerRecId = crypto.randomUUID();
    const markerProdId = crypto.randomUUID();
    const markerCatId = crypto.randomUUID();
    const markerLedgerId = crypto.randomUUID();
    const markerWasteId = crypto.randomUUID();
    const markerQuarantineId = crypto.randomUUID();

    // 1. Ensure migrations are up and seed marker data across WP-018, WP-017, WP-012, Platform Core
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES ('${markerOrgId}', 'WP018 Rollback Org', 'Rollback Org', 'TAX-WP018-RB-${markerOrgId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${markerBranchId}', '${markerOrgId}', 'BR-018-RB', 'Rollback Branch')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO categories (id, organization_id, code, name)
        VALUES ('${markerCatId}', '${markerOrgId}', 'CAT-018-RB', 'Rollback Category')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
        VALUES ('${markerProdId}', '${markerOrgId}', '${markerCatId}', 'PROD-018-RB', 'Rollback Product', 'COMPOSITE', 100.0000, '${crypto.randomUUID()}');

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES ('${markerWhId}', '${markerOrgId}', '${markerBranchId}', 'WH-018-RB', 'Rollback Warehouse', 'PRINCIPAL');

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES ('${markerIngId}', '${markerOrgId}', 'ING-018-RB', 'Rollback Ingredient', 'KG', 50.0000);

        INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
        VALUES ('${markerRecId}', '${markerOrgId}', '${markerProdId}', 'REC-018-RB', 'Rollback Recipe', 1.0000, 'PZ');

        INSERT INTO stock_ledger (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES (
          '${markerLedgerId}', '${markerOrgId}', '${markerBranchId}', '${markerWhId}', '${markerIngId}',
          'MERMA', 'CMD-RB-018', -1.0000, 50.0000, 50.0000, -1.0000, 1
        );

        INSERT INTO inventory_waste_records (
          id, organization_id, branch_id, warehouse_id, ingredient_id,
          stock_ledger_id, command_id, reason_code, photo_attachment_url
        ) VALUES (
          '${markerWasteId}', '${markerOrgId}', '${markerBranchId}', '${markerWhId}', '${markerIngId}',
          '${markerLedgerId}', 'CMD-RB-018', 'EXPIRED', 'https://photo.local/rb.jpg'
        );

        INSERT INTO inventory_quarantine_records (
          id, organization_id, branch_id, source_event_id, payload, reason, status
        ) VALUES (
          '${markerQuarantineId}', '${markerOrgId}', '${markerBranchId}', 'ORD-RB-018', '{"test": true}', 'MODIFIER_RECIPE_RESOLUTION_PENDING', 'PENDING'
        );
      `);
    } finally {
      client.release();
    }

    try {
      // 2. Execute authorized non-production migrateDown (roll down any migrations newer than WP-018 first)
      const checkClientBefore = await pool.connect();
      try {
        const appliedBefore = await getAppliedMigrations(checkClientBefore);
        for (let i = appliedBefore.length - 1; i >= 0; i--) {
          const entry = appliedBefore[i];
          if (entry && entry.id > '20260905000000') {
            await migrateDown(pool, { allowDestructiveDown: true });
          }
        }
      } finally {
        checkClientBefore.release();
      }

      const revertResult = await migrateDown(pool, { allowDestructiveDown: true });
      assert.equal(
        revertResult.reverted,
        '20260905000000_inventory_kardex_kds_depletion',
        'migrateDown must revert exactly WP-018 migration',
      );

      // 3. Verify WP-018 physical tables are removed
      const postCheck = await pool.query<{
        stock_ledger: string | null;
        inventory_waste_records: string | null;
        inventory_quarantine_records: string | null;
        warehouses: string | null;
        ingredients: string | null;
        recipes: string | null;
        recipe_items: string | null;
        cloud_integration_outbox: string | null;
        products: string | null;
        categories: string | null;
        organizations: string | null;
        branches: string | null;
      }>(`
        SELECT
          to_regclass('stock_ledger')::text as stock_ledger,
          to_regclass('inventory_waste_records')::text as inventory_waste_records,
          to_regclass('inventory_quarantine_records')::text as inventory_quarantine_records,
          to_regclass('warehouses')::text as warehouses,
          to_regclass('ingredients')::text as ingredients,
          to_regclass('recipes')::text as recipes,
          to_regclass('recipe_items')::text as recipe_items,
          to_regclass('cloud_integration_outbox')::text as cloud_integration_outbox,
          to_regclass('products')::text as products,
          to_regclass('categories')::text as categories,
          to_regclass('organizations')::text as organizations,
          to_regclass('branches')::text as branches;
      `);
      const post = postCheck.rows[0]!;
      assert.equal(post.stock_ledger, null, 'stock_ledger must be removed by rollback');
      assert.equal(
        post.inventory_waste_records,
        null,
        'inventory_waste_records must be removed by rollback',
      );
      assert.equal(
        post.inventory_quarantine_records,
        null,
        'inventory_quarantine_records must be removed by rollback',
      );

      // 4. Verify WP-017, WP-012, and Platform Core tables survived intact
      assert.ok(post.warehouses !== null, 'warehouses must survive WP-018 rollback');
      assert.ok(post.ingredients !== null, 'ingredients must survive WP-018 rollback');
      assert.ok(post.recipes !== null, 'recipes must survive WP-018 rollback');
      assert.ok(post.recipe_items !== null, 'recipe_items must survive WP-018 rollback');
      assert.ok(
        post.cloud_integration_outbox !== null,
        'cloud_integration_outbox must survive WP-018 rollback',
      );
      assert.ok(post.products !== null, 'products must survive WP-018 rollback');
      assert.ok(post.categories !== null, 'categories must survive WP-018 rollback');
      assert.ok(post.organizations !== null, 'organizations must survive WP-018 rollback');
      assert.ok(post.branches !== null, 'branches must survive WP-018 rollback');

      // 5. Verify WP-017 marker data survived
      const ingCheck = await pool.query<{ id: string }>(
        `SELECT id FROM ingredients WHERE id = $1;`,
        [markerIngId],
      );
      assert.equal(ingCheck.rows.length, 1, 'WP-017 marker ingredient data must survive');

      const whCheck = await pool.query<{ id: string }>(`SELECT id FROM warehouses WHERE id = $1;`, [
        markerWhId,
      ]);
      assert.equal(whCheck.rows.length, 1, 'WP-017 marker warehouse data must survive');

      // 6. Verify ledger state: WP-018 is no longer in applied ledger; WP-017 is latest
      const checkClient = await pool.connect();
      try {
        const applied = await getAppliedMigrations(checkClient);
        const hasWp018 = applied.some((m) => m.id === '20260905000000');
        assert.equal(hasWp018, false, 'WP-018 must no longer be recorded in applied migrations');
        const lastApplied = applied[applied.length - 1];
        assert.equal(
          lastApplied?.id,
          '20260904230000',
          'WP-017 migration must be the latest applied migration after WP-018 rollback',
        );
      } finally {
        checkClient.release();
      }
    } finally {
      // 7. Restore migration environment with migrateUp
      await migrateUp(pool);

      const restoreCheck = await pool.query<{
        stock_ledger: string | null;
        inventory_waste_records: string | null;
        inventory_quarantine_records: string | null;
      }>(`
        SELECT
          to_regclass('stock_ledger')::text as stock_ledger,
          to_regclass('inventory_waste_records')::text as inventory_waste_records,
          to_regclass('inventory_quarantine_records')::text as inventory_quarantine_records;
      `);
      const restored = restoreCheck.rows[0]!;
      assert.ok(restored.stock_ledger !== null, 'stock_ledger must be restored');
      assert.ok(
        restored.inventory_waste_records !== null,
        'inventory_waste_records must be restored',
      );
      assert.ok(
        restored.inventory_quarantine_records !== null,
        'inventory_quarantine_records must be restored',
      );

      // Cleanup marker rows
      const cleanClient = await pool.connect();
      try {
        await cleanClient.query(`
          DELETE FROM inventory_quarantine_records WHERE organization_id = '${markerOrgId}';
          DELETE FROM inventory_waste_records WHERE organization_id = '${markerOrgId}';
          DELETE FROM recipes WHERE organization_id = '${markerOrgId}';
          DELETE FROM ingredients WHERE organization_id = '${markerOrgId}';
          DELETE FROM warehouses WHERE organization_id = '${markerOrgId}';
          DELETE FROM products WHERE organization_id = '${markerOrgId}';
          DELETE FROM categories WHERE organization_id = '${markerOrgId}';
          DELETE FROM branches WHERE organization_id = '${markerOrgId}';
          DELETE FROM organizations WHERE id = '${markerOrgId}';
        `);
      } finally {
        cleanClient.release();
      }
    }
  });
});
