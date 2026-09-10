/**
 * TRIDENTPOS Edge Host IPC Channels and Dispatch Guard
 * Statically allowlisted channels and payload validators per ACR-2026-009.
 */

import { ElectronSecurityViolationError } from './security-profile.js';

export const EDGE_IPC_CHANNELS = Object.freeze({
  PING: 'trident:ping',
  GET_SYSTEM_METADATA: 'trident:get-system-metadata',
  GET_HEALTH_STATUS: 'trident:get-health-status',
} as const);

export type AllowedIpcChannel = (typeof EDGE_IPC_CHANNELS)[keyof typeof EDGE_IPC_CHANNELS];

export const ALLOWED_IPC_CHANNELS = new Set<string>(Object.values(EDGE_IPC_CHANNELS));

export interface PingRequest {
  nonce: string;
}

export interface PingResponse {
  nonce: string;
  timestamp: number;
}

export interface SystemMetadataResponse {
  platform: string;
  arch: string;
  electronVersion: string;
  nodeVersion: string;
}

export interface HealthStatusResponse {
  status: 'healthy';
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Validates whether a channel is in the static allowlist.
 */
export function isAllowedIpcChannel(channel: string): channel is AllowedIpcChannel {
  return typeof channel === 'string' && ALLOWED_IPC_CHANNELS.has(channel);
}

/**
 * Validates payload for ping requests.
 */
export function validatePingPayload(payload: unknown): PingRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ElectronSecurityViolationError('Ping payload must be a non-null object');
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.nonce !== 'string' || obj.nonce.length === 0 || obj.nonce.length > 64) {
    throw new ElectronSecurityViolationError(
      "Ping payload 'nonce' must be a non-empty string <= 64 chars",
    );
  }
  return { nonce: obj.nonce };
}

/**
 * Validates payload based on channel requirements.
 */
export function validateIpcPayload(channel: string, payload: unknown): unknown {
  switch (channel) {
    case EDGE_IPC_CHANNELS.PING:
      return validatePingPayload(payload);
    case EDGE_IPC_CHANNELS.GET_SYSTEM_METADATA:
    case EDGE_IPC_CHANNELS.GET_HEALTH_STATUS:
      // These read-only requests accept empty / undefined payloads only
      if (
        payload !== undefined &&
        payload !== null &&
        (typeof payload !== 'object' || Object.keys(payload as object).length > 0)
      ) {
        throw new ElectronSecurityViolationError(
          `Channel '${channel}' does not accept input parameters.`,
        );
      }
      return undefined;
    default:
      throw new ElectronSecurityViolationError(
        `Cannot validate payload: unapproved channel '${channel}'`,
      );
  }
}

export type IpcHandlerFn = (
  event: unknown,
  validatedPayload: unknown,
) => Promise<unknown> | unknown;

/**
 * Dispatch guard that enforces static channel allowlisting and payload sanitization
 * at the trusted main process boundary.
 */
export class IpcDispatchGuard {
  private handlers = new Map<string, IpcHandlerFn>();

  /**
   * Registers a handler for an allowlisted channel.
   * Throws if attempting to register a non-allowlisted channel.
   */
  public registerHandler(channel: string, handler: IpcHandlerFn): void {
    if (!isAllowedIpcChannel(channel)) {
      throw new ElectronSecurityViolationError(
        `Registration rejected: Channel '${channel}' is not in the static allowlist.`,
      );
    }
    this.handlers.set(channel, handler);
  }

  /**
   * Dispatches an incoming IPC call from renderer, enforcing fail-closed checks.
   */
  public async dispatch(channel: string, event: unknown, rawPayload: unknown): Promise<unknown> {
    // 1. Channel Allowlist Check
    if (!isAllowedIpcChannel(channel)) {
      throw new ElectronSecurityViolationError(
        `IPC Security Rejection: Channel '${channel}' is unauthorized and not allowlisted.`,
      );
    }

    // 2. Payload Validation at Trusted Boundary
    const validated = validateIpcPayload(channel, rawPayload);

    // 3. Handler Resolution
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new ElectronSecurityViolationError(
        `IPC Handler Error: No handler registered for allowlisted channel '${channel}'.`,
      );
    }

    // 4. Safe Execution
    return handler(event, validated);
  }

  public getRegisteredChannels(): string[] {
    return Array.from(this.handlers.keys());
  }
}
