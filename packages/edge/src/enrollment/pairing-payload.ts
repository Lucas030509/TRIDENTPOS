/**
 * TRIDENTPOS Physical Pairing Payload Generator & Parser
 * Conforms to SECURITY_ARCHITECTURE.md Sec. 3.1 and IAM_SECURITY_MODEL.md Sec. 5.
 */

import { generatePairingId, generatePairingSecret } from './crypto.js';
import { EnrollmentError, PairingPayload, PairingPayloadInput } from './types.js';

export const MAX_PAIRING_TTL_SECONDS = 600; // 10 minutes maximum per security architecture baseline
const FINGERPRINT_REGEX = /^SHA256:([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates an authoritative PairingPayload bound to the legitimate Edge TLS identity.
 */
export function createPairingPayload(input: PairingPayloadInput): PairingPayload {
  if (!input.branchId || typeof input.branchId !== 'string' || input.branchId.trim().length === 0) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      'branchId must be a valid non-empty string',
    );
  }

  if (!input.edgeId || typeof input.edgeId !== 'string' || input.edgeId.trim().length === 0) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'edgeId must be a valid non-empty string');
  }

  const normalizedFingerprint = input.edgePublicKeyFingerprint?.trim().toUpperCase();
  if (!normalizedFingerprint || !FINGERPRINT_REGEX.test(normalizedFingerprint)) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      `edgePublicKeyFingerprint must be in format 'SHA256:XX:XX:...:XX' (32 uppercase colon-separated hex octets), received: '${input.edgePublicKeyFingerprint}'`,
    );
  }

  const pairingId = input.pairingId ?? generatePairingId();
  if (!UUID_REGEX.test(pairingId)) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      `pairingId must be a valid UUID, received: '${pairingId}'`,
    );
  }

  const ttlSeconds = input.ttlSeconds ?? MAX_PAIRING_TTL_SECONDS;
  if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0 || ttlSeconds > MAX_PAIRING_TTL_SECONDS) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      `Pairing expiration exceeds maximum allowed duration (${MAX_PAIRING_TTL_SECONDS} seconds): received ${ttlSeconds}`,
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + ttlSeconds;

  const pairingSecret = input.pairingSecret ?? generatePairingSecret();
  // Ensure secret is 256 bits (32 bytes = 64 hex chars or equivalent)
  if (typeof pairingSecret !== 'string' || pairingSecret.length < 32) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'pairingSecret must be at least 256 bits');
  }

  return Object.freeze({
    branchId: input.branchId.trim(),
    edgeId: input.edgeId.trim(),
    edgePublicKeyFingerprint: normalizedFingerprint,
    pairingId,
    expiresAt,
    pairingSecret,
  });
}

/**
 * Safely serializes a PairingPayload to JSON string for display in physical QR / terminal.
 */
export function serializePairingPayload(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parses and strictly validates a raw JSON string into a verified PairingPayload.
 * Rejects malformed JSON, missing fields, invalid formats, or unexpected schemas.
 */
export function parsePairingPayload(raw: string): PairingPayload {
  if (!raw || typeof raw !== 'string') {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Raw payload must be a non-empty string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      `Malformed JSON payload: ${(err as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Payload must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.branchId !== 'string' || obj.branchId.trim().length === 0) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid branchId');
  }

  if (typeof obj.edgeId !== 'string' || obj.edgeId.trim().length === 0) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid edgeId');
  }

  if (typeof obj.edgePublicKeyFingerprint !== 'string') {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing edgePublicKeyFingerprint');
  }

  const normalizedFp = obj.edgePublicKeyFingerprint.trim().toUpperCase();
  if (!FINGERPRINT_REGEX.test(normalizedFp)) {
    throw new EnrollmentError(
      'INVALID_PAIRING_PAYLOAD',
      `Invalid fingerprint format. Expected 'SHA256:XX:...:XX', received '${obj.edgePublicKeyFingerprint}'`,
    );
  }

  if (typeof obj.pairingId !== 'string' || !UUID_REGEX.test(obj.pairingId.trim())) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid UUID pairingId');
  }

  if (typeof obj.expiresAt !== 'number' || !Number.isFinite(obj.expiresAt)) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid expiresAt timestamp');
  }

  if (typeof obj.pairingSecret !== 'string' || obj.pairingSecret.trim().length < 32) {
    throw new EnrollmentError('INVALID_PAIRING_PAYLOAD', 'Missing or insufficient pairingSecret');
  }

  return Object.freeze({
    branchId: obj.branchId.trim(),
    edgeId: obj.edgeId.trim(),
    edgePublicKeyFingerprint: normalizedFp,
    pairingId: obj.pairingId.trim(),
    expiresAt: obj.expiresAt,
    pairingSecret: obj.pairingSecret.trim(),
  });
}
