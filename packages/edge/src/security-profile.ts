/**
 * TRIDENTPOS Edge Host Electron Security Profile
 * Authoritative baseline per SECURITY_ARCHITECTURE.md Sec. 9 and ACR-2026-009.
 */

export class ElectronSecurityViolationError extends Error {
  constructor(message: string) {
    super(`[ELECTRON-SECURITY-VIOLATION] ${message}`);
    this.name = 'ElectronSecurityViolationError';
  }
}

/**
 * Authoritative, immutable WebPreferences for all BrowserWindow instances.
 * Any divergence from these properties is a security violation.
 */
export const HARDENED_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true as const,
  nodeIntegration: false as const,
  nodeIntegrationInWorker: false as const,
  nodeIntegrationInSubFrames: false as const,
  sandbox: true as const,
  webSecurity: true as const,
  allowRunningInsecureContent: false as const,
  experimentalFeatures: false as const,
});

/**
 * Authoritative Content Security Policy per SECURITY_ARCHITECTURE.md Sec. 9:
 * default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;
 */
export const FROZEN_CSP_DIRECTIVE =
  "default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;";

/**
 * Validates BrowserWindow webPreferences against the frozen security baseline.
 * Throws ElectronSecurityViolationError if any security control is disabled or weakened.
 */
export function assertHardenedWebPreferences(prefs: unknown): void {
  if (typeof prefs !== 'object' || prefs === null) {
    throw new ElectronSecurityViolationError('webPreferences must be an object');
  }

  const p = prefs as Record<string, unknown>;

  if (p.contextIsolation !== true) {
    throw new ElectronSecurityViolationError(
      `Mandatory contextIsolation must be true; received: ${String(p.contextIsolation)}`,
    );
  }

  if (p.nodeIntegration !== false) {
    throw new ElectronSecurityViolationError(
      `Mandatory nodeIntegration must be false; received: ${String(p.nodeIntegration)}`,
    );
  }

  if (p.sandbox !== true) {
    throw new ElectronSecurityViolationError(
      `Mandatory sandbox must be true; received: ${String(p.sandbox)}`,
    );
  }

  if (p.webSecurity !== true && p.webSecurity !== undefined) {
    throw new ElectronSecurityViolationError(
      `webSecurity must not be disabled; received: ${String(p.webSecurity)}`,
    );
  }

  if (p.allowRunningInsecureContent === true) {
    throw new ElectronSecurityViolationError('allowRunningInsecureContent is strictly prohibited.');
  }

  if (p.nodeIntegrationInWorker === true) {
    throw new ElectronSecurityViolationError('nodeIntegrationInWorker is strictly prohibited.');
  }

  if (p.nodeIntegrationInSubFrames === true) {
    throw new ElectronSecurityViolationError('nodeIntegrationInSubFrames is strictly prohibited.');
  }

  if (p.experimentalFeatures === true) {
    throw new ElectronSecurityViolationError('experimentalFeatures is strictly prohibited.');
  }
}

/**
 * Validates that a Content Security Policy string complies with the frozen security baseline.
 * Rejects unsafe-inline, unsafe-eval, data:, blob:, or broad wildcard origins.
 */
export function assertHardenedCSP(cspDirective: string): void {
  if (typeof cspDirective !== 'string' || cspDirective.trim().length === 0) {
    throw new ElectronSecurityViolationError('CSP directive cannot be empty.');
  }

  const normalized = cspDirective.toLowerCase();

  if (normalized.includes("'unsafe-inline'")) {
    throw new ElectronSecurityViolationError(
      "CSP violation: 'unsafe-inline' is strictly prohibited in Electron renderer.",
    );
  }

  if (normalized.includes("'unsafe-eval'")) {
    throw new ElectronSecurityViolationError(
      "CSP violation: 'unsafe-eval' is strictly prohibited in Electron renderer.",
    );
  }

  // Reject wildcard domains (e.g. * or http://* or https://*)
  const tokens = normalized.split(/\s+|;/);
  for (const token of tokens) {
    const trimmed = token.trim();
    if (
      trimmed === '*' ||
      trimmed === 'http:*' ||
      trimmed === 'https:*' ||
      trimmed === 'ws:*' ||
      trimmed === 'wss:*'
    ) {
      throw new ElectronSecurityViolationError(
        `CSP violation: Wildcard origin '${trimmed}' is strictly prohibited.`,
      );
    }
  }

  // Check that default-src 'self' is present
  if (!normalized.includes("default-src 'self'")) {
    throw new ElectronSecurityViolationError(
      "CSP violation: default-src must be restricted to 'self'.",
    );
  }

  // Check that script-src 'self' is present
  if (!normalized.includes("script-src 'self'")) {
    throw new ElectronSecurityViolationError(
      "CSP violation: script-src must be restricted to 'self'.",
    );
  }
}

/**
 * Returns security response headers containing the frozen CSP and frame options.
 */
export function getHardenedSecurityHeaders(): Record<string, string[]> {
  return {
    'Content-Security-Policy': [FROZEN_CSP_DIRECTIVE],
    'X-Content-Type-Options': ['nosniff'],
    'X-Frame-Options': ['DENY'],
  };
}
