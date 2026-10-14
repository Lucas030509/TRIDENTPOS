/**
 * TRIDENTPOS WP-025: SEC-VAL-03 QR Station Enrollment & Trust Bootstrap
 * Validates Edge station pairings via QR code, timing-safe SHA-256 fingerprint verification,
 * and rogue mDNS resistance for handheld devices.
 */

import { timingSafeEqual } from 'node:crypto';
import type { QrEnrollmentPayload, StationPairingState } from '../types.js';

export const QR_EXPIRATION_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_CLOCK_DRIFT_MS = 60 * 1000; // 1 minute future tolerance

export class StationEnrollmentService {
  private currentState: StationPairingState = {
    isEnrolled: false,
    edgeHostUrl: null,
    stationId: null,
    stationToken: null,
    verifiedFingerprintSha256: null,
    enrolledAt: null,
  };

  constructor(initialState?: StationPairingState) {
    if (initialState) {
      this.currentState = { ...initialState };
    }
  }

  public getPairingState(): StationPairingState {
    return { ...this.currentState };
  }

  /**
   * Parses and validates raw QR JSON string.
   */
  public parseQrPayload(rawQrString: string): QrEnrollmentPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawQrString);
    } catch {
      throw new Error('INVALID_QR_FORMAT: Malformed JSON in pairing QR code.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('INVALID_QR_PAYLOAD: QR content is not a valid object.');
    }

    const payload = parsed as Record<string, unknown>;
    const edgeHostUrl = typeof payload.edgeHostUrl === 'string' ? payload.edgeHostUrl.trim() : '';
    const stationId = typeof payload.stationId === 'string' ? payload.stationId.trim() : '';
    const pairingToken =
      typeof payload.pairingToken === 'string' ? payload.pairingToken.trim() : '';
    const serverFingerprintSha256 =
      typeof payload.serverFingerprintSha256 === 'string'
        ? payload.serverFingerprintSha256.trim().toLowerCase()
        : '';
    const issuedAt = typeof payload.issuedAt === 'number' ? payload.issuedAt : 0;

    if (!edgeHostUrl.startsWith('https://')) {
      throw new Error('INSECURE_EDGE_URL: Edge host URL must use secure HTTPS protocol.');
    }

    if (!stationId) {
      throw new Error('MISSING_STATION_ID: QR payload must contain stationId.');
    }

    if (!pairingToken) {
      throw new Error('MISSING_PAIRING_TOKEN: QR payload must contain one-time pairing token.');
    }

    if (!/^[a-f0-9]{64}$/.test(serverFingerprintSha256)) {
      throw new Error(
        'INVALID_FINGERPRINT_FORMAT: serverFingerprintSha256 must be a 64-character hex string.',
      );
    }

    const now = Date.now();
    if (issuedAt > now + MAX_CLOCK_DRIFT_MS) {
      throw new Error('CLOCK_DRIFT_VIOLATION: QR issuedAt timestamp is in the future.');
    }

    if (now - issuedAt > QR_EXPIRATION_WINDOW_MS) {
      throw new Error('EXPIRED_QR_TOKEN: QR pairing code has expired. Please regenerate at POS.');
    }

    return {
      edgeHostUrl,
      stationId,
      pairingToken,
      serverFingerprintSha256,
      issuedAt,
    };
  }

  /**
   * SEC-VAL-03: Performs timing-safe comparison of server TLS certificate fingerprint.
   * Defends against rogue mDNS Edge hosts and TLS intercept proxies on local Wi-Fi.
   */
  public verifyTlsFingerprint(expectedSha256: string, presentedSha256: string): boolean {
    const expClean = expectedSha256.trim().toLowerCase();
    const presClean = presentedSha256.trim().toLowerCase();

    if (expClean.length !== 64 || presClean.length !== 64) {
      return false;
    }

    const bufExpected = Buffer.from(expClean, 'hex');
    const bufPresented = Buffer.from(presClean, 'hex');

    return timingSafeEqual(bufExpected, bufPresented);
  }

  /**
   * Completes the pairing handshake and commits station identity.
   */
  public completeEnrollment(params: {
    qrPayload: QrEnrollmentPayload;
    presentedServerCertificateFingerprint: string;
    stationToken: string;
  }): StationPairingState {
    const isFingerprintValid = this.verifyTlsFingerprint(
      params.qrPayload.serverFingerprintSha256,
      params.presentedServerCertificateFingerprint,
    );

    if (!isFingerprintValid) {
      throw new Error(
        'SEC_VAL_03_FAIL_CLOSED: Presented TLS certificate fingerprint does not match QR trust anchor. Potential rogue host detected!',
      );
    }

    this.currentState = {
      isEnrolled: true,
      edgeHostUrl: params.qrPayload.edgeHostUrl,
      stationId: params.qrPayload.stationId,
      stationToken: params.stationToken,
      verifiedFingerprintSha256: params.qrPayload.serverFingerprintSha256,
      enrolledAt: Date.now(),
    };

    return { ...this.currentState };
  }

  /**
   * Purges station credentials on factory reset or station un-pairing.
   */
  public purgeEnrollment(): void {
    this.currentState = {
      isEnrolled: false,
      edgeHostUrl: null,
      stationId: null,
      stationToken: null,
      verifiedFingerprintSha256: null,
      enrolledAt: null,
    };
  }
}
