/**
 * TRIDENTPOS Edge Host Electron Main Process Bootstrap
 * Authoritative implementation per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HARDENED_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  assertHardenedCSP,
  FROZEN_CSP_DIRECTIVE,
  getHardenedSecurityHeaders,
} from './security-profile.js';
import {
  EDGE_IPC_CHANNELS,
  IpcDispatchGuard,
  PingRequest,
  PingResponse,
  SystemMetadataResponse,
  HealthStatusResponse,
} from './ipc-channels.js';
import { handleNavigationAttempt, createWindowOpenHandler } from './navigation-lock.js';
import { loadEdgeConfigFile, EdgeRuntimeConfig } from './config.js';
import * as electronModule from 'electron';
import type Electron from 'electron';

interface ElectronNamespace {
  app?: typeof Electron.app;
  BrowserWindow?: typeof Electron.BrowserWindow;
  ipcMain?: typeof Electron.ipcMain;
  session?: typeof Electron.session;
  default?: ElectronNamespace;
}

const electronResolved: ElectronNamespace =
  typeof (electronModule as unknown as ElectronNamespace).default === 'object' &&
  (electronModule as unknown as ElectronNamespace).default !== null
    ? ((electronModule as unknown as ElectronNamespace).default as ElectronNamespace)
    : (electronModule as unknown as ElectronNamespace);

const app = electronResolved.app ?? (electronModule as unknown as ElectronNamespace).app;
const BrowserWindow =
  electronResolved.BrowserWindow ?? (electronModule as unknown as ElectronNamespace).BrowserWindow;
const ipcMain =
  electronResolved.ipcMain ?? (electronModule as unknown as ElectronNamespace).ipcMain;
const session =
  electronResolved.session ?? (electronModule as unknown as ElectronNamespace).session;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EdgeAppBootstrapOptions {
  configPath?: string;
  allowedOrigins?: string[];
  preloadPath?: string;
  htmlPath?: string;
}

export class EdgeApplicationHost {
  private config: EdgeRuntimeConfig;
  private ipcGuard = new IpcDispatchGuard();
  private mainWindow: Electron.BrowserWindow | null = null;
  private allowedOrigins: string[];
  private preloadPath: string;
  private htmlPath: string;

  constructor(options: EdgeAppBootstrapOptions = {}) {
    const defaultCfgPath = path.resolve(__dirname, '../edge-config.json');
    this.config = loadEdgeConfigFile(options.configPath ?? defaultCfgPath);
    this.allowedOrigins = options.allowedOrigins ?? ['file:'];
    const cjsPreload = path.join(__dirname, 'preload.cjs');
    const jsPreload = path.join(__dirname, 'preload.js');
    this.preloadPath = options.preloadPath ?? (fs.existsSync(cjsPreload) ? cjsPreload : jsPreload);
    this.htmlPath = options.htmlPath ?? path.join(__dirname, 'index.html');
    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    // 1. Register PING
    this.ipcGuard.registerHandler(EDGE_IPC_CHANNELS.PING, async (_event, payload) => {
      const pingReq = payload as PingRequest;
      const response: PingResponse = {
        nonce: pingReq.nonce,
        timestamp: Date.now(),
      };
      return response;
    });

    // 2. Register SYSTEM METADATA
    this.ipcGuard.registerHandler(EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA, async () => {
      const response: SystemMetadataResponse = {
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node,
      };
      return response;
    });

    // 3. Register HEALTH STATUS
    this.ipcGuard.registerHandler(EDGE_IPC_CHANNELS.GET_HEALTH_STATUS, async () => {
      const response: HealthStatusResponse = {
        status: 'healthy',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      };
      return response;
    });

    // Wire up with Electron ipcMain if running inside Electron runtime
    if (ipcMain && typeof ipcMain.handle === 'function') {
      for (const channel of this.ipcGuard.getRegisteredChannels()) {
        ipcMain.handle(channel, async (event: unknown, rawPayload: unknown) => {
          return this.ipcGuard.dispatch(channel, event, rawPayload);
        });
      }
    }
  }

  public getIpcGuard(): IpcDispatchGuard {
    return this.ipcGuard;
  }

  public getConfig(): EdgeRuntimeConfig {
    return this.config;
  }

  public createMainWindow(): Electron.BrowserWindow | null {
    const webPreferences = {
      ...HARDENED_WEB_PREFERENCES,
      preload: this.preloadPath,
    };

    // Strict validation prior to window construction
    assertHardenedWebPreferences(webPreferences);
    assertHardenedCSP(FROZEN_CSP_DIRECTIVE);

    if (!BrowserWindow) {
      return null;
    }

    const win = new BrowserWindow({
      width: this.config.window?.width ?? 1280,
      height: this.config.window?.height ?? 800,
      title: this.config.window?.title ?? 'TRIDENTPOS Edge Host',
      webPreferences,
    });

    // 1. Navigation Lockdown (will-navigate)
    win.webContents.on(
      'will-navigate',
      (event: { preventDefault: () => void; defaultPrevented?: boolean }, targetUrl: string) => {
        handleNavigationAttempt(event, targetUrl, {
          allowedOrigins: this.allowedOrigins,
          onViolation: (url, reason) => {
            console.warn(`[SECURITY VIOLATION] Denied navigation to '${url}': ${reason}`);
          },
        });
      },
    );

    // 2. Window Open / Popup Lockdown (default-deny)
    win.webContents.setWindowOpenHandler(
      createWindowOpenHandler((url) => {
        console.warn(`[SECURITY VIOLATION] Denied window.open to '${url}'`);
      }),
    );

    // 3. CSP Enforcement on Session Headers
    if (session && session.defaultSession) {
      session.defaultSession.webRequest.onHeadersReceived(
        (
          details: Electron.OnHeadersReceivedListenerDetails,
          callback: (headersReceivedResponse: Electron.HeadersReceivedResponse) => void,
        ) => {
          const securityHeaders = getHardenedSecurityHeaders();
          callback({
            responseHeaders: {
              ...details.responseHeaders,
              ...securityHeaders,
            },
          });
        },
      );
    }

    if (this.htmlPath && fs.existsSync(this.htmlPath)) {
      win.loadFile(this.htmlPath).catch((err: Error) => {
        console.warn(`[WARN] Failed to load HTML file '${this.htmlPath}': ${err.message}`);
      });
    }

    this.mainWindow = win;
    return win;
  }

  public getMainWindow(): Electron.BrowserWindow | null {
    return this.mainWindow;
  }
}

/**
 * Bootstrap function executed when invoked directly by Electron.
 */
export async function bootstrapEdgeHost(): Promise<EdgeApplicationHost> {
  const host = new EdgeApplicationHost();
  if (app) {
    await app.whenReady();
    host.createMainWindow();

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }
  return host;
}
