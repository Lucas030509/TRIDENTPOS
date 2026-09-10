/**
 * TRIDENTPOS Edge Host Hardened Preload Script (CommonJS for Electron Sandbox)
 * Authoritative implementation per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 *
 * Rules:
 * - Never expose raw ipcRenderer or Node.js process / require
 * - Never expose generic send() or invoke()
 * - Strictly typed functions invoking only allowlisted channels
 */

const { contextBridge, ipcRenderer } = require('electron');

const EDGE_IPC_CHANNELS = Object.freeze({
  PING: 'trident:ping',
  GET_SYSTEM_METADATA: 'trident:get-system-metadata',
  GET_HEALTH_STATUS: 'trident:get-health-status',
});

const tridentBridgeApi = Object.freeze({
  async ping(request) {
    if (!request || typeof request.nonce !== 'string') {
      throw new Error("Invalid ping request: 'nonce' string is required.");
    }
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      return ipcRenderer.invoke(EDGE_IPC_CHANNELS.PING, { nonce: request.nonce });
    }
    return { nonce: request.nonce, timestamp: Date.now() };
  },

  async getSystemMetadata() {
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      return ipcRenderer.invoke(EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA);
    }
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node,
    };
  },

  async getHealthStatus() {
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

if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
  contextBridge.exposeInMainWorld('tridentBridge', tridentBridgeApi);
}

module.exports = {
  tridentBridgeApi,
  EDGE_IPC_CHANNELS,
};
