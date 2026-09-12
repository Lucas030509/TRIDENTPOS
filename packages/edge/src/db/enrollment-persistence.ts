/**
 * TRIDENTPOS Internal Edge Enrollment Persistence Layer
 * Strictly module-internal to @trident/edge (Zero public escape hatch per Gate B).
 * Implements DATA-INV-WP009-01: atomic SQLite WAL enrollment transaction (CAS + credential + audit).
 * Conforms to DATA_MODEL.md Sec. 3, SECURITY_ARCHITECTURE.md Sec. 3.2, and ACR-2026-011.
 */

import type Database from 'better-sqlite3';
import { EdgeDatabaseService } from './edge-database.js';
import { getTestNativeDatabase } from './test-access.js';
import {
  computeCanonicalRecordHash,
  hashSha256,
  redactSensitiveData,
  timingSafeSecretCompare,
} from '../enrollment/crypto.js';
import {
  EdgeSecurityAuditRecord,
  EnrollmentAlreadyConsumedError,
  EnrollmentContextMismatchError,
  EnrollmentError,
  EnrollmentExpiredError,
  EnrollmentSecurityError,
  StationEnrollmentRequest,
} from '../enrollment/types.js';

export interface EnrollmentTokenRow {
  pairing_id: string;
  organization_id: string;
  branch_id: string;
  edge_id: string;
  secret_hash: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface StationCredentialRow {
  station_id: string;
  organization_id: string;
  branch_id: string;
  station_code: string;
  station_type: string;
  station_public_key: string;
  enrolled_at: number;
  is_revoked: number;
  revoked_at: number | null;
}

export class EnrollmentPersistence {
  readonly #edgeDb: EdgeDatabaseService;
  readonly #nativeDb: Database.Database;

  // Test-only fault injection flags to verify atomic rollback obligations
  #simulateCredentialInsertFailure = false;
  #simulateAuditInsertFailure = false;

  constructor(edgeDb: EdgeDatabaseService) {
    this.#edgeDb = edgeDb;
    this.#nativeDb = getTestNativeDatabase(edgeDb);
    this.#initializeSchema();
  }

  /**
   * Test-only fault injection controls.
   */
  public setSimulateCredentialInsertFailure(fail: boolean): void {
    this.#simulateCredentialInsertFailure = fail;
  }

  public setSimulateAuditInsertFailure(fail: boolean): void {
    this.#simulateAuditInsertFailure = fail;
  }

  #initializeSchema(): void {
    this.#nativeDb.exec(`
      -- Ephemeral One-Time Pairing Tokens (WP-009, ACR-2026-011)
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        pairing_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER NULL,
        created_at INTEGER NOT NULL,
        CONSTRAINT chk_enrollment_tokens_consumed CHECK (consumed_at IS NULL OR consumed_at >= created_at)
      );

      CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_lookup ON enrollment_tokens (pairing_id, consumed_at, expires_at);
      CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_tenant_branch ON enrollment_tokens (organization_id, branch_id);

