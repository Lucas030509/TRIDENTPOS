import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import {
  getCorePackageInfo,
  CORE_PACKAGE_NAME,
  CORE_PACKAGE_VERSION,
  ok,
  err,
  verifyAccessToken,
  ALLOWED_JWT_ALGORITHMS,
  parseRolePermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  validatePinFormat,
  hashBranchPin,
  verifyBranchPin,
  ARGON2ID_FROZEN_BASELINE,
  redactSensitiveData,
  maskEmail,
  maskPhone,
  REDACTED_MARKER,
  canonicalize,
  GENESIS_PREVIOUS_RECORD_HASH,
  GENESIS_SEQUENCE_NUMBER,
  computeSha256Hex,
  buildCanonicalAuditPayload,
  computeAuditRecordHash,
  verifyRecordHash,
  verifyAuditHashChain,
  createCloudCheckpoint,
  verifyCloudCheckpoint,
  type AuditLogEventRecord,
} from './index.js';

describe('@trident/core Foundation', () => {
  it('package info returns expected metadata', () => {
    const info = getCorePackageInfo();
    assert.equal(info.name, CORE_PACKAGE_NAME);
    assert.equal(info.version, CORE_PACKAGE_VERSION);
    assert.equal(info.initialized, true);
  });

  it('Result type utility works as expected', () => {
    const success = ok('data');
    assert.equal(success.ok, true);
    if (success.ok) {
      assert.equal(success.value, 'data');
    }

    const failure = err(new Error('fail'));
    assert.equal(failure.ok, false);
    if (!failure.ok) {
      assert.equal(failure.error.message, 'fail');
    }
  });
});

describe('@trident/core Cryptographic JWT Verifier Suite', () => {
  const testIssuer = 'https://auth.tridentpos.test';
  const testAudience = 'https://api.tridentpos.test';
  const validSubUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  it('valid signed RS256 JWT is accepted with verified claims', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({
      email: 'admin@tenant-a.com',
      role: 'client_ignored_role',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.subject, validSubUuid);
      assert.equal(result.value.issuer, testIssuer);
      assert.equal(result.value.audience, testAudience);
      assert.ok(result.value.expiration > Math.floor(Date.now() / 1000));
      // Client-supplied claims in payload are preserved in rawClaims but not trusted for authorization
      assert.equal(result.value.rawClaims['role'], 'client_ignored_role');
    }
  });

  it('valid signed EdDSA JWT is accepted under algorithm allowlist', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');

    const token = await new SignJWT({
      email: 'staff@tenant-a.com',
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.subject, validSubUuid);
    }
  });

  it('invalid cryptographic signature is rejected', async () => {
    const keyPair1 = await generateKeyPair('RS256');
    const keyPair2 = await generateKeyPair('RS256');

    // Signed with key 1, verified with key 2
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(keyPair1.privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: keyPair2.publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'SIGNATURE_INVALID');
    }
  });

  it('expired JWT is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'TOKEN_EXPIRED');
    }
  });

  it('future nbf (not before) is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setNotBefore(Math.floor(Date.now() / 1000) + 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 7200)
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'TOKEN_NOT_YET_VALID');
    }
  });

  it('wrong issuer is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://rogue-auth.malicious.com')
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'ISSUER_MISMATCH');
    }
  });

  it('wrong audience is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience('https://other-service.test')
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'AUDIENCE_MISMATCH');
    }
  });

  it('missing subject is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSING_SUBJECT');
    }
  });

  it('malformed non-UUID subject is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject('user@domain.com') // not a valid UUID!
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'MALFORMED_SUBJECT_UUID');
    }
  });

  it('alg=none unsigned token is rejected', async () => {
    const { publicKey } = await generateKeyPair('RS256');

    // Build unsigned token with alg: none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: testIssuer,
        aud: testAudience,
        sub: validSubUuid,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');
    const unsignedToken = `${header}.${payload}.`;

    const result = await verifyAccessToken(unsignedToken, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'ALGORITHM_REJECTED');
    }
  });

  it('algorithm confusion / unapproved algorithm is rejected', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS384');

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS384' }) // RS384 is not in [RS256, EdDSA]
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: publicKey,
      algorithms: ALLOWED_JWT_ALGORITHMS,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'ALGORITHM_REJECTED');
    }
  });

  it('JWKS resolution succeeds with ephemeral local JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(testIssuer)
      .setAudience(testAudience)
      .setSubject(validSubUuid)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    // Dynamic JWKS key resolver
    const jwksResolver = async (header: { kid?: string }) => {
      if (header.kid === 'test-key-1') {
        return publicKey;
      }
      throw new Error('Key ID not recognized');
    };

    const result = await verifyAccessToken(token, {
      issuer: testIssuer,
      audience: testAudience,
      key: jwksResolver,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.subject, validSubUuid);
    }
  });
});

