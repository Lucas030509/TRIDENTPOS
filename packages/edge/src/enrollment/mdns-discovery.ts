/**
 * TRIDENTPOS Edge mDNS Discovery Service
 * Governed by ADR-005, SECURITY_ARCHITECTURE.md Sec. 3, and WP-009.
 *
 * ARCHITECTURAL INVARIANT: DISCOVERY IS NOT TRUST.
 * Candidate visibility in mDNS resolution MUST NEVER establish identity or authorization.
 * All candidates discovered via mDNS are strictly UNTRUSTED until their TLS certificate
 * fingerprint is independently validated against the physical pairing payload.
 */

import { MdnsCandidate } from './types.js';

export const TRIDENTPOS_MDNS_SERVICE_NAME = '_tridentpos._tcp.local';

export interface DiscoveryProvider {
  publish(candidate: MdnsCandidate): Promise<void>;
  unpublish(edgeId: string): Promise<void>;
  discover(timeoutMs?: number): Promise<readonly MdnsCandidate[]>;
  destroy(): Promise<void>;
}

/**
 * In-process / Local Discovery Provider.
 * Allows controlled, isolated, deterministic discovery advertisement and enumeration
 * without third-party network daemon dependencies.
 */
export class InMemoryDiscoveryProvider implements DiscoveryProvider {
  private static readonly globalRegistry = new Map<string, MdnsCandidate>();

  public async publish(candidate: MdnsCandidate): Promise<void> {
    InMemoryDiscoveryProvider.globalRegistry.set(candidate.edgeId, candidate);
  }

  public async unpublish(edgeId: string): Promise<void> {
    InMemoryDiscoveryProvider.globalRegistry.delete(edgeId);
  }

  public async discover(): Promise<readonly MdnsCandidate[]> {
    return Array.from(InMemoryDiscoveryProvider.globalRegistry.values());
  }

  public async destroy(): Promise<void> {
    InMemoryDiscoveryProvider.globalRegistry.clear();
  }

  public static clearAll(): void {
    InMemoryDiscoveryProvider.globalRegistry.clear();
  }
}

export class MdnsDiscoveryService {
  readonly #provider: DiscoveryProvider;
  #currentCandidate: MdnsCandidate | null = null;

  constructor(provider: DiscoveryProvider = new InMemoryDiscoveryProvider()) {
    this.#provider = provider;
  }

  /**
   * Advertises Edge Host presence on the local network.
   */
  public async advertise(candidate: MdnsCandidate): Promise<void> {
    this.#currentCandidate = candidate;
    await this.#provider.publish(candidate);
  }

  /**
   * Discovers candidate Edge hosts on the local network.
   * NOTE: Returned candidates are strictly UNTRUSTED.
   */
  public async discoverCandidates(timeoutMs?: number): Promise<readonly MdnsCandidate[]> {
    return this.#provider.discover(timeoutMs);
  }

  /**
   * Stops advertising and cleans up discovery resources.
   */
  public async stop(): Promise<void> {
    if (this.#currentCandidate) {
      await this.#provider.unpublish(this.#currentCandidate.edgeId);
      this.#currentCandidate = null;
    }
    await this.#provider.destroy();
  }
}
