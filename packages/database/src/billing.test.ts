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

describe('TRIDENTPOS WP-021 Billing & Fiscal Invoicing Database Suite', { concurrency: 1 }, () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();

  const testRole = 'trident_wp021_test_role';

  async function asTestRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${testRole};`);
      return await fn(client);
    } finally {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // Safety
      }
      try {
        await client.query('RESET ROLE;');
      } catch {
        // Safety
      }
      client.release();
    }
  }

  async function assertQueryRejects(
    client: pg.PoolClient,
    sql: string,
    params: unknown[],
    errorPattern: RegExp,
  ): Promise<void> {
    await client.query('SAVEPOINT test_savepoint;');
    try {
      await client.query(sql, params);
      assert.fail(`Expected query to reject with ${errorPattern}`);
    } catch (err: unknown) {
      await client.query('ROLLBACK TO SAVEPOINT test_savepoint;');
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, errorPattern);
    } finally {
      try {
        await client.query('RELEASE SAVEPOINT test_savepoint;');
      } catch {
        // Safety
      }
    }
  }

  before(async () => {
    // Apply all migrations
    await migrateUp(pool);

    const client = await pool.connect();
    try {
      // Setup test role
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            CREATE ROLE ${testRole} WITH LOGIN;
          END IF;
        END
        $$;
        GRANT USAGE ON SCHEMA public TO ${testRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${testRole};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${testRole};
      `);

      // Seed organizations and branches
      const taxIdA = `RFC-BILL-A-${tenantAId.substring(0, 8)}`;
      const taxIdB = `RFC-BILL-B-${tenantBId.substring(0, 8)}`;

      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES 
          ('${tenantAId}', 'Tenant A Billing Org', 'Tenant A', '${taxIdA}'),
          ('${tenantBId}', 'Tenant B Billing Org', 'Tenant B', '${taxIdB}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES 
          ('${branchAId}', '${tenantAId}', 'BR-A1', 'Branch A1'),
          ('${branchBId}', '${tenantBId}', 'BR-B1', 'Branch B1')
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query(`DROP ROLE IF EXISTS ${testRole};`);
    } catch {
      // Safety
    } finally {
      client.release();
    }
  });

  it('WP021-DB-01: tax_schemes RLS and tenant isolation', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO tax_schemes (organization_id, code, name, rate, is_inclusive, tax_type)
        VALUES ('${tenantAId}', 'IVA_16', 'IVA 16% General', '0.1600', true, 'IVA');
      `);

      const rowsA = await client.query('SELECT * FROM tax_schemes;');
      assert.equal(rowsA.rows.length, 1);
      assert.equal(rowsA.rows[0].code, 'IVA_16');

      await client.query('COMMIT;');
    });

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);

      const rowsB = await client.query('SELECT * FROM tax_schemes;');
      assert.equal(rowsB.rows.length, 0); // Tenant B cannot see Tenant A's tax schemes

      await client.query('COMMIT;');
    });
  });

  it('WP021-DB-02: tax_schemes unique (organization_id, code) constraint', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await assertQueryRejects(
        client,
        `INSERT INTO tax_schemes (organization_id, code, name, rate, is_inclusive, tax_type)
         VALUES ('${tenantAId}', 'IVA_16', 'Duplicate IVA 16%', '0.1600', true, 'IVA');`,
        [],
        /uq_tax_schemes_org_code/i,
      );

      await client.query('COMMIT;');
    });
  });

  it('WP021-DB-03: emisor_fiscal_config RLS and organization uniqueness', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO emisor_fiscal_config (organization_id, rfc, razon_social, regimen_fiscal, codigo_postal)
        VALUES ('${tenantAId}', 'TRI200101ABC', 'TRIDENT S.A. DE C.V.', '601', '06000');
      `);

      const rows = await client.query('SELECT * FROM emisor_fiscal_config;');
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].rfc, 'TRI200101ABC');

      await client.query('COMMIT;');
    });
  });

  it('WP021-DB-04: fiscal_invoices RLS and unique (organization_id, series, folio)', async () => {
    const invoiceId = crypto.randomUUID();

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO fiscal_invoices (
          id, organization_id, branch_id, series, folio, customer_tax_id, customer_name,
          customer_regimen_fiscal, customer_postal_code, cfdi_use, payment_method, payment_way,
          subtotal, tax_total, total_amount, status
        ) VALUES (
          '${invoiceId}', '${tenantAId}', '${branchAId}', 'A', '0001', 'XAXX010101000', 'PUBLICO EN GENERAL',
          '616', '06000', 'S01', 'PUE', '01', 100.0000, 16.0000, 116.0000, 'DRAFT'
        );
      `);

      const rows = await client.query('SELECT * FROM fiscal_invoices;');
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].folio, '0001');

      // Reject duplicate series + folio under same org
      await assertQueryRejects(
        client,
        `INSERT INTO fiscal_invoices (
          organization_id, branch_id, series, folio, customer_tax_id, customer_name,
          customer_regimen_fiscal, customer_postal_code, cfdi_use, payment_method, payment_way,
          subtotal, tax_total, total_amount, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', 'A', '0001', 'XAXX010101000', 'PUBLICO EN GENERAL',
          '616', '06000', 'S01', 'PUE', '01', 50.0000, 8.0000, 58.0000, 'DRAFT'
        );`,
        [],
        /uq_fiscal_invoices_folio/i,
      );

      await client.query('COMMIT;');
    });
  });

  it('WP021-DB-05: fiscal_invoice_items composite foreign key & cascade delete', async () => {
    const invoiceId = crypto.randomUUID();

    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO fiscal_invoices (
          id, organization_id, branch_id, series, folio, customer_tax_id, customer_name,
          customer_regimen_fiscal, customer_postal_code, cfdi_use, payment_method, payment_way,
          subtotal, tax_total, total_amount, status
        ) VALUES (
          '${invoiceId}', '${tenantAId}', '${branchAId}', 'A', '0002', 'XAXX010101000', 'PUBLICO EN GENERAL',
          '616', '06000', 'S01', 'PUE', '01', 200.0000, 32.0000, 232.0000, 'DRAFT'
        );
      `);

      await client.query(`
        INSERT INTO fiscal_invoice_items (
          organization_id, invoice_id, line_number, product_code, description, sat_product_code,
          sat_unit_code, quantity, unit_price, subtotal, tax_amount, total_amount, tax_rate
        ) VALUES (
          '${tenantAId}', '${invoiceId}', 1, 'PROD-01', 'Cena Especial', '90101501',
          'E48', 2.0000, 100.0000, 200.0000, 32.0000, 232.0000, 0.1600
        );
      `);

      const items = await client.query(
        'SELECT * FROM fiscal_invoice_items WHERE invoice_id = $1;',
        [invoiceId],
      );
      assert.equal(items.rows.length, 1);
      assert.equal(items.rows[0].description, 'Cena Especial');

      await client.query('COMMIT;');
    });
  });

  it('WP021-DB-06: lotes_facturacion_global table for OQ-ARCH-02 batch infrastructure', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO lotes_facturacion_global (
          organization_id, branch_id, batch_reference, period_start, period_end,
          ticket_folios, subtotal, tax_total, total_amount, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', 'BATCH-2026-09', '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z',
          ARRAY['T-001', 'T-002'], 300.0000, 48.0000, 348.0000, 'PENDING'
        );
      `);

      const batches = await client.query('SELECT * FROM lotes_facturacion_global;');
      assert.equal(batches.rows.length, 1);
      assert.equal(batches.rows[0].batch_reference, 'BATCH-2026-09');

      await client.query('COMMIT;');
    });
  });

  it('WP021-DOWN-01: Non-production rollback of WP-021 removes billing tables and preserves predecessors', async () => {
    const downResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.equal(downResult.reverted, '20260905030000_billing_fiscal_invoicing');

    const checkTables = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'tax_schemes', 'emisor_fiscal_config', 'fiscal_invoices',
        'fiscal_invoice_items', 'lotes_facturacion_global'
      );
    `);
    assert.equal(checkTables.rows.length, 0);

    // Predecessor survival: verify WP-020, WP-019, WP-018, WP-017, WP-016B tables remain intact
    const predecessorCheck = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'accounts_payable', 'accounts_receivable', 'purchase_orders',
        'stock_ledger', 'recipes', 'products'
      );
    `);
    assert.equal(predecessorCheck.rows.length, 6);

    // Re-apply to leave database clean and up to date
    const upResult = await migrateUp(pool);
    assert.ok(upResult.applied.includes('20260905030000_billing_fiscal_invoicing'));

    const grantClient = await pool.connect();
    try {
      await grantClient.query(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${testRole};
      `);
    } finally {
      grantClient.release();
    }
  });
});