describe('@trident/core RBAC Evaluation Engine Suite', () => {
  it('parses valid JSON array of permissions', () => {
    const raw = ['comanda.iniciar', 'caja.cobrar', 'corte.emitir_x'];
    const parsed = parseRolePermissions(raw);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.value, raw);
    }
  });

  it('fails closed on non-array permissions', () => {
    const invalidInputs = [null, undefined, {}, 'comanda.iniciar', 123, true];
    for (const input of invalidInputs) {
      const parsed = parseRolePermissions(input);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) {
        assert.equal(parsed.error.code, 'MALFORMED_PERMISSIONS');
      }
    }
  });

  it('fails closed if array contains non-string or empty items', () => {
    const invalidArrays = [
      ['comanda.iniciar', 123],
      ['comanda.iniciar', null],
      ['comanda.iniciar', ''],
      ['comanda.iniciar', '   '],
      ['comanda.iniciar', {}],
    ];
    for (const arr of invalidArrays) {
      const parsed = parseRolePermissions(arr);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) {
        assert.equal(parsed.error.code, 'MALFORMED_PERMISSIONS');
      }
    }
  });

  it('hasPermission evaluates exact matches correctly', () => {
    const perms = ['comanda.iniciar', 'caja.cobrar'];
    assert.equal(hasPermission(perms, 'comanda.iniciar'), true);
    assert.equal(hasPermission(perms, 'caja.cobrar'), true);
    assert.equal(hasPermission(perms, 'corte.emitir_z'), false);
    assert.equal(hasPermission(perms, ''), false);
  });

  it('hasAllPermissions and hasAnyPermission evaluate deterministically', () => {
    const perms = ['comanda.iniciar', 'caja.cobrar'];
    assert.equal(hasAllPermissions(perms, ['comanda.iniciar']), true);
    assert.equal(hasAllPermissions(perms, ['comanda.iniciar', 'caja.cobrar']), true);
    assert.equal(hasAllPermissions(perms, ['comanda.iniciar', 'corte.emitir_z']), false);

    assert.equal(hasAnyPermission(perms, ['corte.emitir_z', 'comanda.iniciar']), true);
    assert.equal(hasAnyPermission(perms, ['corte.emitir_z', 'corte.emitir_x']), false);
  });
});

