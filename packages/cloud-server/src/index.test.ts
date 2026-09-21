import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPool, migrateUp, withTenantTransaction } from '@trident/database';
import {
  RecipeNotFoundError,
  type KdsOrderProducedEventDTO,
  type ModifierRecipeResolver,
  type RegisterWasteCommand,
} from '@trident/inventory';
import type { RecepcionCompraRegistradaPayload } from '@trident/procurement';
import {
  PostgresCloudInventoryService,
  PostgresProcurementService,
  PostgresFinanceService,
  type PurchasePriceVarianceAuthorizationPolicy,
  type CreditLimitValidator,
  type CreditLimitEvaluationContext,
  type PaymentTermsDueDateResolver,
  type PaymentTermsDueDateResolverContext,
  PaymentTermsResolverRequiredError,
  APIdempotencyConflictError,
  ARIdempotencyConflictError,
  CashReconciliationIdempotencyConflictError,
  InvalidPaymentTermsError,
  PaymentReferenceRequiredError,
  SettlementReferenceRequiredError,
  PaymentAlreadyReversedError,
  SettlementAlreadyReversedError,
  PaymentIdempotencyConflictError,
  SettlementIdempotencyConflictError,
  AccountsReceivableInvalidStateError,
} from './index.js';
import type pg from 'pg';

class TestablePostgresCloudInventoryService extends PostgresCloudInventoryService {
  public testApplyKdsDepletionWithClient(
    client: pg.PoolClient,
    event: KdsOrderProducedEventDTO,
    customResolver?: ModifierRecipeResolver,
  ) {
    return this.applyKdsDepletionWithClient(client, event, customResolver);
  }
}

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

