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
  pool.query('DELETE FROM test_effects; DELETE FROM consumer_inbox_events;');
before(async () => {
  if (!enabled) return;
  if (process.env.WP021_TEST_DATABASE_ADAPTER)
    pool = await (await import(process.env.WP021_TEST_DATABASE_ADAPTER)).createPool();
  else
    pool = new pg.Pool({ connectionString: process.env.WP021_SECURITY_TEST_DATABASE_URL, max: 1 });
  await pool.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE branches (id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), UNIQUE(organization_id,id));
    CREATE FUNCTION current_app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_organization_id', true),'')::uuid $$;
    CREATE TABLE test_effects (organization_id uuid NOT NULL, semantic_event_id text NOT NULL, amount numeric NOT NULL, PRIMARY KEY(organization_id, semantic_event_id));`);
  await pool.query('INSERT INTO organizations VALUES ($1),($2);', [tenant, other]);
  await pool.query('INSERT INTO branches VALUES ($1,$2);', [branch, tenant]);
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
  client = await pool.connect();
});
after(async () => {
  if (!pool) return;
  client?.release();
  await pool.query(`DROP SCHEMA ${schema} CASCADE;`);
  await pool.end();
});

// Pool max=1: release borrowed client before service-owned transactions.
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
      new Outbox(),
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
      await pool.query(`CREATE SCHEMA ${guardSchema}; SET search_path TO ${guardSchema};`);
      for (const table of tables) await pool.query(`CREATE TABLE ${table} (id int);`);
      await pool.query(`INSERT INTO ${populated} VALUES (1);`);
      await pool.query('BEGIN;');
      await assert.rejects(pool.query(original.downSql), new RegExp(`populated ${populated}`));
      await pool.query('ROLLBACK');
      assert.equal((await pool.query(`SELECT count(*)::int n FROM ${populated}`)).rows[0].n, 1);
      await pool.query(`SET search_path TO ${schema}; DROP SCHEMA ${guardSchema} CASCADE;`);
    }
  },
);

sqlTest(
  'Tenant RLS isolates inbox and rejects cross-tenant writes under a non-bypass role',
  async () => {
    const role = `wp021_rls_${crypto.randomBytes(6).toString('hex')}`;
    await pool.query(
      `CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT,INSERT ON consumer_inbox_events TO ${role};`,
    );
    try {
      await pool.query(`SET ROLE ${role};`);
      await pool.query('BEGIN');
      await pool.query("SELECT set_config('app.current_organization_id',$1,true)", [other]);
      assert.equal((await pool.query('SELECT * FROM consumer_inbox_events')).rows.length, 0);
      await assert.rejects(
        pool.query(
          `INSERT INTO consumer_inbox_events (organization_id,semantic_event_id,event_kind,event_contract_version,consumer_context,event_payload)
      VALUES ($1,$2,$3,'1.0','other-context',$4::jsonb)`,
          [tenant, id, event.eventKind, JSON.stringify(payload)],
        ),
        /row-level security/,
      );
      await pool.query('ROLLBACK; RESET ROLE;');
    } finally {
      await pool.query(
        `ROLLBACK; RESET ROLE; REVOKE ALL ON consumer_inbox_events FROM ${role}; REVOKE USAGE ON SCHEMA ${schema} FROM ${role}; DROP ROLE ${role};`,
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
    await pool.query(
      `CREATE SCHEMA ${guardSchema}; CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS; GRANT USAGE,CREATE ON SCHEMA ${guardSchema} TO ${role}; SET search_path TO ${guardSchema}; SET ROLE ${role};`,
    );
    try {
      for (const table of tables) await pool.query(`CREATE TABLE ${table} (id int);`);
      await pool.query(
        'INSERT INTO consumer_inbox_events VALUES(1); ALTER TABLE consumer_inbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE consumer_inbox_events FORCE ROW LEVEL SECURITY; CREATE POLICY hidden ON consumer_inbox_events USING(false);',
      );
      await pool.query('BEGIN');
      await assert.rejects(pool.query(original.downSql), /row-level security/);
      await pool.query('ROLLBACK; RESET ROLE;');
      assert.equal(
        (await pool.query('SELECT count(*)::int n FROM consumer_inbox_events')).rows[0].n,
        1,
      );
    } finally {
      await pool.query(
        `ROLLBACK; RESET ROLE; SET search_path TO ${schema}; DROP SCHEMA ${guardSchema} CASCADE; DROP ROLE ${role};`,
      );
    }
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
    undefined,
    signedTestRegistry(pac),
    [],
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
