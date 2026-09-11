/**
 * TRIDENTPOS Edge TLS Identity Manager
 * Governed by SECURITY_ARCHITECTURE.md Sec. 3 (R2F-01) and ADR-005.
 * Provides the authoritative TLS certificate and private key presented by the Edge Server.
 */

import { GeneratedTlsIdentity, generateSelfSignedX509Certificate } from './crypto.js';

export interface EdgeTlsConfig {
  readonly commonName?: string;
  readonly organization?: string;
  readonly extraDnsSans?: readonly string[];
  readonly extraIpSans?: readonly string[];
}

export class EdgeTlsIdentityManager {
  readonly #identity: GeneratedTlsIdentity;

  constructor(identityOrConfig?: GeneratedTlsIdentity | EdgeTlsConfig) {
    if (identityOrConfig && 'keyPem' in identityOrConfig) {
      this.#identity = identityOrConfig;
    } else {
      this.#identity = generateSelfSignedX509Certificate(
        identityOrConfig as EdgeTlsConfig | undefined,
      );
    }
  }

  public get fingerprint(): string {
    return this.#identity.fingerprint;
  }

  public get certPem(): string {
    return this.#identity.certPem;
  }

  public get keyPem(): string {
    return this.#identity.keyPem;
  }

  public get certDer(): Buffer {
    return this.#identity.certDer;
  }

  public getTlsCredentials(): { key: string; cert: string } {
    return {
      key: this.#identity.keyPem,
      cert: this.#identity.certPem,
    };
  }
}
