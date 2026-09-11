/**
 * TRIDENTPOS Edge mDNS Discovery & Advertising
 * Implements LAN discovery via Bonjour / Multicast DNS per SECURITY_ARCHITECTURE.md Sec. 3.2.
 */

import { Bonjour, Service } from 'bonjour-service';

export interface EdgeMdnsAdvertiserOptions {
  readonly branchId: string;
  readonly edgeId: string;
  readonly port: number;
  readonly fingerprint: string;
}

export class EdgeMdnsAdvertiser {
  readonly #bonjour: Bonjour;
  readonly #branchId: string;
  readonly #edgeId: string;
  readonly #port: number;
  readonly #fingerprint: string;

  #service: Service | null = null;

  constructor(options: EdgeMdnsAdvertiserOptions) {
    this.#bonjour = new Bonjour();
    this.#branchId = options.branchId;
    this.#edgeId = options.edgeId;
    this.#port = options.port;
    this.#fingerprint = options.fingerprint;
  }

  public start(): void {
    if (this.#service) return;

    this.#service = this.#bonjour.publish({
      name: `TRIDENT-EDGE-${this.#branchId}-${this.#edgeId}`,
      type: 'trident-pos-edge',
      port: this.#port,
      txt: {
        branchId: this.#branchId,
        edgeId: this.#edgeId,
        fingerprint: this.#fingerprint,
      },
    });
  }

  public stop(): void {
    if (this.#service) {
      this.#service.stop();
      this.#service = null;
    }
    this.#bonjour.destroy();
  }
}

export interface DiscoveredEdgeHost {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly branchId?: string;
  readonly edgeId?: string;
  readonly fingerprint?: string;
}

export class EdgeMdnsBrowser {
  readonly #bonjour: Bonjour;

  constructor() {
    this.#bonjour = new Bonjour();
  }

  public async findCandidate(timeoutMs = 3000): Promise<DiscoveredEdgeHost | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const browser = this.#bonjour.find({ type: 'trident-pos-edge' }, (service) => {
        if (!resolved) {
          resolved = true;
          browser.stop();
          resolve({
            name: service.name,
            host: service.host || (service.addresses && service.addresses[0]) || '127.0.0.1',
            port: service.port,
            branchId: service.txt?.branchId,
            edgeId: service.txt?.edgeId,
            fingerprint: service.txt?.fingerprint,
          });
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          browser.stop();
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  public destroy(): void {
    this.#bonjour.destroy();
  }
}
