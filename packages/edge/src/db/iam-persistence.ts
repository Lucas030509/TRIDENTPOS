/**
 * TRIDENTPOS Internal Edge IAM Persistence Layer
 * Strictly module-internal to @trident/edge.
 * Manages SQLite persistence for CachedUsers, StationSessions, and StationLockoutState.
 * Conforms to DATA_MODEL.md Sec. 3, IAM_SECURITY_MODEL.md Sec. 3, 4, and WP-010.
 */

import type Database from 'better-sqlite3';
import { EdgeDatabaseService } from './edge-database.js';
import { getTestNativeDatabase } from './test-access.js';
import { computeCanonicalRecordHash, redactSensitiveData } from '../enrollment/crypto.js';
import {
  CachedUserInput,
  CachedUserRecord,
  StationLockoutStateRecord,
  StationSessionRecord,
} from '../iam/types.js';
import { EdgeSecurityAuditRecord } from '../enrollment/types.js';

export interface StationCredentialInfo {
  readonly stationId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly stationCode: string;
  readonly stationType: string;
  readonly isRevoked: number;
}

export class IamPersistence {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #nativeDb: Database.Database;

  // Test-only fault injection flags for atomic transaction verification
  #simulateSessionInsertFailure = false;
  #simulateAuditInsertFailure = false;

  constructor(edgeDb: EdgeDatabaseService) {
    this.#edgeDb = edgeDb;
    this.#nativeDb = getTestNativeDatabase(edgeDb);
    this.#initializeSchema();
  }

  public setSimulateSessionInsertFailure(fail: boolean): void {
    this.#simulateSessionInsertFailure = fail;
  }

  public setSimulateAuditInsertFailure(fail: boolean): void {
    this.#simulateAuditInsertFailure = fail;
  }

