/**
 * TRIDENTPOS WP-008: Edge Local Database (SQLite WAL) & Durability Manager Test Suite
 * Validates SQLite WAL activation, dual durability modes (NORMAL/FULL), transaction boundaries,
 * concurrent reads, write serialization, WAL checkpoints, integrity checks, crash recovery,
 * and fail-closed durability restoration / rollback / controlled test boundaries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  EdgeDatabaseService,
  EdgeDatabaseError,
  EdgeDurabilityError,
  EdgeIntegrityViolationError,
  EdgeTransactionRollbackError,
  DurabilityMode,
  DEFAULT_WAL_ALERT_THRESHOLD_BYTES,
} from './index.js';
import { getTestNativeDatabase } from './db/test-access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const crashWorkerHelperPath = path.resolve(__dirname, '../scripts/crash-worker-helper.cjs');

function getTempDbPath(prefix = 'trident_edge_test'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}_`));
  return path.join(dir, 'edge_pos.db');
}

function cleanupTempDb(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
    if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in test teardown
  }
}

// ----------------------------------------------------------------------------
// WP008-T01: WAL activation
// ----------------------------------------------------------------------------
test('WP008-T01: WAL activation — verifies PRAGMA journal_mode returns wal', () => {
  const dbPath = getTempDbPath('t01');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const journalMode = service.getJournalMode();

    assert.equal(journalMode, 'wal', 'Effective journal_mode must be wal');

    // Query native connection directly to confirm via test harness
    const native = getTestNativeDatabase(service);
    const rawMode = native.pragma('journal_mode', { simple: true });
    assert.equal(String(rawMode).toLowerCase(), 'wal', 'Native pragma must return wal');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T02: Default operational synchronous mode
// ----------------------------------------------------------------------------
test('WP008-T02: Default operational synchronous mode — verifies PRAGMA synchronous = NORMAL', () => {
  const dbPath = getTempDbPath('t02');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const syncMode = service.getSynchronousMode();

    assert.equal(syncMode, 'NORMAL', 'Default operational durability mode must be NORMAL');

    // Native pragma verification: in SQLite NORMAL is integer 1
    const native = getTestNativeDatabase(service);
    const rawSync = native.pragma('synchronous', { simple: true });
    assert.equal(rawSync, 1, 'SQLite native synchronous value for NORMAL must be 1');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T03: Critical FULL durability mode
// ----------------------------------------------------------------------------
test('WP008-T03: Critical FULL durability mode — verifies controlled switch to FULL', () => {
  const dbPath = getTempDbPath('t03');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });

    service.setSyncPragma('FULL');
    assert.equal(service.getSynchronousMode(), 'FULL', 'Synchronous mode must be FULL');

    const native = getTestNativeDatabase(service);
    const rawSync = native.pragma('synchronous', { simple: true });
    assert.equal(rawSync, 2, 'SQLite native synchronous value for FULL must be 2');

    // Verify rejection of unauthorized durability mode
    assert.throws(
      () => service.setSyncPragma('OFF' as DurabilityMode),
      (err: Error) => err instanceof EdgeDurabilityError,
      'Must reject non-approved durability mode',
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T04: Durability mode restoration
// ----------------------------------------------------------------------------
test('WP008-T04: Durability mode restoration — restores NORMAL after critical transaction', () => {
  const dbPath = getTempDbPath('t04');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE financial_log (id INTEGER PRIMARY KEY, note TEXT);');

    assert.equal(service.getSynchronousMode(), 'NORMAL', 'Initial mode must be NORMAL');

    // Execute critical transaction under FULL mode
    const result = service.runInDurabilityMode('FULL', () => {
      assert.equal(service.getSynchronousMode(), 'FULL', 'Mode inside block must be FULL');
      native.exec("INSERT INTO financial_log (note) VALUES ('corte_z_simulated');");
      return 'corte_z_completed';
    });

    assert.equal(result, 'corte_z_completed');
    assert.equal(
      service.getSynchronousMode(),
      'NORMAL',
      'Mode must be restored to NORMAL after execution',
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T05: Durability restoration after exception
// ----------------------------------------------------------------------------
test('WP008-T05: Durability restoration after exception — restores NORMAL on failure and rolls back', () => {
  const dbPath = getTempDbPath('t05');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE financial_log (id INTEGER PRIMARY KEY, note TEXT);');

    assert.throws(
      () =>
        service.runCriticalTransaction(() => {
          assert.equal(
            service.getSynchronousMode(),
            'FULL',
            'Mode during critical tx must be FULL',
          );
          native.exec("INSERT INTO financial_log (note) VALUES ('uncommitted_entry');");
          throw new Error('Simulated fiscal device hardware fault');
        }),
      /Simulated fiscal device hardware fault/,
    );

    // Durability must have restored to NORMAL
    assert.equal(
      service.getSynchronousMode(),
      'NORMAL',
      'Durability mode must restore to NORMAL even after failure',
    );

    // Uncommitted transaction must be rolled back
    const count = native.prepare('SELECT COUNT(*) as c FROM financial_log;').get() as {
      c: number;
    };
    assert.equal(count.c, 0, 'Uncommitted financial entry must be rolled back');

    // Database must remain healthy and usable
    assert.doesNotThrow(() => {
      service.runInTransaction(() => {
        native.exec("INSERT INTO financial_log (note) VALUES ('subsequent_operational_entry');");
      });
    });

    const subsequentCount = native.prepare('SELECT COUNT(*) as c FROM financial_log;').get() as {
      c: number;
    };
    assert.equal(subsequentCount.c, 1, 'Database must remain usable after rollback');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T06: Transaction commit
// ----------------------------------------------------------------------------
test('WP008-T06: Transaction commit — runInTransaction commits changes atomically', () => {
  const dbPath = getTempDbPath('t06');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE floor_orders (id INTEGER PRIMARY KEY, table_no TEXT, total REAL);');

    service.runInTransaction(() => {
      native.exec("INSERT INTO floor_orders (table_no, total) VALUES ('M1', 150.50);");
      native.exec("INSERT INTO floor_orders (table_no, total) VALUES ('M2', 320.00);");
    });

    const rows = native.prepare('SELECT * FROM floor_orders ORDER BY id ASC;').all() as Array<{
      table_no: string;
      total: number;
    }>;

    assert.equal(rows.length, 2, 'Both rows must be committed');
    assert.equal(rows[0]?.table_no, 'M1');
    assert.equal(rows[1]?.table_no, 'M2');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T07: Transaction rollback
// ----------------------------------------------------------------------------
test('WP008-T07: Transaction rollback — failure causes zero partial transaction persistence', () => {
  const dbPath = getTempDbPath('t07');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE floor_orders (id INTEGER PRIMARY KEY, table_no TEXT, total REAL);');
    native.exec("INSERT INTO floor_orders (table_no, total) VALUES ('PRE_EXISTING', 10.00);");

    assert.throws(() => {
      service.runInTransaction(() => {
        native.exec("INSERT INTO floor_orders (table_no, total) VALUES ('M3', 50.00);");
        native.exec("INSERT INTO floor_orders (table_no, total) VALUES ('M4', 75.00);");
        throw new Error('Simulated order validation rejection');
      });
    }, /Simulated order validation rejection/);

    const rows = native.prepare('SELECT * FROM floor_orders;').all() as Array<{
      table_no: string;
    }>;
    assert.equal(rows.length, 1, 'Only pre-existing row must remain');
    assert.equal(rows[0]?.table_no, 'PRE_EXISTING');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T08: Concurrent reader during writer
// ----------------------------------------------------------------------------
test('WP008-T08: Concurrent reader during writer — reader reads committed snapshot without SQLITE_BUSY', () => {
  const dbPath = getTempDbPath('t08');
  try {
    const writerService = new EdgeDatabaseService({ databasePath: dbPath });
    const writerNative = getTestNativeDatabase(writerService);

    writerNative.exec('CREATE TABLE menu_items (id INTEGER PRIMARY KEY, name TEXT, price REAL);');
    writerNative.exec("INSERT INTO menu_items (name, price) VALUES ('Tacos al Pastor', 85.00);");

    // Open a second, independent connection as a concurrent reader
    const readerService = new EdgeDatabaseService({ databasePath: dbPath, readOnly: true });
    const readerNative = getTestNativeDatabase(readerService);

    // 1. Writer begins an explicit immediate write transaction
    writerNative.exec('BEGIN IMMEDIATE;');
    writerNative.exec("INSERT INTO menu_items (name, price) VALUES ('Gringas', 95.00);");

    // 2. While writer is still in transaction, concurrent reader queries
    // In WAL mode, reader must read the previous committed snapshot without SQLITE_BUSY
    let readerRows: Array<{ name: string }> = [];
    assert.doesNotThrow(() => {
      readerRows = readerNative.prepare('SELECT name FROM menu_items;').all() as Array<{
        name: string;
      }>;
    }, 'Reader must not be blocked by uncommitted writer in WAL mode');

    assert.equal(readerRows.length, 1, 'Reader must see committed snapshot only');
    assert.equal(readerRows[0]?.name, 'Tacos al Pastor');

    // 3. Writer commits
    writerNative.exec('COMMIT;');

    // 4. Reader now sees updated snapshot
    const updatedReaderRows = readerNative.prepare('SELECT name FROM menu_items;').all() as Array<{
      name: string;
    }>;
    assert.equal(updatedReaderRows.length, 2, 'Reader must see 2 rows after writer commits');

    readerService.close();
    writerService.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T09: Competing writes
// ----------------------------------------------------------------------------
test('WP008-T09: Competing writes — write serializer maintains integrity and sequential order', async () => {
  const dbPath = getTempDbPath('t09');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE seq_log (id INTEGER PRIMARY KEY, step INTEGER, tag TEXT);');

    // Launch 10 concurrent async write tasks through runSerializedWrite
    const taskCount = 10;
    const promises: Array<Promise<number>> = [];

    for (let i = 1; i <= taskCount; i++) {
      const step = i;
      promises.push(
        service.runSerializedWrite(async () => {
          // Add micro-delay to simulate async I/O
          await new Promise((resolve) => setTimeout(resolve, 5));
          service.runInTransaction(() => {
            native
              .prepare('INSERT INTO seq_log (step, tag) VALUES (?, ?);')
              .run(step, `task_${step}`);
          });
          return step;
        }),
      );
    }

    const results = await Promise.all(promises);
    assert.equal(results.length, taskCount);

    const rows = native.prepare('SELECT step, tag FROM seq_log ORDER BY id ASC;').all() as Array<{
      step: number;
      tag: string;
    }>;

    assert.equal(rows.length, taskCount, 'All 10 serialized writes must be committed');
    for (let i = 0; i < taskCount; i++) {
      assert.equal(rows[i]?.step, i + 1, `Write sequence at index ${i} must preserve FIFO order`);
    }

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T10: WAL checkpoint
// ----------------------------------------------------------------------------
test('WP008-T10: WAL checkpoint — executes WAL checkpoint successfully', () => {
  const dbPath = getTempDbPath('t10');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, content TEXT);');

    // Generate WAL frames
    service.runInTransaction(() => {
      const stmt = native.prepare('INSERT INTO test_data (content) VALUES (?);');
      for (let i = 0; i < 100; i++) {
        stmt.run(`sample_payload_${i}_${'x'.repeat(256)}`);
      }
    });

    // Execute PASSIVE checkpoint
    const passiveResult = service.checkpoint('PASSIVE');
    assert.equal(passiveResult.mode, 'PASSIVE');
    assert.equal(passiveResult.busy, 0, 'Checkpoint must not be busy');

    // Execute TRUNCATE checkpoint
    const truncateResult = service.checkpoint('TRUNCATE');
    assert.equal(truncateResult.mode, 'TRUNCATE');
    assert.equal(truncateResult.busy, 0, 'Truncate checkpoint must not be busy');

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T11: WAL observability
// ----------------------------------------------------------------------------
test('WP008-T11: WAL observability — observes WAL size and evaluates 50 MB alert threshold', () => {
  const dbPath = getTempDbPath('t11');
  try {
    // Test with low threshold to verify alert logic
    const service = new EdgeDatabaseService({
      databasePath: dbPath,
      walAlertThresholdBytes: 1024, // 1 KB for test observability
    });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE test_wal (id INTEGER PRIMARY KEY, val TEXT);');

    // Insert enough data to exceed 1 KB WAL size
    service.runInTransaction(() => {
      const stmt = native.prepare('INSERT INTO test_wal (val) VALUES (?);');
      for (let i = 0; i < 50; i++) {
        stmt.run('data_payload_'.repeat(20));
      }
    });

    const stats = service.getWalStats();
    assert.ok(stats.walSizeBytes > 0, 'WAL size must be > 0 bytes');
    assert.equal(stats.alertThresholdBytes, 1024);
    assert.equal(
      stats.isAboveAlertThreshold,
      stats.walSizeBytes >= 1024,
      'isAboveAlertThreshold must reflect threshold condition',
    );

    // Verify default threshold constant is 50 MB per ADR-004 Sec. 10
    assert.equal(
      DEFAULT_WAL_ALERT_THRESHOLD_BYTES,
      50 * 1024 * 1024,
      'Default WAL alert threshold must be exactly 50 MB',
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T12: Integrity check
// ----------------------------------------------------------------------------
test('WP008-T12: Integrity check — verifies PRAGMA integrity_check returns ok and detects corruption', () => {
  const dbPath = getTempDbPath('t12');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    native.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance REAL);');
    native.exec('INSERT INTO accounts (balance) VALUES (1000.0), (2500.5);');

    const result = service.verifyIntegrity();
    assert.equal(result.healthy, true, 'Integrity check must return healthy on valid database');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.details, ['ok']);

    assert.doesNotThrow(() => {
      service.assertIntegrity();
    }, 'assertIntegrity must not throw on valid database');

    service.close();

    // Corrupt the database file intentionally to verify fail-closed behavior
    const dbBuffer = fs.readFileSync(dbPath);
    // Overwrite database header pages with garbage
    dbBuffer.fill(0xff, 100, 300);
    fs.writeFileSync(dbPath, dbBuffer);

    // Opening corrupted database must fail integrity check
    assert.throws(
      () => {
        const corruptedService = new EdgeDatabaseService({ databasePath: dbPath });
        try {
          corruptedService.assertIntegrity();
        } finally {
          corruptedService.close();
        }
      },
      (err: Error) =>
        err instanceof EdgeIntegrityViolationError || err instanceof EdgeDatabaseError,
      'assertIntegrity must fail closed on corrupted database file',
    );
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T13: Abrupt process termination recovery
// ----------------------------------------------------------------------------
test('WP008-T13: Abrupt process termination recovery — recovers cleanly after child process SIGKILL', async () => {
  const dbPath = getTempDbPath('t13');
  try {
    // 1. Parent pre-seeds database with committed transactions
    const preService = new EdgeDatabaseService({ databasePath: dbPath });
    const preNative = getTestNativeDatabase(preService);
    preNative.exec(
      'CREATE TABLE crash_test (id INTEGER PRIMARY KEY, marker TEXT, committed INTEGER);',
    );
    preService.runInTransaction(() => {
      preNative.exec(
        "INSERT INTO crash_test (marker, committed) VALUES ('committed_initial_1', 1);",
      );
      preNative.exec(
        "INSERT INTO crash_test (marker, committed) VALUES ('committed_initial_2', 1);",
      );
    });
    preService.close();

    // 2. Spawn child process that opens the database, starts uncommitted transaction, and waits
    const child = spawn('node', [crashWorkerHelperPath, dbPath], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    await new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', (d: Buffer) => {
        if (d.toString().includes('READY')) {
          resolve();
        }
      });
      child.on('error', reject);
    });

    // 3. Abruptly kill the child process with SIGKILL (simulating ungraceful power cut / kill -9)
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('close', resolve));

    // 4. Reopen the database from parent process
    const recoveryService = new EdgeDatabaseService({ databasePath: dbPath });
    const recoveryNative = getTestNativeDatabase(recoveryService);

    // Verify integrity is intact
    const integrity = recoveryService.verifyIntegrity();
    assert.equal(integrity.healthy, true, 'Database must be healthy after abrupt process SIGKILL');
    assert.equal(integrity.status, 'ok');

    // Verify committed data is intact
    const rows = recoveryNative
      .prepare('SELECT marker, committed FROM crash_test ORDER BY id ASC;')
      .all() as Array<{ marker: string; committed: number }>;

    assert.equal(rows.length, 2, 'Only the 2 committed transactions must exist');
    assert.equal(rows[0]?.marker, 'committed_initial_1');
    assert.equal(rows[1]?.marker, 'committed_initial_2');

    // Incomplete uncommitted entry from killed child must be absent
    const uncommittedRows = recoveryNative
      .prepare("SELECT * FROM crash_test WHERE marker = 'uncommitted_entry';")
      .all();
    assert.equal(
      uncommittedRows.length,
      0,
      'Uncommitted transaction from killed child must be rolled back by WAL recovery',
    );

    recoveryService.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T14: Repeated recovery stress
// ----------------------------------------------------------------------------
test('WP008-T14: Repeated recovery stress — deterministically survives repeated crash/recovery cycles', async () => {
  const dbPath = getTempDbPath('t14');
  try {
    // Pre-seed
    const initService = new EdgeDatabaseService({ databasePath: dbPath });
    const initNative = getTestNativeDatabase(initService);
    initNative.exec(
      'CREATE TABLE crash_test (id INTEGER PRIMARY KEY, marker TEXT, committed INTEGER);',
    );
    initService.close();

    const iterations = 5;

    for (let i = 1; i <= iterations; i++) {
      // 1. Commit one legitimate record
      const parentService = new EdgeDatabaseService({ databasePath: dbPath });
      const parentNative = getTestNativeDatabase(parentService);
      parentService.runInTransaction(() => {
        parentNative
          .prepare('INSERT INTO crash_test (marker, committed) VALUES (?, 1);')
          .run(`committed_cycle_${i}`);
      });
      parentService.close();

      // 2. Spawn worker to begin uncommitted write
      const child = spawn('node', [crashWorkerHelperPath, dbPath], {
        stdio: ['inherit', 'pipe', 'inherit'],
      });

      await new Promise<void>((resolve, reject) => {
        child.stdout?.on('data', (d: Buffer) => {
          if (d.toString().includes('READY')) {
            resolve();
          }
        });
        child.on('error', reject);
      });

      // 3. Kill child abruptly
      child.kill('SIGKILL');
      await new Promise((resolve) => child.on('close', resolve));

      // 4. Reopen and verify integrity and committed count
      const verifyService = new EdgeDatabaseService({ databasePath: dbPath });
      const verifyNative = getTestNativeDatabase(verifyService);

      assert.doesNotThrow(() => {
        verifyService.assertIntegrity();
      }, `Cycle ${i}: Integrity assertion must succeed`);

      const count = verifyNative
        .prepare('SELECT COUNT(*) as c FROM crash_test WHERE committed = 1;')
        .get() as {
        c: number;
      };
      assert.equal(count.c, i, `Cycle ${i}: Exactly ${i} committed records must exist`);

      const uncommitted = verifyNative
        .prepare("SELECT COUNT(*) as c FROM crash_test WHERE marker = 'uncommitted_entry';")
        .get() as { c: number };
      assert.equal(uncommitted.c, 0, `Cycle ${i}: Zero uncommitted records must leak`);

      verifyService.close();
    }
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-T15: Existing regression suite
// ----------------------------------------------------------------------------
test('WP008-T15: Existing regression suite — verifies core edge package info remains intact', () => {
  const dbPath = getTempDbPath('t15');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    assert.equal(service.isOpen(), true, 'Database service must be open');
    service.close();
    assert.equal(service.isOpen(), false, 'Database service must report closed after close()');
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ============================================================================
// REMEDIATION R1 NEGATIVE TESTS
// ============================================================================

// ----------------------------------------------------------------------------
// WP008-R1-T01: Durability restoration failure
// ----------------------------------------------------------------------------
test('WP008-R1-T01: Durability restoration failure — must fail closed with EdgeDurabilityError and reject subsequent queries', () => {
  const dbPath = getTempDbPath('r1_t01');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    assert.equal(service.getSynchronousMode(), 'NORMAL');

    // Intercept setSyncPragma to simulate failure specifically during restoration
    const originalSetSyncPragma = service.setSyncPragma.bind(service);
    let calls = 0;
    service.setSyncPragma = (mode: DurabilityMode) => {
      calls++;
      if (calls === 2) {
        // Second call is the restoration back to prior mode
        throw new Error('Simulated SQLite disk/pragma failure during restoration');
      }
      return originalSetSyncPragma(mode);
    };

    // Caller must NOT receive normal success; typed durability failure must be surfaced
    assert.throws(
      () => {
        service.runInDurabilityMode('FULL', () => {
          return 'operational_payload';
        });
      },
      (err: unknown) => {
        assert(err instanceof EdgeDurabilityError, 'Must throw EdgeDurabilityError');
        assert.match((err as Error).message, /Durability restoration failed/);
        return true;
      },
    );

    // Verify database state is treated fail-closed: service must reject subsequent operations
    assert.throws(
      () => {
        service.runInTransaction(() => {});
      },
      (err: unknown) => {
        assert(
          err instanceof EdgeDurabilityError,
          'Must reject operations once durability is compromised',
        );
        return true;
      },
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-R1-T02: Operation failure + restoration failure
// ----------------------------------------------------------------------------
test('WP008-R1-T02: Operation failure + restoration failure — preserves both failure contexts in cause', () => {
  const dbPath = getTempDbPath('r1_t02');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const originalSetSyncPragma = service.setSyncPragma.bind(service);
    let calls = 0;
    service.setSyncPragma = (mode: DurabilityMode) => {
      calls++;
      if (calls === 2) {
        throw new Error('Simulated restoration failure');
      }
      return originalSetSyncPragma(mode);
    };

    assert.throws(
      () => {
        service.runInDurabilityMode('FULL', () => {
          throw new Error('Primary operation failed');
        });
      },
      (err: unknown) => {
        assert(err instanceof EdgeDurabilityError, 'Must throw EdgeDurabilityError');
        assert.match((err as Error).message, /Durability restoration failed/);

        // Verify cause preserves both failure contexts
        const cause = (err as EdgeDurabilityError).cause as
          { operationError?: Error; restorationError?: Error } | undefined;
        assert(cause, 'Must have cause containing dual failure context');
        assert.match(String(cause.operationError?.message), /Primary operation failed/);
        assert.match(String(cause.restorationError?.message), /Simulated restoration failure/);
        return true;
      },
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-R1-T03: Rollback failure handling
// ----------------------------------------------------------------------------
test('WP008-R1-T03: Rollback failure handling — fails closed and surfaces EdgeTransactionRollbackError', () => {
  const dbPath = getTempDbPath('r1_t03');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });
    const native = getTestNativeDatabase(service);

    // Intercept native.exec to simulate failure during ROLLBACK
    const originalExec = native.exec.bind(native);
    native.exec = ((sql: string) => {
      if (typeof sql === 'string' && sql.toUpperCase().includes('ROLLBACK')) {
        throw new Error('Simulated SQLite disk I/O failure during ROLLBACK');
      }
      return originalExec(sql);
    }) as typeof native.exec;

    assert.throws(
      () => {
        service.runInTransaction(() => {
          throw new Error('Business operation failure triggers rollback');
        });
      },
      (err: unknown) => {
        assert(
          err instanceof EdgeTransactionRollbackError,
          'Must throw EdgeTransactionRollbackError',
        );
        assert.match((err as Error).message, /Transaction rollback failed/);

        const cause = (err as EdgeTransactionRollbackError).cause as
          { operationError?: Error; rollbackError?: Error } | undefined;
        assert(cause, 'Must preserve both operationError and rollbackError in cause');
        assert.match(
          String(cause.operationError?.message),
          /Business operation failure triggers rollback/,
        );
        assert.match(
          String(cause.rollbackError?.message),
          /Simulated SQLite disk I\/O failure during ROLLBACK/,
        );
        return true;
      },
    );

    // Subsequent use must fail closed because transactional state is compromised
    assert.throws(
      () => {
        service.runInTransaction(() => {});
      },
      (err: unknown) => {
        assert(
          err instanceof EdgeTransactionRollbackError,
          'Must fail closed on subsequent operations',
        );
        return true;
      },
    );

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});

// ----------------------------------------------------------------------------
// WP008-R1-T04: Native escape-hatch boundary
// ----------------------------------------------------------------------------
test('WP008-R1-T04: Native escape-hatch boundary — production API does not expose getNativeDatabase', () => {
  const dbPath = getTempDbPath('r1_t04');
  try {
    const service = new EdgeDatabaseService({ databasePath: dbPath });

    // Verify getNativeDatabase is NOT a property on instance or prototype
    assert.equal(
      (service as unknown as Record<string, unknown>).getNativeDatabase,
      undefined,
      'Production service must not expose getNativeDatabase method',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(EdgeDatabaseService.prototype, 'getNativeDatabase'),
      false,
      'EdgeDatabaseService prototype must not have getNativeDatabase',
    );

    // Verify test-only harness can still access native database for empirical testing
    const testNative = getTestNativeDatabase(service);
    assert(testNative, 'Test harness must be able to access native SQLite instance for assertions');
    const row = testNative.prepare('SELECT 42 as answer;').get() as { answer: number };
    assert.equal(row.answer, 42);

    service.close();
  } finally {
    cleanupTempDb(dbPath);
  }
});
