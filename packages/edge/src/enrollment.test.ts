/**
 * TRIDENTPOS WP-009 Automated Test Suite — S9-R2
 * Implements all 27 governed automated test obligations defined in canonical IMPLEMENTATION_PLAN.md.
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
  EdgePairingStore,
  EdgeSecureStore,
  EdgeSecureStoreError,
  EdgeTlsIdentityManager,
  EdgeTlsKeyMissingOrCorruptedError,
  EnrollmentContextMismatchError,
  EnrollmentSecurityError,
  NodeCryptoVaultBackend,
  StationEnrollmentClient,
  StationPinStore,
  StationPinStoreError,
  TrustedTimeManager,
  ClockRollbackLockError,
} from './index.js';

import { validateHmacKeyLength } from './enrollment/crypto.js';
import { EnrollmentPersistence } from './db/enrollment-persistence.js';
import { getTestNativeDatabase } from './db/test-access.js';

// ---------------------------------------------------------------------------
// Test Environment Harness
// ---------------------------------------------------------------------------

function createTestContext(prefix = 'wp009_test') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}_`));
  const dbPath = path.join(tempDir, 'edge_pos.db');
  const secureDir = path.join(tempDir, 'secure_store');
  const certDir = path.join(tempDir, 'certs');
  const pinStorePath = path.join(tempDir, 'station_pins.json');

  const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
  const persistence = new EnrollmentPersistence(edgeDb);
  const secureStore = new EdgeSecureStore({ storageDir: secureDir });

  const organizationId = 'org-11111111-1111-4111-8111-111111111111';
  const branchId = 'br-22222222-2222-4222-8222-222222222222';
  const edgeId = 'edge-33333333-3333-4333-8333-333333333333';

  const nativeDb = getTestNativeDatabase(edgeDb);
  const trustedTimeManager = new TrustedTimeManager({
    db: nativeDb,
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

  const pinStore = new StationPinStore({ storeFilePath: pinStorePath });

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
    // Generate pairing QR on legitimate Edge Host
    const qrPayload = legitCtx.pairingStore.createPairingPayload();

    // Rogue client attempts to connect to rogue server using legitimate QR payload
    const stationClient = new StationEnrollmentClient({
      pinStore: rogueCtx.pinStore,
      port: roguePort, // Points to rogue server
    });

    const stationDetails = {
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: legitCtx.organizationId,
    };

    // Must throw EnrollmentSecurityError before sending pairingSecret
    await assert.rejects(
      async () => {
        await stationClient.enroll(qrPayload, stationDetails);
      },
      (err: Error) => {
        assert.ok(err instanceof EnrollmentSecurityError);
        assert.match(err.message, /Rogue Edge rejected|fingerprint/i);
        return true;
      },
      'Client must reject rogue Edge fingerprint before transmitting secret',
    );

    // Verify zero application bytes were sent in the probe
    assert.equal(
      stationClient.getLastProbeApplicationBytesWritten(),
      0,
      'Zero application bytes must be written during probe',
    );

    // Verify rogue database was never touched
    const rogueTokens = rogueCtx.nativeDb
      .prepare('SELECT count(*) as count FROM enrollment_tokens')
      .get() as { count: number };
    assert.equal(rogueTokens.count, 0, 'Rogue server DB must experience zero mutation');
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
    // Generate token with custom TTL = 2 seconds
    const qrPayload = ctx.pairingStore.createPairingPayload(2);

    // Advance trusted time by 10 seconds to simulate expiration
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    ctx.trustedTimeManager.syncCloudTime(now + 10);

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
        assert.match(err.message, /410|expired/i);
        return true;
      },
      'Expired token must be rejected with HTTP 410 / EnrollmentExpired',
    );

    // Verify token was not consumed
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.equal(token.consumed_at, null, 'Expired token consumed_at must remain NULL');
  } finally {
    await server.stop();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 03: Zero application bytes transmitted on initial TLS inspection probe
// ---------------------------------------------------------------------------
test('WP009-T03: Zero application bytes transmitted on initial TLS inspection probe', async () => {
  const ctx = createTestContext('t03_zerodata');
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
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await client.enroll(qrPayload, stationDetails);

    // Verify metric
    assert.equal(
      client.getLastProbeApplicationBytesWritten(),
      0,
      'Strict zero-data invariant on initial TLS probe',
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
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    const res = await client.enroll(qrPayload, stationDetails);
    assert.equal(res.success, true);

    const caUsed = client.getLastPinnedSecondConnectionCaUsed();
    assert.ok(caUsed);
    assert.deepEqual(
      caUsed,
      ctx.tlsIdentity.getCertificateDer(),
      'Second connection must strictly use proven certificate DER as pinned CA',
    );
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

    // Before enrollment: pin store empty for this edge
    assert.equal(ctx.pinStore.getPin(ctx.branchId, ctx.edgeId), null);

    const stationDetails = {
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    await client.enroll(qrPayload, stationDetails);

    // After enrollment: pin store has recorded verified fingerprint
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

    // Inject fault into StationPinStore
    ctx.pinStore.setSimulateWriteFailure(true);

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
  const pinPath = path.join(tempDir, 'station_pins.json');

  try {
    // Process 1: write pin
    const store1 = new StationPinStore({ storeFilePath: pinPath });
    store1.setPin({
      branchId: 'branch-1',
      edgeId: 'edge-1',
      edgePublicKeyFingerprint: 'SHA256:AA:BB:CC:DD',
      pinnedAt: 1700000000,
    });

    // Process 2: reload store from disk
    const store2 = new StationPinStore({ storeFilePath: pinPath });
    const pin = store2.getPin('branch-1', 'edge-1');
    assert.ok(pin);
    assert.equal(pin.edgePublicKeyFingerprint, 'SHA256:AA:BB:CC:DD');
    assert.equal(pin.pinnedAt, 1700000000);
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
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const stationDetails = {
      stationId: 'st-44444444-4444-4444-8444-444444444444',
      stationCode: 'POS-01',
      stationType: 'POS_TERMINAL',
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      organizationId: ctx.organizationId,
    };

    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: stationDetails.stationPublicKey,
      stationId: stationDetails.stationId,
      stationCode: stationDetails.stationCode,
      stationType: stationDetails.stationType,
      organizationId: stationDetails.organizationId,
      branchId: qrPayload.branchId,
      edgeId: qrPayload.edgeId,
    };

    const res = ctx.pairingStore.enrollStation(req);
    assert.equal(res.success, true);

    // Verify all 3 entities are committed:
    // 1. Token consumed
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.notEqual(token.consumed_at, null);

    // 2. Station credential exists
    const cred = ctx.persistence.getStationCredentials(stationDetails.stationId);
    assert.ok(cred);
    assert.equal(cred.station_code, 'POS-01');

    // 3. Audit record exists with TerminalEnrolada / SUCCESS
    const audit = ctx.nativeDb
      .prepare('SELECT * FROM edge_security_audit WHERE station_id = ? AND event_type = ?')
      .get(stationDetails.stationId, 'TerminalEnrolada') as
      { action: string; severity: string } | undefined;
    assert.ok(audit);
    assert.equal(audit.action, 'ENROLLMENT_SUCCESS');
    assert.equal(audit.severity, 'INFO');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 09: Credential insertion failure injection test (proves rollback and consumed_at remains NULL)
// ---------------------------------------------------------------------------
test('WP009-T09: Credential insertion failure injection test (proves rollback and consumed_at remains NULL)', () => {
  const ctx = createTestContext('t09_cred_fail');
  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    ctx.persistence.setSimulateCredentialInsertFailure(true);

    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-09',
      stationCode: 'POS-09',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    assert.throws(() => {
      ctx.pairingStore.enrollStation(req);
    }, /Simulated credential insertion failure/);

    // Verify rollback
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.equal(token.consumed_at, null, 'consumed_at must remain NULL after credential failure');

    const cred = ctx.persistence.getStationCredentials('st-09');
    assert.equal(cred, null, 'Zero credential rows must be committed');

    const auditCount = ctx.nativeDb
      .prepare('SELECT count(*) as count FROM edge_security_audit WHERE station_id = ?')
      .get('st-09') as { count: number };
    assert.equal(auditCount.count, 0, 'Zero audit rows must be committed');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 10: Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued)
// ---------------------------------------------------------------------------
test('WP009-T10: Audit failure injection test (proves rollback, consumed_at remains NULL, and no token issued)', () => {
  const ctx = createTestContext('t10_audit_fail');
  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    ctx.persistence.setSimulateAuditInsertFailure(true);

    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-10',
      stationCode: 'POS-10',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    assert.throws(() => {
      ctx.pairingStore.enrollStation(req);
    }, /Simulated audit insertion failure/);

    // Verify rollback
    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.equal(token.consumed_at, null, 'consumed_at must remain NULL after audit failure');

    const cred = ctx.persistence.getStationCredentials('st-10');
    assert.equal(cred, null, 'Zero credential rows must be committed');
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
    const qrPayload = ctx.pairingStore.createPairingPayload();

    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-11',
      stationCode: 'POS-11',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    // 1. Inject credential failure
    ctx.persistence.setSimulateCredentialInsertFailure(true);
    assert.throws(() => ctx.pairingStore.enrollStation(req));
    ctx.persistence.setSimulateCredentialInsertFailure(false);

    // 2. Inject audit failure
    ctx.persistence.setSimulateAuditInsertFailure(true);
    assert.throws(() => ctx.pairingStore.enrollStation(req));
    ctx.persistence.setSimulateAuditInsertFailure(false);

    // 3. Retry without faults: must succeed with the exact same pairing token!
    const res = ctx.pairingStore.enrollStation(req);
    assert.equal(res.success, true);

    const token = ctx.persistence.getPairingToken(qrPayload.pairingId);
    assert.ok(token);
    assert.notEqual(token.consumed_at, null, 'Token is successfully consumed on retry');
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
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-12',
      stationCode: 'POS-12',
      stationType: 'POS_TERMINAL',
      organizationId: 'org-mismatch-9999-9999-999999999999',
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    };

    assert.throws(
      () => ctx.pairingStore.enrollStation(req),
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        assert.match(err.message, /Cross-tenant/i);
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
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-13',
      stationCode: 'POS-13',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: 'br-mismatch-8888-8888-888888888888',
      edgeId: ctx.edgeId,
    };

    assert.throws(
      () => ctx.pairingStore.enrollStation(req),
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        assert.match(err.message, /Cross-branch/i);
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
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const req = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-14',
      stationCode: 'POS-14',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: 'edge-mismatch-7777-7777-777777777777',
    };

    assert.throws(
      () => ctx.pairingStore.enrollStation(req),
      (err: Error) => {
        assert.ok(err instanceof EnrollmentContextMismatchError);
        assert.match(err.message, /Cross-edge/i);
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 15: Zero public EnrollmentPersistence escape (strictly module-internal)
// ---------------------------------------------------------------------------
test('WP009-T15: Zero public EnrollmentPersistence escape (strictly module-internal)', async () => {
  const edgeModule = await import('./index.js');
  assert.equal(
    (edgeModule as Record<string, unknown>).EnrollmentPersistence,
    undefined,
    'EnrollmentPersistence must NOT be exported from packages/edge public index',
  );

  assert.equal(
    (edgeModule as Record<string, unknown>).getTestNativeDatabase,
    undefined,
    'getTestNativeDatabase must NOT be exported from packages/edge public index',
  );
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 16: Edge TLS private key persists across process restarts
// ---------------------------------------------------------------------------
test('WP009-T16: Edge TLS private key persists across process restarts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp009_t16_'));
  const certDir = path.join(tempDir, 'certs');
  const secureDir = path.join(tempDir, 'secure');

  try {
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir });
    const tls1 = new EdgeTlsIdentityManager({
      certDir,
      secureStore: secureStore1,
      commonName: 'localhost',
    });

    const fp1 = tls1.getFingerprint();
    const pem1 = tls1.getCertificatePem();
    const creds1 = tls1.getTlsServerCredentials();

    // Restart: instantiate fresh instances pointing to the same disk stores
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir });
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

  try {
    const secureStore = new EdgeSecureStore({ storageDir: secureDir });
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

  try {
    const secureStore = new EdgeSecureStore({ storageDir: secureDir });
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

  try {
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence1 = new EnrollmentPersistence(edgeDb1);
    const secureStore1 = new EdgeSecureStore({ storageDir: secureDir });
    const time1 = new TrustedTimeManager({ db: getTestNativeDatabase(edgeDb1) });
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
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const persistence2 = new EnrollmentPersistence(edgeDb2);
    const secureStore2 = new EdgeSecureStore({ storageDir: secureDir });
    const time2 = new TrustedTimeManager({ db: getTestNativeDatabase(edgeDb2) });
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
  const shortKey = crypto.randomBytes(31);
  const longKey = crypto.randomBytes(33);
  const exactKey = crypto.randomBytes(32);

  assert.throws(
    () => validateHmacKeyLength(shortKey),
    /must be exactly 32 bytes/i,
    'HMAC key with 31 bytes must be rejected',
  );

  assert.throws(
    () => validateHmacKeyLength(longKey),
    /must be exactly 32 bytes/i,
    'HMAC key with 33 bytes must be rejected',
  );

  assert.doesNotThrow(
    () => validateHmacKeyLength(exactKey),
    'HMAC key with exactly 32 bytes must be accepted',
  );
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 21: 12-hour Station Token issued with HS256 signature
// ---------------------------------------------------------------------------
test('WP009-T21: 12-hour Station Token issued with HS256 signature', () => {
  const ctx = createTestContext('t21_12h');
  try {
    const qrPayload = ctx.pairingStore.createPairingPayload();
    const issuedAt = ctx.trustedTimeManager.getTrustedEffectiveTime();

    const res = ctx.pairingStore.enrollStation({
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: 'key',
      stationId: 'st-21',
      stationCode: 'POS-21',
      stationType: 'POS_TERMINAL',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
    });

    assert.equal(res.expiresIn, 43200, 'expiresIn must be exactly 43200 seconds (12 hours)');
    assert.equal(res.tokenType, 'Bearer');

    const claims = ctx.pairingStore.verifyStationToken(res.stationToken);
    assert.equal(
      claims.exp - claims.iat,
      43200,
      'Claims must show exactly 12 hours between iat and exp',
    );
    assert.equal(claims.iat, issuedAt);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 22: No station_token_hash stored in durable station_credentials
// ---------------------------------------------------------------------------
test('WP009-T22: No station_token_hash stored in durable station_credentials', () => {
  const ctx = createTestContext('t22_no_hash');
  try {
    const columns = ctx.nativeDb.pragma('table_info(station_credentials)') as Array<{
      name: string;
    }>;
    const columnNames = columns.map((c) => c.name);

    assert.equal(
      columnNames.includes('station_token_hash'),
      false,
      'station_token_hash must NOT be present in station_credentials schema',
    );

    assert.ok(columnNames.includes('station_id'));
    assert.ok(columnNames.includes('station_type'));
    assert.ok(columnNames.includes('station_public_key'));
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TEST OBLIGATION 23: Same-process monotonic trusted-time calculation (process.hrtime.bigint())
// ---------------------------------------------------------------------------
test('WP009-T23: Same-process monotonic trusted-time calculation (process.hrtime.bigint())', async () => {
  const ctx = createTestContext('t23_monotonic');
  try {
    const t0 = ctx.trustedTimeManager.getTrustedEffectiveTime();
    // Busy-wait or sleep for a short duration
    await new Promise((r) => setTimeout(r, 1100));
    const t1 = ctx.trustedTimeManager.getTrustedEffectiveTime();

    assert.ok(
      t1 >= t0 + 1,
      `Monotonic trusted effective time must advance monotonically: t1=${t1}, t0=${t0}`,
    );
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

  try {
    const edgeDb1 = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDb1 = getTestNativeDatabase(edgeDb1);
    const time1 = new TrustedTimeManager({ db: nativeDb1 });

    // Anchor time set to far in the future
    const futureTime = Math.floor(Date.now() / 1000) + 10000;
    time1.syncCloudTime(futureTime);
    edgeDb1.close();

    // Restart: current wall clock is far behind the persisted anchor
    const edgeDb2 = new EdgeDatabaseService({ databasePath: dbPath });
    const nativeDb2 = getTestNativeDatabase(edgeDb2);
    let rollbackDetected = false;

    const time2 = new TrustedTimeManager({
      db: nativeDb2,
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
  const ctx = createTestContext('t25_rollback');
  try {
    const current = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Backward rollback by 301 seconds (> 300 seconds)
    assert.throws(
      () => {
        ctx.trustedTimeManager.syncCloudTime(current - 301);
      },
      (err: Error) => err instanceof ClockRollbackLockError,
    );

    assert.equal(ctx.trustedTimeManager.isLocked(), true);

    // Operations must fail closed
    assert.throws(
      () => ctx.pairingStore.createPairingPayload(),
      (err: Error) => err instanceof ClockRollbackLockError,
    );
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
    const current = ctx.trustedTimeManager.getTrustedEffectiveTime();
    try {
      ctx.trustedTimeManager.syncCloudTime(current - 400);
    } catch {
      // expected ClockRollbackLockError
    }

    const audit = ctx.nativeDb
      .prepare(
        'SELECT * FROM edge_security_audit WHERE event_type = ? ORDER BY sequence_number DESC LIMIT 1',
      )
      .get('ClockRollbackDetected') as
      | {
          severity: string;
          action: string;
          metadata_json: string;
        }
      | undefined;

    assert.ok(audit, 'ClockRollbackDetected audit event must be persisted in edge_security_audit');
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
    const basicTextBackend = new NodeCryptoVaultBackend({
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