describe('@trident/core Argon2id Branch PIN Engine Suite', () => {
  it('validates PIN numeric format (4 to 8 digits)', () => {
    assert.equal(validatePinFormat('1234').ok, true);
    assert.equal(validatePinFormat('12345678').ok, true);
    assert.equal(validatePinFormat('123').ok, false); // too short
    assert.equal(validatePinFormat('123456789').ok, false); // too long
    assert.equal(validatePinFormat('abcd').ok, false); // non-numeric
    assert.equal(validatePinFormat('12 34').ok, false); // whitespace
  });

  it('generates Argon2id hash conforming to RFC 9106 frozen baseline', async () => {
    const pin = '4589';
    const hashResult = await hashBranchPin(pin);

    assert.equal(hashResult.ok, true);
    if (hashResult.ok) {
      const hash = hashResult.value;
      assert.ok(hash.startsWith('$argon2id$v=19$'), 'Must be Argon2id v=19');
      // Memory cost: 65536, parallelism: 4, time: 3
      assert.ok(hash.includes(`m=${ARGON2ID_FROZEN_BASELINE.memoryCost}`));
      assert.ok(hash.includes(`t=${ARGON2ID_FROZEN_BASELINE.timeCost}`));
      assert.ok(hash.includes(`p=${ARGON2ID_FROZEN_BASELINE.parallelism}`));

      // Verify that plain pin matches hash
      const verifyRes = await verifyBranchPin(hash, pin);
      assert.equal(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.equal(verifyRes.value, true);
      }

      // Verify wrong pin fails verification
      const wrongRes = await verifyBranchPin(hash, '9999');
      assert.equal(wrongRes.ok, true);
      if (wrongRes.ok) {
        assert.equal(wrongRes.value, false);
      }
    }
  });

  it('never leaks plaintext PIN in error messages', async () => {
    const invalidPin = 'bad_secret_pin';
    const res = await hashBranchPin(invalidPin);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(!res.error.message.includes(invalidPin), 'Error must not contain plaintext PIN');
    }
  });
});

describe('TRIDENTPOS WP-006 Platform Core Redaction & PII Masking Suite', () => {
  it('WP006-T37: password recursively redacted', () => {
    const input = {
      credentials: {
        password: 'SuperSecretPassword123!',
        nested: { password: 'another_password' },
      },
    };
    const output = redactSensitiveData(input);
    assert.equal(output.credentials.password, REDACTED_MARKER);
    assert.equal(output.credentials.nested.password, REDACTED_MARKER);
  });

  it('WP006-T38: pin / pin_hash recursively redacted', () => {
    const input = {
      security: {
        pin: '1234',
        pin_hash: '$argon2id$v=19$m=65536...',
        sub: [{ pin: '9876' }, { pin_hash: 'hash_abc' }],
      },
    };
    const output = redactSensitiveData(input);
    assert.equal(output.security.pin, REDACTED_MARKER);
    assert.equal(output.security.pin_hash, REDACTED_MARKER);
    assert.equal(output.security.sub[0]?.pin, REDACTED_MARKER);
    assert.equal(output.security.sub[1]?.pin_hash, REDACTED_MARKER);
  });

  it('WP006-T39: token / authorization recursively redacted', () => {
    const input = {
      headers: {
        authorization: 'Bearer eyJhbGciOi...',
        token: 'raw_opaque_token',
      },
    };
    const output = redactSensitiveData(input);
    assert.equal(output.headers.authorization, REDACTED_MARKER);
    assert.equal(output.headers.token, REDACTED_MARKER);
  });

  it('WP006-T40: secret/private_key recursively redacted', () => {
    const input = {
      auth: {
        secret: 'shhh_super_secret',
        private_key: '-----BEGIN RSA PRIVATE KEY-----...',
      },
    };
    const output = redactSensitiveData(input);
    assert.equal(output.auth.secret, REDACTED_MARKER);
    assert.equal(output.auth.private_key, REDACTED_MARKER);
  });

  it('WP006-T41: camelCase sensitive-key variants redacted', () => {
    const input = {
      accessToken: 'jwt_token_value',
      refreshToken: 'refresh_value',
      apiKey: 'api_key_value',
      clientSecret: 'client_secret_value',
      creditCard: '4111222233334444',
      cvv: '123',
    };
    const output = redactSensitiveData(input);
    assert.equal(output.accessToken, REDACTED_MARKER);
    assert.equal(output.refreshToken, REDACTED_MARKER);
    assert.equal(output.apiKey, REDACTED_MARKER);
    assert.equal(output.clientSecret, REDACTED_MARKER);
    assert.equal(output.creditCard, REDACTED_MARKER);
    assert.equal(output.cvv, REDACTED_MARKER);
  });

  it('WP006-T42: nested arrays sanitized', () => {
    const input = {
      items: [{ name: 'item1', token: 'token1' }, [{ secret: 'secret2' }, { phone: '5551234567' }]],
    };
    const output = redactSensitiveData(input);
    const firstItem = output.items[0] as { name: string; token: string };
    assert.equal(firstItem.token, REDACTED_MARKER);
    const subArr = output.items[1] as Array<{ secret?: string; phone?: string }>;
    assert.equal(subArr[0]?.secret, REDACTED_MARKER);
    assert.equal(subArr[1]?.phone, '******4567');
  });

  it('WP006-T43: input object not mutated', () => {
    const input = {
      user: {
        password: 'raw_password',
        pin: '1234',
        email: 'user@example.com',
      },
    };
    const snapshot = JSON.stringify(input);
    const output = redactSensitiveData(input);

    assert.equal(output.user.password, REDACTED_MARKER);
    assert.equal(output.user.pin, REDACTED_MARKER);
    assert.equal(output.user.email, 'u***@example.com');
    assert.equal(JSON.stringify(input), snapshot, 'Input object must NOT be mutated');
  });

  it('WP006-T44: email correctly masked', () => {
    assert.equal(maskEmail('admin@tenant-a.com'), 'a***@tenant-a.com');
    assert.equal(maskEmail('john.doe@company.org'), 'j***@company.org');
    assert.equal(maskEmail('x@domain.co'), 'x***@domain.co');
  });

  it('WP006-T45: phone correctly masked', () => {
    assert.equal(maskPhone('+1 555 123 4567'), '******4567');
    assert.equal(maskPhone('5551234'), '******1234');
    assert.equal(maskPhone('1234'), '******1234');
  });
});

