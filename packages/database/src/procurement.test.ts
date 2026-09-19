import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { getPool } from './connection.js';
import { migrateUp, migrateDown } from './runner.js';
import { setTenantContext } from './tenant.js';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

describe('TRIDENTPOS WP-019 Procurement & Supplier Receiving Database Suite', () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const warehouseAId = crypto.randomUUID();
  const warehouseBId = crypto.randomUUID();
  const ingredientAId = crypto.randomUUID();
  const ingredientBId = crypto.randomUUID();
  const testRole = 'trident_wp019_test_role';

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
    await client.query('BEGIN;');
    try {
      await client.query(sql, params);
      await client.query('COMMIT;');
      assert.fail('Expected query to fail but it succeeded');
    } catch (err: unknown) {
      await client.query('ROLLBACK;');
      assert(err instanceof Error);
      assert.match(err.message, pattern);
    }
  }

  before(async () => {
    // 1. Run migrations up to WP-019
    await migrateUp(pool);

    // 2. Setup unprivileged test role for RLS validation
    const setupClient = await pool.connect();
    try {
      await setupClient.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            CREATE ROLE ${testRole} WITH LOGIN;
          END IF;
        END $$;
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${testRole};
      `);

      // 3. Seed test tenants, branches, warehouses, ingredients
      await setupClient.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Tenant A Corp', 'Tenant A', 'RFC-A-019'),
          ('${tenantBId}', 'Tenant B Corp', 'Tenant B', 'RFC-B-019')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchAId}', '${tenantAId}', 'BR-A-019', 'Branch A'),
          ('${branchBId}', '${tenantBId}', 'BR-B-019', 'Branch B')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type)
        VALUES
          ('${warehouseAId}', '${tenantAId}', '${branchAId}', 'WH-A-019', 'Main WH A', 'PHYSICAL'),
          ('${warehouseBId}', '${tenantBId}', '${branchBId}', 'WH-B-019', 'Main WH B', 'PHYSICAL')
        ON CONFLICT (organization_id, id) DO NOTHING;

        INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost)
        VALUES
          ('${ingredientAId}', '${tenantAId}', 'ING-A-019', 'Flour A', 'KG', 10.0000),
          ('${ingredientBId}', '${tenantBId}', 'ING-B-019', 'Flour B', 'KG', 10.0000)
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      setupClient.release();
    }
  });

  after(async () => {
    const cleanClient = await pool.connect();
    try {
      await cleanClient.query(`
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

  it('WP019-DB-01: Exact five WP-019 physical tables exist', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('suppliers', 'purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items')
        ORDER BY tablename ASC;
      `);
      const tableNames = res.rows.map((r) => r.tablename);
      assert.deepEqual(tableNames, [
        'purchase_order_items',
        'purchase_orders',
        'purchase_receipt_items',
        'purchase_receipts',
        'suppliers',
      ]);
    } finally {
      client.release();
    }
  });

  it('WP019-DB-02: RLS and FORCE RLS are enabled on all five WP-019 physical tables', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('suppliers', 'purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items')
        ORDER BY relname ASC;
      `);
      assert.equal(res.rows.length, 5);
      for (const row of res.rows) {
        assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
        assert.equal(row.relforcerowsecurity, true, `FORCE RLS must be enabled on ${row.relname}`);
      }
    } finally {
      client.release();
    }
  });

  it('WP019-DB-03: Tenant default-deny returns 0 visible rows without tenant context', async () => {
    const supplierId = crypto.randomUUID();
    const poId = crypto.randomUUID();

    // Insert as admin/superuser
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO suppliers (id, organization_id, code, trade_name, tax_id)
        VALUES ('${supplierId}', '${tenantAId}', 'SUP-DEFAULT-DENY', 'Supplier DD', 'RFC-DD');

        INSERT INTO purchase_orders (id, organization_id, branch_id, supplier_id, order_number, status, total_amount)
        VALUES ('${poId}', '${tenantAId}', '${branchAId}', '${supplierId}', 'PO-DD', 'DRAFT', 100.0000);
      `);
    } finally {
      adminClient.release();
    }

    // Read as unprivileged test role without tenant context
    await asTestRole(async (client) => {
      const supRes = await client.query('SELECT * FROM suppliers;');
      assert.equal(supRes.rows.length, 0, 'No suppliers should be visible without tenant context');

      const poRes = await client.query('SELECT * FROM purchase_orders;');
      assert.equal(
        poRes.rows.length,
        0,
        'No purchase orders should be visible without tenant context',
      );
    });
  });

  it('WP019-DB-04: Tenant visibility separation between Tenant A and Tenant B', async () => {
    const supplierAId = crypto.randomUUID();
    const supplierBId = crypto.randomUUID();
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO suppliers (id, organization_id, code, trade_name, tax_id)
        VALUES
          ('${supplierAId}', '${tenantAId}', 'SUP-VIS-A', 'Supplier Vis A', 'RFC-VIS-A'),
          ('${supplierBId}', '${tenantBId}', 'SUP-VIS-B', 'Supplier Vis B', 'RFC-VIS-B');
      `);
    } finally {
      adminClient.release();
    }

    // Set Tenant A context -> only see Tenant A
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const resA = await client.query<{ code: string }>(
        'SELECT code FROM suppliers WHERE code IN ($1, $2);',
        ['SUP-VIS-A', 'SUP-VIS-B'],
      );
      assert.equal(
        resA.rows.some((r) => r.code === 'SUP-VIS-A'),
        true,
      );
      assert.equal(
        resA.rows.some((r) => r.code === 'SUP-VIS-B'),
        false,
      );
      await client.query('COMMIT;');
    });

    // Set Tenant B context -> only see Tenant B
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const resB = await client.query<{ code: string }>(
        'SELECT code FROM suppliers WHERE code IN ($1, $2);',
        ['SUP-VIS-A', 'SUP-VIS-B'],
      );
      assert.equal(
        resB.rows.some((r) => r.code === 'SUP-VIS-A'),
        false,
      );
      assert.equal(
        resB.rows.some((r) => r.code === 'SUP-VIS-B'),
        true,
      );
      await client.query('COMMIT;');
    });
  });

  it('WP019-DB-05: Suppliers candidate key and commercial uniqueness', async () => {
    const client = await pool.connect();
    try {
      const code = `SUP-UNIQ-${crypto.randomBytes(3).toString('hex')}`;
      // Insert first supplier in Tenant A
      await client.query(
        `INSERT INTO suppliers (organization_id, code, trade_name, tax_id)
         VALUES ($1, $2, $3, $4);`,
        [tenantAId, code, 'First Supplier', 'RFC-1'],
      );

      // Duplicate code in same tenant must fail
      await assertQueryRejects(
        client,
        `INSERT INTO suppliers (organization_id, code, trade_name, tax_id)
         VALUES ($1, $2, $3, $4);`,
        [tenantAId, code, 'Duplicate Supplier', 'RFC-DUP'],
        /uq_suppliers_org_code|unique constraint/i,
      );

      // Same code in different tenant succeeds
      const diffOrgSupplierId = crypto.randomUUID();
      await client.query(
        `INSERT INTO suppliers (id, organization_id, code, trade_name, tax_id)
         VALUES ($1, $2, $3, $4, $5);`,
        [diffOrgSupplierId, tenantBId, code, 'Supplier in Tenant B', 'RFC-B'],
      );
    } finally {
      client.release();
    }
  });

  it('WP019-DB-06: Purchase orders check constraints and composite FKs', async () => {
    const client = await pool.connect();
    try {
      // Check invalid status
      await assertQueryRejects(
        client,
        `INSERT INTO purchase_orders (organization_id, branch_id, supplier_id, order_number, status)
         VALUES ($1, $2, $3, $4, $5);`,
        [tenantAId, branchAId, crypto.randomUUID(), 'PO-INV-STATUS', 'INVALID_STATUS'],
        /chk_purchase_orders_status|check constraint/i,
      );

      // Check negative total amount
      await assertQueryRejects(
        client,
        `INSERT INTO purchase_orders (organization_id, branch_id, supplier_id, order_number, status, total_amount)
         VALUES ($1, $2, (SELECT id FROM suppliers WHERE organization_id = $1 LIMIT 1), $3, 'DRAFT', -50.0000);`,
        [tenantAId, branchAId, 'PO-NEG-TOTAL'],
        /chk_purchase_orders_total_nonnegative|check constraint/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP019-DB-07: Purchase order items check constraints and composite FKs', async () => {
    const client = await pool.connect();
    try {
      const poRes = await client.query<{ id: string }>(
        'SELECT id FROM purchase_orders WHERE organization_id = $1 LIMIT 1;',
        [tenantAId],
      );
      const poId = poRes.rows[0]!.id;

      // Check zero or negative ordered quantity
      await assertQueryRejects(
        client,
        `INSERT INTO purchase_order_items (organization_id, purchase_order_id, ingredient_id, ordered_quantity, unit_cost, line_amount)
         VALUES ($1, $2, $3, 0.0000, 10.0000, 0.0000);`,
        [tenantAId, poId, ingredientAId],
        /chk_po_items_qty_positive|check constraint/i,
      );

      // Check negative unit cost
      await assertQueryRejects(
        client,
        `INSERT INTO purchase_order_items (organization_id, purchase_order_id, ingredient_id, ordered_quantity, unit_cost, line_amount)
         VALUES ($1, $2, $3, 5.0000, -2.0000, -10.0000);`,
        [tenantAId, poId, ingredientAId],
        /chk_po_items_cost_nonnegative|check constraint/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP019-DB-08: Cross-tenant relationship rejection', async () => {
    const client = await pool.connect();
    try {
      const supBRes = await client.query<{ id: string }>(
        'SELECT id FROM suppliers WHERE organization_id = $1 LIMIT 1;',
        [tenantBId],
      );
      const supplierBId = supBRes.rows[0]!.id;

      // Cannot create PO in Tenant A using Supplier from Tenant B
      await assertQueryRejects(
        client,
        `INSERT INTO purchase_orders (organization_id, branch_id, supplier_id, order_number, status, total_amount)
         VALUES ($1, $2, $3, 'PO-CROSS-1', 'DRAFT', 100.0000);`,
        [tenantAId, branchAId, supplierBId],
        /fk_purchase_orders_supplier|foreign key/i,
      );
    } finally {
      client.release();
    }
  });

  it('WP019-DOWN-01: Authorized non-production rollback of WP-019 removes WP-019 tables and preserves WP-018 / WP-017 / Platform Core / Outbox', async () => {
    // 1. Verify WP-019 tables exist before rollback
    const preCheckClient = await pool.connect();
    try {
      const res = await preCheckClient.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('suppliers', 'purchase_orders', 'stock_ledger', 'recipes', 'organizations', 'cloud_integration_outbox');
      `);
      const names = new Set(res.rows.map((r) => r.tablename));
      assert.ok(names.has('suppliers'), 'suppliers must exist before down');
      assert.ok(names.has('purchase_orders'), 'purchase_orders must exist before down');
      assert.ok(names.has('stock_ledger'), 'stock_ledger must exist before down');
      assert.ok(names.has('recipes'), 'recipes must exist before down');
      assert.ok(names.has('organizations'), 'organizations must exist before down');
      assert.ok(names.has('cloud_integration_outbox'), 'outbox must exist before down');
    } finally {
      preCheckClient.release();
    }

    try {
      // 2. Execute authorized non-production migrateDown for WP-019
      const revertResult = await migrateDown(pool, { allowDestructiveDown: true });
      assert.equal(
        revertResult.reverted,
        '20260905010000_procurement_supplier_receiving',
        'Should revert exactly WP-019 migration',
      );

      // 3. Verify WP-019 tables dropped, while predecessor tables survive
      const postCheckClient = await pool.connect();
      try {
        const res = await postCheckClient.query<{ tablename: string }>(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename IN ('suppliers', 'purchase_orders', 'stock_ledger', 'recipes', 'organizations', 'cloud_integration_outbox');
        `);
        const remaining = new Set(res.rows.map((r) => r.tablename));
        assert.equal(remaining.has('suppliers'), false, 'suppliers must be removed');
        assert.equal(remaining.has('purchase_orders'), false, 'purchase_orders must be removed');
        assert.equal(remaining.has('stock_ledger'), true, 'stock_ledger (WP-018) MUST survive');
        assert.equal(remaining.has('recipes'), true, 'recipes (WP-017) MUST survive');
        assert.equal(
          remaining.has('organizations'),
          true,
          'organizations (Platform Core) MUST survive',
        );
        assert.equal(
          remaining.has('cloud_integration_outbox'),
          true,
          'outbox (WP-012) MUST survive',
        );
      } finally {
        postCheckClient.release();
      }
    } finally {
      // Restore migration state
      await migrateUp(pool);
    }
  });
});