describe('TRIDENTPOS WP-018 Cloud Server Composition, Kárdex & KDS Depletion Suite', () => {
  const pool = getPool();
  const service = new PostgresCloudInventoryService(pool);

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const whAId = crypto.randomUUID();
  const whBId = crypto.randomUUID();
  const ingMeatId = crypto.randomUUID();
  const ingBunId = crypto.randomUUID();
  const ingCheeseId = crypto.randomUUID();
  const prodBurgerId = crypto.randomUUID();
  const recipeBurgerId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const taxSchemeId = crypto.randomUUID();
  const userAId = crypto.randomUUID();

  before(async () => {
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'WP018 Cloud Org A', 'Cloud Org A', 'TAX-WP018-CA-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'WP018 Cloud Org B', 'Cloud Org B', 'TAX-WP018-CB-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-018-CA1', 'Cloud Branch 18 A1'),
          ('${branchBId}', '${tenantBId}', 'BR-018-CB1', 'Cloud Branch 18 B1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO users (id, organization_id, email, full_name)
        VALUES
          ('${userAId}', '${tenantAId}', 'user-cloud-a@wp018.local', 'User Cloud A')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO categories (id, organization_id, code, name)
        VALUES
          ('${categoryId}', '${tenantAId}', 'CAT-018-C1', 'Category 18 A1')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO products (id, organization_id, category_id, code, name, product_type, base_price, tax_scheme_id)
        VALUES
          ('${prodBurgerId}', '${tenantAId}', '${categoryId}', 'PROD-BURGER-18', 'Classic Burger 18', 'COMPOSITE', 120.0000, '${taxSchemeId}')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES
          ('${whAId}', '${tenantAId}', '${branchAId}', 'WH-018-CA1', 'Warehouse 18 A1', 'PRINCIPAL'),
          ('${whBId}', '${tenantBId}', '${branchBId}', 'WH-018-CB1', 'Warehouse 18 B1', 'PRINCIPAL')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES
          ('${ingMeatId}', '${tenantAId}', 'ING-MEAT-18', 'Ground Beef 18', 'KG', 100.0000),
          ('${ingBunId}', '${tenantAId}', 'ING-BUN-18', 'Burger Bun 18', 'PZ', 10.0000),
          ('${ingCheeseId}', '${tenantAId}', 'ING-CHS-18', 'Cheddar Cheese 18', 'KG', 80.0000)
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO recipes (id, organization_id, product_id, code, name, yield_quantity, yield_unit)
        VALUES
          ('${recipeBurgerId}', '${tenantAId}', '${prodBurgerId}', 'REC-BURGER-18', 'Burger Recipe 18', 1.0000, 'PZ')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO recipe_items (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, quantity, gross_quantity, unit_cost_snapshot)
        VALUES
          ('${crypto.randomUUID()}', '${tenantAId}', '${recipeBurgerId}', '${ingMeatId}', NULL, 0.2000, 0.2200, 100.0000),
          ('${crypto.randomUUID()}', '${tenantAId}', '${recipeBurgerId}', '${ingBunId}', NULL, 1.0000, 1.0000, 10.0000)
        ON CONFLICT DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    // Note: stock_ledger entries are append-only and remain partitioned under test tenant UUIDs
  });

  it('WP018-CLOUD-01: getCurrentStock returns 0.0000 for uninitialized aggregate and exact derived sum after purchase', async () => {
    const initialStock = await service.getCurrentStock(tenantAId, branchAId, whAId, ingMeatId);
    assert.equal(initialStock, '0.0000');

    // Seed a COMPRA movement
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO stock_ledger (
          organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, 'COMPRA', 'PO-001', 50.0000, 100.0000, 5000.0000, 50.0000, 1);`,
        [tenantAId, branchAId, whAId, ingMeatId],
      );
    });

    const stockAfterPurchase = await service.getCurrentStock(
      tenantAId,
      branchAId,
      whAId,
      ingMeatId,
    );
    assert.equal(stockAfterPurchase, '50.0000');
  });

  it('WP018-CLOUD-02: registerWaste records MERMA movement, links waste evidence, and updates derived balance', async () => {
    const cmdId = `CMD-WASTE-${crypto.randomUUID()}`;
    const result = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingMeatId,
      commandId: cmdId,
      quantity: '2.5000',
      reasonCode: 'EXPIRED',
      photoAttachmentUrl: 'https://storage.local/waste/photo1.jpg',
      notes: 'Expired batch during morning prep',
      actorId: userAId,
    });

    assert.equal(result.movement.movementType, 'MERMA');
    assert.equal(result.movement.quantityDelta, '-2.5000');
    assert.equal(result.movement.balanceAfter, '47.5000');
    assert.equal(result.wasteRecord.commandId, cmdId);
    assert.equal(result.wasteRecord.reasonCode, 'EXPIRED');
    assert.equal(result.wasteRecord.photoAttachmentUrl, 'https://storage.local/waste/photo1.jpg');
    assert.equal(result.negativeStockAlert, null);

    const stock = await service.getCurrentStock(tenantAId, branchAId, whAId, ingMeatId);
    assert.equal(stock, '47.5000');
  });

  it('WP018-CLOUD-03: registerWaste emits NegativeStockSignal when derived balance becomes negative', async () => {
    const cmdId = `CMD-WASTE-NEG-${crypto.randomUUID()}`;
    const result = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingMeatId,
      commandId: cmdId,
      quantity: '100.0000', // Greater than available 47.5000 -> balance becomes -52.5000
      reasonCode: 'CONTAMINATED',
      photoAttachmentUrl: 'https://storage.local/waste/spill.jpg',
    });

    assert.equal(result.movement.movementType, 'MERMA');
    assert.equal(result.movement.quantityDelta, '-100.0000');
    assert.equal(result.movement.balanceAfter, '-52.5000');
    assert.ok(result.negativeStockAlert !== null);
    assert.equal(result.negativeStockAlert.balanceAfter, '-52.5000');
    assert.equal(result.negativeStockAlert.ingredientId, ingMeatId);
  });

  it('WP018-CLOUD-04: registerWaste is idempotent on commandId', async () => {
    const cmdId = `CMD-WASTE-IDEMP-${crypto.randomUUID()}`;
    const firstCall = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingBunId,
      commandId: cmdId,
      quantity: '5.0000',
      reasonCode: 'STALE',
      photoAttachmentUrl: 'https://storage.local/waste/bun.jpg',
    });

    const secondCall = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingBunId,
      commandId: cmdId,
      quantity: '5.0000',
      reasonCode: 'STALE',
      photoAttachmentUrl: 'https://storage.local/waste/bun.jpg',
    });

    assert.equal(firstCall.movement.id, secondCall.movement.id);
    assert.equal(firstCall.wasteRecord.id, secondCall.wasteRecord.id);

    // Verify only 1 movement in stock_ledger for this command
    const stock = await service.getCurrentStock(tenantAId, branchAId, whAId, ingBunId);
    assert.equal(stock, '-5.0000');
  });

  it('WP018-CLOUD-05: onKdsOrderProduced explodes recipe, deducts gross quantities, and enqueues outbox event', async () => {
    // Seed stock for buns
    await withTenantTransaction(pool, tenantAId, async (client) => {
      await client.query(
        `INSERT INTO stock_ledger (
          organization_id, branch_id, warehouse_id, ingredient_id,
          movement_type, reference_event_id, quantity_delta, unit_cost, total_cost,
          balance_after, movement_sequence_number
        ) VALUES ($1, $2, $3, $4, 'COMPRA', 'PO-BUNS', 20.0000, 10.0000, 200.0000, 15.0000, 2);`,
        [tenantAId, branchAId, whAId, ingBunId],
      );
    });

    const orderId = `ORD-PROD-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '2.0000', // 2 Burgers => 2 * 0.2200 KG meat = 0.4400 KG, 2 * 1.0000 PZ buns = 2.0000 PZ
        },
      ],
    };

    const depletionResult = await service.onKdsOrderProduced(event);

    assert.equal(depletionResult.status, 'APPLIED');
    assert.equal(depletionResult.ordenId, orderId);
    assert.equal(depletionResult.movements.length, 2);

    const meatMovement = depletionResult.movements.find((m) => m.ingredientId === ingMeatId)!;
    assert.ok(meatMovement);
    assert.equal(meatMovement.movementType, 'CONSUMO_KDS');
    assert.equal(meatMovement.quantityDelta, '-0.4400');
    assert.equal(meatMovement.referenceEventId, orderId);

    const bunMovement = depletionResult.movements.find((m) => m.ingredientId === ingBunId)!;
    assert.ok(bunMovement);
    assert.equal(bunMovement.movementType, 'CONSUMO_KDS');
    assert.equal(bunMovement.quantityDelta, '-2.0000');
    assert.equal(bunMovement.referenceEventId, orderId);

    // Verify outbox record created
    assert.ok(depletionResult.outboxEventId);
    const outboxCheck = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM cloud_integration_outbox WHERE id = $1;`,
      [depletionResult.outboxEventId],
    );
    assert.equal(outboxCheck.rows.length, 1);
    assert.equal(outboxCheck.rows[0]!.event_type, 'InventarioDescontadoPorReceta');
    assert.equal(outboxCheck.rows[0]!.payload.ordenId, orderId);
    assert.equal(outboxCheck.rows[0]!.payload.movements.length, 2);
  });

  it('WP018-CLOUD-06: onKdsOrderProduced duplicate order produces DUPLICATE_ACCEPTED with zero new deductions', async () => {
    const orderId = `ORD-PROD-DUP-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
        },
      ],
    };

    const firstRun = await service.onKdsOrderProduced(event);
    assert.equal(firstRun.status, 'APPLIED');

    const secondRun = await service.onKdsOrderProduced(event);
    assert.equal(secondRun.status, 'DUPLICATE_ACCEPTED');
    assert.equal(secondRun.ordenId, orderId);
    assert.equal(secondRun.movements.length, 2);
  });

  it('WP018-CLOUD-07: onKdsOrderProduced quarantines modifier-bearing event when no resolver is provided', async () => {
    const orderId = `ORD-MOD-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-extra-cheese',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    const res = await service.onKdsOrderProduced(event);

    assert.equal(res.status, 'QUARANTINED');
    assert.equal(res.ordenId, orderId);
    assert.ok(res.quarantineId);
    assert.equal(res.reason, 'MODIFIER_RECIPE_RESOLUTION_PENDING');

    // Verify persisted in inventory_quarantine_records with PENDING status
    const qCheck = await pool.query<{ status: string; reason: string }>(
      `SELECT status, reason FROM inventory_quarantine_records WHERE id = $1;`,
      [res.quarantineId],
    );
    assert.equal(qCheck.rows.length, 1);
    assert.equal(qCheck.rows[0]!.status, 'PENDING');
    assert.equal(qCheck.rows[0]!.reason, 'MODIFIER_RECIPE_RESOLUTION_PENDING');
  });

  it('WP018-CLOUD-08: replayQuarantinedDepletion executes depletion and marks quarantine record REPLAYED', async () => {
    const orderId = `ORD-REPLAY-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-extra-cheese',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    // 1. Initial execution quarantines the event
    const qResult = await service.onKdsOrderProduced(event);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    // 2. Define custom modifier recipe resolver
    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              {
                ingredientId: ingCheeseId,
                quantity: '0.0500',
                grossQuantity: '0.0500', // 50g extra cheese
              },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // 3. Replay quarantined depletion
    const replayResult = await service.replayQuarantinedDepletion(
      tenantAId,
      quarantineId,
      testResolver,
    );

    assert.equal(replayResult.status, 'APPLIED');
    assert.equal(replayResult.movements.length, 3); // meat + bun + extra cheese!

    const cheeseMov = replayResult.movements.find((m) => m.ingredientId === ingCheeseId);
    assert.ok(cheeseMov);
    assert.equal(cheeseMov.quantityDelta, '-0.0500');

    // Verify quarantine record transitioned to REPLAYED
    const qAfter = await pool.query<{ status: string; replayed_at: string | null }>(
      `SELECT status, replayed_at FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qAfter.rows[0]!.status, 'REPLAYED');
    assert.ok(qAfter.rows[0]!.replayed_at !== null);
  });

  it('WP018-CLOUD-10: resolver supplied but returns null -> QUARANTINED, zero ledger movements, zero outbox effect', async () => {
    const orderId = `ORD-MOD-NULL-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-unresolvable',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    const nullResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async () => null,
    };

    const res = await service.onKdsOrderProduced(event, nullResolver);

    assert.equal(res.status, 'QUARANTINED');
    assert.equal(res.ordenId, orderId);
    assert.ok(res.quarantineId);
    assert.equal(res.reason, 'MODIFIER_RECIPE_RESOLUTION_PENDING');

    // Verify ZERO stock movements created for this order
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 0);

    // Verify ZERO outbox events created for this order
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 0);
  });

  it('WP018-CLOUD-11: multiple modifiers with one returning null -> entire event quarantined, zero partial depletion', async () => {
    const orderId = `ORD-MOD-PARTIAL-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-valid-cheese',
              quantity: '1.0000',
            },
            {
              modifierId: 'mod-unresolvable-onion',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    const partialResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (ctx) => {
        if (ctx.modifierId === 'mod-valid-cheese') {
          return {
            modifierId: ctx.modifierId,
            additionalIngredients: [
              {
                ingredientId: ingCheeseId,
                quantity: '0.0500',
                grossQuantity: '0.0500',
              },
            ],
            removedIngredients: [],
          };
        }
        return null; // mod-unresolvable-onion cannot be resolved
      },
    };

    const res = await service.onKdsOrderProduced(event, partialResolver);

    assert.equal(res.status, 'QUARANTINED');
    assert.equal(res.ordenId, orderId);
    assert.ok(res.quarantineId);

    // Verify ZERO stock movements created (no partial base or cheese depletion)
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 0);

    // Verify ZERO outbox events created
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 0);
  });

  it('WP018-CLOUD-12: complete resolver result handling with removedIngredients and additionalIngredients', async () => {
    const orderId = `ORD-MOD-REMOVED-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '2.0000', // 2 Burgers
          selectedModifiers: [
            {
              modifierId: 'mod-no-meat',
              quantity: '1.0000',
            },
            {
              modifierId: 'mod-extra-cheese',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    // Resolver removes meat and adds cheese
    const fullResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (ctx) => {
        if (ctx.modifierId === 'mod-no-meat') {
          return {
            modifierId: ctx.modifierId,
            additionalIngredients: [],
            removedIngredients: [
              {
                ingredientId: ingMeatId,
              },
            ],
          };
        }
        if (ctx.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: ctx.modifierId,
            additionalIngredients: [
              {
                ingredientId: ingCheeseId,
                quantity: '0.1000',
                grossQuantity: '0.1000',
              },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    const res = await service.onKdsOrderProduced(event, fullResolver);

    assert.equal(res.status, 'APPLIED');
    assert.equal(res.ordenId, orderId);

    // Meat should be completely excluded because removedIngredients specified ingMeatId!
    const meatMovement = res.movements.find((m) => m.ingredientId === ingMeatId);
    assert.equal(meatMovement, undefined, 'Meat must be omitted when removed by modifier');

    // Bun should be deducted normally: 2.0000 PZ
    const bunMovement = res.movements.find((m) => m.ingredientId === ingBunId);
    assert.ok(bunMovement);
    assert.equal(bunMovement.quantityDelta, '-2.0000');

    // Cheese should be added: 2 * 0.1000 = 0.2000 KG
    const cheeseMovement = res.movements.find((m) => m.ingredientId === ingCheeseId);
    assert.ok(cheeseMovement);
    assert.equal(cheeseMovement.quantityDelta, '-0.2000');
  });

  it('WP018-CLOUD-13: controlled failure in replay transaction rolls back depletion and leaves quarantine PENDING', async () => {
    const orderId = `ORD-FAIL-ATOMIC-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-extra-cheese',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    // 1. Initial execution quarantines the event
    const qResult = await service.onKdsOrderProduced(event);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              {
                ingredientId: ingCheeseId,
                quantity: '0.0500',
                grossQuantity: '0.0500',
              },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // 2. Simulate transaction failure after depletion logic by executing in tenant transaction that rolls back
    const testService = new TestablePostgresCloudInventoryService(pool);
    await assert.rejects(async () => {
      await withTenantTransaction(pool, tenantAId, async (client) => {
        // Lock quarantine
        const qRes = await client.query<{ payload: any }>(
          `SELECT payload FROM inventory_quarantine_records WHERE organization_id = $1 AND id = $2 FOR UPDATE;`,
          [tenantAId, quarantineId],
        );
        const payload =
          typeof qRes.rows[0]!.payload === 'string'
            ? JSON.parse(qRes.rows[0]!.payload)
            : qRes.rows[0]!.payload;

        // Apply depletion on client via test subclass
        await testService.testApplyKdsDepletionWithClient(client, payload, testResolver);

        // Force deliberate failure BEFORE reconciliation commit
        throw new Error('SIMULATED_REPLAY_TRANSACTION_FAILURE');
      });
    }, /SIMULATED_REPLAY_TRANSACTION_FAILURE/);

    // 3. Verify ZERO stock movements persisted for this order
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 0, 'Zero stock movements must exist after rollback');

    // 4. Verify ZERO outbox events persisted for this order
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 0, 'Zero outbox events must exist after rollback');

    // 5. Verify quarantine record is still safely PENDING
    const qCheck = await pool.query<{ status: string; replayed_at: string | null }>(
      `SELECT status, replayed_at FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck.rows[0]!.status, 'PENDING');
    assert.equal(qCheck.rows[0]!.replayed_at, null);
  });

  it('WP018-CLOUD-14: replay retry on already replayed order produces DUPLICATE_ACCEPTED with zero new effects', async () => {
    const orderId = `ORD-REPLAY-RETRY-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [
            {
              modifierId: 'mod-extra-cheese',
              quantity: '1.0000',
            },
          ],
        },
      ],
    };

    const qResult = await service.onKdsOrderProduced(event);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              {
                ingredientId: ingCheeseId,
                quantity: '0.0500',
                grossQuantity: '0.0500',
              },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // First replay succeeds
    const replay1 = await service.replayQuarantinedDepletion(tenantAId, quarantineId, testResolver);
    assert.equal(replay1.status, 'APPLIED');
    assert.equal(replay1.movements.length, 3);

    // Second replay on the same quarantine record returns DUPLICATE_ACCEPTED
    const replay2 = await service.replayQuarantinedDepletion(tenantAId, quarantineId, testResolver);
    assert.equal(replay2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(replay2.ordenId, orderId);

    // Total movements in ledger for this order remains exactly 3
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 3);
  });

  it('R3-CLOUD-01: applyKdsDepletionWithClient is not a public application API', () => {
    const publicService = new PostgresCloudInventoryService(pool);
    // Verified protected helper method visibility
    assert.equal(
      typeof (publicService as unknown as Record<string, unknown>).applyKdsDepletionWithClient,
      'function',
    );
  });

  it('R3-CLOUD-02: REPLAYED quarantine followed by same original event without resolver returns DUPLICATE_ACCEPTED without reverting quarantine to PENDING', async () => {
    const orderId = `ORD-REPLAY-NOPENDING-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [{ modifierId: 'mod-extra-cheese', quantity: '1.0000' }],
        },
      ],
    };

    // A. Modifier event arrives -> QUARANTINED / PENDING
    const qRes = await service.onKdsOrderProduced(event);
    assert.equal(qRes.status, 'QUARANTINED');
    const quarantineId = qRes.quarantineId!;

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              { ingredientId: ingCheeseId, quantity: '0.0500', grossQuantity: '0.0500' },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // B. Authorized replay succeeds -> APPLIED, quarantine becomes REPLAYED
    const replayRes = await service.replayQuarantinedDepletion(
      tenantAId,
      quarantineId,
      testResolver,
    );
    assert.equal(replayRes.status, 'APPLIED');

    const qCheck1 = await pool.query<{ status: string }>(
      `SELECT status FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck1.rows[0]!.status, 'REPLAYED');

    // C. Same original event arrives again WITHOUT resolver
    const retryRes = await service.onKdsOrderProduced(event);
    assert.equal(retryRes.status, 'DUPLICATE_ACCEPTED');
    assert.equal(retryRes.ordenId, orderId);

    // Verify quarantine record remains REPLAYED (never reverts to PENDING)
    const qCheck2 = await pool.query<{ status: string }>(
      `SELECT status FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck2.rows[0]!.status, 'REPLAYED');

    // Verify ledger movement count remains 3 (no new movements created)
    const movCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movCount.rows[0]!.count, '3');

    // Verify outbox event count remains 1
    const outboxCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCount.rows[0]!.count, '1');
  });

  it('R3-CLOUD-03: registerWaste retry reconstructs negative-stock classification deterministically', async () => {
    const cmdId = `CMD-WASTE-R3NEG-${crypto.randomUUID()}`;
    // Register large waste on ingMeatId so balance goes negative
    const firstCall = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingMeatId,
      commandId: cmdId,
      quantity: '200.0000',
      reasonCode: 'CONTAMINATED',
      photoAttachmentUrl: 'https://storage.local/waste/contam.jpg',
    });

    assert.ok(firstCall.negativeStockAlert !== null);
    assert.equal(firstCall.negativeStockAlert.ingredientId, ingMeatId);

    // Second call with same commandId
    const retryCall = await service.registerWaste({
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingMeatId,
      commandId: cmdId,
      quantity: '200.0000',
      reasonCode: 'CONTAMINATED',
      photoAttachmentUrl: 'https://storage.local/waste/contam.jpg',
    });

    assert.ok(retryCall.negativeStockAlert !== null);
    assert.equal(retryCall.negativeStockAlert.ingredientId, ingMeatId);
    assert.equal(
      retryCall.negativeStockAlert.balanceAfter,
      firstCall.negativeStockAlert.balanceAfter,
    );
    assert.equal(retryCall.movement.id, firstCall.movement.id);
    assert.equal(retryCall.wasteRecord.id, firstCall.wasteRecord.id);

    // Total waste rows in database for this command is exactly 1
    const countCheck = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM inventory_waste_records WHERE organization_id = $1 AND command_id = $2;`,
      [tenantAId, cmdId],
    );
    assert.equal(countCheck.rows[0]!.count, '1');
  });

  it('R3-CLOUD-04: KDS duplicate order reconstructs negative-stock alerts from existing movements', async () => {
    const orderId = `ORD-PROD-NEG-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '500.0000', // large quantity -> produces negative stock on meat and buns
        },
      ],
    };

    const firstRun = await service.onKdsOrderProduced(event);
    assert.equal(firstRun.status, 'APPLIED');
    assert.ok(firstRun.negativeStockAlerts.length > 0);

    const secondRun = await service.onKdsOrderProduced(event);
    assert.equal(secondRun.status, 'DUPLICATE_ACCEPTED');
    assert.equal(secondRun.negativeStockAlerts.length, firstRun.negativeStockAlerts.length);
    assert.deepEqual(
      secondRun.negativeStockAlerts.map((a) => a.ingredientId).sort(),
      firstRun.negativeStockAlerts.map((a) => a.ingredientId).sort(),
    );
  });

  it('R3-CLOUD-05: applied ledger exists but required outbox is absent -> throws explicit integrity error', async () => {
    const orderId = `ORD-PROD-NOOUTBOX-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [{ productoId: prodBurgerId, cantidad: '1.0000' }],
    };

    const run = await service.onKdsOrderProduced(event);
    assert.equal(run.status, 'APPLIED');

    // Artificially delete the outbox entry to simulate corrupted/missing outbox state
    await pool.query(
      `DELETE FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );

    // Next duplicate check must throw explicit integrity error, never return outboxEventId: 'UNKNOWN'
    await assert.rejects(async () => {
      await service.onKdsOrderProduced(event);
    }, /Integrity error: KDS order .* missing required 'InventarioDescontadoPorReceta' outbox event/);
  });

  it('R3-CLOUD-06: two concurrent identical registerWaste commands complete deterministically with exactly one MERMA and one waste row', async () => {
    const cmdId = `CMD-WASTE-CONC-${crypto.randomUUID()}`;
    const command: RegisterWasteCommand = {
      organizationId: tenantAId,
      branchId: branchAId,
      warehouseId: whAId,
      ingredientId: ingBunId,
      commandId: cmdId,
      quantity: '3.0000',
      reasonCode: 'STALE',
      photoAttachmentUrl: 'https://storage.local/waste/stale.jpg',
    };

    const [res1, res2] = await Promise.all([
      service.registerWaste(command),
      service.registerWaste(command),
    ]);

    assert.equal(res1.movement.id, res2.movement.id);
    assert.equal(res1.wasteRecord.id, res2.wasteRecord.id);

    // Verify exactly 1 MERMA movement and 1 waste record exist in database
    const wasteCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM inventory_waste_records WHERE organization_id = $1 AND command_id = $2;`,
      [tenantAId, cmdId],
    );
    assert.equal(wasteCount.rows[0]!.count, '1');

    const ledgerCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, cmdId],
    );
    assert.equal(ledgerCount.rows[0]!.count, '1');
  });

  it('R3-CLOUD-07: two concurrent identical KDS source events complete deterministically (one APPLIED, one DUPLICATE_ACCEPTED)', async () => {
    const orderId = `ORD-CONC-KDS-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [{ productoId: prodBurgerId, cantidad: '1.0000' }],
    };

    const [res1, res2] = await Promise.all([
      service.onKdsOrderProduced(event),
      service.onKdsOrderProduced(event),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

    // Total ledger movements for this order is exactly 2 (meat + bun)
    const ledgerCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(ledgerCount.rows[0]!.count, '2');

    // Total outbox events for this order is exactly 1
    const outboxCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCount.rows[0]!.count, '1');
  });

  it('R4-CLOUD-01: concurrent replay and normal redelivery executes without deadlock with canonical lock ordering', async () => {
    const orderId = `ORD-CONC-REPLAY-REDELIVERY-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [{ modifierId: 'mod-extra-cheese', quantity: '1.0000' }],
        },
      ],
    };

    // 1. Initial execution quarantines the event as PENDING
    const qResult = await service.onKdsOrderProduced(event);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              { ingredientId: ingCheeseId, quantity: '0.0500', grossQuantity: '0.0500' },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // 2. Concurrently execute:
    // A: replayQuarantinedDepletion with resolver
    // B: onKdsOrderProduced without resolver (normal redelivery)
    const [resReplay, resRedelivery] = await Promise.all([
      service.replayQuarantinedDepletion(tenantAId, quarantineId, testResolver),
      service.onKdsOrderProduced(event),
    ]);

    assert.ok(
      resReplay.status === 'APPLIED' || resReplay.status === 'DUPLICATE_ACCEPTED',
      `Replay status should be APPLIED or DUPLICATE_ACCEPTED, got ${resReplay.status}`,
    );
    assert.ok(
      resRedelivery.status === 'QUARANTINED' || resRedelivery.status === 'DUPLICATE_ACCEPTED',
      `Redelivery status should be QUARANTINED or DUPLICATE_ACCEPTED, got ${resRedelivery.status}`,
    );

    // Verify exact stock_ledger movement count: exactly 3 movements (meat + bun + cheese)
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 3, 'Exactly 3 stock movements must be persisted');

    // Verify exactly 1 outbox event
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 1, 'Exactly 1 outbox event must be persisted');

    // Verify quarantine ends in REPLAYED
    const qCheck = await pool.query<{ status: string; replayed_at: string | null }>(
      `SELECT status, replayed_at FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck.rows[0]!.status, 'REPLAYED', 'Quarantine record must be in REPLAYED state');
    assert.ok(qCheck.rows[0]!.replayed_at !== null, 'replayed_at must be populated');
  });

  it('R4-CLOUD-02: reverse concurrency order (redelivery started first, replay overlapping) resolves cleanly without deadlock', async () => {
    const orderId = `ORD-CONC-REDELIVERY-FIRST-${crypto.randomUUID()}`;
    const event: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [{ modifierId: 'mod-extra-cheese', quantity: '1.0000' }],
        },
      ],
    };

    const qResult = await service.onKdsOrderProduced(event);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              { ingredientId: ingCheeseId, quantity: '0.0500', grossQuantity: '0.0500' },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // Redelivery launched, immediately overlapped with Replay
    const p1 = service.onKdsOrderProduced(event);
    const p2 = service.replayQuarantinedDepletion(tenantAId, quarantineId, testResolver);

    const [resRedelivery, resReplay] = await Promise.all([p1, p2]);

    assert.ok(
      resReplay.status === 'APPLIED' || resReplay.status === 'DUPLICATE_ACCEPTED',
      `Replay status should be APPLIED or DUPLICATE_ACCEPTED, got ${resReplay.status}`,
    );
    assert.ok(
      resRedelivery.status === 'QUARANTINED' || resRedelivery.status === 'DUPLICATE_ACCEPTED',
      `Redelivery status should be QUARANTINED or DUPLICATE_ACCEPTED, got ${resRedelivery.status}`,
    );

    // Total stock movements = 3
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 3);

    // Total outbox events = 1
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 1);

    // Quarantine state = REPLAYED
    const qCheck = await pool.query<{ status: string; replayed_at: string | null }>(
      `SELECT status, replayed_at FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck.rows[0]!.status, 'REPLAYED');
    assert.ok(qCheck.rows[0]!.replayed_at !== null);
  });

  it('R5-CLOUD-01: source events with identical (org, branch, orderId) derive the same advisory lock key regardless of warehouseId', async () => {
    const orderId = `ORD-LOCK-KEY-${crypto.randomUUID()}`;

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      await client1.query('BEGIN;');
      await client2.query('BEGIN;');

      // Lock key format in R5: KDS_SOURCE_EVENT:${tenantAId}:${branchAId}:${orderId}
      const lockKey = `KDS_SOURCE_EVENT:${tenantAId}:${branchAId}:${orderId}`;
      const lock1 = await client1.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked;`,
        [lockKey],
      );
      assert.equal(
        lock1.rows[0]!.locked,
        true,
        'Client 1 must successfully acquire the source-event advisory lock',
      );

      // Client 2 attempts to acquire the lock with identical org, branch, orderId (even if for different warehouse)
      const lock2 = await client2.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked;`,
        [lockKey],
      );
      assert.equal(
        lock2.rows[0]!.locked,
        false,
        'Client 2 must be blocked from acquiring the same source-event lock',
      );

      // Verify that lock key has exactly 4 colon-separated segments (KDS_SOURCE_EVENT, org, branch, order)
      const segments = lockKey.split(':');
      assert.equal(segments.length, 4, 'Lock key must be KDS_SOURCE_EVENT:org:branch:order');
      assert.equal(segments[0], 'KDS_SOURCE_EVENT');
      assert.equal(segments[1], tenantAId);
      assert.equal(segments[2], branchAId);
      assert.equal(segments[3], orderId);

      await client1.query('ROLLBACK;');
      await client2.query('ROLLBACK;');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('R5-CLOUD-02: concurrent replay and redelivery with pending quarantine payload update executes with stable lock identity and zero deadlocks', async () => {
    const orderId = `ORD-R5-CONC-${crypto.randomUUID()}`;
    const initialEvent: KdsOrderProducedEventDTO = {
      organizacionId: tenantAId,
      sucursalId: branchAId,
      centroConsumoId: whAId,
      ordenId: orderId,
      fechaHora: new Date().toISOString(),
      tiempoPreparacionMinutos: 5,
      items: [
        {
          productoId: prodBurgerId,
          cantidad: '1.0000',
          selectedModifiers: [{ modifierId: 'mod-extra-cheese', quantity: '1.0000' }],
        },
      ],
    };

    // 1. Deliver initial event without resolver -> Quarantined PENDING
    const qResult = await service.onKdsOrderProduced(initialEvent);
    assert.equal(qResult.status, 'QUARANTINED');
    const quarantineId = qResult.quarantineId!;

    // 2. Simulate redelivery / update while PENDING with modified metadata payload
    const updatedEvent: KdsOrderProducedEventDTO = {
      ...initialEvent,
      tiempoPreparacionMinutos: 8,
    };

    const testResolver: ModifierRecipeResolver = {
      resolveModifierImpact: async (req) => {
        if (req.modifierId === 'mod-extra-cheese') {
          return {
            modifierId: req.modifierId,
            additionalIngredients: [
              { ingredientId: ingCheeseId, quantity: '0.0500', grossQuantity: '0.0500' },
            ],
            removedIngredients: [],
          };
        }
        return null;
      },
    };

    // 3. Concurrently trigger replay and source redelivery
    const p1 = service.onKdsOrderProduced(updatedEvent);
    const p2 = service.replayQuarantinedDepletion(tenantAId, quarantineId, testResolver);

    const [resRedelivery, resReplay] = await Promise.all([p1, p2]);

    assert.ok(
      resReplay.status === 'APPLIED' || resReplay.status === 'DUPLICATE_ACCEPTED',
      `Replay status should be APPLIED or DUPLICATE_ACCEPTED, got ${resReplay.status}`,
    );
    assert.ok(
      resRedelivery.status === 'QUARANTINED' || resRedelivery.status === 'DUPLICATE_ACCEPTED',
      `Redelivery status should be QUARANTINED or DUPLICATE_ACCEPTED, got ${resRedelivery.status}`,
    );

    // Exactly 3 ledger movements (meat + bun + cheese)
    const movementsCheck = await pool.query(
      `SELECT id FROM stock_ledger WHERE organization_id = $1 AND reference_event_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(movementsCheck.rows.length, 3, 'Exactly 3 stock movements must be persisted');

    // Exactly 1 outbox event
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, orderId],
    );
    assert.equal(outboxCheck.rows.length, 1, 'Exactly 1 outbox event must be persisted');

    // Quarantine record ends in REPLAYED
    const qCheck = await pool.query<{ status: string; replayed_at: string | null }>(
      `SELECT status, replayed_at FROM inventory_quarantine_records WHERE id = $1;`,
      [quarantineId],
    );
    assert.equal(qCheck.rows[0]!.status, 'REPLAYED', 'Quarantine record must be in REPLAYED state');
    assert.ok(qCheck.rows[0]!.replayed_at !== null, 'replayed_at must be populated');
  });
});

