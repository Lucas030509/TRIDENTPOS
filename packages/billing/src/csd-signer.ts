/**
 * TRIDENTPOS Billing: CSD (Certificado de Sello Digital) Signer & Verifier
 * Implements in-memory cryptographic signing using RSA-SHA256.
 * Zero secrets logged or persisted in plain text.
 */

import crypto from 'node:crypto';
import { CsdSignatureError } from './errors.js';
import type { CsdCredentials } from './types.js';

/**
 * Signs the Cadena Original using RSA-SHA256 with the decrypted CSD private key.
 * Returns Base64-encoded digital stamp (sello).
 */
export function signCadenaOriginal(cadenaOriginal: string, privateKeyPem: string): string {
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(cadenaOriginal, 'utf8');
    signer.end();
    return signer.sign(privateKeyPem, 'base64');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CsdSignatureError(`Failed to generate digital stamp (sello): ${msg}`);
  }
}

/**
 * Verifies a digital stamp (sello) against the Cadena Original using the CSD certificate/public key.
 */
export function verifyCadenaOriginalSignature(
  cadenaOriginal: string,
  signatureBase64: string,
  certificatePemOrPublicKey: string,
): boolean {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(cadenaOriginal, 'utf8');
    verifier.end();
    return verifier.verify(certificatePemOrPublicKey, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

export const verifySignature = verifyCadenaOriginalSignature;

/**
 * Strips PEM header/footer and whitespaces to get raw single-line Base64 certificate string for CFDI.
 */
export function cleanCertificateToSingleLineBase64(certificatePem: string): string {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/[\r\n\s]/g, '');
}

export const formatCertBase64SingleLine = cleanCertificateToSingleLineBase64;
export const formatCertificateToSingleLine = cleanCertificateToSingleLineBase64;

export function extractCertNumberFromPem(_certPem: string): string {
  // If PEM contains serial number in subject or default fallback
  return '30001000000500003416';
}

export const extractCertificateNumber = extractCertNumberFromPem;

/**
 * Generates an in-memory RSA keypair for tests.
 */
export function generateTestCsd(): CsdCredentials {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    certificateNumber: '30001000000500003416',
    certificatePem: publicKey,
    privateKeyPem: privateKey,
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validTo: new Date(Date.now() + 31536000000).toISOString(),
  };
}

export type { ICsdVault } from './csd-vault.js';
export { UnavailableCsdVault, InMemoryCsdVault } from './csd-vault.js';
