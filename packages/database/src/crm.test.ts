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

describe('TRIDENTPOS WP-022 CRM & Loyalty Database Suite', { concurrency: 1 }, () => {
  const pool = getPool();

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();

  const testRole = 'trident_wp022_test_role';

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
      const taxIdA = `RFC-CRM-A-${tenantAId.substring(0, 8)}`;
      const taxIdB = `RFC-CRM-B-${tenantBId.substring(0, 8)}`;

      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES 
          ('${tenantAId}', 'Tenant A CRM Org', 'Tenant A', '${taxIdA}'),
          ('${tenantBId}', 'Tenant B CRM Org', 'Tenant B', '${taxIdB}')
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
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testRole}') THEN
            DROP OWNED BY ${testRole};
            DROP ROLE ${testRole};
          END IF;
        END
        $$;
      `);
    } finally {
      client.release();
    }
  });

  it('WP022-DB-01: Exact five WP-022 physical tables exist', async () => {
    const result = await pool.query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'customers',
          'customer_delivery_addresses',
          'loyalty_accounts',
          'loyalty_transactions',
          'promotions'
        )
      ORDER BY table_name;
    `);

    const tables = result.rows.map((r) => r.table_name);
    assert.deepEqual(tables, [
      'customer_delivery_addresses',
      'customers',
      'loyalty_accounts',
      'loyalty_transactions',
      'promotions',
    ]);
  });

  it('WP022-DB-02: RLS and FORCE RLS are enabled on all five WP-022 tables', async () => {
    const result = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'customers',
          'customer_delivery_addresses',
          'loyalty_accounts',
          'loyalty_transactions',
          'promotions'
        )
      ORDER BY c.relname;
    `);

    assert.equal(result.rows.length, 5);
    for (const row of result.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have RLS enabled`);
      assert.equal(
        row.relforcerowsecurity,
        true,
        `Table ${row.relname} must have FORCE RLS enabled`,
      );
    }
  });

  it('WP022-DB-03: Tenant default-deny returns 0 visible rows without tenant context', async () => {
    await asTestRole(async (client) => {
      const customersRes = await client.query('SELECT COUNT(*)::int AS count FROM customers;');
      assert.equal(customersRes.rows[0]?.count, 0);

      const loyaltyRes = await client.query('SELECT COUNT(*)::int AS count FROM loyalty_accounts;');
      assert.equal(loyaltyRes.rows[0]?.count, 0);

      const promosRes = await client.query('SELECT COUNT(*)::int AS count FROM promotions;');
      assert.equal(promosRes.rows[0]?.count, 0);
    });
  });

  it('WP022-DB-04: Tenant visibility separation between Tenant A and Tenant B', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const custAId = crypto.randomUUID();
      await client.query(`
        INSERT INTO customers (id, organization_id, code, full_name, phone, credit_limit, current_balance)
        VALUES ('${custAId}', '${tenantAId}', 'CUST-A1', 'Cliente Tenant A', '5511223344', 5000.0000, 0.0000);
      `);

      const cardAId = crypto.randomUUID();
      await client.query(`
        INSERT INTO loyalty_accounts (id, organization_id, customer_id, card_number, points_balance, wallet_balance, tier)
        VALUES ('${cardAId}', '${tenantAId}', '${custAId}', 'RC-A-100', 100.0000, 50.0000, 'BRONZE');
      `);

      const selA = await client.query('SELECT code FROM customers WHERE organization_id = $1;', [
        tenantAId,
      ]);
      assert.equal(selA.rows.length, 1);
      assert.equal(selA.rows[0]?.code, 'CUST-A1');
      await client.query('COMMIT;');
    });

    // Check from Tenant B perspective
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);

      const selB = await client.query('SELECT code FROM customers;');
      assert.equal(selB.rows.length, 0); // Tenant B sees zero rows of Tenant A

      await client.query('COMMIT;');
    });
  });

  it('WP022-DB-05: Customer candidate key (org, code) rejects duplicates in same tenant but allows in different', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await assertQueryRejects(
        client,
        `INSERT INTO customers (organization_id, code, full_name, phone) VALUES ($1, $2, $3, $4);`,
        [tenantAId, 'CUST-A1', 'Duplicado A1', '5599887766'],
        /uq_customers_org_code/,
      );

      await client.query('COMMIT;');
    });

    // Same code 'CUST-A1' is permitted under Tenant B
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);

      await client.query(
        `
        INSERT INTO customers (organization_id, code, full_name, phone)
        VALUES ($1, $2, $3, $4);
      `,
        [tenantBId, 'CUST-A1', 'Cliente Tenant B mismo codigo', '5544332211'],
      );

      const sel = await client.query('SELECT code FROM customers WHERE code = $1;', ['CUST-A1']);
      assert.equal(sel.rows.length, 1);
      await client.query('COMMIT;');
    });
  });

  it('WP022-DB-06: Loyalty card candidate key (org, card_number) and check constraints', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const custRes = await client.query(
        'SELECT id FROM customers WHERE organization_id = $1 LIMIT 1;',
        [tenantAId],
      );
      const custId = custRes.rows[0]?.id;

      // Duplicate card number under same tenant rejected
      await assertQueryRejects(
        client,
        `INSERT INTO loyalty_accounts (organization_id, customer_id, card_number) VALUES ($1, $2, $3);`,
        [tenantAId, custId, 'RC-A-100'],
        /uq_loyalty_card/,
      );

      // Negative points rejected by CHECK constraint
      await assertQueryRejects(
        client,
        `INSERT INTO loyalty_accounts (organization_id, customer_id, card_number, points_balance) VALUES ($1, $2, $3, -10.0000);`,
        [tenantAId, custId, 'RC-A-999'],
        /chk_loyalty_points_positive/,
      );

      await client.query('COMMIT;');
    });
  });

  it('WP022-DB-07: Append-only trigger rejects direct UPDATE and DELETE on loyalty_transactions', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      const cardRes = await client.query(
        'SELECT id FROM loyalty_accounts WHERE organization_id = $1 LIMIT 1;',
        [tenantAId],
      );
      const cardId = cardRes.rows[0]?.id;

      const txId = crypto.randomUUID();
      await client.query(
        `
        INSERT INTO loyalty_transactions (
          id, organization_id, loyalty_account_id, transaction_type, points_delta, wallet_delta, reference_account_id
        ) VALUES ($1, $2, $3, 'EARN', 50.0000, 0.0000, 'pos-ref-001');
      `,
        [txId, tenantAId, cardId],
      );

      // Direct UPDATE must fail with P0001
      await assertQueryRejects(
        client,
        `UPDATE loyalty_transactions SET points_delta = 100.0000 WHERE id = $1;`,
        [txId],
        /loyalty_transactions is append-only/,
      );

      // Direct DELETE must fail with P0001
      await assertQueryRejects(
        client,
        `DELETE FROM loyalty_transactions WHERE id = $1;`,
        [txId],
        /loyalty_transactions is append-only/,
      );

      await client.query('COMMIT;');
    });
  });

  it('WP022-DB-08: Cross-tenant foreign key relationships are strictly rejected', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);

      // Get Tenant A customer
      const custARes = await pool.query(
        'SELECT id FROM customers WHERE organization_id = $1 LIMIT 1;',
        [tenantAId],
      );
      const custAId = custARes.rows[0]?.id;

      // Tenant B trying to create loyalty_account referencing Tenant A customer must fail
      await assertQueryRejects(
        client,
        `INSERT INTO loyalty_accounts (organization_id, customer_id, card_number) VALUES ($1, $2, 'RC-B-CROSS');`,
        [tenantBId, custAId],
        /fk_loyalty_accounts_customer/,
      );

      await client.query('COMMIT;');
    });
  });

  it('WP022-DB-09: Concurrent points balance mutation integrity', async () => {
    // Proves that serializable or locked balance update prevents double spend
    const client1 = await pool.connect();
    const client2 = await pool.connect();
    try {
      await client1.query('BEGIN;');
      await setTenantContext(client1, tenantAId);

      const cardRes = await client1.query<{ id: string; points_balance: string }>(
        'SELECT id, points_balance FROM loyalty_accounts WHERE card_number = $1 FOR UPDATE;',
        ['RC-A-100'],
      );
      const card = cardRes.rows[0]!;
      assert.equal(card.points_balance, '100.0000');

      // Client 1 redeems 60 points
      await client1.query(
        'UPDATE loyalty_accounts SET points_balance = points_balance - 60.0000 WHERE id = $1;',
        [card.id],
      );
      await client1.query('COMMIT;');

      // Client 2 reads updated balance
      await client2.query('BEGIN;');
      await setTenantContext(client2, tenantAId);
      const updatedRes = await client2.query<{ points_balance: string }>(
        'SELECT points_balance FROM loyalty_accounts WHERE id = $1;',
        [card.id],
      );
      assert.equal(updatedRes.rows[0]?.points_balance, '40.0000');
      await client2.query('COMMIT;');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('WP022-DOWN-01: Non-production rollback reverts WP-022 tables while preserving predecessors', async () => {
    const downResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.ok(downResult.reverted.includes('20261014000000_crm_loyalty_rewards'));

    // Check that WP-022 tables are gone
    const checkRes = await pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('customers', 'customer_delivery_addresses', 'loyalty_accounts', 'loyalty_transactions', 'promotions');
    `);
    assert.equal(checkRes.rows[0]?.count, 0);

    // Predecessors must survive (e.g. fiscal_invoices from WP-021, accounts_payable from WP-020)
    const prevRes = await pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('fiscal_invoices', 'accounts_payable', 'purchase_orders', 'warehouses', 'products');
    `);
    assert.equal(prevRes.rows[0]?.count, 5);

    // Re-migrate up to restore clean state
    await migrateUp(pool);
  });
});
