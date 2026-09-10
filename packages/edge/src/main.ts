/**
 * TRIDENTPOS Edge Host Electron Main Process Bootstrap
 * Authoritative implementation per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronModule from 'electron';
import type Electron from 'electron';
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

const electron =
  typeof electronModule === 'object' && electronModule !== null
    ? (electronModule as unknown as typeof Electron)
    : ({} as unknown as typeof Electron);

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const session = electron.session;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EdgeAppBootstrapOptions {
  configPath?: string;
  allowedOrigins?: string[];
  preloadPath?: string;
}

export class EdgeApplicationHost {
  private config: EdgeRuntimeConfig;
  private ipcGuard = new IpcDispatchGuard();
  private mainWindow: Electron.BrowserWindow | null = null;
  private allowedOrigins: string[];
  private preloadPath: string;

  constructor(options: EdgeAppBootstrapOptions = {}) {
    const defaultCfgPath = path.resolve(__dirname, '../edge-config.json');
    this.config = loadEdgeConfigFile(options.configPath ?? defaultCfgPath);
    this.allowedOrigins = options.allowedOrigins ?? ['file:'];
    this.preloadPath = options.preloadPath ?? path.join(__dirname, 'preload.js');
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
        ipcMain.handle(channel, async (event, rawPayload) => {
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
    win.webContents.on('will-navigate', (event, targetUrl) => {
      handleNavigationAttempt(event, targetUrl, {
        allowedOrigins: this.allowedOrigins,
        onViolation: (url, reason) => {
          console.warn(`[SECURITY VIOLATION] Denied navigation to '${url}': ${reason}`);
        },
      });
    });

    // 2. Window Open / Popup Lockdown (default-deny)
    win.webContents.setWindowOpenHandler(
      createWindowOpenHandler((url) => {
        console.warn(`[SECURITY VIOLATION] Denied window.open to '${url}'`);
      }),
    );

    // 3. CSP Enforcement on Session Headers
    if (session && session.defaultSession) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const securityHeaders = getHardenedSecurityHeaders();
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            ...securityHeaders,
          },
        });
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