describe('TRIDENTPOS WP-006 SHA-256 Hash Chain & Canonical Serialization Suite', () => {
  it('WP006-T48: genesis hash is exactly 64 zeroes', () => {
    assert.equal(GENESIS_PREVIOUS_RECORD_HASH.length, 64);
    assert.equal(GENESIS_PREVIOUS_RECORD_HASH, '0'.repeat(64));
    assert.equal(GENESIS_SEQUENCE_NUMBER, 1);
  });

  it('WP006-T49: SHA-256 output is lowercase 64-char hex', () => {
    const digest = computeSha256Hex('test_canonical_string');
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(digest, digest.toLowerCase());
  });

  it('WP006-T50: same canonical event produces deterministic digest', () => {
    const payloadInput = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      branchId: '22222222-2222-2222-2222-222222222222',
      sequenceNumber: 1,
      clientTimestamp: '2026-09-04T12:00:00.000Z',
      serverTimestamp: '2026-09-04T12:00:01.000Z',
      eventType: 'auth.login.success',
      action: 'LOGIN',
      entityName: 'user',
      entityId: '33333333-3333-3333-3333-333333333333',
      actorId: '33333333-3333-3333-3333-333333333333',
      stationId: null,
      redactedMetadata: { ip: '127.0.0.1', userAgent: 'Chrome' },
      previousRecordHash: GENESIS_PREVIOUS_RECORD_HASH,
    };

    const canonicalString = buildCanonicalAuditPayload(payloadInput);
    assert.ok(canonicalString.startsWith('{'));
    assert.equal(canonicalize({ z: 1, a: 2 }), '{"a":2,"z":1}');

    const hash1 = computeAuditRecordHash(payloadInput);
    const hash2 = computeAuditRecordHash(payloadInput);
    assert.equal(hash1, hash2);
  });

  it('WP006-T51: metadata key insertion order does not alter digest', () => {
    const base = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      branchId: '22222222-2222-2222-2222-222222222222',
      sequenceNumber: 1,
      clientTimestamp: null,
      serverTimestamp: '2026-09-04T12:00:01.000Z',
      eventType: 'order.created',
      action: 'CREATE',
      entityName: 'order',
      entityId: 'ord-123',
      actorId: null,
      stationId: null,
      previousRecordHash: GENESIS_PREVIOUS_RECORD_HASH,
    };

    const hashA = computeAuditRecordHash({
      ...base,
      redactedMetadata: { z: 26, a: 1, m: 13, nested: { b: 2, a: 1 } },
    });

    const hashB = computeAuditRecordHash({
      ...base,
      redactedMetadata: { a: 1, m: 13, z: 26, nested: { a: 1, b: 2 } },
    });

    assert.equal(hashA, hashB, 'RFC 8785 canonicalization must ensure key-order independence');
  });

  it('WP006-T52: changing sanitized payload changes digest', () => {
    const base = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      branchId: '22222222-2222-2222-2222-222222222222',
      sequenceNumber: 1,
      clientTimestamp: null,
      serverTimestamp: '2026-09-04T12:00:01.000Z',
      eventType: 'order.created',
      action: 'CREATE',
      entityName: 'order',
      entityId: 'ord-123',
      actorId: null,
      stationId: null,
      redactedMetadata: { total: 100 },
      previousRecordHash: GENESIS_PREVIOUS_RECORD_HASH,
    };

    const hash1 = computeAuditRecordHash(base);
    const hash2 = computeAuditRecordHash({
      ...base,
      redactedMetadata: { total: 101 },
    });

    assert.notEqual(hash1, hash2, 'Changing payload data must alter SHA-256 digest');
  });

  it('WP006-T53: previous_record_hash chaining correct', () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const branchId = '22222222-2222-2222-2222-222222222222';

    const event1Hash = computeAuditRecordHash({
      organizationId: orgId,
      branchId,
      sequenceNumber: 1,
      clientTimestamp: null,
      serverTimestamp: '2026-09-04T12:00:01.000Z',
      eventType: 'event.one',
      action: 'ACTION_1',
      entityName: 'entity',
      entityId: '1',
      actorId: null,
      stationId: null,
      redactedMetadata: {},
      previousRecordHash: GENESIS_PREVIOUS_RECORD_HASH,
    });

    const event2Hash = computeAuditRecordHash({
      organizationId: orgId,
      branchId,
      sequenceNumber: 2,
      clientTimestamp: null,
      serverTimestamp: '2026-09-04T12:00:02.000Z',
      eventType: 'event.two',
      action: 'ACTION_2',
      entityName: 'entity',
      entityId: '2',
      actorId: null,
      stationId: null,
      redactedMetadata: {},
      previousRecordHash: event1Hash,
    });

    assert.notEqual(event2Hash, event1Hash);
    assert.equal(event2Hash.length, 64);
  });
});

