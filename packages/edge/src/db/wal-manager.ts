/**
 * TRIDENTPOS Edge WAL Checkpoint & Observability Manager
 * Monitors WAL file growth, preventative alert threshold (50 MB), and triggers
 * non-destructive SQLite WAL checkpoints per ADR-004 Sec. 10 and WP-008 Sec. 13.
 */

import fs from 'node:fs';
import type Database from 'better-sqlite3';
import {
  ALLOWED_CHECKPOINT_MODES,
  DEFAULT_WAL_ALERT_THRESHOLD_BYTES,
  EdgeDatabaseError,
  WalCheckpointMode,
  WalCheckpointResult,
  WalStats,
} from './types.js';

export interface WalCheckpointManagerOptions {
  alertThresholdBytes?: number;
  logger?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ) => void;
}

export class WalCheckpointManager {
  private readonly alertThresholdBytes: number;
  private readonly logger?: WalCheckpointManagerOptions['logger'];

  constructor(
    private readonly db: Database.Database,
    private readonly databasePath: string,
    options: WalCheckpointManagerOptions = {},
  ) {
    this.alertThresholdBytes = options.alertThresholdBytes ?? DEFAULT_WAL_ALERT_THRESHOLD_BYTES;
    this.logger = options.logger;
  }

  /**
   * Returns current on-disk statistics for the database WAL and shared memory files.
   * Checks whether WAL size exceeds the preventative alert threshold (50 MB).
   */
  public getWalStats(): WalStats {
    const walPath = `${this.databasePath}-wal`;
    const shmPath = `${this.databasePath}-shm`;

    let walSizeBytes = 0;
    let shmSizeBytes = 0;

    try {
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch (err) {
      this.logger?.('warn', `Could not stat WAL file at '${walPath}': ${(err as Error).message}`);
    }

    try {
      if (fs.existsSync(shmPath)) {
        shmSizeBytes = fs.statSync(shmPath).size;
      }
    } catch (err) {
      this.logger?.('warn', `Could not stat SHM file at '${shmPath}': ${(err as Error).message}`);
    }

    const isAboveAlertThreshold = walSizeBytes >= this.alertThresholdBytes;

    if (isAboveAlertThreshold) {
      this.logger?.(
        'warn',
        `WAL size (${walSizeBytes} bytes) has reached or exceeded alert threshold (${this.alertThresholdBytes} bytes). Checkpoint recommended.`,
        { walSizeBytes, alertThresholdBytes: this.alertThresholdBytes },
      );
    }

    return {
      walSizeBytes,
      shmSizeBytes,
      isAboveAlertThreshold,
      alertThresholdBytes: this.alertThresholdBytes,
    };
  }

  /**
   * Executes a native SQLite WAL checkpoint using PRAGMA wal_checkpoint(<mode>).
   * Does NOT manually unlink or manipulate -wal or -shm files.
   */
  public checkpoint(mode: WalCheckpointMode = 'PASSIVE'): WalCheckpointResult {
    if (!ALLOWED_CHECKPOINT_MODES.has(mode)) {
      throw new EdgeDatabaseError(
        `Invalid checkpoint mode '${mode}'. Allowed modes: ${Array.from(ALLOWED_CHECKPOINT_MODES).join(', ')}`,
      );
    }

    try {
      const rows = this.db.pragma(`wal_checkpoint(${mode})`) as Array<{
        busy?: number;
        log?: number;
        checkpointed?: number;
      }>;

      const first = rows && rows.length > 0 ? rows[0] : undefined;

      const result: WalCheckpointResult = {
        mode,
        busy: first?.busy ?? 0,
        log: first?.log ?? 0,
        checkpointed: first?.checkpointed ?? 0,
      };

      this.logger?.('info', `Executed WAL checkpoint (${mode})`, { ...result });
      return result;
    } catch (err) {
      throw new EdgeDatabaseError(
        `Failed to execute WAL checkpoint (${mode}): ${(err as Error).message}`,
      );
    }
  }
}
