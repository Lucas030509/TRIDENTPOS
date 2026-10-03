import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  MockPacConnector,
  createTestPacProvenance,
  authorizePacCapabilityUse,
  buildProvenanceAttestationPayload,
  buildRevocationAttestationPayload,
  validateEventContractVersion,
  assertSubscriberCompatibility,
  assertEventContractEvolution,
  generateFiscalSemanticEventId,
  validateAndExtractTimbreFiscalDigital,
  FiscalErrorSanitizer,
  type PacContractProvenance,
  type PacCapabilityName,
  type PacAuthorizationRegistry,
} from './index.js';

// Test simulation only: never production provider-contract evidence.
const keys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const bytes = Buffer.from('%PDF-1.7 exact test evidence');
function fixture(
  capability: PacCapabilityName = 'supportsStamp',
  operationType: 'STAMP' | 'CANCEL' = 'STAMP',
  recoveryCondition = 'NONE',
) {
  const p = createTestPacProvenance({
    evidenceByteLength: bytes.length,
    evidenceDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
    approvedScope: { organizationId: 'tenant-a', operationType, capability, recoveryCondition },
    revocationSnapshotIssuedAt: new Date(Date.now() - 1000).toISOString(),
    revocationSnapshotValidUntil: new Date(Date.now() + 30000).toISOString(),
  });
  const sign = () => {
    p.approvalAttestation = crypto
      .sign('sha256', Buffer.from(buildProvenanceAttestationPayload(p)), keys.privateKey)
      .toString('base64');
    p.revocationAttestation = crypto
      .sign('sha256', Buffer.from(buildRevocationAttestationPayload(p)), keys.privateKey)
      .toString('base64');
  };
  sign();
  const authority = {
    authorityId: p.approvalAuthorityId,
    keyId: p.approvalKeyId,
    publicKeyPem: keys.publicKey,
    allowedScopes: [
      {
        providerName: 'MOCK_PAC',
        scope: 'tenant-a',
        allowedOperations: ['STAMP', 'CANCEL'] as ('STAMP' | 'CANCEL')[],
      },
    ],
    status: 'ACTIVE' as const,
  };
  const authorities = new Map([
    [`${p.approvalAuthorityId}:${p.approvalKeyId}`, authority],
    [
      `${p.revocationAuthorityId}:${p.revocationKeyId}`,
      { ...authority, authorityId: p.revocationAuthorityId, keyId: p.revocationKeyId },
    ],
  ]);
  let highWater = -1;
  let reads = 0;
  const current = {
    provenance: p,
    evidenceBytes: bytes as Uint8Array,
    evidenceMediaType: 'application/pdf',
    authorities,
  };
  const registry: PacAuthorizationRegistry = {
    maxStatusAgeMs: 10000,
    async readCurrent() {
      reads++;
      return current;
    },
    async acceptSequence(_identity, seq) {
      if (seq < highWater) return false;
      highWater = seq;
      return true;
    },
  };
  const connector = new MockPacConnector({ [capability]: true }, p);
  const context = { organizationId: 'tenant-a', operationType, recoveryCondition };
  return {
    p,
    sign,
    registry,
    connector,
    context,
    current,
    get reads() {
      return reads;
    },
  };
}
const subscription = {
  subscriberName: 'finance',
  supportedMajors: [1],
  requiredFields: ['invoiceId'],
};
describe('Canonical REQ-75..87 — bounded remediation simulation', () => {
  it('REQ-75 canonical syntax rejects whitespace/overflow and identity excludes version', () => {
    for (const v of [undefined, ' 1.0', '1.0 ', '01.0', '1', '1.0-beta', '9007199254740993.0'])
      assert.throws(() => validateEventContractVersion(v));
    assert.deepEqual(validateEventContractVersion('1.12'), { major: 1, minor: 12 });
    assert.equal(
      generateFiscalSemanticEventId('a', 'op', 'kind'),
      generateFiscalSemanticEventId('a', 'op', 'kind'),
    );
  });
  it('REQ-76 optional additive fields increment minor and same-major consumer ignores extras', () => {
    const fields = { invoiceId: { required: true, meaning: 'invoice identity' } };
    assert.doesNotThrow(() =>
      assertEventContractEvolution(
        { version: '1.0', fields },
        {
          version: '1.1',
          fields: { ...fields, note: { required: false, meaning: 'optional note' } },
        },
      ),
    );
    assert.doesNotThrow(() =>
      assertSubscriberCompatibility(
        '1.1',
        { invoiceId: 'i', note: 'unknown optional' },
        subscription,
      ),
    );
  });
  it('REQ-77 changed meaning or new required field requires new major', () => {
    const previous = {
      version: '1.0',
      fields: { invoiceId: { required: true, meaning: 'invoice identity' } },
    };
    for (const fields of [
      { invoiceId: { required: true, meaning: 'different semantics' } },
      { ...previous.fields, requiredNew: { required: true, meaning: 'mandatory' } },
    ]) {
      assert.throws(() => assertEventContractEvolution(previous, { version: '1.1', fields }));
      assert.doesNotThrow(() => assertEventContractEvolution(previous, { version: '2.0', fields }));
    }
  });
  it('REQ-78 invalid/missing version, unknown major and required payload reject before consumption', () => {
    for (const v of [undefined, '', 'bad', '2.0'])
      assert.throws(() => assertSubscriberCompatibility(v, { invoiceId: 'i' }, subscription));
    assert.throws(() => assertSubscriberCompatibility('1.0', {}, subscription));
  });
  it('REQ-79 required subscriber incompatible or unknown declaration blocks publication', () => {
    assert.throws(() =>
      assertSubscriberCompatibility(
        '1.0',
        { invoiceId: 'i' },
        { ...subscription, supportedMajors: [] },
      ),
    );
    assert.throws(() =>
      assertSubscriberCompatibility(
        '1.0',
        { invoiceId: 'i' },
        { ...subscription, requiredFields: [] },
        ['invoiceId'],
      ),
    );
    assert.throws(() => assertSubscriberCompatibility('1.0', {}, subscription));
  });
  it('REQ-81 actual authenticated signatures bind exact approval fields', async () => {
    const f = fixture();
    await authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry);
    assert.equal(f.reads, 1);
    f.p.evidenceUriOrReference += '/altered';
    await assert.rejects(
      authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
    );
  });
  it('REQ-82 unknown authority, signature, evidence, media and length changes fail closed', async () => {
    const mutations = [
      (f: ReturnType<typeof fixture>) => f.current.authorities.clear(),
      (f: ReturnType<typeof fixture>) => {
        f.p.approvalAttestation = 'forged';
      },
      (f: ReturnType<typeof fixture>) => {
        f.current.evidenceBytes = Buffer.from('changed');
      },
      (f: ReturnType<typeof fixture>) => {
        f.current.evidenceMediaType = 'text/plain';
      },
      (f: ReturnType<typeof fixture>) => {
        f.p.evidenceByteLength++;
        f.sign();
      },
      (f: ReturnType<typeof fixture>) => {
        f.current.evidenceBytes = new Uint8Array();
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      mutate(f);
      await assert.rejects(
        authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
      );
    }
  });
  it('REQ-83 missing or unverifiable registry/provenance is unavailable', async () => {
    const f = fixture();
    await assert.rejects(authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context));
    f.connector.contractProvenance = null;
    await assert.rejects(
      authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
    );
  });
  it('REQ-84 positive result cannot cache past revocation, supersession or expiry', async () => {
    for (const status of ['REVOKED', 'SUPERSEDED'] as const) {
      const f = fixture();
      await authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry);
      f.p.revocationStatus = status;
      f.sign();
      await assert.rejects(
        authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
      );
      assert.equal(f.reads, 2);
    }
    const f = fixture();
    f.p.effectiveUntil = new Date(Date.now() - 1).toISOString();
    f.sign();
    await assert.rejects(
      authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
    );
  });
  it('REQ-85 provider/contract/operation/capability/recovery/tenant mismatch unavailable', async () => {
    for (const overrides of [
      { organizationId: 'tenant-b' },
      { operationType: 'CANCEL' as const },
      { recoveryCondition: 'REPLAY' },
    ]) {
      const f = fixture();
      await assert.rejects(
        authorizePacCapabilityUse(
          f.connector,
          'supportsStamp',
          { ...f.context, ...overrides },
          f.registry,
        ),
      );
    }
    const f = fixture();
    f.p.providerName = 'OTHER';
    f.sign();
    await assert.rejects(
      authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
    );
  });
  it('REQ-86 unavailable/stale/future status, bad status signature and monotonic rollback unavailable', async () => {
    for (const mutate of [
      (p: PacContractProvenance) => {
        p.revocationSnapshotIssuedAt = new Date(Date.now() - 20000).toISOString();
      },
      (p: PacContractProvenance) => {
        p.revocationSnapshotIssuedAt = new Date(Date.now() + 10000).toISOString();
      },
      (p: PacContractProvenance) => {
        p.effectiveFrom = 'bad';
      },
    ]) {
      const f = fixture();
      mutate(f.p);
      f.sign();
      await assert.rejects(
        authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
      );
    }
    const f = fixture();
    await authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry);
    f.p.revocationSequence = 0;
    f.sign();
    await assert.rejects(
      authorizePacCapabilityUse(f.connector, 'supportsStamp', f.context, f.registry),
    );
    const g = fixture();
    g.p.revocationAttestation = 'forged';
    await assert.rejects(
      authorizePacCapabilityUse(g.connector, 'supportsStamp', g.context, g.registry),
    );
    const h = fixture();
    h.registry.readCurrent = async () => {
      throw new Error('unavailable');
    };
    await assert.rejects(
      authorizePacCapabilityUse(h.connector, 'supportsStamp', h.context, h.registry),
    );
  });
  it('REQ-87 matrix proves separate operation and recovery scope for every capability', async () => {
    const cases: [PacCapabilityName, 'STAMP' | 'CANCEL', string][] = [
      ['supportsStamp', 'STAMP', 'NONE'],
      ['supportsCancel', 'CANCEL', 'NONE'],
      ['supportsStampIdempotencyKey', 'STAMP', 'IDEMPOTENT_RETRY'],
      ['supportsCancellationIdempotencyKey', 'CANCEL', 'IDEMPOTENT_RETRY'],
      ['supportsAuthoritativeStampLookup', 'STAMP', 'RECONCILIATION_LOOKUP'],
      ['supportsAuthoritativeCancellationLookup', 'CANCEL', 'RECONCILIATION_LOOKUP'],
      ['supportsSafeStampReplayAfterConfirmedNotFound', 'STAMP', 'NOT_FOUND_REPLAY'],
      ['supportsSafeCancellationReplayAfterConfirmedNotFound', 'CANCEL', 'NOT_FOUND_REPLAY'],
    ];
    for (const [cap, op, recovery] of cases) {
      const f = fixture(cap, op, recovery);
      await authorizePacCapabilityUse(f.connector, cap, f.context, f.registry);
      await assert.rejects(
        authorizePacCapabilityUse(
          f.connector,
          cap,
          { ...f.context, operationType: op === 'STAMP' ? 'CANCEL' : 'STAMP' },
          f.registry,
        ),
      );
      await assert.rejects(
        authorizePacCapabilityUse(
          f.connector,
          cap,
          { ...f.context, recoveryCondition: 'WRONG' },
          f.registry,
        ),
      );
    }
  });
});

