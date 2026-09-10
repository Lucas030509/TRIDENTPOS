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
  IntegrityCheckResult,
  TransactionOptions,
  WalCheckpointMode,
  WalCheckpointResult,
  WalStats,
} from './types.js';
import { WriteSerializer } from './write-serializer.js';
import { WalCheckpointManager } from './wal-manager.js';

export class EdgeDatabaseService {
  private readonly db: Database.Database;
  private readonly resolvedPath: string;
  private readonly writeSerializer: WriteSerializer;
  private readonly walManager: WalCheckpointManager;
  private currentDurabilityMode: DurabilityMode = 'NORMAL';
  private closed = false;

  constructor(options: EdgeDatabaseOptions = {}) {
    // 1. Resolve controlled database path
    if (options.databasePath) {
      this.resolvedPath = path.resolve(options.databasePath);
    } else if (process.env.TRIDENT_EDGE_DB_PATH) {
      this.resolvedPath = path.resolve(process.env.TRIDENT_EDGE_DB_PATH);
    } else {
      const defaultDir = path.resolve(process.cwd(), 'data');
      this.resolvedPath = path.join(defaultDir, DEFAULT_EDGE_DB_FILENAME);
    }

    // Ensure parent directory exists for file-backed databases
    if (this.resolvedPath !== ':memory:') {
      const parentDir = path.dirname(this.resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    const busyTimeout = options.busyTimeoutMs ?? 5000;

    // 2. Instantiate native SQLite connection
    try {
      this.db = new Database(this.resolvedPath, {
        timeout: busyTimeout,
        readonly: options.readOnly ?? false,
        fileMustExist: options.fileMustExist ?? false,
      });
    } catch (err) {
      throw new EdgeDatabaseError(
        `Failed to open SQLite database at '${this.resolvedPath}': ${(err as Error).message}`,
      );
    }

    // 3. Configure baseline PRAGMAs
    try {
      // Enforce foreign key constraints
      this.db.pragma('foreign_keys = ON');

      // Enforce busy timeout to avoid immediate SQLITE_BUSY
      this.db.pragma(`busy_timeout = ${busyTimeout}`);

      // 4. Activate and rigorously verify WAL mode
      const configuredJournalMode = this.db.pragma('journal_mode = WAL', {
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
        this.db.close();
      } catch {
        // ignore secondary close error
      }
      this.closed = true;
      throw err instanceof EdgeDatabaseError
        ? err
        : new EdgeDatabaseError(`Database initialization error: ${(err as Error).message}`);
    }

    // 6. Initialize auxiliary managers
    this.writeSerializer = new WriteSerializer();
    this.walManager = new WalCheckpointManager(this.db, this.resolvedPath, {
      alertThresholdBytes: options.walAlertThresholdBytes,
      logger: options.logger,
    });
  }

  public getDatabasePath(): string {
    return this.resolvedPath;
  }

  public isOpen(): boolean {
    return !this.closed && this.db.open;
  }

  public getNativeDatabase(): Database.Database {
    this.assertOpen();
    return this.db;
  }

  /**
   * Reads the current effective SQLite journal_mode.
   */
  public getJournalMode(): string {
    this.assertOpen();
    const mode = this.db.pragma('journal_mode', { simple: true });
    return String(mode).toLowerCase();
  }

  /**
   * Reads the current effective durability mode ('NORMAL' or 'FULL').
   * SQLite maps: 1 -> NORMAL, 2 -> FULL.
   */
  public getSynchronousMode(): DurabilityMode {
    this.assertOpen();
    const syncVal = this.db.pragma('synchronous', { simple: true });
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
      this.db.pragma(`synchronous = ${mode}`);
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

    this.currentDurabilityMode = mode;
  }

  /**
   * Temporarily executes a callback within the specified durability mode.
   * Guarantees safe restoration of the prior mode in all cases (success or exception).
   */
  public runInDurabilityMode<T>(mode: DurabilityMode, fn: () => T): T {
    this.assertOpen();
    const priorMode = this.currentDurabilityMode;

    if (mode !== priorMode) {
      this.setSyncPragma(mode);
    }

    try {
      return fn();
    } finally {
      if (this.currentDurabilityMode !== priorMode && this.isOpen()) {
        try {
          this.setSyncPragma(priorMode);
        } catch (restoreErr) {
          // Log or throw durability restoration failure
          console.error(
            `[FATAL] Failed to restore durability mode to '${priorMode}': ${(restoreErr as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Executes a callback within an explicit atomic transaction boundary.
   * Guarantees:
   * - Commit on success
   * - Automatic rollback on exception
   * - Error propagation
   * - Connection remains fully usable after rollback
   * - Optional durability mode override (e.g. 'FULL' for financial/fiscal boundaries)
   */
  public runInTransaction<T>(fn: () => T, options: TransactionOptions = {}): T {
    this.assertOpen();

    const behavior = options.behavior ?? 'IMMEDIATE';
    const executeTx = () => {
      // Use explicit BEGIN / COMMIT / ROLLBACK semantics
      this.db.exec(`BEGIN ${behavior};`);
      try {
        const result = fn();
        this.db.exec('COMMIT;');
        return result;
      } catch (err) {
        try {
          if (this.db.inTransaction) {
            this.db.exec('ROLLBACK;');
          }
        } catch (rollbackErr) {
          console.error(`[WARN] Transaction rollback error: ${(rollbackErr as Error).message}`);
        }
        throw err;
      }
    };

    if (options.durabilityMode && options.durabilityMode !== this.currentDurabilityMode) {
      return this.runInDurabilityMode(options.durabilityMode, executeTx);
    }

    return executeTx();
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
    return this.writeSerializer.serialize(operation);
  }

  /**
   * Executes an automated or manual WAL checkpoint.
   */
  public checkpoint(mode: WalCheckpointMode = 'PASSIVE'): WalCheckpointResult {
    this.assertOpen();
    return this.walManager.checkpoint(mode);
  }

  /**
   * Returns current WAL on-disk statistics and alert threshold evaluation.
   */
  public getWalStats(): WalStats {
    this.assertOpen();
    return this.walManager.getWalStats();
  }

  /**
   * Performs an objective integrity check on the database via PRAGMA integrity_check.
   * Returns details and health status.
   */
  public verifyIntegrity(): IntegrityCheckResult {
    this.assertOpen();

    try {
      const rows = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
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
    if (!this.closed) {
      this.writeSerializer.clear();
      this.db.close();
      this.closed = true;
    }
  }

  private assertOpen(): void {
    if (this.closed || !this.db.open) {
      throw new EdgeDatabaseError('Database connection is closed');
    }
  }
}
