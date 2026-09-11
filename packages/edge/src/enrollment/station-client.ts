/**
 * TRIDENTPOS Station Enrollment Client
 * Implements strict zero-trust enrollment client adhering to
 * SECURITY_ARCHITECTURE.md Sec. 3.2, IAM_SECURITY_MODEL.md Sec. 5, and WP-009.
 *
 * MANDATORY TRUST INVARIANT:
 * NO SECRET DISCLOSURE BEFORE TLS FINGERPRINT VERIFICATION.
 * The station client MUST obtain and verify the candidate's TLS certificate fingerprint
 * against the physically scanned pairing payload BEFORE any pairingSecret is transmitted.
 */

import tls from 'node:tls';
import https from 'node:https';
import { computeCertificateFingerprint, timingSafeSecretCompare } from './crypto.js';
import {
  EnrollmentError,
  EnrollmentErrorCode,
  EnrollmentResponse,
  MdnsCandidate,
  PairingPayload,
  StationType,
} from './types.js';

export interface StationIdentityInfo {
  readonly stationId?: string;
  readonly stationCode: string;
  readonly stationType: StationType;
  readonly stationPublicKey: string;
}

export interface StationPinStore {
  savePin(fingerprint: string): void;
  loadPin(): string | null;
}

export interface EnrolledStationSession {
  readonly stationId: string;
  readonly stationToken: string;
  readonly pinnedFingerprint: string;
  readonly enrolledAt: number;
}

export interface StationEnrollmentClientOptions {
  /** Optional custom CA bundle for enterprise or test environments */
  readonly customCa?: string | readonly string[];
  /** Socket connection timeout in milliseconds */
  readonly timeoutMs?: number;
  /** Optional persistent pin store for device restart continuity */
  readonly pinStore?: StationPinStore;
  /** Optional pre-loaded pinned fingerprint */
  readonly initialPin?: string;
}

export class StationEnrollmentClient {
  readonly #options: StationEnrollmentClientOptions;
  #pinnedFingerprint: string | null = null;

  constructor(options: StationEnrollmentClientOptions = {}) {
    this.#options = options;
    if (options.initialPin) {
      this.#pinnedFingerprint = options.initialPin.toUpperCase();
    } else if (options.pinStore) {
      const stored = options.pinStore.loadPin();
      if (stored) {
        this.#pinnedFingerprint = stored.toUpperCase();
      }
    }
  }

  /**
   * Returns the currently pinned Edge TLS certificate fingerprint, if enrolled.
   */
  public get pinnedFingerprint(): string | null {
    return this.#pinnedFingerprint;
  }

  /**
   * Executes the full secure enrollment protocol against an untrusted candidate Edge host.
   *
   * STRICT EXECUTION ORDER:
   * 1. Establish TLS connection to probe candidate's certificate.
   * 2. Obtain candidate's public certificate (ZERO application bytes sent).
   * 3. Compute SHA-256 fingerprint of the candidate's certificate.
   * 4. Perform constant-time exact comparison against pairingPayload.edgePublicKeyFingerprint.
   * 5. IF MISMATCH: Abort immediately. pairingSecret is NEVER transmitted.
   * 6. IF MATCH: Transmit enrollment request with pairingId, pairingSecret, stationPublicKey.
   * 7. Receive Station Token.
   * 8. Pin validated Edge certificate for all future communication.
   */
  public async enrollWithCandidate(
    candidate: MdnsCandidate | { host: string; port: number },
    payload: PairingPayload,
    station: StationIdentityInfo,
  ): Promise<EnrolledStationSession> {
    const host = candidate.host;
    const port = candidate.port;
    const timeoutMs = this.#options.timeoutMs ?? 5000;

    // -------------------------------------------------------------------------
    // STAGE 1: TLS HANDSHAKE & CERTIFICATE EXTRACTION (ZERO SECRET TRANSMISSION)
    // -------------------------------------------------------------------------
    const candidateCert = await this.#probeCandidateCertificate(host, port, timeoutMs);

    // -------------------------------------------------------------------------
    // STAGE 2: INDEPENDENT FINGERPRINT VERIFICATION PRIOR TO SECRET DISCLOSURE
    // -------------------------------------------------------------------------
    const candidateFingerprint = computeCertificateFingerprint(candidateCert.rawDer);

    const isFingerprintMatch = timingSafeSecretCompare(
      candidateFingerprint.toUpperCase(),
      payload.edgePublicKeyFingerprint.toUpperCase(),
    );

    if (!isFingerprintMatch) {
      // MANDATORY CRITICAL SECURITY BOUNDARY:
      // ABORT IMMEDIATELY. DO NOT PROCEED TO TRANSMIT PAIRING SECRET.
      throw new EnrollmentError(
        'FINGERPRINT_MISMATCH',
        `Rogue Edge or certificate mismatch detected! Expected fingerprint '${payload.edgePublicKeyFingerprint}', candidate presented '${candidateFingerprint}'. Connection aborted with ZERO secret disclosure.`,
      );
    }

    // -------------------------------------------------------------------------
    // STAGE 3: TRANSMIT ENROLLMENT REQUEST OVER AUTHENTICATED TLS SESSION
    // -------------------------------------------------------------------------
    // At this point, the candidate's TLS certificate has been proven to match
    // the physical QR pairing payload. We configure the TLS client to verify against
    // the validated certificate (ca: [candidateCert.rawDer]) with full rejection on unauthorized.
    const enrollmentResponse = await this.#sendEnrollmentRequest(
      host,
      port,
      candidateCert.rawDer,
      {
        pairingId: payload.pairingId,
        pairingSecret: payload.pairingSecret,
        stationPublicKey: station.stationPublicKey,
        stationCode: station.stationCode,
        stationType: station.stationType,
        stationId: station.stationId,
      },
      timeoutMs,
    );