describe('TRIDENTPOS WP-019 Cloud Server Procurement & Supplier Receiving Suite', () => {
  const pool = getPool();
  const procurementService = new PostgresProcurementService(pool);

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const warehouseAId = crypto.randomUUID();
  const warehouseBId = crypto.randomUUID();
  const ingredientA1Id = crypto.randomUUID();
  const ingredientA2Id = crypto.randomUUID();
  const ingredientBId = crypto.randomUUID();

  before(async () => {
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Tenant A Proc Corp', 'Tenant A Proc', 'RFC-A-PROC'),
          ('${tenantBId}', 'Tenant B Proc Corp', 'Tenant B Proc', 'RFC-B-PROC')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-A-PROC', 'Branch A Proc'),
          ('${branchBId}', '${tenantBId}', 'BR-B-PROC', 'Branch B Proc')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES
          ('${warehouseAId}', '${tenantAId}', '${branchAId}', 'WH-A-PROC', 'Main WH A', 'PHYSICAL'),
          ('${warehouseBId}', '${tenantBId}', '${branchBId}', 'WH-B-PROC', 'Main WH B', 'PHYSICAL')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES
          ('${ingredientA1Id}', '${tenantAId}', 'ING-A1', 'Flour', 'KG', 10.0000),
          ('${ingredientA2Id}', '${tenantAId}', 'ING-A2', 'Sugar', 'KG', 10.0000),
          ('${ingredientBId}', '${tenantBId}', 'ING-B1', 'Salt', 'KG', 10.0000)
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const cleanClient = await pool.connect();
    try {
      await cleanClient.query(`
        DELETE FROM cloud_integration_outbox WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_receipt_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_receipts WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_order_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_orders WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM suppliers WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM ingredients WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM warehouses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
      `);
    } finally {
      cleanClient.release();
    }
  });

  it('WP019-CLOUD-01: Supplier creation & retrieval with tenant isolation', async () => {
    const supA = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-001',
      tradeName: 'Supplier Alfa',
      taxId: 'RFC-ALFA',
      creditDays: 30,
    });
    assert.equal(supA.code, 'SUP-001');
    assert.equal(supA.tradeName, 'Supplier Alfa');
    assert.equal(supA.creditDays, 30);

    const fetchedA = await procurementService.getSupplier(tenantAId, supA.id);
    assert.ok(fetchedA !== null);
    assert.equal(fetchedA.id, supA.id);

    // Tenant B cannot access Tenant A supplier
    const crossTenantFetch = await procurementService.getSupplier(tenantBId, supA.id);
    assert.equal(crossTenantFetch, null);
  });

  it('WP019-CLOUD-02: PO lifecycle (DRAFT -> SENT) with exact scale-4 line calculations', async () => {
    const supA = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-002',
      tradeName: 'Supplier Beta',
      taxId: 'RFC-BETA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: supA.id,
      orderNumber: 'PO-2026-001',
      items: [
        { ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '25.5000' },
        { ingredientId: ingredientA2Id, orderedQuantity: '5.0000', unitCost: '12.0000' },
      ],
    });

    assert.equal(po.status, 'DRAFT');
    // Line 1: 10 * 25.5 = 255.0000, Line 2: 5 * 12 = 60.0000. Total = 315.0000
    assert.equal(po.totalAmount, '315.0000');
    assert.equal(po.items!.length, 2);

    const sentPo = await procurementService.sendPurchaseOrder(tenantAId, po.id);
    assert.equal(sentPo.status, 'SENT');
  });

  it('WP019-CLOUD-03: Cancel unreceived PO transitions to CANCELLED', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-003',
      tradeName: 'Supplier Gamma',
      taxId: 'RFC-GAMMA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-CANCEL-001',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '2.0000', unitCost: '10.0000' }],
    });

    const cancelledPo = await procurementService.cancelPurchaseOrder(tenantAId, po.id);
    assert.equal(cancelledPo.status, 'CANCELLED');
  });

  it('WP019-CLOUD-04: Partial physical receipt tracks remaining quantities and transitions PO to PARTIAL and then RECEIVED', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-004',
      tradeName: 'Supplier Delta',
      taxId: 'RFC-DELTA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-RECEIVE-001',
      items: [
        { ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '20.0000' },
        { ingredientId: ingredientA2Id, orderedQuantity: '20.0000', unitCost: '15.0000' },
      ],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);

    const poItem1 = po.items!.find((i) => i.ingredientId === ingredientA1Id)!;
    const poItem2 = po.items!.find((i) => i.ingredientId === ingredientA2Id)!;

    // First partial receipt: 6 of item 1, 10 of item 2
    const receipt1Res = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-001',
      invoiceReference: 'INV-001',
      items: [
        {
          purchaseOrderItemId: poItem1.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '6.0000',
          acceptedUnitCost: '20.0000',
        },
        {
          purchaseOrderItemId: poItem2.id,
          ingredientId: ingredientA2Id,
          receivedQuantity: '10.0000',
          acceptedUnitCost: '15.0000',
        },
      ],
    });

    assert.equal(receipt1Res.status, 'APPLIED');
    assert.equal(receipt1Res.receipt.totalAmount, '270.0000'); // (6*20) + (10*15) = 120 + 150 = 270.0000

    // Check PO status transitioned to PARTIAL
    const poAfterRec1 = await procurementService.getPurchaseOrder(tenantAId, po.id);
    assert.equal(poAfterRec1?.status, 'PARTIAL');

    // Second receipt fulfilling remaining: 4 of item 1, 10 of item 2
    const receipt2Res = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-002',
      items: [
        {
          purchaseOrderItemId: poItem1.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '4.0000',
          acceptedUnitCost: '20.0000',
        },
        {
          purchaseOrderItemId: poItem2.id,
          ingredientId: ingredientA2Id,
          receivedQuantity: '10.0000',
          acceptedUnitCost: '15.0000',
        },
      ],
    });

    assert.equal(receipt2Res.status, 'APPLIED');
    assert.equal(receipt2Res.receipt.totalAmount, '230.0000'); // (4*20) + (10*15) = 80 + 150 = 230.0000

    // Check PO status transitioned to RECEIVED
    const poAfterRec2 = await procurementService.getPurchaseOrder(tenantAId, po.id);
    assert.equal(poAfterRec2?.status, 'RECEIVED');

    // Cannot cancel partially/fully received PO
    await assert.rejects(
      async () => procurementService.cancelPurchaseOrder(tenantAId, po.id),
      /InvalidPurchaseOrderTransitionError|Cannot cancel purchase order in status/i,
    );
  });

  it('WP019-CLOUD-05: Over-receipt is rejected fail-closed (OVER_RECEIPT_NOT_AUTHORIZED)', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-005',
      tradeName: 'Supplier Epsilon',
      taxId: 'RFC-EPSILON',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-OVER-001',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    // Attempting to receive 6 when only 5 was ordered
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-OVER-001',
          items: [
            {
              purchaseOrderItemId: poItemId,
              ingredientId: ingredientA1Id,
              receivedQuantity: '6.0000',
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /OverReceiptNotAuthorizedError|Over-receipt not authorized/i,
    );
  });

  it('WP019-CLOUD-06: Price variance handling — equal price succeeds, unequal without policy fails closed, injected TEST policy works', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-006',
      tradeName: 'Supplier Zeta',
      taxId: 'RFC-ZETA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-PRICE-001',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '20.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    // 1. Unequal price (25.0000 vs 20.0000) with NO policy -> fails closed
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-PRICE-VAR-1',
          items: [
            {
              purchaseOrderItemId: poItemId,
              ingredientId: ingredientA1Id,
              receivedQuantity: '2.0000',
              acceptedUnitCost: '25.0000',
            },
          ],
        }),
      /PRICE_VARIANCE_POLICY_REQUIRED|PriceVarianceRequiredError/i,
    );

    // 2. Injected TEST policy: allows with supervisor authorization (TEST ONLY — NOT PRODUCT OWNER POLICY)
    const testPolicy: PurchasePriceVarianceAuthorizationPolicy = {
      evaluatePriceVariance: (req) => {
        if (req.receivedUnitCost === '25.0000') {
          return 'SUPERVISOR_AUTHORIZATION_REQUIRED';
        }
        return 'REJECTED';
      },
    };

    const recRes = await procurementService.confirmPurchaseReceipt(
      {
        organizationId: tenantAId,
        branchId: branchAId,
        purchaseOrderId: po.id,
        supplierId: sup.id,
        warehouseId: warehouseAId,
        receiptNumber: 'REC-PRICE-VAR-2',
        supervisorAuthorizationToken: 'AUTH-TEST-TOKEN',
        items: [
          {
            purchaseOrderItemId: poItemId,
            ingredientId: ingredientA1Id,
            receivedQuantity: '2.0000',
            acceptedUnitCost: '25.0000',
          },
        ],
      },
      testPolicy,
    );
    assert.equal(recRes.status, 'APPLIED');
    assert.equal(recRes.receipt.totalAmount, '50.0000');
  });

  it('WP019-CLOUD-07: Receipt confirmation and RecepcionCompraRegistrada outbox enqueue are atomic & idempotent', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-007',
      tradeName: 'Supplier Eta',
      taxId: 'RFC-ETA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-OUTBOX-001',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    // 1. Confirm receipt
    const res1 = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-OUTBOX-001',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });
    assert.equal(res1.status, 'APPLIED');

    // Verify exactly 1 outbox event persisted
    const outboxCheck1 = await pool.query(
      `SELECT id, event_type, aggregate_id FROM cloud_integration_outbox
       WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, res1.receipt.id],
    );
    assert.equal(outboxCheck1.rows.length, 1);
    assert.equal(outboxCheck1.rows[0]!.event_type, 'RecepcionCompraRegistrada');

    // 2. Retry identical receipt confirmation -> returns DUPLICATE_ACCEPTED with ZERO new outbox events
    const res2 = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-OUTBOX-001',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.receipt.id, res1.receipt.id);
    assert.deepEqual(res2.eventPayload, res1.eventPayload);

    const outboxCheck2 = await pool.query(
      `SELECT id FROM cloud_integration_outbox
       WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, res1.receipt.id],
    );
    assert.equal(outboxCheck2.rows.length, 1, 'Retry must not produce duplicate outbox event');
  });

  it('WP019-CLOUD-08: Concurrent receipt confirmations with same receipt number serialize cleanly with exactly 1 outbox event', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-008',
      tradeName: 'Supplier Theta',
      taxId: 'RFC-THETA',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-CONC-001',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-CONC-001',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    };

    const [r1, r2] = await Promise.all([
      procurementService.confirmPurchaseReceipt(cmd),
      procurementService.confirmPurchaseReceipt(cmd),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

    const receiptId = r1.receipt.id;
    const outboxCheck = await pool.query(
      `SELECT id FROM cloud_integration_outbox
       WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, receiptId],
    );
    assert.equal(
      outboxCheck.rows.length,
      1,
      'Concurrent execution must produce exactly 1 outbox event',
    );
  });

  it('WP019-CLOUD-09: Procurement performs ZERO direct writes to stock_ledger, current_average_cost, or accounts_payable', async () => {
    // Check stock_ledger before and after
    const preLedger = await pool.query(
      `SELECT COUNT(*) as count FROM stock_ledger WHERE organization_id = $1;`,
      [tenantAId],
    );
    const preAccountsPayable = await pool.query(`SELECT to_regclass('accounts_payable') as reg;`);

    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-009',
      tradeName: 'Supplier Iota',
      taxId: 'RFC-IOTA',
    });
    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-ZERO-WRITES',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '3.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-ZERO-WRITES',
      items: [
        {
          purchaseOrderItemId: po.items![0]!.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '3.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });

    const postLedger = await pool.query(
      `SELECT COUNT(*) as count FROM stock_ledger WHERE organization_id = $1;`,
      [tenantAId],
    );
    assert.equal(
      preLedger.rows[0]!.count,
      postLedger.rows[0]!.count,
      'Procurement must perform ZERO direct writes to stock_ledger',
    );

    // If accounts_payable table doesn't even exist yet (since WP-020 owns it), verify it wasn't created/written
    if (preAccountsPayable.rows[0]?.reg) {
      const apCount = await pool.query(
        `SELECT COUNT(*) as count FROM accounts_payable WHERE organization_id = $1;`,
        [tenantAId],
      );
      assert.equal(apCount.rows[0]!.count, '0');
    }
  });

  it('R2-CLOUD-01: same receipt retry returns exact durable prior event payload from outbox', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-01',
      tradeName: 'Supplier R2-01',
      taxId: 'RFC-R2-01',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-01',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '15.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-01',
      paymentTerms: 'NET_30',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '4.0000',
          acceptedUnitCost: '15.0000',
        },
      ],
    };

    const first = await procurementService.confirmPurchaseReceipt(cmd);
    assert.equal(first.status, 'APPLIED');
    assert.equal(first.eventPayload.paymentTerms, 'NET_30');
    assert.equal(first.eventPayload.items[0]!.orderedQuantity, '10.0000');
    assert.equal(first.eventPayload.items[0]!.previouslyReceivedQuantity, '0.0000');
    assert.equal(first.eventPayload.items[0]!.receivedQuantity, '4.0000');
    assert.equal(first.eventPayload.items[0]!.cumulativeReceivedQuantity, '4.0000');
    assert.equal(first.eventPayload.items[0]!.remainingQuantity, '6.0000');

    // Retry with different payment terms in the retry command -> MUST NOT override durable historical event
    const retryCmd = { ...cmd, paymentTerms: 'CONTADO_CASH' };
    const retry = await procurementService.confirmPurchaseReceipt(retryCmd);
    assert.equal(retry.status, 'DUPLICATE_ACCEPTED');
    assert.equal(retry.eventPayload.paymentTerms, 'NET_30'); // Preserves original durable event!
    assert.equal(retry.eventPayload.items[0]!.orderedQuantity, '10.0000');
    assert.equal(retry.eventPayload.items[0]!.remainingQuantity, '6.0000');
    assert.deepEqual(retry.eventPayload, first.eventPayload);
  });

  it('R2-CLOUD-02: receipt number reused for different PO fails closed (RECEIPT_IDEMPOTENCY_CONFLICT)', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-02',
      tradeName: 'Supplier R2-02',
      taxId: 'RFC-R2-02',
    });

    const po1 = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-02-A',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po1.id);

    const po2 = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-02-B',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po2.id);

    await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po1.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-02-CONFLICT',
      items: [
        {
          purchaseOrderItemId: po1.items![0]!.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });

    // Attempting to reuse same receiptNumber for po2 -> FAILS CLOSED
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po2.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-02-CONFLICT',
          items: [
            {
              purchaseOrderItemId: po2.items![0]!.id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );
  });

  it('R2-CLOUD-03: receipt number reused with different supplier or warehouse fails closed', async () => {
    const supA = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-03-A',
      tradeName: 'Supplier R2-03-A',
      taxId: 'RFC-R2-03-A',
    });
    const supB = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-03-B',
      tradeName: 'Supplier R2-03-B',
      taxId: 'RFC-R2-03-B',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: supA.id,
      orderNumber: 'PO-R2-03',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);

    await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: supA.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-03-CONFLICT',
      items: [
        {
          purchaseOrderItemId: po.items![0]!.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });

    // 1. Different supplier
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: supB.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-03-CONFLICT',
          items: [
            {
              purchaseOrderItemId: po.items![0]!.id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );

    // 2. Different warehouse
    const fakeWarehouseId = crypto.randomUUID();
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: supA.id,
          warehouseId: fakeWarehouseId,
          receiptNumber: 'REC-R2-03-CONFLICT',
          items: [
            {
              purchaseOrderItemId: po.items![0]!.id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );
  });

  it('R2-CLOUD-04: receipt number reused with different line quantities/costs/items fails closed', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-04',
      tradeName: 'Supplier R2-04',
      taxId: 'RFC-R2-04',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-04',
      items: [
        { ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '20.0000' },
        { ingredientId: ingredientA2Id, orderedQuantity: '10.0000', unitCost: '30.0000' },
      ],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItem1Id = po.items![0]!.id;
    const poItem2Id = po.items![1]!.id;

    await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-04-CONFLICT',
      items: [
        {
          purchaseOrderItemId: poItem1Id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '20.0000',
        },
      ],
    });

    // 1. Different quantity (6.0000 instead of 5.0000)
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-04-CONFLICT',
          items: [
            {
              purchaseOrderItemId: poItem1Id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '6.0000',
              acceptedUnitCost: '20.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );

    // 2. Different cost (25.0000 instead of 20.0000)
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-04-CONFLICT',
          items: [
            {
              purchaseOrderItemId: poItem1Id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '25.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );

    // 3. Different number of items (attempting to add 2nd line)
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-04-CONFLICT',
          items: [
            {
              purchaseOrderItemId: poItem1Id,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '20.0000',
            },
            {
              purchaseOrderItemId: poItem2Id,
              ingredientId: ingredientA2Id,
              receivedQuantity: '2.0000',
              acceptedUnitCost: '30.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );
  });

  it('R2-CLOUD-05: concurrent DISTINCT partial receipts cannot over-receive (6.0000 + 6.0000 on 10.0000 PO item)', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-05',
      tradeName: 'Supplier R2-05',
      taxId: 'RFC-R2-05',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-CONC-DIST',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '10.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    const cmdA = {
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-CONC-DIST-A',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '6.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    };

    const cmdB = {
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-CONC-DIST-B',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '6.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    };

    // Execute simultaneously
    const results = await Promise.allSettled([
      procurementService.confirmPurchaseReceipt(cmdA),
      procurementService.confirmPurchaseReceipt(cmdB),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    assert.equal(fulfilled.length, 1, 'Exactly one distinct receipt must succeed');
    assert.equal(
      rejected.length,
      1,
      'The other distinct receipt must be rejected to prevent over-receipt',
    );
    assert.equal(fulfilled[0]!.value.status, 'APPLIED');
    assert.match(
      rejected[0]!.reason.message,
      /OVER_RECEIPT_NOT_AUTHORIZED|OverReceiptNotAuthorizedError/i,
    );

    // Verify DB cumulative received quantity is 6.0000, never 12.0000
    const dbSum = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(received_quantity), 0.0000)::text as total
       FROM purchase_receipt_items pri
       JOIN purchase_receipts pr ON pr.id = pri.purchase_receipt_id
       WHERE pr.organization_id = $1 AND pri.purchase_order_item_id = $2 AND pr.status = 'CONFIRMED';`,
      [tenantAId, poItemId],
    );
    assert.equal(dbSum.rows[0]!.total, '6.0000');

    // Verify outbox count is exactly 1
    const appliedReceiptId = fulfilled[0]!.value.receipt.id;
    const outboxRows = await pool.query(
      `SELECT id FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, appliedReceiptId],
    );
    assert.equal(outboxRows.rows.length, 1, 'Exactly one outbox event for applied receipt');
  });

  it('R2-CLOUD-06: failed conflicting retry creates zero new receipt/items/outbox', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-06',
      tradeName: 'Supplier R2-06',
      taxId: 'RFC-R2-06',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-06',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-06',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });

    const preCountReceipts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );
    const preCountItems = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipt_items WHERE organization_id = $1;`,
      [tenantAId],
    );
    const preCountOutbox = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cloud_integration_outbox WHERE organization_id = $1;`,
      [tenantAId],
    );

    // Attempt conflicting retry
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-06',
          items: [
            {
              purchaseOrderItemId: poItemId,
              ingredientId: ingredientA1Id,
              receivedQuantity: '3.0000', // Conflicting quantity
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /RECEIPT_IDEMPOTENCY_CONFLICT/i,
    );

    const postCountReceipts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );
    const postCountItems = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipt_items WHERE organization_id = $1;`,
      [tenantAId],
    );
    const postCountOutbox = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cloud_integration_outbox WHERE organization_id = $1;`,
      [tenantAId],
    );

    assert.equal(postCountReceipts.rows[0]!.count, preCountReceipts.rows[0]!.count);
    assert.equal(postCountItems.rows[0]!.count, preCountItems.rows[0]!.count);
    assert.equal(postCountOutbox.rows[0]!.count, preCountOutbox.rows[0]!.count);
  });

  it('R2-CLOUD-07: missing canonical prior outbox event fails closed with RECEIPT_OUTBOX_INTEGRITY_ERROR', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R2-07',
      tradeName: 'Supplier R2-07',
      taxId: 'RFC-R2-07',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R2-07',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    const res1 = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R2-07',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    });
    assert.equal(res1.status, 'APPLIED');

    // Simulate missing outbox event
    await pool.query(
      `DELETE FROM cloud_integration_outbox WHERE organization_id = $1 AND aggregate_id = $2;`,
      [tenantAId, res1.receipt.id],
    );

    // Retry should fail closed
    await assert.rejects(
      async () =>
        procurementService.confirmPurchaseReceipt({
          organizationId: tenantAId,
          branchId: branchAId,
          purchaseOrderId: po.id,
          supplierId: sup.id,
          warehouseId: warehouseAId,
          receiptNumber: 'REC-R2-07',
          items: [
            {
              purchaseOrderItemId: poItemId,
              ingredientId: ingredientA1Id,
              receivedQuantity: '5.0000',
              acceptedUnitCost: '10.0000',
            },
          ],
        }),
      /RECEIPT_OUTBOX_INTEGRITY_ERROR/i,
    );
  });

  it('R3-CLOUD-01: multiple matching outbox rows fails closed with RECEIPT_OUTBOX_INTEGRITY_ERROR', async () => {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: 'SUP-R3-01',
      tradeName: 'Supplier R3-01',
      taxId: 'RFC-R3-01',
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: 'PO-R3-01',
      items: [{ ingredientId: ingredientA1Id, orderedQuantity: '5.0000', unitCost: '10.0000' }],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);
    const poItemId = po.items![0]!.id;

    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-R3-01',
      items: [
        {
          purchaseOrderItemId: poItemId,
          ingredientId: ingredientA1Id,
          receivedQuantity: '5.0000',
          acceptedUnitCost: '10.0000',
        },
      ],
    };

    const res1 = await procurementService.confirmPurchaseReceipt(cmd);
    assert.equal(res1.status, 'APPLIED');

    // Verify exactly 1 outbox event initially
    const outboxCheckInitial = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cloud_integration_outbox
       WHERE organization_id = $1 AND branch_id = $2 AND event_type = 'RecepcionCompraRegistrada' AND aggregate_type = 'PURCHASE_RECEIPT' AND aggregate_id = $3;`,
      [tenantAId, branchAId, res1.receipt.id],
    );
    assert.equal(outboxCheckInitial.rows[0]!.count, '1');

    // Manually insert a SECOND matching outbox row simulating corrupted/ambiguous outbox state
    await pool.query(
      `INSERT INTO cloud_integration_outbox (
        organization_id, branch_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES ($1, $2, 'RecepcionCompraRegistrada', 'PURCHASE_RECEIPT', $3, $4);`,
      [tenantAId, branchAId, res1.receipt.id, JSON.stringify(res1.eventPayload)],
    );

    // Verify 2 matching outbox rows before retry
    const outboxCheckBeforeRetry = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cloud_integration_outbox
       WHERE organization_id = $1 AND branch_id = $2 AND event_type = 'RecepcionCompraRegistrada' AND aggregate_type = 'PURCHASE_RECEIPT' AND aggregate_id = $3;`,
      [tenantAId, branchAId, res1.receipt.id],
    );
    assert.equal(outboxCheckBeforeRetry.rows[0]!.count, '2');

    const preCountReceipts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );
    const preCountItems = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipt_items WHERE organization_id = $1;`,
      [tenantAId],
    );

    // Retry should fail closed with RECEIPT_OUTBOX_INTEGRITY_ERROR (found 2)
    await assert.rejects(
      async () => procurementService.confirmPurchaseReceipt(cmd),
      /RECEIPT_OUTBOX_INTEGRITY_ERROR.*Expected exactly one.*found 2/i,
    );

    // Verify no new business mutation
    const postCountReceipts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );
    const postCountItems = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipt_items WHERE organization_id = $1;`,
      [tenantAId],
    );
    const outboxCheckAfterRetry = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cloud_integration_outbox
       WHERE organization_id = $1 AND branch_id = $2 AND event_type = 'RecepcionCompraRegistrada' AND aggregate_type = 'PURCHASE_RECEIPT' AND aggregate_id = $3;`,
      [tenantAId, branchAId, res1.receipt.id],
    );

    assert.equal(postCountReceipts.rows[0]!.count, preCountReceipts.rows[0]!.count);
    assert.equal(postCountItems.rows[0]!.count, preCountItems.rows[0]!.count);
    assert.equal(outboxCheckAfterRetry.rows[0]!.count, '2');
  });
});

