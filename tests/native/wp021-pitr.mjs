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

// Ensure PATH includes common PostgreSQL 16 locations (Linux package & Homebrew)
const extraPaths = [
  '/usr/lib/postgresql/16/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];
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

const requiredBinaries = ['initdb', 'pg_ctl', 'pg_basebackup', 'psql'];
const missingBinaries = requiredBinaries.filter((b) => !findBinary(b));

if (missingBinaries.length > 0) {
  if (process.env.REQUIRE_NATIVE_PG === '1') {
    console.error(
      `FATAL: Missing required PostgreSQL binaries for native PITR test (REQUIRE_NATIVE_PG=1): ${missingBinaries.join(', ')}`,
    );
    process.exit(1);
  }
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
  console.log('=== TRIDENTPOS WP-021 Physical PITR & Envelope Survivability Suite ===');
  const port = await getFreePort();
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp021-pitr-'));
  const dataDir = path.join(baseDir, 'data');
  const archiveDir = path.join(baseDir, 'wal_archive');
  const backupDir = path.join(baseDir, 'backup');
  const socketDir = path.join(baseDir, 'socket');

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true });

  console.log(`Initializing disposable PostgreSQL 16 cluster on port ${port}...`);
  execFileSync('initdb', ['-D', dataDir, '--no-sync', '-U', 'postgres', '-A', 'trust'], {
    stdio: 'pipe',
  });

  const configExtra = `
port = ${port}
listen_addresses = '127.0.0.1'
unix_socket_directories = '${socketDir}'
wal_level = replica
archive_mode = on
archive_command = 'cp "%p" "${archiveDir}/%f"'
archive_timeout = 2
max_wal_senders = 10
`;
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), configExtra);

  console.log('Starting cluster in archive mode...');
  execFileSync('pg_ctl', ['-D', dataDir, '-l', path.join(baseDir, 'server.log'), '-w', 'start'], {
    stdio: 'pipe',
  });

  const connString = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  const pool = new pg.Pool({ connectionString: connString });

  let client;
  try {
    // 1. Apply Monorepo Migrations Zero-to-Latest
    console.log('Applying migrations zero-to-latest...');
    const migrationsDir = path.resolve(rootDir, 'packages/database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    client = await pool.connect();
    await client.query(`
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

      await client.query('BEGIN;');
      await client.query(upSql);
      await client.query(
        'INSERT INTO _migrations (id, name, checksum, execution_order) VALUES ($1, $2, $3, $4);',
        [id, name, checksum, order++],
      );
      await client.query('COMMIT;');
    }
    console.log(`Applied ${files.length} migrations successfully.`);

    // 2. Populate Baseline Entities (Tenant A)
    console.log('Populating initial tenant baseline and stamped invoice...');
    const orgId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const taxId = `PITR${Date.now().toString().slice(-8)}`;

    await client.query(
      'INSERT INTO organizations (id, legal_name, trade_name, tax_id) VALUES ($1, $2, $3, $4);',
      [orgId, 'Tenant PITR Legal Name', 'Tenant PITR Trade Name', taxId],
    );
    await client.query(
      'INSERT INTO branches (id, organization_id, code, name) VALUES ($1, $2, $3, $4);',
      [branchId, orgId, 'B01', 'Main Branch'],
    );
    await client.query(
      `INSERT INTO tax_schemes (id, organization_id, code, name, rate, is_inclusive, tax_type)
       VALUES (gen_random_uuid(), $1, 'IVA16', 'IVA General 16%', 0.1600, true, 'IVA');`,
      [orgId],
    );
    await client.query(
      `INSERT INTO emisor_fiscal_config (id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal, is_active)
       VALUES (gen_random_uuid(), $1, 'PITR010101AAA', 'Emisor PITR SA de CV', '601', '06000', true);`,
      [orgId],
    );

    // Initial stamped invoice (pre-backup)
    const inv1Id = crypto.randomUUID();
    const inv1Uuid = crypto.randomUUID();
    const reqHash1 = crypto.createHash('sha256').update(`req-${inv1Id}`).digest('hex');
    const semanticId1 = generateFiscalSemanticEventId(orgId, inv1Id, 'FacturaFiscalEmitida');

    await client.query(
      `INSERT INTO fiscal_invoices (
         id, organization_id, branch_id, invoice_uuid, series, folio,
         customer_tax_id, customer_name, customer_regimen_fiscal, customer_postal_code,
         cfdi_use, payment_method, payment_way, subtotal, tax_total, total_amount,
         status, stamped_at, xml_payload, stamped_xml, cadena_original_hash, pac_request_reference_id
       ) VALUES ($1, $2, $3, $4, 'F', '1', 'XAXX010101000', 'Cliente Uno', '601', '06000', 'G03', 'PUE', '01', 100.0000, 16.0000, 116.0000, 'STAMPED', NOW(), '<xml>pre</xml>', '<xml><tfd:TimbreFiscalDigital/></xml>', 'hash_orig_1', 'pac_ref_1');`,
      [inv1Id, orgId, branchId, inv1Uuid],
    );

    const payload1 = {
      semanticEventId: semanticId1,
      eventContractVersion: '1.0',
      requestHash: reqHash1,
      invoiceId: inv1Id,
      uuid: inv1Uuid,
      totalAmount: '116.0000',
    };

    await client.query(
      `INSERT INTO fiscal_stamping_operations (
         id, organization_id, branch_id, invoice_id, operation_type, idempotency_key,
         request_hash, status, event_contract_version, semantic_event_id, event_payload, stamped_xml
       ) VALUES (gen_random_uuid(), $1, $2, $3, 'STAMP', $4, $5, 'SUCCEEDED', '1.0', $6, $7, '<xml><tfd:TimbreFiscalDigital/></xml>');`,
      [
        orgId,
        branchId,
        inv1Id,
        crypto.randomUUID(),
        reqHash1,
        semanticId1,
        JSON.stringify(payload1),
      ],
    );

    await client.query(
      `INSERT INTO cloud_integration_outbox (
         id, organization_id, branch_id, aggregate_type, aggregate_id, event_type,
         payload, status
       ) VALUES (gen_random_uuid(), $1, $2, 'FISCAL_INVOICE', $3, 'FacturaFiscalEmitida', $4, 'PUBLISHED');`,
      [orgId, branchId, inv1Id, JSON.stringify(payload1)],
    );

    await client.query(
      `INSERT INTO consumer_inbox_events (
         id, organization_id, consumer_context, semantic_event_id, event_kind,
         event_contract_version, event_payload
       ) VALUES (gen_random_uuid(), $1, 'finance-ap', $2, 'FacturaFiscalEmitida', '1.0', $3);`,
      [orgId, semanticId1, JSON.stringify(payload1)],
    );

    // Switch WAL to force archive
    await client.query('SELECT pg_switch_wal();');
    await sleep(500);

    // 3. Physical Base Backup
    console.log('Taking physical pg_basebackup...');
    execFileSync(
      'pg_basebackup',
      [
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        'postgres',
        '-D',
        backupDir,
        '-Fp',
        '-Xs',
        '-c',
        'fast',
      ],
      { stdio: 'pipe' },
    );
    console.log('Base backup created.');

    // 4. Pre-target writes (after basebackup, before recovery target time)
    console.log('Performing pre-target writes...');
    await sleep(200);

    const inv2Id = crypto.randomUUID();
    const inv2Uuid = crypto.randomUUID();
    const reqHash2 = crypto.createHash('sha256').update(`req-${inv2Id}`).digest('hex');
    const semanticId2 = generateFiscalSemanticEventId(orgId, inv2Id, 'FacturaFiscalEmitida');

    await client.query(
      `INSERT INTO fiscal_invoices (
         id, organization_id, branch_id, invoice_uuid, series, folio,
         customer_tax_id, customer_name, customer_regimen_fiscal, customer_postal_code,
         cfdi_use, payment_method, payment_way, subtotal, tax_total, total_amount,
         status, stamped_at, xml_payload, stamped_xml, cadena_original_hash, pac_request_reference_id
       ) VALUES ($1, $2, $3, $4, 'F', '2', 'XAXX010101000', 'Cliente Dos', '601', '06000', 'G03', 'PUE', '01', 200.0000, 32.0000, 232.0000, 'STAMPED', NOW(), '<xml>pre2</xml>', '<xml><tfd:TimbreFiscalDigital/></xml>', 'hash_orig_2', 'pac_ref_2');`,
      [inv2Id, orgId, branchId, inv2Uuid],
    );

    const payload2 = {
      semanticEventId: semanticId2,
      eventContractVersion: '1.0',
      requestHash: reqHash2,
      invoiceId: inv2Id,
      uuid: inv2Uuid,
      totalAmount: '232.0000',
    };

    await client.query(
      `INSERT INTO fiscal_stamping_operations (
         id, organization_id, branch_id, invoice_id, operation_type, idempotency_key,
         request_hash, status, event_contract_version, semantic_event_id, event_payload, stamped_xml
       ) VALUES (gen_random_uuid(), $1, $2, $3, 'STAMP', $4, $5, 'SUCCEEDED', '1.0', $6, $7, '<xml><tfd:TimbreFiscalDigital/></xml>');`,
      [
        orgId,
        branchId,
        inv2Id,
        crypto.randomUUID(),
        reqHash2,
        semanticId2,
        JSON.stringify(payload2),
      ],
    );

    await client.query(
      `INSERT INTO cloud_integration_outbox (
         id, organization_id, branch_id, aggregate_type, aggregate_id, event_type,
         payload, status
       ) VALUES (gen_random_uuid(), $1, $2, 'FISCAL_INVOICE', $3, 'FacturaFiscalEmitida', $4, 'PUBLISHED');`,
      [orgId, branchId, inv2Id, JSON.stringify(payload2)],
    );

    await client.query(
      `INSERT INTO consumer_inbox_events (
         id, organization_id, consumer_context, semantic_event_id, event_kind,
         event_contract_version, event_payload
       ) VALUES (gen_random_uuid(), $1, 'finance-ap', $2, 'FacturaFiscalEmitida', '1.0', $3);`,
      [orgId, semanticId2, JSON.stringify(payload2)],
    );

    await sleep(200);

    // 5. Note Recovery Target Time
    const timeRes = await client.query('SELECT clock_timestamp() AS ts;');
    const targetTimestamp = timeRes.rows[0].ts;
    const targetTimeFormatted = new Date(targetTimestamp)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '+00');
    console.log(`Recovery target time recorded: ${targetTimeFormatted}`);

    await sleep(500);

    // 6. Post-target writes (MUST NOT exist after PITR restore)
    console.log('Performing post-target writes...');
    const inv3Id = crypto.randomUUID();
    const inv3Uuid = crypto.randomUUID();
    const reqHash3 = crypto.createHash('sha256').update(`req-${inv3Id}`).digest('hex');
    const semanticId3 = generateFiscalSemanticEventId(orgId, inv3Id, 'FacturaFiscalEmitida');

    await client.query(
      `INSERT INTO fiscal_invoices (
         id, organization_id, branch_id, invoice_uuid, series, folio,
         customer_tax_id, customer_name, customer_regimen_fiscal, customer_postal_code,
         cfdi_use, payment_method, payment_way, subtotal, tax_total, total_amount,
         status, stamped_at, xml_payload, stamped_xml, cadena_original_hash, pac_request_reference_id
       ) VALUES ($1, $2, $3, $4, 'F', '3', 'XAXX010101000', 'Cliente Tres (Post-Target)', '601', '06000', 'G03', 'PUE', '01', 300.0000, 48.0000, 348.0000, 'STAMPED', NOW(), '<xml>post</xml>', '<xml><tfd:TimbreFiscalDigital/></xml>', 'hash_orig_3', 'pac_ref_3');`,
      [inv3Id, orgId, branchId, inv3Uuid],
    );

    const payload3 = {
      semanticEventId: semanticId3,
      eventContractVersion: '1.0',
      requestHash: reqHash3,
      invoiceId: inv3Id,
      uuid: inv3Uuid,
      totalAmount: '348.0000',
    };

    await client.query(
      `INSERT INTO fiscal_stamping_operations (
         id, organization_id, branch_id, invoice_id, operation_type, idempotency_key,
         request_hash, status, event_contract_version, semantic_event_id, event_payload, stamped_xml
       ) VALUES (gen_random_uuid(), $1, $2, $3, 'STAMP', $4, $5, 'SUCCEEDED', '1.0', $6, $7, '<xml><tfd:TimbreFiscalDigital/></xml>');`,
      [
        orgId,
        branchId,
        inv3Id,
        crypto.randomUUID(),
        reqHash3,
        semanticId3,
        JSON.stringify(payload3),
      ],
    );

    await client.query(
      `INSERT INTO cloud_integration_outbox (
         id, organization_id, branch_id, aggregate_type, aggregate_id, event_type,
         payload, status
       ) VALUES (gen_random_uuid(), $1, $2, 'FISCAL_INVOICE', $3, 'FacturaFiscalEmitida', $4, 'PUBLISHED');`,
      [orgId, branchId, inv3Id, JSON.stringify(payload3)],
    );

    await client.query(
      `INSERT INTO consumer_inbox_events (
         id, organization_id, consumer_context, semantic_event_id, event_kind,
         event_contract_version, event_payload
       ) VALUES (gen_random_uuid(), $1, 'finance-ap', $2, 'FacturaFiscalEmitida', '1.0', $3);`,
      [orgId, semanticId3, JSON.stringify(payload3)],
    );

    // Switch WAL to force archive of post-target records
    await client.query('SELECT pg_switch_wal();');
    await sleep(500);

    // 7. Stop Cluster
    console.log('Stopping active database cluster...');
    client.release();
    await pool.end();
    execFileSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'pipe' });

    // 8. Prepare PITR Restore
    console.log('Restoring from basebackup and applying PITR target time...');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.cpSync(backupDir, dataDir, { recursive: true });
    fs.chmodSync(dataDir, 0o700);

    // Configure recovery
    fs.writeFileSync(path.join(dataDir, 'recovery.signal'), '');
    const recoveryConfig = `
restore_command = 'cp "${archiveDir}/%f" "%p"'
recovery_target_time = '${targetTimeFormatted}'
recovery_target_action = 'promote'
`;
    fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), recoveryConfig);

    // 9. Start Restored Cluster
    console.log('Starting recovered cluster (WAL playback to target time)...');
    try {
      execFileSync(
        'pg_ctl',
        ['-D', dataDir, '-l', path.join(baseDir, 'server_restore.log'), '-w', 'start'],
        { stdio: 'pipe' },
      );
    } catch (err) {
      const logPath = path.join(baseDir, 'server_restore.log');
      if (fs.existsSync(logPath)) {
        console.error('=== server_restore.log ===\n' + fs.readFileSync(logPath, 'utf8'));
      }
      throw err;
    }

    // 10. Verify Assertions on Restored Cluster
    const restoredPool = new pg.Pool({ connectionString: connString });
    const checkClient = await restoredPool.connect();

    try {
      const logPath = path.join(baseDir, 'server_restore.log');
      if (fs.existsSync(logPath)) {
        console.log('=== server_restore.log ===\n' + fs.readFileSync(logPath, 'utf8'));
      }
      // Wait for recovery promotion to finish
      let promoted = false;
      for (let i = 0; i < 50; i++) {
        const recCheck = await checkClient.query('SELECT pg_is_in_recovery() AS in_rec;');
        if (recCheck.rows[0].in_rec === false) {
          promoted = true;
          break;
        }
        await sleep(100);
      }
      if (!promoted) {
        throw new Error('Database is still in recovery; promotion timed out.');
      }
      console.log('Database successfully recovered and promoted.');

      // Assertion 1: Pre-backup Invoice 1 exists with intact envelope, version, request hash
      const inv1Res = await checkClient.query(
        'SELECT folio, total_amount, status FROM fiscal_invoices WHERE id = $1;',
        [inv1Id],
      );
      if (inv1Res.rows.length !== 1 || inv1Res.rows[0].folio !== '1') {
        throw new Error('Assertion failed: Pre-backup invoice 1 missing or corrupted after PITR.');
      }

      const stamp1Res = await checkClient.query(
        'SELECT request_hash, status, event_contract_version, event_payload FROM fiscal_stamping_operations WHERE invoice_id = $1;',
        [inv1Id],
      );
      if (
        stamp1Res.rows.length !== 1 ||
        stamp1Res.rows[0].request_hash !== reqHash1 ||
        stamp1Res.rows[0].event_contract_version !== '1.0' ||
        stamp1Res.rows[0].event_payload?.semanticEventId !== semanticId1
      ) {
        throw new Error(
          'Assertion failed: Stamping op 1 request_hash or version missing or mismatched.',
        );
      }

      const out1Res = await checkClient.query(
        'SELECT payload FROM cloud_integration_outbox WHERE aggregate_id = $1;',
        [inv1Id],
      );
      if (
        out1Res.rows.length !== 1 ||
        out1Res.rows[0].payload?.eventContractVersion !== '1.0' ||
        out1Res.rows[0].payload?.requestHash !== reqHash1 ||
        out1Res.rows[0].payload?.semanticEventId !== semanticId1
      ) {
        throw new Error('Assertion failed: Outbox 1 contract version or request_hash mismatched.');
      }

      const in1Res = await checkClient.query(
        'SELECT event_contract_version, semantic_event_id, event_payload FROM consumer_inbox_events WHERE semantic_event_id = $1;',
        [semanticId1],
      );
      if (
        in1Res.rows.length !== 1 ||
        in1Res.rows[0].event_contract_version !== '1.0' ||
        in1Res.rows[0].event_payload?.requestHash !== reqHash1
      ) {
        throw new Error('Assertion failed: Consumer inbox 1 event_contract_version mismatched.');
      }

      // Assertion 2: Pre-target Invoice 2 exists with intact envelope, version, request hash
      const inv2Res = await checkClient.query(
        'SELECT folio, total_amount, status FROM fiscal_invoices WHERE id = $1;',
        [inv2Id],
      );
      if (inv2Res.rows.length !== 1 || inv2Res.rows[0].folio !== '2') {
        throw new Error('Assertion failed: Pre-target invoice 2 missing or corrupted after PITR.');
      }

      const stamp2Res = await checkClient.query(
        'SELECT request_hash, status, event_contract_version, event_payload FROM fiscal_stamping_operations WHERE invoice_id = $1;',
        [inv2Id],
      );
      if (
        stamp2Res.rows.length !== 1 ||
        stamp2Res.rows[0].request_hash !== reqHash2 ||
        stamp2Res.rows[0].event_contract_version !== '1.0' ||
        stamp2Res.rows[0].event_payload?.semanticEventId !== semanticId2
      ) {
        throw new Error(
          'Assertion failed: Stamping op 2 request_hash or version missing or mismatched.',
        );
      }

      const out2Res = await checkClient.query(
        'SELECT payload FROM cloud_integration_outbox WHERE aggregate_id = $1;',
        [inv2Id],
      );
      if (
        out2Res.rows.length !== 1 ||
        out2Res.rows[0].payload?.eventContractVersion !== '1.0' ||
        out2Res.rows[0].payload?.requestHash !== reqHash2 ||
        out2Res.rows[0].payload?.semanticEventId !== semanticId2
      ) {
        throw new Error('Assertion failed: Outbox 2 contract version or request_hash mismatched.');
      }

      const in2Res = await checkClient.query(
        'SELECT event_contract_version, semantic_event_id, event_payload FROM consumer_inbox_events WHERE semantic_event_id = $1;',
        [semanticId2],
      );
      if (
        in2Res.rows.length !== 1 ||
        in2Res.rows[0].event_contract_version !== '1.0' ||
        in2Res.rows[0].event_payload?.requestHash !== reqHash2
      ) {
        throw new Error('Assertion failed: Consumer inbox 2 event_contract_version mismatched.');
      }

      // Assertion 3: Post-target writes strictly DO NOT EXIST
      const inv3Res = await checkClient.query('SELECT id FROM fiscal_invoices WHERE id = $1;', [
        inv3Id,
      ]);
      if (inv3Res.rows.length > 0) {
        throw new Error('Assertion failed: Post-target invoice 3 leaked into PITR restored state!');
      }

      const stamp3Res = await checkClient.query(
        'SELECT id FROM fiscal_stamping_operations WHERE invoice_id = $1;',
        [inv3Id],
      );
      if (stamp3Res.rows.length > 0) {
        throw new Error(
          'Assertion failed: Post-target stamping op leaked into PITR restored state!',
        );
      }

      const out3Res = await checkClient.query(
        'SELECT id FROM cloud_integration_outbox WHERE aggregate_id = $1;',
        [inv3Id],
      );
      if (out3Res.rows.length > 0) {
        throw new Error(
          'Assertion failed: Post-target outbox event leaked into PITR restored state!',
        );
      }

      const in3Res = await checkClient.query(
        'SELECT id FROM consumer_inbox_events WHERE semantic_event_id = $1;',
        [semanticId3],
      );
      if (in3Res.rows.length > 0) {
        throw new Error(
          'Assertion failed: Post-target consumer inbox event leaked into PITR restored state!',
        );
      }

      console.log('SUCCESS: All 8 PITR physical assertions PASSED.');
      console.log('  ✔ Pre-backup envelope, version (1.0), and request hash preserved');
      console.log(
        '  ✔ Pre-target envelope, version (1.0), and request hash preserved via WAL replay',
      );
      console.log('  ✔ Post-target writes strictly absent');
      console.log('  ✔ Read-write promotion verified');
    } finally {
      checkClient.release();
      await restoredPool.end();
      execFileSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    }
  } finally {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

run()
  .then(() => {
    console.log('TRIDENTPOS WP-021 Physical PITR Test: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('TRIDENTPOS WP-021 Physical PITR Test: FAIL', err);
    process.exit(1);
  });
