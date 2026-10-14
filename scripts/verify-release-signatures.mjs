/**
 * TRIDENTPOS Release Signature & Auto-Update Integrity Verifier (WP-028)
 *
 * Location: scripts/verify-release-signatures.mjs
 * Validates:
 * - Integrity of release binaries against SHA-256 and SHA-512 manifests.
 * - Ed25519 digital signatures of distribution packages.
 * - Ed25519 digital signature of auto-update manifests (latest.yml, latest-linux.yml, latest-mac.yml).
 * - Anti-tampering drill: Proves fail-closed rejection upon single-byte corruption.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');

const pubKeyPath = path.join(releaseDir, 'release-public-key.pem');

if (!fs.existsSync(pubKeyPath)) {
  console.error(
    `FATAL: Public key missing at ${pubKeyPath}. Run scripts/package-release.mjs first.`,
  );
  process.exit(1);
}

const publicKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath, 'utf8'));

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assertCheck(cond, msg) {
  totalChecks++;
  if (cond) {
    passedChecks++;
    console.log(`  ✔ ${msg}`);
  } else {
    failedChecks++;
    console.error(`  ✖ FAILED: ${msg}`);
  }
}

console.log('\n=== TRIDENTPOS Release Signature & Auto-Update Verification ===');

// 1. Verify Checksum Manifests
const sha256Lines = fs
  .readFileSync(path.join(releaseDir, 'checksums.sha256'), 'utf8')
  .trim()
  .split('\n');
const sha512Lines = fs
  .readFileSync(path.join(releaseDir, 'checksums.sha512'), 'utf8')
  .trim()
  .split('\n');

console.log('\n1. Verifying Checksum Digests:');
for (const line of sha256Lines) {
  const [expectedHash, filename] = line.split(/\s+/);
  const filePath = path.join(releaseDir, filename);
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  assertCheck(
    actualHash === expectedHash,
    `${filename} matches SHA-256 digest (${expectedHash.substring(0, 16)}...)`,
  );
}

for (const line of sha512Lines) {
  const [expectedHash, filename] = line.split(/\s+/);
  const filePath = path.join(releaseDir, filename);
  const actualHash = crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
  assertCheck(actualHash === expectedHash, `${filename} matches SHA-512 digest`);
}

// 2. Verify Manifest Signatures & Payload Signatures
console.log('\n2. Verifying Signed Auto-Update Manifests:');
const manifestFiles = ['latest.yml', 'latest-linux.yml', 'latest-mac.yml'];

for (const manifestName of manifestFiles) {
  const manifestPath = path.join(releaseDir, manifestName);
  const rawContent = fs.readFileSync(manifestPath, 'utf8');

  // Extract signature line
  const lines = rawContent.trim().split('\n');
  const sigLine = lines.find((l) => l.startsWith('ed25519_signature: '));
  assertCheck(Boolean(sigLine), `${manifestName} contains ed25519_signature header`);

  const signatureBase64 = sigLine.replace('ed25519_signature: ', '').trim();
  const bodyContent = lines.filter((l) => !l.startsWith('ed25519_signature: ')).join('\n');

  const isValidManifestSig = crypto.verify(
    null,
    Buffer.from(bodyContent, 'utf8'),
    publicKey,
    Buffer.from(signatureBase64, 'base64'),
  );

  assertCheck(isValidManifestSig, `${manifestName} Ed25519 signature is cryptographically valid`);

  // Parse files and verify individual binary signatures
  const fileBlocks = rawContent.split('  - url: ').slice(1);
  for (const block of fileBlocks) {
    const filename = block.split('\n')[0].trim();
    const sha512Match = block.match(/sha512:\s+([a-f0-9]+)/);
    const sigMatch = block.match(/signature:\s+([A-Za-z0-9+/=]+)/);

    if (filename && sha512Match && sigMatch) {
      const expectedSha512 = sha512Match[1];
      const binarySig = sigMatch[1];

      const binaryPath = path.join(releaseDir, filename);
      const binaryContent = fs.readFileSync(binaryPath);

      // Verify SHA-512
      const actualSha512 = crypto.createHash('sha512').update(binaryContent).digest('hex');
      assertCheck(
        actualSha512 === expectedSha512,
        `${filename} in ${manifestName} matches SHA-512`,
      );

      // Verify Ed25519 signature
      const isBinarySigValid = crypto.verify(
        null,
        binaryContent,
        publicKey,
        Buffer.from(binarySig, 'base64'),
      );
      assertCheck(isBinarySigValid, `${filename} package signature verified with public key`);
    }
  }
}

// 3. Anti-Tampering Drill (Fail-Closed Semantics)
console.log('\n3. Executing Anti-Tampering Drills:');

// Test A: 1-byte corruption in binary package
const sampleBinary = path.join(releaseDir, 'tridentpos-edge-0.1.0.tar.gz');
const authenticBytes = fs.readFileSync(sampleBinary);
const tamperedBytes = Buffer.from(authenticBytes);
tamperedBytes[tamperedBytes.length - 1] ^= 0xff; // flip last byte

const sampleSha512 = crypto.createHash('sha512').update(authenticBytes).digest('hex');
const tamperedSha512 = crypto.createHash('sha512').update(tamperedBytes).digest('hex');
assertCheck(tamperedSha512 !== sampleSha512, 'Corrupted binary produces different SHA-512 digest');

// Test binary signature on corrupted bytes
const sampleSig = fs
  .readFileSync(path.join(releaseDir, 'latest-linux.yml'), 'utf8')
  .match(/tridentpos-edge-0\.1\.0\.tar\.gz[\s\S]*?signature:\s+([A-Za-z0-9+/=]+)/)[1];

const isTamperedSigValid = crypto.verify(
  null,
  tamperedBytes,
  publicKey,
  Buffer.from(sampleSig, 'base64'),
);
assertCheck(
  !isTamperedSigValid,
  'Corrupted binary signature verification fails closed (INVALID_SIGNATURE)',
);

// Test B: 1-byte alteration in manifest body
const authenticManifest = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
const tamperedManifest = authenticManifest.replace('channel: stable', 'channel: hacked');
const tamperedLines = tamperedManifest.trim().split('\n');
const tSig = tamperedLines
  .find((l) => l.startsWith('ed25519_signature: '))
  .replace('ed25519_signature: ', '')
  .trim();
const tBody = tamperedLines.filter((l) => !l.startsWith('ed25519_signature: ')).join('\n');

const isTamperedManifestValid = crypto.verify(
  null,
  Buffer.from(tBody, 'utf8'),
  publicKey,
  Buffer.from(tSig, 'base64'),
);
assertCheck(
  !isTamperedManifestValid,
  'Tampered auto-update manifest signature verification fails closed (UNAUTHORIZED_MUTATION)',
);

console.log(`\n=== Verification Summary: ${passedChecks}/${totalChecks} checks passed ===\n`);

if (failedChecks > 0) {
  console.error(`FAILED: ${failedChecks} verification checks failed.`);
  process.exit(1);
}

console.log('SUCCESS: All release binaries, signatures, and manifests are 100% verified.\n');
process.exit(0);
