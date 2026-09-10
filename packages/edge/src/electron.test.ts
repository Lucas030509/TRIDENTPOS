/**
 * TRIDENTPOS WP-007 Actual Electron Runtime Security Validation Suite
 * Executes inside the actual Electron binary runtime to objectively prove:
 * - Real BrowserWindow security preferences
 * - Real renderer Node isolation
 * - Real preload contextBridge exposure
 * - Real IPC round-trip and escape-hatch denial
 * - Real will-navigate external navigation blocking
 * - Real window.open default-deny
 * - Real Content Security Policy enforcement in the renderer
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { EdgeApplicationHost } from './main.js';
import {
  HARDENED_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  ElectronSecurityViolationError,
} from './security-profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function recordPass(id: string, name: string): void {
  results.push({ id, name, passed: true });
  console.log(`✔ ${id}: ${name}`);
}

function recordFail(id: string, name: string, error: string): void {
  results.push({ id, name, passed: false, error });
  console.error(`✖ ${id}: ${name} — ${error}`);
}

async function runElectronRuntimeTests(): Promise<void> {
  console.log('\n============================================================');
  console.log('TRIDENTPOS WP-007: ACTUAL ELECTRON RUNTIME VALIDATION SUITE');
  console.log(`Electron Binary: ${process.versions.electron}`);
  console.log(`Embedded Node: ${process.versions.node}`);
  console.log(`Embedded Chromium: ${process.versions.chrome}`);
  console.log('============================================================\n');

  await app.whenReady();

  // Create the exact production application host and production window
  const htmlPath = path.resolve(__dirname, 'index.html');
  const host = new EdgeApplicationHost({
    htmlPath,
  });

  const win = host.createMainWindow();
  if (!win) {
    throw new Error('Failed to create production BrowserWindow: constructor returned null.');
  }

  // Wait for initial production document to load
  await new Promise<void>((resolve, reject) => {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, desc) =>
        reject(new Error(`Failed to load initial page: ${code} ${desc}`)),
      );
    } else {
      resolve();
    }
  });

  const initialUrl = win.webContents.getURL();

  // --------------------------------------------------------------------------
  // WP007-E01: production BrowserWindow effective preferences
  // --------------------------------------------------------------------------
  try {
    const wcAny = win.webContents as unknown as {
      getLastWebPreferences?: () => Record<string, unknown>;
      webPreferences?: Record<string, unknown>;
    };
    const webPrefs = (
      typeof wcAny.getLastWebPreferences === 'function'
        ? wcAny.getLastWebPreferences()
        : wcAny.webPreferences
    ) as Record<string, unknown> | null;
    if (!webPrefs) {
      throw new Error('getLastWebPreferences() returned null or undefined.');
    }

    if (webPrefs.contextIsolation !== true) {
      throw new Error(
        `Effective contextIsolation must be true; got ${String(webPrefs.contextIsolation)}`,
      );
    }
    if (webPrefs.nodeIntegration !== false) {
      throw new Error(
        `Effective nodeIntegration must be false; got ${String(webPrefs.nodeIntegration)}`,
      );
    }
    if (webPrefs.sandbox !== true) {
      throw new Error(`Effective sandbox must be true; got ${String(webPrefs.sandbox)}`);
    }
    if (webPrefs.webSecurity !== true && webPrefs.webSecurity !== undefined) {
      throw new Error(`Effective webSecurity must be true; got ${String(webPrefs.webSecurity)}`);
    }

    // Negative verification: proof that assertHardenedWebPreferences fails closed
    let threwOnWeakened = false;
    try {
      assertHardenedWebPreferences({ ...HARDENED_WEB_PREFERENCES, contextIsolation: false });
    } catch (e) {
      if (e instanceof ElectronSecurityViolationError) {
        threwOnWeakened = true;
      }
    }
    if (!threwOnWeakened) {
      throw new Error('assertHardenedWebPreferences failed to reject weakened contextIsolation.');
    }

    recordPass(
      'WP007-E01',
      'production BrowserWindow effective preferences (contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true)',
    );
  } catch (err) {
    recordFail(
      'WP007-E01',
      'production BrowserWindow effective preferences',
      (err as Error).message,
    );
  }

  // --------------------------------------------------------------------------
  // WP007-E02: real renderer Node isolation
  // --------------------------------------------------------------------------
  try {
    const leakedTypes = (await win.webContents.executeJavaScript(`
      ({
        requireType: typeof window.require,
        processType: typeof window.process,
        bufferType: typeof window.Buffer,
        ipcRendererType: typeof window.ipcRenderer,
        childProcessType: typeof window.child_process,
        fsType: typeof window.fs
      })
    `)) as Record<string, string>;

    for (const [key, val] of Object.entries(leakedTypes)) {
      if (val !== 'undefined') {
        throw new Error(`Leaked Node primitive in renderer context: ${key} = ${val}`);
      }
    }

    // Attempting require('node:fs') must be caught and blocked
    const requireBlocked = (await win.webContents.executeJavaScript(`
      (() => {
        try {
          if (typeof require !== 'undefined') {
            require('node:fs');
            return 'leaked';
          }
          return 'isolated';
        } catch (e) {
          return 'isolated';
        }
      })()
    `)) as string;

    if (requireBlocked !== 'isolated') {
      throw new Error("Direct require('node:fs') was not blocked in the real renderer.");
    }

    recordPass(
      'WP007-E02',
      'real renderer Node isolation (zero access to require, process, Buffer, fs, child_process, ipcRenderer)',
    );
  } catch (err) {
    recordFail('WP007-E02', 'real renderer Node isolation', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E03: real preload / contextBridge surface
  // --------------------------------------------------------------------------
  try {
    const bridgeSurface = (await win.webContents.executeJavaScript(`
      ({
        hasBridge: typeof window.tridentBridge !== 'undefined',
        pingType: typeof window.tridentBridge?.ping,
        metadataType: typeof window.tridentBridge?.getSystemMetadata,
        healthType: typeof window.tridentBridge?.getHealthStatus,
        sendType: typeof window.tridentBridge?.send,
        invokeType: typeof window.tridentBridge?.invoke,
        onType: typeof window.tridentBridge?.on,
        ipcRendererType: typeof window.tridentBridge?.ipcRenderer,
        rawIpcType: typeof window.tridentBridge?.rawIpc
      })
    `)) as Record<string, unknown>;

    if (bridgeSurface.hasBridge !== true) {
      throw new Error('window.tridentBridge is missing in the real renderer.');
    }
    if (bridgeSurface.pingType !== 'function') {
      throw new Error('window.tridentBridge.ping is not a function.');
    }
    if (bridgeSurface.metadataType !== 'function') {
      throw new Error('window.tridentBridge.getSystemMetadata is not a function.');
    }
    if (bridgeSurface.healthType !== 'function') {
      throw new Error('window.tridentBridge.getHealthStatus is not a function.');
    }
    if (bridgeSurface.sendType !== 'undefined') {
      throw new Error("Dangerous generic 'send' method exposed on window.tridentBridge.");
    }
    if (bridgeSurface.invokeType !== 'undefined') {
      throw new Error("Dangerous generic 'invoke' method exposed on window.tridentBridge.");
    }
    if (bridgeSurface.onType !== 'undefined') {
      throw new Error("Dangerous generic 'on' listener exposed on window.tridentBridge.");
    }
    if (bridgeSurface.ipcRendererType !== 'undefined' || bridgeSurface.rawIpcType !== 'undefined') {
      throw new Error('Raw ipcRenderer leaked through window.tridentBridge.');
    }

    recordPass(
      'WP007-E03',
      'real preload/contextBridge surface (window.tridentBridge present with exact allowed methods, zero generic send/invoke)',
    );
  } catch (err) {
    recordFail('WP007-E03', 'real preload/contextBridge surface', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E04: approved IPC actual end-to-end round trip
  // --------------------------------------------------------------------------
  try {
    // 1. E2E PING through real renderer bridge
    const pingResponse = (await win.webContents.executeJavaScript(`
      window.tridentBridge.ping({ nonce: 'sec-val-07-e2e-nonce' })
    `)) as { nonce: string; timestamp: number };

    if (!pingResponse || pingResponse.nonce !== 'sec-val-07-e2e-nonce') {
      throw new Error(`Ping E2E response mismatch: ${JSON.stringify(pingResponse)}`);
    }
    if (typeof pingResponse.timestamp !== 'number' || pingResponse.timestamp <= 0) {
      throw new Error('Ping timestamp invalid or missing in E2E response.');
    }

    // 2. E2E SYSTEM METADATA
    const metaResponse = (await win.webContents.executeJavaScript(`
      window.tridentBridge.getSystemMetadata()
    `)) as { platform: string; arch: string; electronVersion: string; nodeVersion: string };

    if (!metaResponse || typeof metaResponse.platform !== 'string') {
      throw new Error(`System metadata invalid: ${JSON.stringify(metaResponse)}`);
    }
    if (metaResponse.electronVersion !== process.versions.electron) {
      throw new Error(
        `Electron version mismatch in metadata: expected ${process.versions.electron}, got ${metaResponse.electronVersion}`,
      );
    }

    // 3. E2E HEALTH STATUS
    const healthResponse = (await win.webContents.executeJavaScript(`
      window.tridentBridge.getHealthStatus()
    `)) as { status: string; uptimeSeconds: number; timestamp: string };

    if (!healthResponse || healthResponse.status !== 'healthy') {
      throw new Error(`Health status invalid: ${JSON.stringify(healthResponse)}`);
    }

    recordPass(
      'WP007-E04',
      'approved IPC actual end-to-end round trip (renderer -> contextBridge -> preload -> ipcRenderer -> ipcMain -> response)',
    );
  } catch (err) {
    recordFail('WP007-E04', 'approved IPC actual end-to-end round trip', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E05: arbitrary IPC escape hatch unavailable
  // --------------------------------------------------------------------------
  try {
    const escapeHatchAudit = (await win.webContents.executeJavaScript(`
      ({
        rawIpcRenderer: typeof window.ipcRenderer !== 'undefined',
        canCallSend: typeof window.tridentBridge?.send === 'function',
        canCallInvoke: typeof window.tridentBridge?.invoke === 'function',
        arbitraryChannelCall: (() => {
          try {
            if (typeof window.tridentBridge?.invoke === 'function') {
              window.tridentBridge.invoke('arbitrary:channel');
              return 'possible';
            }
            return 'blocked';
          } catch {
            return 'blocked';
          }
        })()
      })
    `)) as {
      rawIpcRenderer: boolean;
      canCallSend: boolean;
      canCallInvoke: boolean;
      arbitraryChannelCall: string;
    };

    if (escapeHatchAudit.rawIpcRenderer) {
      throw new Error('raw ipcRenderer is accessible in renderer window.');
    }
    if (escapeHatchAudit.canCallSend || escapeHatchAudit.canCallInvoke) {
      throw new Error('Generic send or invoke methods are exposed on bridge.');
    }
    if (escapeHatchAudit.arbitraryChannelCall !== 'blocked') {
      throw new Error('Arbitrary IPC channel call was not blocked.');
    }

    recordPass(
      'WP007-E05',
      'arbitrary IPC escape hatch unavailable (raw ipcRenderer absent, generic invoke/send absent)',
    );
  } catch (err) {
    recordFail('WP007-E05', 'arbitrary IPC escape hatch unavailable', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E06: external navigation blocked
  // --------------------------------------------------------------------------
  try {
    let willNavigateTriggered = false;
    let willNavigatePrevented = false;

    // Attach a spy on the existing will-navigate listener chain
    win.webContents.on('will-navigate', (event) => {
      willNavigateTriggered = true;
      if (event.defaultPrevented) {
        willNavigatePrevented = true;
      }
    });

    // Trigger unauthorized navigation from the renderer
    await win.webContents.executeJavaScript(`
      (() => {
        try {
          window.location.href = 'https://unauthorized-external-test.tridentpos.invalid/';
        } catch (e) {
          // Synchronous navigation block handled
        }
      })()
    `);

    // Give Electron event loop time to process navigation attempt
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (!willNavigateTriggered) {
      throw new Error('will-navigate event was not invoked upon unauthorized navigation attempt.');
    }
    if (!willNavigatePrevented) {
      throw new Error('will-navigate event was not prevented by navigation lockdown handler.');
    }

    // Window must not have navigated to the unauthorized URL
    const currentUrl = win.webContents.getURL();
    if (currentUrl.includes('unauthorized-external-test.tridentpos.invalid')) {
      throw new Error(`Window navigated to prohibited external URL: ${currentUrl}`);
    }

    // Verify window remains on authorized local origin
    if (currentUrl !== initialUrl) {
      throw new Error(`Window strayed from authorized local origin: ${currentUrl}`);
    }

    recordPass(
      'WP007-E06',
      'external navigation blocked (will-navigate intercepts unauthorized destination, remains on local origin)',
    );
  } catch (err) {
    recordFail('WP007-E06', 'external navigation blocked', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E07: window.open / new window blocked
  // --------------------------------------------------------------------------
  try {
    const initialWindowCount = BrowserWindow.getAllWindows().length;

    // Execute window.open towards unauthorized target in the real renderer
    await win.webContents.executeJavaScript(`
      (() => {
        try {
          return window.open('https://unauthorized-popup-test.tridentpos.invalid', '_blank');
        } catch (e) {
          return null;
        }
      })()
    `);

    // Give Electron event loop time to process any potential popup
    await new Promise((resolve) => setTimeout(resolve, 150));

    const finalWindowCount = BrowserWindow.getAllWindows().length;
    if (finalWindowCount > initialWindowCount) {
      throw new Error(
        `Unauthorized secondary window was created! Window count increased from ${initialWindowCount} to ${finalWindowCount}`,
      );
    }

    recordPass(
      'WP007-E07',
      'window.open/new window blocked (setWindowOpenHandler denies popup creation)',
    );
  } catch (err) {
    recordFail('WP007-E07', 'window.open/new window blocked', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // WP007-E08: effective CSP verified in real renderer
  // --------------------------------------------------------------------------
  try {
    // 1. Inspect CSP directive from renderer meta tag
    const cspMetaContent = (await win.webContents.executeJavaScript(`
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || ''
    `)) as string;

    if (!cspMetaContent.includes("default-src 'self'")) {
      throw new Error(`Effective CSP does not enforce default-src 'self': ${cspMetaContent}`);
    }
    if (!cspMetaContent.includes("script-src 'self'")) {
      throw new Error(`Effective CSP does not enforce script-src 'self': ${cspMetaContent}`);
    }
    if (cspMetaContent.includes("'unsafe-inline'") || cspMetaContent.includes("'unsafe-eval'")) {
      throw new Error(`Effective CSP permits unsafe keywords: ${cspMetaContent}`);
    }

    // 2. Test that dynamic eval() execution is rejected in the real renderer
    const evalExecutionResult = (await win.webContents.executeJavaScript(`
      (() => {
        try {
          const fn = new Function('return 42');
          return fn() === 42 ? 'eval-permitted' : 'eval-blocked';
        } catch (e) {
          return 'eval-blocked';
        }
      })()
    `)) as string;

    // Notice: with strict CSP without unsafe-eval, dynamic Function/eval is blocked
    // In Chromium sandbox, Function/eval without unsafe-eval triggers EvalError
    if (evalExecutionResult === 'eval-permitted') {
      // In sandbox if Function was allowed, let's verify eval directly
      const directEvalResult = (await win.webContents.executeJavaScript(`
        (() => {
          try {
            eval('1 + 1');
            return 'eval-permitted';
          } catch (e) {
            return 'eval-blocked';
          }
        })()
      `)) as string;
      if (directEvalResult === 'eval-permitted') {
        throw new Error('CSP failed to block dynamic eval() in renderer.');
      }
    }

    recordPass(
      'WP007-E08',
      'effective CSP verified in real renderer (eval blocked by Content Security Policy, strict self-only policy active)',
    );
  } catch (err) {
    recordFail('WP007-E08', 'effective CSP verified in real renderer', (err as Error).message);
  }

  // --------------------------------------------------------------------------
  // Summary & Teardown
  // --------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(
    `Actual Electron Runtime Tests: ${total} total | ${passed} passed | ${failed} failed | 0 skipped`,
  );
  console.log('------------------------------------------------------------\n');

  win.destroy();
  app.quit();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Global exception catch to fail closed
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION IN ELECTRON TEST HARNESS]:', err);
  app.quit();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION IN ELECTRON TEST HARNESS]:', reason);
  app.quit();
  process.exit(1);
});

// Run test suite
runElectronRuntimeTests().catch((err) => {
  console.error('[FATAL ERROR IN ELECTRON TEST RUNNER]:', err);
  app.quit();
  process.exit(1);
});
