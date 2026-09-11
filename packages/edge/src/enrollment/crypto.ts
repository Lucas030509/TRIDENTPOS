/**
 * TRIDENTPOS Edge Enrollment Cryptographic Utilities
 * Zero third-party crypto dependencies. Built exclusively on native Node.js crypto.
 * Conforms to SECURITY_ARCHITECTURE.md Sec. 3 (R2F-01) and IAM_SECURITY_MODEL.md Sec. 5.
 */

import crypto from 'node:crypto';

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
 * Computes SHA-256 hash of a string, returning a hex-encoded digest.
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
    // Constant-time dummy comparison to mitigate length disclosure timing
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
    // If it's already binary DER or binary PEM
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
  // Ensure leading zero if high bit is set to maintain positive integer semantics
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
  // OID 2.5.4.3 = commonName, OID 2.5.4.10 = organizationName
  const cnOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  const orgOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x0a]);
  const cnRdn = derTag(0x31, derSeq(cnOid, derTag(0x0c, Buffer.from(commonName, 'utf8'))));
  const orgRdn = derTag(0x31, derSeq(orgOid, derTag(0x0c, Buffer.from(organization, 'utf8'))));
  const name = derSeq(orgRdn, cnRdn);

  // 4. Validity Period
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60000); // 1 min buffer for clock skew
  const notAfter = new Date(now.getTime() + validityDays * 24 * 3600 * 1000);
  const validity = derSeq(derUtcTime(notBefore), derUtcTime(notAfter));

  // 5. SubjectPublicKeyInfo (DER format directly exported from crypto KeyObject)
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // 6. Extensions: SubjectAltName (OID 2.5.29.17)
  const sanOid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11]);
  const sanItems: Buffer[] = [
    derTag(0x82, Buffer.from('localhost', 'ascii')), // dNSName [2]
    derTag(0x87, Buffer.from([127, 0, 0, 1])), // iPAddress [7] (127.0.0.1)
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

  const sanVal = derTag(0x04, derSeq(...sanItems)); // OCTET STRING containing SEQUENCE
  const extSeq = derSeq(sanOid, sanVal);
  const extensions = derTag(0xa3, derSeq(extSeq)); // [3] EXPLICIT Extensions

  // 7. TBSCertificate Assembly (v3 = version [0] EXPLICIT INTEGER 2)
  const version = derTag(0xa0, derInt(2));
  const serialNumber = derInt(crypto.randomBytes(16)); // 128-bit CSPRNG serial
  const tbs = derSeq(version, serialNumber, algId, name, validity, name, spki, extensions);

  // 8. Sign TBSCertificate using ECDSA SHA-256 (format: DER signature)
  const signature = crypto.sign('sha256', tbs, {
    key: privateKey,
    dsaEncoding: 'der',
  });

  // 9. Final Certificate Sequence: TBSCertificate + AlgorithmIdentifier + BIT STRING signature
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

/**
 * Sanitizes input to redact sensitive cryptographic material before logging or emitting events.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(redactSensitiveData) as unknown as T;
  }

  const sensitiveKeys = new Set([
    'pairingsecret',
    'privatekey',
    'stationtoken',
    'keypem',
    'secret',
    'password',
    'pin',
  ]);

  const record = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(record)) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, '');
    if (sensitiveKeys.has(norm)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactSensitiveData(v);
    } else {
      result[k] = v;
    }
  }

  return result as T;
}