      -- Credenciales Locales de Estación y Autorización de Piso (WP-009, ACR-2026-011)
      -- NOTE: station_token_hash is NOT present per canonical schema.
      CREATE TABLE IF NOT EXISTS station_credentials (
        station_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        station_code TEXT NOT NULL,
        station_type TEXT NOT NULL,
        station_public_key TEXT NOT NULL,
        enrolled_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER NULL,
        CONSTRAINT uq_station_credentials_tenant_branch_code UNIQUE (organization_id, branch_id, station_code),
        CONSTRAINT chk_station_credentials_revoked CHECK (is_revoked IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_station_credentials_auth ON station_credentials (station_id, is_revoked);
      CREATE INDEX IF NOT EXISTS idx_station_credentials_tenant_branch ON station_credentials (organization_id, branch_id);

      -- Bitácora de Auditoría de Seguridad Local (WP-009, ACR-2026-011)
      CREATE TABLE IF NOT EXISTS edge_security_audit (
        event_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        station_id TEXT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        action TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        previous_record_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        CONSTRAINT uq_edge_security_audit_seq UNIQUE (organization_id, branch_id, edge_id, sequence_number),
        CONSTRAINT uq_edge_security_audit_hash UNIQUE (organization_id, record_hash),
        CONSTRAINT chk_edge_security_audit_severity CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL'))
      );

      CREATE INDEX IF NOT EXISTS idx_edge_security_audit_seq ON edge_security_audit (organization_id, branch_id, edge_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_edge_security_audit_lookup ON edge_security_audit (organization_id, branch_id, event_type, created_at);
    `);
  }

  /**
   * Persists an ephemeral pairing token.
   */
  public savePairingToken(token: {
    pairingId: string;
    organizationId: string;
    branchId: string;
    edgeId: string;
    secretHash: string;
    expiresAt: number;
    createdAt: number;
  }): void {
    const stmt = this.#nativeDb.prepare(`
      INSERT INTO enrollment_tokens (pairing_id, organization_id, branch_id, edge_id, secret_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      token.pairingId,
      token.organizationId,
      token.branchId,
      token.edgeId,
      token.secretHash,
      token.expiresAt,
      token.createdAt,
    );
  }

  /**
   * Retrieves a pairing token by ID.
   */
  public getPairingToken(pairingId: string): EnrollmentTokenRow | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT * FROM enrollment_tokens WHERE pairing_id = ?
    `);
    return (stmt.get(pairingId) as EnrollmentTokenRow | undefined) ?? null;
  }

  /**
   * Retrieves station credentials by stationId.
   */
  public getStationCredentials(stationId: string): StationCredentialRow | null {
    const stmt = this.#nativeDb.prepare(`
      SELECT * FROM station_credentials WHERE station_id = ?
    `);
    return (stmt.get(stationId) as StationCredentialRow | undefined) ?? null;
  }

  /**
   * Appends an audit event to edge_security_audit outside of enrollment transaction (e.g. for clock rollback alert).
   */
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

  /**
   * Executes the atomic enrollment transaction (DATA-INV-WP009-01).
   *
   * Invariant: ALL COMMIT OR NONE COMMIT.
   * Inside single transaction:
   * 1. Re-read token by pairing_id
   * 2. Validate tenant / branch / edge context
   * 3. Validate expiration against trusted time
   * 4. Verify pairing secret (constant-time compare)
   * 5. CAS consume token: UPDATE enrollment_tokens SET consumed_at = ? WHERE pairing_id = ? AND consumed_at IS NULL
   * 6. INSERT station_credentials
   * 7. Bind pairing_id -> station_id
   * 8. Append durable local edge_security_audit (TerminalEnrolada / SUCCESS)
   *
   * If any step fails: ROLLBACK. consumed_at remains NULL, no credentials inserted, no token issued.
   */
  public executeAtomicEnrollment(
    request: StationEnrollmentRequest,
    trustedEffectiveTime: number,
    auditEventId: string,
  ): {
    stationCredentials: StationCredentialRow;
    auditRecord: EdgeSecurityAuditRecord;
  } {
    return this.#edgeDb.runInTransaction(
      () => {
        // 1. Re-read enrollment token
        const token = this.#nativeDb
          .prepare('SELECT * FROM enrollment_tokens WHERE pairing_id = ?')
          .get(request.pairingId) as EnrollmentTokenRow | undefined;

        if (!token) {
          throw new EnrollmentSecurityError(`Pairing token '${request.pairingId}' not found`);
        }

        // 2. Validate tenant / branch / edge context
        if (token.organization_id !== request.organizationId) {
          throw new EnrollmentContextMismatchError(
            `Cross-tenant mismatch: token tenant '${token.organization_id}' !== request '${request.organizationId}'`,
          );
        }
        if (token.branch_id !== request.branchId) {
          throw new EnrollmentContextMismatchError(
            `Cross-branch mismatch: token branch '${token.branch_id}' !== request '${request.branchId}'`,
          );
        }
        if (token.edge_id !== request.edgeId) {
          throw new EnrollmentContextMismatchError(
            `Cross-edge mismatch: token edge '${token.edge_id}' !== request '${request.edgeId}'`,
          );
        }

        // 3. Validate expiration
        if (token.expires_at < trustedEffectiveTime) {
          throw new EnrollmentExpiredError(
            `Pairing token expired: expiresAt (${token.expires_at}) < trustedEffectiveTime (${trustedEffectiveTime})`,
          );
        }

        // 4. Validate CAS state
        if (token.consumed_at !== null) {
          throw new EnrollmentAlreadyConsumedError(
            `Pairing token '${request.pairingId}' has already been consumed at ${token.consumed_at}`,
          );
        }

        // 5. Verify pairing secret in constant time
        const calculatedSecretHash = hashSha256(request.pairingSecret);
        if (!timingSafeSecretCompare(token.secret_hash, calculatedSecretHash)) {
          throw new EnrollmentSecurityError('Invalid pairing secret provided');
        }

        // 6. CAS consume token
        const casResult = this.#nativeDb
          .prepare(
            'UPDATE enrollment_tokens SET consumed_at = ? WHERE pairing_id = ? AND consumed_at IS NULL',
          )
          .run(trustedEffectiveTime, request.pairingId);

        if (casResult.changes !== 1) {
          throw new EnrollmentAlreadyConsumedError(
            'Atomic CAS consumption failed: token was concurrently consumed',
          );
        }

        // Fault injection check 1: simulated credential insert failure
        if (this.#simulateCredentialInsertFailure) {
          throw new EnrollmentError(
            'Simulated credential insertion failure for atomic rollback test',
          );
        }

        // 7. Insert station credentials (NO station_token_hash)
        this.#nativeDb
          .prepare(
            `
            INSERT INTO station_credentials (
              station_id, organization_id, branch_id, station_code,
              station_type, station_public_key, enrolled_at, is_revoked, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
          `,
          )
          .run(
            request.stationId,
            request.organizationId,
            request.branchId,
            request.stationCode,
            request.stationType,
            request.stationPublicKey,
            trustedEffectiveTime,
          );

        // Fault injection check 2: simulated audit insert failure
        if (this.#simulateAuditInsertFailure) {
          throw new EnrollmentError('Simulated audit insertion failure for atomic rollback test');
        }

        // 8. Append durable local edge_security_audit (TerminalEnrolada / SUCCESS)
        const auditRecord = this.#appendAuditEventInternal({
          eventId: auditEventId,
          organizationId: request.organizationId,
          branchId: request.branchId,
          edgeId: request.edgeId,
          stationId: request.stationId,
          eventType: 'TerminalEnrolada',
          severity: 'INFO',
          action: 'ENROLLMENT_SUCCESS',
          metadata: {
            pairingId: request.pairingId,
            stationCode: request.stationCode,
            stationType: request.stationType,
          },
          createdAt: trustedEffectiveTime,
        });

        const credentialsRow: StationCredentialRow = {
          station_id: request.stationId,
          organization_id: request.organizationId,
          branch_id: request.branchId,
          station_code: request.stationCode,
          station_type: request.stationType,
          station_public_key: request.stationPublicKey,
          enrolled_at: trustedEffectiveTime,
          is_revoked: 0,
          revoked_at: null,
        };

        return {
          stationCredentials: credentialsRow,
          auditRecord,
        };
      },
      { behavior: 'IMMEDIATE' },
    );
  }
}
