/**
 * TRIDENTPOS Edge Enrollment Cryptographic Utilities
 * Built on native Node.js crypto and @trident/core RFC 8785 canonicalization.
 * Conforms to SECURITY_ARCHITECTURE.md Sec. 3 (R2F-01) and IAM_SECURITY_MODEL.md Sec. 5.
 */

import crypto from 'node:crypto';
import { canonicalize } from '@trident/core';

/**
 * Generates a cryptographically strong 256-bit (32-byte) pairing secret using CSPRNG.
 */
export function generatePairingSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a cryptographically secure UUIDv4 identifier.
 */
export function generatePairingId(): string {
  return crypto.randomUUID();
}

/**
 * Computes SHA-256 hash of a string or Buffer, returning a hex-encoded digest.
 */
export function hashSha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Performs a constant-time comparison between two secret strings to protect against timing side-channels.
 */
export function timingSafeSecretCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(bufA.length);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts raw certificate DER bytes from either PEM string or raw DER Buffer.
 */
export function extractCertificateDer(certPemOrDer: string | Buffer): Buffer {
  if (Buffer.isBuffer(certPemOrDer)) {
    const str = certPemOrDer.toString('utf8');
    if (str.includes('-----BEGIN CERTIFICATE-----')) {
      return extractCertificateDer(str);
    }
    return certPemOrDer;
  }

  const clean = certPemOrDer
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(clean, 'base64');
}

/**
 * Converts a raw binary DER certificate buffer into standard PEM string format.
 */
export function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Computes canonical SHA-256 fingerprint for a TLS certificate.
 * Format: "SHA256:XX:XX:XX:...:XX" (uppercase colon-separated hex).
 */
export function computeCertificateFingerprint(certPemOrDer: string | Buffer): string {
  const der = extractCertificateDer(certPemOrDer);
  const hashHex = crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
  const pairs = hashHex.match(/.{2}/g);
  if (!pairs) {
    throw new Error('Failed to compute certificate fingerprint');
  }
  return `SHA256:${pairs.join(':')}`;
}

// ---------------------------------------------------------------------------
// Native Pure Node.js ASN.1 DER Self-Signed X.509 Certificate Generation
// Zero third-party packages, zero openssl exec, pure native Node crypto.
// ---------------------------------------------------------------------------

function derLength(len: number): Buffer {
  if (len < 128) {
    return Buffer.from([len]);
  }
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSeq(...items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derInt(num: number | Buffer): Buffer {
  if (typeof num === 'number') {
    if (num < 128) {
      return derTag(0x02, Buffer.from([num]));
    }
    return derTag(0x02, Buffer.from([0, num]));
  }
  const firstByte = num.length > 0 ? (num[0] ?? 0) : 0;
  if (num.length > 0 && (firstByte & 0x80) !== 0) {
    return derTag(0x02, Buffer.concat([Buffer.from([0x00]), num]));
  }
  return derTag(0x02, num);
}

function derBitString(buffer: Buffer): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), buffer]));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const str =
    String(date.getUTCFullYear()).slice(2) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTag(0x17, Buffer.from(str, 'ascii'));
}

export interface GenerateCertificateOptions {
  readonly commonName?: string;
  readonly organization?: string;
  readonly validityDays?: number;
  readonly extraDnsSans?: readonly string[];
  readonly extraIpSans?: readonly string[];
}

export interface GeneratedTlsIdentity {
  readonly keyPem: string;
  readonly certPem: string;
  readonly certDer: Buffer;
  readonly fingerprint: string;
}

/**
 * Generates an ECDSA P-256 (prime256v1) self-signed X.509 v3 certificate with SAN using pure Node.js crypto.
 */
