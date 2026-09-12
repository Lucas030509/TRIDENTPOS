/**
 * TRIDENTPOS Local Brute-Force Rate Limiter & Lockout Manager
 * Conforms to IAM_SECURITY_MODEL.md Sec. 3.
 *
 * Requirements:
 * - Progressive artificial delays:
 *   - Attempts 1 & 2: 0ms
 *   - Attempt 3: 2,000ms delay
 *   - Attempt 4: 5,000ms delay
 * - Temporary Station Lockout:
 *   - Attempt 5+: STATION_LOCKED for 300 seconds (5 minutes).
 *   - Triggers PinBruteForceAttemptDetected audit event.
 *   - Lock status survives process restart via SQLite persistence.
 *   - Early unlock requires supervisor authorization.
 */

import { IamPersistence } from '../db/iam-persistence.js';
import { StationLockoutStateRecord } from './types.js';

export const LOCKOUT_POLICY = {
  FAILURE_THRESHOLD: 5,
  LOCKOUT_DURATION_SECONDS: 300, // 5 minutes
  PROGRESSIVE_DELAY_ATTEMPT_3_MS: 2000,
  PROGRESSIVE_DELAY_ATTEMPT_4_MS: 5000,
} as const;

export interface FailureEvaluation {
  readonly consecutiveFailures: number;
  readonly isLocked: boolean;
  readonly lockedUntil: number | null;
  readonly remainingSeconds: number;
  readonly delayMs: number;
  readonly isNewLockout: boolean;
}

export class LockoutManager {
  readonly #persistence: IamPersistence;

  constructor(persistence: IamPersistence) {
    this.#persistence = persistence;
  }

  /**
   * Checks whether a station is currently locked.
   * Compares persisted lockedUntil against trustedEffectiveTime.
   */
  public checkLockout(
    stationId: string,
    currentEffectiveTime: number,
  ): { isLocked: boolean; remainingSeconds: number } {
    const state = this.#persistence.getLockoutState(stationId);
    if (!state || state.lockedUntil === null) {
      return { isLocked: false, remainingSeconds: 0 };
    }

    if (currentEffectiveTime < state.lockedUntil) {
      const remainingSeconds = state.lockedUntil - currentEffectiveTime;
      return { isLocked: true, remainingSeconds };
    }

    // Natural expiration reached: lock has expired
    return { isLocked: false, remainingSeconds: 0 };
  }

  /**
   * Records a failed authentication attempt atomically.
   * Determines progressive delay and triggers temporary lockout if threshold is reached.
   */
  public recordFailure(stationId: string, currentEffectiveTime: number): FailureEvaluation {
    const currentState = this.#persistence.getLockoutState(stationId);
    const prevFailures = currentState?.consecutiveFailures ?? 0;
    const newFailures = prevFailures + 1;

    let lockedUntil: number | null = currentState?.lockedUntil ?? null;
    let isNewLockout = false;

    // Check if lockout threshold reached
    if (newFailures >= LOCKOUT_POLICY.FAILURE_THRESHOLD) {
      // If not already locked or lock is in the past, set new lock
      if (!lockedUntil || lockedUntil <= currentEffectiveTime) {
        lockedUntil = currentEffectiveTime + LOCKOUT_POLICY.LOCKOUT_DURATION_SECONDS;
        isNewLockout = true;
      }
    }

    const updated = this.#persistence.recordFailedAttempt(
      stationId,
      currentEffectiveTime,
      lockedUntil,
    );

    // Progressive delay calculation
    let delayMs = 0;
    if (newFailures === 3) {
      delayMs = LOCKOUT_POLICY.PROGRESSIVE_DELAY_ATTEMPT_3_MS;
    } else if (newFailures >= 4) {
      delayMs = LOCKOUT_POLICY.PROGRESSIVE_DELAY_ATTEMPT_4_MS;
    }

    const isLocked = updated.lockedUntil !== null && updated.lockedUntil > currentEffectiveTime;
    const remainingSeconds = isLocked ? updated.lockedUntil! - currentEffectiveTime : 0;

    return {
      consecutiveFailures: updated.consecutiveFailures,
      isLocked,
      lockedUntil: updated.lockedUntil,
      remainingSeconds,
      delayMs,
      isNewLockout,
    };
  }

  /**
   * Resets lockout counters upon successful authentication.
   */
  public recordSuccess(stationId: string, currentEffectiveTime: number): void {
    this.#persistence.resetLockoutState(stationId, currentEffectiveTime);
  }

  /**
   * Supervisor unlock override. Clears lockout and failure count.
   */
  public unlock(stationId: string, currentEffectiveTime: number): void {
    this.#persistence.resetLockoutState(stationId, currentEffectiveTime);
  }

  /**
   * Retrieves current lockout state from SQLite.
   */
  public getLockoutState(stationId: string): StationLockoutStateRecord | null {
    return this.#persistence.getLockoutState(stationId);
  }
}
