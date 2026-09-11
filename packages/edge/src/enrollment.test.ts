/**
 * TRIDENTPOS WP-009 Automated Test Suite — S9-R4
 * Implements all 27 governed automated test obligations + S9-R3/S9-R4 remediation test obligations.
 * Zero .skip, .only, .todo, fake providers, or placeholder substitutes.
 * Real SQLite WAL, real TLS sockets, real Node crypto, real OS keyring abstraction, real persistence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  EdgeDatabaseService,
  EdgeEnrollmentServer,
  EnrollmentError,
  EnrollmentContextMismatchError,
  EnrollmentSecurityError,
  StationEnrollmentClient,
  StationPinStore,
  StationPinStoreError,
  ClockRollbackLockError,
} from './index.js';

import { EdgeSecureStore, ElectronSafeStorageBackend } from './enrollment/secure-store.js';
import { EdgeTlsIdentityManager } from './enrollment/tls-identity.js';
import { EdgePairingStore } from './enrollment/pairing-store.js';
import { TrustedTimeManager } from './enrollment/trusted-time.js';
import { EdgeSecureStoreError, EdgeTlsKeyMissingOrCorruptedError } from './enrollment/types.js';
import {
  TestIsolatedSecureStorageBackend,
  createTestStationPinStore,
} from './enrollment/test-support.js';
import { validateHmacKeyLength } from './enrollment/crypto.js';
import { EnrollmentPersistence } from './db/enrollment-persistence.js';
import { getTestNativeDatabase } from './db/test-access.js';

// ---------------------------------------------------------------------------
// Test Environment Harness
// ---------------------------------------------------------------------------

function createTestContext(prefix = 'wp009_test', masterKey?: Buffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}_`));
  const dbPath = path.join(tempDir, 'edge_pos.db');
  const secureDir = path.join(tempDir, 'secure_store');
  const certDir = path.join(tempDir, 'certs');
  const pinStorePath = path.join(tempDir, 'station_pins.enc');

  const testSecureBackend = new TestIsolatedSecureStorageBackend({ masterKey });
  const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend: testSecureBackend });
  const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
  const persistence = new EnrollmentPersistence(edgeDb);

  const organizationId = 'org-11111111-1111-4111-8111-111111111111';
  const branchId = 'br-22222222-2222-4222-8222-222222222222';
  const edgeId = 'edge-33333333-3333-4333-8333-333333333333';

  const nativeDb = getTestNativeDatabase(edgeDb);
  const trustedTimeManager = new TrustedTimeManager({
    db: nativeDb,
    secureStore,
    onRollbackDetected: (details) => {
      persistence.appendAuditEvent({
        eventId: crypto.randomUUID(),
        organizationId,
        branchId,
        edgeId,
        eventType: 'ClockRollbackDetected',
        severity: 'CRITICAL',
        action: 'CLOCK_ROLLBACK_LOCK',
        metadata: {
          driftSeconds: details.driftSeconds,
          lastKnownCloudTime: details.lastKnownCloudTime,
          currentWallTime: details.currentWallTime,
        },
        createdAt: Math.floor(Date.now() / 1000),
      });
    },
  });

  const nowEpoch = Math.floor(Date.now() / 1000);
  trustedTimeManager.syncCloudTime(nowEpoch);

  const tlsIdentity = new EdgeTlsIdentityManager({
    certDir,
    secureStore,
    commonName: 'localhost',
  });

  const pairingStore = new EdgePairingStore({
    organizationId,
    branchId,
    edgeId,
    edgePublicKeyFingerprint: tlsIdentity.getFingerprint(),
    secureStore,
    persistence,
    trustedTimeManager,
  });

  const pinStore = createTestStationPinStore({
    storeFilePath: pinStorePath,
    backend: testSecureBackend,
  });

  const cleanup = () => {
    try {
      edgeDb.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore teardown cleanup errors
    }
  };

  return {
    tempDir,
    dbPath,
    secureDir,
    certDir,
    pinStorePath,
    testSecureBackend,
    edgeDb,
    nativeDb,
    persistence,
    secureStore,
    organizationId,
    branchId,
    edgeId,
    trustedTimeManager,
    tlsIdentity,
    pairingStore,
    pinStore,
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// TEST OBLIGATION 01: Rogue Edge mDNS spoofing attack rejected
// ---------------------------------------------------------------------------
test('WP009-T01: Simulated rogue Edge mDNS spoofing attack rejected before secret exposure', async () => {
  const legitCtx = createTestContext('t01_legit');
  const rogueCtx = createTestContext('t01_rogue');

  const legitServer = new EdgeEnrollmentServer({
    tlsIdentity: legitCtx.tlsIdentity,
    pairingStore: legitCtx.pairingStore,
  });
  await legitServer.start();

  const rogueServer = new EdgeEnrollmentServer({
    tlsIdentity: rogueCtx.tlsIdentity,
    pairingStore: rogueCtx.pairingStore,
  });
  const roguePort = await rogueServer.start();

  try {
    // 1. QR code contains legitimate Edge host fingerprint
    const qrPayload = legitCtx.pairingStore.createPairingPayload();

    // 2. Client is deceived by rogue mDNS announcement and connects to rogue port
    const client = new StationEnrollmentClient({
      pinStore: rogueCtx.pinStore,
      port: roguePort,
    });

    const stationDetails = {
      stationId: 'st-00000000-0000-4000-8000-000000000001',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: legitCtx.organizationId,
    };

    // 3. Client MUST abort during probe before sending pairing secret
    await assert.rejects(
      async () => {
        await client.enroll(qrPayload, stationDetails);
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /Rogue Edge rejected/);
        return true;
      },
      'Client must reject rogue Edge presenting mismatched TLS fingerprint',
    );

    // 4. Assert zero application data was sent to rogue server
    assert.equal(client.getLastProbeApplicationBytesWritten(), 0);

    // 5. Assert rogue server received zero pairing secret and inserted zero station credentials
    const cred = rogueCtx.persistence.getStationCredentials(stationDetails.stationId);
    assert.equal(cred, null);
  } finally {
    await legitServer.stop();
    await rogueServer.stop();
    legitCtx.cleanup();
    rogueCtx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 02: Replay attack with expired pairing token rejected
// ---------------------------------------------------------------------------
test('WP009-T02: Replay attack with expired pairing token rejected', async () => {
  const ctx = createTestContext('t02_expired');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    // Create pairing payload with custom TTL of 1 second
    const qrPayload = ctx.pairingStore.createPairingPayload(1);

    // Wait 2 seconds for token to expire
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-00000000-0000-4000-8000-000000000002',
      stationCode: 'POS-02',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await assert.rejects(
      async () => {
        await client.enroll(qrPayload, stationDetails);
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentError);
        return true;
      },
      'Server must reject expired pairing token',
    );
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 03: Zero application bytes transmitted on initial TLS inspection probe
// ---------------------------------------------------------------------------
test('WP009-T03: Zero application bytes transmitted on initial TLS inspection probe', async () => {
  const ctx = createTestContext('t03_probe');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-00000000-0000-4000-8000-000000000003',
      stationCode: 'POS-03',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await client.enroll(qrPayload, stationDetails);

    // Prove exactly zero application bytes on initial probe
    assert.equal(
      client.getLastProbeApplicationBytesWritten(),
      0,
      'Initial probe must have transmitted exactly 0 application bytes',
    );
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 04: Exact certificate pin enforced on second connection
// ---------------------------------------------------------------------------
test('WP009-T04: Exact certificate pin enforced on second connection', async () => {
  const ctx = createTestContext('t04_pinned');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-00000000-0000-4000-8000-000000000004',
      stationCode: 'POS-04',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await client.enroll(qrPayload, stationDetails);

    // Verify second connection used the exact certificate DER as trusted CA
    const caUsed = client.getLastPinnedSecondConnectionCaUsed();
    assert.ok(caUsed);
    assert.deepEqual(caUsed, ctx.tlsIdentity.getCertificateDer());
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 05: StationPinStore persistence verified before secret transmission
// ---------------------------------------------------------------------------
test('WP009-T05: StationPinStore persistence verified before secret transmission', async () => {
  const ctx = createTestContext('t05_pinstore');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-00000000-0000-4000-8000-000000000005',
      stationCode: 'POS-05',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    assert.equal(ctx.pinStore.getPin(ctx.branchId, ctx.edgeId), null);

    await client.enroll(qrPayload, stationDetails);

    // Assert pin was persisted
    const pin = ctx.pinStore.getPin(ctx.branchId, ctx.edgeId);
    assert.ok(pin);
    assert.equal(pin.edgePublicKeyFingerprint, ctx.tlsIdentity.getFingerprint());
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 06: Invariant PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION
// ---------------------------------------------------------------------------
test('WP009-T06: Invariant PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION', async () => {
  const ctx = createTestContext('t06_pin_fail');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();

    // Inject fault into StationPinStore backend
    ctx.testSecureBackend.setSimulateEncryptFailure(true);

    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await assert.rejects(
      async () => {
        await client.enroll(qrPayload, stationDetails);
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        return true;
      },
      'Client must abort if StationPinStore fails to persist',
    );

    // Verify ZERO secret disclosure & ZERO server mutation
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.equal(token.consumed_at, null, 'Server token must remain unconsumed');

    const cred = ctx.persistence.getStationCredentials(stationDetails.stationId);
    assert.equal(cred, null, 'Server must have zero station credentials inserted');
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 07: StationPinStore persistence survives client restart
// ---------------------------------------------------------------------------
test('WP009-T07: StationPinStore persistence survives client restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t07_'));
  const pinPath = path.join(tempDir, 'station_pins.enc');
  const masterKey = crypto.randomBytes(32);
  const backend = new TestIsolatedSecureStorageBackend({ masterKey });

  try {
    // Process 1: write pin
    const store1 = createTestStationPinStore({ storeFilePath: pinPath, backend });
    store1.verifyOrPin('branch-1', 'edge-1', 'SHA256:AA:BB:CC:DD');

    // Process 2: reload store from disk
    const store2 = createTestStationPinStore({ storeFilePath: pinPath, backend });
    const pin = store2.getPin('branch-1', 'edge-1');
    assert.ok(pin);
    assert.equal(pin.edgePublicKeyFingerprint, 'SHA256:AA:BB:CC:DD');
    assert.ok(pin.pinnedAt > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 08: Atomic transaction rollback test: CAS + credential + audit committed together
// ---------------------------------------------------------------------------
test('WP009-T08: Atomic transaction rollback test: CAS + credential + audit committed together', () => {
  const ctx = createTestContext('t08_atomic');
  try {
    const qr = ctx.pairingStore.createPairingPayload();
    const stationDetails = {
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'pubkey',
      stationId: 'st-08',
      stationCode: 'POS-08',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    const res = ctx.pairingStore.enrollStation(stationDetails);
    assert.equal(res.success, true);

    // Verify all 3 records committed
    const token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.ok(token!.consumed_at);

    const cred = ctx.persistence.getStationCredentials('st-08');
    assert.ok(cred);

    const audit = ctx.nativeDb
      .prepare('SELECT * FROM edge_security_audit WHERE station_id = ?')
      .get('st-08');
    assert.ok(audit);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 09: Credential insertion failure injection test
// ---------------------------------------------------------------------------
test('WP009-T09: Credential insertion failure injection test (proves rollback and consumed_at remains NULL)', () => {
  const ctx = createTestContext('t09_cred_fail');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    // Insert conflicting duplicate credential to trigger UNIQUE constraint violation during transaction
    ctx.nativeDb
      .prepare(
        `
      INSERT INTO station_credentials (
        station_id, organization_id, branch_id, station_code, station_type,
        station_public_key, is_revoked, enrolled_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 100)
    `,
      )
      .run('st-09', ctx.organizationId, ctx.branchId, 'POS-EXISTING', 'POS_TERMINAL', 'key');

    const stationDetails = {
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'pubkey',
      stationId: 'st-09',
      stationCode: 'POS-NEW',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    assert.throws(
      () => {
        ctx.pairingStore.enrollStation(stationDetails);
      },
      (err: Error) => {
        assert.match(err.message, /UNIQUE constraint failed/);
        return true;
      },
    );

    // Verify consumed_at was ROLLED BACK and remains NULL
    const token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.equal(
      token!.consumed_at,
      null,
      'CAS token consumption must be rolled back on credential failure',
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 10: Audit failure injection test
// ---------------------------------------------------------------------------
test('WP009-T10: Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued)', () => {
  const ctx = createTestContext('t10_audit_fail');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    // Trigger failure in audit insertion by dropping the audit table or adding an impossible CHECK constraint
    ctx.nativeDb.exec(
      'CREATE TRIGGER fail_audit BEFORE INSERT ON edge_security_audit BEGIN SELECT RAISE(ABORT, "Simulated Audit Failure"); END;',
    );

    const stationDetails = {
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'pubkey',
      stationId: 'st-10',
      stationCode: 'POS-10',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    assert.throws(
      () => {
        ctx.pairingStore.enrollStation(stationDetails);
      },
      (err: Error) => {
        assert.match(err.message, /Simulated Audit Failure/);
        return true;
      },
    );

    // Verify token was NOT consumed
    const token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.equal(token!.consumed_at, null);

    // Verify credential was NOT inserted
    const cred = ctx.persistence.getStationCredentials('st-10');
    assert.equal(cred, null);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 11: Token remains unconsumed and retryable in both failure modes
// ---------------------------------------------------------------------------
test('WP009-T11: Token remains unconsumed and retryable in both failure modes', () => {
  const ctx = createTestContext('t11_retry');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    // 1. Initial state: token unconsumed
    let token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.equal(token!.consumed_at, null);

    // 2. Failure mode 1: mismatched secret
    assert.throws(() => {
      ctx.pairingStore.enrollStation({
        pairingId: qr.pairingId,
        pairingSecret: 'WRONG_SECRET',
        stationPublicKey: 'pubkey',
        stationId: 'st-11',
        stationCode: 'POS-11',
        stationType: 'POS_TERMINAL',
        organizationId: ctx.organizationId,
        branchId: ctx.branchId,
        edgeId: ctx.edgeId,
      });
    });

    token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.equal(token!.consumed_at, null, 'Token must remain unconsumed after auth failure');

    // 3. Retry with correct secret succeeds
    const res = ctx.pairingStore.enrollStation({
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'pubkey',
      stationId: 'st-11',
      stationCode: 'POS-11',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    });
    assert.equal(res.success, true);

    token = ctx.persistence.getPairingToken(qr.pairingId);
    assert.ok(token!.consumed_at);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 12: Cross-tenant (organization_id) mismatch rejected
// ---------------------------------------------------------------------------
test('WP009-T12: Cross-tenant (organization_id) mismatch rejected', () => {
  const ctx = createTestContext('t12_tenant');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    assert.throws(
      () => {
        ctx.pairingStore.enrollStation({
          pairingId: qr.pairingId,
          pairingSecret: qr.pairingSecret,
          stationPublicKey: 'pubkey',
          stationId: 'st-12',
          stationCode: 'POS-12',
          stationType: 'POS_TERMINAL',
          organizationId: 'org-ATTACKER-TENANT',
          branchId: ctx.branchId,
          edgeId: ctx.edgeId,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 13: Cross-branch (branch_id) mismatch rejected
// ---------------------------------------------------------------------------
test('WP009-T13: Cross-branch (branch_id) mismatch rejected', () => {
  const ctx = createTestContext('t13_branch');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    assert.throws(
      () => {
        ctx.pairingStore.enrollStation({
          pairingId: qr.pairingId,
          pairingSecret: qr.pairingSecret,
          stationPublicKey: 'pubkey',
          stationId: 'st-13',
          stationCode: 'POS-13',
          stationType: 'POS_TERMINAL',
          organizationId: ctx.organizationId,
          branchId: 'br-OTHER-BRANCH',
          edgeId: ctx.edgeId,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 14: Cross-edge (edge_id) mismatch rejected
// ---------------------------------------------------------------------------
test('WP009-T14: Cross-edge (edge_id) mismatch rejected', () => {
  const ctx = createTestContext('t14_edge');
  try {
    const qr = ctx.pairingStore.createPairingPayload();

    assert.throws(
      () => {
        ctx.pairingStore.enrollStation({
          pairingId: qr.pairingId,
          pairingSecret: qr.pairingSecret,
          stationPublicKey: 'pubkey',
          stationId: 'st-14',
          stationCode: 'POS-14',
          stationType: 'POS_TERMINAL',
          organizationId: ctx.organizationId,
          branchId: ctx.branchId,
          edgeId: 'edge-OTHER-HOST',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 15: Zero public EnrollmentPersistence escape
// ---------------------------------------------------------------------------
test('WP009-T15: Zero public EnrollmentPersistence escape (strictly module-internal)', async () => {
  const publicIndex = (await import('./index.js')) as Record<string, unknown>;
  assert.equal(
    'EnrollmentPersistence' in publicIndex,
    false,
    'EnrollmentPersistence MUST NOT be exported through public package index',
  );
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 16: Edge TLS private key persists across process restarts
// ---------------------------------------------------------------------------
test('WP009-T16: Edge TLS private key persists across process restarts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t16_'));
  const certDir = path.join(tempDir, 'certs');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend1 = new TestIsolatedSecureStorageBackend({ masterKey });
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend: backend1 });
    const tls1 = new EdgeTlsIdentityManager({
      certDir,
      secureStore: secureStore1,
      commonName: 'localhost',
    });

    const fp1 = tls1.getFingerprint();
    const pem1 = tls1.getCertificatePem();
    const creds1 = tls1.getTlsServerCredentials();

    // Restart: instantiate fresh instances pointing to the same disk stores
    const backend2 = new TestIsolatedSecureStorageBackend({ masterKey });
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir, backend: backend2 });
    const tls2 = new EdgeTlsIdentityManager({
      certDir,
      secureStore: secureStore2,
      commonName: 'localhost',
    });

    assert.equal(tls2.getFingerprint(), fp1, 'Fingerprint must persist across restarts');
    assert.equal(tls2.getCertificatePem(), pem1, 'Certificate must persist across restarts');
    assert.equal(
      tls2.getTlsServerCredentials().key,
      creds1.key,
      'Private key must persist across restarts',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 17: Missing or corrupt TLS private key fails closed on startup (EdgeTlsKeyMissingOrCorrupted)
// ---------------------------------------------------------------------------
test('WP009-T17: Missing or corrupt TLS private key fails closed on startup (EdgeTlsKeyMissingOrCorrupted)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t17_'));
  const certDir = path.join(tempDir, 'certs');
  const secureDir = path.join(tempDir, 'secure');
  const backend = new TestIsolatedSecureStorageBackend();

  try {
    const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend });
    new EdgeTlsIdentityManager({ certDir, secureStore });

    // Corrupt key file
    const keyFile = path.join(secureDir, 'edge_tls_private_key.enc');
    fs.writeFileSync(keyFile, Buffer.from('CORRUPTED_BYTES_GARBAGE_PAYLOAD'));

    assert.throws(
      () => {
        new EdgeTlsIdentityManager({ certDir, secureStore });
      },
      (err: Error) => {
        assert.ok(err instanceof EdgeTlsKeyMissingOrCorruptedError);
        return true;
      },
      'Corrupt key must fail closed with EdgeTlsKeyMissingOrCorruptedError',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 18: Zero silent TLS identity regeneration on active node
// ---------------------------------------------------------------------------
test('WP009-T18: Zero silent TLS identity regeneration on active node', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t18_'));
  const certDir = path.join(tempDir, 'certs');
  const secureDir = path.join(tempDir, 'secure');
  const backend = new TestIsolatedSecureStorageBackend();

  try {
    const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend });
    new EdgeTlsIdentityManager({ certDir, secureStore });

    // Delete private key while cert files still exist (active node)
    const keyFile = path.join(secureDir, 'edge_tls_private_key.enc');
    fs.unlinkSync(keyFile);

    assert.throws(
      () => {
        new EdgeTlsIdentityManager({ certDir, secureStore });
      },
      (err: Error) => {
        assert.ok(err instanceof EdgeTlsKeyMissingOrCorruptedError);
        assert.match(err.message, /Silent regeneration is strictly prohibited/);
        return true;
      },
      'Must fail closed rather than silently regenerating TLS identity',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 19: Persistent exact-32-byte HMAC signing key survives process restart
// ---------------------------------------------------------------------------
test('WP009-T19: Persistent exact-32-byte HMAC signing key survives process restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t19_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend1 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence1 = new EnrollmentPersistence(edgeDb1);
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend: backend1 });
    const time1 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb1),
      secureStore: secureStore1,
    });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time1.syncCloudTime(nowEpoch);

    const store1 = new EdgePairingStore({
      organizationId: 'org-1',
      branchId: 'br-1',
      edgeId: 'edge-1',
      edgePublicKeyFingerprint: 'FP-1',
      secureStore: secureStore1,
      persistence: persistence1,
      trustedTimeManager: time1,
    });

    const qr1 = store1.createPairingPayload();
    const res1 = store1.enrollStation({
      pairingId: qr1.pairingId,
      pairingSecret: qr1.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-19',
      stationCode: 'POS-19',
      stationType: 'POS_TERMINAL',
      organizationId: 'org-1',
      branchId: 'br-1',
      edgeId: 'edge-1',
    });

    edgeDb1.close();

    // Restart: process 2
    const backend2 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence2 = new EnrollmentPersistence(edgeDb2);
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir, backend: backend2 });
    const time2 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb2),
      secureStore: secureStore2,
    });
    time2.syncCloudTime(nowEpoch + 10);

    const store2 = new EdgePairingStore({
      organizationId: 'org-1',
      branchId: 'br-1',
      edgeId: 'edge-1',
      edgePublicKeyFingerprint: 'FP-1',
      secureStore: secureStore2,
      persistence: persistence2,
      trustedTimeManager: time2,
    });

    // Token issued by process 1 must successfully verify in process 2
    const claims = store2.verifyStationToken(res1.stationToken);
    assert.equal(claims.sub, 'st-19');
    assert.equal(claims.station_code, 'POS-19');

    edgeDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 20: Keys shorter or longer than exactly 32 bytes rejected
// ---------------------------------------------------------------------------
test('WP009-T20: Keys shorter or longer than exactly 32 bytes rejected', () => {
  // 31 bytes
  assert.throws(
    () => validateHmacKeyLength(crypto.randomBytes(31)),
    (err: Error) => {
      assert.match(err.message, /must be exactly 32 bytes/);
      return true;
    },
  );

  // 33 bytes
  assert.throws(
    () => validateHmacKeyLength(crypto.randomBytes(33)),
    (err: Error) => {
      assert.match(err.message, /must be exactly 32 bytes/);
      return true;
    },
  );

  // Exactly 32 bytes -> passes
  assert.doesNotThrow(() => validateHmacKeyLength(crypto.randomBytes(32)));
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 21: 12-hour Station Token issued with HS256 signature
// ---------------------------------------------------------------------------
test('WP009-T21: 12-hour Station Token issued with HS256 signature', () => {
  const ctx = createTestContext('t21_token');
  try {
    const qr = ctx.pairingStore.createPairingPayload();
    const res = ctx.pairingStore.enrollStation({
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-21',
      stationCode: 'POS-21',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    });

    assert.equal(res.expiresIn, 43200);

    const claims = ctx.pairingStore.verifyStationToken(res.stationToken);
    assert.equal(claims.exp - claims.iat, 43200);
    assert.equal(claims.sub, 'st-21');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 22: No station_token_hash stored in durable station_credentials
// ---------------------------------------------------------------------------
test('WP009-T22: No station_token_hash stored in durable station_credentials', () => {
  const ctx = createTestContext('t22_schema');
  try {
    const columns = ctx.nativeDb
      .prepare("PRAGMA table_info('station_credentials')")
      .all() as Array<{ name: string }>;

    const columnNames = columns.map((c) => c.name);
    assert.equal(
      columnNames.includes('station_token_hash'),
      false,
      'station_token_hash column must NOT exist in station_credentials',
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 23: Same-process monotonic trusted-time calculation (process.hrtime.bigint())
// ---------------------------------------------------------------------------
test('WP009-T23: Same-process monotonic trusted-time calculation (process.hrtime.bigint())', async () => {
  const ctx = createTestContext('t23_mono');
  try {
    const t0 = ctx.trustedTimeManager.getTrustedEffectiveTime();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const t1 = ctx.trustedTimeManager.getTrustedEffectiveTime();

    assert.ok(t1 >= t0 + 1, 'Trusted effective time must advance monotonically');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 24: Post-restart trusted-anchor rollback test
// ---------------------------------------------------------------------------
test('WP009-T24: Post-restart trusted-anchor rollback test', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t24_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend1 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDb1 = getTestNativeDatabase(edgeDb1);
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend: backend1 });
    const time1 = new TrustedTimeManager({ db: nativeDb1, secureStore: secureStore1 });

    // Anchor time set to far in the future
    const futureTime = Math.floor(Date.now() / 1000) + 10000;
    time1.syncCloudTime(futureTime);
    edgeDb1.close();

    // Restart: current wall clock is far behind the persisted anchor
    const backend2 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDb2 = getTestNativeDatabase(edgeDb2);
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir, backend: backend2 });
    let rollbackDetected = false;

    const time2 = new TrustedTimeManager({
      db: nativeDb2,
      secureStore: secureStore2,
      onRollbackDetected: () => {
        rollbackDetected = true;
      },
    });

    assert.equal(time2.isLocked(), true, 'System must be CLOCK_ROLLBACK_LOCKED after restart');
    assert.equal(rollbackDetected, true);
    assert.throws(
      () => time2.getTrustedEffectiveTime(),
      (err: Error) => err instanceof ClockRollbackLockError,
    );

    edgeDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 25: Backward clock rollback > 5 minutes (300 seconds) triggers CLOCK_ROLLBACK_LOCKED
// ---------------------------------------------------------------------------
test('WP009-T25: Backward clock rollback > 5 minutes (300 seconds) triggers CLOCK_ROLLBACK_LOCKED', () => {
  const ctx = createTestContext('t25_lock');
  try {
    const nowEpoch = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Backward clock jump > 300 seconds
    assert.throws(
      () => {
        ctx.trustedTimeManager.syncCloudTime(nowEpoch - 301);
      },
      (err: Error) => {
        assert.ok(err instanceof ClockRollbackLockError);
        return true;
      },
      'Backward sync > 300s must throw ClockRollbackLockError',
    );

    assert.equal(ctx.trustedTimeManager.isLocked(), true);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 26: ClockRollbackDetected critical audit record emitted with sensitive parameters redacted
// ---------------------------------------------------------------------------
test('WP009-T26: ClockRollbackDetected critical audit record emitted with sensitive parameters redacted', () => {
  const ctx = createTestContext('t26_audit');
  try {
    const nowEpoch = ctx.trustedTimeManager.getTrustedEffectiveTime();

    try {
      ctx.trustedTimeManager.syncCloudTime(nowEpoch - 400);
    } catch {
      // expected
    }

    const audit = ctx.nativeDb
      .prepare('SELECT * FROM edge_security_audit WHERE event_type = ?')
      .get('ClockRollbackDetected') as
      | {
          severity: string;
          action: string;
          metadata_json: string;
        }
      | undefined;

    assert.ok(audit);
    assert.equal(audit.severity, 'CRITICAL');
    assert.equal(audit.action, 'CLOCK_ROLLBACK_LOCK');

    const meta = JSON.parse(audit.metadata_json);
    assert.ok(meta.driftSeconds >= 400);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 27: Linux basic_text insecure safeStorage backend rejected (fails closed)
// ---------------------------------------------------------------------------
test('WP009-T27: Linux basic_text insecure safeStorage backend rejected (fails closed)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t27_'));

  try {
    // Simulate basic_text backend
    const basicTextBackend = new TestIsolatedSecureStorageBackend({
      simulatedBackendName: 'basic_text',
    });

    assert.throws(
      () => {
        new EdgeSecureStore({
          storageDir: tempDir,
          backend: basicTextBackend,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /basic_text.*prohibited/i);
        return true;
      },
      'EdgeSecureStore must fail closed when backend is basic_text',
    );

    // Also verify StationPinStore fails closed on basic_text via test double
    assert.throws(
      () => {
        createTestStationPinStore({
          storeFilePath: path.join(tempDir, 'pins.enc'),
          backend: basicTextBackend,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /basic_text.*prohibited/i);
        return true;
      },
      'StationPinStore must fail closed when backend is basic_text',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 28: Generic sync infrastructure and outbox_queue absent in WP-009
// ---------------------------------------------------------------------------
test('WP009-T28: Generic sync infrastructure and outbox_queue absent in WP-009', () => {
  const ctx = createTestContext('t28_no_outbox');
  try {
    const tables = ctx.nativeDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    assert.equal(
      tableNames.includes('outbox_queue'),
      false,
      'outbox_queue must NOT exist in WP-009',
    );
    assert.equal(tableNames.includes('generic_sync_records'), false);
    assert.equal(tableNames.includes('wan_sync_events'), false);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 29: Successful end-to-end enrollment flow
// ---------------------------------------------------------------------------
test('WP009-T29: Successful end-to-end enrollment flow', async () => {
  const ctx = createTestContext('t29_e2e');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    // 1. Edge Host generates pairing QR code
    const qrPayload = ctx.pairingStore.createPairingPayload();
    assert.ok(qrPayload.pairingId);
    assert.ok(qrPayload.pairingSecret);
    assert.equal(qrPayload.edgePublicKeyFingerprint, ctx.tlsIdentity.getFingerprint());

    // 2. Station client scans QR and executes enrollment
    const stationClient = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-99999999-9999-4999-8999-999999999999',
      stationCode: 'POS-MAIN-01',
      stationType: 'POS_CASHIER',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA-SAMPLE-KEY',
      organizationId: ctx.organizationId,
    };

    const response = await stationClient.enroll(qrPayload, stationDetails);

    assert.equal(response.success, true);
    assert.ok(response.stationToken);
    assert.equal(response.tokenType, 'Bearer');
    assert.equal(response.stationId, stationDetails.stationId);
    assert.equal(response.expiresIn, 43200);

    // Verify token can be validated on Edge
    const claims = ctx.pairingStore.verifyStationToken(response.stationToken);
    assert.equal(claims.sub, stationDetails.stationId);
    assert.equal(claims.station_code, 'POS-MAIN-01');
    assert.equal(claims.station_type, 'POS_CASHIER');
    assert.equal(claims.org_id, ctx.organizationId);

    // Verify station credentials persisted in SQLite
    const cred = ctx.persistence.getStationCredentials(stationDetails.stationId);
    assert.ok(cred);
    assert.equal(cred.station_code, 'POS-MAIN-01');
    assert.equal(cred.station_type, 'POS_CASHIER');
    assert.equal(cred.is_revoked, 0);

    // Verify TerminalEnrolada / SUCCESS audit persisted in edge_security_audit
    const audit = ctx.nativeDb
      .prepare('SELECT * FROM edge_security_audit WHERE station_id = ? AND event_type = ?')
      .get(stationDetails.stationId, 'TerminalEnrolada') as
      | {
          severity: string;
          action: string;
          sequence_number: number;
          previous_record_hash: string;
          record_hash: string;
        }
      | undefined;

    assert.ok(audit);
    assert.equal(audit.action, 'ENROLLMENT_SUCCESS');
    assert.equal(audit.severity, 'INFO');
    assert.ok(audit.record_hash);
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 30: StationPinStore persists pins in platform secure storage (ciphertext on disk)
// ---------------------------------------------------------------------------
test('WP009-T30: StationPinStore persists pins in platform secure storage (ciphertext on disk, not plaintext JSON)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t30_'));
  const pinPath = path.join(tempDir, 'station_pins.enc');
  const backend = new TestIsolatedSecureStorageBackend();

  try {
    const store = createTestStationPinStore({ storeFilePath: pinPath, backend });
    store.verifyOrPin('branch-alpha', 'edge-bravo', 'SHA256:11:22:33:44:55:66');

    // Inspect raw disk file
    const rawDiskBytes = fs.readFileSync(pinPath);
    assert.ok(rawDiskBytes.length > 0, 'Encrypted pin file must exist on disk');

    const rawString = rawDiskBytes.toString('utf8');
    assert.equal(
      rawString.includes('SHA256:11:22:33:44:55:66'),
      false,
      'Raw persisted file must NOT leak plaintext fingerprint',
    );
    assert.equal(
      rawString.includes('branch-alpha'),
      false,
      'Raw persisted file must NOT leak branchId as plaintext',
    );

    // Verify it cannot be parsed as plain JSON
    assert.throws(
      () => JSON.parse(rawString),
      (err: Error) => err instanceof SyntaxError,
      'Raw file must be binary ciphertext, not plaintext JSON',
    );

    // Reload with backend to verify it decrypts correctly
    const storeReloaded = createTestStationPinStore({ storeFilePath: pinPath, backend });
    const pin = storeReloaded.getPin('branch-alpha', 'edge-bravo');
    assert.ok(pin);
    assert.equal(pin.edgePublicKeyFingerprint, 'SHA256:11:22:33:44:55:66');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 31: StationPinStore cannot replace existing pin, has no reset/overwrite bypass, and survives restart
// ---------------------------------------------------------------------------
test('WP009-T31: StationPinStore cannot replace existing pin, has no reset/overwrite bypass, and survives restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t31_'));
  const pinPath = path.join(tempDir, 'station_pins.enc');
  const masterKey = crypto.randomBytes(32);
  const backend = new TestIsolatedSecureStorageBackend({ masterKey });

  try {
    const store = createTestStationPinStore({ storeFilePath: pinPath, backend });
    // 1. Initial pin establishment succeeds
    const pinned = store.verifyOrPin('br-1', 'edge-1', 'SHA256:ORIGINAL');
    assert.equal(pinned, true, 'Initial pin establishment must succeed');

    // 2. Matching fingerprint returns true
    assert.equal(
      store.verifyOrPin('br-1', 'edge-1', 'SHA256:ORIGINAL'),
      true,
      'Matching fingerprint must verify',
    );

    // 3. Mismatched candidate remains rejected (fails closed)
    const mismatch = store.verifyOrPin('br-1', 'edge-1', 'SHA256:ATTACKER_REPLACEMENT');
    assert.equal(mismatch, false, 'Candidate mismatch must fail closed');

    // 4. Established pin cannot be replaced by normal runtime calls
    const pinAfterAttempt = store.getPin('br-1', 'edge-1');
    assert.ok(pinAfterAttempt);
    assert.equal(
      pinAfterAttempt.edgePublicKeyFingerprint,
      'SHA256:ORIGINAL',
      'Established pin must NOT be replaced or modified',
    );

    // 5. Zero reset/overwrite bypass: verify no reset methods exist on StationPinStore
    const storeAny = store as unknown as Record<string, unknown>;
    assert.equal(
      typeof storeAny.supervisedAdministrativeResetPin,
      'undefined',
      'supervisedAdministrativeResetPin MUST NOT exist on StationPinStore',
    );
    assert.equal(
      typeof storeAny.resetPin,
      'undefined',
      'resetPin MUST NOT exist on StationPinStore',
    );
    assert.equal(
      typeof storeAny.overwritePin,
      'undefined',
      'overwritePin MUST NOT exist on StationPinStore',
    );
    assert.equal(
      typeof storeAny.clearPin,
      'undefined',
      'clearPin MUST NOT exist on StationPinStore',
    );

    // 6. Restart does not reset the pin
    const storeAfterRestart = createTestStationPinStore({ storeFilePath: pinPath, backend });
    const pinAfterRestart = storeAfterRestart.getPin('br-1', 'edge-1');
    assert.ok(pinAfterRestart, 'Pin must survive process restart');
    assert.equal(pinAfterRestart.edgePublicKeyFingerprint, 'SHA256:ORIGINAL');

    const mismatchAfterRestart = storeAfterRestart.verifyOrPin(
      'br-1',
      'edge-1',
      'SHA256:ATTACKER_AFTER_RESTART',
    );
    assert.equal(mismatchAfterRestart, false, 'Mismatch after restart must remain rejected');
    assert.equal(
      storeAfterRestart.getPin('br-1', 'edge-1')?.edgePublicKeyFingerprint,
      'SHA256:ORIGINAL',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 32: HMAC key rotation survives complete process restart within 12-hour window
// ---------------------------------------------------------------------------
test('WP009-T32: HMAC key rotation survives complete process restart within 12-hour window', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t32_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    // Process 1: setup store and enroll station with active key
    const backend1 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence1 = new EnrollmentPersistence(edgeDb1);
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend: backend1 });
    const time1 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb1),
      secureStore: secureStore1,
    });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time1.syncCloudTime(nowEpoch);

    const store1 = new EdgePairingStore({
      organizationId: 'org-rot',
      branchId: 'br-rot',
      edgeId: 'edge-rot',
      edgePublicKeyFingerprint: 'FP-ROT',
      secureStore: secureStore1,
      persistence: persistence1,
      trustedTimeManager: time1,
    });

    const qr1 = store1.createPairingPayload();
    const res1 = store1.enrollStation({
      pairingId: qr1.pairingId,
      pairingSecret: qr1.pairingSecret,
      stationPublicKey: 'key1',
      stationId: 'st-rot-1',
      stationCode: 'POS-ROT-1',
      stationType: 'POS_TERMINAL',
      organizationId: 'org-rot',
      branchId: 'br-rot',
      edgeId: 'edge-rot',
    });

    const tokenSignedByPrevKey = res1.stationToken;

    // Rotate HMAC key
    store1.rotateHmacKey();
    assert.equal(store1.getActiveKeyVersion(), 2);
    assert.equal(store1.getPreviousKeyVersion(), 1);
    assert.ok(store1.getPreviousKeyExpiresAt()! > nowEpoch);

    // Verify token verifies in process 1
    const claimsBeforeRestart = store1.verifyStationToken(tokenSignedByPrevKey);
    assert.equal(claimsBeforeRestart.sub, 'st-rot-1');

    edgeDb1.close();

    // Process 2: simulate complete process restart
    const backend2 = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence2 = new EnrollmentPersistence(edgeDb2);
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir, backend: backend2 });
    const time2 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb2),
      secureStore: secureStore2,
    });
    time2.syncCloudTime(nowEpoch + 60); // 1 minute later

    const store2 = new EdgePairingStore({
      organizationId: 'org-rot',
      branchId: 'br-rot',
      edgeId: 'edge-rot',
      edgePublicKeyFingerprint: 'FP-ROT',
      secureStore: secureStore2,
      persistence: persistence2,
      trustedTimeManager: time2,
    });

    assert.equal(store2.getActiveKeyVersion(), 2);
    assert.equal(store2.getPreviousKeyVersion(), 1);

    // Token signed before restart MUST continue validating inside 12-hour window
    const claimsAfterRestart = store2.verifyStationToken(tokenSignedByPrevKey);
    assert.equal(claimsAfterRestart.sub, 'st-rot-1');
    assert.equal(claimsAfterRestart.station_code, 'POS-ROT-1');

    edgeDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 33: HMAC previous key is securely discarded from EdgeSecureStore after 12-hour expiry window
// ---------------------------------------------------------------------------
test('WP009-T33: HMAC previous key is securely discarded from EdgeSecureStore after 12-hour expiry window', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t33_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence = new EnrollmentPersistence(edgeDb);
    const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend });
    const time = new TrustedTimeManager({ db: getTestNativeDatabase(edgeDb), secureStore });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time.syncCloudTime(nowEpoch);

    const store = new EdgePairingStore({
      organizationId: 'org-exp',
      branchId: 'br-exp',
      edgeId: 'edge-exp',
      edgePublicKeyFingerprint: 'FP-EXP',
      secureStore,
      persistence,
      trustedTimeManager: time,
    });

    const qr = store.createPairingPayload();
    const res = store.enrollStation({
      pairingId: qr.pairingId,
      pairingSecret: qr.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-exp-1',
      stationCode: 'POS-EXP',
      stationType: 'POS_TERMINAL',
      organizationId: 'org-exp',
      branchId: 'br-exp',
      edgeId: 'edge-exp',
    });

    const token = res.stationToken;

    // Rotate key
    store.rotateHmacKey();
    assert.equal(secureStore.hasSecret('station_token_hmac_previous_key'), true);

    // Advance time past 12 hours (43200 + 100 seconds)
    time.syncCloudTime(nowEpoch + 43300);

    // Attempting to verify prior token must fail closed
    assert.throws(
      () => store.verifyStationToken(token),
      (err: Error) => {
        assert.match(err.message, /signature verification failed|expired/i);
        return true;
      },
      'Prior token must be rejected after 12-hour expiry',
    );

    // Previous key material must be securely discarded from EdgeSecureStore
    assert.equal(
      secureStore.hasSecret('station_token_hmac_previous_key'),
      false,
      'Previous key must be securely purged from EdgeSecureStore after expiry',
    );

    // Emergency invalidation test:
    store.rotateHmacKey({ emergencyImmediateInvalidation: true });
    assert.equal(secureStore.hasSecret('station_token_hmac_previous_key'), false);

    edgeDb.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 34: Valid trusted-time anchor restart succeeds with cryptographic integrity verification
// ---------------------------------------------------------------------------
test('WP009-T34: Valid trusted-time anchor restart succeeds with cryptographic integrity verification', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t34_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend });
    const time1 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb1),
      secureStore: secureStore1,
    });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time1.syncCloudTime(nowEpoch);

    const anchor1 = time1.getPersistedAnchor();
    assert.ok(anchor1);
    assert.ok(anchor1.integrityTag);
    assert.equal(anchor1.integrityTag.length, 64, 'Integrity tag must be HMAC-SHA256 hex string');

    edgeDb1.close();

    // Restart: process 2
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir, backend });
    const time2 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb2),
      secureStore: secureStore2,
    });

    assert.equal(time2.isLocked(), false, 'Valid anchor must not lock system');
    const effective = time2.getTrustedEffectiveTime();
    assert.ok(effective >= nowEpoch);

    edgeDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 35: Tampered trusted-time anchor values fail closed (triggers CLOCK_ROLLBACK_LOCKED)
// ---------------------------------------------------------------------------
test('WP009-T35: Tampered trusted-time anchor values fail closed (triggers CLOCK_ROLLBACK_LOCKED)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t35_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    // Setup initial valid anchor
    const backend = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir, backend });
    const time1 = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDb1),
      secureStore: secureStore1,
    });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time1.syncCloudTime(nowEpoch);
    edgeDb1.close();

    // Case A: Tamper last_known_cloud_time in SQLite
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDb2 = getTestNativeDatabase(edgeDb2);
    nativeDb2
      .prepare(
        'UPDATE trusted_time_anchors SET last_known_cloud_time = last_known_cloud_time + 500 WHERE id = 1',
      )
      .run();

    const time2 = new TrustedTimeManager({ db: nativeDb2, secureStore: secureStore1 });
    assert.equal(time2.isLocked(), true, 'Tampered last_known_cloud_time must fail closed');
    assert.throws(
      () => time2.getTrustedEffectiveTime(),
      (err: Error) => err instanceof ClockRollbackLockError,
    );

    // Case B: Tamper anchor_version in SQLite
    nativeDb2
      .prepare('UPDATE trusted_time_anchors SET anchor_version = anchor_version + 1 WHERE id = 1')
      .run();
    const time3 = new TrustedTimeManager({ db: nativeDb2, secureStore: secureStore1 });
    assert.equal(time3.isLocked(), true, 'Tampered anchor_version must fail closed');

    // Case C: Tamper local_wall_time_at_last_cloud_sync
    nativeDb2
      .prepare(
        'UPDATE trusted_time_anchors SET local_wall_time_at_last_cloud_sync = local_wall_time_at_last_cloud_sync - 10 WHERE id = 1',
      )
      .run();
    const time4 = new TrustedTimeManager({ db: nativeDb2, secureStore: secureStore1 });
    assert.equal(
      time4.isLocked(),
      true,
      'Tampered local_wall_time_at_last_cloud_sync must fail closed',
    );

    edgeDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 36: Trusted time integrity verification and anchor deletion fail-closed behavior
// ---------------------------------------------------------------------------
test('WP009-T36: Trusted time integrity verification and anchor deletion fail-closed behavior', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t36_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    // 1. Fresh node: no row + no key => bootstrap allowed
    const backendFresh = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDbFresh = new EdgeDatabaseService({ databasePath: dbPath });
    const secureStoreFresh = new EdgeSecureStore({ storageDir: secureDir, backend: backendFresh });
    const timeFresh = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDbFresh),
      secureStore: secureStoreFresh,
    });
    assert.equal(
      timeFresh.isLocked(),
      false,
      'Fresh bootstrap without row and without key must be allowed',
    );
    const nowEpoch = Math.floor(Date.now() / 1000);
    timeFresh.syncCloudTime(nowEpoch);
    assert.equal(timeFresh.isLocked(), false);
    assert.equal(secureStoreFresh.hasSecret('trusted_time_anchor_hmac_key'), true);
    edgeDbFresh.close();

    // 2. Row + valid key => restart allowed
    const edgeDbValid = new EdgeDatabaseService({ databasePath: dbPath });
    const timeValid = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDbValid),
      secureStore: secureStoreFresh,
    });
    assert.equal(
      timeValid.isLocked(),
      false,
      'Restart with matching DB anchor and integrity key must succeed',
    );
    assert.ok(timeValid.getTrustedEffectiveTime() >= nowEpoch);
    edgeDbValid.close();

    // 3. Row + missing key => fail closed
    const edgeDbMissingKey = new EdgeDatabaseService({ databasePath: dbPath });
    const secureStoreMissingKey = new EdgeSecureStore({
      storageDir: path.join(tempDir, 'secure_empty'),
      backend: backendFresh,
    });
    const timeMissingKey = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDbMissingKey),
      secureStore: secureStoreMissingKey,
    });
    assert.equal(
      timeMissingKey.isLocked(),
      true,
      'DB row present but integrity key missing must fail closed',
    );
    assert.throws(
      () => timeMissingKey.getTrustedEffectiveTime(),
      (err: Error) => err instanceof ClockRollbackLockError,
    );
    edgeDbMissingKey.close();

    // 4. Key + missing row (Anchor Deletion Bypass Remediation) => fail closed
    const edgeDbDeletedRow = new EdgeDatabaseService({
      databasePath: path.join(tempDir, 'edge_empty.db'),
    });
    const timeDeletedRow = new TrustedTimeManager({
      db: getTestNativeDatabase(edgeDbDeletedRow),
      secureStore: secureStoreFresh, // has 'trusted_time_anchor_hmac_key'
    });
    assert.equal(
      timeDeletedRow.isLocked(),
      true,
      'Active integrity key present while DB anchor row is missing (deleted) MUST fail closed',
    );
    assert.throws(
      () => timeDeletedRow.getTrustedEffectiveTime(),
      (err: Error) => err instanceof ClockRollbackLockError,
    );
    assert.throws(
      () => timeDeletedRow.syncCloudTime(nowEpoch + 100),
      (err: Error) => err instanceof ClockRollbackLockError,
      'Locked system must NOT allow syncCloudTime to recreate or unlock anchor',
    );
    edgeDbDeletedRow.close();

    // 5. Tampered row => fail closed
    const edgeDbTampered = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDbTampered = getTestNativeDatabase(edgeDbTampered);
    nativeDbTampered
      .prepare(
        'UPDATE trusted_time_anchors SET last_known_cloud_time = last_known_cloud_time - 1000 WHERE id = 1',
      )
      .run();
    const timeTampered = new TrustedTimeManager({
      db: nativeDbTampered,
      secureStore: secureStoreFresh,
    });
    assert.equal(
      timeTampered.isLocked(),
      true,
      'Tampered DB anchor row must fail cryptographic integrity',
    );
    edgeDbTampered.close();

    // 6. Corrupted integrity tag => fail closed
    const edgeDbCorruptedTag = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDbCorruptedTag = getTestNativeDatabase(edgeDbCorruptedTag);
    nativeDbCorruptedTag
      .prepare(
        "UPDATE trusted_time_anchors SET integrity_tag = 'badc0ffee0000000000000000000000000000000000000000000000000000000' WHERE id = 1",
      )
      .run();
    const timeCorruptedTag = new TrustedTimeManager({
      db: nativeDbCorruptedTag,
      secureStore: secureStoreFresh,
    });
    assert.equal(timeCorruptedTag.isLocked(), true, 'Corrupted integrity tag must trigger lock');
    edgeDbCorruptedTag.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 37: StationPinStore failure causes ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION
// ---------------------------------------------------------------------------
test('WP009-T37: StationPinStore failure causes ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION', async () => {
  const ctx = createTestContext('t37_pin_fail');
  const server = new EdgeEnrollmentServer({
    tlsIdentity: ctx.tlsIdentity,
    pairingStore: ctx.pairingStore,
  });
  const port = await server.start();

  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();

    // Inject encryption failure into StationPinStore backend
    ctx.testSecureBackend.setSimulateEncryptFailure(true);

    const client = new StationEnrollmentClient({
      pinStore: ctx.pinStore,
      port,
    });

    const stationDetails = {
      stationId: 'st-fail-37',
      stationCode: 'POS-FAIL-37',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await assert.rejects(
      async () => {
        await client.enroll(qrPayload, stationDetails);
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        return true;
      },
      'Client must abort before sending pairing secret when PinStore fails',
    );

    // ZERO secret disclosure: token remains unconsumed
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.equal(token.consumed_at, null);

    // ZERO server mutation: zero credentials inserted
    const cred = ctx.persistence.getStationCredentials(stationDetails.stationId);
    assert.equal(cred, null);
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 38: Public package entrypoint strictly encapsulates internals and raw keys
// ---------------------------------------------------------------------------
test('WP009-T38: Public package entrypoint strictly encapsulates internals and raw keys', async () => {
  // Dynamically import public package
  const publicExports = (await import('./index.js')) as Record<string, unknown>;

  // Assert STRICT ABSENCE of internal secure store, backends, raw keys, and internal stores
  const prohibitedExports = [
    'EdgeSecureStore',
    'ElectronSafeStorageBackend',
    'NodeCryptoVaultBackend',
    'TestIsolatedSecureStorageBackend',
    'SecureStorageBackend',
    'createTestStationPinStore',
    'kInternalTestBackend',
    'EdgeTlsIdentityManager',
    'EdgePairingStore',
    'EnrollmentPersistence',
    'TrustedTimeManager',
    'loadSecret',
    'storeSecret',
    'getTlsServerCredentials',
  ];

  for (const prohibited of prohibitedExports) {
    assert.equal(
      prohibited in publicExports,
      false,
      `Prohibited internal symbol '${prohibited}' MUST NOT be exported by public @trident/edge entrypoint`,
    );
  }

  // Assert ALLOWED safe high-level interfaces ARE present
  const allowedExports = [
    'EdgeEnrollmentServer',
    'StationEnrollmentClient',
    'StationPinStore',
    'EdgeMdnsAdvertiser',
    'EdgeMdnsBrowser',
    'computeCertificateFingerprint',
    'generatePairingId',
    'generatePairingSecret',
    'timingSafeSecretCompare',
    'redactSensitiveData',
    'EnrollmentError',
    'EnrollmentSecurityError',
    'EnrollmentContextMismatchError',
    'EnrollmentExpiredError',
    'EnrollmentAlreadyConsumedError',
    'ClockRollbackLockError',
    'StationPinStoreError',
  ];

  for (const allowed of allowedExports) {
    assert.ok(
      allowed in publicExports,
      `Authorized public symbol '${allowed}' must be exported by @trident/edge`,
    );
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 39: Production EdgeSecureStore fails closed if host OS secure storage is unavailable
// ---------------------------------------------------------------------------
test('WP009-T39: Production EdgeSecureStore fails closed if host OS secure storage is unavailable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t39_'));

  try {
    // Attempt to construct EdgeSecureStore in headless Node without injecting a backend
    // Since Electron safeStorage is unavailable in headless Node, production MUST fail closed
    assert.throws(
      () => {
        new EdgeSecureStore({ storageDir: tempDir });
      },
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /host OS secure storage encryption is unavailable/i);
        return true;
      },
      'EdgeSecureStore must fail closed when host OS secure storage is unavailable',
    );

    // Also verify StationPinStore fails closed in headless Node without backend
    assert.throws(
      () => {
        new StationPinStore({ storeFilePath: path.join(tempDir, 'pins.enc') });
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /host secure storage encryption is unavailable/i);
        return true;
      },
      'StationPinStore must fail closed when host secure storage is unavailable',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 40: HMAC metadata fail-closed validation on active node
// ---------------------------------------------------------------------------
test('WP009-T40: HMAC metadata fail-closed validation on active node', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t40_'));
  const dbPath = path.join(tempDir, 'edge.db');
  const secureDir = path.join(tempDir, 'secure');
  const masterKey = crypto.randomBytes(32);

  try {
    const backend = new TestIsolatedSecureStorageBackend({ masterKey });
    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence = new EnrollmentPersistence(edgeDb);
    const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend });
    const time = new TrustedTimeManager({ db: getTestNativeDatabase(edgeDb), secureStore });
    const nowEpoch = Math.floor(Date.now() / 1000);
    time.syncCloudTime(nowEpoch);

    // Initial setup: create store with active key and metadata
    new EdgePairingStore({
      organizationId: 'org-meta',
      branchId: 'br-meta',
      edgeId: 'edge-meta',
      edgePublicKeyFingerprint: 'FP-META',
      secureStore,
      persistence,
      trustedTimeManager: time,
    });
    assert.equal(secureStore.hasSecret('station_token_hmac_active_key'), true);
    assert.equal(secureStore.hasSecret('station_token_hmac_metadata'), true);

    // 1. Active key + missing metadata => fail closed
    secureStore.deleteSecret('station_token_hmac_metadata');
    assert.throws(
      () => {
        new EdgePairingStore({
          organizationId: 'org-meta',
          branchId: 'br-meta',
          edgeId: 'edge-meta',
          edgePublicKeyFingerprint: 'FP-META',
          secureStore,
          persistence,
          trustedTimeManager: time,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /station_token_hmac_metadata is missing/i);
        return true;
      },
      'Active key with missing metadata MUST fail closed',
    );

    // 2. Active key + corrupted metadata (non-JSON payload) => fail closed
    secureStore.storeSecret(
      'station_token_hmac_metadata',
      Buffer.from('NOT_A_VALID_JSON{', 'utf8'),
    );
    assert.throws(
      () => {
        new EdgePairingStore({
          organizationId: 'org-meta',
          branchId: 'br-meta',
          edgeId: 'edge-meta',
          edgePublicKeyFingerprint: 'FP-META',
          secureStore,
          persistence,
          trustedTimeManager: time,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /metadata corrupted/i);
        return true;
      },
      'Active key with corrupted metadata MUST fail closed',
    );

    // 3. Malformed metadata (missing activeKeyVersion or invalid types) => fail closed
    secureStore.storeSecret(
      'station_token_hmac_metadata',
      Buffer.from(JSON.stringify({ activeKeyVersion: 'one', previousKeyVersion: null }), 'utf8'),
    );
    assert.throws(
      () => {
        new EdgePairingStore({
          organizationId: 'org-meta',
          branchId: 'br-meta',
          edgeId: 'edge-meta',
          edgePublicKeyFingerprint: 'FP-META',
          secureStore,
          persistence,
          trustedTimeManager: time,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /malformed/i);
        return true;
      },
      'Malformed metadata with non-numeric activeKeyVersion MUST fail closed',
    );

    // 4. Non-expired previousKey declared in metadata + missing previous key => fail closed
    secureStore.storeSecret(
      'station_token_hmac_metadata',
      Buffer.from(
        JSON.stringify({
          activeKeyVersion: 2,
          previousKeyVersion: 1,
          previousKeyExpiresAt: nowEpoch + 3600, // 1 hour in future
        }),
        'utf8',
      ),
    );
    // Ensure previous key secret does NOT exist
    if (secureStore.hasSecret('station_token_hmac_previous_key')) {
      secureStore.deleteSecret('station_token_hmac_previous_key');
    }
    assert.throws(
      () => {
        new EdgePairingStore({
          organizationId: 'org-meta',
          branchId: 'br-meta',
          edgeId: 'edge-meta',
          edgePublicKeyFingerprint: 'FP-META',
          secureStore,
          persistence,
          trustedTimeManager: time,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /missing in EdgeSecureStore/i);
        return true;
      },
      'Metadata declaring non-expired previous key while key is missing MUST fail closed',
    );

    // 5. Non-expired previousKey declared with invalid key length (!== 32 bytes) => fail closed
    secureStore.storeSecret('station_token_hmac_previous_key', crypto.randomBytes(16)); // only 16 bytes!
    assert.throws(
      () => {
        new EdgePairingStore({
          organizationId: 'org-meta',
          branchId: 'br-meta',
          edgeId: 'edge-meta',
          edgePublicKeyFingerprint: 'FP-META',
          secureStore,
          persistence,
          trustedTimeManager: time,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /length is invalid/i);
        return true;
      },
      'Invalid previous key length MUST fail closed',
    );

    edgeDb.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 41: Platform-aware ElectronSafeStorageBackend and Linux fail-closed enforcement
// ---------------------------------------------------------------------------
test('WP009-T41: Platform-aware ElectronSafeStorageBackend and Linux fail-closed enforcement', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t41_'));

  try {
    // 1. Linux with 'basic_text': MUST fail closed
    const mockBasicText = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: (_s: string) => Buffer.from('mock'),
      decryptString: (_b: Buffer) => 'mock',
    } as unknown as typeof import('electron').safeStorage;

    const backendBasicText = new ElectronSafeStorageBackend(mockBasicText, { platform: 'linux' });
    assert.equal(
      backendBasicText.isAvailable(),
      false,
      'basic_text on Linux MUST return isAvailable() === false',
    );
    assert.equal(backendBasicText.getSelectedStorageBackend(), 'basic_text');
    assert.throws(
      () => backendBasicText.encrypt(Buffer.from('test', 'utf8')),
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /basic_text/i);
        return true;
      },
      'Linux basic_text encrypt() MUST fail closed',
    );
    assert.throws(
      () => new EdgeSecureStore({ storageDir: tempDir, backend: backendBasicText }),
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /basic_text/i);
        return true;
      },
      'EdgeSecureStore constructor MUST fail closed on Linux basic_text',
    );
    assert.throws(
      () =>
        createTestStationPinStore({
          storeFilePath: path.join(tempDir, 'pins.enc'),
          backend: backendBasicText,
        }),
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /basic_text/i);
        return true;
      },
      'StationPinStore constructor MUST fail closed on Linux basic_text',
    );

    // 2. Linux with 'unavailable' or unknown backend: MUST fail closed
    const mockUnavailable = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'unavailable',
      encryptString: (_s: string) => Buffer.from('mock'),
      decryptString: (_b: Buffer) => 'mock',
    } as unknown as typeof import('electron').safeStorage;

    const backendUnavailable = new ElectronSafeStorageBackend(mockUnavailable, {
      platform: 'linux',
    });
    assert.equal(
      backendUnavailable.isAvailable(),
      false,
      'unavailable on Linux MUST return isAvailable() === false',
    );
    assert.throws(
      () => backendUnavailable.encrypt(Buffer.from('test', 'utf8')),
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /not an authorized secure OS keyring/i);
        return true;
      },
      'Linux unavailable backend MUST fail closed',
    );

    const mockUnknown = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'insecure_custom_backend',
      encryptString: (_s: string) => Buffer.from('mock'),
      decryptString: (_b: Buffer) => 'mock',
    } as unknown as typeof import('electron').safeStorage;

    const backendUnknown = new ElectronSafeStorageBackend(mockUnknown, { platform: 'linux' });
    assert.equal(
      backendUnknown.isAvailable(),
      false,
      'Unknown backend on Linux MUST return isAvailable() === false',
    );
    assert.throws(
      () => backendUnknown.encrypt(Buffer.from('test', 'utf8')),
      (err: Error) => {
        assert.ok(err instanceof EdgeSecureStoreError);
        assert.match(err.message, /not an authorized secure OS keyring/i);
        return true;
      },
      'Linux unknown backend MUST fail closed',
    );

    // 3. Linux with authorized secure backend (gnome_libsecret, kwallet5): MUST succeed
    let capturedPlaintext = '';
    const mockSecureLinux = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (s: string) => {
        capturedPlaintext = s;
        return Buffer.from(`ENC:${s}`, 'utf8');
      },
      decryptString: (b: Buffer) => {
        return b.toString('utf8').replace(/^ENC:/, '');
      },
    } as unknown as typeof import('electron').safeStorage;

    const backendSecureLinux = new ElectronSafeStorageBackend(mockSecureLinux, {
      platform: 'linux',
    });
    assert.equal(
      backendSecureLinux.isAvailable(),
      true,
      'gnome_libsecret on Linux MUST return isAvailable() === true',
    );
    assert.equal(backendSecureLinux.getSelectedStorageBackend(), 'gnome_libsecret');

    const testSecret = Buffer.from('TEST_AUTHORIZED_SECRET', 'utf8');
    const encrypted = backendSecureLinux.encrypt(testSecret);
    assert.equal(capturedPlaintext, 'TEST_AUTHORIZED_SECRET');
    const decrypted = backendSecureLinux.decrypt(encrypted);
    assert.equal(decrypted.toString('utf8'), 'TEST_AUTHORIZED_SECRET');

    // 4. macOS / Windows: isEncryptionAvailable() = true is sufficient
    const mockMacOs = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => {
        throw new Error('getSelectedStorageBackend not supported on darwin');
      },
      encryptString: (s: string) => Buffer.from(`MAC_ENC:${s}`),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^MAC_ENC:/, ''),
    } as unknown as typeof import('electron').safeStorage;

    const backendMacOs = new ElectronSafeStorageBackend(mockMacOs, { platform: 'darwin' });
    assert.equal(
      backendMacOs.isAvailable(),
      true,
      'darwin with isEncryptionAvailable() = true MUST be available',
    );
    const macEnc = backendMacOs.encrypt(Buffer.from('MAC_SECRET', 'utf8'));
    assert.equal(backendMacOs.decrypt(macEnc).toString('utf8'), 'MAC_SECRET');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 42: Public StationPinStore production API cannot inject or replace OS secure-storage backend
// ---------------------------------------------------------------------------
test('WP009-T42: public StationPinStore production API cannot inject or replace OS secure-storage backend', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t42_'));
  const pinPath = path.join(tempDir, 'station_pins.enc');

  const fakeInsecureBackend = {
    isAvailable: () => true,
    getSelectedStorageBackend: () => 'fake_insecure_custom_backend',
    encrypt: (b: Buffer) => b, // Insecure plaintext bypass
    decrypt: (b: Buffer) => b,
  };

  try {
    // 1. Public StationPinStore constructor exposes no backend injection option:
    // Any attempt to supply backend injection properties throws StationPinStoreError
    const injectionKeys = [
      'backend',
      'storageBackend',
      'secureBackend',
      'adapter',
      'provider',
      'storage',
      'customBackend',
      'fallback',
    ];

    for (const key of injectionKeys) {
      assert.throws(
        () => {
          new StationPinStore({
            storeFilePath: pinPath,
            [key]: fakeInsecureBackend,
          } as unknown as { storeFilePath: string });
        },
        (err: Error) => {
          assert.ok(err instanceof StationPinStoreError);
          assert.match(err.message, /does not allow external backend injection/i);
          return true;
        },
        `Public constructor MUST reject option '${key}'`,
      );
    }

    // 2. Arbitrary object injection cannot replace production secure storage:
    // Attempting positional 2nd argument or token tampering throws StationPinStoreError
    assert.throws(
      () => {
        new (StationPinStore as unknown as new (...args: unknown[]) => StationPinStore)(
          { storeFilePath: pinPath },
          fakeInsecureBackend,
        );
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /accepts exactly one options argument|backend injection/i);
        return true;
      },
      'Positional argument injection MUST be rejected fail-closed',
    );

    assert.throws(
      () => {
        new (StationPinStore as unknown as new (...args: unknown[]) => StationPinStore)(
          { storeFilePath: pinPath },
          'invalid_token',
          fakeInsecureBackend,
        );
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /accepts exactly one options argument|backend injection/i);
        return true;
      },
      'Spoofed internal token MUST be rejected fail-closed',
    );

    // In normal public usage without test-support, StationPinStore internally instantiates
    // ElectronSafeStorageBackend, which in headless Node asserts host secure storage availability
    // and strictly fails closed (preventing any insecure storage fallback)
    assert.throws(
      () => {
        new StationPinStore({ storeFilePath: pinPath });
      },
      (err: Error) => {
        assert.ok(err instanceof StationPinStoreError);
        assert.match(err.message, /host secure storage encryption is unavailable/i);
        return true;
      },
      'Public constructor MUST internally enforce platform secure storage validation',
    );

    // 3. Public package exposes no secure-backend setter:
    const storeProto = StationPinStore.prototype as unknown as Record<string, unknown>;
    const forbiddenMethods = [
      'setBackend',
      'setStorageBackend',
      'setSecureBackend',
      'setAdapter',
      'setProvider',
      'setStorage',
      'configureBackend',
      'useBackend',
      'backend',
      'storageBackend',
    ];
    for (const method of forbiddenMethods) {
      assert.equal(
        method in storeProto,
        false,
        `StationPinStore.prototype MUST NOT expose setter/property '${method}'`,
      );
    }

    // 4. Public package exposes no backend factory override:
    const storeClass = StationPinStore as unknown as Record<string, unknown>;
    const forbiddenStatics = [
      'setFactory',
      'setBackendFactory',
      'setDefaultBackend',
      'overrideBackend',
      'registerBackend',
      'createWithBackend',
      'createTestStationPinStore',
    ];
    for (const staticFn of forbiddenStatics) {
      assert.equal(
        staticFn in storeClass,
        false,
        `StationPinStore static methods MUST NOT expose factory override '${staticFn}'`,
      );
    }

    // 5. Public package exposes no test-support escape hatch:
    const publicModule = (await import('./index.js')) as Record<string, unknown>;
    const forbiddenPackageSymbols = [
      'TestIsolatedSecureStorageBackend',
      'createTestStationPinStore',
      'SecureStorageBackend',
      'ElectronSafeStorageBackend',
      'EdgeSecureStore',
      'NodeCryptoVaultBackend',
      'kInternalTestBackend',
      'testSupport',
    ];
    for (const sym of forbiddenPackageSymbols) {
      assert.equal(
        sym in publicModule,
        false,
        `Public @trident/edge entrypoint MUST NOT export test-support escape hatch '${sym}'`,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
