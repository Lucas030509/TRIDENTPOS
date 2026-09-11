/**
 * TRIDENTPOS Edge Trusted Effective Time and Clock Rollback Protection
 * Conforms to ACR-2026-011, IAM_SECURITY_MODEL.md Sec. 5, and SECURITY_ARCHITECTURE.md Sec. 10.
 * Implements: trustedEffectiveTime = Tcloud + monotonicElapsedSince(M0) via process.hrtime.bigint().
 */

import type Database from 'better-sqlite3';
import { ClockRollbackLockError, TrustedTimeAnchorRecord } from './types.js';

export interface TrustedTimeManagerOptions {
  readonly db: Database.Database;
  readonly onRollbackDetected?: (details: {
    lastKnownCloudTime: number;
    currentWallTime: number;
    driftSeconds: number;
  }) => void;
}

export class TrustedTimeManager {
  readonly #db: Database.Database;
  readonly #onRollbackDetected?: (details: {
    lastKnownCloudTime: number;
    currentWallTime: number;
    driftSeconds: number;
  }) => void;

  #tCloud: number | null = null;
  #m0: bigint | null = null;
  #isLocked = false;
  #lockReason: string | null = null;

  constructor(options: TrustedTimeManagerOptions) {
    this.#db = options.db;
    this.#onRollbackDetected = options.onRollbackDetected;
    this.#initAnchorTable();
    this.#loadPersistedAnchor();
  }

  #initAnchorTable(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS trusted_time_anchors (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_known_cloud_time INTEGER NOT NULL,
        local_wall_time_at_last_cloud_sync INTEGER NOT NULL,
        anchor_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  #loadPersistedAnchor(): void {
    const row = this.#db.prepare('SELECT * FROM trusted_time_anchors WHERE id = 1').get() as
      | {
          id: number;
          last_known_cloud_time: number;
          local_wall_time_at_last_cloud_sync: number;
          anchor_version: number;
          updated_at: number;
        }
      | undefined;

    if (row) {
      const currentWallTime = Math.floor(Date.now() / 1000);
      const rollbackThresholdSeconds = 300; // 5 minutes

      // Invariant: If current wall clock is backward more than 5 minutes before lastKnownCloudTime, trigger lock
      if (currentWallTime < row.last_known_cloud_time - rollbackThresholdSeconds) {
        const drift = row.last_known_cloud_time - currentWallTime;
        this.#triggerRollbackLock(
          `Clock rollback detected on restart: current wall clock (${currentWallTime}) is ${drift}s behind persisted cloud anchor (${row.last_known_cloud_time})`,
          row.last_known_cloud_time,
          currentWallTime,
          drift,
        );
      } else {
        // Safe lower bound: initialize with persisted cloud time
        this.#tCloud = Math.max(row.last_known_cloud_time, currentWallTime);
        this.#m0 = process.hrtime.bigint();
      }
    }
  }

  #triggerRollbackLock(
    reason: string,
    lastKnownCloudTime: number,
    currentWallTime: number,
    driftSeconds: number,
  ): void {
    this.#isLocked = true;
    this.#lockReason = reason;

    if (this.#onRollbackDetected) {
      try {
        this.#onRollbackDetected({
          lastKnownCloudTime,
          currentWallTime,
          driftSeconds,
        });
      } catch {
        // Never allow callback error to suppress lock state
      }
    }
  }

  /**
   * Synchronizes authenticated cloud time Tcloud and marks monotonic baseline M0.
   */
  public syncCloudTime(tCloudSeconds: number): void {
    const currentWallTime = Math.floor(Date.now() / 1000);
    const rollbackThresholdSeconds = 300; // 5 minutes

    if (this.#tCloud !== null) {
      const currentEffective = this.getTrustedEffectiveTime();
      if (tCloudSeconds < currentEffective - rollbackThresholdSeconds) {
        const drift = currentEffective - tCloudSeconds;
        this.#triggerRollbackLock(
          `Clock rollback detected during sync: new cloud time (${tCloudSeconds}) is ${drift}s behind active trusted time (${currentEffective})`,
          currentEffective,
          tCloudSeconds,
          drift,
        );
        throw new ClockRollbackLockError(this.#lockReason!);
      }
    }

    this.#tCloud = tCloudSeconds;
    this.#m0 = process.hrtime.bigint();
    this.#isLocked = false;
    this.#lockReason = null;

    // Persist anchor in SQLite WAL
    const existing = this.#db
      .prepare('SELECT anchor_version FROM trusted_time_anchors WHERE id = 1')
      .get() as { anchor_version: number } | undefined;

    const nextVersion = (existing?.anchor_version ?? 0) + 1;
    this.#db
      .prepare(
        `
        INSERT INTO trusted_time_anchors (id, last_known_cloud_time, local_wall_time_at_last_cloud_sync, anchor_version, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_known_cloud_time = excluded.last_known_cloud_time,
          local_wall_time_at_last_cloud_sync = excluded.local_wall_time_at_last_cloud_sync,
          anchor_version = excluded.anchor_version,
          updated_at = excluded.updated_at
      `,
      )
      .run(tCloudSeconds, currentWallTime, nextVersion, currentWallTime);
  }

  /**
   * Returns whether the system is locked due to detected clock rollback.
   */
  public isLocked(): boolean {
    return this.#isLocked;
  }

  /**
   * Returns current trusted effective time in Unix epoch seconds.
   * Throws ClockRollbackLockError if system is locked.
   */
  public getTrustedEffectiveTime(): number {
    if (this.#isLocked) {
      throw new ClockRollbackLockError(
        `Operation blocked: system is CLOCK_ROLLBACK_LOCKED. ${this.#lockReason}`,
      );
    }

    if (this.#tCloud === null || this.#m0 === null) {
      throw new ClockRollbackLockError(
        'Trusted time uninitialized: initial bootstrap requires authenticated cloud time synchronization',
      );
    }

    const elapsedNanoseconds = process.hrtime.bigint() - this.#m0;
    const elapsedSeconds = Number(elapsedNanoseconds / 1_000_000_000n);
    return this.#tCloud + elapsedSeconds;
  }

  /**
   * Retrieves the persisted anchor record if present.
   */
  public getPersistedAnchor(): TrustedTimeAnchorRecord | null {
    const row = this.#db.prepare('SELECT * FROM trusted_time_anchors WHERE id = 1').get() as
      | {
          id: number;
          last_known_cloud_time: number;
          local_wall_time_at_last_cloud_sync: number;
          anchor_version: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      lastKnownCloudTime: row.last_known_cloud_time,
      localWallTimeAtLastCloudSync: row.local_wall_time_at_last_cloud_sync,
      anchorVersion: row.anchor_version,
      updatedAt: row.updated_at,
    };
  }
}
