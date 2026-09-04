/**
 * @trident/core - Argon2id Branch PIN Cryptographic Engine
 *
 * Implements Cloud-side branch staff PIN hashing and parameters adhering to
 * IAM_SECURITY_MODEL.md Sec. 2 and RFC 9106 baseline.
 *
 * Frozen Baseline:
 * - memoryCost: 65536 KiB (64 MB)
 * - timeCost: 3 iterations
 * - parallelism: 4 threads
 * - saltLength: 16 bytes CSPRNG
 * - hashLength: 32 bytes
 * - bcrypt is PROHIBITED.
 *
 * Requirements:
 * - Plaintext PIN accepted only transiently.
 * - Plaintext PIN is NEVER persisted or logged.
 * - Generates standard Argon2id encoded string.
 */

import argon2 from 'argon2';
import crypto from 'node:crypto';
import { ok, err, type Result } from './index.js';

export const ARGON2ID_FROZEN_BASELINE = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  saltLength: 16,
  hashLength: 32,
} as const;

export class PinError extends Error {
  public readonly code: 'INVALID_PIN_FORMAT' | 'HASHING_FAILED' | 'VERIFICATION_FAILED';

  constructor(
    code: 'INVALID_PIN_FORMAT' | 'HASHING_FAILED' | 'VERIFICATION_FAILED',
    message: string,
  ) {
    super(`PIN_ERROR [${code}]: ${message}`);
    this.name = 'PinError';
    this.code = code;
  }
}

/**
 * Validates PIN format. PIN must be a string of 4 to 8 decimal digits.
 */
export function validatePinFormat(pin: string): Result<void, PinError> {
  if (typeof pin !== 'string') {
    return err(new PinError('INVALID_PIN_FORMAT', 'PIN must be a string'));
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return err(
      new PinError(
        'INVALID_PIN_FORMAT',
        'PIN must consist of 4 to 8 numeric digits without whitespace or special characters',
      ),
    );
  }
  return ok(undefined);
}

/**
 * Generates an Argon2id hash for a staff branch operational PIN using the RFC 9106 frozen baseline.
 * Plaintext PIN is never stored, retained, or logged.
 */
export async function hashBranchPin(
  pin: string,
  options?: {
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
    salt?: Buffer;
  },
): Promise<Result<string, PinError>> {
  const validation = validatePinFormat(pin);
  if (!validation.ok) {
    return err(validation.error);
  }

  try {
    const memoryCost = options?.memoryCost ?? ARGON2ID_FROZEN_BASELINE.memoryCost;
    const timeCost = options?.timeCost ?? ARGON2ID_FROZEN_BASELINE.timeCost;
    const parallelism = options?.parallelism ?? ARGON2ID_FROZEN_BASELINE.parallelism;
    const salt = options?.salt ?? crypto.randomBytes(ARGON2ID_FROZEN_BASELINE.saltLength);

    const hash = await argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost,
      timeCost,
      parallelism,
      hashLength: ARGON2ID_FROZEN_BASELINE.hashLength,
      salt,
    });

    return ok(hash);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown cryptographic failure';
    return err(new PinError('HASHING_FAILED', `Failed to generate Argon2id hash: ${msg}`));
  }
}

/**
 * Verifies a plaintext PIN against an encoded Argon2id hash.
 * Note: Offline runtime verification on Edge terminals is governed by WP-010.
 * This utility provides cryptographic verification for validation tests and provisioning checks.
 */
export async function verifyBranchPin(
  hash: string,
  plainPin: string,
): Promise<Result<boolean, PinError>> {
  if (typeof hash !== 'string' || !hash.startsWith('$argon2id$')) {
    return err(new PinError('VERIFICATION_FAILED', 'Invalid Argon2id hash format'));
  }

  const validation = validatePinFormat(plainPin);
  if (!validation.ok) {
    return err(validation.error);
  }

  try {
    const matches = await argon2.verify(hash, plainPin);
    return ok(matches);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown verification failure';
    return err(new PinError('VERIFICATION_FAILED', `Argon2id verification error: ${msg}`));
  }
}
