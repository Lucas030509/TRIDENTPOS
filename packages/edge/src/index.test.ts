import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_PACKAGE_NAME } from '@trident/core';
import {
  getEdgePackageInfo,
  EDGE_PACKAGE_NAME,
  EDGE_PACKAGE_VERSION,
  HARDENED_WEB_PREFERENCES,
  FROZEN_CSP_DIRECTIVE,
  assertHardenedWebPreferences,
  assertHardenedCSP,
  getHardenedSecurityHeaders,
  ElectronSecurityViolationError,
  EDGE_IPC_CHANNELS,
  ALLOWED_IPC_CHANNELS,
  isAllowedIpcChannel,
  validatePingPayload,
  validateIpcPayload,
  IpcDispatchGuard,
  isAllowedNavigationUrl,
  handleNavigationAttempt,
  createWindowOpenHandler,
  auditRendererIsolation,
  validateEdgeConfig,
  loadEdgeConfigFile,
  assertNoProhibitedSecrets,
  EdgeSecurityConfigError,
  EdgeWorkerSupervisor,
  tridentBridgeApi,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 0. Backward Compatibility & Package Identity
// ============================================================================
test('WP007-T01: @trident/edge returns expected package metadata and core dependency', () => {
  const info = getEdgePackageInfo();
  assert.equal(info.name, EDGE_PACKAGE_NAME);
  assert.equal(info.version, EDGE_PACKAGE_VERSION);
  assert.equal(info.coreDependency, CORE_PACKAGE_NAME);
});

// ============================================================================
// 1. BrowserWindow Security Preferences Tests (SEC-VAL-07 Obligation 1)
// ============================================================================
test('WP007-T02: HARDENED_WEB_PREFERENCES strictly enforces required isolation properties', () => {
  assert.equal(HARDENED_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(HARDENED_WEB_PREFERENCES.sandbox, true);
  assert.equal(HARDENED_WEB_PREFERENCES.webSecurity, true);
  assert.equal(HARDENED_WEB_PREFERENCES.allowRunningInsecureContent, false);
  assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.equal(HARDENED_WEB_PREFERENCES.nodeIntegrationInSubFrames, false);
  assert.equal(HARDENED_WEB_PREFERENCES.experimentalFeatures, false);
  assert.doesNotThrow(() => assertHardenedWebPreferences(HARDENED_WEB_PREFERENCES));
});

test('WP007-T03: [Negative] assertHardenedWebPreferences fails closed on disabled contextIsolation', () => {
  const weakened = { ...HARDENED_WEB_PREFERENCES, contextIsolation: false };
  assert.throws(
    () => assertHardenedWebPreferences(weakened),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('Mandatory contextIsolation must be true'),
  );
});

test('WP007-T04: [Negative] assertHardenedWebPreferences fails closed on enabled nodeIntegration', () => {
  const weakened = { ...HARDENED_WEB_PREFERENCES, nodeIntegration: true };
  assert.throws(
    () => assertHardenedWebPreferences(weakened),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('Mandatory nodeIntegration must be false'),
  );
});

test('WP007-T05: [Negative] assertHardenedWebPreferences fails closed on disabled sandbox', () => {
  const weakened = { ...HARDENED_WEB_PREFERENCES, sandbox: false };
  assert.throws(
    () => assertHardenedWebPreferences(weakened),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('Mandatory sandbox must be true'),
  );
});

test('WP007-T06: [Negative] assertHardenedWebPreferences fails closed on insecure content or worker node integration', () => {
  assert.throws(
    () =>
      assertHardenedWebPreferences({
        ...HARDENED_WEB_PREFERENCES,
        allowRunningInsecureContent: true,
      }),
    ElectronSecurityViolationError,
  );
  assert.throws(
    () =>
      assertHardenedWebPreferences({ ...HARDENED_WEB_PREFERENCES, nodeIntegrationInWorker: true }),
    ElectronSecurityViolationError,
  );
  assert.throws(
    () =>
      assertHardenedWebPreferences({
        ...HARDENED_WEB_PREFERENCES,
        nodeIntegrationInSubFrames: true,
      }),
    ElectronSecurityViolationError,
  );
  assert.throws(
    () => assertHardenedWebPreferences({ ...HARDENED_WEB_PREFERENCES, experimentalFeatures: true }),
    ElectronSecurityViolationError,
  );
});

// ============================================================================
// 2. Renderer Node Exposure Negative Tests (SEC-VAL-07 Obligation 2)
// ============================================================================
test('WP007-T07: auditRendererIsolation confirms zero leaked primitives in clean scope', () => {
  const cleanScope = {
    document: {},
    window: {},
    console: {},
  };
  const audit = auditRendererIsolation(cleanScope);
  assert.equal(audit.isolated, true);
  assert.deepEqual(audit.leakedPrimitives, []);
});

test('WP007-T08: [Negative] auditRendererIsolation detects leaked Node primitives', () => {
  const contaminatedScope = {
    require: () => {},
    process: { versions: {} },
    child_process: {},
    fs: {},
    net: {},
    os: {},
    crypto: {},
    ipcRenderer: {},
    Buffer: {},
  };
  const audit = auditRendererIsolation(contaminatedScope);
  assert.equal(audit.isolated, false);
  assert.equal(audit.leakedPrimitives.length, 9);
  assert.ok(audit.leakedPrimitives.includes('require'));
  assert.ok(audit.leakedPrimitives.includes('process'));
  assert.ok(audit.leakedPrimitives.includes('child_process'));
  assert.ok(audit.leakedPrimitives.includes('fs'));
  assert.ok(audit.leakedPrimitives.includes('ipcRenderer'));
});

// ============================================================================
// 3. IPC Allowlist Positive Tests (SEC-VAL-07 Obligation 3)
// ============================================================================
test('WP007-T09: Allowed channels match authoritative frozen set', () => {
  assert.equal(ALLOWED_IPC_CHANNELS.size, 3);
  assert.ok(ALLOWED_IPC_CHANNELS.has('trident:ping'));
  assert.ok(ALLOWED_IPC_CHANNELS.has('trident:get-system-metadata'));
  assert.ok(ALLOWED_IPC_CHANNELS.has('trident:get-health-status'));
  assert.equal(isAllowedIpcChannel('trident:ping'), true);
  assert.equal(isAllowedIpcChannel('trident:get-system-metadata'), true);
  assert.equal(isAllowedIpcChannel('trident:get-health-status'), true);
});

test('WP007-T10: Approved typed channel executes successfully through IpcDispatchGuard', async () => {
  const guard = new IpcDispatchGuard();
  guard.registerHandler(EDGE_IPC_CHANNELS.PING, async (_event, payload) => {
    const p = payload as { nonce: string };
    return { nonce: p.nonce, echoed: true };
  });

  const result = (await guard.dispatch(
    EDGE_IPC_CHANNELS.PING,
    {},
    { nonce: 'test-nonce-12345' },
  )) as { nonce: string; echoed: boolean };

  assert.equal(result.nonce, 'test-nonce-12345');
  assert.equal(result.echoed, true);
});

// ============================================================================
// 4. IPC Allowlist Negative Tests (SEC-VAL-07 Obligation 4)
// ============================================================================
test('WP007-T11: [Negative] Arbitrary or unapproved IPC channel is rejected fail-closed', async () => {
  const guard = new IpcDispatchGuard();

  // Attempting to register an unapproved channel must throw
  assert.throws(
    () => guard.registerHandler('evil:execute-shell', async () => {}),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('not in the static allowlist'),
  );

  // Attempting to dispatch an unapproved channel must throw
  await assert.rejects(
    async () => guard.dispatch('arbitrary:channel', {}, {}),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('unauthorized and not allowlisted'),
  );

  await assert.rejects(
    async () => guard.dispatch('ELECTRON_BROWSER_REQUIRE', {}, {}),
    ElectronSecurityViolationError,
  );
});

// ============================================================================
// 5. IPC Payload Validation Negative Tests (SEC-VAL-07 Obligation 5)
// ============================================================================
test('WP007-T12: [Negative] Malformed payloads are rejected at the trusted boundary', async () => {
  const guard = new IpcDispatchGuard();
  guard.registerHandler(EDGE_IPC_CHANNELS.PING, async () => ({ ok: true }));
  guard.registerHandler(EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA, async () => ({ ok: true }));

  // Direct payload validator checks
  assert.equal(validatePingPayload({ nonce: 'valid-nonce' }).nonce, 'valid-nonce');
  assert.throws(() => validatePingPayload(null), ElectronSecurityViolationError);
  assert.equal(validateIpcPayload(EDGE_IPC_CHANNELS.GET_HEALTH_STATUS, undefined), undefined);
  assert.throws(() => validateIpcPayload('invalid:channel', {}), ElectronSecurityViolationError);

  // 1. Nonce missing
  await assert.rejects(
    async () => guard.dispatch(EDGE_IPC_CHANNELS.PING, {}, {}),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('must be a non-empty string'),
  );

  // 2. Nonce not a string
  await assert.rejects(
    async () => guard.dispatch(EDGE_IPC_CHANNELS.PING, {}, { nonce: 12345 }),
    ElectronSecurityViolationError,
  );

  // 3. Nonce exceeding max length
  await assert.rejects(
    async () => guard.dispatch(EDGE_IPC_CHANNELS.PING, {}, { nonce: 'a'.repeat(65) }),
    ElectronSecurityViolationError,
  );

  // 4. Passing unexpected arguments to zero-argument channel
  await assert.rejects(
    async () =>
      guard.dispatch(EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA, {}, { unexpectedParam: 'exploit' }),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes('does not accept input parameters'),
  );
});

// ============================================================================
// 6. External Navigation Negative Tests (SEC-VAL-07 Obligation 6)
// ============================================================================
test('WP007-T13: [Negative] External and malicious URLs are blocked from navigation', () => {
  const allowedOrigins = ['file:'] as const;

  // External internet URLs must be blocked
  assert.equal(isAllowedNavigationUrl('https://evil-attacker.com', allowedOrigins), false);
  assert.equal(isAllowedNavigationUrl('http://phishing-pos.net/login', allowedOrigins), false);

  // Script schemes must be blocked
  assert.equal(isAllowedNavigationUrl('javascript:alert(1)', allowedOrigins), false);
  assert.equal(
    isAllowedNavigationUrl('data:text/html,<script>alert(1)</script>', allowedOrigins),
    false,
  );
  assert.equal(isAllowedNavigationUrl('vbscript:msgbox(1)', allowedOrigins), false);

  // Valid local file origin must be permitted
  assert.equal(isAllowedNavigationUrl('file:///app/index.html', allowedOrigins), true);
});

test('WP007-T14: handleNavigationAttempt calls preventDefault on unauthorized navigation', () => {
  let preventDefaultCalled = false;
  let reportedViolation = false;

  const mockEvent = {
    preventDefault() {
      preventDefaultCalled = true;
    },
  };

  const allowed = handleNavigationAttempt(mockEvent, 'https://malicious.com', {
    allowedOrigins: ['file:'],
    onViolation: () => {
      reportedViolation = true;
    },
  });

  assert.equal(allowed, false);
  assert.equal(preventDefaultCalled, true);
  assert.equal(reportedViolation, true);
});

// ============================================================================
// 7. New-Window / window.open Negative Tests (SEC-VAL-07 Obligation 7)
// ============================================================================
test('WP007-T15: [Negative] createWindowOpenHandler strictly returns action: deny across all URLs', () => {
  let violationTarget = '';
  const handler = createWindowOpenHandler((url) => {
    violationTarget = url;
  });

  const targets = [
    'https://google.com',
    'http://localhost:3000',
    'file:///tmp/exploit.html',
    'about:blank',
    'javascript:void(0)',
  ];

  for (const target of targets) {
    const result = handler({ url: target });
    assert.deepEqual(result, { action: 'deny' });
    assert.equal(violationTarget, target);
  }
});

// ============================================================================
// 8. Renderer RCE-Oriented Injection Tests (SEC-VAL-07 Obligation 8)
// ============================================================================
test('WP007-T16: [Negative] Simulated injected script in renderer cannot reach privileged Node APIs', () => {
  // Simulate an injected script running in a renderer environment
  const simulatedRendererWindow: Record<string, unknown> = {
    document: {},
    location: { href: 'file:///app/index.html' },
    // Only tridentBridge should be present
    tridentBridge: tridentBridgeApi,
  };

  // 1. Injected script tries require('child_process')
  assert.equal(typeof simulatedRendererWindow.require, 'undefined');

  // 2. Injected script tries process.mainModule.require
  assert.equal(typeof simulatedRendererWindow.process, 'undefined');

  // 3. Injected script tries raw ipcRenderer
  assert.equal(typeof simulatedRendererWindow.ipcRenderer, 'undefined');

  // 4. Injected script tries Buffer
  assert.equal(typeof simulatedRendererWindow.Buffer, 'undefined');

  // 5. tridentBridge only exposes allowed typed methods
  const bridge = simulatedRendererWindow.tridentBridge as typeof tridentBridgeApi;
  assert.ok(bridge);
  assert.equal(typeof bridge.ping, 'function');
  assert.equal(typeof bridge.getSystemMetadata, 'function');
  assert.equal(typeof bridge.getHealthStatus, 'function');
  // No generic send or invoke
  assert.equal(typeof (bridge as unknown as Record<string, unknown>).send, 'undefined');
  assert.equal(typeof (bridge as unknown as Record<string, unknown>).invoke, 'undefined');
  assert.equal(typeof (bridge as unknown as Record<string, unknown>).rawIpc, 'undefined');
});

// ============================================================================
// 9. Content Security Policy Verification Tests (SEC-VAL-07 Obligation 9)
// ============================================================================
test('WP007-T17: FROZEN_CSP_DIRECTIVE strictly adheres to SECURITY_ARCHITECTURE.md Sec. 9', () => {
  assert.equal(
    FROZEN_CSP_DIRECTIVE,
    "default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;",
  );
  assert.doesNotThrow(() => assertHardenedCSP(FROZEN_CSP_DIRECTIVE));

  const headers = getHardenedSecurityHeaders();
  assert.deepEqual(headers['Content-Security-Policy'], [FROZEN_CSP_DIRECTIVE]);
  assert.deepEqual(headers['X-Content-Type-Options'], ['nosniff']);
  assert.deepEqual(headers['X-Frame-Options'], ['DENY']);
});

test('WP007-T18: [Negative] assertHardenedCSP rejects unsafe-inline, unsafe-eval, and wildcards', () => {
  assert.throws(
    () => assertHardenedCSP("default-src 'self'; script-src 'self' 'unsafe-inline';"),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes("'unsafe-inline' is strictly prohibited"),
  );

  assert.throws(
    () => assertHardenedCSP("default-src 'self'; script-src 'self' 'unsafe-eval';"),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes("'unsafe-eval' is strictly prohibited"),
  );

  assert.throws(
    () => assertHardenedCSP("default-src *; script-src 'self';"),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError && err.message.includes('Wildcard origin'),
  );

  assert.throws(
    () => assertHardenedCSP("script-src 'self';"),
    (err: Error) =>
      err instanceof ElectronSecurityViolationError &&
      err.message.includes("default-src must be restricted to 'self'"),
  );
});

// ============================================================================
// 10. Edge Configuration Schema & Secret Leakage Prevention Tests
// ============================================================================
test('WP007-T19: edge-config.json loads and validates successfully with valid metadata', () => {
  const configPath = path.resolve(__dirname, '../edge-config.json');
  const config = loadEdgeConfigFile(configPath);
  assert.equal(config.version, '1.0.0');
  assert.equal(config.environment, 'development');
  assert.equal(config.station.code, 'EDGE-STATION-01');
  assert.equal(config.station.stationType, 'POS');
  assert.equal(config.network.host, '127.0.0.1');
  assert.equal(config.network.port, 8080);
  assert.equal(config.logging.level, 'info');
});

test('WP007-T20: [Negative] assertNoProhibitedSecrets rejects secret-bearing keys', () => {
  const forbiddenKeys = [
    { password: 'cleartext_password' },
    { pin: '1234' },
    { pinHash: 'argon2_hash' },
    { token: 'jwt_token' },
    { jwt: 'ey...' },
    { secret: 'api_secret' },
    { privateKey: '-----BEGIN RSA PRIVATE KEY-----' },
    { apiKey: 'sk_live_123' },
    { keyring: 'dpapi_key' },
    { service_role_key: 'supabase_service' },
    { pairingSecret: 'secret_qr' },
    { nested: { deeply: { innerToken: 'bad' } } },
  ];

  for (const forbidden of forbiddenKeys) {
    assert.throws(
      () => assertNoProhibitedSecrets(forbidden),
      (err: Error) =>
        err instanceof EdgeSecurityConfigError &&
        err.message.includes('Prohibited secret-bearing key'),
    );
  }
});

test('WP007-T21: [Negative] validateEdgeConfig fails closed on malformed configurations', () => {
  const validBase = {
    version: '1.0.0',
    environment: 'development',
    station: { code: 'ST01', stationType: 'POS', name: 'Station 1' },
    network: { host: '127.0.0.1', port: 8080 },
    logging: { level: 'info' },
  };

  // 1. Port out of range
  assert.throws(
    () => validateEdgeConfig({ ...validBase, network: { host: '127.0.0.1', port: 80 } }),
    EdgeSecurityConfigError,
  );

  // 2. Invalid environment
  assert.throws(
    () => validateEdgeConfig({ ...validBase, environment: 'invalid-env' }),
    EdgeSecurityConfigError,
  );

  // 3. Invalid station type
  assert.throws(
    () =>
      validateEdgeConfig({
        ...validBase,
        station: { ...validBase.station, stationType: 'INVALID_TYPE' },
      }),
    EdgeSecurityConfigError,
  );

  // 4. Unknown root property
  assert.throws(
    () => validateEdgeConfig({ ...validBase, unrecognizedField: 'prohibited' }),
    (err: Error) =>
      err instanceof EdgeSecurityConfigError &&
      err.message.includes('Unrecognized root configuration property'),
  );
});

// ============================================================================
// 11. Worker Process Separation Scaffold (ADR-003 Sec. 8)
// ============================================================================
test('WP007-T22: EdgeWorkerSupervisor manages process decoupling without blocking main thread', () => {
  const supervisor = new EdgeWorkerSupervisor({
    workerId: 'hardware-worker-01',
    maxQueueDepth: 5,
  });

  assert.equal(supervisor.getStatus(), 'uninitialized');
  supervisor.start();
  assert.equal(supervisor.getStatus(), 'running');

  supervisor.enqueueTask();
  supervisor.enqueueTask();
  const hb = supervisor.getHeartbeat();
  assert.equal(hb.workerId, 'hardware-worker-01');
  assert.equal(hb.status, 'running');
  assert.equal(hb.taskQueueDepth, 2);

  supervisor.completeTask();
  assert.equal(supervisor.getHeartbeat().taskQueueDepth, 1);

  supervisor.stop();
  assert.equal(supervisor.getStatus(), 'stopped');
});