  #initializeSchema(): void {
    this.#nativeDb.exec(`
      -- Cached Identity Store (Argon2id Hashes) (DATA_MODEL.md, IAM_SECURITY_MODEL.md)
      CREATE TABLE IF NOT EXISTS cached_users (
        user_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        roles_json TEXT NOT NULL,
        credential_version INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT chk_cached_users_revoked CHECK (is_revoked IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_cached_users_org ON cached_users (organization_id);
      CREATE INDEX IF NOT EXISTS idx_cached_users_revoked ON cached_users (is_revoked);

      -- Ephemeral Station Sessions (WP-010, IAM_SECURITY_MODEL.md Sec. 4)
      CREATE TABLE IF NOT EXISTS station_sessions (
        session_id TEXT PRIMARY KEY,
        session_token_hash TEXT NOT NULL,
        station_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        roles_json TEXT NOT NULL,
        active_role TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER NULL,
        created_at INTEGER NOT NULL,
        CONSTRAINT uq_station_sessions_token_hash UNIQUE (session_token_hash),
        CONSTRAINT chk_station_sessions_revoked CHECK (is_revoked IN (0, 1)),
        CONSTRAINT chk_station_sessions_time CHECK (expires_at > issued_at)
      );

      CREATE INDEX IF NOT EXISTS idx_station_sessions_station ON station_sessions (station_id, is_revoked, expires_at);
      CREATE INDEX IF NOT EXISTS idx_station_sessions_user ON station_sessions (user_id, is_revoked);

      -- Local Brute-Force Rate Limiter & Lockout Persistence (IAM_SECURITY_MODEL.md Sec. 3)
      CREATE TABLE IF NOT EXISTS station_lockout_state (
        station_id TEXT PRIMARY KEY,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NULL,
        last_failed_at INTEGER NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // -------------------------------------------------------------------------
  // Cached Users CRUD
  // -------------------------------------------------------------------------

  public upsertCachedUser(input: CachedUserInput): void {
    const rolesJson = JSON.stringify(input.roles);
    const issuedAtStr = String(input.issuedAt);
    const expiresAtStr = String(input.expiresAt);
    const isRevoked = input.isRevoked ?? 0;

    const stmt = this.#nativeDb.prepare(`
      INSERT INTO cached_users (
        user_id, organization_id, full_name, pin_hash, roles_json,
        credential_version, issued_at, expires_at, is_revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        organization_id = excluded.organization_id,
        full_name = excluded.full_name,
        pin_hash = excluded.pin_hash,
        roles_json = excluded.roles_json,
        credential_version = excluded.credential_version,
        issued_at = excluded.issued_at,
        expires_at = excluded.expires_at,
        is_revoked = excluded.is_revoked
    `);

    stmt.run(
      input.userId,
      input.organizationId,
      input.fullName,
      input.pinHash,
      rolesJson,
      input.credentialVersion,
      issuedAtStr,
      expiresAtStr,
      isRevoked,
    );
  }

  public getCachedUser(userId: string): CachedUserRecord | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT user_id, organization_id, full_name, pin_hash, roles_json,
             credential_version, issued_at, expires_at, is_revoked
      FROM cached_users
      WHERE user_id = ?
    `);
    const row = stmt.get(userId) as
      | {
          user_id: string;
          organization_id: string;
          full_name: string;
          pin_hash: string;
          roles_json: string;
          credential_version: number;
          issued_at: string;
          expires_at: string;
          is_revoked: number;
        }
      | undefined;

    if (!row) return null;
    return {
      userId: row.user_id,
      organizationId: row.organization_id,
      fullName: row.full_name,
      pinHash: row.pin_hash,
      rolesJson: row.roles_json,
      credentialVersion: row.credential_version,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      isRevoked: row.is_revoked,
    };
  }

  public invalidateCachedUser(userId: string): void {
    const stmt = this.#nativeDb.prepare(`
      UPDATE cached_users SET is_revoked = 1 WHERE user_id = ?
    `);
    stmt.run(userId);
  }

  public deleteCachedUser(userId: string): void {
    const stmt = this.#nativeDb.prepare(`
      DELETE FROM cached_users WHERE user_id = ?
    `);
    stmt.run(userId);
  }

  // -------------------------------------------------------------------------
  // Station Verification
  // -------------------------------------------------------------------------

  public getStationCredential(stationId: string): StationCredentialInfo | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT station_id, organization_id, branch_id, station_code, station_type, is_revoked
      FROM station_credentials
      WHERE station_id = ?
    `);
    const row = stmt.get(stationId) as
      | {
          station_id: string;
          organization_id: string;
          branch_id: string;
          station_code: string;
          station_type: string;
          is_revoked: number;
        }
      | undefined;

    if (!row) return null;
    return {
      stationId: row.station_id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
      stationCode: row.station_code,
      stationType: row.station_type,
      isRevoked: row.is_revoked,
    };
  }

  // -------------------------------------------------------------------------
  // Station Lockout CRUD
  // -------------------------------------------------------------------------

  public getLockoutState(stationId: string): StationLockoutStateRecord | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT station_id, consecutive_failures, locked_until, last_failed_at, updated_at
      FROM station_lockout_state
      WHERE station_id = ?
    `);
    const row = stmt.get(stationId) as
      | {
          station_id: string;
          consecutive_failures: number;
          locked_until: number | null;
          last_failed_at: number | null;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      stationId: row.station_id,
      consecutiveFailures: row.consecutive_failures,
      lockedUntil: row.locked_until,
      lastFailedAt: row.last_failed_at,
      updatedAt: row.updated_at,
    };
  }

  public recordFailedAttempt(
    stationId: string,
    now: number,
    lockedUntil: number | null,
  ): StationLockoutStateRecord {
    return this.#edgeDb.runInTransaction(() => {
      const existing = this.getLockoutState(stationId);
      const nextFailures = (existing?.consecutiveFailures ?? 0) + 1;
      const finalLockedUntil = lockedUntil !== null ? lockedUntil : (existing?.lockedUntil ?? null);

      this.#nativeDb
        .prepare(
          `
          INSERT INTO station_lockout_state (station_id, consecutive_failures, locked_until, last_failed_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(station_id) DO UPDATE SET
            consecutive_failures = excluded.consecutive_failures,
            locked_until = excluded.locked_until,
            last_failed_at = excluded.last_failed_at,
            updated_at = excluded.updated_at
        `,
        )
        .run(stationId, nextFailures, finalLockedUntil, now, now);

      return {
        stationId,
        consecutiveFailures: nextFailures,
        lockedUntil: finalLockedUntil,
        lastFailedAt: now,
        updatedAt: now,
      };
    });
  }

  public resetLockoutState(stationId: string, now: number): void {
    this.#nativeDb
      .prepare(
        `
        INSERT INTO station_lockout_state (station_id, consecutive_failures, locked_until, last_failed_at, updated_at)
        VALUES (?, 0, NULL, NULL, ?)
        ON CONFLICT(station_id) DO UPDATE SET
          consecutive_failures = 0,
          locked_until = NULL,
          updated_at = excluded.updated_at
      `,
      )
      .run(stationId, now);
  }

  // -------------------------------------------------------------------------
  // Station Sessions & Atomic Session Commit
  // -------------------------------------------------------------------------

  public createSessionWithAudit(
    session: {
      sessionId: string;
      sessionTokenHash: string;
      stationId: string;
      userId: string;
      organizationId: string;
      branchId: string;
      roles: string[];
      activeRole: string;
      issuedAt: number;
      expiresAt: number;
      createdAt: number;
    },
    auditInput: {
      eventId: string;
      edgeId: string;
      eventType: string;
      severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
      action: string;
      metadata: Record<string, unknown>;
    },
  ): { session: StationSessionRecord; audit: EdgeSecurityAuditRecord } {
    return this.#edgeDb.runInTransaction(() => {
      if (this.#simulateSessionInsertFailure) {
        throw new Error('SIMULATED_SESSION_INSERT_FAILURE');
      }

      const rolesJson = JSON.stringify(session.roles);

      this.#nativeDb
        .prepare(
          `
          INSERT INTO station_sessions (
            session_id, session_token_hash, station_id, user_id,
            organization_id, branch_id, roles_json, active_role,
            issued_at, expires_at, is_revoked, revoked_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
        `,
        )
        .run(
          session.sessionId,
          session.sessionTokenHash,
          session.stationId,
          session.userId,
          session.organizationId,
          session.branchId,
          rolesJson,
          session.activeRole,
          session.issuedAt,
          session.expiresAt,
          session.createdAt,
        );

      if (this.#simulateAuditInsertFailure) {
        throw new Error('SIMULATED_AUDIT_INSERT_FAILURE');
      }

      const audit = this.#appendAuditEventInternal({
        eventId: auditInput.eventId,
        organizationId: session.organizationId,
        branchId: session.branchId,
        edgeId: auditInput.edgeId,
        stationId: session.stationId,
        eventType: auditInput.eventType,
        severity: auditInput.severity,
        action: auditInput.action,
        metadata: auditInput.metadata,
        createdAt: session.createdAt,
      });

      return {
        session: {
          sessionId: session.sessionId,
          sessionTokenHash: session.sessionTokenHash,
          stationId: session.stationId,
          userId: session.userId,
          organizationId: session.organizationId,
          branchId: session.branchId,
          rolesJson,
          activeRole: session.activeRole,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
          isRevoked: 0,
          revokedAt: null,
          createdAt: session.createdAt,
        },
        audit,
      };
    });
  }

  public getStationSession(sessionId: string): StationSessionRecord | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT session_id, session_token_hash, station_id, user_id,
             organization_id, branch_id, roles_json, active_role,
             issued_at, expires_at, is_revoked, revoked_at, created_at
      FROM station_sessions
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId) as
      | {
          session_id: string;
          session_token_hash: string;
          station_id: string;
          user_id: string;
          organization_id: string;
          branch_id: string;
          roles_json: string;
          active_role: string;
          issued_at: number;
          expires_at: number;
          is_revoked: number;
          revoked_at: number | null;
          created_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      sessionTokenHash: row.session_token_hash,
      stationId: row.station_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
      rolesJson: row.roles_json,
      activeRole: row.active_role,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      isRevoked: row.is_revoked,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  }

  public getStationSessionByTokenHash(tokenHash: string): StationSessionRecord | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT session_id, session_token_hash, station_id, user_id,
             organization_id, branch_id, roles_json, active_role,
             issued_at, expires_at, is_revoked, revoked_at, created_at
      FROM station_sessions
      WHERE session_token_hash = ?
    `);
    const row = stmt.get(tokenHash) as
      | {
          session_id: string;
          session_token_hash: string;
          station_id: string;
          user_id: string;
          organization_id: string;
          branch_id: string;
          roles_json: string;
          active_role: string;
          issued_at: number;
          expires_at: number;
          is_revoked: number;
          revoked_at: number | null;
          created_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      sessionTokenHash: row.session_token_hash,
      stationId: row.station_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
      rolesJson: row.roles_json,
      activeRole: row.active_role,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      isRevoked: row.is_revoked,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  }

  public revokeStationSession(sessionId: string, now: number): void {
    const stmt = this.#nativeDb.prepare(`
      UPDATE station_sessions
      SET is_revoked = 1, revoked_at = ?
      WHERE session_id = ?
    `);
    stmt.run(now, sessionId);
  }

  public flushExpiredSessions(now: number): number {
    const stmt = this.#nativeDb.prepare(`
      UPDATE station_sessions
      SET is_revoked = 1, revoked_at = ?
      WHERE expires_at <= ? AND is_revoked = 0
    `);
    const info = stmt.run(now, now);
    return info.changes;
  }

  // -------------------------------------------------------------------------
  // Local Audit Append
  // -------------------------------------------------------------------------

  public appendAuditEvent(auditInput: {
    eventId: string;
    organizationId: string;
    branchId: string;
    edgeId: string;
    stationId?: string | null;
    eventType: string;
    severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    action: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  }): EdgeSecurityAuditRecord {
    return this.#edgeDb.runInTransaction(() => {
      return this.#appendAuditEventInternal(auditInput);
    });
  }

  #appendAuditEventInternal(auditInput: {
    eventId: string;
    organizationId: string;
    branchId: string;
    edgeId: string;
    stationId?: string | null;
    eventType: string;
    severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    action: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  }): EdgeSecurityAuditRecord {
    const seqRow = this.#nativeDb
      .prepare(
        `
        SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
        FROM edge_security_audit
        WHERE organization_id = ? AND branch_id = ? AND edge_id = ?
      `,
      )
      .get(auditInput.organizationId, auditInput.branchId, auditInput.edgeId) as {
      next_seq: number;
    };

    const sequenceNumber = seqRow.next_seq;

    const prevHashRow = this.#nativeDb
      .prepare(
        `
        SELECT record_hash
        FROM edge_security_audit
        WHERE organization_id = ? AND branch_id = ? AND edge_id = ?
        ORDER BY sequence_number DESC
        LIMIT 1
      `,
      )
      .get(auditInput.organizationId, auditInput.branchId, auditInput.edgeId) as
      { record_hash: string } | undefined;

    const previousRecordHash = prevHashRow?.record_hash ?? '0'.repeat(64);

    const sanitizedMeta = redactSensitiveData(auditInput.metadata);
    const metadataJson = JSON.stringify(sanitizedMeta);

    const canonicalPayload = {
      action: auditInput.action,
      branch_id: auditInput.branchId,
      created_at: auditInput.createdAt,
      edge_id: auditInput.edgeId,
      event_id: auditInput.eventId,
      event_type: auditInput.eventType,
      metadata: sanitizedMeta,
      organization_id: auditInput.organizationId,
      previous_record_hash: previousRecordHash,
      sequence_number: sequenceNumber,
      severity: auditInput.severity,
      station_id: auditInput.stationId ?? null,
    };

    const recordHash = computeCanonicalRecordHash(canonicalPayload);

    this.#nativeDb
      .prepare(
        `
        INSERT INTO edge_security_audit (
          event_id, organization_id, branch_id, edge_id, station_id,
          event_type, severity, action, sequence_number, previous_record_hash,
          record_hash, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        auditInput.eventId,
        auditInput.organizationId,
        auditInput.branchId,
        auditInput.edgeId,
        auditInput.stationId ?? null,
        auditInput.eventType,
        auditInput.severity,
        auditInput.action,
        sequenceNumber,
        previousRecordHash,
        recordHash,
        metadataJson,
        auditInput.createdAt,
      );

    return {
      eventId: auditInput.eventId,
      organizationId: auditInput.organizationId,
      branchId: auditInput.branchId,
      edgeId: auditInput.edgeId,
      stationId: auditInput.stationId ?? null,
      eventType: auditInput.eventType,
      severity: auditInput.severity,
      action: auditInput.action,
      sequenceNumber,
      previousRecordHash,
      recordHash,
      metadataJson,
      createdAt: auditInput.createdAt,
    };
  }
}
