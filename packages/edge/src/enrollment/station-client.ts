/**
 * TRIDENTPOS Station Enrollment Client
 * Implements strict TLS pinning sequential order per SEC-INV-WP009-02 and SECURITY_ARCHITECTURE.md Sec. 3.2.
 * Invariants:
 * 1. Zero-data initial TLS probe to extract candidate cert and compute SHA-256 fingerprint.
 * 2. Constant-time fingerprint verification against physical QR payload.
 * 3. StationPinStore persistence verified BEFORE establishing second TLS connection.
 * 4. PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION.
 * 5. Second TLS connection strictly pinned to proven certificate (ca: [provenCertDer]).
 */

import tls from 'node:tls';
import https from 'node:https';
import { StationPinStore } from './secure-store.js';
import { computeCertificateFingerprint, derToPem, timingSafeSecretCompare } from './crypto.js';
import {
  EnrollmentError,
  EnrollmentQRPayload,
  EnrollmentSecurityError,
  StationEnrollmentRequest,
  StationEnrollmentResponse,
} from './types.js';

export interface StationEnrollmentClientOptions {
  readonly pinStore: StationPinStore;
  readonly host?: string;
  readonly port: number;
}

export class StationEnrollmentClient {
  readonly #pinStore: StationPinStore;
  readonly #host: string;
  readonly #port: number;

  // Internal test verification metrics
  #lastProbeApplicationBytesWritten = 0;
  #lastPinnedSecondConnectionCaUsed: Buffer | null = null;

  constructor(options: StationEnrollmentClientOptions) {
    this.#pinStore = options.pinStore;
    this.#host = options.host ?? '127.0.0.1';
    this.#port = options.port;
  }

  public getLastProbeApplicationBytesWritten(): number {
    return this.#lastProbeApplicationBytesWritten;
  }

  public getLastPinnedSecondConnectionCaUsed(): Buffer | null {
    return this.#lastPinnedSecondConnectionCaUsed;
  }

  /**
   * Executes the strict 5-step station trust bootstrap:
   * 1. Zero-data TLS probe -> extract cert DER & compute SHA-256 fingerprint.
   * 2. Constant-time compare fingerprint against QR payload. Mismatch -> abort immediately.
   * 3. Persist verified fingerprint in StationPinStore. Failure -> abort immediately without secret disclosure.
   * 4. Open second TLS connection pinned strictly to proven cert.
   * 5. Transmit pairing secret and receive station credentials.
   */
  public async enroll(
    qrPayload: EnrollmentQRPayload,
    stationDetails: {
      stationId: string;
      stationCode: string;
      stationType: string;
      stationPublicKey: string;
      organizationId: string;
    },
  ): Promise<StationEnrollmentResponse> {
    // -------------------------------------------------------------------------
    // Step 1: Zero-Data TLS Probe
    // -------------------------------------------------------------------------
    const probeResult = await this.#executeZeroDataTlsProbe();
    const candidateCertDer = probeResult.certDer;
    const candidateFingerprint = probeResult.fingerprint;
    this.#lastProbeApplicationBytesWritten = probeResult.applicationBytesWritten;

    if (this.#lastProbeApplicationBytesWritten !== 0) {
      throw new EnrollmentSecurityError(
        `Zero-data TLS probe violation: transmitted ${this.#lastProbeApplicationBytesWritten} bytes on initial inspection`,
      );
    }

    // -------------------------------------------------------------------------
    // Step 2: Constant-Time Fingerprint Comparison vs QR Payload
    // -------------------------------------------------------------------------
    const fingerprintMatches = timingSafeSecretCompare(
      candidateFingerprint.toUpperCase(),
      qrPayload.edgePublicKeyFingerprint.toUpperCase(),
    );

    if (!fingerprintMatches) {
      throw new EnrollmentSecurityError(
        `Rogue Edge rejected: candidate fingerprint '${candidateFingerprint}' does not match QR payload '${qrPayload.edgePublicKeyFingerprint}'`,
      );
    }

    // -------------------------------------------------------------------------
    // Step 3: Persist Verified Fingerprint in StationPinStore PRIOR to Secret Transmission
    // Invariant: PIN STORE FAILURE => ZERO SECRET DISCLOSURE + ZERO SERVER MUTATION
    // -------------------------------------------------------------------------
    const pinVerified = this.#pinStore.verifyOrPin(
      qrPayload.branchId,
      qrPayload.edgeId,
      candidateFingerprint,
    );

