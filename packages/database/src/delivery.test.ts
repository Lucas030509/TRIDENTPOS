/**
 * TRIDENTPOS WP-023: Delivery Hub & Aggregators Database Test Suite
 * Validates tables creation, RLS isolation, unique constraints, and non-destructive rollbacks.
 */

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

describe('TRIDENTPOS WP-023 Delivery Hub & Aggregators Database Suite', () => {
  const pool = getPool();
  const testRole = 'trident_wp023_test_role';

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const taxIdA = `RFC-DEL-${crypto.randomBytes(4).toString('hex')}`;
  const taxIdB = `RFC-DEL-${crypto.randomBytes(4).toString('hex')}`;

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

  before(async () => {
    // 1. Migrate up to latest
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

      // 3. Seed parent organizations & branches
      await setupClient.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id) VALUES
          ('${tenantAId}', 'Delivery Corp A', 'Trident Delivery A', '${taxIdA}'),
          ('${tenantBId}', 'Delivery Corp B', 'Trident Delivery B', '${taxIdB}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name) VALUES
          ('${branchAId}', '${tenantAId}', 'BR-DEL-A1', 'Sucursal Condesa A'),
          ('${branchBId}', '${tenantBId}', 'BR-DEL-B1', 'Sucursal Roma B')
        ON CONFLICT (organization_id, id) DO NOTHING;
      `);
    } finally {
      setupClient.release();
    }
  });

  after(async () => {
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query(`
        DELETE FROM branches WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
        DROP OWNED BY ${testRole};
        DROP ROLE IF EXISTS ${testRole};
      `);
    } finally {
      cleanupClient.release();
      await pool.end();
    }
  });

  it('WP023-DB-01: Exact three WP-023 delivery tables exist in public schema', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('delivery_integrations', 'external_orders', 'webhook_events')
      ORDER BY table_name;
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    assert.deepEqual(tableNames, ['delivery_integrations', 'external_orders', 'webhook_events']);
  });

  it('WP023-DB-02: RLS and FORCE RLS are enabled on all three WP-023 tables', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' 
        AND c.relname IN ('delivery_integrations', 'external_orders', 'webhook_events')
      ORDER BY c.relname;
    `);

    assert.equal(res.rows.length, 3);
    for (const row of res.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have row security enabled`);
      assert.equal(
        row.relforcerowsecurity,
        true,
        `Table ${row.relname} must have FORCE row security enabled`,
      );
    }
  });

  it('WP023-DB-03: Tenant default-deny returns 0 visible rows without tenant context', async () => {
    // Insert test records using superuser connection
    const integrationId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO delivery_integrations (
        id, organization_id, branch_id, channel, store_external_id, webhook_secret
      ) VALUES (
        '${integrationId}', '${tenantAId}', '${branchAId}', 'UBER_EATS', 'store-uber-01', 'secret-val-01'
      );
    `);

    // As unprivileged test role with no tenant context
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      const checkRes = await client.query('SELECT * FROM delivery_integrations;');
      assert.equal(checkRes.rows.length, 0, 'Must return 0 rows under default-deny');
      await client.query('COMMIT;');
    });
  });

  it('WP023-DB-04: Tenant visibility separation between Tenant A and Tenant B', async () => {
    const integrationBId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO delivery_integrations (
        id, organization_id, branch_id, channel, store_external_id, webhook_secret
      ) VALUES (
        '${integrationBId}', '${tenantBId}', '${branchBId}', 'UBER_EATS', 'store-uber-b01', 'secret-val-02'
      );
    `);

    // Tenant A queries
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);
      const resA = await client.query('SELECT * FROM delivery_integrations;');
      assert.equal(resA.rows.length, 1);
      assert.equal(resA.rows[0].organization_id, tenantAId);
      await client.query('COMMIT;');
    });

    // Tenant B queries
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantBId);
      const resB = await client.query('SELECT * FROM delivery_integrations;');
      assert.equal(resB.rows.length, 1);
      assert.equal(resB.rows[0].organization_id, tenantBId);
      await client.query('COMMIT;');
    });
  });

  it('WP023-DB-05: Unique candidate keys reject duplicates within same tenant', async () => {
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      // Duplicate channel for same branch in tenant A must fail
      await assert.rejects(
        client.query(`
          INSERT INTO delivery_integrations (
            organization_id, branch_id, channel, store_external_id, webhook_secret
          ) VALUES (
            '${tenantAId}', '${branchAId}', 'UBER_EATS', 'store-dup', 'sec-dup'
          );
        `),
        /unique constraint/i,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP023-DB-06: External orders and webhook events candidate keys enforce idempotency', async () => {
    const orderId = crypto.randomUUID();
    const eventId = 'evt-idempotent-001';

    // 1. Order candidate key
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO external_orders (
          id, organization_id, branch_id, channel, external_order_id, event_id, customer_name, subtotal, grand_total
        ) VALUES (
          '${orderId}', '${tenantAId}', '${branchAId}', 'RAPPI', 'RAPPI-1001', '${eventId}', 'Ana Gomez', 150.0000, 174.0000
        );
      `);

      await assert.rejects(
        client.query(`
          INSERT INTO external_orders (
            organization_id, branch_id, channel, external_order_id, event_id, customer_name, subtotal, grand_total
          ) VALUES (
            '${tenantAId}', '${branchAId}', 'RAPPI', 'RAPPI-1001', 'evt-diff', 'Pedro', 200.0000, 232.0000
          );
        `),
        /unique constraint/i,
      );

      await client.query('ROLLBACK;');
    });

    // 2. Webhook event candidate key
    await asTestRole(async (client) => {
      await client.query('BEGIN;');
      await setTenantContext(client, tenantAId);

      await client.query(`
        INSERT INTO webhook_events (
          organization_id, branch_id, channel, event_id, signature, status
        ) VALUES (
          '${tenantAId}', '${branchAId}', 'RAPPI', '${eventId}', 'sig-valid-99', 'PROCESSED'
        );
      `);

      await assert.rejects(
        client.query(`
          INSERT INTO webhook_events (
            organization_id, branch_id, channel, event_id, signature, status
          ) VALUES (
            '${tenantAId}', '${branchAId}', 'RAPPI', '${eventId}', 'sig-dup', 'RECEIVED'
          );
        `),
        /unique constraint/i,
      );

      await client.query('ROLLBACK;');
    });
  });

  it('WP023-DOWN-01: Non-production rollback reverts WP-023 tables while preserving predecessors', async () => {
    const downResult = await migrateDown(pool, { allowDestructiveDown: true });
    assert.ok(downResult.reverted.includes('20261015000000_delivery_hub_aggregators'));

    // Check that WP-023 tables are gone
    const checkRes = await pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('delivery_integrations', 'external_orders', 'webhook_events');
    `);
    assert.equal(checkRes.rows[0]?.count, 0);

    // Predecessors must survive (customers from WP-022, fiscal_invoices from WP-021, accounts_payable from WP-020)
    const prevRes = await pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('customers', 'loyalty_accounts', 'fiscal_invoices', 'accounts_payable', 'products');
    `);
    assert.equal(prevRes.rows[0]?.count, 5);

    // Re-migrate up to restore clean state
    await migrateUp(pool);
  });
});
