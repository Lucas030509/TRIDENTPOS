import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildProvenanceAttestationPayload,
  buildRevocationAttestationPayload,
  createTestPacProvenance,
  type PacAuthorizationRegistry,
  type IPacConnector,
} from '@trident/billing';

/** Simulation only. No production PAC accreditation or production registry. */
export function signedTestRegistry(connector: IPacConnector): PacAuthorizationRegistry {
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const evidenceBytes = Buffer.from('%PDF-1.7 signed TEST contract fixture');
  const sequences = new Map<string, number>();
  const providerKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const evidencePayload = (result: Record<string, unknown>) => {
    const { testProviderAttestation: _signature, ...body } = result;
    void _signature;
    return JSON.stringify(body);
  };
  // Only this test module signs simulated provider responses. No runtime default does so.
  for (const method of [
    'timbrar',
    'cancelar',
    'consultarTimbre',
    'consultarCancelacion',
  ] as const) {
    const original = connector[method]?.bind(connector);
    if (!original) continue;
    (connector as unknown as Record<string, unknown>)[method] = async (request: never) => {
      const result = (await original(request)) as unknown as Record<string, unknown>;
      return {
        ...result,
        testProviderAttestation: crypto
          .sign('sha256', Buffer.from(evidencePayload(result)), providerKeys.privateKey)
          .toString('base64'),
      };
    };
  }
  return {
    maxStatusAgeMs: 10000,
    async verifyFiscalEvidence(_context, _providerName, input) {
      const result = input as Record<string, unknown>;
      return (
        typeof result['testProviderAttestation'] === 'string' &&
        crypto.verify(
          'sha256',
          Buffer.from(evidencePayload(result)),
          providerKeys.publicKey,
          Buffer.from(result['testProviderAttestation'], 'base64'),
        )
      );
    },
    async readCurrent(context, providerName) {
      const p = createTestPacProvenance({
        ...connector.contractProvenance!,
        providerName,
        evidenceByteLength: evidenceBytes.length,
        evidenceDigest: crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
        approvedScope: {
          organizationId: context.organizationId,
          operationType: context.operationType,
          capability: context.capability,
          recoveryCondition: context.recoveryCondition ?? 'NONE',
        },
        revocationSnapshotIssuedAt: new Date(Date.now() - 100).toISOString(),
        revocationSnapshotValidUntil: new Date(Date.now() + 30000).toISOString(),
      });
      p.approvalAttestation = crypto
        .sign('sha256', Buffer.from(buildProvenanceAttestationPayload(p)), keys.privateKey)
        .toString('base64');
      p.revocationAttestation = crypto
        .sign('sha256', Buffer.from(buildRevocationAttestationPayload(p)), keys.privateKey)
        .toString('base64');
      const key = {
        authorityId: p.approvalAuthorityId,
        keyId: p.approvalKeyId,
        publicKeyPem: keys.publicKey,
        status: 'ACTIVE' as const,
        allowedScopes: [
          {
            providerName,
            scope: context.organizationId,
            allowedOperations: [context.operationType],
          },
        ],
      };
      return {
        provenance: p,
        evidenceBytes,
        evidenceMediaType: 'application/pdf',
        authorities: new Map([
          [`${p.approvalAuthorityId}:${p.approvalKeyId}`, key],
          [
            `${p.revocationAuthorityId}:${p.revocationKeyId}`,
            { ...key, authorityId: p.revocationAuthorityId, keyId: p.revocationKeyId },
          ],
        ]),
      };
    },
    async acceptSequence(id, seq) {
      if (seq < (sequences.get(id) ?? -1)) return false;
      sequences.set(id, seq);
      return true;
    },
  };
}

export function realTestCertificate(privateKey: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wp021-csd-'));
  try {
    const key = path.join(directory, 'key.pem');
    const cert = path.join(directory, 'cert.pem');
    fs.writeFileSync(key, privateKey, { mode: 0o600 });
    execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-x509',
        '-key',
        key,
        '-out',
        cert,
        '-days',
        '30',
        '-subj',
        '/CN=WP021 TEST ONLY',
      ],
      { stdio: 'ignore' },
    );
    return fs.readFileSync(cert, 'utf8');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
