/**
 * TRIDENTPOS Edge Host Proof Renderer
 * Demonstrates runtime boundary isolation per ACR-2026-009.
 */

import type { TridentBridgeApi } from './preload.js';

declare global {
  interface Window {
    tridentBridge?: TridentBridgeApi;
    require?: unknown;
    process?: unknown;
  }
}

export interface IsolationAuditResult {
  isolated: boolean;
  leakedPrimitives: string[];
}

/**
 * Proves that no privileged Node.js or raw Electron APIs leaked into the renderer execution context.
 */
export function auditRendererIsolation(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): IsolationAuditResult {
  const dangerousPrimitives = [
    'require',
    'process',
    'Buffer',
    'child_process',
    'fs',
    'net',
    'os',
    'crypto',
    'ipcRenderer',
  ];

  const leaked: string[] = [];

  for (const primitive of dangerousPrimitives) {
    if (typeof scope[primitive] !== 'undefined') {
      leaked.push(primitive);
    }
  }

  return {
    isolated: leaked.length === 0,
    leakedPrimitives: leaked,
  };
}

/**
 * Proof bootstrap executed when renderer page loads.
 */
export async function bootstrapProofRenderer(): Promise<{
  isolation: IsolationAuditResult;
  bridgeAvailable: boolean;
}> {
  const isolation = auditRendererIsolation();
  const bridgeAvailable = typeof (globalThis as unknown as Window).tridentBridge !== 'undefined';

  return {
    isolation,
    bridgeAvailable,
  };
}
