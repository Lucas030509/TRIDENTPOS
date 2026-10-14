/**
 * TRIDENTPOS WP-028 Release Packaging & Supply Chain Integration Test Suite
 *
 * Location: tests/integration/wp028-release-packaging.test.mjs
 * Framework: EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
 *
 * Validates:
 * 1. Multi-platform distribution packages for Windows, Linux, and macOS.
 * 2. Cryptographic signature and checksum validation (SHA-256, SHA-512, Ed25519).
 * 3. Secure Auto-Update protocol verification (SUPPLY_CHAIN_SECURITY.md Sec. 2).
 * 4. Anti-tampering drill: Fail-closed rejection of corrupted packages and manifests.
 * 5. SLSA Level 3 Provenance attestation (in-toto statement / slsa.dev v1).
 * 6. CycloneDX 1.5 SBOM integrity.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const releaseDir = path.join(rootDir, 'release');

describe('TRIDENTPOS WP-028: Release Packaging & Supply Chain Integrity Suite', () => {
  before(() => {
    // Generate fresh release packages, manifests, provenance, and SBOM
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'package-release.mjs')], {
      cwd: rootDir,
    });
    execFileSync(
      process.execPath,
      [path.join(rootDir, 'scripts', 'generate-slsa-provenance.mjs')],
      { cwd: rootDir },
    );
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'generate-sbom.mjs')], {
      cwd: rootDir,
    });
  });

  it('WP028-PKG-01: Multi-platform release packages generated for Windows, Linux, and macOS', () => {
    const expectedTargets = [
      'tridentpos-edge-0.1.0.AppImage',
      'tridentpos-edge-0.1.0.tar.gz',
      'tridentpos-edge_0.1.0_amd64.deb',
      'tridentpos-edge-Setup-0.1.0.exe',
      'tridentpos-edge-0.1.0-win.zip',
      'tridentpos-edge-0.1.0.dmg',
      'tridentpos-edge-0.1.0-mac.zip',
    ];

    for (const target of expectedTargets) {
      const targetPath = path.join(releaseDir, target);
      assert.ok(fs.existsSync(targetPath), `Release target package ${target} must exist`);
      const stat = fs.statSync(targetPath);
      assert.ok(stat.size > 0, `Package ${target} must not be empty`);
    }
  });

  it('WP028-PKG-02: Cryptographic checksum manifests (SHA-256 and SHA-512) match byte-for-byte', () => {
    const sha256Lines = fs
      .readFileSync(path.join(releaseDir, 'checksums.sha256'), 'utf8')
      .trim()
      .split('\n');
    const sha512Lines = fs
      .readFileSync(path.join(releaseDir, 'checksums.sha512'), 'utf8')
      .trim()
      .split('\n');

    assert.ok(sha256Lines.length >= 7, 'Must contain checksums for all distribution packages');
    assert.ok(
      sha512Lines.length >= 7,
      'Must contain SHA-512 checksums for all distribution packages',
    );

    for (const line of sha256Lines) {
      const [expectedSha256, filename] = line.split(/\s+/);
      const filePath = path.join(releaseDir, filename);
      const actualSha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
      assert.equal(actualSha256, expectedSha256, `SHA-256 for ${filename} must match manifest`);
    }

    for (const line of sha512Lines) {
      const [expectedSha512, filename] = line.split(/\s+/);
      const filePath = path.join(releaseDir, filename);
      const actualSha512 = crypto
        .createHash('sha512')
        .update(fs.readFileSync(filePath))
        .digest('hex');
      assert.equal(actualSha512, expectedSha512, `SHA-512 for ${filename} must match manifest`);
    }
  });

  it('WP028-PKG-03: Electron Auto-Update Manifests (latest.yml, latest-linux.yml, latest-mac.yml) are cryptographically signed', () => {
    const pubKeyPath = path.join(releaseDir, 'release-public-key.pem');
    assert.ok(fs.existsSync(pubKeyPath), 'Release public key must exist');
    const publicKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath, 'utf8'));

    const manifests = ['latest.yml', 'latest-linux.yml', 'latest-mac.yml'];

    for (const manifestName of manifests) {
      const manifestPath = path.join(releaseDir, manifestName);
      assert.ok(fs.existsSync(manifestPath), `${manifestName} must exist`);

      const raw = fs.readFileSync(manifestPath, 'utf8');
      const lines = raw.trim().split('\n');

      const sigLine = lines.find((l) => l.startsWith('ed25519_signature: '));
      assert.ok(sigLine, `${manifestName} must contain ed25519_signature`);

      const sig = sigLine.replace('ed25519_signature: ', '').trim();
      const body = lines.filter((l) => !l.startsWith('ed25519_signature: ')).join('\n');

      const isValid = crypto.verify(
        null,
        Buffer.from(body, 'utf8'),
        publicKey,
        Buffer.from(sig, 'base64'),
      );

      assert.ok(isValid, `${manifestName} digital signature must verify with public key`);
    }
  });

  it('WP028-PKG-04: Anti-tampering drill proves single-byte payload corruption fails closed', () => {
    const pubKeyPath = path.join(releaseDir, 'release-public-key.pem');
    const publicKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath, 'utf8'));

    const sampleBinary = path.join(releaseDir, 'tridentpos-edge-0.1.0.tar.gz');
    const authenticBytes = fs.readFileSync(sampleBinary);
    const tamperedBytes = Buffer.from(authenticBytes);
    tamperedBytes[0] ^= 0x01; // corrupt one byte

    const rawManifest = fs.readFileSync(path.join(releaseDir, 'latest-linux.yml'), 'utf8');
    const sigMatch = rawManifest.match(
      /tridentpos-edge-0\.1\.0\.tar\.gz[\s\S]*?signature:\s+([A-Za-z0-9+/=]+)/,
    );
    assert.ok(sigMatch, 'Must find binary signature in manifest');
    const signature = sigMatch[1];

    const isTamperedValid = crypto.verify(
      null,
      tamperedBytes,
      publicKey,
      Buffer.from(signature, 'base64'),
    );

    assert.equal(
      isTamperedValid,
      false,
      'Tampered binary MUST fail signature verification fail-closed',
    );
  });

  it('WP028-PKG-05: SLSA Level 3 Provenance attestation conforms to in-toto Statement v1', () => {
    const slsaPath = path.join(releaseDir, 'tridentpos-provenance.slsa.json');
    assert.ok(fs.existsSync(slsaPath), 'SLSA provenance file must exist');

    const provenance = JSON.parse(fs.readFileSync(slsaPath, 'utf8'));
    assert.equal(provenance._type, 'https://in-toto.io/Statement/v1');
    assert.equal(provenance.predicateType, 'https://slsa.dev/provenance/v1');
    assert.ok(
      Array.isArray(provenance.subject) && provenance.subject.length >= 7,
      'Subjects must list release artifacts',
    );

    for (const item of provenance.subject) {
      assert.ok(item.name, 'Subject item must have name');
      assert.ok(item.digest.sha256, 'Subject item must have sha256 digest');
      assert.ok(item.digest.sha512, 'Subject item must have sha512 digest');
    }

    assert.equal(
      provenance.predicate.buildDefinition.buildType,
      'https://tridentpos.dev/builders/npm-workspaces/v1',
    );
    assert.ok(
      provenance.predicate.buildDefinition.externalParameters.gitCommit,
      'Must record git commit SHA',
    );
  });

  it('WP028-PKG-06: CycloneDX 1.5 SBOM satisfies toolchain inventory requirements', () => {
    const sbomPath = path.join(rootDir, 'tridentpos-sbom.cdx.json');
    assert.ok(fs.existsSync(sbomPath), 'tridentpos-sbom.cdx.json must exist');

    const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.5');
    assert.ok(
      Array.isArray(sbom.components) && sbom.components.length > 50,
      'Must contain components',
    );

    const names = new Set(sbom.components.map((c) => c.name));
    for (const tool of ['typescript', 'eslint', 'prettier', 'turbo']) {
      assert.ok(names.has(tool), `SBOM must include toolchain component: ${tool}`);
    }
  });
});
