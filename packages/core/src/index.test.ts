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