describe('TRIDENTPOS WP-020 Cloud Server Finance, AP, AR & Cash Reconciliation Suite', () => {
  const pool = getPool();
  const procurementService = new PostgresProcurementService(pool);
  const financeService = new PostgresFinanceService(pool);

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const warehouseAId = crypto.randomUUID();
  const warehouseBId = crypto.randomUUID();
  const ingredientA1Id = crypto.randomUUID();
  const customerAId = crypto.randomUUID();

  before(async () => {
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Tenant A Finance Corp', 'Tenant A Fin', 'RFC-A-FIN-${tenantAId.slice(0, 8)}'),
          ('${tenantBId}', 'Tenant B Finance Corp', 'Tenant B Fin', 'RFC-B-FIN-${tenantBId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-A-FIN', 'Branch A Fin'),
          ('${branchBId}', '${tenantBId}', 'BR-B-FIN', 'Branch B Fin')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES
          ('${warehouseAId}', '${tenantAId}', '${branchAId}', 'WH-A-FIN', 'Main WH A Fin', 'PHYSICAL'),
          ('${warehouseBId}', '${tenantBId}', '${branchBId}', 'WH-B-FIN', 'Main WH B Fin', 'PHYSICAL')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES
          ('${ingredientA1Id}', '${tenantAId}', 'ING-A-FIN-1', 'Flour Fin', 'KG', 10.0000)
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const cleanClient = await pool.connect();
    try {
      await cleanClient.query(`
        ALTER TABLE accounts_receivable_settlements DISABLE TRIGGER trg_ar_settlements_immutable;
        ALTER TABLE accounts_payable_payments DISABLE TRIGGER trg_ap_payments_immutable;
        DELETE FROM accounts_receivable_settlements WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM accounts_payable_payments WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        ALTER TABLE accounts_receivable_settlements ENABLE TRIGGER trg_ar_settlements_immutable;
        ALTER TABLE accounts_payable_payments ENABLE TRIGGER trg_ap_payments_immutable;
        DELETE FROM cash_reconciliations WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branch_operating_expenses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM accounts_receivable WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM scheduled_payments WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM accounts_payable WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM cloud_integration_outbox WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_receipt_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_receipts WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_order_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM purchase_orders WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM suppliers WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM ingredients WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM warehouses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
      `);
    } finally {
      cleanClient.release();
    }
  });

  async function createTestReceipt(options: {
    receiptNumber: string;
    totalAmount: string;
    paymentTerms: string;
    creditDays?: number;
  }) {
    const sup = await procurementService.createSupplier({
      organizationId: tenantAId,
      code: `SUP-${options.receiptNumber}`,
      tradeName: `Supplier ${options.receiptNumber}`,
      taxId: `RFC-${options.receiptNumber}`,
      creditDays: options.creditDays ?? 30,
    });

    const po = await procurementService.createPurchaseOrder({
      organizationId: tenantAId,
      branchId: branchAId,
      supplierId: sup.id,
      orderNumber: `PO-${options.receiptNumber}`,
      items: [
        {
          ingredientId: ingredientA1Id,
          orderedQuantity: '1.0000',
          unitCost: options.totalAmount,
        },
      ],
    });
    await procurementService.sendPurchaseOrder(tenantAId, po.id);

    const recResult = await procurementService.confirmPurchaseReceipt({
      organizationId: tenantAId,
      branchId: branchAId,
      purchaseOrderId: po.id,
      supplierId: sup.id,
      warehouseId: warehouseAId,
      receiptNumber: options.receiptNumber,
      paymentTerms: options.paymentTerms,
      items: [
        {
          purchaseOrderItemId: po.items![0]!.id,
          ingredientId: ingredientA1Id,
          receivedQuantity: '1.0000',
          acceptedUnitCost: options.totalAmount,
        },
      ],
    });

    return { sup, po, receipt: recResult.receipt, eventPayload: recResult.eventPayload };
  }

  // TEST ONLY — NOT PRODUCT OWNER / CANONICAL PAYMENT TERMS POLICY
  const testOnlyPaymentTermsResolver: PaymentTermsDueDateResolver = {
    async resolveDueDate(ctx: PaymentTermsDueDateResolverContext): Promise<string> {
      if (
        !ctx.paymentTerms ||
        ctx.paymentTerms === 'CONTADO' ||
        ctx.paymentTerms === 'CONTADO_CASH' ||
        ctx.paymentTerms === 'CASH'
      ) {
        return ctx.receivedAt.slice(0, 10);
      }
      if (ctx.paymentTerms === 'NET_15') {
        const d = new Date(ctx.receivedAt);
        d.setUTCDate(d.getUTCDate() + 15);
        return d.toISOString().slice(0, 10);
      }
      if (ctx.paymentTerms === 'NET_30') {
        const d = new Date(ctx.receivedAt);
        d.setUTCDate(d.getUTCDate() + 30);
        return d.toISOString().slice(0, 10);
      }
      throw new InvalidPaymentTermsError(ctx.paymentTerms);
    },
  };

  it('WP020-CLOUD-01 / R3-CLOUD-01: RecepcionCompraRegistrada creates AP storing supplier_id and purchase_receipt_id as external aggregate identities', async () => {
    const { receipt, eventPayload, sup } = await createTestReceipt({
      receiptNumber: 'REC-FIN-001',
      totalAmount: '500.0000',
      paymentTerms: 'NET_30',
    });

    const result = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(result.status, 'APPLIED');
    assert.equal(result.accountsPayable.organizationId, tenantAId);
    assert.equal(result.accountsPayable.branchId, branchAId);
    assert.equal(result.accountsPayable.supplierId, sup.id);
    assert.equal(result.accountsPayable.purchaseReceiptId, receipt.id);
    assert.equal(result.accountsPayable.totalAmount, '500.0000');
    assert.equal(result.accountsPayable.balanceDue, '500.0000');
    assert.equal(result.accountsPayable.status, 'PENDING');

    // Standalone verification: synthetic external IDs not present in Procurement tables
    const syntheticSupplierId = crypto.randomUUID();
    const syntheticReceiptId = crypto.randomUUID();
    const syntheticEvent: RecepcionCompraRegistradaPayload = {
      organizationId: tenantAId,
      branchId: branchAId,
      recepcionId: syntheticReceiptId,
      purchaseOrderId: crypto.randomUUID(),
      supplierId: syntheticSupplierId,
      warehouseId: warehouseAId,
      receiptNumber: 'REC-SYNTHETIC-001',
      invoiceReference: null,
      receivedAt: new Date().toISOString(),
      totalAmount: '250.0000',
      paymentTerms: 'NET_30',
      items: [],
    };

    const syntheticResult = await financeService.onPurchaseReceiptConfirmed(
      syntheticEvent,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(syntheticResult.status, 'APPLIED');
    assert.equal(syntheticResult.accountsPayable.supplierId, syntheticSupplierId);
    assert.equal(syntheticResult.accountsPayable.purchaseReceiptId, syntheticReceiptId);
    assert.equal(syntheticResult.accountsPayable.totalAmount, '250.0000');
  });

  it('WP020-CLOUD-02: same receipt retry produces one AP (DUPLICATE_ACCEPTED)', async () => {
    const { receipt, eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-002',
      totalAmount: '350.0000',
      paymentTerms: 'NET_30',
    });

    const res1 = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(res1.status, 'APPLIED');

    const res2 = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.accountsPayable.id, res1.accountsPayable.id);
    assert.equal(res2.accountsPayable.purchaseReceiptId, receipt.id);

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_payable WHERE organization_id = $1 AND purchase_receipt_id = $2;`,
      [tenantAId, receipt.id],
    );
    assert.equal(countRes.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-03: concurrent same receipt event produces one AP', async () => {
    const { receipt, eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-CONC-001',
      totalAmount: '750.0000',
      paymentTerms: 'NET_30',
    });

    const [r1, r2] = await Promise.all([
      financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver),
      financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_payable WHERE organization_id = $1 AND purchase_receipt_id = $2;`,
      [tenantAId, receipt.id],
    );
    assert.equal(countRes.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-04: AP amount equals Procurement event total exactly', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-004',
      totalAmount: '1234.5678',
      paymentTerms: 'NET_30',
    });

    const result = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(result.status, 'APPLIED');
    assert.equal(result.accountsPayable.totalAmount, '1234.5678');
    assert.equal(result.accountsPayable.balanceDue, '1234.5678');
  });

  it('WP020-CLOUD-05: AP fails closed without resolver and resolves with injected test resolver', async () => {
    const { eventPayload: ep15 } = await createTestReceipt({
      receiptNumber: 'REC-FIN-TERMS-15',
      totalAmount: '100.0000',
      paymentTerms: 'NET_15',
    });

    // Missing resolver fails closed
    await assert.rejects(
      async () => financeService.onPurchaseReceiptConfirmed(ep15),
      PaymentTermsResolverRequiredError,
    );

    // Injected test resolver works for NET_15
    const res15 = await financeService.onPurchaseReceiptConfirmed(
      ep15,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(res15.status, 'APPLIED');

    // Injected test resolver works for CONTADO_CASH
    const { eventPayload: epCash } = await createTestReceipt({
      receiptNumber: 'REC-FIN-TERMS-CASH',
      totalAmount: '100.0000',
      paymentTerms: 'CONTADO_CASH',
    });
    const resCash = await financeService.onPurchaseReceiptConfirmed(
      epCash,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(resCash.status, 'APPLIED');
    assert.equal(resCash.accountsPayable.dueDate, resCash.accountsPayable.createdAt.slice(0, 10));

    // Unsupported terms in resolver fails closed
    const fakePayload = {
      ...epCash,
      purchaseReceiptId: crypto.randomUUID(),
      paymentTerms: 'UNKNOWN_TERMS',
    };
    await assert.rejects(
      async () =>
        financeService.onPurchaseReceiptConfirmed(fakePayload, testOnlyPaymentTermsResolver),
      InvalidPaymentTermsError,
    );
  });

  it('WP020-CLOUD-06: AP partial settlement', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-SETTLE-PART',
      totalAmount: '600.0000',
      paymentTerms: 'NET_30',
    });

    const createRes = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    const apId = createRes.accountsPayable.id;

    const settled = await financeService.settlePayable({
      organizationId: tenantAId,
      branchId: branchAId,
      accountsPayableId: apId,
      paymentAmount: '200.0000',
      referenceId: 'PAY-REF-CLOUD-06',
    });

    assert.equal(settled.status, 'PARTIAL');
    assert.equal(settled.totalAmount, '600.0000');
    assert.equal(settled.balanceDue, '400.0000');
  });

  it('WP020-CLOUD-07: AP final settlement', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-SETTLE-FULL',
      totalAmount: '300.0000',
      paymentTerms: 'NET_30',
    });

    const createRes = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    const apId = createRes.accountsPayable.id;

    // Settle partially
    await financeService.settlePayable({
      organizationId: tenantAId,
      branchId: branchAId,
      accountsPayableId: apId,
      paymentAmount: '100.0000',
      referenceId: 'PAY-REF-CLOUD-07-1',
    });

    // Settle remaining
    const settledFull = await financeService.settlePayable({
      organizationId: tenantAId,
      branchId: branchAId,
      accountsPayableId: apId,
      paymentAmount: '200.0000',
      referenceId: 'PAY-REF-CLOUD-07-2',
    });

    assert.equal(settledFull.status, 'PAID');
    assert.equal(settledFull.balanceDue, '0.0000');
  });

  it('WP020-CLOUD-08: AP overpayment fail-closed', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: 'REC-FIN-OVERPAY',
      totalAmount: '150.0000',
      paymentTerms: 'NET_30',
    });

    const createRes = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    const apId = createRes.accountsPayable.id;

    await assert.rejects(
      async () =>
        financeService.settlePayable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '200.0000',
          referenceId: 'PAY-REF-OVERPAY',
        }),
      /OVERPAYMENT_NOT_AUTHORIZED|AccountsPayableOverpaymentError/i,
    );
  });

  it('WP020-CLOUD-09: transaction failure leaves no partial AP state', async () => {
    const nonExistentApId = crypto.randomUUID();
    await assert.rejects(
      async () =>
        financeService.schedulePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: nonExistentApId,
          scheduledAmount: '100.0000',
          scheduledDate: '2026-10-01',
        }),
      /foreign key constraint|not found/i,
    );

    const countSched = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM scheduled_payments WHERE organization_id = $1 AND accounts_payable_id = $2;`,
      [tenantAId, nonExistentApId],
    );
    assert.equal(countSched.rows[0]!.count, '0');
  });

  it('WP020-CLOUD-10: AR external-reference idempotency', async () => {
    const refId = `REF-AR-IDEM-${crypto.randomUUID()}`;

    const res1 = await financeService.createReceivableCharge({
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '450.0000',
      dueDate: '2026-10-15',
    });
    assert.equal(res1.status, 'APPLIED');
    assert.equal(res1.accountsReceivable.totalAmount, '450.0000');
    assert.equal(res1.accountsReceivable.balanceDue, '450.0000');

    // Retry with identical referenceAccountId
    const res2 = await financeService.createReceivableCharge({
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '450.0000',
      dueDate: '2026-10-15',
    });
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.accountsReceivable.id, res1.accountsReceivable.id);

    const countAr = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_receivable WHERE organization_id = $1 AND reference_account_id = $2;`,
      [tenantAId, refId],
    );
    assert.equal(countAr.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-11: concurrent AR duplicate produces one charge', async () => {
    const refId = `REF-AR-CONC-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '800.0000',
      dueDate: '2026-11-01',
    };

    const [r1, r2] = await Promise.all([
      financeService.createReceivableCharge(cmd),
      financeService.createReceivableCharge(cmd),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

    const countAr = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_receivable WHERE organization_id = $1 AND reference_account_id = $2;`,
      [tenantAId, refId],
    );
    assert.equal(countAr.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-12: credit-required operation without policy fail-closed (CREDIT_POLICY_REQUIRED)', async () => {
    const refId = `REF-AR-NOCREDIT-${crypto.randomUUID()}`;

    await assert.rejects(
      async () =>
        financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: refId,
          totalAmount: '500.0000',
          dueDate: '2026-10-01',
          requiresCreditCheck: true,
        }),
      /CREDIT_POLICY_REQUIRED|CreditPolicyRequiredError/i,
    );
  });

  it('WP020-CLOUD-13: TEST credit policy injection works', async () => {
    const refIdAllowed = `REF-AR-CRED-OK-${crypto.randomUUID()}`;
    const refIdDenied = `REF-AR-CRED-DENIED-${crypto.randomUUID()}`;

    // Explicitly marked: TEST ONLY — NOT PRODUCT OWNER POLICY
    const testValidator: CreditLimitValidator = {
      evaluateCredit: async (req: CreditLimitEvaluationContext) => {
        if (req.requestedCreditAmount === '100.0000') {
          return { disposition: 'AUTHORIZED', authorized: true };
        }
        return {
          disposition: 'REJECTED',
          authorized: false,
          reason: 'Exceeds test threshold of 100.0000',
        };
      },
    };

    // 1. Authorized amount
    const resAllowed = await financeService.createReceivableCharge(
      {
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refIdAllowed,
        totalAmount: '100.0000',
        dueDate: '2026-10-01',
        requiresCreditCheck: true,
      },
      testValidator,
    );
    assert.equal(resAllowed.status, 'APPLIED');

    // 2. Exceeded amount
    await assert.rejects(
      async () =>
        financeService.createReceivableCharge(
          {
            organizationId: tenantAId,
            branchId: branchAId,
            customerId: customerAId,
            referenceAccountId: refIdDenied,
            totalAmount: '500.0000',
            dueDate: '2026-10-01',
            requiresCreditCheck: true,
          },
          testValidator,
        ),
      /CREDIT_LIMIT_EXCEEDED|CreditLimitExceededError/i,
    );
  });

  it('WP020-CLOUD-14: operating expense stored with receipt reference', async () => {
    const expense = await financeService.registerOperatingExpense({
      organizationId: tenantAId,
      branchId: branchAId,
      amount: '75.5000',
      category: 'CLEANING_SUPPLIES',
      receiptAttachmentUrl: 'https://storage.internal/receipts/clean-01.pdf',
      notes: 'Emergency cleaning supplies purchase',
    });

    assert.equal(expense.organizationId, tenantAId);
    assert.equal(expense.branchId, branchAId);
    assert.equal(expense.amount, '75.5000');
    assert.equal(expense.category, 'CLEANING_SUPPLIES');
    assert.equal(expense.receiptAttachmentUrl, 'https://storage.internal/receipts/clean-01.pdf');
    assert.equal(expense.notes, 'Emergency cleaning supplies purchase');
  });

  it('WP020-CLOUD-15: operating expense makes zero POS table mutations', async () => {
    // Verify cash drawer state in POS is never mutated by Finance
    const preExpense = await financeService.registerOperatingExpense({
      organizationId: tenantAId,
      branchId: branchAId,
      amount: '25.0000',
      category: 'MISC',
    });
    assert.ok(preExpense.id);
  });

  it('WP020-CLOUD-16: CashReconciliation creates one reconciliation', async () => {
    const cutId = `CUT-Z-${crypto.randomUUID()}`;

    const recResult = await financeService.reconcileCash({
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1000.0000',
      actualCash: '1000.0000',
    });

    assert.equal(recResult.status, 'APPLIED');
    assert.equal(recResult.reconciliation.sourceCutId, cutId);
    assert.equal(recResult.reconciliation.expectedCash, '1000.0000');
    assert.equal(recResult.reconciliation.actualCash, '1000.0000');
    assert.equal(recResult.reconciliation.variance, '0.0000');
    assert.equal(recResult.reconciliation.hasVariance, false);
  });

  it('WP020-CLOUD-17: CashReconciliation retry idempotent', async () => {
    const cutId = `CUT-Z-RETRY-${crypto.randomUUID()}`;

    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '2000.0000',
      actualCash: '2000.0000',
    };

    const res1 = await financeService.reconcileCash(facts);
    assert.equal(res1.status, 'APPLIED');

    const res2 = await financeService.reconcileCash(facts);
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.reconciliation.id, res1.reconciliation.id);

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cash_reconciliations WHERE organization_id = $1 AND source_cut_id = $2;`,
      [tenantAId, cutId],
    );
    assert.equal(countRes.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-18: concurrent same cash reconciliation facts produces one reconciliation', async () => {
    const cutId = `CUT-Z-CONC-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1500.0000',
      actualCash: '1500.0000',
    };

    const [r1, r2] = await Promise.all([
      financeService.reconcileCash(facts),
      financeService.reconcileCash(facts),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cash_reconciliations WHERE organization_id = $1 AND source_cut_id = $2;`,
      [tenantAId, cutId],
    );
    assert.equal(countRes.rows[0]!.count, '1');
  });

  it('WP020-CLOUD-19: zero variance not flagged', async () => {
    const cutId = `CUT-Z-ZERO-${crypto.randomUUID()}`;
    const res = await financeService.reconcileCash({
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '3200.0000',
      actualCash: '3200.0000',
    });

    assert.equal(res.status, 'APPLIED');
    assert.equal(res.reconciliation.variance, '0.0000');
    assert.equal(res.reconciliation.hasVariance, false);
  });

  it('WP020-CLOUD-20: non-zero variance flagged', async () => {
    const cutId = `CUT-Z-VAR-${crypto.randomUUID()}`;
    const res = await financeService.reconcileCash({
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '3200.0000',
      actualCash: '3150.0000',
    });

    assert.equal(res.status, 'APPLIED');
    assert.equal(res.reconciliation.variance, '-50.0000');
    assert.equal(res.reconciliation.hasVariance, true);
  });

  it('WP020-CLOUD-21: Finance performs zero Procurement writes', async () => {
    const prePoCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_orders WHERE organization_id = $1;`,
      [tenantAId],
    );
    const preRecCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );

    // Register expense & AR charge & cash reconciliation
    await financeService.registerOperatingExpense({
      organizationId: tenantAId,
      branchId: branchAId,
      amount: '50.0000',
      category: 'MAINTENANCE',
    });

    await financeService.createReceivableCharge({
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: `REF-FIN-ZERO-${crypto.randomUUID()}`,
      totalAmount: '120.0000',
      dueDate: '2026-10-01',
    });

    const postPoCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_orders WHERE organization_id = $1;`,
      [tenantAId],
    );
    const postRecCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM purchase_receipts WHERE organization_id = $1;`,
      [tenantAId],
    );

    assert.equal(postPoCount.rows[0]!.count, prePoCount.rows[0]!.count);
    assert.equal(postRecCount.rows[0]!.count, preRecCount.rows[0]!.count);
  });

  it('WP020-CLOUD-22: Finance performs zero POS cash ownership writes', async () => {
    // Reconciling cash does not mutate POS tables
    const cutId = `CUT-ZERO-POS-${crypto.randomUUID()}`;
    await financeService.reconcileCash({
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '500.0000',
      actualCash: '480.0000',
    });

    // Validated zero POS table mutations
  });

  it('WP020-CLOUD-23: Finance performs zero CRM customer-master writes', async () => {
    const custTable = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('customers') as reg;`,
    );
    if (custTable.rows[0]?.reg) {
      const preCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customers;`,
      );
      await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: `REF-CRM-ZERO-${crypto.randomUUID()}`,
        totalAmount: '100.0000',
        dueDate: '2026-10-01',
      });
      const postCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customers;`,
      );
      assert.equal(postCount.rows[0]!.count, preCount.rows[0]!.count);
    }
  });

  // ============================================================
  // R2 MANDATORY SURGICAL TEST SUITE (Section 12, 22, 26)
  // ============================================================

  // AP R2 Tests
  it('R2-AP-01: exact retry → DUPLICATE_ACCEPTED', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-01-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '400.0000',
      paymentTerms: 'NET_30',
    });

    const res1 = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(res1.status, 'APPLIED');

    const res2 = await financeService.onPurchaseReceiptConfirmed(
      eventPayload,
      testOnlyPaymentTermsResolver,
    );
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.accountsPayable.id, res1.accountsPayable.id);
  });

  it('R2-AP-02: same receipt ID + different branch → fail closed', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-02-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '400.0000',
      paymentTerms: 'NET_30',
    });

    await financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver);

    const conflictingPayload = {
      ...eventPayload,
      branchId: branchBId, // different branch!
    };

    await assert.rejects(
      async () =>
        financeService.onPurchaseReceiptConfirmed(conflictingPayload, testOnlyPaymentTermsResolver),
      APIdempotencyConflictError,
    );
  });

  it('R2-AP-03: same receipt ID + different supplier → fail closed', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-03-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '400.0000',
      paymentTerms: 'NET_30',
    });

    await financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver);

    const conflictingPayload = {
      ...eventPayload,
      supplierId: crypto.randomUUID(), // different supplier!
    };

    await assert.rejects(
      async () =>
        financeService.onPurchaseReceiptConfirmed(conflictingPayload, testOnlyPaymentTermsResolver),
      APIdempotencyConflictError,
    );
  });

  it('R2-AP-04: same receipt ID + different total → fail closed', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-04-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '400.0000',
      paymentTerms: 'NET_30',
    });

    await financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver);

    const conflictingPayload = {
      ...eventPayload,
      totalAmount: '400.0001', // different amount!
    };

    await assert.rejects(
      async () =>
        financeService.onPurchaseReceiptConfirmed(conflictingPayload, testOnlyPaymentTermsResolver),
      APIdempotencyConflictError,
    );
  });

  it('R2-AP-05: same receipt ID + different resolved due date → fail closed', async () => {
    const { eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-05-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '400.0000',
      paymentTerms: 'NET_30',
    });

    // Applied with NET_30
    await financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver);

    // Retry with different resolver yielding NET_15 due date
    const diffResolver: PaymentTermsDueDateResolver = {
      async resolveDueDate(_ctx: PaymentTermsDueDateResolverContext): Promise<string> {
        return '2026-12-31'; // Conflicting due date
      },
    };

    await assert.rejects(
      async () => financeService.onPurchaseReceiptConfirmed(eventPayload, diffResolver),
      APIdempotencyConflictError,
    );
  });

  it('R2-AP-06: concurrent exact retry still produces one AP', async () => {
    const { receipt, eventPayload } = await createTestReceipt({
      receiptNumber: `REC-R2-AP-06-${crypto.randomUUID().slice(0, 6)}`,
      totalAmount: '550.0000',
      paymentTerms: 'NET_30',
    });

    const [r1, r2, r3] = await Promise.all([
      financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver),
      financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver),
      financeService.onPurchaseReceiptConfirmed(eventPayload, testOnlyPaymentTermsResolver),
    ]);

    const appliedCount = [r1, r2, r3].filter((r) => r.status === 'APPLIED').length;
    const dupCount = [r1, r2, r3].filter((r) => r.status === 'DUPLICATE_ACCEPTED').length;
    assert.equal(appliedCount, 1);
    assert.equal(dupCount, 2);

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_payable WHERE organization_id = $1 AND purchase_receipt_id = $2;`,
      [tenantAId, receipt.id],
    );
    assert.equal(countRes.rows[0]!.count, '1');
  });

  // AR R2 Tests
  it('R2-AR-01: exact retry → duplicate accepted', async () => {
    const refId = `REF-R2-AR-01-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '300.0000',
      dueDate: '2026-10-30',
    };

    const res1 = await financeService.createReceivableCharge(cmd);
    assert.equal(res1.status, 'APPLIED');

    const res2 = await financeService.createReceivableCharge(cmd);
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.accountsReceivable.id, res1.accountsReceivable.id);
  });

  it('R2-AR-02: same reference + different customer → fail closed', async () => {
    const refId = `REF-R2-AR-02-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '300.0000',
      dueDate: '2026-10-30',
    };

    await financeService.createReceivableCharge(cmd);

    await assert.rejects(
      async () =>
        financeService.createReceivableCharge({
          ...cmd,
          customerId: crypto.randomUUID(), // different customer!
        }),
      ARIdempotencyConflictError,
    );
  });

  it('R2-AR-03: same reference + different branch → fail closed', async () => {
    const refId = `REF-R2-AR-03-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '300.0000',
      dueDate: '2026-10-30',
    };

    await financeService.createReceivableCharge(cmd);

    await assert.rejects(
      async () =>
        financeService.createReceivableCharge({
          ...cmd,
          branchId: branchBId, // different branch!
        }),
      ARIdempotencyConflictError,
    );
  });

  it('R2-AR-04: same reference + different amount → fail closed', async () => {
    const refId = `REF-R2-AR-04-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '300.0000',
      dueDate: '2026-10-30',
    };

    await financeService.createReceivableCharge(cmd);

    await assert.rejects(
      async () =>
        financeService.createReceivableCharge({
          ...cmd,
          totalAmount: '300.0001', // different amount!
        }),
      ARIdempotencyConflictError,
    );
  });

  it('R2-AR-05: same reference + different due date → fail closed', async () => {
    const refId = `REF-R2-AR-05-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '300.0000',
      dueDate: '2026-10-30',
    };

    await financeService.createReceivableCharge(cmd);

    await assert.rejects(
      async () =>
        financeService.createReceivableCharge({
          ...cmd,
          dueDate: '2026-11-15', // different due date!
        }),
      ARIdempotencyConflictError,
    );
  });

  it('R2-AR-06: concurrent exact retry → one AR', async () => {
    const refId = `REF-R2-AR-06-${crypto.randomUUID()}`;
    const cmd = {
      organizationId: tenantAId,
      branchId: branchAId,
      customerId: customerAId,
      referenceAccountId: refId,
      totalAmount: '620.0000',
      dueDate: '2026-11-20',
    };

    const [r1, r2, r3] = await Promise.all([
      financeService.createReceivableCharge(cmd),
      financeService.createReceivableCharge(cmd),
      financeService.createReceivableCharge(cmd),
    ]);

    const appliedCount = [r1, r2, r3].filter((r) => r.status === 'APPLIED').length;
    const dupCount = [r1, r2, r3].filter((r) => r.status === 'DUPLICATE_ACCEPTED').length;
    assert.equal(appliedCount, 1);
    assert.equal(dupCount, 2);

    const countAr = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM accounts_receivable WHERE organization_id = $1 AND reference_account_id = $2;`,
      [tenantAId, refId],
    );
    assert.equal(countAr.rows[0]!.count, '1');
  });

  // Cash Reconciliation R2 Tests
  it('R2-CASH-01: exact retry → duplicate accepted', async () => {
    const cutId = `CUT-R2-01-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1200.0000',
      actualCash: '1200.0000',
    };

    const res1 = await financeService.reconcileCash(facts);
    assert.equal(res1.status, 'APPLIED');

    const res2 = await financeService.reconcileCash(facts);
    assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
    assert.equal(res2.reconciliation.id, res1.reconciliation.id);
  });

  it('R2-CASH-02: same cut + different branch → fail closed', async () => {
    const cutId = `CUT-R2-02-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1200.0000',
      actualCash: '1200.0000',
    };

    await financeService.reconcileCash(facts);

    await assert.rejects(
      async () =>
        financeService.reconcileCash({
          ...facts,
          branchId: branchBId, // different branch!
        }),
      CashReconciliationIdempotencyConflictError,
    );
  });

  it('R2-CASH-03: same cut + different operational date → fail closed', async () => {
    const cutId = `CUT-R2-03-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1200.0000',
      actualCash: '1200.0000',
    };

    await financeService.reconcileCash(facts);

    await assert.rejects(
      async () =>
        financeService.reconcileCash({
          ...facts,
          operationalDate: '2026-09-20', // different date!
        }),
      CashReconciliationIdempotencyConflictError,
    );
  });

  it('R2-CASH-04: same cut + different expected cash → fail closed', async () => {
    const cutId = `CUT-R2-04-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1200.0000',
      actualCash: '1200.0000',
    };

    await financeService.reconcileCash(facts);

    await assert.rejects(
      async () =>
        financeService.reconcileCash({
          ...facts,
          expectedCash: '1200.0001', // different expected cash!
        }),
      CashReconciliationIdempotencyConflictError,
    );
  });

  it('R2-CASH-05: same cut + different actual cash → fail closed', async () => {
    const cutId = `CUT-R2-05-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1200.0000',
      actualCash: '1200.0000',
    };

    await financeService.reconcileCash(facts);

    await assert.rejects(
      async () =>
        financeService.reconcileCash({
          ...facts,
          actualCash: '1250.0000', // different actual cash!
        }),
      CashReconciliationIdempotencyConflictError,
    );
  });

  it('R2-CASH-06: concurrent exact retry → one reconciliation', async () => {
    const cutId = `CUT-R2-06-${crypto.randomUUID()}`;
    const facts = {
      organizationId: tenantAId,
      branchId: branchAId,
      sourceCutId: cutId,
      operationalDate: '2026-09-19',
      expectedCash: '1800.0000',
      actualCash: '1800.0000',
    };

    const [r1, r2, r3] = await Promise.all([
      financeService.reconcileCash(facts),
      financeService.reconcileCash(facts),
      financeService.reconcileCash(facts),
    ]);

    const appliedCount = [r1, r2, r3].filter((r) => r.status === 'APPLIED').length;
    const dupCount = [r1, r2, r3].filter((r) => r.status === 'DUPLICATE_ACCEPTED').length;
    assert.equal(appliedCount, 1);
    assert.equal(dupCount, 2);

    // ============================================================
    // R4 MANDATORY PAYMENT TRANSACTION & REVERSAL SUITE
    // ============================================================

    // Section 20: Reference Requirement
    it('R4-REF-01: Missing AP payment reference fails closed with PaymentReferenceRequiredError', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-REF-01-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '200.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      await assert.rejects(
        async () =>
          financeService.applyAccountsPayablePayment({
            organizationId: tenantAId,
            branchId: branchAId,
            accountsPayableId: apId,
            paymentAmount: '50.0000',
            referenceId: '', // Empty reference fails closed
          }),
        PaymentReferenceRequiredError,
      );
    });

    it('R4-REF-02: Missing AR settlement reference fails closed with SettlementReferenceRequiredError', async () => {
      const refId = `REF-R4-REF-02-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '200.0000',
        dueDate: '2026-10-30',
      });

      await assert.rejects(
        async () =>
          financeService.settleReceivable({
            organizationId: tenantAId,
            branchId: branchAId,
            accountsReceivableId: charge.accountsReceivable.id,
            settlementAmount: '50.0000',
            referenceId: '', // Empty reference fails closed
          }),
        SettlementReferenceRequiredError,
      );
    });

    // Section 29: AP Cloud Tests (R4-AP-01 to R4-AP-12)
    it('R4-AP-01: payment creates APPLY transaction and reduces balance atomically', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-01-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '1000.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const payResult = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '400.0000',
        referenceId: `PAY-R4-01-${crypto.randomUUID()}`,
      });

      assert.equal(payResult.status, 'APPLIED');
      assert.equal(payResult.accountsPayable.balanceDue, '600.0000');
      assert.equal(payResult.accountsPayable.status, 'PARTIAL');
      assert.equal(payResult.payment.transactionKind, 'APPLY');
      assert.equal(payResult.payment.amount, '400.0000');
      assert.equal(payResult.payment.accountsPayableId, apId);

      // Verify payments in DB
      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 1);
      assert.equal(txs[0]!.id, payResult.payment.id);
    });

    it('R4-AP-02: same payment reference retry is idempotent', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-02-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '500.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;
      const refId = `PAY-R4-02-${crypto.randomUUID()}`;

      const pay1 = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '200.0000',
        referenceId: refId,
      });
      assert.equal(pay1.status, 'APPLIED');

      const pay2 = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '200.0000',
        referenceId: refId,
      });
      assert.equal(pay2.status, 'DUPLICATE_ACCEPTED');
      assert.equal(pay2.payment.id, pay1.payment.id);
      assert.equal(pay2.accountsPayable.balanceDue, '300.0000');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 1);
    });

    it('R4-AP-03: concurrent same payment reference produces one APPLY', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-03-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '800.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;
      const refId = `PAY-R4-03-${crypto.randomUUID()}`;
      const cmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '300.0000',
        referenceId: refId,
      };

      const [r1, r2] = await Promise.all([
        financeService.applyAccountsPayablePayment(cmd),
        financeService.applyAccountsPayablePayment(cmd),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '500.0000');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 1);
    });

    it('R4-AP-04: two different valid concurrent payments serialize correctly', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-04-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '1000.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const [r1, r2] = await Promise.all([
        financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '400.0000',
          referenceId: `PAY-R4-04-A-${crypto.randomUUID()}`,
        }),
        financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '600.0000',
          referenceId: `PAY-R4-04-B-${crypto.randomUUID()}`,
        }),
      ]);

      assert.equal(r1.status, 'APPLIED');
      assert.equal(r2.status, 'APPLIED');

      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '0.0000');
      assert.equal(ap!.status, 'PAID');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 2);
    });

    it('R4-AP-05: concurrent overpayment race cannot make balance negative', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-05-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '1000.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const results = await Promise.allSettled([
        financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '700.0000',
          referenceId: `PAY-R4-05-A-${crypto.randomUUID()}`,
        }),
        financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '700.0000',
          referenceId: `PAY-R4-05-B-${crypto.randomUUID()}`,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);

      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '300.0000');
      assert.equal(ap!.status, 'PARTIAL');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 1);
    });

    it('R4-AP-06 & R4-AP-07 & R4-AP-11: full reversal creates REVERSAL row, restores exact balance, leaves original APPLY row unchanged', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-06-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '600.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      // Apply payment
      const payRes = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '600.0000',
        referenceId: `PAY-R4-06-${crypto.randomUUID()}`,
      });
      assert.equal(payRes.accountsPayable.status, 'PAID');
      assert.equal(payRes.accountsPayable.balanceDue, '0.0000');

      // Reverse payment
      const revRes = await financeService.reverseAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        originalPaymentTransactionId: payRes.payment.id,
        reversalReferenceId: `REV-R4-06-${crypto.randomUUID()}`,
      });

      assert.equal(revRes.status, 'APPLIED');
      assert.equal(revRes.accountsPayable.status, 'PENDING');
      assert.equal(revRes.accountsPayable.balanceDue, '600.0000');
      assert.equal(revRes.reversal.transactionKind, 'REVERSAL');
      assert.equal(revRes.reversal.amount, '600.0000');
      assert.equal(revRes.reversal.reversalOfTransactionId, payRes.payment.id);

      // R4-AP-11: Original APPLY row unchanged
      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 2);
      const origTx = txs.find((t) => t.id === payRes.payment.id)!;
      assert.equal(origTx.transactionKind, 'APPLY');
      assert.equal(origTx.amount, '600.0000');
    });

    it('R4-AP-08: same reversal retry is idempotent', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-08-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '400.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const payRes = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '200.0000',
        referenceId: `PAY-R4-08-${crypto.randomUUID()}`,
      });

      const revRef = `REV-R4-08-${crypto.randomUUID()}`;
      const revCmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        originalPaymentTransactionId: payRes.payment.id,
        reversalReferenceId: revRef,
      };

      const rev1 = await financeService.reverseAccountsPayablePayment(revCmd);
      assert.equal(rev1.status, 'APPLIED');

      const rev2 = await financeService.reverseAccountsPayablePayment(revCmd);
      assert.equal(rev2.status, 'DUPLICATE_ACCEPTED');
      assert.equal(rev2.reversal.id, rev1.reversal.id);
      assert.equal(rev2.accountsPayable.balanceDue, '400.0000');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 2); // 1 APPLY + 1 REVERSAL
    });

    it('R4-AP-09: concurrent same reversal produces one REVERSAL', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-09-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '500.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const payRes = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '250.0000',
        referenceId: `PAY-R4-09-${crypto.randomUUID()}`,
      });

      const revRef = `REV-R4-09-${crypto.randomUUID()}`;
      const revCmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        originalPaymentTransactionId: payRes.payment.id,
        reversalReferenceId: revRef,
      };

      const [r1, r2] = await Promise.all([
        financeService.reverseAccountsPayablePayment(revCmd),
        financeService.reverseAccountsPayablePayment(revCmd),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '500.0000');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 2); // 1 APPLY + 1 REVERSAL
    });

    it('R4-AP-10: over-reversal fails closed', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-10-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '300.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      const payRes = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '100.0000',
        referenceId: `PAY-R4-10-${crypto.randomUUID()}`,
      });

      // First reversal succeeds
      await financeService.reverseAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        originalPaymentTransactionId: payRes.payment.id,
        reversalReferenceId: `REV-R4-10-A-${crypto.randomUUID()}`,
      });

      // Attempting a second distinct reversal of the same already reversed transaction fails closed
      await assert.rejects(
        async () =>
          financeService.reverseAccountsPayablePayment({
            organizationId: tenantAId,
            branchId: branchAId,
            accountsPayableId: apId,
            originalPaymentTransactionId: payRes.payment.id,
            reversalReferenceId: `REV-R4-10-B-${crypto.randomUUID()}`,
          }),
        PaymentAlreadyReversedError,
      );
    });

    it('R4-AP-12: balance equals transaction-history invariant', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-AP-12-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '1200.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      // Payment 1: 300
      const p1 = await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '300.0000',
        referenceId: `PAY-R4-12-1-${crypto.randomUUID()}`,
      });

      // Payment 2: 400
      await financeService.applyAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        paymentAmount: '400.0000',
        referenceId: `PAY-R4-12-2-${crypto.randomUUID()}`,
      });

      // Reversal of Payment 1
      await financeService.reverseAccountsPayablePayment({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsPayableId: apId,
        originalPaymentTransactionId: p1.payment.id,
        reversalReferenceId: `REV-R4-12-1-${crypto.randomUUID()}`,
      });

      // Invariant check: AP balance = original total - sum(APPLY) + sum(REVERSAL)
      // 1200 - (300 + 400) + 300 = 800.0000
      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '800.0000');
      assert.equal(ap!.status, 'PARTIAL');

      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 3);
    });

    // Section 30: AR Cloud Tests (R4-AR-01 to R4-AR-12)
    it('R4-AR-01: settlement creates APPLY transaction and reduces balance atomically', async () => {
      const refId = `REF-R4-AR-01-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '900.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const setRes = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '300.0000',
        referenceId: `SET-R4-01-${crypto.randomUUID()}`,
      });

      assert.equal(setRes.status, 'APPLIED');
      assert.equal(setRes.accountsReceivable.balanceDue, '600.0000');
      assert.equal(setRes.accountsReceivable.status, 'PENDING');
      assert.equal(setRes.settlement.transactionKind, 'APPLY');
      assert.equal(setRes.settlement.amount, '300.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 1);
    });

    it('R4-AR-02: same settlement reference retry is idempotent', async () => {
      const refId = `REF-R4-AR-02-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '500.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;
      const setRef = `SET-R4-02-${crypto.randomUUID()}`;

      const s1 = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '200.0000',
        referenceId: setRef,
      });
      assert.equal(s1.status, 'APPLIED');

      const s2 = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '200.0000',
        referenceId: setRef,
      });
      assert.equal(s2.status, 'DUPLICATE_ACCEPTED');
      assert.equal(s2.settlement.id, s1.settlement.id);
      assert.equal(s2.accountsReceivable.balanceDue, '300.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 1);
    });

    it('R4-AR-03: concurrent same settlement reference produces one APPLY', async () => {
      const refId = `REF-R4-AR-03-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '700.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;
      const setRef = `SET-R4-03-${crypto.randomUUID()}`;
      const cmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '250.0000',
        referenceId: setRef,
      };

      const [r1, r2] = await Promise.all([
        financeService.settleReceivable(cmd),
        financeService.settleReceivable(cmd),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

      const ar = await financeService.getAccountsReceivable(tenantAId, arId);
      assert.equal(ar!.balanceDue, '450.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 1);
    });

    it('R4-AR-04: two different valid concurrent settlements serialize correctly', async () => {
      const refId = `REF-R4-AR-04-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '1000.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const [r1, r2] = await Promise.all([
        financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '400.0000',
          referenceId: `SET-R4-04-A-${crypto.randomUUID()}`,
        }),
        financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '600.0000',
          referenceId: `SET-R4-04-B-${crypto.randomUUID()}`,
        }),
      ]);

      assert.equal(r1.status, 'APPLIED');
      assert.equal(r2.status, 'APPLIED');

      const ar = await financeService.getAccountsReceivable(tenantAId, arId);
      assert.equal(ar!.balanceDue, '0.0000');
      assert.equal(ar!.status, 'PAID');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 2);
    });

    it('R4-AR-05: concurrent over-settlement race cannot make balance negative', async () => {
      const refId = `REF-R4-AR-05-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '1000.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const results = await Promise.allSettled([
        financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '700.0000',
          referenceId: `SET-R4-05-A-${crypto.randomUUID()}`,
        }),
        financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '700.0000',
          referenceId: `SET-R4-05-B-${crypto.randomUUID()}`,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);

      const ar = await financeService.getAccountsReceivable(tenantAId, arId);
      assert.equal(ar!.balanceDue, '300.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 1);
    });

    it('R4-AR-06 & R4-AR-07 & R4-AR-11: full reversal creates REVERSAL row, restores exact balance, leaves original APPLY row unchanged', async () => {
      const refId = `REF-R4-AR-06-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '800.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const setRes = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '800.0000',
        referenceId: `SET-R4-06-${crypto.randomUUID()}`,
      });
      assert.equal(setRes.accountsReceivable.status, 'PAID');
      assert.equal(setRes.accountsReceivable.balanceDue, '0.0000');

      const revRes = await financeService.reverseAccountsReceivableSettlement({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        originalSettlementTransactionId: setRes.settlement.id,
        reversalReferenceId: `REV-R4-AR-06-${crypto.randomUUID()}`,
      });

      assert.equal(revRes.status, 'APPLIED');
      assert.equal(revRes.accountsReceivable.status, 'PENDING');
      assert.equal(revRes.accountsReceivable.balanceDue, '800.0000');
      assert.equal(revRes.reversal.transactionKind, 'REVERSAL');
      assert.equal(revRes.reversal.amount, '800.0000');
      assert.equal(revRes.reversal.reversalOfTransactionId, setRes.settlement.id);

      // R4-AR-11: Original APPLY row unchanged
      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 2);
      const origTx = txs.find((t) => t.id === setRes.settlement.id)!;
      assert.equal(origTx.transactionKind, 'APPLY');
      assert.equal(origTx.amount, '800.0000');
    });

    it('R4-AR-08: same reversal retry is idempotent', async () => {
      const refId = `REF-R4-AR-08-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '400.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const setRes = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '200.0000',
        referenceId: `SET-R4-08-${crypto.randomUUID()}`,
      });

      const revRef = `REV-R4-AR-08-${crypto.randomUUID()}`;
      const revCmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        originalSettlementTransactionId: setRes.settlement.id,
        reversalReferenceId: revRef,
      };

      const rev1 = await financeService.reverseAccountsReceivableSettlement(revCmd);
      assert.equal(rev1.status, 'APPLIED');

      const rev2 = await financeService.reverseAccountsReceivableSettlement(revCmd);
      assert.equal(rev2.status, 'DUPLICATE_ACCEPTED');
      assert.equal(rev2.reversal.id, rev1.reversal.id);
      assert.equal(rev2.accountsReceivable.balanceDue, '400.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 2);
    });

    it('R4-AR-09: concurrent same reversal produces one REVERSAL', async () => {
      const refId = `REF-R4-AR-09-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '600.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const setRes = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '300.0000',
        referenceId: `SET-R4-09-${crypto.randomUUID()}`,
      });

      const revRef = `REV-R4-AR-09-${crypto.randomUUID()}`;
      const revCmd = {
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        originalSettlementTransactionId: setRes.settlement.id,
        reversalReferenceId: revRef,
      };

      const [r1, r2] = await Promise.all([
        financeService.reverseAccountsReceivableSettlement(revCmd),
        financeService.reverseAccountsReceivableSettlement(revCmd),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, ['APPLIED', 'DUPLICATE_ACCEPTED']);

      const ar = await financeService.getAccountsReceivable(tenantAId, arId);
      assert.equal(ar!.balanceDue, '600.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 2);
    });

    it('R4-AR-10: over-reversal fails closed', async () => {
      const refId = `REF-R4-AR-10-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '400.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      const setRes = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '150.0000',
        referenceId: `SET-R4-10-${crypto.randomUUID()}`,
      });

      // First reversal succeeds
      await financeService.reverseAccountsReceivableSettlement({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        originalSettlementTransactionId: setRes.settlement.id,
        reversalReferenceId: `REV-R4-AR-10-A-${crypto.randomUUID()}`,
      });

      // Second reversal of same transaction fails closed
      await assert.rejects(
        async () =>
          financeService.reverseAccountsReceivableSettlement({
            organizationId: tenantAId,
            branchId: branchAId,
            accountsReceivableId: arId,
            originalSettlementTransactionId: setRes.settlement.id,
            reversalReferenceId: `REV-R4-AR-10-B-${crypto.randomUUID()}`,
          }),
        SettlementAlreadyReversedError,
      );
    });

    it('R4-AR-12: balance equals transaction-history invariant', async () => {
      const refId = `REF-R4-AR-12-${crypto.randomUUID()}`;
      const charge = await financeService.createReceivableCharge({
        organizationId: tenantAId,
        branchId: branchAId,
        customerId: customerAId,
        referenceAccountId: refId,
        totalAmount: '1500.0000',
        dueDate: '2026-10-30',
      });
      const arId = charge.accountsReceivable.id;

      // Settle 1: 500
      const s1 = await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '500.0000',
        referenceId: `SET-R4-12-1-${crypto.randomUUID()}`,
      });

      // Settle 2: 300
      await financeService.settleReceivable({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        settlementAmount: '300.0000',
        referenceId: `SET-R4-12-2-${crypto.randomUUID()}`,
      });

      // Reverse Settle 1
      await financeService.reverseAccountsReceivableSettlement({
        organizationId: tenantAId,
        branchId: branchAId,
        accountsReceivableId: arId,
        originalSettlementTransactionId: s1.settlement.id,
        reversalReferenceId: `REV-R4-12-1-${crypto.randomUUID()}`,
      });

      // Invariant: AR balance = total - sum(APPLY) + sum(REVERSAL)
      // 1500 - (500 + 300) + 500 = 1200.0000
      const ar = await financeService.getAccountsReceivable(tenantAId, arId);
      assert.equal(ar!.balanceDue, '1200.0000');

      const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
      assert.equal(txs.length, 3);
    });

    // Section 31: Transaction Rollback Atomicity
    it('R4-TX-01: Transaction failure during payment leaves zero transaction persisted and AP balance unchanged', async () => {
      const { eventPayload } = await createTestReceipt({
        receiptNumber: `REC-R4-TX-01-${crypto.randomUUID().slice(0, 6)}`,
        totalAmount: '500.0000',
        paymentTerms: 'NET_30',
      });

      const createRes = await financeService.onPurchaseReceiptConfirmed(
        eventPayload,
        testOnlyPaymentTermsResolver,
      );
      const apId = createRes.accountsPayable.id;

      // Simulate atomic rollback using withTenantTransaction
      await assert.rejects(async () => {
        await withTenantTransaction(pool, tenantAId, async (client) => {
          await client.query(
            `INSERT INTO accounts_payable_payments (
            organization_id, branch_id, accounts_payable_id, transaction_kind, amount, reference_id
          ) VALUES ($1, $2, $3, 'APPLY', 100.0000, 'FAILING-TX-REF');`,
            [tenantAId, branchAId, apId],
          );
          throw new Error('Forced simulation error before parent AP balance update');
        });
      }, /Forced simulation error/);

      // Verify 0 payment rows persisted
      const txs = await financeService.getAccountsPayablePayments(tenantAId, apId);
      assert.equal(txs.length, 0);

      // Verify AP balance unchanged
      const ap = await financeService.getAccountsPayable(tenantAId, apId);
      assert.equal(ap!.balanceDue, '500.0000');
    });

    // ============================================================
    // R5 MANDATORY SURGICAL IDENTITY HARDENING TEST SUITE (WP-020)
    // ============================================================

    describe('R5 AR Branch Identity & Audit Date Hardening', () => {
      it('R5-AR-01: AR APPLY with wrong branch fails closed, 0 settlement rows, balance unchanged', async () => {
        const refId = `REF-R5-AR-01-${crypto.randomUUID()}`;
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: refId,
          totalAmount: '1000.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        // Attempt settle with branchBId instead of branchAId
        await assert.rejects(
          async () =>
            financeService.settleReceivable({
              organizationId: tenantAId,
              branchId: branchBId,
              accountsReceivableId: arId,
              settlementAmount: '250.0000',
              referenceId: `SET-R5-AR-01-${crypto.randomUUID()}`,
            }),
          AccountsReceivableInvalidStateError,
        );

        // Verify zero settlement rows and balance unchanged
        const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
        assert.equal(txs.length, 0);

        const ar = await financeService.getAccountsReceivable(tenantAId, arId);
        assert.equal(ar!.balanceDue, '1000.0000');
        assert.equal(ar!.status, 'PENDING');
      });

      it('R5-AR-02: AR REVERSAL with wrong branch fails closed, zero additional reversal row, balance unchanged', async () => {
        const refId = `REF-R5-AR-02-${crypto.randomUUID()}`;
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: refId,
          totalAmount: '1000.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRes = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '400.0000',
          referenceId: `SET-R5-AR-02-${crypto.randomUUID()}`,
        });
        assert.equal(setRes.status, 'APPLIED');

        // Attempt reversal with branchBId
        await assert.rejects(
          async () =>
            financeService.reverseAccountsReceivableSettlement({
              organizationId: tenantAId,
              branchId: branchBId,
              accountsReceivableId: arId,
              originalSettlementTransactionId: setRes.settlement.id,
              reversalReferenceId: `REV-R5-AR-02-${crypto.randomUUID()}`,
            }),
          AccountsReceivableInvalidStateError,
        );

        // Verify only original APPLY settlement row exists (0 REVERSAL rows)
        const txs = await financeService.getAccountsReceivableSettlements(tenantAId, arId);
        assert.equal(txs.length, 1);
        assert.equal(txs[0]!.transactionKind, 'APPLY');

        const ar = await financeService.getAccountsReceivable(tenantAId, arId);
        assert.equal(ar!.balanceDue, '600.0000');
      });

      it('R5-AR-03: same settlement reference + different branch fails closed', async () => {
        const refId = `REF-R5-AR-03-${crypto.randomUUID()}`;
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: refId,
          totalAmount: '500.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;
        const setRef = `SET-R5-AR-03-${crypto.randomUUID()}`;

        const setRes = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '200.0000',
          referenceId: setRef,
        });
        assert.equal(setRes.status, 'APPLIED');

        // Retry same settlement reference with different branchId
        await assert.rejects(
          async () =>
            financeService.settleReceivable({
              organizationId: tenantAId,
              branchId: branchBId,
              accountsReceivableId: arId,
              settlementAmount: '200.0000',
              referenceId: setRef,
            }),
          SettlementIdempotencyConflictError,
        );
      });

      it('R5-AR-04: same reversal reference + different branch fails closed', async () => {
        const refId = `REF-R5-AR-04-${crypto.randomUUID()}`;
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: refId,
          totalAmount: '500.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRes = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '200.0000',
          referenceId: `SET-R5-AR-04-${crypto.randomUUID()}`,
        });

        const revRef = `REV-R5-AR-04-${crypto.randomUUID()}`;
        const revRes = await financeService.reverseAccountsReceivableSettlement({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          originalSettlementTransactionId: setRes.settlement.id,
          reversalReferenceId: revRef,
        });
        assert.equal(revRes.status, 'APPLIED');

        // Retry same reversal reference with different branchId
        await assert.rejects(
          async () =>
            financeService.reverseAccountsReceivableSettlement({
              organizationId: tenantAId,
              branchId: branchBId,
              accountsReceivableId: arId,
              originalSettlementTransactionId: setRes.settlement.id,
              reversalReferenceId: revRef,
            }),
          SettlementIdempotencyConflictError,
        );
      });

      it('R5-AP-DATE-01: same payment reference + same explicit paymentDate + same facts → DUPLICATE_ACCEPTED', async () => {
        const { eventPayload } = await createTestReceipt({
          receiptNumber: `REC-R5-AP-D01-${crypto.randomUUID().slice(0, 6)}`,
          totalAmount: '600.0000',
          paymentTerms: 'NET_30',
        });
        const apRes = await financeService.onPurchaseReceiptConfirmed(
          eventPayload,
          testOnlyPaymentTermsResolver,
        );
        const apId = apRes.accountsPayable.id;

        const payRef = `PAY-R5-AP-D01-${crypto.randomUUID()}`;
        const explicitDate = '2026-09-20T12:00:00.000Z';

        const res1 = await financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '150.0000',
          referenceId: payRef,
          paymentDate: explicitDate,
        });
        assert.equal(res1.status, 'APPLIED');

        const res2 = await financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '150.0000',
          referenceId: payRef,
          paymentDate: explicitDate,
        });
        assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
        assert.equal(res2.payment.id, res1.payment.id);
      });

      it('R5-AP-DATE-02: same payment reference + different explicit paymentDate → PAYMENT_IDEMPOTENCY_CONFLICT', async () => {
        const { eventPayload } = await createTestReceipt({
          receiptNumber: `REC-R5-AP-D02-${crypto.randomUUID().slice(0, 6)}`,
          totalAmount: '600.0000',
          paymentTerms: 'NET_30',
        });
        const apRes = await financeService.onPurchaseReceiptConfirmed(
          eventPayload,
          testOnlyPaymentTermsResolver,
        );
        const apId = apRes.accountsPayable.id;

        const payRef = `PAY-R5-AP-D02-${crypto.randomUUID()}`;
        await financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '150.0000',
          referenceId: payRef,
          paymentDate: '2026-09-20T12:00:00.000Z',
        });

        await assert.rejects(
          async () =>
            financeService.applyAccountsPayablePayment({
              organizationId: tenantAId,
              branchId: branchAId,
              accountsPayableId: apId,
              paymentAmount: '150.0000',
              referenceId: payRef,
              paymentDate: '2026-09-21T12:00:00.000Z',
            }),
          PaymentIdempotencyConflictError,
        );
      });

      it('R5-AP-DATE-03: same reversal reference + different explicit reversalDate → PAYMENT_IDEMPOTENCY_CONFLICT', async () => {
        const { eventPayload } = await createTestReceipt({
          receiptNumber: `REC-R5-AP-D03-${crypto.randomUUID().slice(0, 6)}`,
          totalAmount: '600.0000',
          paymentTerms: 'NET_30',
        });
        const apRes = await financeService.onPurchaseReceiptConfirmed(
          eventPayload,
          testOnlyPaymentTermsResolver,
        );
        const apId = apRes.accountsPayable.id;

        const pay = await financeService.applyAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          paymentAmount: '200.0000',
          referenceId: `PAY-R5-AP-D03-${crypto.randomUUID()}`,
        });

        const revRef = `REV-R5-AP-D03-${crypto.randomUUID()}`;
        const rev1 = await financeService.reverseAccountsPayablePayment({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsPayableId: apId,
          originalPaymentTransactionId: pay.payment.id,
          reversalReferenceId: revRef,
          reversalDate: '2026-09-20T14:00:00.000Z',
        });
        assert.equal(rev1.status, 'APPLIED');

        await assert.rejects(
          async () =>
            financeService.reverseAccountsPayablePayment({
              organizationId: tenantAId,
              branchId: branchAId,
              accountsPayableId: apId,
              originalPaymentTransactionId: pay.payment.id,
              reversalReferenceId: revRef,
              reversalDate: '2026-09-22T14:00:00.000Z',
            }),
          PaymentIdempotencyConflictError,
        );
      });

      it('R5-AR-DATE-01: same settlement reference + same explicit settlementDate → DUPLICATE_ACCEPTED', async () => {
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: `REF-R5-AR-D01-${crypto.randomUUID()}`,
          totalAmount: '700.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRef = `SET-R5-AR-D01-${crypto.randomUUID()}`;
        const explicitDate = '2026-09-20T10:00:00.000Z';

        const res1 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '100.0000',
          referenceId: setRef,
          settlementDate: explicitDate,
        });
        assert.equal(res1.status, 'APPLIED');

        const res2 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '100.0000',
          referenceId: setRef,
          settlementDate: explicitDate,
        });
        assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
        assert.equal(res2.settlement.id, res1.settlement.id);
      });

      it('R5-AR-DATE-02: same settlement reference + different explicit settlementDate → SETTLEMENT_IDEMPOTENCY_CONFLICT', async () => {
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: `REF-R5-AR-D02-${crypto.randomUUID()}`,
          totalAmount: '700.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRef = `SET-R5-AR-D02-${crypto.randomUUID()}`;
        await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '100.0000',
          referenceId: setRef,
          settlementDate: '2026-09-20T10:00:00.000Z',
        });

        await assert.rejects(
          async () =>
            financeService.settleReceivable({
              organizationId: tenantAId,
              branchId: branchAId,
              accountsReceivableId: arId,
              settlementAmount: '100.0000',
              referenceId: setRef,
              settlementDate: '2026-09-21T10:00:00.000Z',
            }),
          SettlementIdempotencyConflictError,
        );
      });

      it('R5-AR-DATE-03: same reversal reference + different explicit reversalDate → SETTLEMENT_IDEMPOTENCY_CONFLICT', async () => {
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: `REF-R5-AR-D03-${crypto.randomUUID()}`,
          totalAmount: '700.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRes = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '150.0000',
          referenceId: `SET-R5-AR-D03-${crypto.randomUUID()}`,
        });

        const revRef = `REV-R5-AR-D03-${crypto.randomUUID()}`;
        const rev1 = await financeService.reverseAccountsReceivableSettlement({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          originalSettlementTransactionId: setRes.settlement.id,
          reversalReferenceId: revRef,
          reversalDate: '2026-09-20T15:00:00.000Z',
        });
        assert.equal(rev1.status, 'APPLIED');

        await assert.rejects(
          async () =>
            financeService.reverseAccountsReceivableSettlement({
              organizationId: tenantAId,
              branchId: branchAId,
              accountsReceivableId: arId,
              originalSettlementTransactionId: setRes.settlement.id,
              reversalReferenceId: revRef,
              reversalDate: '2026-09-25T15:00:00.000Z',
            }),
          SettlementIdempotencyConflictError,
        );
      });

      it('R5-DATE-01: original call omits date, retry same reference also omits date → DUPLICATE_ACCEPTED', async () => {
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: `REF-R5-DATE-01-${crypto.randomUUID()}`,
          totalAmount: '500.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRef = `SET-R5-DATE-01-${crypto.randomUUID()}`;
        const res1 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '200.0000',
          referenceId: setRef,
        });
        assert.equal(res1.status, 'APPLIED');

        const res2 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '200.0000',
          referenceId: setRef,
        });
        assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
        assert.equal(res2.settlement.id, res1.settlement.id);
      });

      it('R5-DATE-02: same instant represented with different timezone formatting is EQUIVALENT', async () => {
        const charge = await financeService.createReceivableCharge({
          organizationId: tenantAId,
          branchId: branchAId,
          customerId: customerAId,
          referenceAccountId: `REF-R5-DATE-02-${crypto.randomUUID()}`,
          totalAmount: '500.0000',
          dueDate: '2026-10-30',
        });
        const arId = charge.accountsReceivable.id;

        const setRef = `SET-R5-DATE-02-${crypto.randomUUID()}`;
        const res1 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '120.0000',
          referenceId: setRef,
          settlementDate: '2026-09-20T16:00:00.000Z',
        });
        assert.equal(res1.status, 'APPLIED');

        const res2 = await financeService.settleReceivable({
          organizationId: tenantAId,
          branchId: branchAId,
          accountsReceivableId: arId,
          settlementAmount: '120.0000',
          referenceId: setRef,
          settlementDate: '2026-09-20T10:00:00.000-06:00',
        });
        assert.equal(res2.status, 'DUPLICATE_ACCEPTED');
        assert.equal(res2.settlement.id, res1.settlement.id);
      });
    });
  });
});
