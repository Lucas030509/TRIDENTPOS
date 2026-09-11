/**
 * TRIDENTPOS Edge mDNS Discovery Service
 * Governed by ADR-005, SECURITY_ARCHITECTURE.md Sec. 3, and WP-009.
 *
 * ARCHITECTURAL INVARIANT: DISCOVERY IS NOT TRUST.
 * Candidate visibility in mDNS resolution MUST NEVER establish identity or authorization.
 * All candidates discovered via mDNS are strictly UNTRUSTED until their TLS certificate
 * fingerprint is independently validated against the physical pairing payload.
 */

import { Bonjour, Service } from 'bonjour-service';
import { MdnsCandidate } from './types.js';

export const TRIDENTPOS_MDNS_SERVICE_NAME = '_tridentpos._tcp.local';

export interface DiscoveryProvider {
  publish(candidate: MdnsCandidate): Promise<void>;
  unpublish(edgeId: string): Promise<void>;
  discover(timeoutMs?: number): Promise<readonly MdnsCandidate[]>;
  destroy(): Promise<void>;
}

/**
 * Production mDNS/Bonjour Discovery Provider.
 * Uses real LAN multicast DNS via pinned bonjour-service@1.4.4.
 */
export class BonjourMdnsProvider implements DiscoveryProvider {
  #bonjour: Bonjour | null = null;
  #publishedService: Service | null = null;

  public async publish(candidate: MdnsCandidate): Promise<void> {
    if (!this.#bonjour) {
      this.#bonjour = new Bonjour();
    }
    return new Promise((resolve, reject) => {
      try {
        this.#publishedService = this.#bonjour!.publish({
          name: `tridentpos-${candidate.edgeId}`,
          type: 'tridentpos',
          port: candidate.port,
          host: candidate.host,
          txt: {
            edgeId: candidate.edgeId,
            branchId: candidate.branchId ?? '',
            serviceName: candidate.serviceName ?? TRIDENTPOS_MDNS_SERVICE_NAME,
          },
        });
        this.#publishedService.on('up', () => resolve());
        this.#publishedService.on('error', (err) => reject(err));
      } catch (err) {
        reject(err);
      }
    });
  }

  public async unpublish(_edgeId: string): Promise<void> {
    if (this.#publishedService) {
      await new Promise<void>((res) => {
        this.#publishedService!.stop(() => res());
      });
      this.#publishedService = null;
    }
  }

  public async discover(timeoutMs = 2000): Promise<readonly MdnsCandidate[]> {
    if (!this.#bonjour) {
      this.#bonjour = new Bonjour();
    }
    const candidates: MdnsCandidate[] = [];
    return new Promise((resolve) => {
      const browser = this.#bonjour!.find({ type: 'tridentpos' }, (service) => {
        const txt = service.txt as Record<string, string> | undefined;
        const host = service.addresses?.[0] ?? service.host ?? '127.0.0.1';
        candidates.push({
          host,
          port: service.port,
          edgeId: txt?.edgeId ?? service.name,
          branchId: txt?.branchId,
          serviceName: txt?.serviceName ?? TRIDENTPOS_MDNS_SERVICE_NAME,
        });
      });

      setTimeout(() => {
        browser.stop();
        resolve(Object.freeze(candidates));
      }, timeoutMs);
    });
  }

  public async destroy(): Promise<void> {
    if (this.#publishedService) {
      await new Promise<void>((res) => {
        this.#publishedService!.stop(() => res());
      });
      this.#publishedService = null;
    }
    if (this.#bonjour) {
      this.#bonjour.destroy();
      this.#bonjour = null;
    }
  }
}

/**
 * Deterministic In-Memory Discovery Provider.
 * Exclusively for unit tests and isolated simulated networks.
 */
export class TestInMemoryDiscoveryProvider implements DiscoveryProvider {
  private static readonly globalRegistry = new Map<string, MdnsCandidate>();

  public async publish(candidate: MdnsCandidate): Promise<void> {
    TestInMemoryDiscoveryProvider.globalRegistry.set(candidate.edgeId, candidate);
  }

  public async unpublish(edgeId: string): Promise<void> {
    TestInMemoryDiscoveryProvider.globalRegistry.delete(edgeId);
  }

  public async discover(): Promise<readonly MdnsCandidate[]> {
    return Array.from(TestInMemoryDiscoveryProvider.globalRegistry.values());
  }

  public async destroy(): Promise<void> {
    TestInMemoryDiscoveryProvider.globalRegistry.clear();
  }

  public static clearAll(): void {
    TestInMemoryDiscoveryProvider.globalRegistry.clear();
  }
}

/** Backwards-compatible alias for existing test fixtures */
export const InMemoryDiscoveryProvider = TestInMemoryDiscoveryProvider;

export class MdnsDiscoveryService {
  readonly #provider: DiscoveryProvider;
  #currentCandidate: MdnsCandidate | null = null;

  constructor(provider?: DiscoveryProvider) {
    // Production default MUST be the real mDNS provider (R1-C)
    this.#provider = provider ?? new BonjourMdnsProvider();
  }

  /**
   * Returns the underlying discovery provider.
   */
  public get provider(): DiscoveryProvider {
    return this.#provider;
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
