/**
 * TRIDENTPOS Edge Host TLS Identity Manager
 * Manages ECDSA P-256 self-signed TLS certificates and private keys.
 * Enforces fail-closed semantics on missing or corrupt keys (EdgeTlsKeyMissingOrCorrupted).
 * Prohibits silent TLS regeneration on active nodes.
 * Conforms to SECRETS_AND_KEY_MANAGEMENT.md Sec. 4 and SECURITY_ARCHITECTURE.md Sec. 3.2.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EdgeSecureStore } from './secure-store.js';
import { computeCertificateFingerprint, generateSelfSignedX509Certificate } from './crypto.js';
import { EdgeTlsKeyMissingOrCorruptedError } from './types.js';

export interface EdgeTlsIdentityOptions {
  readonly certDir: string;
  readonly secureStore: EdgeSecureStore;
  readonly commonName?: string;
  readonly organization?: string;
  readonly extraDnsSans?: readonly string[];
  readonly extraIpSans?: readonly string[];
}

export class EdgeTlsIdentityManager {
  readonly #certDir: string;
  readonly #secureStore: EdgeSecureStore;
  readonly #commonName: string;
  readonly #organization: string;
  readonly #extraDnsSans: readonly string[];
  readonly #extraIpSans: readonly string[];

  #certPem: string | null = null;
  #certDer: Buffer | null = null;
  #fingerprint: string | null = null;
  #privateKeyPem: string | null = null;

  constructor(options: EdgeTlsIdentityOptions) {
    this.#certDir = path.resolve(options.certDir);
    this.#secureStore = options.secureStore;
    this.#commonName = options.commonName ?? 'TRIDENTPOS-Edge';
    this.#organization = options.organization ?? 'TRIDENTPOS';
    this.#extraDnsSans = options.extraDnsSans ?? [];
    this.#extraIpSans = options.extraIpSans ?? [];

    if (!fs.existsSync(this.#certDir)) {
      fs.mkdirSync(this.#certDir, { recursive: true });
    }

    this.#loadOrInitialize();
  }

  #certPemPath(): string {
    return path.join(this.#certDir, 'edge_tls_cert.pem');
  }

  #certDerPath(): string {
    return path.join(this.#certDir, 'edge_tls_cert.der');
  }

  #loadOrInitialize(): void {
    const certPemFile = this.#certPemPath();
    const certDerFile = this.#certDerPath();
    const hasCertFiles = fs.existsSync(certPemFile) && fs.existsSync(certDerFile);
    const hasPrivateKey = this.#secureStore.hasSecret('edge_tls_private_key');

    // Case 1: Active node state — certificate files exist
    if (hasCertFiles) {
      if (!hasPrivateKey) {
        // Active node missing private key: FAIL CLOSED
        throw new EdgeTlsKeyMissingOrCorruptedError(
          'Active Edge node TLS private key is missing from EdgeSecureStore. Silent regeneration is strictly prohibited.',
        );
      }

      try {
        const keyBuffer = this.#secureStore.loadSecret('edge_tls_private_key');
        this.#privateKeyPem = keyBuffer.toString('utf8');
        this.#certPem = fs.readFileSync(certPemFile, 'utf8');
        this.#certDer = fs.readFileSync(certDerFile);
        this.#fingerprint = computeCertificateFingerprint(this.#certDer);
      } catch (err) {
        throw new EdgeTlsKeyMissingOrCorruptedError(
          `Failed to load active TLS private key or certificate: ${(err as Error).message}`,
          { cause: err },
        );
      }
      return;
    }

    // Case 2: Active node with private key but missing cert files
    if (hasPrivateKey) {
      throw new EdgeTlsKeyMissingOrCorruptedError(
        'TLS private key exists in EdgeSecureStore but certificate files are missing on disk. Inconsistent identity state.',
      );
    }

    // Case 3: Fresh first bootstrap — generate new identity
    const generated = generateSelfSignedX509Certificate({
      commonName: this.#commonName,
      organization: this.#organization,
      extraDnsSans: this.#extraDnsSans,
      extraIpSans: this.#extraIpSans,
    });

    this.#privateKeyPem = generated.keyPem;
    this.#certPem = generated.certPem;
    this.#certDer = generated.certDer;
    this.#fingerprint = generated.fingerprint;

    // Persist private key in EdgeSecureStore (OS keyring backed)
    this.#secureStore.storeSecret('edge_tls_private_key', Buffer.from(generated.keyPem, 'utf8'));

    // Persist public certificate files
    fs.writeFileSync(certPemFile, generated.certPem, 'utf8');
    fs.writeFileSync(certDerFile, generated.certDer);
  }

  /**
   * Returns public certificate in PEM format.
   */
  public getCertificatePem(): string {
    return this.#certPem!;
  }

  /**
   * Returns public certificate DER bytes.
   */
  public getCertificateDer(): Buffer {
    return this.#certDer!;
  }

  /**
   * Returns SHA-256 fingerprint in canonical "SHA256:XX:..." format.
   */
  public getFingerprint(): string {
    return this.#fingerprint!;
  }

  /**
   * Package-internal getter for Node.js https.createServer credentials.
   * Private key is never exported publicly or exposed via IPC.
   */
  public getTlsServerCredentials(): { cert: string; key: string } {
    return {
      cert: this.#certPem!,
      key: this.#privateKeyPem!,
    };
  }
}
