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

describe('TRIDENTPOS WP-020 Finance & Cash Reconciliation Database Suite', () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const supplierAId = crypto.randomUUID();
  const supplierBId = crypto.randomUUID();
  const warehouseAId = crypto.randomUUID();
  const ingredientAId = crypto.randomUUID();
  const poAId = crypto.randomUUID();
  const poItemAId = crypto.randomUUID();
  const receiptAId = crypto.randomUUID();
  const receiptItemAId = crypto.randomUUID();

  const testRole = 'trident_wp020_test_role';

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
    // 1. Run migrations up to WP-020
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${testRole};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${testRole};
      `);

      // 3. Seed parent entities for test fixtures
      await setupClient.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id) VALUES
          ('${tenantAId}', 'Tenant A Corp', 'Tenant A', 'RFC-A-WP020'),
          ('${tenantBId}', 'Tenant B Corp', 'Tenant B', 'RFC-B-WP020')
         ON CONFLICT (id) DO NOTHING;

         INSERT INTO branches (id, organization_id, code, name) VALUES
          ('${branchAId}', '${tenantAId}', 'BR-A-WP020', 'Branch A Central'),
          ('${branchBId}', '${tenantBId}', 'BR-B-WP020', 'Branch B North')
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO suppliers (id, organization_id, code, trade_name, tax_id, credit_days) VALUES
          ('${supplierAId}', '${tenantAId}', 'SUP-WP020-A', 'Supplier A', 'RFC-SUP-A-01', 30),
          ('${supplierBId}', '${tenantBId}', 'SUP-WP020-B', 'Supplier B', 'RFC-SUP-B-01', 15)
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO warehouses (id, organization_id, branch_id, code, name, warehouse_type) VALUES
          ('${warehouseAId}', '${tenantAId}', '${branchAId}', 'WH-A-WP020', 'Main Warehouse A', 'PHYSICAL')
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO ingredients (id, organization_id, code, name, unit_of_measure, current_average_cost) VALUES
          ('${ingredientAId}', '${tenantAId}', 'ING-WP020-01', 'Test Ingredient A', 'KG', 15.0000)
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO purchase_orders (id, organization_id, branch_id, supplier_id, order_number, status, total_amount) VALUES
          ('${poAId}', '${tenantAId}', '${branchAId}', '${supplierAId}', 'PO-WP020-001', 'SENT', 150.0000)
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO purchase_order_items (id, organization_id, purchase_order_id, ingredient_id, ordered_quantity, unit_cost, line_amount) VALUES
          ('${poItemAId}', '${tenantAId}', '${poAId}', '${ingredientAId}', 10.0000, 15.0000, 150.0000)
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO purchase_receipts (id, organization_id, branch_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, status, total_amount) VALUES
          ('${receiptAId}', '${tenantAId}', '${branchAId}', '${poAId}', '${supplierAId}', '${warehouseAId}', 'REC-WP020-001', 'CONFIRMED', 150.0000)
         ON CONFLICT (organization_id, id) DO NOTHING;

         INSERT INTO purchase_receipt_items (id, organization_id, purchase_receipt_id, purchase_order_item_id, ingredient_id, received_quantity, accepted_unit_cost, line_amount) VALUES
          ('${receiptItemAId}', '${tenantAId}', '${receiptAId}', '${poItemAId}', '${ingredientAId}', 10.0000, 15.0000, 150.0000)
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
        DELETE FROM cash_reconciliations WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branch_operating_expenses WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM scheduled_payments WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM accounts_receivable WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM accounts_payable WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
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

  it('WP020-DB-01: Exact five WP-020 physical tables exist', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'accounts_payable',
          'scheduled_payments',
          'accounts_receivable',
          'branch_operating_expenses',
          'cash_reconciliations'
        )
      ORDER BY table_name;
    `);

    const tables = res.rows.map((r) => r.table_name);
    assert.deepEqual(tables, [
      'accounts_payable',
      'accounts_receivable',
      'branch_operating_expenses',
      'cash_reconciliations',
      'scheduled_payments',
    ]);
  });

  it('WP020-DB-02 & WP020-DB-03: RLS and FORCE RLS are enabled on all five WP-020 physical tables', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'accounts_payable',
        'scheduled_payments',
        'accounts_receivable',
        'branch_operating_expenses',
        'cash_reconciliations'
      )
      ORDER BY relname;
    `);

    assert.equal(res.rows.length, 5);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have RLS enabled`);
      assert.equal(
        row.relforcerowsecurity,
        true,
        `Table ${row.relname} must have FORCE RLS enabled`,
      );
    }
  });

  it('WP020-DB-04: AP tenant isolation and default deny without tenant context', async () => {
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${supplierAId}', '${receiptAId}', 150.0000, 150.0000, '2026-10-01', 'PENDING'
        );
      `);
    } finally {
      adminClient.release();
    }

    await asTestRole(async (client) => {
      // Unauthenticated context -> 0 visible rows
      const unauthRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM accounts_payable;`,
      );
      assert.equal(unauthRes.rows[0]?.count, '0');

      // Set Tenant A context
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const authResA = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM accounts_payable;`,
      );
      assert.equal(authResA.rows[0]?.count, '1');
      await client.query('COMMIT;');

      // Switch to Tenant B context -> cannot see Tenant A's AP
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const authResB = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM accounts_payable;`,
      );
      assert.equal(authResB.rows[0]?.count, '0');
      await client.query('COMMIT;');
    });
  });

  it('WP020-DB-05: AR tenant isolation and candidate key uniqueness', async () => {
    const customerAId = crypto.randomUUID();
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO accounts_receivable (
          organization_id, branch_id, customer_id, reference_account_id, total_amount, balance_due, due_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${customerAId}', 'REF-AR-001', 500.0000, 500.0000, '2026-10-15', 'PENDING'
        );
      `);
    } finally {
      adminClient.release();
    }

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const resA = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM accounts_receivable;`,
      );
      assert.equal(resA.rows[0]?.count, '1');
      await client.query('COMMIT;');

      // Tenant B cannot see Tenant A's AR
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const resB = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM accounts_receivable;`,
      );
      assert.equal(resB.rows[0]?.count, '0');
      await client.query('COMMIT;');
    });
  });

  it('WP020-DB-06: Branch operating expense tenant isolation', async () => {
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO branch_operating_expenses (
          organization_id, branch_id, amount, category, receipt_attachment_url, notes
        ) VALUES (
          '${tenantAId}', '${branchAId}', 45.5000, 'PETTY_CASH', 'https://storage.local/receipts/exp-001.jpg', 'Store cleaning supplies'
        );
      `);
    } finally {
      adminClient.release();
    }

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const resA = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM branch_operating_expenses;`,
      );
      assert.equal(resA.rows[0]?.count, '1');
      await client.query('COMMIT;');

      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const resB = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM branch_operating_expenses;`,
      );
      assert.equal(resB.rows[0]?.count, '0');
      await client.query('COMMIT;');
    });
  });

  it('WP020-DB-07: Scheduled payments composite tenant-safe foreign key to AP', async () => {
    const adminClient = await pool.connect();
    let apId: string;
    try {
      // Create a receipt for this AP
      const receiptId2 = crypto.randomUUID();
      await adminClient.query(`
        INSERT INTO purchase_receipts (id, organization_id, branch_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, status, total_amount)
        VALUES ('${receiptId2}', '${tenantAId}', '${branchAId}', '${poAId}', '${supplierAId}', '${warehouseAId}', 'REC-WP020-002', 'CONFIRMED', 300.0000);
      `);

      const apRes = await adminClient.query<{ id: string }>(`
        INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${supplierAId}', '${receiptId2}', 300.0000, 300.0000, '2026-10-01', 'PENDING'
        ) RETURNING id;
      `);
      apId = apRes.rows[0]!.id;

      await adminClient.query(`
        INSERT INTO scheduled_payments (
          organization_id, branch_id, accounts_payable_id, scheduled_amount, scheduled_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${apId}', 150.0000, '2026-09-20', 'PENDING'
        );
      `);
    } finally {
      adminClient.release();
    }

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM scheduled_payments WHERE accounts_payable_id = '${apId}';`,
      );
      assert.equal(count.rows[0]?.count, '1');
      await client.query('COMMIT;');
    });
  });

  it('WP020-DB-08: Financial amount check constraints reject negative balances and zero totals', async () => {
    const adminClient = await pool.connect();
    try {
      // AP total_amount must be positive (> 0.0000)
      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, $4, 0.0000, 0.0000, '2026-10-01', 'PENDING');`,
        [tenantAId, branchAId, supplierAId, receiptAId],
        /chk_ap_total_positive/,
      );

      // AP balance_due cannot exceed total_amount
      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, $4, 100.0000, 150.0000, '2026-10-01', 'PENDING');`,
        [tenantAId, branchAId, supplierAId, receiptAId],
        /chk_ap_balance_le_total/,
      );

      // Expense amount must be positive
      await assertQueryRejects(
        adminClient,
        `INSERT INTO branch_operating_expenses (
          organization_id, branch_id, amount, category
        ) VALUES ($1, $2, 0.0000, 'PETTY_CASH');`,
        [tenantAId, branchAId],
        /chk_expense_amount_positive/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-09 & WP020-DB-10: AP and AR check constraints enforce governed lifecycle states', async () => {
    const adminClient = await pool.connect();
    try {
      // Invalid AP status
      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, $4, 100.0000, 100.0000, '2026-10-01', 'INVALID_STATUS');`,
        [tenantAId, branchAId, supplierAId, receiptAId],
        /chk_ap_status/,
      );

      // Invalid AR status
      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_receivable (
          organization_id, branch_id, customer_id, reference_account_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, 'REF-INV-STATUS', 100.0000, 100.0000, '2026-10-01', 'UNKNOWN_STATUS');`,
        [tenantAId, branchAId, crypto.randomUUID()],
        /chk_ar_status/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-11: AP receipt idempotency identity rejects duplicate purchase_receipt_id within tenant', async () => {
    const adminClient = await pool.connect();
    const uniqueReceiptId = crypto.randomUUID();
    try {
      await adminClient.query(`
        INSERT INTO purchase_receipts (id, organization_id, branch_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, status, total_amount)
        VALUES ('${uniqueReceiptId}', '${tenantAId}', '${branchAId}', '${poAId}', '${supplierAId}', '${warehouseAId}', 'REC-WP020-UQ-01', 'CONFIRMED', 250.0000);

        INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${supplierAId}', '${uniqueReceiptId}', 250.0000, 250.0000, '2026-10-01', 'PENDING'
        );
      `);

      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, $4, 250.0000, 250.0000, '2026-10-01', 'PENDING');`,
        [tenantAId, branchAId, supplierAId, uniqueReceiptId],
        /uq_ap_org_receipt/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-12: AR external-reference idempotency identity rejects duplicate reference_account_id within tenant', async () => {
    const adminClient = await pool.connect();
    const customerId = crypto.randomUUID();
    try {
      await adminClient.query(`
        INSERT INTO accounts_receivable (
          organization_id, branch_id, customer_id, reference_account_id, total_amount, balance_due, due_date, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', '${customerId}', 'INV-REF-UNIQUE-01', 120.0000, 120.0000, '2026-10-01', 'PENDING'
        );
      `);

      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_receivable (
          organization_id, branch_id, customer_id, reference_account_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, 'INV-REF-UNIQUE-01', 120.0000, 120.0000, '2026-10-01', 'PENDING');`,
        [tenantAId, branchAId, customerId],
        /uq_ar_org_reference/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-13: Cash reconciliation source cut uniqueness rejects duplicate source_cut_id within tenant', async () => {
    const adminClient = await pool.connect();
    try {
      await adminClient.query(`
        INSERT INTO cash_reconciliations (
          organization_id, branch_id, source_cut_id, operational_date, expected_cash, actual_cash, variance, has_variance
        ) VALUES (
          '${tenantAId}', '${branchAId}', 'CORTE-Z-20260901-01', '2026-09-01', 5000.0000, 5000.0000, 0.0000, FALSE
        );
      `);

      await assertQueryRejects(
        adminClient,
        `INSERT INTO cash_reconciliations (
          organization_id, branch_id, source_cut_id, operational_date, expected_cash, actual_cash, variance, has_variance
        ) VALUES ($1, $2, 'CORTE-Z-20260901-01', '2026-09-01', 5000.0000, 5000.0000, 0.0000, FALSE);`,
        [tenantAId, branchAId],
        /uq_cash_rec_org_source_cut/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-14: Cross-tenant foreign key relationships are strictly rejected', async () => {
    const adminClient = await pool.connect();
    try {
      // Attempt to link Tenant A AP to Tenant B branch
      await assertQueryRejects(
        adminClient,
        `INSERT INTO accounts_payable (
          organization_id, branch_id, supplier_id, purchase_receipt_id, total_amount, balance_due, due_date, status
        ) VALUES ($1, $2, $3, $4, 100.0000, 100.0000, '2026-10-01', 'PENDING');`,
        [tenantAId, branchBId, supplierAId, crypto.randomUUID()],
        /fk_ap_branch/,
      );
    } finally {
      adminClient.release();
    }
  });

  it('WP020-DB-15, WP020-DB-16, WP020-DB-17, WP020-DB-18: Authorized rollback of WP-020 removes WP-020 objects while preserving predecessor tables', async () => {
    // 1. Rollback WP-020 migration only
    const revertResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.equal(
      revertResult.reverted,
      '20260905020000_finance_ap_ar_cash_reconciliation',
      'Should revert exactly WP-020 migration',
    );

    // 2. Verify WP-020 objects are dropped
    const wp020TablesRes = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'accounts_payable',
          'scheduled_payments',
          'accounts_receivable',
          'branch_operating_expenses',
          'cash_reconciliations'
        );
    `);
    assert.equal(
      wp020TablesRes.rows.length,
      0,
      'All WP-020 tables must be removed by down migration',
    );

    // 3. Verify WP-019 Procurement tables survive (WP020-DB-16)
    const wp019TablesRes = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'suppliers',
          'purchase_orders',
          'purchase_order_items',
          'purchase_receipts',
          'purchase_receipt_items'
        );
    `);
    assert.equal(wp019TablesRes.rows.length, 5, 'All WP-019 tables must survive WP-020 rollback');

    // 4. Verify stock_ledger survives (WP020-DB-17)
    const stockLedgerRes = await pool.query<{ reg: string | null }>(`
      SELECT to_regclass('stock_ledger') as reg;
    `);
    assert.ok(stockLedgerRes.rows[0]?.reg, 'stock_ledger must survive WP-020 rollback');

    // 5. Verify cloud_integration_outbox survives (WP020-DB-18)
    const outboxRes = await pool.query<{ reg: string | null }>(`
      SELECT to_regclass('cloud_integration_outbox') as reg;
    `);
    assert.ok(outboxRes.rows[0]?.reg, 'cloud_integration_outbox must survive WP-020 rollback');

    // 6. Restore forward migration for subsequent tests
    await migrateUp(pool);
  });
});
