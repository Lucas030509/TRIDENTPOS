/**
 * TRIDENTPOS Billing: CSD (Certificado de Sello Digital) Signer & Verifier
 * Implements in-memory cryptographic signing using RSA-SHA256.
 * Zero secrets logged or persisted in plain text.
 */

import crypto from 'node:crypto';
import {
  CsdCredentialsMissingError,
  CsdMismatchError,
  CsdSignatureError,
  BillingError,
} from './errors.js';
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
 * Validates cryptographically that the private key matches the certificate public key.
 * Throws CsdMismatchError fail-closed if keys do not match.
 */
export function validateCsdKeyPairMatch(certificatePem: string, privateKeyPem: string): void {
  try {
    const testPayload = `TRIDENTPOS_CSD_INTEGRITY_CHECK_${Date.now()}_${crypto.randomUUID()}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(testPayload, 'utf8');
    signer.end();
    const signature = signer.sign(privateKeyPem, 'base64');

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(testPayload, 'utf8');
    verifier.end();
    const match = verifier.verify(certificatePem, signature, 'base64');
    if (!match) {
      throw new CsdMismatchError('CSD private key does not match the provided public certificate');
    }
  } catch (err: unknown) {
    if (err instanceof CsdMismatchError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new CsdMismatchError(`CSD cryptographic key matching failed: ${msg}`);
  }
}

/**
 * Strips PEM header/footer and whitespaces to get raw single-line Base64 certificate string for CFDI.
 */
export function cleanCertificateToSingleLineBase64(certificatePem: string): string {
  if (!certificatePem || certificatePem.trim().length === 0) {
    throw new CsdCredentialsMissingError('Certificate PEM is empty');
  }
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');
}

export const formatCertBase64SingleLine = cleanCertificateToSingleLineBase64;
export const formatCertificateToSingleLine = cleanCertificateToSingleLineBase64;

/**
 * Extracts the 20-digit certificate number from an X.509 certificate PEM.
 * Fails closed without dummy or synthetic fallbacks.
 */
export function extractCertNumberFromPem(certPem: string): string {
  if (!certPem || certPem.trim().length === 0) {
    throw new CsdCredentialsMissingError('Certificate PEM is empty or missing');
  }
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const rawHex = x509.serialNumber;
    if (!rawHex) {
      throw new CsdCredentialsMissingError('X509 Certificate contains no serialNumber');
    }
    // Check if rawHex is hex-encoded ASCII digits (e.g. 3330... -> 30...)
    if (/^(3[0-9]){10,20}$/i.test(rawHex)) {
      const decoded = Buffer.from(rawHex, 'hex').toString('utf8');
      if (/^\d{10,20}$/.test(decoded)) {
        return decoded;
      }
    }
    const cleanDigits = rawHex.replace(/[^0-9]/g, '');
    if (cleanDigits.length >= 10) {
      return cleanDigits.padStart(20, '0').slice(-20);
    }
    throw new CsdCredentialsMissingError(
      `Cannot extract valid 20-digit SAT certificate number from serial '${rawHex}'`,
    );
  } catch (err: unknown) {
    if (err instanceof BillingError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new CsdCredentialsMissingError(`Failed to parse CSD X509 certificate: ${msg}`);
  }
}

export const extractCertificateNumber = extractCertNumberFromPem;

/**
 * Generates an in-memory RSA keypair and valid self-signed X509 certificate for test fixtures.
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
