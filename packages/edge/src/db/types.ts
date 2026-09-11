/**
 * TRIDENTPOS Edge Local Database (SQLite WAL) & Durability Manager Types
 * Authoritative definitions per ADR-004, DATA_ARCHITECTURE.md Sec. 3, and WP-008.
 */

export class EdgeDatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`[EDGE-DATABASE-ERROR] ${message}`, options);
    this.name = 'EdgeDatabaseError';
  }
}

export class EdgeIntegrityViolationError extends EdgeDatabaseError {
  constructor(
    message: string,
    public readonly details: string[] = [],
    options?: ErrorOptions,
  ) {
    super(`[INTEGRITY-VIOLATION] ${message}: ${details.join('; ')}`, options);
    this.name = 'EdgeIntegrityViolationError';
  }
}

export class EdgeDurabilityError extends EdgeDatabaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(`[DURABILITY-ERROR] ${message}`, options);
    this.name = 'EdgeDurabilityError';
  }
}

export class EdgeTransactionRollbackError extends EdgeDatabaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(`[ROLLBACK-ERROR] ${message}`, options);
    this.name = 'EdgeTransactionRollbackError';
  }
}

/**
 * Supported SQLite Durability Modes per ADR-004:
 * - NORMAL: Default for operational floor transactions (high frequency, sub-ms).
 * - FULL: Durability-critical mode for financial/fiscal boundaries (Corte Z, shift close).
 */
export const DURABILITY_MODES = {
  NORMAL: 'NORMAL',
  FULL: 'FULL',
} as const;

export type DurabilityMode = (typeof DURABILITY_MODES)[keyof typeof DURABILITY_MODES];

export const ALLOWED_DURABILITY_MODES = new Set<string>(Object.values(DURABILITY_MODES));

/**
 * SQLite WAL Checkpoint Modes:
 * - PASSIVE: Checkpoints as many frames as possible without blocking.
 * - FULL: Waits for active readers/writers to finish before checkpointing.
 * - RESTART: Like FULL, but also resets the WAL file log.
 * - TRUNCATE: Like RESTART, but also truncates the WAL file to zero bytes.
 */
export type WalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

export const ALLOWED_CHECKPOINT_MODES = new Set<string>(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);

/**
 * Preventative WAL file size alert threshold: 50 MB per ADR-004 Sec. 10.
 */
export const DEFAULT_WAL_ALERT_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Default database filename per WP-008 specification.
 */
export const DEFAULT_EDGE_DB_FILENAME = 'edge_pos.db';

export interface EdgeDatabaseOptions {
  /**
   * File path to the SQLite database.
   * If omitted, resolves to the canonical Edge database directory.
   */
  databasePath?: string;

  /**
   * Default durability mode. Defaults to 'NORMAL'.
   */
  defaultDurabilityMode?: DurabilityMode;

  /**
   * SQLite busy timeout in milliseconds to prevent immediate SQLITE_BUSY errors.
   * Defaults to 5000ms.
   */
  busyTimeoutMs?: number;

  /**
   * Preventative alert threshold for WAL file growth in bytes.
   * Defaults to 50 MB (ADR-004 Sec. 10).
   */
  walAlertThresholdBytes?: number;

  /**
   * Open in read-only mode if true.
   */
  readOnly?: boolean;

  /**
   * If true, throws if the database file does not already exist.
   */
  fileMustExist?: boolean;

  /**
   * Optional logger callback for database operational events.
   */
  logger?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ) => void;
}

export interface WalStats {
  walSizeBytes: number;
  shmSizeBytes: number;
  isAboveAlertThreshold: boolean;
  alertThresholdBytes: number;
}

export interface WalCheckpointResult {
  mode: WalCheckpointMode;
  busy: number;
  log: number;
  checkpointed: number;
}

export interface IntegrityCheckResult {
  healthy: boolean;
  status: string;
  details: string[];
}

export interface TransactionOptions {
  /**
   * Optional durability override for this transaction.
   * If 'FULL', ensures PRAGMA synchronous = FULL is set before execution
   * and restored to the prior mode upon completion.
   */
  durabilityMode?: DurabilityMode;

  /**
   * Transaction isolation mode:
   * - 'DEFERRED' (default)
   * - 'IMMEDIATE' (locks writer immediately)
   * - 'EXCLUSIVE'
   */
  behavior?: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE';
}
