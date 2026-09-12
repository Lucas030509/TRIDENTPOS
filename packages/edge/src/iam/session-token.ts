/**
 * TRIDENTPOS Edge Floor Session Token Generator & Validator
 * Conforms to IAM_SECURITY_MODEL.md Sec. 4.
 *
 * Requirements:
 * - 12-hour session duration (43,200 seconds).
 * - HMAC-SHA256 (HS256) signature using exact 32-byte key from EdgeSecureStore.
 * - Bound strictly to station_id (enrolled device identity).
 * - Expiration and clock-rollback validation against trustedEffectiveTime.
 * - Raw token is never persisted or logged; SHA-256 hash is stored in SQLite.
 */

import crypto from 'node:crypto';
import { hashSha256, validateHmacKeyLength } from '../enrollment/crypto.js';
import { OfflineIamError } from './types.js';

export const SESSION_TOKEN_TTL_SECONDS = 43200; // 12 hours

export interface FloorSessionTokenClaims {
  readonly sub: string; // userId
  readonly station_id: string; // stationId
  readonly org_id: string; // organizationId
  readonly branch_id: string; // branchId
  readonly session_id: string; // sessionId
  readonly roles: string[];
  readonly active_role: string;
  readonly iat: number;
  readonly exp: number;
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64url');
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

export function signFloorSessionToken(claims: FloorSessionTokenClaims, hmacKey: Buffer): string {
  validateHmacKeyLength(hmacKey);

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', hmacKey).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

export function verifyFloorSessionToken(
  token: string,
  primaryHmacKey: Buffer,
  previousHmacKey: Buffer | null | undefined,
  currentEffectiveTime: number,
): FloorSessionTokenClaims {
  validateHmacKeyLength(primaryHmacKey);
  if (previousHmacKey) {
    validateHmacKeyLength(previousHmacKey);
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new OfflineIamError('AUTHENTICATION_FAILED', 'Malformed token format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const providedSignature = base64UrlDecode(encodedSignature);

  let verified = false;

  // 1. Try primary key
  const primaryExpectedSig = crypto
    .createHmac('sha256', primaryHmacKey)
    .update(signingInput)
    .digest();
  if (
    providedSignature.length === primaryExpectedSig.length &&
    crypto.timingSafeEqual(providedSignature, primaryExpectedSig)
  ) {
    verified = true;
  }

  // 2. Try previous key (for rotation grace)
  if (!verified && previousHmacKey) {
    const prevExpectedSig = crypto
      .createHmac('sha256', previousHmacKey)
      .update(signingInput)
      .digest();
    if (
      providedSignature.length === prevExpectedSig.length &&
      crypto.timingSafeEqual(providedSignature, prevExpectedSig)
    ) {
      verified = true;
    }
  }

  if (!verified) {
    throw new OfflineIamError('AUTHENTICATION_FAILED', 'Invalid token signature');
  }

  let claims: FloorSessionTokenClaims;
  try {
    const payloadJson = base64UrlDecode(encodedPayload).toString('utf8');
    claims = JSON.parse(payloadJson) as FloorSessionTokenClaims;
  } catch {
    throw new OfflineIamError('AUTHENTICATION_FAILED', 'Malformed token claims');
  }

  // Enforce natural expiration
  if (claims.exp < currentEffectiveTime) {
    throw new OfflineIamError(
      'SESSION_EXPIRED',
      `Session token expired: exp ${claims.exp} < current ${currentEffectiveTime}`,
    );
  }

  // Enforce clock rollback protection: token cannot be issued in the future
  // Allow a tiny 5-second drift margin for slight clock resolution differences
  if (claims.iat > currentEffectiveTime + 5) {
    throw new OfflineIamError(
      'CLOCK_ROLLBACK_LOCKED',
      `Session token future issuedAt detected: iat ${claims.iat} > current ${currentEffectiveTime}`,
    );
  }

  return claims;
}

export function computeSessionTokenHash(token: string): string {
  return hashSha256(token);
}
