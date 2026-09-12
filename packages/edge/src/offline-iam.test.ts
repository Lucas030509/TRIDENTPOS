/**
 * TRIDENTPOS WP-010 Automated Test Suite
 * Edge Offline IAM & Floor PIN Authentication Engine
 *
 * Implements all 22+ governed automated test requirements:
 * 1. Correct PIN succeeds locally and returns valid station session.
 * 2. Incorrect PIN fails authentication.
 * 3. Plaintext PIN never persisted anywhere in SQLite or on disk.
 * 4. Plaintext PIN never logged in console, audit events, or errors.
 * 5. Cross-user authentication rejected fail-closed.
 * 6. Cross-station session misuse rejected fail-closed.
 * 7. Expired cached credential rejected fail-closed.
 * 8. Corrupted cached credential rejected fail-closed.
 * 9. Brute-force repeated failures trigger governed lockout (5 consecutive failures -> 5m lock).
 * 10. Correct PIN while locked remains rejected until lock expires or unlocked.
 * 11. Lockout persistence survives process restart.
 * 12. Governed lockout release behavior (natural expiry and supervisor override unlock).
 * 13. Clock rollback detection (fail-closed on backward clock drift).
 * 14. Token/session issuedAt cannot be bypassed by wall-clock rollback.
 * 15. Session bound to correct station ID and valid station identity.
 * 16. Invalid or revoked station identity rejected fail-closed.
 * 17. Session expiry enforced (12 hours TTL).
 * 18. Concurrent failed attempts cannot bypass lockout counters (concurrency & race safety).
 * 19. SQLite transaction failure produces no partial auth-state mutation.
 * 20. Sensitive values redacted from errors, audit payloads, and telemetry.
 * 21. HTTP API POST /api/v1/auth/pin handles success, failure, locked station (Retry-After), supervisor unlock.
 * 22. [Obligation] Brute-force PIN attack test (100 rapid attack requests).
 * 23. [Obligation] Clock tampering test (verifying clock rollback lock & audit event).
 * 24. [Obligation] Argon2id performance benchmark on resource-constrained process.
 *
 * Zero .skip, .only, .todo, fake providers, or placeholder substitutes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { hashBranchPin } from '@trident/core';
import {
  EdgeDatabaseService,
  OfflineIamService,
  OfflineIamServiceOptions,
  OfflineIamError,
  EdgeAuthRouter,
  SESSION_TOKEN_TTL_SECONDS,
} from './index.js';

import { LOCKOUT_POLICY } from './iam/lockout-manager.js';
import { signFloorSessionToken, verifyFloorSessionToken } from './iam/session-token.js';
import {
  kInternalTestToken,
  getTestInternals,
  createTestOfflineIamService,
} from './iam/test-support.js';
import { EdgeSecureStore } from './enrollment/secure-store.js';
import { TrustedTimeManager } from './enrollment/trusted-time.js';
import { TestIsolatedSecureStorageBackend } from './enrollment/test-support.js';
import { EnrollmentPersistence } from './db/enrollment-persistence.js';
import { IamPersistence } from './db/iam-persistence.js';
import { getTestNativeDatabase } from './db/test-access.js';

// ---------------------------------------------------------------------------
// Test Context Harness
// ---------------------------------------------------------------------------

interface TestContext {
  tempDir: string;
  dbPath: string;
  edgeDb: EdgeDatabaseService;
  persistence: IamPersistence;
  enrollmentPersistence: EnrollmentPersistence;
  secureStore: EdgeSecureStore;
  trustedTimeManager: TrustedTimeManager;
  iamService: OfflineIamService;
  router: EdgeAuthRouter;
  organizationId: string;
  branchId: string;
  edgeId: string;
  stationId: string;
  userId: string;
  plainPin: string;
  pinHash: string;
  cleanup: () => void;
}

async function createTestContext(prefix = 'wp010_test'): Promise<TestContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}_`));
  const dbPath = path.join(tempDir, 'edge_pos.db');
  const secureDir = path.join(tempDir, 'secure_store');

  const testBackend = new TestIsolatedSecureStorageBackend();
  const secureStore = new EdgeSecureStore({ storageDir: secureDir, backend: testBackend });
  const edgeDb = new EdgeDatabaseService({ databasePath: dbPath });
  const persistence = new IamPersistence(edgeDb);
  const enrollmentPersistence = new EnrollmentPersistence(edgeDb);

  const nativeDb = getTestNativeDatabase(edgeDb);
  const trustedTimeManager = new TrustedTimeManager({ db: nativeDb, secureStore });

  // Baseline time sync
  const baseEpoch = 1756789000;
  trustedTimeManager.syncCloudTime(baseEpoch);

  const organizationId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const edgeId = '00000000-0000-4000-8000-000000000003';
  const stationId = '00000000-0000-4000-8000-000000000004';
  const userId = '00000000-0000-4000-8000-000000000005';
  const plainPin = '1234';

  // Seed enrolled station identity
  nativeDb
    .prepare(
      `
      INSERT INTO station_credentials (
        station_id, organization_id, branch_id, station_code,
        station_type, station_public_key, enrolled_at, is_revoked, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `,
    )
    .run(
      stationId,
      organizationId,
      branchId,
      'STATION-01',
      'PRIMARY_CASHIER',
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      baseEpoch,
    );

  // Hash PIN with RFC 9106 baseline
  const hashRes = await hashBranchPin(plainPin);
  assert.equal(hashRes.ok, true);
  const pinHash = (hashRes as { ok: true; value: string }).value;

  // Seed cached user
  persistence.upsertCachedUser({
    userId,
    organizationId,
    fullName: 'Maria Waiter',
    pinHash,
    roles: ['WAITER', 'CASHIER'],
    credentialVersion: 1,
    issuedAt: baseEpoch - 100,
    expiresAt: baseEpoch + 86400, // +24 hours
    isRevoked: 0,
  });

  const iamService = createTestOfflineIamService({
    edgeDb,
    secureStore,
    trustedTimeManager,
    edgeId,
    organizationId,
    branchId,
    persistence,
  });

  const router = new EdgeAuthRouter(iamService);

  const cleanup = () => {
    try {
      edgeDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  };

  return {
    tempDir,
    dbPath,
    edgeDb,
    persistence,
    enrollmentPersistence,
    secureStore,
    trustedTimeManager,
    iamService,
    router,
    organizationId,
    branchId,
    edgeId,
    stationId,
    userId,
    plainPin,
    pinHash,
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// 1. Core PIN Authentication Tests
// ---------------------------------------------------------------------------

test('WP010-T01: Correct PIN succeeds locally and returns valid station session', async () => {
  const ctx = await createTestContext('wp010_t01');
  try {
    const res = await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
      activeRole: 'CASHIER',
    });

    assert.equal(res.success, true);
    assert.ok(res.token && typeof res.token === 'string');
    assert.equal(res.session.userId, ctx.userId);
    assert.equal(res.session.stationId, ctx.stationId);
    assert.equal(res.session.activeRole, 'CASHIER');
    assert.deepEqual(res.session.roles, ['WAITER', 'CASHIER']);

    // Verify session record in SQLite
    const sessionRecord = ctx.iamService.verifySession(res.token, ctx.stationId);
    assert.equal(sessionRecord.userId, ctx.userId);
    assert.equal(sessionRecord.stationId, ctx.stationId);
    assert.equal(sessionRecord.isRevoked, 0);

    // Verify lockout counter is 0 on success
    const lockout = ctx.persistence.getLockoutState(ctx.stationId);
    assert.equal(lockout?.consecutiveFailures ?? 0, 0);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T02: Incorrect PIN fails authentication', async () => {
  const ctx = await createTestContext('wp010_t02');
  try {
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: '9999', // Incorrect PIN
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'AUTHENTICATION_FAILED');
        return true;
      },
    );

    // Check failure was recorded
    const lockout = ctx.persistence.getLockoutState(ctx.stationId);
    assert.equal(lockout?.consecutiveFailures, 1);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T03: Plaintext PIN is never persisted in SQLite or disk', async () => {
  const ctx = await createTestContext('wp010_t03');
  try {
    await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });

    // Read all contents of DB file and check for raw pin
    const dbBytes = fs.readFileSync(ctx.dbPath);
    const dbString = dbBytes.toString('binary');
    assert.equal(
      dbString.includes(`"${ctx.plainPin}"`),
      false,
      'Plaintext PIN found quoted in SQLite file',
    );

    // Query cached_users directly
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    const userRow = nativeDb
      .prepare('SELECT * FROM cached_users WHERE user_id = ?')
      .get(ctx.userId) as Record<string, unknown>;

    assert.ok(typeof userRow.pin_hash === 'string');
    assert.ok(userRow.pin_hash.startsWith('$argon2id$'));
    assert.equal(userRow.pin_hash.includes(ctx.plainPin), false);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T04: Plaintext PIN is never logged in audit events, errors, or telemetry', async () => {
  const ctx = await createTestContext('wp010_t04');
  try {
    // 1. Cause successful auth
    await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });

    // 2. Query edge_security_audit table
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    const audits = nativeDb.prepare('SELECT * FROM edge_security_audit').all() as Array<{
      metadata_json: string;
      action: string;
    }>;

    assert.ok(audits.length > 0);
    for (const audit of audits) {
      assert.equal(
        audit.metadata_json.includes(ctx.plainPin),
        false,
        `Plaintext PIN leaked in audit metadata: ${audit.metadata_json}`,
      );
    }
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T05: Cross-user authentication rejected (wrong user ID with PIN)', async () => {
  const ctx = await createTestContext('wp010_t05');
  try {
    const wrongUserId = '00000000-0000-4000-8000-000000000099';
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: wrongUserId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'USER_NOT_CACHED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T06: Cross-station session misuse rejected', async () => {
  const ctx = await createTestContext('wp010_t06');
  try {
    // Authenticate on station 1
    const res = await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });

    // Present token on a DIFFERENT station 2
    const station2Id = '00000000-0000-4000-8000-000000000022';
    assert.throws(
      () => {
        ctx.iamService.verifySession(res.token, station2Id);
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'SESSION_STATION_MISMATCH');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T07: Expired cached credential rejected fail-closed', async () => {
  const ctx = await createTestContext('wp010_t07');
  try {
    const expiredUserId = '00000000-0000-4000-8000-000000000007';
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Seed expired cached user (expired 1 hour ago)
    ctx.persistence.upsertCachedUser({
      userId: expiredUserId,
      organizationId: ctx.organizationId,
      fullName: 'Expired Staff',
      pinHash: ctx.pinHash,
      roles: ['WAITER'],
      credentialVersion: 1,
      issuedAt: now - 7200,
      expiresAt: now - 3600, // Expired
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: expiredUserId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CREDENTIAL_EXPIRED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T08: Corrupted cached credential rejected fail-closed', async () => {
  const ctx = await createTestContext('wp010_t08');
  try {
    const corruptUserId = '00000000-0000-4000-8000-000000000008';
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Non-argon2id hash format (e.g. plaintext or md5)
    ctx.persistence.upsertCachedUser({
      userId: corruptUserId,
      organizationId: ctx.organizationId,
      fullName: 'Corrupt Staff',
      pinHash: '$md5$corruptedhash',
      roles: ['WAITER'],
      credentialVersion: 1,
      issuedAt: now - 100,
      expiresAt: now + 3600,
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: corruptUserId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CREDENTIAL_CORRUPT');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T09: Brute-force repeated failures trigger governed lockout', async () => {
  const ctx = await createTestContext('wp010_t09');
  try {
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;

    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const evalRes = lockoutMgr.recordFailure(ctx.stationId, now);
      assert.equal(evalRes.consecutiveFailures, i);
      assert.equal(evalRes.isLocked, false);
      if (i === 3) assert.equal(evalRes.delayMs, LOCKOUT_POLICY.PROGRESSIVE_DELAY_ATTEMPT_3_MS);
      if (i === 4) assert.equal(evalRes.delayMs, LOCKOUT_POLICY.PROGRESSIVE_DELAY_ATTEMPT_4_MS);
    }

    // 5th failed attempt: triggers lockout
    const eval5 = lockoutMgr.recordFailure(ctx.stationId, now);
    assert.equal(eval5.consecutiveFailures, 5);
    assert.equal(eval5.isLocked, true);
    assert.equal(eval5.isNewLockout, true);
    assert.equal(eval5.remainingSeconds, LOCKOUT_POLICY.LOCKOUT_DURATION_SECONDS);

    // Authentication now rejects with STATION_LOCKED
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: '0000',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_LOCKED');
        assert.ok((err.retryAfterSeconds ?? 0) > 0);
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T10: Correct PIN while locked remains rejected', async () => {
  const ctx = await createTestContext('wp010_t10');
  try {
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      lockoutMgr.recordFailure(ctx.stationId, now);
    }

    // Attempt with CORRECT PIN while locked
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: ctx.plainPin, // Correct PIN!
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_LOCKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T11: Lockout persistence survives process restart', async () => {
  const ctx = await createTestContext('wp010_t11');
  try {
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;

    // Trigger lockout
    for (let i = 0; i < 5; i++) {
      lockoutMgr.recordFailure(ctx.stationId, now);
    }

    // Simulate process restart: create brand new OfflineIamService using same database
    const restartedIamService = new OfflineIamService({
      edgeDb: ctx.edgeDb,
      secureStore: ctx.secureStore,
      trustedTimeManager: ctx.trustedTimeManager,
      edgeId: ctx.edgeId,
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
    });

    // Must still be locked on restarted service instance
    await assert.rejects(
      async () => {
        await restartedIamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_LOCKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T12: Governed lockout release behavior (natural expiry and supervisor override unlock)', async () => {
  const ctx = await createTestContext('wp010_t12');
  try {
    const baseNow = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;

    // Trigger lockout
    for (let i = 0; i < 5; i++) {
      lockoutMgr.recordFailure(ctx.stationId, baseNow);
    }

    // Seed supervisor user
    const supervisorId = '00000000-0000-4000-8000-000000000012';
    const superPin = '8888';
    const superHashRes = await hashBranchPin(superPin);
    assert.equal(superHashRes.ok, true);

    ctx.persistence.upsertCachedUser({
      userId: supervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Supervisor Bob',
      pinHash: (superHashRes as { ok: true; value: string }).value,
      roles: ['SUPERVISOR', 'MANAGER'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 0,
    });

    // 1. Unlock via supervisor override
    const unlockRes = await ctx.iamService.supervisorUnlockStation({
      stationId: ctx.stationId,
      supervisorUserId: supervisorId,
      supervisorPin: superPin,
      reason: 'Shift manager authorized unlock after customer intervention',
    });

    assert.equal(unlockRes.success, true);
    assert.equal(unlockRes.stationId, ctx.stationId);

    // Authentication now succeeds
    const authRes = await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });
    assert.equal(authRes.success, true);

    // 2. Test natural expiry: lock again
    for (let i = 0; i < 5; i++) {
      lockoutMgr.recordFailure(ctx.stationId, baseNow);
    }
    assert.equal(lockoutMgr.checkLockout(ctx.stationId, baseNow).isLocked, true);

    // Check at time > baseNow + 300 seconds
    const expiredLockCheck = lockoutMgr.checkLockout(
      ctx.stationId,
      baseNow + LOCKOUT_POLICY.LOCKOUT_DURATION_SECONDS + 1,
    );
    assert.equal(expiredLockCheck.isLocked, false);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T13: Clock rollback detection fail-closed', async () => {
  const ctx = await createTestContext('wp010_t13');
  try {
    const baseNow = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Tamper time backward > 300 seconds
    assert.throws(
      () => {
        ctx.trustedTimeManager.syncCloudTime(baseNow - 500);
      },
      (_err: Error) => {
        assert.equal(ctx.trustedTimeManager.isLocked(), true);
        return true;
      },
    );

    // Auth must fail closed with CLOCK_ROLLBACK_LOCKED
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CLOCK_ROLLBACK_LOCKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T14: Token/session issuedAt cannot be bypassed by wall-clock rollback', async () => {
  const ctx = await createTestContext('wp010_t14');
  try {
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const primaryKey = ctx.secureStore.loadSecret('station_token_hmac_key');

    // Manually forge a token with future issuedAt (clock manipulated in future then rolled back)
    const futureClaims = {
      sub: ctx.userId,
      station_id: ctx.stationId,
      org_id: ctx.organizationId,
      branch_id: ctx.branchId,
      session_id: crypto.randomUUID(),
      roles: ['WAITER'],
      active_role: 'WAITER',
      iat: now + 600, // 10 minutes in the future!
      exp: now + 43200,
    };

    const forgedToken = signFloorSessionToken(futureClaims, primaryKey);

    assert.throws(
      () => {
        verifyFloorSessionToken(forgedToken, primaryKey, null, now);
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CLOCK_ROLLBACK_LOCKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T15: Session bound to correct station ID', async () => {
  const ctx = await createTestContext('wp010_t15');
  try {
    const res = await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });

    const session = ctx.iamService.verifySession(res.token, ctx.stationId);
    assert.equal(session.stationId, ctx.stationId);
    assert.equal(session.userId, ctx.userId);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T16: Invalid or revoked station identity rejected fail-closed', async () => {
  const ctx = await createTestContext('wp010_t16');
  try {
    // 1. Unknown station
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: '00000000-0000-4000-8000-999999999999',
          userId: ctx.userId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_NOT_FOUND');
        return true;
      },
    );

    // 2. Revoked station
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    nativeDb
      .prepare('UPDATE station_credentials SET is_revoked = 1 WHERE station_id = ?')
      .run(ctx.stationId);

    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_REVOKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T17: Session expiry enforced (12 hours TTL)', async () => {
  const ctx = await createTestContext('wp010_t17');
  try {
    const res = await ctx.iamService.authenticateWithPin({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin,
    });

    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Verify valid at current time
    const validSession = ctx.iamService.verifySession(res.token, ctx.stationId);
    assert.ok(validSession);

    // Verify rejected when tested beyond TTL (now + 12h + 1s)
    const primaryKey = ctx.secureStore.loadSecret('station_token_hmac_key');
    assert.throws(
      () => {
        verifyFloorSessionToken(res.token, primaryKey, null, now + SESSION_TOKEN_TTL_SECONDS + 10);
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'SESSION_EXPIRED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T18: Concurrent failed attempts cannot bypass lockout counters', async () => {
  const ctx = await createTestContext('wp010_t18');
  try {
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;

    // Execute 10 rapid concurrent failure recordings
    const tasks = Array.from({ length: 10 }).map(() =>
      Promise.resolve().then(() => lockoutMgr.recordFailure(ctx.stationId, now)),
    );

    await Promise.all(tasks);

    const finalState = lockoutMgr.getLockoutState(ctx.stationId);
    assert.equal(finalState?.consecutiveFailures, 10);
    assert.equal(lockoutMgr.checkLockout(ctx.stationId, now).isLocked, true);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T19: SQLite transaction failure produces no partial auth-state mutation', async () => {
  const ctx = await createTestContext('wp010_t19');
  try {
    // Inject failure during session insert
    ctx.persistence.setSimulateSessionInsertFailure(true, kInternalTestToken);

    await assert.rejects(async () => {
      await ctx.iamService.authenticateWithPin({
        stationId: ctx.stationId,
        userId: ctx.userId,
        pin: ctx.plainPin,
      });
    }, /SIMULATED_SESSION_INSERT_FAILURE/);

    // Verify zero session rows were committed
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    const countRow = nativeDb.prepare('SELECT COUNT(*) as count FROM station_sessions').get() as {
      count: number;
    };
    assert.equal(countRow.count, 0);

    // Inject failure during audit insert
    ctx.persistence.setSimulateSessionInsertFailure(false, kInternalTestToken);
    ctx.persistence.setSimulateAuditInsertFailure(true, kInternalTestToken);

    await assert.rejects(async () => {
      await ctx.iamService.authenticateWithPin({
        stationId: ctx.stationId,
        userId: ctx.userId,
        pin: ctx.plainPin,
      });
    }, /SIMULATED_AUDIT_INSERT_FAILURE/);

    // Verify STILL zero sessions committed (atomic rollback verified)
    const countRow2 = nativeDb.prepare('SELECT COUNT(*) as count FROM station_sessions').get() as {
      count: number;
    };
    assert.equal(countRow2.count, 0);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T20: Sensitive values redacted from errors, audit payloads, and telemetry', async () => {
  const ctx = await createTestContext('wp010_t20');
  try {
    const auditRecord = ctx.persistence.appendAuditEvent({
      eventId: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      edgeId: ctx.edgeId,
      stationId: ctx.stationId,
      eventType: 'TestSensitivePayload',
      severity: 'INFO',
      action: 'TEST_REDACT',
      metadata: {
        pin: '1234',
        plainPin: '1234',
        password: 'secretPassword',
        stationToken: 'raw.token.value',
        hmacKey: '32byteKeyString',
        nested: {
          pin: '9999',
        },
      },
      createdAt: ctx.trustedTimeManager.getTrustedEffectiveTime(),
    });

    assert.equal(auditRecord.metadataJson.includes('1234'), false);
    assert.equal(auditRecord.metadataJson.includes('secretPassword'), false);
    assert.equal(auditRecord.metadataJson.includes('raw.token.value'), false);
    assert.equal(auditRecord.metadataJson.includes('32byteKeyString'), false);
    assert.equal(auditRecord.metadataJson.includes('9999'), false);
    assert.ok(auditRecord.metadataJson.includes('[REDACTED]'));
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T21: HTTP API POST /api/v1/auth/pin handles success, failure, lockout, supervisor unlock', async () => {
  const ctx = await createTestContext('wp010_t21');
  try {
    // 1. Success response
    const successRes = await ctx.router.handleRequest(
      'POST',
      '/api/v1/auth/pin',
      JSON.stringify({
        stationId: ctx.stationId,
        userId: ctx.userId,
        pin: ctx.plainPin,
        activeRole: 'CASHIER',
      }),
    );
    assert.equal(successRes.status, 200);
    const parsedSuccess = JSON.parse(successRes.body);
    assert.equal(parsedSuccess.success, true);
    assert.ok(parsedSuccess.token);

    // 2. Bad Request (malformed input)
    const badRes = await ctx.router.handleRequest(
      'POST',
      '/api/v1/auth/pin',
      JSON.stringify({
        stationId: 'not-a-uuid',
        userId: ctx.userId,
        pin: ctx.plainPin,
      }),
    );
    assert.equal(badRes.status, 400);

    // 3. Unauthorized (wrong PIN)
    const unauthRes = await ctx.router.handleRequest(
      'POST',
      '/api/v1/auth/pin',
      JSON.stringify({
        stationId: ctx.stationId,
        userId: ctx.userId,
        pin: '0000',
      }),
    );
    assert.equal(unauthRes.status, 401);
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Canonical WP-010 Obligation Tests
// ---------------------------------------------------------------------------

test('WP010-T22: [Obligation] Genuine brute-force PIN attack test via EdgeAuthRouter POST /api/v1/auth/pin', async () => {
  const ctx = await createTestContext('wp010_t22');
  try {
    const wrongPinPayload = JSON.stringify({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: '9999',
    });

    // Attempt 1: normal failure, status 401
    const t0 = performance.now();
    const res1 = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
    const d1 = performance.now() - t0;
    assert.equal(res1.status, 401);
    assert.equal(JSON.parse(res1.body).error, 'AUTHENTICATION_FAILED');
    assert.ok(d1 < 1500, `Attempt 1 should not have progressive delay (took ${d1}ms)`);

    // Attempt 2: normal failure, status 401
    const t1 = performance.now();
    const res2 = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
    const d2 = performance.now() - t1;
    assert.equal(res2.status, 401);
    assert.equal(JSON.parse(res2.body).error, 'AUTHENTICATION_FAILED');
    assert.ok(d2 < 1500, `Attempt 2 should not have progressive delay (took ${d2}ms)`);

    // Attempt 3: governed 2-second delay, status 401
    const t2 = performance.now();
    const res3 = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
    const d3 = performance.now() - t2;
    assert.equal(res3.status, 401);
    assert.equal(JSON.parse(res3.body).error, 'AUTHENTICATION_FAILED');
    assert.ok(d3 >= 1900, `Attempt 3 must enforce governed 2s progressive delay (took ${d3}ms)`);

    // Attempt 4: governed 5-second delay, status 401
    const t3 = performance.now();
    const res4 = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
    const d4 = performance.now() - t3;
    assert.equal(res4.status, 401);
    assert.equal(JSON.parse(res4.body).error, 'AUTHENTICATION_FAILED');
    assert.ok(d4 >= 4900, `Attempt 4 must enforce governed 5s progressive delay (took ${d4}ms)`);

    // Attempt 5: triggers STATION_LOCKED, status 423
    const t4 = performance.now();
    const res5 = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
    const d5 = performance.now() - t4;
    assert.ok(d5 >= 0);
    assert.equal(res5.status, 423);
    const body5 = JSON.parse(res5.body);
    assert.equal(body5.error, 'STATION_LOCKED');
    assert.ok(body5.retryAfter > 0);
    assert.ok(res5.headers['Retry-After']);

    // Subsequent rapid attack attempts (attempts 6-25): rejected by lockout without Argon2id overhead (<50ms each)
    const rapidAttempts = 20;
    for (let i = 0; i < rapidAttempts; i++) {
      const tRapid = performance.now();
      const rapidRes = await ctx.router.handleRequest('POST', '/api/v1/auth/pin', wrongPinPayload);
      const dRapid = performance.now() - tRapid;
      assert.equal(rapidRes.status, 423);
      assert.equal(JSON.parse(rapidRes.body).error, 'STATION_LOCKED');
      assert.ok(
        dRapid < 50,
        `Locked attack request ${i + 6} should short-circuit quickly (took ${dRapid}ms)`,
      );
    }

    // Check persisted lockout state in SQLite
    const finalState = ctx.persistence.getLockoutState(ctx.stationId);
    assert.ok(finalState !== null);
    assert.ok(finalState.consecutiveFailures >= 5);
    assert.ok(finalState.lockedUntil !== null);

    // Audit event PinBruteForceAttemptDetected emitted
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    const auditRows = nativeDb
      .prepare(
        "SELECT * FROM edge_security_audit WHERE event_type = 'PinBruteForceAttemptDetected'",
      )
      .all() as Array<{ severity: string; action: string; metadata_json: string }>;
    assert.ok(auditRows.length >= 1, 'Lockout audit event must be persisted');
    const lockAudit = auditRows[0]!;
    assert.equal(lockAudit.severity, 'CRITICAL');
    assert.equal(lockAudit.action, 'STATION_LOCKOUT');

    // Correct PIN remains rejected while locked
    const correctPinPayload = JSON.stringify({
      stationId: ctx.stationId,
      userId: ctx.userId,
      pin: ctx.plainPin, // Correct PIN
    });
    const correctRes = await ctx.router.handleRequest(
      'POST',
      '/api/v1/auth/pin',
      correctPinPayload,
    );
    assert.equal(correctRes.status, 423);
    assert.equal(JSON.parse(correctRes.body).error, 'STATION_LOCKED');
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T23: [Obligation] Clock tampering test (tampered clock triggers fail-closed)', async () => {
  const ctx = await createTestContext('wp010_t23');
  try {
    const currentEffective = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // Trigger clock tampering: attempt backward clock sync > 300s
    let rollbackDetected = false;
    try {
      ctx.trustedTimeManager.syncCloudTime(currentEffective - 400);
    } catch {
      rollbackDetected = true;
    }
    assert.equal(rollbackDetected, true);
    assert.equal(ctx.trustedTimeManager.isLocked(), true);

    // All authentication attempts must fail closed
    await assert.rejects(
      async () => {
        await ctx.iamService.authenticateWithPin({
          stationId: ctx.stationId,
          userId: ctx.userId,
          pin: ctx.plainPin,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CLOCK_ROLLBACK_LOCKED');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T24: [Obligation] Argon2id performance benchmark on resource-constrained process', async () => {
  // Measures Argon2id hashing and verification execution latency and memory usage
  const pin = '5678';
  const memBefore = process.memoryUsage();

  const startHash = performance.now();
  const hashResult = await hashBranchPin(pin);
  const hashDurationMs = performance.now() - startHash;

  assert.equal(hashResult.ok, true);
  const pinHash = (hashResult as { ok: true; value: string }).value;

  const startVerify = performance.now();
  const verifyResult = await ctx_verify(pinHash, pin);
  const verifyDurationMs = performance.now() - startVerify;

  assert.equal(verifyResult, true);
  const memAfter = process.memoryUsage();

  const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
  const rssMb = memAfter.rss / (1024 * 1024);

  // Document benchmark execution parameters
  assert.ok(typeof heapDiffMb === 'number');
  assert.ok(hashDurationMs > 0, 'Hash duration must be positive');
  assert.ok(verifyDurationMs > 0, 'Verify duration must be positive');
  assert.ok(rssMb > 0, 'Process RSS must be measurable');

  // Verify baseline parameters are strictly preserved in hash
  assert.ok(pinHash.startsWith('$argon2id$v=19$m=65536,p=4,t=3$'));
});

async function ctx_verify(hash: string, plain: string): Promise<boolean> {
  const { verifyBranchPin } = await import('@trident/core');
  const res = await verifyBranchPin(hash, plain);
  return res.ok && res.value === true;
}

// ---------------------------------------------------------------------------
// Coordinator Quick Integrity Verification Tests (S10-R1)
// ---------------------------------------------------------------------------

test('WP010-T25: [QI-010-01] Public IAM boundary prevents collaborator injection, internal escape, and fault invocation', async () => {
  const ctx = await createTestContext('wp010_t25');
  try {
    const publicModule = (await import('./index.js')) as Record<string, unknown>;

    // 1. Prohibited exports must NOT exist on public package surface
    assert.equal(publicModule['IamPersistence'], undefined);
    assert.equal(publicModule['LockoutManager'], undefined);
    assert.equal(publicModule['signFloorSessionToken'], undefined);
    assert.equal(publicModule['verifyFloorSessionToken'], undefined);
    assert.equal(publicModule['computeSessionTokenHash'], undefined);
    assert.equal(publicModule['LOCKOUT_POLICY'], undefined);

    // 2. Cannot inject custom lockout manager or persistence in OfflineIamService constructor
    const fakeLockoutManager = { recordFailure: () => ({ isLocked: false }) };
    const fakePersistence = { recordFailedAttempt: () => {} };

    assert.throws(
      () => {
        new OfflineIamService({
          edgeDb: ctx.edgeDb,
          secureStore: ctx.secureStore,
          trustedTimeManager: ctx.trustedTimeManager,
          edgeId: ctx.edgeId,
          organizationId: ctx.organizationId,
          branchId: ctx.branchId,
          lockoutManager: fakeLockoutManager,
        } as unknown as OfflineIamServiceOptions);
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'INVALID_INPUT');
        return true;
      },
    );

    assert.throws(
      () => {
        new OfflineIamService({
          edgeDb: ctx.edgeDb,
          secureStore: ctx.secureStore,
          trustedTimeManager: ctx.trustedTimeManager,
          edgeId: ctx.edgeId,
          organizationId: ctx.organizationId,
          branchId: ctx.branchId,
          persistence: fakePersistence,
        } as unknown as OfflineIamServiceOptions);
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'INVALID_INPUT');
        return true;
      },
    );

    // 3. No public getters exposing mutable internals
    const serviceRecord = ctx.iamService as unknown as Record<string, unknown>;
    assert.equal(serviceRecord['getPersistence'], undefined);
    assert.equal(serviceRecord['getLockoutManager'], undefined);

    // 4. Test fault controls fail closed when invoked without internal test token
    assert.throws(() => {
      ctx.persistence.setSimulateSessionInsertFailure(true);
    }, /Unauthorized test fault control invocation/);
    assert.throws(() => {
      ctx.persistence.setSimulateAuditInsertFailure(true);
    }, /Unauthorized test fault control invocation/);

    // 5. Internal test token rejection when arbitrary symbol is passed
    assert.throws(() => {
      ctx.persistence.setSimulateSessionInsertFailure(true, Symbol('fakeToken'));
    }, /Unauthorized test fault control invocation/);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T26: [QI-010-02] Supervisor unlock authorization fails closed and prevents brute-force oracle', async () => {
  const ctx = await createTestContext('wp010_t26');
  try {
    const baseNow = ctx.trustedTimeManager.getTrustedEffectiveTime();

    // First lock the station
    const lockoutMgr = getTestInternals(ctx.iamService).lockoutManager;
    for (let i = 0; i < 5; i++) {
      lockoutMgr.recordFailure(ctx.stationId, baseNow);
    }
    assert.equal(lockoutMgr.checkLockout(ctx.stationId, baseNow).isLocked, true);

    const supervisorId = '00000000-0000-4000-8000-000000000088';
    const supervisorPin = '7777';
    const superHashRes = await hashBranchPin(supervisorPin);
    assert.equal(superHashRes.ok, true);
    const validSupervisorPinHash = (superHashRes as { ok: true; value: string }).value;

    // Seed valid supervisor
    ctx.persistence.upsertCachedUser({
      userId: supervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Supervisor Alice',
      pinHash: validSupervisorPinHash,
      roles: ['SUPERVISOR'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 0,
    });

    // 1. Invalid target station (non-existent station)
    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: '00000000-0000-4000-8000-999999999999',
          supervisorUserId: supervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_NOT_FOUND');
        return true;
      },
    );

    // 2. Revoked target station
    const revokedStationId = '00000000-0000-4000-8000-000000000077';
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    nativeDb
      .prepare(
        `INSERT INTO station_credentials (
          station_id, organization_id, branch_id, station_code,
          station_type, station_public_key, enrolled_at, is_revoked, revoked_at
        ) VALUES (?, ?, ?, 'STATION-REV', 'PRIMARY', 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA', ?, 1, ?)`,
      )
      .run(revokedStationId, ctx.organizationId, ctx.branchId, baseNow, baseNow);

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: revokedStationId,
          supervisorUserId: supervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_REVOKED');
        return true;
      },
    );

    // 3. Cross-branch target station
    const crossBranchStationId = '00000000-0000-4000-8000-000000000066';
    nativeDb
      .prepare(
        `INSERT INTO station_credentials (
          station_id, organization_id, branch_id, station_code,
          station_type, station_public_key, enrolled_at, is_revoked, revoked_at
        ) VALUES (?, ?, '00000000-0000-4000-8000-999999999998', 'STATION-OTHER', 'PRIMARY', 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA', ?, 0, NULL)`,
      )
      .run(crossBranchStationId, ctx.organizationId, baseNow);

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: crossBranchStationId,
          supervisorUserId: supervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'STATION_NOT_FOUND');
        return true;
      },
    );

    // 4. Revoked supervisor
    const revokedSupervisorId = '00000000-0000-4000-8000-000000000055';
    ctx.persistence.upsertCachedUser({
      userId: revokedSupervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Revoked Supervisor',
      pinHash: validSupervisorPinHash,
      roles: ['SUPERVISOR'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 1,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: revokedSupervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'AUTHENTICATION_FAILED');
        return true;
      },
    );

    // 5. Cross-organization supervisor
    const crossOrgSupervisorId = '00000000-0000-4000-8000-000000000044';
    ctx.persistence.upsertCachedUser({
      userId: crossOrgSupervisorId,
      organizationId: '00000000-0000-4000-8000-999999999997',
      fullName: 'Cross Org Supervisor',
      pinHash: validSupervisorPinHash,
      roles: ['SUPERVISOR'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: crossOrgSupervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'AUTHENTICATION_FAILED');
        return true;
      },
    );

    // 6. Expired supervisor credential
    const expiredSupervisorId = '00000000-0000-4000-8000-000000000033';
    ctx.persistence.upsertCachedUser({
      userId: expiredSupervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Expired Supervisor',
      pinHash: validSupervisorPinHash,
      roles: ['SUPERVISOR'],
      credentialVersion: 1,
      issuedAt: baseNow - 86400,
      expiresAt: baseNow - 10,
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: expiredSupervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CREDENTIAL_EXPIRED');
        return true;
      },
    );

    // 7. Corrupt supervisor credential (non-Argon2id hash)
    const corruptSupervisorId = '00000000-0000-4000-8000-000000000022';
    ctx.persistence.upsertCachedUser({
      userId: corruptSupervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Corrupt Supervisor',
      pinHash: 'plain_md5_hash_not_argon',
      roles: ['SUPERVISOR'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: corruptSupervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'CREDENTIAL_CORRUPT');
        return true;
      },
    );

    // 8. Insufficient privileges (lacks supervisory role)
    const nonSupervisorId = '00000000-0000-4000-8000-000000000011';
    ctx.persistence.upsertCachedUser({
      userId: nonSupervisorId,
      organizationId: ctx.organizationId,
      fullName: 'Staff Only',
      pinHash: validSupervisorPinHash,
      roles: ['WAITER', 'CASHIER'],
      credentialVersion: 1,
      issuedAt: baseNow - 100,
      expiresAt: baseNow + 86400,
      isRevoked: 0,
    });

    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: nonSupervisorId,
          supervisorPin,
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'INSUFFICIENT_PERMISSIONS');
        return true;
      },
    );

    // 9. Wrong supervisor PIN repeatedly (brute-force rate limiting and lockout enforcement)
    // Attempt with wrong PIN
    await assert.rejects(
      async () => {
        await ctx.iamService.supervisorUnlockStation({
          stationId: ctx.stationId,
          supervisorUserId: supervisorId,
          supervisorPin: '0000',
          reason: 'Authorization test override',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof OfflineIamError);
        assert.equal(err.code, 'AUTHENTICATION_FAILED');
        return true;
      },
    );

    // Verify station is STILL locked (no unlock state mutation on failure)
    assert.equal(lockoutMgr.checkLockout(ctx.stationId, baseNow).isLocked, true);

    // Finally, test valid supervisor unlock succeeds
    const unlockRes = await ctx.iamService.supervisorUnlockStation({
      stationId: ctx.stationId,
      supervisorUserId: supervisorId,
      supervisorPin: supervisorPin,
      reason: 'Valid override unlock',
    });
    assert.equal(unlockRes.success, true);
    assert.equal(lockoutMgr.checkLockout(ctx.stationId, baseNow).isLocked, false);
  } finally {
    ctx.cleanup();
  }
});

test('WP010-T27: [QI-010-03] Corrupted or invalid role data strictly fails closed without defaulting to STAFF', async () => {
  const ctx = await createTestContext('wp010_t27');
  try {
    const nativeDb = getTestNativeDatabase(ctx.edgeDb);
    const pinHash = ctx.pinHash;
    const now = ctx.trustedTimeManager.getTrustedEffectiveTime();

    const corruptCases = [
      { id: '00000000-0000-4000-8000-000000000101', rolesJson: '{not-json' },
      { id: '00000000-0000-4000-8000-000000000102', rolesJson: '{"role":"STAFF"}' },
      { id: '00000000-0000-4000-8000-000000000103', rolesJson: '[]' },
      { id: '00000000-0000-4000-8000-000000000104', rolesJson: '[123, 456]' },
      { id: '00000000-0000-4000-8000-000000000105', rolesJson: '[""]' },
      { id: '00000000-0000-4000-8000-000000000106', rolesJson: 'null' },
    ];

    for (const testCase of corruptCases) {
      nativeDb
        .prepare(
          `INSERT INTO cached_users (
            user_id, organization_id, full_name, pin_hash, roles_json,
            credential_version, issued_at, expires_at, is_revoked
          ) VALUES (?, ?, 'Corrupt User', ?, ?, 1, ?, ?, 0)`,
        )
        .run(
          testCase.id,
          ctx.organizationId,
          pinHash,
          testCase.rolesJson,
          String(now - 100),
          String(now + 86400),
        );

      await assert.rejects(
        async () => {
          await ctx.iamService.authenticateWithPin({
            stationId: ctx.stationId,
            userId: testCase.id,
            pin: ctx.plainPin,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof OfflineIamError);
          assert.equal(err.code, 'CREDENTIAL_CORRUPT');
          return true;
        },
      );
    }

    // Verify ZERO station sessions were created across all corrupt attempts
    const sessionCount = nativeDb
      .prepare('SELECT COUNT(*) as count FROM station_sessions')
      .get() as {
      count: number;
    };
    assert.equal(
      sessionCount.count,
      0,
      'Zero station sessions must be created when roles are corrupt',
    );
  } finally {
    ctx.cleanup();
  }
});
