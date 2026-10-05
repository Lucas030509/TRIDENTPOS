import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

// Ensure PATH includes Homebrew binaries
const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
for (const p of extraPaths) {
  if (fs.existsSync(p) && !process.env.PATH?.includes(p)) {
    process.env.PATH = `${p}:${process.env.PATH || ''}`;
  }
}

function findBinary(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // Continue
      }
    }
  }
  return null;
}

const requiredBinaries = ['initdb', 'pg_ctl', 'psql'];
const missingBinaries = requiredBinaries.filter((b) => !findBinary(b));

if (missingBinaries.length > 0) {
  console.log(`NOT EXECUTED: Missing required PostgreSQL binaries: ${missingBinaries.join(', ')}`);
  process.exit(0);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateFiscalSemanticEventId(organizationId, invoiceId, eventKind) {
  const digest = crypto
    .createHash('sha256')
    .update(`${organizationId}:${invoiceId}:${eventKind}`)
    .digest('hex')
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function run() {
  console.log('=== TRIDENTPOS WP-021 Native Concurrency & Multi-Connection DOWN Guard Suite ===');
  const port = await getFreePort();
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp021-concurrency-'));
  const dataDir = path.join(baseDir, 'data');
  const socketDir = path.join(baseDir, 'socket');

  fs.mkdirSync(socketDir, { recursive: true });

  console.log(`Initializing disposable PostgreSQL 16 cluster on port ${port}...`);
  execFileSync('initdb', ['-D', dataDir, '--no-sync', '-U', 'postgres', '-A', 'trust'], {
    stdio: 'pipe',
  });

  const configExtra = `
port = ${port}
listen_addresses = '127.0.0.1'
unix_socket_directories = '${socketDir}'
max_connections = 50
`;
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), configExtra);

  console.log('Starting cluster...');
  execFileSync('pg_ctl', ['-D', dataDir, '-l', path.join(baseDir, 'server.log'), '-w', 'start'], {
    stdio: 'pipe',
  });

  const adminConnString = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  const adminPool = new pg.Pool({ connectionString: adminConnString });

  try {
    const adminClient = await adminPool.connect();

    // 1. Apply Monorepo Migrations Zero-to-Latest
    console.log('Applying migrations zero-to-latest...');
    const migrationsDir = path.resolve(rootDir, 'packages/database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    await adminClient.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL,
        execution_order INT NOT NULL
      );
    `);

    let order = 1;
    for (const file of files) {
      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const parts = sqlContent.split(/^--\s*Down/m);
      const upSql = parts[0].replace(/^--\s*Up/m, '').trim();
      const id = file.slice(0, 14);
      const name = file.slice(15).replace(/\.sql$/, '');
      const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

      await adminClient.query('BEGIN;');
      await adminClient.query(upSql);
      await adminClient.query(
        'INSERT INTO _migrations (id, name, checksum, execution_order) VALUES ($1, $2, $3, $4);',
        [id, name, checksum, order++],
      );
      await adminClient.query('COMMIT;');
    }
    console.log(`Applied ${files.length} migrations successfully.`);

    // 2. Create non-superuser migration role with RLS enforcement
    console.log('Creating trident_migration_role (NOSUPERUSER, NOBYPASSRLS)...');
    await adminClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trident_migration_role') THEN
          CREATE ROLE trident_migration_role WITH LOGIN PASSWORD 'trident_migration_pw' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE postgres TO trident_migration_role;
      GRANT USAGE ON SCHEMA public TO trident_migration_role;
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO trident_migration_role;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO trident_migration_role;
    `);

    // 3. Create Tenants A and B
    console.log('Setting up Tenant A and Tenant B...');
    const orgAId = crypto.randomUUID();
    const branchAId = crypto.randomUUID();
    const orgBId = crypto.randomUUID();
    const branchBId = crypto.randomUUID();

    await adminClient.query(
      'INSERT INTO organizations (id, legal_name, trade_name, tax_id) VALUES ($1, $2, $3, $4);',
      [orgAId, 'Tenant A Corp', 'Tenant A Trade', `TXA${Date.now().toString().slice(-8)}`],
    );
    await adminClient.query(
      'INSERT INTO branches (id, organization_id, code, name) VALUES ($1, $2, $3, $4);',
      [branchAId, orgAId, 'A01', 'Branch A'],
    );
    await adminClient.query(
      `INSERT INTO tax_schemes (id, organization_id, code, name, rate, is_inclusive, tax_type)
       VALUES (gen_random_uuid(), $1, 'IVA16', 'IVA General 16%', 0.1600, true, 'IVA');`,
      [orgAId],
    );
    await adminClient.query(
      `INSERT INTO emisor_fiscal_config (id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal, is_active)
       VALUES (gen_random_uuid(), $1, 'ORGA010101AAA', 'Emisor A SA de CV', '601', '06000', true);`,
      [orgAId],
    );

    await adminClient.query(
      'INSERT INTO organizations (id, legal_name, trade_name, tax_id) VALUES ($1, $2, $3, $4);',
      [orgBId, 'Tenant B Corp', 'Tenant B Trade', `TXB${Date.now().toString().slice(-8)}`],
    );
    await adminClient.query(
      'INSERT INTO branches (id, organization_id, code, name) VALUES ($1, $2, $3, $4);',
      [branchBId, orgBId, 'B01', 'Branch B'],
    );
    await adminClient.query(
      `INSERT INTO tax_schemes (id, organization_id, code, name, rate, is_inclusive, tax_type)
       VALUES (gen_random_uuid(), $1, 'IVA16', 'IVA General 16%', 0.1600, true, 'IVA');`,
      [orgBId],
    );
    await adminClient.query(
      `INSERT INTO emisor_fiscal_config (id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal, is_active)
       VALUES (gen_random_uuid(), $1, 'ORGB010101BBB', 'Emisor B SA de CV', '601', '06000', true);`,
      [orgBId],
    );

    // Populate initial fiscal records for Tenant B (hidden from Tenant A via RLS)
    const invB1Id = crypto.randomUUID();
    const invB1Uuid = crypto.randomUUID();
    const reqHashB1 = crypto.createHash('sha256').update(`req-${invB1Id}`).digest('hex');
    const semanticIdB1 = generateFiscalSemanticEventId(orgBId, invB1Id, 'FacturaFiscalEmitida');

    await adminClient.query(
      `INSERT INTO fiscal_invoices (
         id, organization_id, branch_id, invoice_uuid, series, folio,
         customer_tax_id, customer_name, customer_regimen_fiscal, customer_postal_code,
         cfdi_use, payment_method, payment_way, subtotal, tax_total, total_amount,
         status, stamped_at, xml_payload, stamped_xml, cadena_original_hash, pac_request_reference_id
       ) VALUES ($1, $2, $3, $4, 'FB', '1', 'XAXX010101000', 'Cliente B', '601', '06000', 'G03', 'PUE', '01', 500.0000, 80.0000, 580.0000, 'STAMPED', NOW(), '<xml>b</xml>', '<xml><tfd:TimbreFiscalDigital/></xml>', 'hash_orig_b1', 'pac_ref_b1');`,
      [invB1Id, orgBId, branchBId, invB1Uuid],
    );

    const payloadB1 = {
      semanticEventId: semanticIdB1,
      eventContractVersion: '1.0',
      requestHash: reqHashB1,
      invoiceId: invB1Id,
      uuid: invB1Uuid,
      totalAmount: '580.0000',
    };

    await adminClient.query(
      `INSERT INTO fiscal_stamping_operations (
         id, organization_id, branch_id, invoice_id, operation_type, idempotency_key,
         request_hash, status, event_contract_version, semantic_event_id, event_payload, stamped_xml
       ) VALUES (gen_random_uuid(), $1, $2, $3, 'STAMP', $4, $5, 'SUCCEEDED', '1.0', $6, $7, '<xml><tfd:TimbreFiscalDigital/></xml>');`,
      [
        orgBId,
        branchBId,
        invB1Id,
        crypto.randomUUID(),
        reqHashB1,
        semanticIdB1,
        JSON.stringify(payloadB1),
      ],
    );

    await adminClient.query(
      `INSERT INTO consumer_inbox_events (
         id, organization_id, consumer_context, semantic_event_id, event_kind,
         event_contract_version, event_payload
       ) VALUES (gen_random_uuid(), $1, 'finance-ap', $2, 'FacturaFiscalEmitida', '1.0', $3);`,
      [orgBId, semanticIdB1, JSON.stringify(payloadB1)],
    );

    adminClient.release();

    // 4. Concurrency Test Setup:
    // Connection 1 (Writer): App Connection under Tenant A continuously inserting fiscal invoices & operations.
    // Connection 2 (Migration Runner): Role `trident_migration_role` executing DOWN migration guard.
    console.log('Initiating concurrent writer connection & migration DOWN guard connection...');

    const appPool = new pg.Pool({ connectionString: adminConnString });
    const migrationConnString = `postgresql://trident_migration_role:trident_migration_pw@127.0.0.1:${port}/postgres`;
    const migrationPool = new pg.Pool({ connectionString: migrationConnString });

    let stopWriter = false;
    let writerInserts = 0;
    let writerErrors = 0;

    const writerPromise = (async () => {
      const client = await appPool.connect();
      try {
        await client.query(`SET LOCAL "app.current_organization_id" = '${orgAId}';`);
        let folio = 100;
        while (!stopWriter) {
          try {
            const invId = crypto.randomUUID();
            const invUuid = crypto.randomUUID();
            const reqHash = crypto.createHash('sha256').update(`req-A-${invId}`).digest('hex');
            const semanticId = generateFiscalSemanticEventId(orgAId, invId, 'FacturaFiscalEmitida');

            await client.query('BEGIN;');
            await client.query(`SET LOCAL "app.current_organization_id" = '${orgAId}';`);

            await client.query(
              `INSERT INTO fiscal_invoices (
                 id, organization_id, branch_id, invoice_uuid, series, folio,
                 customer_tax_id, customer_name, customer_regimen_fiscal, customer_postal_code,
                 cfdi_use, payment_method, payment_way, subtotal, tax_total, total_amount,
                 status, stamped_at, xml_payload, stamped_xml, cadena_original_hash, pac_request_reference_id
               ) VALUES ($1, $2, $3, $4, 'FA', $5, 'XAXX010101000', 'Cliente A Concurrente', '601', '06000', 'G03', 'PUE', '01', 100.0000, 16.0000, 116.0000, 'STAMPED', NOW(), '<xml>conc</xml>', '<xml><tfd:TimbreFiscalDigital/></xml>', 'hash_conc', 'pac_conc');`,
              [invId, orgAId, branchAId, invUuid, String(folio++)],
            );

            const payload = {
              semanticEventId: semanticId,
              eventContractVersion: '1.0',
              requestHash: reqHash,
              invoiceId: invId,
              uuid: invUuid,
              totalAmount: '116.0000',
            };

            await client.query(
              `INSERT INTO fiscal_stamping_operations (
                 id, organization_id, branch_id, invoice_id, operation_type, idempotency_key,
                 request_hash, status, event_contract_version, semantic_event_id, event_payload, stamped_xml
               ) VALUES (gen_random_uuid(), $1, $2, $3, 'STAMP', $4, $5, 'SUCCEEDED', '1.0', $6, $7, '<xml><tfd:TimbreFiscalDigital/></xml>');`,
              [
                orgAId,
                branchAId,
                invId,
                crypto.randomUUID(),
                reqHash,
                semanticId,
                JSON.stringify(payload),
              ],
            );

            await client.query(
              `INSERT INTO consumer_inbox_events (
                 id, organization_id, consumer_context, semantic_event_id, event_kind,
                 event_contract_version, event_payload
               ) VALUES (gen_random_uuid(), $1, 'finance-ap', $2, 'FacturaFiscalEmitida', '1.0', $3);`,
              [orgAId, semanticId, JSON.stringify(payload)],
            );

            await client.query('COMMIT;');
            writerInserts++;
          } catch (err) {
            await client.query('ROLLBACK;').catch(() => {});
            writerErrors++;
          }
          await sleep(50);
        }
      } finally {
        client.release();
      }
    })();

    // Allow writer to execute some inserts
    await sleep(200);

    // Connection 2: Attempt DOWN migration guard under trident_migration_role
    console.log(
      'Running DOWN migration guard under migration role concurrent with active writer...',
    );
    const migClient = await migrationPool.connect();
    let downMigrationRoleRejected = false;
    let rejectionRoleError = null;

    try {
      const downSql = `
        SET LOCAL row_security = off;
        LOCK TABLE consumer_inbox_events IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE fiscal_stamping_operations IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE lotes_facturacion_global IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE fiscal_invoice_items IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE fiscal_invoices IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE emisor_fiscal_config IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE tax_schemes IN ACCESS EXCLUSIVE MODE;
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM consumer_inbox_events) THEN
                RAISE EXCEPTION 'FAIL_CLOSED: populated consumer_inbox_events; fiscal/recovery truth must not be destroyed';
            END IF;
            IF EXISTS (SELECT 1 FROM fiscal_stamping_operations) THEN
                RAISE EXCEPTION 'FAIL_CLOSED: populated fiscal_stamping_operations; fiscal/recovery truth must not be destroyed';
            END IF;
        END $$;
      `;

      await migClient.query('BEGIN;');
      await migClient.query(downSql);
      await migClient.query('COMMIT;');
    } catch (err) {
      await migClient.query('ROLLBACK;').catch(() => {});
      downMigrationRoleRejected = true;
      rejectionRoleError = err;
    } finally {
      migClient.release();
    }

    // Stop writer and wait for completion
    stopWriter = true;
    await writerPromise;

    await appPool.end();
    await migrationPool.end();

    console.log(
      `Writer completed: ${writerInserts} successful transactions, ${writerErrors} transient lockwaits.`,
    );

    // 5. Verification: DOWN Guard under superuser as well (testing explicit FAIL_CLOSED exception)
    console.log('Running DOWN migration guard under superuser on populated tables...');
    const suClient = await adminPool.connect();
    let superuserDownRejected = false;
    let rejectionSuError = null;
    try {
      const downSql = `
        SET LOCAL row_security = off;
        LOCK TABLE consumer_inbox_events IN ACCESS EXCLUSIVE MODE;
        LOCK TABLE fiscal_stamping_operations IN ACCESS EXCLUSIVE MODE;
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM consumer_inbox_events) THEN
                RAISE EXCEPTION 'FAIL_CLOSED: populated consumer_inbox_events; fiscal/recovery truth must not be destroyed';
            END IF;
            IF EXISTS (SELECT 1 FROM fiscal_stamping_operations) THEN
                RAISE EXCEPTION 'FAIL_CLOSED: populated fiscal_stamping_operations; fiscal/recovery truth must not be destroyed';
            END IF;
        END $$;
      `;
      await suClient.query('BEGIN;');
      await suClient.query(downSql);
      await suClient.query('COMMIT;');
    } catch (err) {
      await suClient.query('ROLLBACK;').catch(() => {});
      superuserDownRejected = true;
      rejectionSuError = err;
    } finally {
      suClient.release();
    }

    // 6. Verification & Assertions
    if (!downMigrationRoleRejected) {
      throw new Error(
        'Assertion failed: DOWN migration guard SUCCEEDED under trident_migration_role on populated fiscal tables.',
      );
    }
    console.log(`✔ Migration role DOWN rejected: "${rejectionRoleError?.message}"`);

    if (!superuserDownRejected || !rejectionSuError?.message?.includes('FAIL_CLOSED: populated')) {
      throw new Error(
        `Assertion failed: Superuser DOWN guard did not throw FAIL_CLOSED exception: ${rejectionSuError?.message}`,
      );
    }
    console.log(`✔ Superuser DOWN rejected: "${rejectionSuError?.message}"`);

    // Verify data integrity across both tenants from superuser connection
    const checkClient = await adminPool.connect();
    try {
      const invCountRes = await checkClient.query(
        'SELECT COUNT(*)::int AS count FROM fiscal_invoices;',
      );
      const stampCountRes = await checkClient.query(
        'SELECT COUNT(*)::int AS count FROM fiscal_stamping_operations;',
      );
      const inboxCountRes = await checkClient.query(
        'SELECT COUNT(*)::int AS count FROM consumer_inbox_events;',
      );

      const totalInvoices = invCountRes.rows[0].count;
      const totalStamps = stampCountRes.rows[0].count;
      const totalInbox = inboxCountRes.rows[0].count;

      console.log(
        `Verified counts in database: Invoices=${totalInvoices}, StampingOps=${totalStamps}, InboxEvents=${totalInbox}`,
      );

      // Tenant B check (RLS hidden from Tenant A, must remain 100% intact)
      const tenantBInv = await checkClient.query(
        'SELECT * FROM fiscal_invoices WHERE organization_id = $1;',
        [orgBId],
      );
      const tenantBStamp = await checkClient.query(
        'SELECT * FROM fiscal_stamping_operations WHERE organization_id = $1;',
        [orgBId],
      );
      const tenantBInbox = await checkClient.query(
        'SELECT * FROM consumer_inbox_events WHERE organization_id = $1;',
        [orgBId],
      );

      if (
        tenantBInv.rows.length !== 1 ||
        tenantBStamp.rows.length !== 1 ||
        tenantBInbox.rows.length !== 1
      ) {
        throw new Error(
          'Assertion failed: Tenant B fiscal data lost or altered during concurrent DOWN guard execution.',
        );
      }
      console.log('✔ Tenant B data (cross-tenant RLS rows) preserved intact.');

      // Tenant A check
      const tenantAInv = await checkClient.query(
        'SELECT COUNT(*)::int AS count FROM fiscal_invoices WHERE organization_id = $1;',
        [orgAId],
      );
      if (tenantAInv.rows[0].count !== writerInserts) {
        throw new Error(
          `Assertion failed: Tenant A invoice count (${tenantAInv.rows[0].count}) does not match committed writer inserts (${writerInserts}).`,
        );
      }
      console.log(
        `✔ Tenant A committed transactions (${writerInserts}) preserved without data loss.`,
      );

      // Verify no orphaned stamping operations or inbox events
      if (totalInvoices !== totalStamps || totalInvoices !== totalInbox) {
        throw new Error(
          `Assertion failed: Mismatch across fiscal tables: Invoices=${totalInvoices}, Stamps=${totalStamps}, Inbox=${totalInbox}`,
        );
      }
      console.log(
        '✔ Fiscal table referential integrity and envelope invariants preserved across all concurrent operations.',
      );

      console.log('SUCCESS: All native concurrency & DOWN guard assertions PASSED.');
    } finally {
      checkClient.release();
    }
  } finally {
    await adminPool.end();
    try {
      execFileSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    } catch {
      // Ignore stop error
    }
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

run()
  .then(() => {
    console.log('TRIDENTPOS WP-021 Native Concurrency Test: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('TRIDENTPOS WP-021 Native Concurrency Test: FAIL', err);
    process.exit(1);
  });
