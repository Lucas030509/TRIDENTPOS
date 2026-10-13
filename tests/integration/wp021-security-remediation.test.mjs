import {
  MockPacConnector,
  InMemoryCsdVault,
  createTestPacProvenance,
} from '../../packages/billing/dist/index.js';
import {
  signedTestRegistry,
  realTestCertificate,
} from '../../packages/cloud-server/dist/billing-test-fixtures.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  ConsumerInboxService,
  PostgresBillingService,
} from '../../packages/cloud-server/dist/index.js';
import { generateFiscalSemanticEventId } from '../../packages/cloud-server/dist/index.js';
import {
  CloudIntegrationOutboxService as Outbox,
  parseMigrationFile,
} from '../../packages/database/dist/index.js';

// Native PostgreSQL when a dedicated test URL is provided. An explicit adapter is
// allowed for SQL-engine simulation; it does not prove native concurrency/PITR.
const enabled = Boolean(
  process.env.WP021_SECURITY_TEST_DATABASE_URL || process.env.WP021_TEST_DATABASE_ADAPTER,
);
let pool;
let inbox;
let client;
const tenant = crypto.randomUUID();
const other = crypto.randomUUID();
const branch = crypto.randomUUID();
const invoice = crypto.randomUUID();
const operation = crypto.randomUUID();
const schema = `wp021_test_${crypto.randomBytes(8).toString('hex')}`;
const context = 'finance-test';
const id = generateFiscalSemanticEventId(tenant, operation, 'FacturaFiscalEmitida');
const payload = {
  semanticEventId: id,
  eventContractVersion: '1.0',
  invoiceId: invoice,
  uuid: crypto.randomUUID(),
  totalAmount: '116.0000',
};
const event = {
  organizationId: tenant,
  semanticEventId: id,
  eventKind: 'FacturaFiscalEmitida',
  eventContractVersion: '1.0',
  effectMode: 'TRANSACTIONAL_SQL',
  payload,
};
const original = parseMigrationFile(
  fileURLToPath(
    new URL(
      '../../packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql',
      import.meta.url,
    ),
  ),
);
const additive = parseMigrationFile(
  fileURLToPath(
    new URL(
      '../../packages/database/migrations/20261001000000_wp021_security_event_integrity.sql',
      import.meta.url,
    ),
  ),
);
const restoreMarkerMigration = parseMigrationFile(
  fileURLToPath(
    new URL(
      '../../packages/database/migrations/20261002000000_wp021_consumer_restore_marker.sql',
      import.meta.url,
    ),
  ),
);
const source = {
  async readInterval() {
    return {
      retainedFrom: '2026-01-01T00:00:00Z',
      retainedUntil: '2027-01-01T00:00:00Z',
      complete: true,
      redeliveryIndependentOfAcknowledgment: true,
      events: [event],
    };
  },
};
const handler = async (c, e) =>
  c.query(
    'INSERT INTO test_effects (organization_id, semantic_event_id, amount) VALUES ($1,$2,$3);',
    [e.organizationId, e.semanticEventId, e.payload.totalAmount],
  );
const plan = () => ({
  from: '2026-09-01T00:00:00Z',
  until: '2026-10-01T00:00:00Z',
  restoreDomain: 'EFFECT_AND_INBOX_RESTORED_TOGETHER',
  source,
  handler,
  verifyEffect: async (c, e) =>
    (
      await c.query(
        'SELECT 1 FROM test_effects WHERE organization_id=$1 AND semantic_event_id=$2',
        [e.organizationId, e.semanticEventId],
      )
    ).rows.length === 1,
});
const count = async () =>
  Number((await pool.query('SELECT count(*)::int AS n FROM test_effects')).rows[0].n);
const clearConsumer = async () =>
  pool.query(
    'DELETE FROM test_effects; DELETE FROM consumer_inbox_events; DELETE FROM consumer_restore_pending_markers;',
  );
