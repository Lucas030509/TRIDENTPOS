/**
 * TRIDENTPOS Edge Local Database Service
 * Authoritative SQLite WAL & Durability Manager per ADR-004, DATA_ARCHITECTURE.md Sec. 3, and WP-008.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  ALLOWED_DURABILITY_MODES,
  DEFAULT_EDGE_DB_FILENAME,
  DurabilityMode,
  EdgeDatabaseError,
  EdgeDatabaseOptions,
  EdgeDurabilityError,
  EdgeIntegrityViolationError,
  EdgeTransactionRollbackError,
  IntegrityCheckResult,
  TransactionOptions,
  WalCheckpointMode,
  WalCheckpointResult,
  WalStats,
} from './types.js';
import { WriteSerializer } from './write-serializer.js';
import { WalCheckpointManager } from './wal-manager.js';
import { registerTestNativeDatabase } from './test-access.js';

export class EdgeDatabaseService {
  readonly #db: Database.Database;
  readonly #resolvedPath: string;
  readonly #writeSerializer: WriteSerializer;
  readonly #walManager: WalCheckpointManager;
  #currentDurabilityMode: DurabilityMode = 'NORMAL';
  #closed = false;
  #isDurabilityCompromised = false;
  #isTransactionCompromised = false;

  constructor(options: EdgeDatabaseOptions = {}) {
    // 1. Resolve controlled database path
    if (options.databasePath) {
      this.#resolvedPath = path.resolve(options.databasePath);
    } else if (process.env.TRIDENT_EDGE_DB_PATH) {
      this.#resolvedPath = path.resolve(process.env.TRIDENT_EDGE_DB_PATH);
    } else {
      const defaultDir = path.resolve(process.cwd(), 'data');
      this.#resolvedPath = path.join(defaultDir, DEFAULT_EDGE_DB_FILENAME);
    }

    // Ensure parent directory exists for file-backed databases
    if (this.#resolvedPath !== ':memory:') {
      const parentDir = path.dirname(this.#resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    const busyTimeout = options.busyTimeoutMs ?? 5000;

    // 2. Instantiate native SQLite connection
    try {
      this.#db = new Database(this.#resolvedPath, {
        timeout: busyTimeout,
        readonly: options.readOnly ?? false,
        fileMustExist: options.fileMustExist ?? false,
      });
    } catch (err) {
      throw new EdgeDatabaseError(
        `Failed to open SQLite database at '${this.#resolvedPath}': ${(err as Error).message}`,
      );
    }

    // Register in module-private test registry (not reachable from instance/prototype reflection)
    registerTestNativeDatabase(this, this.#db);

    // 3. Configure baseline PRAGMAs
    try {
      // Enforce foreign key constraints
      this.#db.pragma('foreign_keys = ON');

      // Enforce busy timeout to avoid immediate SQLITE_BUSY
      this.#db.pragma(`busy_timeout = ${busyTimeout}`);

      // 4. Activate and rigorously verify WAL mode
      const configuredJournalMode = this.#db.pragma('journal_mode = WAL', {
        simple: true,
      }) as string;

      const effectiveJournalMode = this.getJournalMode();
      if (effectiveJournalMode.toLowerCase() !== 'wal') {
        throw new EdgeDatabaseError(
          `WAL mode verification failed: requested 'WAL', but effective mode is '${effectiveJournalMode}' (configured returned '${configuredJournalMode}'). Refusing to proceed.`,
        );
      }

      // 5. Configure and verify default synchronous durability mode (NORMAL per ADR-004)
      const defaultMode = options.defaultDurabilityMode ?? 'NORMAL';
      this.setSyncPragma(defaultMode);
    } catch (err) {
      // Clean up connection on bootstrap failure
      try {
        this.#db.close();
      } catch {
        // ignore secondary close error
      }
      this.#closed = true;
      throw err instanceof EdgeDatabaseError
        ? err
        : new EdgeDatabaseError(`Database initialization error: ${(err as Error).message}`);
    }

    // 6. Initialize auxiliary managers
    this.#writeSerializer = new WriteSerializer();
    this.#walManager = new WalCheckpointManager(this.#db, this.#resolvedPath, {
      alertThresholdBytes: options.walAlertThresholdBytes,
      logger: options.logger,
    });
  }

  public getDatabasePath(): string {
    return this.#resolvedPath;
  }

  public isOpen(): boolean {
    return !this.#closed && this.#db.open;
  }

  /**
   * Reads the current effective SQLite journal_mode.
   */
  public getJournalMode(): string {
    this.assertOpen();
    const mode = this.#db.pragma('journal_mode', { simple: true });
    return String(mode).toLowerCase();
  }

  /**
   * Reads the current effective durability mode ('NORMAL' or 'FULL').
   * SQLite maps: 1 -> NORMAL, 2 -> FULL.
   */
  public getSynchronousMode(): DurabilityMode {
    this.assertOpen();
    const syncVal = this.#db.pragma('synchronous', { simple: true });
    if (syncVal === 1 || String(syncVal).toLowerCase() === 'normal') {
      return 'NORMAL';
    }
    if (syncVal === 2 || String(syncVal).toLowerCase() === 'full') {
      return 'FULL';
    }
    throw new EdgeDurabilityError(
      `Unexpected SQLite synchronous value: ${String(syncVal)}. Expected NORMAL (1) or FULL (2).`,
    );
  }

  /**
   * Configures SQLite synchronous mode with fail-closed validation.
   * Only accepts 'NORMAL' or 'FULL' per ADR-004.
   */
  public setSyncPragma(mode: DurabilityMode): void {
    this.assertOpen();

    if (!ALLOWED_DURABILITY_MODES.has(mode)) {
      throw new EdgeDurabilityError(
        `Invalid durability mode '${mode}'. Allowed modes: ${Array.from(ALLOWED_DURABILITY_MODES).join(', ')}`,
      );
    }

    try {
      this.#db.pragma(`synchronous = ${mode}`);
    } catch (err) {
      throw new EdgeDurabilityError(
        `Failed to set synchronous pragma to '${mode}': ${(err as Error).message}`,
      );
    }

    const effective = this.getSynchronousMode();
    if (effective !== mode) {
      throw new EdgeDurabilityError(
        `Durability verification failed: set synchronous = ${mode}, but effective value is ${effective}. Failing closed.`,
      );
    }

    this.#currentDurabilityMode = mode;
  }

  /**
   * Temporarily executes a callback within the specified durability mode.
   * Guarantees safe restoration of the prior mode in all cases (success or exception).
   * Fails closed if durability restoration fails, ensuring callers never receive
   * a false-green success when durability state is compromised.
   */
  public runInDurabilityMode<T>(mode: DurabilityMode, fn: () => T): T {
    this.assertOpen();
    const priorMode = this.#currentDurabilityMode;

    if (mode !== priorMode) {
      this.setSyncPragma(mode);
    }

    let opError: unknown = null;
    let result: T | undefined;
    try {
      result = fn();
    } catch (err) {
      opError = err;
    }

    let restoreError: unknown = null;
    if (this.#currentDurabilityMode !== priorMode && this.isOpen()) {
      try {
        this.setSyncPragma(priorMode);
      } catch (rErr) {
        restoreError = rErr;
        this.#isDurabilityCompromised = true;
      }
    }

    if (restoreError) {
      const msg = opError
        ? `Durability restoration failed: unable to restore prior mode '${priorMode}' (currently '${this.#currentDurabilityMode}'). Database durability state is compromised. Original operation also failed: ${(opError as Error).message}`
        : `Durability restoration failed: unable to restore prior mode '${priorMode}' (currently '${this.#currentDurabilityMode}'). Database durability state is compromised.`;

      throw new EdgeDurabilityError(msg, {
        cause: opError
          ? { operationError: opError, restorationError: restoreError }
          : { restorationError: restoreError },
      });
    }

    if (opError) {
      throw opError;
    }

    return result as T;
  }

  /**
   * Executes a callback within an explicit atomic transaction boundary.
   * Guarantees:
   * - Commit on success
   * - Automatic rollback on operation exception
   * - Fail closed if rollback itself fails, preventing continued use of a compromised connection
   * - Fail closed if commit fails, attempting rollback and transitioning connection to untrusted state
   * - Error propagation preserving dual error contexts
   * - Optional durability mode override (e.g. 'FULL' for financial/fiscal boundaries)
   */
  public runInTransaction<T>(fn: () => T, options: TransactionOptions = {}): T {
    this.assertOpen();

    const behavior = options.behavior ?? 'IMMEDIATE';
    const executeTx = () => {
      // Use explicit BEGIN / COMMIT / ROLLBACK semantics
      this.#db.exec(`BEGIN ${behavior};`);
      let result: T;
      try {
        result = fn();
      } catch (opErr) {
        try {
          if (this.#db.inTransaction) {
            this.#db.exec('ROLLBACK;');
          }
        } catch (rollbackErr) {
          this.#isTransactionCompromised = true;
          const msg = `Transaction rollback failed: unable to rollback aborted transaction. Connection transactional state is compromised. Original error: ${(opErr as Error).message}. Rollback error: ${(rollbackErr as Error).message}`;
          throw new EdgeTransactionRollbackError(msg, {
            cause: { operationError: opErr, rollbackError: rollbackErr },
          });
        }
        throw opErr;
      }

      try {
        this.#db.exec('COMMIT;');
      } catch (commitErr) {
        this.#isTransactionCompromised = true;
        let rollbackErr: unknown = null;
        try {
          if (this.#db.inTransaction) {
            this.#db.exec('ROLLBACK;');
          }
        } catch (rbErr) {
          rollbackErr = rbErr;
        }

        const msg = rollbackErr
          ? `Transaction commit failed and subsequent rollback also failed: ${(commitErr as Error).message}. Rollback error: ${(rollbackErr as Error).message}. Connection transactional state is compromised.`
          : `Transaction commit failed: ${(commitErr as Error).message}. Connection transactional state is compromised.`;

        throw new EdgeTransactionRollbackError(msg, {
          cause: rollbackErr
            ? { commitError: commitErr, rollbackError: rollbackErr }
            : { commitError: commitErr },
        });
      }

      return result;
    };

    if (options.durabilityMode && options.durabilityMode !== this.#currentDurabilityMode) {
      return this.runInDurabilityMode(options.durabilityMode, executeTx);
    }

    return executeTx();
  }

  /**
   * Convenience alias for runInTransaction.
   */
  public transaction<T>(fn: () => T, options: TransactionOptions = {}): T {
    return this.runInTransaction(fn, options);
  }

  /**
   * Executes raw DDL or batch SQL statements with fail-closed connection check.
   */
  public exec(sql: string): void {
    this.assertOpen();
    this.#db.exec(sql);
  }

  /**
   * Executes a parameterized DML statement (INSERT, UPDATE, DELETE).
   */
  public run(sql: string, params: unknown[] = []): Database.RunResult {
    this.assertOpen();
    return this.#db.prepare(sql).run(...params);
  }

  /**
   * Executes a parameterized query and returns all matching rows.
   */
  public query<T = unknown>(sql: string, params: unknown[] = []): T[] {
    this.assertOpen();
    return this.#db.prepare(sql).all(...params) as T[];
  }

  /**
   * Convenience execution helper for financial/fiscal critical transactions (e.g. Corte Z, shift close).
   * Runs inside an explicit transaction with PRAGMA synchronous = FULL,
   * automatically restoring PRAGMA synchronous = NORMAL afterwards.
   */
  public runCriticalTransaction<T>(fn: () => T): T {
    return this.runInTransaction(fn, {
      durabilityMode: 'FULL',
      behavior: 'IMMEDIATE',
    });
  }

  /**
   * Executes a write operation through the in-process WriteSerializer queue.
   * Serializes competing writes to prevent avoidable SQLITE_BUSY errors.
   */
  public runSerializedWrite<T>(operation: () => Promise<T> | T): Promise<T> {
    this.assertOpen();
    return this.#writeSerializer.serialize(operation);
  }

  /**
   * Executes an automated or manual WAL checkpoint.
   */
  public checkpoint(mode: WalCheckpointMode = 'PASSIVE'): WalCheckpointResult {
    this.assertOpen();
    return this.#walManager.checkpoint(mode);
  }

  /**
   * Returns current WAL on-disk statistics and alert threshold evaluation.
   */
  public getWalStats(): WalStats {
    this.assertOpen();
    return this.#walManager.getWalStats();
  }

  /**
   * Performs an objective integrity check on the database via PRAGMA integrity_check.
   * Returns details and health status.
   */
  public verifyIntegrity(): IntegrityCheckResult {
    this.assertOpen();

    try {
      const rows = this.#db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const details = rows.map((r) => r.integrity_check);
      const healthy = details.length === 1 && details[0] === 'ok';

      return {
        healthy,
        status: healthy ? 'ok' : 'corrupted',
        details,
      };
    } catch (err) {
      return {
        healthy: false,
        status: 'error',
        details: [(err as Error).message],
      };
    }
  }

  /**
   * Fails closed by throwing EdgeIntegrityViolationError if integrity_check is not 'ok'.
   */
  public assertIntegrity(): void {
    const result = this.verifyIntegrity();
    if (!result.healthy) {
      throw new EdgeIntegrityViolationError(
        'Database failed integrity verification',
        result.details,
      );
    }
  }

  /**
   * Closes the database connection cleanly.
   */
  public close(): void {
    if (!this.#closed) {
      this.#writeSerializer.clear();
      this.#db.close();
      this.#closed = true;
    }
  }

  private assertOpen(): void {
    if (this.#closed || !this.#db.open) {
      throw new EdgeDatabaseError('Database connection is closed');
    }
    if (this.#isDurabilityCompromised) {
      throw new EdgeDurabilityError(
        'Database service is in an untrusted durability state following restoration failure. Reconnection required.',
      );
    }
    if (this.#isTransactionCompromised) {
      throw new EdgeTransactionRollbackError(
        'Database connection is in an untrusted transactional state following transaction failure. Reconnection required.',
      );
    }
  }
}