describe('XML and error abuse regression', () => {
  const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const tfd = `<tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-10-01T10:00:00Z" RfcProvCertif="SAT970701NN3" NoCertificadoSAT="30001000000500003416" SelloSAT="${Buffer.alloc(64, 1).toString('base64')}"/>`;
  const xml = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0"><cfdi:Complemento>${tfd}</cfdi:Complemento></cfdi:Comprobante>`;
  it('Rejects forged namespaces, arbitrary TFD placement, duplicate attributes and provider mismatch', () => {
    assert.doesNotThrow(() =>
      validateAndExtractTimbreFiscalDigital(xml, { expectedProvider: 'SAT970701NN3' }),
    );
    for (const forged of [
      xml.replace('http://www.sat.gob.mx/cfd/4', 'https://attacker'),
      xml
        .replace('<cfdi:Complemento>', '<cfdi:Complemento><cfdi:Wrapper>')
        .replace('</cfdi:Complemento>', '</cfdi:Wrapper></cfdi:Complemento>'),
      xml.replace(`UUID="${uuid}"`, `UUID="${uuid}" UUID="${uuid}"`),
      '<!DOCTYPE x>' + xml,
      xml.replace('Version="4.0"', 'Version="4.0" __proto__="x"') + 'junk',
    ])
      assert.throws(() => validateAndExtractTimbreFiscalDigital(forged));
    assert.throws(() =>
      validateAndExtractTimbreFiscalDigital(xml, { expectedProvider: 'AAA010101AAA' }),
    );
  });

  it('A1: Rejects altered original fiscal complements and preserves submitted complement content', () => {
    const base =
      '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="116">';
    const original =
      base +
      '<cfdi:Complemento><p:Pago xmlns:p="urn:payments" Monto="100"/></cfdi:Complemento></cfdi:Comprobante>';
    const tfdElem =
      '<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="12345678-1234-1234-1234-123456789012" FechaTimbrado="2026-10-02T12:00:00Z" RfcProvCertif="SAT970701NN3" SelloSAT="' +
      'A'.repeat(40) +
      '" NoCertificadoSAT="30001000000500003416"/>';

    // Legitimate addition of TFD alongside original complement must succeed
    const legitimate =
      base +
      '<cfdi:Complemento><p:Pago xmlns:p="urn:payments" Monto="100"/>' +
      tfdElem +
      '</cfdi:Complemento></cfdi:Comprobante>';
    assert.doesNotThrow(() =>
      validateAndExtractTimbreFiscalDigital(legitimate, {
        expectedOriginalXml: original,
        expectedProvider: 'SAT970701NN3',
      }),
    );

    // Altered original complement (Monto=100 -> 999999) must be rejected fail-closed
    const altered =
      base +
      '<cfdi:Complemento><p:Pago xmlns:p="urn:payments" Monto="999999"/>' +
      tfdElem +
      '</cfdi:Complemento></cfdi:Comprobante>';
    assert.throws(() =>
      validateAndExtractTimbreFiscalDigital(altered, {
        expectedOriginalXml: original,
        expectedProvider: 'SAT970701NN3',
      }),
    );
  });

  it('A2: Rejects malformed XML missing attribute separator or containing raw unescaped ampersands', () => {
    assert.throws(() =>
      validateAndExtractTimbreFiscalDigital('<root a="1"b="2">unescaped & text</root>'),
    );
    assert.throws(() =>
      validateAndExtractTimbreFiscalDigital('<root attr="val"bad="1">test</root>'),
    );
    assert.throws(() =>
      validateAndExtractTimbreFiscalDigital(
        '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">Unescaped & in text</cfdi:Comprobante>',
      ),
    );
  });

  it('Opaque sanitizer excludes JSON/JWT/encoded/multiline secrets including supplied correlation', () => {
    for (const raw of [
      '{"password":"CANARY"}',
      'eyJhbGciOiJIUzI1NiJ9.CANARY.signature',
      'password%3DCANARY',
      'password=\nCANARY',
      '-----BEGIN PRIVATE KEY-----CANARY',
    ]) {
      const safe = FiscalErrorSanitizer.sanitize(new Error(raw), 'CANARY');
      assert.ok(!JSON.stringify(safe).includes('CANARY'));
    }
  });
});