export function generateSelfSignedX509Certificate(
  options: GenerateCertificateOptions = {},
): GeneratedTlsIdentity {
  const commonName = options.commonName ?? 'TRIDENTPOS-Edge';
  const organization = options.organization ?? 'TRIDENTPOS';
  const validityDays = options.validityDays ?? 365;

  // 1. Generate P-256 EC key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  // 2. AlgorithmIdentifier: ecdsa-with-SHA256 (OID 1.2.840.10045.4.3.2)
  const ecdsaSha256Oid = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
  const algId = derSeq(ecdsaSha256Oid);

  // 3. Subject / Issuer RDN Sequence
  const cnOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  const orgOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x0a]);
  const cnRdn = derTag(0x31, derSeq(cnOid, derTag(0x0c, Buffer.from(commonName, 'utf8'))));
  const orgRdn = derTag(0x31, derSeq(orgOid, derTag(0x0c, Buffer.from(organization, 'utf8'))));
  const name = derSeq(orgRdn, cnRdn);

  // 4. Validity Period
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60000);
  const notAfter = new Date(now.getTime() + validityDays * 24 * 3600 * 1000);
  const validity = derSeq(derUtcTime(notBefore), derUtcTime(notAfter));

  // 5. SubjectPublicKeyInfo
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // 6. Extensions: SubjectAltName (OID 2.5.29.17)
  const sanOid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11]);
  const sanItems: Buffer[] = [
    derTag(0x82, Buffer.from('localhost', 'ascii')),
    derTag(0x87, Buffer.from([127, 0, 0, 1])),
  ];

  if (options.extraDnsSans) {
    for (const dns of options.extraDnsSans) {
      if (dns && dns !== 'localhost') {
        sanItems.push(derTag(0x82, Buffer.from(dns, 'ascii')));
      }
    }
  }

  if (options.extraIpSans) {
    for (const ipStr of options.extraIpSans) {
      const parts = ipStr.split('.').map(Number);
      if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
        sanItems.push(derTag(0x87, Buffer.from(parts)));
      }
    }
  }

  const sanVal = derTag(0x04, derSeq(...sanItems));
  const extSeq = derSeq(sanOid, sanVal);
  const extensions = derTag(0xa3, derSeq(extSeq));

  // 7. TBSCertificate Assembly
  const version = derTag(0xa0, derInt(2));
  const serialNumber = derInt(crypto.randomBytes(16));
  const tbs = derSeq(version, serialNumber, algId, name, validity, name, spki, extensions);

  // 8. Sign TBSCertificate using ECDSA SHA-256
  const signature = crypto.sign('sha256', tbs, {
    key: privateKey,
    dsaEncoding: 'der',
  });

  // 9. Final Certificate Sequence
  const certDer = derSeq(tbs, algId, derBitString(signature));

  // 10. PEM Encoding
  const b64 = certDer.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [b64];
  const certPem = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;

  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const fingerprint = computeCertificateFingerprint(certDer);

  return {
    keyPem,
    certPem,
    certDer,
    fingerprint,
  };
}

// ---------------------------------------------------------------------------
// Station Token HS256 Signing and Verification (Exact 32-Byte HMAC Key)
// ---------------------------------------------------------------------------

export interface StationTokenClaims {
  readonly sub: string;
  readonly org_id: string;
  readonly branch_id: string;
  readonly edge_id: string;
  readonly station_code: string;
  readonly station_type: string;
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

/**
 * Validates that an HMAC key is exactly 32 bytes (256 bits).
 * Rejects shorter or longer keys fail-closed.
 */
export function validateHmacKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error(
      `Station token HMAC key length violation: key must be exactly 32 bytes (256 bits), received ${key.length} bytes.`,
    );
  }
}

/**
 * Signs a Station Token using HMAC-SHA256 with an exact 32-byte key.
 */
export function signStationToken(claims: StationTokenClaims, hmacKey: Buffer): string {
  validateHmacKeyLength(hmacKey);

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', hmacKey).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verifies and decodes a Station Token against active or previous HMAC key.
 */
export function verifyStationToken(
  token: string,
  primaryHmacKey: Buffer,
  previousHmacKey?: Buffer | null,
  nowSeconds?: number,
): StationTokenClaims {
  validateHmacKeyLength(primaryHmacKey);
  if (previousHmacKey) {
    validateHmacKeyLength(previousHmacKey);
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: token must contain exactly 3 segments');
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

  // 2. Try previous key (for rotation grace within 12h TTL)
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
    throw new Error('Station token signature verification failed');
  }

  const payloadJson = base64UrlDecode(encodedPayload).toString('utf8');
  const claims = JSON.parse(payloadJson) as StationTokenClaims;

  const currentEpoch = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.exp < currentEpoch) {
    throw new Error(`Station token expired: expiration ${claims.exp} < current ${currentEpoch}`);
  }

  return claims;
}

/**
 * Computes canonical RFC 8785 JSON representation of an audit record and returns its SHA-256 hex hash.
 */
export function computeCanonicalRecordHash(payload: Record<string, unknown>): string {
  const canonicalString = canonicalize(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Recursively redacts sensitive cryptographic and security fields prior to logging or persistence.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  const sensitiveKeys = new Set([
    'pairingsecret',
    'privatekey',
    'stationtoken',
    'keypem',
    'secret',
    'password',
    'pin',
    'hmackey',
    'secrethash',
  ]);

  const record = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(record)) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, '');
    const isSensitive =
      sensitiveKeys.has(norm) ||
      norm.endsWith('pin') ||
      norm.endsWith('secret') ||
      norm.endsWith('token') ||
      norm.endsWith('password') ||
      norm.endsWith('key');

    if (isSensitive) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactSensitiveData(v);
    } else {
      result[k] = v;
    }
  }

  return result as T;
}
