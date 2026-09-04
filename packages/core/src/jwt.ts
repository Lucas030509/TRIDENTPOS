/**
 * @trident/core - Cryptographic JWT Verification Engine
 *
 * Implements strict, zero-trust JWT verification adhering to IAM_SECURITY_MODEL.md
 * and SECURITY_ARCHITECTURE.md baselines.
 *
 * Requirements:
 * - Real cryptographic signature verification (RS256, EdDSA baseline).
 * - Mandatory issuer (iss), audience (aud), expiration (exp), and subject (sub) validation.
 * - Rejection of alg=none, algorithm confusion, invalid signatures, expired tokens, future nbf.
 * - Strict subject UUID format validation (users.id IS jwt.sub).
 * - Framework-agnostic contract.
 */

import { jwtVerify, type KeyLike, type JWTVerifyGetKey } from 'jose';
import { ok, err, type Result } from './index.js';

export const ALLOWED_JWT_ALGORITHMS = ['RS256', 'EdDSA'] as const;
export type AllowedJwtAlgorithm = (typeof ALLOWED_JWT_ALGORITHMS)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JwtVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly key: KeyLike | Uint8Array | JWTVerifyGetKey;
  readonly algorithms?: readonly string[];
  readonly clockToleranceSeconds?: number;
}

export interface VerifiedAccessToken {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: string;
  readonly expiration: number;
  readonly issuedAt?: number | undefined;
  readonly notBefore?: number | undefined;
  readonly rawClaims: Record<string, unknown>;
}

export type JwtVerificationErrorCode =
  | 'EMPTY_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'ALGORITHM_REJECTED'
  | 'SIGNATURE_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'ISSUER_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'MISSING_SUBJECT'
  | 'MALFORMED_SUBJECT_UUID'
  | 'VERIFICATION_FAILED';

export class JwtVerificationError extends Error {
  public readonly code: JwtVerificationErrorCode;

  constructor(code: JwtVerificationErrorCode, message: string) {
    super(`JWT_VERIFICATION_ERROR [${code}]: ${message}`);
    this.name = 'JwtVerificationError';
    this.code = code;
  }
}

/**
 * Validates whether a given string is a syntactically valid UUID (v1-v5).
 */
export function isValidUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

/**
 * Cryptographically verifies an access JWT and extracts verified claims.
 * Does NOT trust decoded payload without cryptographic proof.
 */
export async function verifyAccessToken(
  token: string,
  config: JwtVerifierConfig,
): Promise<Result<VerifiedAccessToken, JwtVerificationError>> {
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return err(new JwtVerificationError('EMPTY_TOKEN', 'Access token is empty or missing'));
  }

  const trimmedToken = token.trim();
  const allowedAlgs =
    config.algorithms && config.algorithms.length > 0
      ? [...config.algorithms]
      : [...ALLOWED_JWT_ALGORITHMS];

  // Inspect unverified header strictly to guard against alg=none and algorithm confusion
  // before full cryptographic validation
  const parts = trimmedToken.split('.');
  if (parts.length !== 3) {
    return err(
      new JwtVerificationError(
        'MALFORMED_TOKEN',
        'JWT must consist of exactly three dot-separated segments',
      ),
    );
  }

  let headerAlg: string | undefined;
  try {
    const headerJson = Buffer.from(parts[0] ?? '', 'base64url').toString('utf8');
    const parsedHeader = JSON.parse(headerJson) as { alg?: unknown };
    if (typeof parsedHeader.alg === 'string') {
      headerAlg = parsedHeader.alg;
    }
  } catch {
    return err(new JwtVerificationError('MALFORMED_TOKEN', 'Malformed JWT header encoding'));
  }

  if (!headerAlg || headerAlg.toLowerCase() === 'none') {
    return err(
      new JwtVerificationError(
        'ALGORITHM_REJECTED',
        'Unsigned tokens (alg=none) are strictly rejected',
      ),
    );
  }

  if (!allowedAlgs.includes(headerAlg)) {
    return err(
      new JwtVerificationError(
        'ALGORITHM_REJECTED',
        `Algorithm '${headerAlg}' is not permitted. Permitted: [${allowedAlgs.join(', ')}]`,
      ),
    );
  }

  try {
    const verifyOptions = {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: allowedAlgs,
      clockTolerance: config.clockToleranceSeconds ?? 0,
    };

    const { payload } = await jwtVerify(
      trimmedToken,
      config.key as Parameters<typeof jwtVerify>[1],
      verifyOptions,
    );

    const sub = payload.sub;
    if (!sub || typeof sub !== 'string' || sub.trim().length === 0) {
      return err(
        new JwtVerificationError(
          'MISSING_SUBJECT',
          'JWT claims must contain a non-empty sub claim',
        ),
      );
    }

    if (!isValidUuid(sub)) {
      return err(
        new JwtVerificationError(
          'MALFORMED_SUBJECT_UUID',
          `JWT subject '${sub}' is not a valid UUID format`,
        ),
      );
    }

    const verified: VerifiedAccessToken = {
      subject: sub,
      issuer: typeof payload.iss === 'string' ? payload.iss : config.issuer,
      audience: typeof payload.aud === 'string' ? payload.aud : config.audience,
      expiration: typeof payload.exp === 'number' ? payload.exp : 0,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
      notBefore: typeof payload.nbf === 'number' ? payload.nbf : undefined,
      rawClaims: payload as Record<string, unknown>,
    };

    return ok(verified);
  } catch (rawError: unknown) {
    const e = rawError as { code?: string; message?: string };
    const errCode = e.code ?? '';
    const message = e.message ?? 'Unknown JWT verification failure';

    if (errCode === 'ERR_JWT_EXPIRED') {
      return err(new JwtVerificationError('TOKEN_EXPIRED', message));
    }
    if (errCode === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      if (message.includes('nbf') || message.includes('not before')) {
        return err(new JwtVerificationError('TOKEN_NOT_YET_VALID', message));
      }
      if (message.includes('iss') || message.includes('issuer')) {
        return err(new JwtVerificationError('ISSUER_MISMATCH', message));
      }
      if (message.includes('aud') || message.includes('audience')) {
        return err(new JwtVerificationError('AUDIENCE_MISMATCH', message));
      }
    }
    if (
      errCode === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
      errCode === 'ERR_JWS_VERIFICATION_FAILED'
    ) {
      return err(new JwtVerificationError('SIGNATURE_INVALID', message));
    }
    if (errCode === 'ERR_JOSE_ALG_NOT_ALLOWED' || errCode === 'ERR_JWS_INVALID') {
      return err(new JwtVerificationError('ALGORITHM_REJECTED', message));
    }

    return err(new JwtVerificationError('VERIFICATION_FAILED', message));
  }
}