    if (!pinVerified) {
      throw new EnrollmentSecurityError(
        'Station pin store verification failed: stored pin mismatch',
      );
    }

    // -------------------------------------------------------------------------
    // Step 4: Second TLS Connection Strictly Pinned to Proven Certificate
    // -------------------------------------------------------------------------
    this.#lastPinnedSecondConnectionCaUsed = candidateCertDer;

    const requestPayload: StationEnrollmentRequest = {
      pairingId: qrPayload.pairingId,
      pairingSecret: qrPayload.pairingSecret,
      stationPublicKey: stationDetails.stationPublicKey,
      stationId: stationDetails.stationId,
      stationCode: stationDetails.stationCode,
      stationType: stationDetails.stationType,
      organizationId: stationDetails.organizationId,
      branchId: qrPayload.branchId,
      edgeId: qrPayload.edgeId,
    };

    // -------------------------------------------------------------------------
    // Step 5: Transmit Pairing Secret and Receive Station Token
    // -------------------------------------------------------------------------
    return this.#executePinnedEnrollmentRequest(candidateCertDer, requestPayload);
  }

  /**
   * Executes initial zero-application-data TLS probe.
   * Connects, extracts peer certificate, asserts zero application bytes written, and immediately destroys socket.
   */
  async #executeZeroDataTlsProbe(): Promise<{
    certDer: Buffer;
    fingerprint: string;
    applicationBytesWritten: number;
  }> {
    return new Promise((resolve, reject) => {
      let applicationBytesWritten = 0;

      const socket = tls.connect(
        {
          host: this.#host,
          port: this.#port,
          rejectUnauthorized: false, // Initial probe retrieves raw certificate for physical pinning check
          servername: 'localhost',
        },
        () => {
          try {
            const peerCert = socket.getPeerCertificate(true);
            if (!peerCert || !peerCert.raw) {
              socket.destroy();
              reject(
                new EnrollmentSecurityError(
                  'Zero-data TLS probe failed: no peer certificate presented',
                ),
              );
              return;
            }

            const certDer = Buffer.from(peerCert.raw);
            const fingerprint = computeCertificateFingerprint(certDer);

            // Immediately destroy socket after reading certificate
            socket.destroy();

            resolve({
              certDer,
              fingerprint,
              applicationBytesWritten,
            });
          } catch (err) {
            socket.destroy();
            reject(err);
          }
        },
      );

      // Wrap socket.write to detect any unauthorized transmission on probe
      const origWrite = socket.write.bind(socket);
      socket.write = ((
        chunk: Uint8Array | string,
        encoding?: BufferEncoding | ((err?: Error) => void),
        cb?: (err?: Error) => void,
      ): boolean => {
        if (typeof chunk === 'string') {
          applicationBytesWritten += Buffer.byteLength(chunk);
        } else {
          applicationBytesWritten += chunk.length;
        }
        return Reflect.apply(origWrite, socket, [chunk, encoding, cb]);
      }) as typeof socket.write;

      socket.on('error', (err) => {
        reject(
          new EnrollmentError(`Zero-data TLS probe connection error: ${err.message}`, {
            cause: err,
          }),
        );
      });
    });
  }

  /**
   * Executes second TLS connection strictly pinned to proven certificate DER.
   */
  async #executePinnedEnrollmentRequest(
    provenCertDer: Buffer,
    payload: StationEnrollmentRequest,
  ): Promise<StationEnrollmentResponse> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);

      const req = https.request(
        {
          host: this.#host,
          port: this.#port,
          path: '/api/v1/edge/enroll',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          // Pinned certificate authority: strictly trust only the proven candidate certificate
          ca: [derToPem(provenCertDer)],
          checkServerIdentity: () => undefined, // Pinned CA validates exact cert identity
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const resBody = Buffer.concat(chunks).toString('utf8');
              const parsed = JSON.parse(resBody) as Record<string, unknown>;

              if (res.statusCode === 200 && parsed.success === true) {
                resolve(parsed as unknown as StationEnrollmentResponse);
              } else {
                reject(
                  new EnrollmentError(
                    `Enrollment rejected by Edge (HTTP ${res.statusCode}): ${parsed.message ?? resBody}`,
                  ),
                );
              }
            } catch (err) {
              reject(err);
            }
          });
        },
      );

      req.on('error', (err) => {
        reject(
          new EnrollmentError(`Pinned enrollment request failed: ${err.message}`, { cause: err }),
        );
      });

      req.write(body);
      req.end();
    });
  }
}
