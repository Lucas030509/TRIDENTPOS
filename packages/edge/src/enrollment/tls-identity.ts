/**
 * TRIDENTPOS Edge TLS Identity Manager
 * Internal to Edge Enrollment subsystem. Not exposed through public package index.
 * Generates and encapsulates native ECDSA P-256 self-signed X.509 v3 certificate.
 * Private key is strictly encapsulated in ECMAScript #private state.
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeCertificateFingerprint,
  extractCertificateDer,
  generateSelfSignedX509Certificate,
} from './crypto.js';

export interface EdgeTlsIdentityOptions {
  readonly commonName?: string;
  readonly storagePath?: string;
  readonly existingIdentity?: {
    readonly keyPem: string;
    readonly certPem: string;
  };
}

export class EdgeTlsIdentityManager {
  readonly #keyPem: string;
  readonly #certPem: string;
  readonly #certDer: Buffer;
  readonly #fingerprint: string;

  constructor(options: EdgeTlsIdentityOptions = {}) {
    if (options.existingIdentity) {
      this.#keyPem = options.existingIdentity.keyPem;
      this.#certPem = options.existingIdentity.certPem;
    } else if (options.storagePath) {
      const keyFile = path.join(options.storagePath, 'edge_tls_key.pem');
      const certFile = path.join(options.storagePath, 'edge_tls_cert.pem');

      if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
        this.#keyPem = fs.readFileSync(keyFile, 'utf8');
        this.#certPem = fs.readFileSync(certFile, 'utf8');
      } else {
        const generated = generateSelfSignedX509Certificate({
          commonName: options.commonName ?? 'TRIDENTPOS-Edge',
        });
        this.#keyPem = generated.keyPem;
        this.#certPem = generated.certPem;

        fs.mkdirSync(options.storagePath, { recursive: true });
        fs.writeFileSync(keyFile, this.#keyPem, { encoding: 'utf8', mode: 0o600 });
        fs.writeFileSync(certFile, this.#certPem, { encoding: 'utf8', mode: 0o644 });
      }
    } else {
      const generated = generateSelfSignedX509Certificate({
        commonName: options.commonName ?? 'TRIDENTPOS-Edge',
      });
      this.#keyPem = generated.keyPem;
      this.#certPem = generated.certPem;
    }

    this.#certDer = extractCertificateDer(this.#certPem);
    this.#fingerprint = computeCertificateFingerprint(this.#certDer);
  }

  /**
   * Public certificate in PEM format. Safe for distribution.
   */
  public get certPem(): string {
    return this.#certPem;
  }

  /**
   * Raw certificate DER bytes. Safe for distribution.
   */
  public get certDer(): Buffer {
    return Buffer.from(this.#certDer);
  }

  /**
   * Canonical SHA-256 certificate fingerprint in uppercase colon-separated format.
   */
  public get fingerprint(): string {
    return this.#fingerprint;
  }

  /**
   * Instantiates an HTTPS server bound to the internal TLS identity.
   * Private key never escapes this boundary.
   */
  public createHttpsServer(
    requestListener: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): https.Server {
    return https.createServer(
      {
        key: this.#keyPem,
        cert: this.#certPem,
      },
      requestListener,
    );
  }
}
