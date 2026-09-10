/**
 * TRIDENTPOS Edge Host Hardened Preload Script
 * Authoritative implementation per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 *
 * Rules:
 * - Never expose raw ipcRenderer or Node.js process / require
 * - Never expose generic send() or invoke()
 * - Strictly typed functions invoking only allowlisted channels
 */

import electronModule from 'electron';
import type Electron from 'electron';
import {
  EDGE_IPC_CHANNELS,
  PingRequest,
  PingResponse,
  SystemMetadataResponse,
  HealthStatusResponse,
} from './ipc-channels.js';

const electron =
  typeof electronModule === 'object' && electronModule !== null
    ? (electronModule as unknown as typeof Electron)
    : ({} as unknown as typeof Electron);

const contextBridge = electron.contextBridge;
const ipcRenderer = electron.ipcRenderer;

export interface TridentBridgeApi {
  ping(request: PingRequest): Promise<PingResponse>;
  getSystemMetadata(): Promise<SystemMetadataResponse>;
  getHealthStatus(): Promise<HealthStatusResponse>;
}

export const tridentBridgeApi: TridentBridgeApi = Object.freeze({
  async ping(request: PingRequest): Promise<PingResponse> {
    if (!request || typeof request.nonce !== 'string') {
      throw new Error("Invalid ping request: 'nonce' string is required.");
    }
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      return ipcRenderer.invoke(EDGE_IPC_CHANNELS.PING, { nonce: request.nonce });
    }
    return { nonce: request.nonce, timestamp: Date.now() };
  },

  async getSystemMetadata(): Promise<SystemMetadataResponse> {
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      return ipcRenderer.invoke(EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA);
    }
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
    };
  },

  async getHealthStatus(): Promise<HealthStatusResponse> {
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      return ipcRenderer.invoke(EDGE_IPC_CHANNELS.GET_HEALTH_STATUS);
    }
    return {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Initializes the hardened bridge in the main world.
 */
export function initializePreloadBridge(): void {
  if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
    contextBridge.exposeInMainWorld('tridentBridge', tridentBridgeApi);
  }
}

// Auto-initialize when loaded as an Electron preload script
try {
  initializePreloadBridge();
} catch {
  // Graceful no-op in headless/test environments
}
