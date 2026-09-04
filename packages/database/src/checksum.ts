import crypto from 'node:crypto';

/**
 * Computes a deterministic SHA-256 checksum of migration content.
 * Normalizes carriage returns (\r\n to \n) and trims trailing whitespace
 * to ensure identical cross-platform checksum evaluation.
 */
export function computeChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