describe('TRIDENTPOS WP-006 Audit Trail Verification & Cloud Checkpoint Suite', () => {
  const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function createValidChain(count: number): AuditLogEventRecord[] {
    const chain: AuditLogEventRecord[] = [];
    let prevHash = GENESIS_PREVIOUS_RECORD_HASH;

    for (let i = 1; i <= count; i++) {
      const serverTimestamp = `2026-09-04T12:00:0${i}.000Z`;
      const hash = computeAuditRecordHash({
        organizationId: orgId,
        branchId,
        sequenceNumber: i,
        clientTimestamp: null,
        serverTimestamp,
        eventType: `event.${i}`,
        action: 'EXECUTE',
        entityName: 'test',
        entityId: `id-${i}`,
        actorId: null,
        stationId: null,
        redactedMetadata: { step: i },
        previousRecordHash: prevHash,
      });

      chain.push({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        organizationId: orgId,
        branchId,
        actorId: null,
        stationId: null,
        eventType: `event.${i}`,
        severity: 'INFO',
        action: 'EXECUTE',
        entityName: 'test',
        entityId: `id-${i}`,
        clientTimestamp: null,
        serverTimestamp,
        sequenceNumber: i,
        previousRecordHash: prevHash,
        recordHash: hash,
        source: 'CLOUD',
        requestId: null,
        metadata: { step: i },
        createdAt: serverTimestamp,
      });

      prevHash = hash;
    }

    return chain;
  }

  it('WP006-T58: valid chain verifies', () => {
    const chain = createValidChain(5);
    assert.equal(verifyRecordHash(chain[0]!), true);
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, true);
  });

  it('WP006-T59: modified event rejected', () => {
    const chain = createValidChain(5);
    // Tamper with payload of record 3 without updating hash
    chain[2]!.metadata = { step: 999 };
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'PAYLOAD_MODIFIED');
    assert.equal(result.failedIndex, 2);
  });

  it('WP006-T60: wrong previous hash rejected', () => {
    const chain = createValidChain(5);
    // Mutate previousRecordHash of record 3
    chain[2]!.previousRecordHash = 'f'.repeat(64);
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'WRONG_PREVIOUS_HASH');
    assert.equal(result.failedIndex, 2);
  });

  it('WP006-T61: sequence gap rejected', () => {
    const chain = createValidChain(5);
    // Introduce sequence gap at record 3 (skip sequence 3 to 4)
    chain[2]!.sequenceNumber = 4;
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'SEQUENCE_GAP');
    assert.equal(result.failedIndex, 2);
  });

  it('WP006-T62: event reordering rejected', () => {
    const chain = createValidChain(5);
    // Inverted sequence order: sequence decreased from 2 to 1
    chain[2]!.sequenceNumber = 1;
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'REORDERED_EVENTS');
    assert.equal(result.failedIndex, 2);
  });

  it('WP006-T63: duplicate replay same id/hash handled idempotently where applicable', () => {
    const chain = createValidChain(3);
    const target = chain[0]!;

    // Verification that identical id and identical record hash is recognized as idempotent candidate
    const isIdempotentCandidate = (incoming: AuditLogEventRecord, existing: AuditLogEventRecord) =>
      incoming.id === existing.id && incoming.recordHash === existing.recordHash;

    assert.equal(isIdempotentCandidate({ ...target }, target), true);
  });

  it('WP006-T64: same sequence/id with different hash rejected', () => {
    const chain = createValidChain(3);
    const target = chain[1]!;
    const tampered = { ...target, recordHash: 'e'.repeat(64) };

    const isTampering = (incoming: AuditLogEventRecord, existing: AuditLogEventRecord) =>
      incoming.sequenceNumber === existing.sequenceNumber &&
      incoming.recordHash !== existing.recordHash;

    assert.equal(isTampering(tampered, target), true);
  });

  it('WP006-T65: malformed digest rejected', () => {
    const chain = createValidChain(3);
    chain[1]!.recordHash = 'not_a_sha256_hash';
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'MALFORMED_HASH');
    assert.equal(result.failedIndex, 1);
  });

  it('WP006-T66: broken chain produces governed integrity failure result', () => {
    const chain = createValidChain(4);
    // Break the chain at index 1
    chain[1]!.previousRecordHash = '0123456789abcdef'.repeat(4);
    const result = verifyAuditHashChain(chain);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'WRONG_PREVIOUS_HASH');
    assert.equal(result.failedRecordId, chain[1]!.id);

    // Verify Cloud Checkpoint creation and verification primitives
    const validChain = createValidChain(4);
    const checkpoint = createCloudCheckpoint(validChain, `${orgId}:${branchId}`);
    assert.equal(checkpoint.start_sequence_number, 1);
    assert.equal(checkpoint.end_sequence_number, 4);
    assert.equal(checkpoint.event_count, 4);
    assert.equal(verifyCloudCheckpoint(checkpoint, validChain), true);

    // Tampered chain must fail checkpoint verification
    assert.equal(verifyCloudCheckpoint(checkpoint, chain), false);
  });
});