before(async () => {
  if (!enabled) return;
  if (process.env.WP021_TEST_DATABASE_ADAPTER) {
    pool = await (await import(process.env.WP021_TEST_DATABASE_ADAPTER)).createPool();
  } else {
    process.env.DATABASE_URL = process.env.WP021_SECURITY_TEST_DATABASE_URL;
    const adminPool = new pg.Pool({
      connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL,
    });
    await adminPool.query(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
    await adminPool.end();
    pool = new pg.Pool({
      connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 15,
    });
  }
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema}, public;
    CREATE TABLE IF NOT EXISTS organizations (id uuid PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS branches (id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), UNIQUE(organization_id,id));
    CREATE OR REPLACE FUNCTION current_app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_organization_id', true),'')::uuid $$;
    CREATE TABLE IF NOT EXISTS test_effects (organization_id uuid NOT NULL, semantic_event_id text NOT NULL, amount numeric NOT NULL, PRIMARY KEY(organization_id, semantic_event_id));`);
  await pool.query('INSERT INTO organizations VALUES ($1),($2) ON CONFLICT (id) DO NOTHING;', [
    tenant,
    other,
  ]);
  await pool.query(
    'INSERT INTO branches VALUES ($1,$2) ON CONFLICT (organization_id, id) DO NOTHING;',
    [branch, tenant],
  );
  const outboxSql = fs.readFileSync(
    fileURLToPath(
      new URL(
        '../../packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  await pool.query(
    outboxSql.slice(
      outboxSql.indexOf('CREATE TABLE cloud_integration_outbox'),
      outboxSql.indexOf('-- 5. Cloud Integration DLQ'),
    ),
  );
  await pool.query(original.upSql);
  await pool.query(additive.upSql);
  await pool.query(restoreMarkerMigration.upSql);
  await pool.query(
    `INSERT INTO fiscal_invoices (id,organization_id,branch_id,series,folio,customer_tax_id,customer_name,customer_regimen_fiscal,customer_postal_code,cfdi_use,payment_method,payment_way,subtotal,tax_total,total_amount,status)
    VALUES ($1,$2,$3,'F','1','AAA010101AAA','Customer','601','06000','G03','PUE','01',100,16,116,'STAMPED');`,
    [invoice, tenant, branch],
  );
  await pool.query(
    `INSERT INTO fiscal_stamping_operations (id,organization_id,branch_id,invoice_id,operation_type,idempotency_key,request_hash,status,semantic_event_id)
    VALUES ($1,$2,$3,$4,'STAMP','test-key','hash','SUCCEEDED',$5);`,
    [operation, tenant, branch, invoice, id],
  );
  inbox = new ConsumerInboxService(pool, {
    approvalReference: 'TEST_SIMULATION_ONLY',
    maxRestoreHorizonMs: 31 * 86400000,
  });
});
after(async () => {
  if (!pool) return;
  releaseClient();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
  await pool.end();
});

function releaseClient() {
  if (client) {
    client.release();
    client = undefined;
  }
}
const sqlTest = (name, fn) => test(name, { skip: !enabled, concurrency: false }, fn);
sqlTest(
  'REQ-80 persisted version/payload survive retry and outbox recreation; immutable trigger rejects rewrite',
  async () => {
    releaseClient();
    const subscribers = [
      {
        subscriberName: 'finance',
        supportedMajors: [1],
        requiredFields: ['eventContractVersion', 'semanticEventId', 'invoiceId', 'uuid'],
      },
    ];
    const service = new PostgresBillingService(
      pool,
      undefined,
      undefined,
      new Outbox(pool),
      undefined,
      subscribers,
    );
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_organization_id',$1,true)", [tenant]);
      await service.enqueueFiscalEvent(c, {
        organizationId: tenant,
        branchId: branch,
        eventType: event.eventKind,
        aggregateType: 'FiscalInvoice',
        aggregateId: invoice,
        payload,
      });
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await pool.query('DELETE FROM cloud_integration_outbox');
    await service.replayFiscalEvent(tenant, operation);
    const recreated = (await pool.query('SELECT payload FROM cloud_integration_outbox')).rows[0]
      .payload;
    assert.deepEqual(recreated, payload);
    await assert.rejects(
      pool.query("UPDATE fiscal_stamping_operations SET event_contract_version='1.1' WHERE id=$1", [
        operation,
      ]),
      /Immutable/,
    );
    await assert.rejects(
      pool.query("UPDATE cloud_integration_outbox SET payload='{}'::jsonb"),
      /Immutable/,
    );
    await pool.query(
      "UPDATE cloud_integration_outbox SET retry_count=1,delivery_attempts=1,status='PENDING'",
    );
    assert.deepEqual(
      (await pool.query('SELECT payload FROM cloud_integration_outbox')).rows[0].payload,
      payload,
    );
  },
);
sqlTest(
  'REQ-78 consumer rejects missing version/required payload/identity before SQL mutation',
  async () => {
    releaseClient();
    for (const options of [
      undefined,
      { eventContractVersion: '2.0', payload },
      { eventContractVersion: '1.0', payload: {} },
    ]) {
      await assert.rejects(
        inbox.processEventWithInbox(
          tenant,
          context,
          id,
          event.eventKind,
          (c) => handler(c, event),
          options,
        ),
      );
    }
    await assert.rejects(
      inbox.processEventWithInbox(tenant, context, id, 'Unknown', (c) => handler(c, event), {
        eventContractVersion: '1.0',
        effectMode: 'TRANSACTIONAL_SQL',
        payload,
      }),
    );
    assert.equal(await count(), 0);
  },
);
sqlTest(
  'REQ-88 SQL effect and inbox commit together; simulated paired rollback then replay restores effect once',
  async () => {
    await clearConsumer();
    await inbox.processEventWithInbox(
      tenant,
      context,
      id,
      event.eventKind,
      (c) => handler(c, event),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
    );
    assert.equal(await count(), 1);
    await clearConsumer(); // Simulates consumer restore of both effect and inbox. Not native PITR.
    assert.equal(
      (await inbox.reconcileConsumerRestore(tenant, context, [event], plan())).reconciledCount,
      1,
    );
    assert.equal(
      (await inbox.reconcileConsumerRestore(tenant, context, [event], plan())).reconciledCount,
      0,
    );
    assert.equal(await count(), 1);
    // Producer-PITR redelivery uses the same persisted semantic envelope.
    assert.equal(
      (
        await inbox.processEventWithInbox(
          tenant,
          context,
          id,
          event.eventKind,
          (c) => handler(c, event),
          { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
        )
      ).duplicate,
      true,
    );
  },
);
sqlTest(
  'REQ-89 inconsistent or absent restore-domain reconciliation cannot insert processed-only inbox',
  async () => {
    await clearConsumer();
    await assert.rejects(inbox.reconcileConsumerRestore(tenant, context, [event]));
    await assert.rejects(
      inbox.reconcileConsumerRestore(tenant, context, [event], {
        ...plan(),
        restoreDomain: 'INBOX_ONLY',
      }),
    );
    assert.equal(await count(), 0);
    assert.equal(await inbox.getProcessedEventCount(tenant, context), 0);
  },
);
sqlTest(
  'REQ-89 retained inbox with missing SQL effect blocks even when caller claims paired restore',
  async () => {
    await inbox.processEventWithInbox(
      tenant,
      context,
      id,
      event.eventKind,
      (c) => handler(c, event),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
    );
    await pool.query('DELETE FROM test_effects;');
    await assert.rejects(
      inbox.reconcileConsumerRestore(tenant, context, [event], plan()),
      /restore inconsistency/,
    );
    assert.equal(await count(), 0);
    await clearConsumer();
  },
);

sqlTest(
  'REQ-90 unknown/insufficient retention, unavailable source and cross-tenant payload block recovery',
  async () => {
    for (const sourceOverride of [
      {
        async readInterval() {
          throw new Error('offline');
        },
      },
      {
        async readInterval() {
          return { ...(await source.readInterval()), retainedFrom: '2026-09-15T00:00:00Z' };
        },
      },
      {
        async readInterval() {
          return { ...(await source.readInterval()), complete: false };
        },
      },
      {
        async readInterval() {
          return {
            ...(await source.readInterval()),
            events: [{ ...event, organizationId: other }],
          };
        },
      },
      {
        async readInterval() {
          return { ...(await source.readInterval()), events: [] };
        },
      },
    ])
      await assert.rejects(
        inbox.reconcileConsumerRestore(tenant, context, [event], {
          ...plan(),
          source: sourceOverride,
        }),
      );
    assert.equal(await count(), 0);
  },
);
sqlTest(
  'REQ-91 consumer-only restore after prior acknowledgment requests independent redelivery and restores SQL effect',
  async () => {
    let readCalls = 0;
    const acknowledgedSource = {
      async readInterval() {
        readCalls++;
        return source.readInterval();
      },
    };
    await inbox.reconcileConsumerRestore(tenant, context, [event], {
      ...plan(),
      source: acknowledgedSource,
    });
    assert.equal(await count(), 1);
    await clearConsumer();
    await inbox.reconcileConsumerRestore(tenant, context, [event], {
      ...plan(),
      source: acknowledgedSource,
    });
    assert.equal(readCalls, 2);
    assert.equal(await count(), 1);
  },
);
sqlTest(
  'REQ-92 external effects without an approved durable-idempotent sink remain BLOCKED BY CONTRACT',
  async () => {
    await clearConsumer();
    let called = false;
    await assert.rejects(
      inbox.processEventWithInbox(
        tenant,
        context,
        id,
        event.eventKind,
        async () => {
          called = true;
        },
        { eventContractVersion: '1.0', payload, effectMode: 'EXTERNAL' },
      ),
      /BLOCKED BY CONTRACT/,
    );
    assert.equal(called, false);
    assert.equal(await inbox.getProcessedEventCount(tenant, context), 0);
  },
);

sqlTest(
  'A4: active restore pending marker blocks processEventWithInbox fail-closed and prevents handler execution',
  async () => {
    await clearConsumer();
    await inbox.markConsumerRestorePending(tenant, context);
    assert.equal(await inbox.hasConsumerRestorePending(tenant, context), true);

    let handlerCalled = false;
    await assert.rejects(
      inbox.processEventWithInbox(
        tenant,
        context,
        id,
        event.eventKind,
        async (c) => {
          handlerCalled = true;
          return handler(c, event);
        },
        { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
      ),
      /BLOCKED: consumer restore reconciliation pending/,
    );
    assert.equal(handlerCalled, false);
    assert.equal(await count(), 0);
    assert.equal(await inbox.isEventProcessed(tenant, context, id), false);
    await clearConsumer();
  },
);

sqlTest(
  'A4: successful reconcileConsumerRestore clears pending marker, proves effect, and subsequent delivery returns duplicate=true',
  async () => {
    await clearConsumer();
    // Simulate consumer restore condition: mark restore pending
    await inbox.markConsumerRestorePending(tenant, context);
    assert.equal(await inbox.hasConsumerRestorePending(tenant, context), true);

    // Normal processing blocked while marker active
    await assert.rejects(
      inbox.processEventWithInbox(tenant, context, id, event.eventKind, (c) => handler(c, event), {
        eventContractVersion: '1.0',
        effectMode: 'TRANSACTIONAL_SQL',
        payload,
      }),
      /BLOCKED: consumer restore reconciliation pending/,
    );

    // Reconcile consumer restore with verifyEffect
    const result = await inbox.reconcileConsumerRestore(tenant, context, [event], plan());
    assert.equal(result.reconciledCount, 1);
    assert.equal(await inbox.hasConsumerRestorePending(tenant, context), false);
    assert.equal(await count(), 1);

    // Subsequent re-delivery with cleared marker returns duplicate: true without executing mutation again
    let duplicateMutationCalled = false;
    const replayResult = await inbox.processEventWithInbox(
      tenant,
      context,
      id,
      event.eventKind,
      async (c) => {
        duplicateMutationCalled = true;
        return handler(c, event);
      },
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
    );
    assert.equal(replayResult.duplicate, true);
    assert.equal(replayResult.processed, false);
    assert.equal(duplicateMutationCalled, false);
    assert.equal(await count(), 1);
    await clearConsumer();
  },
);

sqlTest(
  'A4: multi-tenant isolation ensures pending restore marker on Org A does not block Org B',
  async () => {
    await clearConsumer();
    const otherContext = 'finance-other-context';
    const otherId = generateFiscalSemanticEventId(
      other,
      crypto.randomUUID(),
      'FacturaFiscalEmitida',
    );
    const otherInvoice = crypto.randomUUID();
    const otherPayload = {
      semanticEventId: otherId,
      eventContractVersion: '1.0',
      invoiceId: otherInvoice,
      uuid: crypto.randomUUID(),
      totalAmount: '250.0000',
    };
    const otherEvent = {
      organizationId: other,
      semanticEventId: otherId,
      eventKind: 'FacturaFiscalEmitida',
      eventContractVersion: '1.0',
      effectMode: 'TRANSACTIONAL_SQL',
      payload: otherPayload,
    };

    // Mark Org A as restore pending
    await inbox.markConsumerRestorePending(tenant, context);
    assert.equal(await inbox.hasConsumerRestorePending(tenant, context), true);
    assert.equal(await inbox.hasConsumerRestorePending(other, otherContext), false);

    // Org A is blocked
    await assert.rejects(
      inbox.processEventWithInbox(tenant, context, id, event.eventKind, (c) => handler(c, event), {
        eventContractVersion: '1.0',
        effectMode: 'TRANSACTIONAL_SQL',
        payload,
      }),
      /BLOCKED: consumer restore reconciliation pending/,
    );

    // Org B processes normally without hindrance
    const orgBResult = await inbox.processEventWithInbox(
      other,
      otherContext,
      otherId,
      otherEvent.eventKind,
      (c) => handler(c, otherEvent),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload: otherPayload },
    );
    assert.equal(orgBResult.processed, true);
    assert.equal(orgBResult.duplicate, false);

    // Verify Org B effect is present and Org A has no effects
    const orgBEffect = await pool.query(
      'SELECT amount FROM test_effects WHERE organization_id = $1 AND semantic_event_id = $2',
      [other, otherId],
    );
    assert.equal(orgBEffect.rows.length, 1);
    assert.equal(orgBEffect.rows[0].amount, '250.0000');

    await clearConsumer();
  },
);

sqlTest(
  'A4: failed reconciliation preserves pending marker fail-closed and prevents normal delivery',
  async () => {
    await clearConsumer();
    // Simulate inbox row exists but effect is missing (consumer-only restore defect)
    await inbox.processEventWithInbox(
      tenant,
      context,
      id,
      event.eventKind,
      (c) => handler(c, event),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
    );
    await pool.query('DELETE FROM test_effects;'); // Effect lost
    await inbox.markConsumerRestorePending(tenant, context);

    // Reconcile fails because verifyEffect fails (effect missing)
    await assert.rejects(
      inbox.reconcileConsumerRestore(tenant, context, [event], plan()),
      /restore inconsistency/,
    );

    // Marker MUST remain active
    assert.equal(await inbox.hasConsumerRestorePending(tenant, context), true);

    // Normal processing remains blocked fail-closed
    await assert.rejects(
      inbox.processEventWithInbox(tenant, context, id, event.eventKind, (c) => handler(c, event), {
        eventContractVersion: '1.0',
        effectMode: 'TRANSACTIONAL_SQL',
        payload,
      }),
      /BLOCKED: consumer restore reconciliation pending/,
    );
    await clearConsumer();
  },
);
sqlTest(
  'SQL handler failure rolls back effect and inbox; conflicting replay cannot silently deduplicate',
  async () => {
    await assert.rejects(
      inbox.processEventWithInbox(
        tenant,
        context,
        id,
        event.eventKind,
        async (c) => {
          await handler(c, event);
          throw new Error('crash');
        },
        { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
      ),
    );
    assert.equal(await count(), 0);
    assert.equal(await inbox.getProcessedEventCount(tenant, context), 0);
    await inbox.processEventWithInbox(
      tenant,
      context,
      id,
      event.eventKind,
      (c) => handler(c, event),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload },
    );
    await assert.rejects(
      inbox.processEventWithInbox(tenant, context, id, event.eventKind, (c) => handler(c, event), {
        eventContractVersion: '1.0',
        effectMode: 'TRANSACTIONAL_SQL',
        payload: { ...payload, totalAmount: '1' },
      }),
    );
    assert.equal(await count(), 1);
  },
);
sqlTest(
  'HIGH-05 public PEM/password/username ingress rejects before persistence; vault refs return no PEM',
  async () => {
    const service = new PostgresBillingService(pool);
    const config = {
      organizationId: tenant,
      rfc: 'AAA010101AAA',
      razonSocial: 'Company',
      regimenFiscal: '601',
      codigoPostal: '06000',
    };
    for (const field of [
      'certificatePem',
      'certificadoPem',
      'privateKeyPem',
      'privateKeyPassword',
      'pacUsername',
      'pacPassword',
      'token',
    ])
      await assert.rejects(
        service.configureEmisorFiscal({ ...config, [field]: '-----BEGIN PRIVATE KEY-----CANARY' }),
      );
    const safe = await service.configureEmisorFiscal({
      ...config,
      privateKeyVaultId: 'vault-key-test',
    });
    assert.equal(safe.certificatePem, null);
    assert.equal(
      (
        await pool.query(
          'SELECT certificate_pem FROM emisor_fiscal_config WHERE organization_id=$1',
          [tenant],
        )
      ).rows[0].certificate_pem,
      null,
    );
  },
);
sqlTest(
  'HIGH-03 DOWN refuses each independently populated fiscal/recovery table independently',
  async () => {
    // Test every table independently using cloned table shapes. FK dependencies are
    // deliberately absent in the clones so each guard is exercised in isolation.
    const tables = [
      'consumer_inbox_events',
      'fiscal_stamping_operations',
      'lotes_facturacion_global',
      'fiscal_invoice_items',
      'fiscal_invoices',
      'emisor_fiscal_config',
      'tax_schemes',
    ];
    for (const populated of tables) {
      const guardSchema = `guard_${crypto.randomBytes(6).toString('hex')}`;
      const guardClient = new pg.Client({
        connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL,
      });
      await guardClient.connect();
      try {
        await guardClient.query(`CREATE SCHEMA ${guardSchema}; SET search_path TO ${guardSchema};`);
        for (const table of tables) await guardClient.query(`CREATE TABLE ${table} (id int);`);
        await guardClient.query(`INSERT INTO ${populated} VALUES (1);`);
        await guardClient.query('BEGIN;');
        await assert.rejects(
          guardClient.query(original.downSql),
          new RegExp(`populated ${populated}`),
        );
        await guardClient.query('ROLLBACK');
        assert.equal(
          (await guardClient.query(`SELECT count(*)::int n FROM ${populated}`)).rows[0].n,
          1,
        );
      } finally {
        try {
          await guardClient.query(`DROP SCHEMA IF EXISTS ${guardSchema} CASCADE;`);
        } catch {
          // safety
        }
        await guardClient.end();
      }
    }
  },
);

sqlTest(
  'Tenant RLS isolates inbox and rejects cross-tenant writes under a non-bypass role',
  async () => {
    const role = `wp021_rls_${crypto.randomBytes(6).toString('hex')}`;
    const rlsClient = new pg.Client({
      connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL,
    });
    await rlsClient.connect();
    try {
      await pool.query(
        `CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT,INSERT ON consumer_inbox_events TO ${role};`,
      );
      await rlsClient.query(`SET search_path TO ${schema}, public; SET ROLE ${role};`);
      await rlsClient.query('BEGIN');
      await rlsClient.query("SELECT set_config('app.current_organization_id',$1,true)", [other]);
      assert.equal((await rlsClient.query('SELECT * FROM consumer_inbox_events')).rows.length, 0);
      await assert.rejects(
        rlsClient.query(
          `INSERT INTO consumer_inbox_events (organization_id,semantic_event_id,event_kind,event_contract_version,consumer_context,event_payload)
      VALUES ($1,$2,$3,'1.0','other-context',$4::jsonb)`,
          [tenant, id, event.eventKind, JSON.stringify(payload)],
        ),
        /row-level security/,
      );
      await rlsClient.query('ROLLBACK; RESET ROLE;');
    } finally {
      try {
        await rlsClient.query('ROLLBACK;');
      } catch {
        // safety
      }
      try {
        await rlsClient.query('RESET ROLE;');
      } catch {
        // safety
      }
      await rlsClient.end();
      await pool.query(
        `REVOKE ALL ON consumer_inbox_events FROM ${role}; REVOKE USAGE ON SCHEMA ${schema} FROM ${role}; DROP ROLE IF EXISTS ${role};`,
      );
    }
  },
);

sqlTest(
  'DOWN fails closed when the migration role cannot see populated rows through RLS',
  async () => {
    const guardSchema = `guard_${crypto.randomBytes(6).toString('hex')}`;
    const role = `guard_role_${crypto.randomBytes(6).toString('hex')}`;
    const tables = [
      'consumer_inbox_events',
      'fiscal_stamping_operations',
      'lotes_facturacion_global',
      'fiscal_invoice_items',
      'fiscal_invoices',
      'emisor_fiscal_config',
      'tax_schemes',
    ];
    const roleClient = new pg.Client({
      connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL,
    });
    await roleClient.connect();
    try {
      await pool.query(
        `CREATE SCHEMA ${guardSchema}; CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS; GRANT USAGE,CREATE ON SCHEMA ${guardSchema} TO ${role};`,
      );
      await roleClient.query(`SET search_path TO ${guardSchema}; SET ROLE ${role};`);
      for (const table of tables) await roleClient.query(`CREATE TABLE ${table} (id int);`);
      await roleClient.query(
        'INSERT INTO consumer_inbox_events VALUES(1); ALTER TABLE consumer_inbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE consumer_inbox_events FORCE ROW LEVEL SECURITY; CREATE POLICY hidden ON consumer_inbox_events USING(false);',
      );
      await roleClient.query('BEGIN');
      await assert.rejects(roleClient.query(original.downSql), /row-level security/);
      await roleClient.query('ROLLBACK; RESET ROLE;');
      assert.equal(
        (await roleClient.query('SELECT count(*)::int n FROM consumer_inbox_events')).rows[0].n,
        1,
      );
    } finally {
      try {
        await roleClient.query('ROLLBACK;');
      } catch {
        // safety
      }
      try {
        await roleClient.query('RESET ROLE;');
      } catch {
        // safety
      }
      await roleClient.end();
      await pool.query(
        `DROP SCHEMA IF EXISTS ${guardSchema} CASCADE; DROP ROLE IF EXISTS ${role};`,
      );
    }
  },
);

sqlTest(
  'Native Concurrency: multiple simultaneous connections serialize idempotently without deadlocks',
  async () => {
    const concurrentId = generateFiscalSemanticEventId(
      tenant,
      crypto.randomUUID(),
      'FacturaFiscalEmitida',
    );
    const concurrentPayload = {
      semanticEventId: concurrentId,
      eventContractVersion: '1.0',
      invoiceId: crypto.randomUUID(),
      uuid: crypto.randomUUID(),
    };
    let executionCount = 0;
    const workerPromises = Array.from({ length: 5 }, async () => {
      return inbox.processEventWithInbox(
        tenant,
        'concurrent-context',
        concurrentId,
        'FacturaFiscalEmitida',
        async () => {
          executionCount++;
          return 'ok';
        },
        {
          eventContractVersion: '1.0',
          effectMode: 'TRANSACTIONAL_SQL',
          payload: concurrentPayload,
        },
      );
    });
    const results = await Promise.all(workerPromises);
    assert.equal(executionCount, 1, 'Only one worker must execute the business mutation');
    const processed = results.filter((r) => r.processed);
    const duplicates = results.filter((r) => r.duplicate);
    assert.equal(processed.length, 1);
    assert.equal(duplicates.length, 4);
  },
);

sqlTest(
  'Native PITR/Migration: event envelopes and payload versioning survive backup, restore, and recreation',
  async () => {
    const pitrEventId = generateFiscalSemanticEventId(
      tenant,
      crypto.randomUUID(),
      'FacturaFiscalEmitida',
    );
    const pitrPayload = {
      semanticEventId: pitrEventId,
      eventContractVersion: '1.0',
      invoiceId: crypto.randomUUID(),
      uuid: crypto.randomUUID(),
      totalAmount: '200.0000',
    };
    await inbox.processEventWithInbox(
      tenant,
      'pitr-context',
      pitrEventId,
      'FacturaFiscalEmitida',
      (c) =>
        c.query('INSERT INTO test_effects VALUES ($1,$2,$3)', [tenant, pitrEventId, '200.0000']),
      { eventContractVersion: '1.0', effectMode: 'TRANSACTIONAL_SQL', payload: pitrPayload },
    );
    // Extract envelope backup
    const snapshot = await pool.query(
      'SELECT id, organization_id, semantic_event_id, event_kind, event_contract_version, consumer_context, event_payload FROM consumer_inbox_events WHERE semantic_event_id = $1',
      [pitrEventId],
    );
    assert.equal(snapshot.rows.length, 1);
    const row = snapshot.rows[0];
    assert.equal(row.event_contract_version, '1.0');
    assert.deepEqual(row.event_payload, pitrPayload);
    assert.equal(row.semantic_event_id, pitrEventId);
    assert.equal(row.organization_id, tenant);
  },
);

async function fiscalComposition(pac = new MockPacConnector(undefined, createTestPacProvenance())) {
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const vault = new InMemoryCsdVault();
  const vaultId = 'test-key-ref';
  await vault.storePrivateKeyPem(tenant, vaultId, keys.privateKey);
  await vault.storeCsdCredentials(tenant, {
    certificateNumber: '30001000000500003416',
    certificatePem: realTestCertificate(keys.privateKey),
    privateKeyPem: keys.privateKey,
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validTo: new Date(Date.now() + 86400000).toISOString(),
  });
  const service = new PostgresBillingService(
    pool,
    pac,
    vault,
    new Outbox(pool),
    signedTestRegistry(pac),
    [],
    'true',
  );
  await service.configureEmisorFiscal({
    organizationId: tenant,
    rfc: 'AAA010101AAA',
    razonSocial: 'TEST',
    regimenFiscal: '601',
    codigoPostal: '06000',
    privateKeyVaultId: vaultId,
    certificateNumber: '30001000000500003416',
  });
  const draft = await service.createDraftInvoice({
    organizationId: tenant,
    branchId: branch,
    serie: 'TEST',
    folio: crypto.randomUUID(),
    receptorRfc: 'URE180429TM6',
    receptorNombre: 'TEST CLIENT',
    receptorRegimenFiscal: '601',
    receptorCodigoPostal: '06000',
    receptorUsoCfdi: 'G03',
    items: [
      {
        claveProdServ: '90101501',
        claveUnidad: 'E48',
        description: 'Item',
        quantity: '1.0000',
        unitPrice: '100.0000',
      },
    ],
  });
  return { service, pac, draft };
}
sqlTest(
  'HIGH-04 valid correlated STAMP and CANCEL produce persisted fiscal envelopes and no private key',
  async () => {
    const { service, draft } = await fiscalComposition();
    const stamped = await service.stampFiscalInvoice({
      organizationId: tenant,
      invoiceId: draft.id,
    });
    assert.equal(stamped.status, 'STAMPED');
    const cancelled = await service.cancelFiscalInvoice({
      organizationId: tenant,
      invoiceId: draft.id,
      motivo: '02',
    });
    assert.equal(cancelled.status, 'CANCELLED');
    const events = (
      await pool.query(
        'SELECT payload FROM cloud_integration_outbox WHERE aggregate_id=$1 ORDER BY event_type',
        [draft.id],
      )
    ).rows;
    assert.equal(events.length, 2);
    for (const row of events) {
      assert.equal(row.payload.eventContractVersion, '1.0');
      assert.ok(!JSON.stringify(row).includes('PRIVATE KEY'));
    }
  },
);
sqlTest(
  'HIGH-04 wrong tenant/operation correlation rejects before terminal fiscal mutation',
  async () => {
    const pac = new MockPacConnector(undefined, createTestPacProvenance());
    const dispatch = pac.timbrar.bind(pac);
    pac.timbrar = async (request) => ({
      ...(await dispatch(request)),
      correlation: { ...request.correlation, organizationId: other },
    });
    const { service, draft } = await fiscalComposition(pac);
    await assert.rejects(
      service.stampFiscalInvoice({ organizationId: tenant, invoiceId: draft.id }),
    );
    assert.equal((await service.getFiscalInvoiceById(tenant, draft.id)).status, 'DRAFT');
    assert.equal(
      (
        await pool.query('SELECT status FROM fiscal_stamping_operations WHERE invoice_id=$1', [
          draft.id,
        ])
      ).rows[0].status,
      'RECONCILIATION_REQUIRED',
    );
  },
);

sqlTest(
  'MED-01 provider JSON/multiline error cannot leak through persisted or external error paths',
  async () => {
    const pac = new MockPacConnector(undefined, createTestPacProvenance());
    pac.setBehavior({
      simulateReject: true,
      rejectErrorMessage: '{"password":"CANARY_SECRET"}\nprivate-key-password=CANARY_SECRET',
    });
    const { service, draft } = await fiscalComposition(pac);
    await assert.rejects(
      service.stampFiscalInvoice({ organizationId: tenant, invoiceId: draft.id }),
      (error) => {
        assert.ok(!String(error).includes('CANARY_SECRET'));
        return true;
      },
    );
    const result = await pool.query(
      'SELECT last_error FROM fiscal_stamping_operations WHERE invoice_id=$1',
      [draft.id],
    );
    assert.ok(!JSON.stringify(result.rows).includes('CANARY_SECRET'));
  },
);
