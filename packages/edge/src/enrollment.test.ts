/**
 * TRIDENTPOS WP-009 — Edge Enrollment & Trust Bootstrap Protocol Test Suite
 * Rigorously validates all requirements per SECURITY_ARCHITECTURE.md Sec. 3 (R2F-01),
 * IAM_SECURITY_MODEL.md Sec. 4 & 5, ADR-005, and PRE_FREEZE_ADVERSARIAL_BUILDER_GATE.md v1.0.
 * Updated under Remediation R1 with mandatory tests R1-T01 through R1-T06.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';

import * as EdgePublicApi from './index.js';
import {
  createPairingPayload,
  parsePairingPayload,
  serializePairingPayload,
} from './enrollment/pairing-payload.js';
import {
  generatePairingSecret,
  generateSelfSignedX509Certificate,
  hashSha256,
  redactSensitiveData,
  timingSafeSecretCompare,
} from './enrollment/crypto.js';
import { OneTimePairingStore, ClockProvider } from './enrollment/pairing-store.js';
import { EdgeTlsIdentityManager } from './enrollment/tls-identity.js';
import {
  EdgeEnrollmentServer,
  MAX_ENROLLMENT_BODY_BYTES,
  STATION_TOKEN_TTL_SECONDS,
} from './enrollment/enrollment-server.js';
import { StationEnrollmentClient, StationPinStore } from './enrollment/station-client.js';
import {
  BonjourMdnsProvider,
  InMemoryDiscoveryProvider,
  MdnsDiscoveryService,
  TRIDENTPOS_MDNS_SERVICE_NAME,
} from './enrollment/mdns-discovery.js';
import { EnrollmentAuditEvent, EnrollmentError } from './enrollment/types.js';
import { EdgeDatabaseService } from './db/edge-database.js';

class MockClock implements ClockProvider {
  #currentTime: number;

  constructor(initialTimeSeconds: number) {
    this.#currentTime = initialTimeSeconds;
  }

  public nowSeconds(): number {
    return this.#currentTime;
  }

  public advance(seconds: number): void {
    this.#currentTime += seconds;
  }

  public setTime(seconds: number): void {
    this.#currentTime = seconds;
  }
}

class MemoryPinStore implements StationPinStore {
  #pin: string | null = null;

  public savePin(fingerprint: string): void {
    this.#pin = fingerprint;
  }

  public loadPin(): string | null {
    return this.#pin;
  }
}

describe('WP-009 Edge Enrollment & Trust Bootstrap Protocol', () => {
  let tempDir: string;
  let dbPath: string;
  let dbService: EdgeDatabaseService;
  let pairingStore: OneTimePairingStore;
  let mockClock: MockClock;

  const TEST_BRANCH_ID = '00000000-0000-0000-0000-000000000001';
  const TEST_EDGE_ID = 'edge-node-01';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trident-enroll-test-'));
    dbPath = path.join(tempDir, 'edge.db');
    dbService = new EdgeDatabaseService({ databasePath: dbPath, defaultDurabilityMode: 'NORMAL' });
    mockClock = new MockClock(Math.floor(Date.now() / 1000));
    pairingStore = new OneTimePairingStore(dbService, mockClock);
    InMemoryDiscoveryProvider.clearAll();
  });

  afterEach(() => {
    try {
      dbService.close();
    } catch {
      // ignore
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // WP009-T01: Rogue Edge mDNS spoof / fingerprint mismatch + Canary
  // =========================================================================
  it('WP009-T01: Rogue Edge mDNS spoof is rejected prior to secret transmission with zero disclosure canary', async () => {
    // 1. Setup Legitimate Edge Identity & Server
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');
    assert.ok(legitPort > 0);

    // 2. Setup Rogue Edge Identity & Server (with canary tracking)
    const rogueGenerated = generateSelfSignedX509Certificate({ commonName: 'Rogue-Edge' });
    let rogueReceivedBytes = 0;
    let rogueReceivedSecret = false;
    let rogueEnrollCalls = 0;

    const rogueServer = https.createServer(
      {
        key: rogueGenerated.keyPem,
        cert: rogueGenerated.certPem,
      },
      (req, res) => {
        rogueEnrollCalls++;
        let body = '';
        req.on('data', (chunk) => {
          rogueReceivedBytes += chunk.length;
          body += chunk.toString();
        });
        req.on('end', () => {
          if (body.includes(pairingPayload.pairingSecret)) {
            rogueReceivedSecret = true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'STOLEN' }));
        });
      },
    );

    const roguePort = await new Promise<number>((resolve) => {
      rogueServer.listen(0, '127.0.0.1', () => {
        resolve((rogueServer.address() as AddressInfo).port);
      });
    });

    // 3. Generate Legitimate Physical Pairing Payload
    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    // 4. Rogue announces itself in discovery
    const discoveryService = new MdnsDiscoveryService(new InMemoryDiscoveryProvider());
    await discoveryService.advertise({
      host: '127.0.0.1',
      port: roguePort,
      edgeId: 'rogue-node-99',
      serviceName: TRIDENTPOS_MDNS_SERVICE_NAME,
    });

    const candidates = await discoveryService.discoverCandidates();
    assert.equal(candidates.length, 1);
    const rogueCandidate = candidates[0]!;

    // 5. Station attempts enrollment against Rogue Candidate
    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-01',
      stationType: 'POS' as const,
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0',
    };

    // Mandatory assertion: Must throw FINGERPRINT_MISMATCH error
    await assert.rejects(
      async () => {
        await stationClient.enrollWithCandidate(rogueCandidate, pairingPayload, stationInfo);
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'FINGERPRINT_MISMATCH');
        assert.ok(e.message.includes('ZERO secret disclosure'));
        return true;
      },
    );

    // 6. OBJECTIVE CANARY ASSERTIONS (Section 19):
    assert.equal(rogueEnrollCalls, 0, 'Canary failed: Rogue HTTP endpoint was hit!');
    assert.equal(
      rogueReceivedBytes,
      0,
      'Canary failed: Rogue server received application payload bytes!',
    );
    assert.equal(
      rogueReceivedSecret,
      false,
      'Canary failed: Rogue server received the pairing secret!',
    );

    // 7. Verify legitimate pairing token was NOT consumed by the failed attempt
    const tokenState = pairingStore.getTokenState(pairingPayload.pairingId);
    assert.equal(tokenState.isConsumed, false, 'Legitimate token was improperly consumed');

    // Cleanup
    await legitServer.stop();
    await new Promise<void>((resolve) => rogueServer.close(() => resolve()));
    await discoveryService.stop();
  });

  // =========================================================================
  // WP009-T02: Expired pairing token replay
  // =========================================================================
  it('WP009-T02: Expired pairing token is deterministically rejected and cannot be used', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
      ttlSeconds: 600, // 10 minutes
    });
    pairingStore.storePairingToken(pairingPayload);

    // Advance mock clock past expiration (11 minutes)
    mockClock.advance(660);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-02',
      stationType: 'POS' as const,
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1',
    };

    await assert.rejects(
      async () => {
        await stationClient.enrollWithCandidate(
          { host: '127.0.0.1', port: legitPort },
          pairingPayload,
          stationInfo,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'TOKEN_EXPIRED');
        return true;
      },
    );

    // Token must remain unconsumed but marked expired
    const state = pairingStore.getTokenState(pairingPayload.pairingId);
    assert.equal(state.isExpired, true);
    assert.equal(state.isConsumed, false);

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-T03: Successful first use + replay rejection
  // =========================================================================
  it('WP009-T03: Pairing token succeeds on first use and strictly rejects replay attempt', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-01',
      stationType: 'POS' as const,
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2',
    };

    // 1. First attempt: SUCCESS
    const session1 = await stationClient.enrollWithCandidate(
      { host: '127.0.0.1', port: legitPort },
      pairingPayload,
      stationInfo,
    );

    assert.ok(session1.stationId);
    assert.ok(session1.stationToken);
    assert.equal(session1.pinnedFingerprint, legitTls.fingerprint);

    // Verify token is consumed
    const state = pairingStore.getTokenState(pairingPayload.pairingId);
    assert.equal(state.isConsumed, true);

    // 2. Second attempt with exact same payload: MUST FAIL with TOKEN_ALREADY_CONSUMED
    const client2 = new StationEnrollmentClient();
    await assert.rejects(
      async () => {
        await client2.enrollWithCandidate(
          { host: '127.0.0.1', port: legitPort },
          pairingPayload,
          stationInfo,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'TOKEN_ALREADY_CONSUMED');
        return true;
      },
    );

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-T04: Concurrent pairingSecret consumption
  // =========================================================================
  it('WP009-T04: Concurrent racing requests result in exactly 1 success and 1 conflict', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const clientA = new StationEnrollmentClient();
    const clientB = new StationEnrollmentClient();

    const stationA = {
      stationCode: 'POS-01',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_A',
    };
    const stationB = {
      stationCode: 'POS-02',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_B',
    };

    // Execute concurrent enrollments against the single pairing token
    const results = await Promise.allSettled([
      clientA.enrollWithCandidate({ host: '127.0.0.1', port: legitPort }, pairingPayload, stationA),
      clientB.enrollWithCandidate({ host: '127.0.0.1', port: legitPort }, pairingPayload, stationB),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const rejections = results.filter((r) => r.status === 'rejected');

    // Exactly 1 winner, exactly 1 failure
    assert.equal(successes.length, 1, 'Expected exactly 1 successful enrollment');
    assert.equal(rejections.length, 1, 'Expected exactly 1 rejected enrollment');

    const failedResult = rejections[0] as PromiseRejectedResult;
    assert.equal(failedResult.reason.name, 'EnrollmentError');
    assert.ok(
      failedResult.reason.code === 'TOKEN_ALREADY_CONSUMED' ||
        failedResult.reason.code === 'CONCURRENT_CONSUMPTION_CONFLICT',
    );

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-T05: Successful end-to-end enrollment E2E
  // =========================================================================
  it('WP009-T05: Successful trusted enrollment E2E with full cryptographic boundary and pinning', async () => {
    let capturedAuditEvent: EnrollmentAuditEvent | null = null;

    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge-E2E' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
      onAuditEvent: (event) => {
        capturedAuditEvent = event;
      },
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    // 1. Edge generates QR payload
    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
      ttlSeconds: 300,
    });
    pairingStore.storePairingToken(pairingPayload);

    // 2. Serialize and parse QR code (simulating camera scan)
    const qrString = serializePairingPayload(pairingPayload);
    const scannedPayload = parsePairingPayload(qrString);
    assert.deepEqual(scannedPayload, pairingPayload);

    // 3. Discovery of Edge
    const discovery = new MdnsDiscoveryService(new InMemoryDiscoveryProvider());
    await discovery.advertise({
      host: '127.0.0.1',
      port: legitPort,
      edgeId: TEST_EDGE_ID,
      branchId: TEST_BRANCH_ID,
      serviceName: TRIDENTPOS_MDNS_SERVICE_NAME,
    });

    const candidates = await discovery.discoverCandidates();
    const candidate = candidates.find((c) => c.edgeId === TEST_EDGE_ID);
    assert.ok(candidate);

    // 4. Station client executes enrollment
    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationId: '11111111-1111-1111-1111-111111111111',
      stationCode: 'POS-BARRA',
      stationType: 'POS' as const,
      stationPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3',
    };

    const session = await stationClient.enrollWithCandidate(candidate, scannedPayload, stationInfo);

    // Verify session
    assert.equal(session.stationId, stationInfo.stationId);
    assert.ok(session.stationToken.split('.').length === 3, 'Station token must be a valid JWT');
    assert.equal(session.pinnedFingerprint, legitTls.fingerprint);

    // Verify station credentials in Edge local store
    const credentials = pairingStore.getStationCredentials(stationInfo.stationId);
    assert.ok(credentials);
    assert.equal(credentials.stationCode, 'POS-BARRA');
    assert.equal(credentials.isRevoked, false);
    assert.equal(credentials.stationTokenHash, hashSha256(session.stationToken));

    // Verify sanitized audit event
    assert.ok(capturedAuditEvent);
    const audit = capturedAuditEvent as EnrollmentAuditEvent;
    assert.equal(audit.event, 'TerminalEnrolada');
    assert.equal(audit.outcome, 'SUCCESS');
    assert.equal(audit.stationCode, 'POS-BARRA');
    const auditRecord = audit as unknown as Record<string, unknown>;
    assert.equal(auditRecord['pairingSecret'], undefined);
    assert.equal(auditRecord['stationToken'], undefined);

    await legitServer.stop();
    await discovery.stop();
  });

  // =========================================================================
  // WP009-T06: Incorrect pairing secret
  // =========================================================================
  it('WP009-T06: Incorrect pairing secret is rejected and does not leak or consume token', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    // Tamper with the secret in the payload
    const tamperedPayload = {
      ...pairingPayload,
      pairingSecret: generatePairingSecret(),
    };

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-03',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_TAMPER',
    };

    await assert.rejects(
      async () => {
        await stationClient.enrollWithCandidate(
          { host: '127.0.0.1', port: legitPort },
          tamperedPayload,
          stationInfo,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'INVALID_SECRET');
        return true;
      },
    );

    // Token must remain unconsumed
    const state = pairingStore.getTokenState(pairingPayload.pairingId);
    assert.equal(state.isConsumed, false);

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-T07: Cross-Edge or cross-branch pairing misuse
  // =========================================================================
  it('WP009-T07: Cross-Edge or cross-branch pairing misuse fails closed', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Edge-Branch-A' });
    const edgeServer = new EdgeEnrollmentServer({
      branchId: 'BRANCH-A-UUID',
      edgeId: 'EDGE-A',
      tlsManager: legitTls,
      pairingStore,
    });
    const port = await edgeServer.start(0, '127.0.0.1');

    // Token generated for Branch B, but attempted to be consumed on Branch A server
    const pairingPayloadBranchB = createPairingPayload({
      branchId: 'BRANCH-B-UUID',
      edgeId: 'EDGE-A',
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayloadBranchB);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-04',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_BRANCH_MISMATCH',
    };

    await assert.rejects(
      async () => {
        await stationClient.enrollWithCandidate(
          { host: '127.0.0.1', port },
          pairingPayloadBranchB,
          stationInfo,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'CONTEXT_MISMATCH');
        return true;
      },
    );

    await edgeServer.stop();
  });

  // =========================================================================
  // WP009-T08: Pinned Edge certificate mismatch
  // =========================================================================
  it('WP009-T08: Pinned Edge certificate mismatch after enrollment fails closed', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge-Pin' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-PIN',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_PIN',
    };

    // 1. Enroll successfully
    await stationClient.enrollWithCandidate(
      { host: '127.0.0.1', port: legitPort },
      pairingPayload,
      stationInfo,
    );
    assert.equal(stationClient.pinnedFingerprint, legitTls.fingerprint);

    // 2. Simulate subsequent reconnect where server presents a DIFFERENT certificate
    const imposterGenerated = generateSelfSignedX509Certificate({ commonName: 'Imposter-Edge' });
    const imposterServer = https.createServer(
      { key: imposterGenerated.keyPem, cert: imposterGenerated.certPem },
      (req, res) => res.end('IMPOSTER'),
    );
    const imposterPort = await new Promise<number>((resolve) => {
      imposterServer.listen(0, '127.0.0.1', () => {
        resolve((imposterServer.address() as AddressInfo).port);
      });
    });

    // 3. Reconnect to imposter
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: '127.0.0.1',
          port: imposterPort,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          try {
            assert.throws(
              () => {
                stationClient.verifyPinnedSocket(socket);
              },
              (err: unknown) => {
                const e = err as EnrollmentError;
                assert.equal(e.name, 'EnrollmentError');
                assert.equal(e.code, 'CERTIFICATE_PIN_MISMATCH');
                return true;
              },
            );
            socket.destroy();
            resolve();
          } catch (e) {
            socket.destroy();
            reject(e);
          }
        },
      );
      socket.on('error', reject);
    });

    await legitServer.stop();
    await new Promise<void>((resolve) => imposterServer.close(() => resolve()));
  });

  // =========================================================================
  // WP009-R1-T01: Production package cannot extract Edge private/signing key
  // =========================================================================
  it('WP009-R1-T01: Production package cannot extract Edge private/signing key', () => {
    // 1. Verify public package surface does not export private key properties or identity manager
    const exportedKeys = Object.keys(EdgePublicApi);
    assert.ok(exportedKeys.length > 0, 'Public API has exports');
    assert.equal(exportedKeys.includes('keyPem'), false, 'Package root exports keyPem!');
    assert.equal(
      exportedKeys.includes('getTlsCredentials'),
      false,
      'Package root exports getTlsCredentials!',
    );
    assert.equal(
      exportedKeys.includes('EdgeTlsIdentityManager'),
      false,
      'Package root exports internal EdgeTlsIdentityManager!',
    );

    // 2. Verify instance reflection on EdgeEnrollmentServer does not yield keys
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge-R1-T01' });
    const server = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });

    const ownProps = Object.getOwnPropertyNames(server);
    const ownSymbols = Object.getOwnPropertySymbols(server);
    assert.equal(ownProps.includes('keyPem'), false);
    assert.equal(ownProps.includes('privateKey'), false);
    assert.equal(ownProps.includes('signingKey'), false);
    assert.equal(ownProps.includes('localStationSigningKey'), false);
    assert.equal(ownSymbols.length, 0, 'Instance must not have symbol escape hatches');

    // 3. Verify prototype reflection does not expose private keys
    const protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(server));
    assert.equal(protoProps.includes('keyPem'), false);
    assert.equal(protoProps.includes('getTlsCredentials'), false);
  });

  // =========================================================================
  // WP009-R1-T02: WP-008 database boundary remains closed
  // =========================================================================
  it('WP009-R1-T02: WP-008 database boundary remains closed against arbitrary SQL', () => {
    // Verify EdgeDatabaseService does not expose generic arbitrary SQL methods
    const dbAsAny = dbService as unknown as Record<string, unknown>;

    assert.equal(dbAsAny['exec'], undefined, 'dbService.exec must not be exposed');
    assert.equal(dbAsAny['run'], undefined, 'dbService.run must not be exposed');
    assert.equal(dbAsAny['query'], undefined, 'dbService.query must not be exposed');
    assert.equal(dbAsAny['transaction'], undefined, 'dbService.transaction must not be exposed');
    assert.equal(
      dbAsAny['getNativeDatabase'],
      undefined,
      'dbService.getNativeDatabase must not be exposed',
    );

    // Attempting to invoke arbitrary SQL fails
    assert.throws(() => {
      (dbService as unknown as { exec: (s: string) => void }).exec('DROP TABLE enrollment_tokens');
    }, TypeError);
  });

  // =========================================================================
  // WP009-R1-T03: Production discovery provider is real mDNS/Bonjour
  // =========================================================================
  it('WP009-R1-T03: Production discovery provider is real mDNS/Bonjour', () => {
    // Default constructor must use BonjourMdnsProvider, NOT InMemoryDiscoveryProvider
    const defaultDiscovery = new MdnsDiscoveryService();
    assert.ok(
      defaultDiscovery.provider instanceof BonjourMdnsProvider,
      'Default discovery provider must be BonjourMdnsProvider',
    );
    assert.equal(defaultDiscovery.provider.constructor.name, 'BonjourMdnsProvider');
  });

  // =========================================================================
  // WP009-R1-T04: Station Token follows frozen IAM policy (HMAC-SHA256, 12 hours)
  // =========================================================================
  it('WP009-R1-T04: Station Token follows frozen IAM policy', async () => {
    const localSigningKey = crypto.randomBytes(32);
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge-R1-T04' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
      localStationSigningKey: localSigningKey,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-IAM',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_IAM',
    };

    const session = await stationClient.enrollWithCandidate(
      { host: '127.0.0.1', port: legitPort },
      pairingPayload,
      stationInfo,
    );

    // 1. Inspect token structure
    const parts = session.stationToken.split('.');
    assert.equal(parts.length, 3, 'Station Token must be a 3-part compact JWT');

    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));

    // 2. Assert algorithm is HS256 (HMAC-SHA256) per IAM_SECURITY_MODEL.md
    assert.equal(header.alg, 'HS256', 'Station token must use HMAC-SHA256 (HS256)');

    // 3. Assert TTL is exactly 12 hours (43200 seconds)
    const expectedTtl = STATION_TOKEN_TTL_SECONDS; // 43200
    assert.equal(
      payload.exp - payload.iat,
      expectedTtl,
      'Station token TTL must be exactly 12 hours (43200s)',
    );

    // 4. Verify token succeeds against correct local signing key
    const verified = legitServer.verifyStationToken(session.stationToken);
    assert.equal(verified.stationCode, 'POS-IAM');
    assert.equal(verified.stationType, 'POS');
    assert.equal(verified.branchId, TEST_BRANCH_ID);

    // 5. Verify token fails against a DIFFERENT local signing key
    const differentKey = crypto.randomBytes(32);
    assert.throws(
      () => {
        EdgeEnrollmentServer.verifyStationTokenWithKey(
          session.stationToken,
          differentKey,
          TEST_EDGE_ID,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.code, 'INVALID_SECRET');
        return true;
      },
    );

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-R1-T05: Audit sink failure has governed explicit semantics (fail-closed)
  // =========================================================================
  it('WP009-R1-T05: Audit sink failure has governed explicit semantics (fail-closed)', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge-R1-T05' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
      onAuditEvent: () => {
        // Injected audit persistence failure
        throw new Error('AUDIT_DATABASE_UNAVAILABLE');
      },
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: legitTls.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const stationClient = new StationEnrollmentClient();
    const stationInfo = {
      stationCode: 'POS-AUDIT',
      stationType: 'POS' as const,
      stationPublicKey: 'PUBKEY_AUDIT',
    };

    // Mandatory assertion: Enrollment MUST FAIL CLOSED if audit logging fails
    await assert.rejects(
      async () => {
        await stationClient.enrollWithCandidate(
          { host: '127.0.0.1', port: legitPort },
          pairingPayload,
          stationInfo,
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.name, 'EnrollmentError');
        assert.equal(e.code, 'AUDIT_LOGGING_FAILED');
        return true;
      },
    );

    // CRITICAL INVARIANT: The pairing token must NOT be consumed
    const state = pairingStore.getTokenState(pairingPayload.pairingId);
    assert.equal(state.isConsumed, false, 'Pairing token was consumed despite audit sink failure!');

    await legitServer.stop();
  });

  // =========================================================================
  // WP009-R1-T06: Edge identity and station pin survive governed restart
  // =========================================================================
  it('WP009-R1-T06: Edge identity and station pin survive governed restart', async () => {
    const edgeStorageDir = path.join(tempDir, 'edge-identity');
    const pinStore = new MemoryPinStore();

    // 1. Initial Edge creation from persistent storage path
    const edgeTls1 = new EdgeTlsIdentityManager({ storagePath: edgeStorageDir });
    const server1 = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: edgeTls1,
      pairingStore,
    });
    const port1 = await server1.start(0, '127.0.0.1');

    // 2. Station enrolls and saves pin in pinStore
    const pairingPayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: edgeTls1.fingerprint,
    });
    pairingStore.storePairingToken(pairingPayload);

    const stationClient1 = new StationEnrollmentClient({ pinStore });
    await stationClient1.enrollWithCandidate({ host: '127.0.0.1', port: port1 }, pairingPayload, {
      stationCode: 'POS-RESTART',
      stationType: 'POS',
      stationPublicKey: 'PUBKEY_RESTART',
    });

    // Verify pin was saved in pinStore
    assert.equal(pinStore.loadPin(), edgeTls1.fingerprint);

    // 3. Stop server 1 (simulating process restart)
    await server1.stop();

    // 4. Recreate Edge server from persistent storage path
    const edgeTls2 = new EdgeTlsIdentityManager({ storagePath: edgeStorageDir });
    assert.equal(
      edgeTls2.fingerprint,
      edgeTls1.fingerprint,
      'Fingerprint must be identical across restart',
    );

    const server2 = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: edgeTls2,
      pairingStore,
    });
    const port2 = await server2.start(0, '127.0.0.1');

    // 5. Recreate station client from persisted pinStore
    const stationClient2 = new StationEnrollmentClient({ pinStore });
    assert.equal(stationClient2.pinnedFingerprint, edgeTls1.fingerprint);

    // 6. Connect to restarted legitimate Edge: verification passes
    await new Promise<void>((resolve, reject) => {
      const socket: tls.TLSSocket = tls.connect(
        {
          host: '127.0.0.1',
          port: port2,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          try {
            assert.equal(stationClient2.verifyPinnedSocket(socket), true);
            socket.destroy();
            resolve();
          } catch (e) {
            socket.destroy();
            reject(e);
          }
        },
      );
      socket.on('error', reject);
    });

    // 7. Connect to replacement/imposter certificate: verification fails closed
    const imposterGen = generateSelfSignedX509Certificate({ commonName: 'Imposter-Restart' });
    const imposterServer = https.createServer(
      { key: imposterGen.keyPem, cert: imposterGen.certPem },
      (_req, res) => res.end('OK'),
    );
    const imposterPort = await new Promise<number>((res) => {
      imposterServer.listen(0, '127.0.0.1', () => {
        res((imposterServer.address() as AddressInfo).port);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const socket: tls.TLSSocket = tls.connect(
        {
          host: '127.0.0.1',
          port: imposterPort,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          try {
            assert.throws(
              () => {
                stationClient2.verifyPinnedSocket(socket);
              },
              (err: unknown) => {
                const e = err as EnrollmentError;
                assert.equal(e.code, 'CERTIFICATE_PIN_MISMATCH');
                return true;
              },
            );
            socket.destroy();
            resolve();
          } catch (e) {
            socket.destroy();
            reject(e);
          }
        },
      );
      socket.on('error', reject);
    });

    await server2.stop();
    await new Promise<void>((res) => imposterServer.close(() => res()));
  });

  // =========================================================================
  // Additional Negative & Robustness Tests
  // =========================================================================
  it('rejects pairing payload with TTL exceeding 10 minutes (600s)', () => {
    assert.throws(
      () => {
        createPairingPayload({
          branchId: TEST_BRANCH_ID,
          edgeId: TEST_EDGE_ID,
          edgePublicKeyFingerprint: 'SHA256:' + 'AA:'.repeat(31) + 'AA',
          ttlSeconds: 601,
        });
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.code, 'INVALID_PAIRING_PAYLOAD');
        assert.ok(e.message.includes('exceeds maximum allowed duration'));
        return true;
      },
    );
  });

  it('rejects malformed fingerprints and invalid UUID pairingId in parser', () => {
    assert.throws(
      () => {
        parsePairingPayload(
          '{"branchId":"b","edgeId":"e","edgePublicKeyFingerprint":"INVALID","pairingId":"not-uuid","expiresAt":100,"pairingSecret":"sec"}',
        );
      },
      (err: unknown) => {
        const e = err as EnrollmentError;
        assert.equal(e.code, 'INVALID_PAIRING_PAYLOAD');
        return true;
      },
    );
  });

  it('rejects oversized HTTP enrollment requests (> 64 KB)', async () => {
    const legitTls = new EdgeTlsIdentityManager({ commonName: 'Legit-Edge' });
    const legitServer = new EdgeEnrollmentServer({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      tlsManager: legitTls,
      pairingStore,
    });
    const legitPort = await legitServer.start(0, '127.0.0.1');

    const hugePadding = 'A'.repeat(MAX_ENROLLMENT_BODY_BYTES + 1024);
    const hugePayload = JSON.stringify({
      pairingId: crypto.randomUUID(),
      pairingSecret: generatePairingSecret(),
      stationPublicKey: 'KEY',
      stationCode: 'POS-01',
      stationType: 'POS',
      padding: hugePadding,
    });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: legitPort,
          path: '/api/v1/edge/enroll',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(hugePayload),
          },
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        (res) => {
          assert.equal(res.statusCode, 413, 'Expected 413 Payload Too Large');
          resolve();
        },
      );
      req.on('error', reject);
      req.write(hugePayload);
      req.end();
    });

    await legitServer.stop();
  });

  it('Discovery is not Trust: mDNS advertisement does not bypass fingerprint validation', async () => {
    const discovery = new MdnsDiscoveryService(new InMemoryDiscoveryProvider());
    await discovery.advertise({
      host: '127.0.0.1',
      port: 9999,
      edgeId: 'TRIDENTPOS-FAKE',
      serviceName: TRIDENTPOS_MDNS_SERVICE_NAME,
    });

    const candidates = await discovery.discoverCandidates();
    assert.equal(candidates.length, 1);
    const candidate = candidates[0]!;

    const fakePayload = createPairingPayload({
      branchId: TEST_BRANCH_ID,
      edgeId: TEST_EDGE_ID,
      edgePublicKeyFingerprint: 'SHA256:' + '99:'.repeat(31) + '99',
    });

    const stationClient = new StationEnrollmentClient({ timeoutMs: 500 });
    await assert.rejects(async () => {
      await stationClient.enrollWithCandidate(candidate, fakePayload, {
        stationCode: 'POS-01',
        stationType: 'POS',
        stationPublicKey: 'K',
      });
    });

    await discovery.stop();
  });

  it('redactSensitiveData redacts pairing secrets, private keys, and station tokens', () => {
    const sensitive = {
      pairingSecret: 'super-secret-csprng-token',
      stationToken: 'eyJhGciOi...',
      privateKey: '-----BEGIN PRIVATE KEY-----',
      nested: {
        pin: '1234',
        safeField: 'branch-01',
      },
    };

    const redacted = redactSensitiveData(sensitive);
    assert.equal(redacted.pairingSecret, '[REDACTED]');
    assert.equal(redacted.stationToken, '[REDACTED]');
    assert.equal(redacted.privateKey, '[REDACTED]');
    assert.equal(redacted.nested.pin, '[REDACTED]');
    assert.equal(redacted.nested.safeField, 'branch-01');
  });

  it('timingSafeSecretCompare performs constant-time comparison', () => {
    const s1 = '0123456789abcdef0123456789abcdef';
    const s2 = '0123456789abcdef0123456789abcdef';
    const s3 = '0123456789abcdef0123456789abcdeg';
    const s4 = 'short';

    assert.equal(timingSafeSecretCompare(s1, s2), true);
    assert.equal(timingSafeSecretCompare(s1, s3), false);
    assert.equal(timingSafeSecretCompare(s1, s4), false);
  });
});