    // -------------------------------------------------------------------------
    // STAGE 4: PIN EDGE IDENTITY PERMANENTLY FOR ALL SUBSEQUENT CONNECTIONS
    // -------------------------------------------------------------------------
    this.#pinnedFingerprint = payload.edgePublicKeyFingerprint.toUpperCase();
    this.#options.pinStore?.savePin(this.#pinnedFingerprint);

    return Object.freeze({
      stationId: enrollmentResponse.stationId,
      stationToken: enrollmentResponse.stationToken,
      pinnedFingerprint: this.#pinnedFingerprint,
      enrolledAt: enrollmentResponse.enrolledAt,
    });
  }

  /**
   * Verifies that a connected TLS socket matches the pinned Edge certificate.
   * Fails closed if no certificate is pinned or if the fingerprint does not match.
   */
  public verifyPinnedSocket(socket: tls.TLSSocket): boolean {
    if (!this.#pinnedFingerprint) {
      throw new EnrollmentError(
        'CERTIFICATE_PIN_MISMATCH',
        'Cannot verify pinned connection: No Edge certificate has been pinned yet.',
      );
    }

    const peerCert = socket.getPeerCertificate(true);
    if (!peerCert || !peerCert.raw) {
      throw new EnrollmentError(
        'CERTIFICATE_PIN_MISMATCH',
        'Peer did not present a valid TLS certificate for pinned verification.',
      );
    }

    const peerFingerprint = computeCertificateFingerprint(peerCert.raw);
    const isMatch = timingSafeSecretCompare(peerFingerprint.toUpperCase(), this.#pinnedFingerprint);

    if (!isMatch) {
      throw new EnrollmentError(
        'CERTIFICATE_PIN_MISMATCH',
        `Pinned Edge certificate mismatch! Expected pinned '${this.#pinnedFingerprint}', received '${peerFingerprint}'. Connection aborted.`,
      );
    }

    return true;
  }

  /**
   * Probes candidate server to retrieve its TLS certificate without sending any application data.
   */
  async #probeCandidateCertificate(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ rawDer: Buffer; pem: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(
            new EnrollmentError(
              'TLS_CONNECTION_FAILED',
              `TLS probe connection timed out after ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);

      // Connect raw TLS socket specifically to inspect peer certificate during handshake
      const socket = tls.connect(
        {
          host,
          port,
          // In probe phase, we obtain the peer certificate so we can independently verify its fingerprint
          // ZERO application data is written to this probe socket.
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          try {
            const peerCert = socket.getPeerCertificate(true);
            if (!peerCert || !peerCert.raw) {
              socket.destroy();
              reject(
                new EnrollmentError(
                  'TLS_CONNECTION_FAILED',
                  'Candidate Edge server did not present a TLS certificate during handshake',
                ),
              );
              return;
            }

            const rawDer = Buffer.from(peerCert.raw);
            const b64 =
              rawDer
                .toString('base64')
                .match(/.{1,64}/g)
                ?.join('\n') ?? rawDer.toString('base64');
            const pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;

            // Immediately destroy probe socket without writing any data
            socket.destroy();
            resolve({ rawDer, pem });
          } catch (err) {
            socket.destroy();
            reject(
              new EnrollmentError(
                'TLS_CONNECTION_FAILED',
                `Failed to extract candidate certificate: ${(err as Error).message}`,
              ),
            );
          }
        },
      );

      socket.once('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new EnrollmentError('TLS_CONNECTION_FAILED', `TLS probe failed: ${err.message}`));
        }
      });
    });
  }

  /**
   * Sends the enrollment request to the Edge server over a TLS connection
   * strictly verified against the candidate's proven certificate.
   */
  async #sendEnrollmentRequest(
    host: string,
    port: number,
    provenCertDer: Buffer,
    requestBody: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<EnrollmentResponse> {
    return new Promise((resolve, reject) => {
      const payloadString = JSON.stringify(requestBody);

      const b64 =
        provenCertDer
          .toString('base64')
          .match(/.{1,64}/g)
          ?.join('\n') ?? provenCertDer.toString('base64');
      const provenCertPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;

      const req = https.request(
        {
          host,
          port,
          path: '/api/v1/edge/enroll',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadString),
          },
          // Authoritative certificate pinning: CA bundle contains ONLY the verified certificate
          ca: [provenCertPem],
          checkServerIdentity: () => undefined, // Verified against exact certificate DER
          timeout: timeoutMs,
        },
        (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(responseData);
            } catch (err) {
              reject(
                new EnrollmentError(
                  'MALFORMED_REQUEST',
                  `Failed to parse enrollment response: ${(err as Error).message}`,
                ),
              );
              return;
            }

            if (res.statusCode !== 200) {
              const errObj = parsed as { error?: EnrollmentErrorCode; message?: string };
              reject(
                new EnrollmentError(
                  errObj.error ?? 'MALFORMED_REQUEST',
                  errObj.message ?? `Enrollment rejected with HTTP ${res.statusCode}`,
                ),
              );
              return;
            }

            resolve(parsed as EnrollmentResponse);
          });
        },
      );

      req.once('error', (err) => {
        reject(
          new EnrollmentError('TLS_CONNECTION_FAILED', `Enrollment request failed: ${err.message}`),
        );
      });

      req.once('timeout', () => {
        req.destroy();
        reject(
          new EnrollmentError(
            'TLS_CONNECTION_FAILED',
            `Enrollment request timed out after ${timeoutMs}ms`,
          ),
        );
      });

      // Transmit the enrollment payload containing the pairingSecret
      req.write(payloadString);
      req.end();
    });
  }
}
