/**
 * TRIDENTPOS Cloud Folio Lease Allocation & Fencing Protocol Engine
 * Strictly conforms to:
 * - DATA_MODEL.md Sec. 2.1 (folio_leases)
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1 (REM-01)
 * - ADR-002 (Cloud authoritative allocator, Edge operational consumer)
 * - ADR-008 (Disaster recovery, contingency range abandonment, zombie fencing)
 * - COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md (Approved Policies 1-5)
 */

import crypto from 'node:crypto';
import type pg from 'pg';
import {
  CloudFolioLeaseStatus,
  DEFAULT_BLOCK_SIZE,
  ERROR_CODE_FOLIO_OUT_OF_RANGE,
  ERROR_CODE_HIGH_WATER_REGRESSION,
  ERROR_CODE_INVALID_BLOCK_SIZE,
  ERROR_CODE_INVALID_FENCING_TOKEN,
  ERROR_CODE_INVALID_FOLIO_TYPE,
  ERROR_CODE_LEASE_NOT_FOUND,
  ERROR_CODE_LEASE_REVOKED,
  FolioType,
  GREENFIELD_INITIAL_RANGE_START,
  MAX_BLOCK_SIZE,
  MIN_BLOCK_SIZE,
  compareEpochs,
  formatEpochId,
  isValidFolioType,
  parseEpochNumber,
} from '@trident/core';
import { setTenantContext } from './tenant.js';

export interface FolioLeaseRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly highWaterMark: number;
  readonly status: CloudFolioLeaseStatus;
  readonly allocatedAt: Date;
  readonly revokedAt: Date | null;
  readonly abandonedAt: Date | null;
  readonly reconciledAt: Date | null;
}

export interface AllocateLeaseOptions {
  readonly organizationId: string;
  readonly branchId: string;
  readonly folioType: FolioType;
  readonly requestedBlockSize?: number;
  readonly isDisasterRecoveryReplacement?: boolean;
}

export interface HeartbeatLeaseOptions {
  readonly organizationId: string;
  readonly branchId: string;
  readonly leaseId: string;
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly currentFolio: number;
}

export interface HeartbeatAckResult {
  readonly status: 'ACK';
  readonly leaseId: string;
  readonly highWaterMark: number;
  readonly activeEpoch: string;
}

// ---------------------------------------------------------------------------
// Error Classes with Canonical Codes and HTTP Statuses
// ---------------------------------------------------------------------------

export class FolioLeaseError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus = 400) {
    super(message);
    this.name = 'FolioLeaseError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class LeaseRevokedError extends FolioLeaseError {
  readonly activeEpoch?: string;

  constructor(message: string, activeEpoch?: string) {
    super(message, ERROR_CODE_LEASE_REVOKED, 403);
    this.name = 'LeaseRevokedError';
    this.activeEpoch = activeEpoch;
  }
}

export class InvalidBlockSizeError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_INVALID_BLOCK_SIZE, 400);
    this.name = 'InvalidBlockSizeError';
  }
}

export class InvalidFolioTypeError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_INVALID_FOLIO_TYPE, 400);
    this.name = 'InvalidFolioTypeError';
  }
}

export class FolioOutOfRangeError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_FOLIO_OUT_OF_RANGE, 400);
    this.name = 'FolioOutOfRangeError';
  }
}

export class HighWaterRegressionError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_HIGH_WATER_REGRESSION, 400);
    this.name = 'HighWaterRegressionError';
  }
}

export class InvalidFencingTokenError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_INVALID_FENCING_TOKEN, 403);
    this.name = 'InvalidFencingTokenError';
  }
}

export class LeaseNotFoundError extends FolioLeaseError {
  constructor(message: string) {
    super(message, ERROR_CODE_LEASE_NOT_FOUND, 404);
    this.name = 'LeaseNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Cryptographic Timing-Safe Comparison
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Cloud Lease Manager Engine
// ---------------------------------------------------------------------------

export class CloudLeaseManager {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Allocates an authoritative, non-overlapping folio lease range.
   * Concurrency Control: PostgreSQL transactional serialization via pg_advisory_xact_lock.
   * Greenfield Policy: Initial range_start = 1, subsequent range_start = MAX(range_end) + 1.
   * Zero Recycling: All historical ranges are retained and never re-allocated.
   * Fencing Token: Cryptographically secure 256-bit random hex token.
   */
  public async allocateLease(
    options: AllocateLeaseOptions,
    clientOverride?: pg.PoolClient,
  ): Promise<FolioLeaseRecord> {
    // 1. Validate Folio Type
    if (!isValidFolioType(options.folioType)) {
      throw new InvalidFolioTypeError(
        `Invalid folio type '${String(options.folioType)}'. Allowed: TICKET, CORTE_X, CORTE_Z, FACTURA`,
      );
    }

    // 2. Validate Block Size (Governed Policy 1: No clamping)
    let blockSize = DEFAULT_BLOCK_SIZE;
    if (options.requestedBlockSize !== undefined) {
      if (
        typeof options.requestedBlockSize !== 'number' ||
        !Number.isInteger(options.requestedBlockSize) ||
        options.requestedBlockSize < MIN_BLOCK_SIZE ||
        options.requestedBlockSize > MAX_BLOCK_SIZE
      ) {
        throw new InvalidBlockSizeError(
          `Invalid requestedBlockSize '${String(options.requestedBlockSize)}'. Must be an integer between ${MIN_BLOCK_SIZE} and ${MAX_BLOCK_SIZE}. Clamping is strictly prohibited.`,
        );
      }
      blockSize = options.requestedBlockSize;
    }

    const client = clientOverride ?? (await this.#pool.connect());
    const shouldRelease = !clientOverride;

    try {
      await client.query('BEGIN;');

      // Enforce RLS tenant context
      await setTenantContext(client, options.organizationId);

      // Verify branch belongs to organization
      const branchRes = await client.query<{ id: string }>(
        'SELECT id FROM branches WHERE id = $1 AND organization_id = $2;',
        [options.branchId, options.organizationId],
      );
      if (branchRes.rows.length === 0) {
        throw new FolioLeaseError(
          `Branch '${options.branchId}' does not exist or does not belong to organization '${options.organizationId}'`,
          'UNAUTHORIZED_BRANCH',
          403,
        );
      }

      // 3. Concurrency Lock: PostgreSQL Transaction Advisory Lock
      // Scoped deterministically to (organization_id, branch_id, folio_type).
      // Automatically released when transaction ends (COMMIT or ROLLBACK).
      const lockKey = `folio_lease:${options.organizationId}:${options.branchId}:${options.folioType}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1));', [lockKey]);

      // 4. Query All Historical Leases for this branch and folio_type
      // NO recycling: MAX(range_end) spans ALL statuses (ALLOCATED, ACTIVE, EXHAUSTED, REVOKED, ABANDONED_CONTINGENCY_RANGE, RECONCILED)
      const historicalRes = await client.query<{
        id: string;
        range_end: string;
        epoch_id: string;
        status: CloudFolioLeaseStatus;
      }>(
        `
        SELECT id, range_end, epoch_id, status
        FROM folio_leases
        WHERE organization_id = $1 AND branch_id = $2 AND folio_type = $3
        ORDER BY range_end DESC;
      `,
        [options.organizationId, options.branchId, options.folioType],
      );

      let rangeStart: number;
      let nextEpoch: string;

      if (historicalRes.rows.length === 0) {
        // Greenfield allocation
        rangeStart = GREENFIELD_INITIAL_RANGE_START;
        nextEpoch = 'ep_1';
      } else {
        // Find maximum range_end across all historical leases
        let maxRangeEnd = 0;
        let maxEpochNumber = 0;

        for (const row of historicalRes.rows) {
          const rEnd = Number(row.range_end);
          if (rEnd > maxRangeEnd) {
            maxRangeEnd = rEnd;
          }
          const epNum = parseEpochNumber(row.epoch_id);
          if (epNum > maxEpochNumber) {
            maxEpochNumber = epNum;
          }
        }

        // Monotonic range advancement strictly beyond all prior ranges
        rangeStart = maxRangeEnd + 1;
        nextEpoch = formatEpochId(maxEpochNumber + 1);

        // Handle active leases of prior generation
        for (const row of historicalRes.rows) {
          if (row.status === 'ACTIVE' || row.status === 'ALLOCATED') {
            if (options.isDisasterRecoveryReplacement) {
              await client.query(
                `UPDATE folio_leases
                 SET status = 'ABANDONED_CONTINGENCY_RANGE', abandoned_at = NOW()
                 WHERE id = $1;`,
                [row.id],
              );
            } else {
              await client.query(
                `UPDATE folio_leases
                 SET status = 'REVOKED', revoked_at = NOW()
                 WHERE id = $1;`,
                [row.id],
              );
            }
          }
        }
      }

      const rangeEnd = rangeStart + blockSize - 1;
      const initialHighWaterMark = rangeStart - 1;
      const fencingToken = crypto.randomBytes(32).toString('hex');

      // 5. Durably Persist the Lease Record
      const insertRes = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        folio_type: FolioType;
        epoch_id: string;
        fencing_token: string;
        range_start: string;
        range_end: string;
        high_water_mark: string;
        status: CloudFolioLeaseStatus;
        allocated_at: Date;
        revoked_at: Date | null;
        abandoned_at: Date | null;
        reconciled_at: Date | null;
      }>(
        `
        INSERT INTO folio_leases (
          organization_id, branch_id, folio_type, epoch_id, fencing_token,
          range_start, range_end, high_water_mark, status, allocated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', NOW()
        ) RETURNING *;
      `,
        [
          options.organizationId,
          options.branchId,
          options.folioType,
          nextEpoch,
          fencingToken,
          rangeStart,
          rangeEnd,
          initialHighWaterMark,
        ],
      );

      await client.query('COMMIT;');

      const row = insertRes.rows[0]!;
      return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        folioType: row.folio_type,
        epochId: row.epoch_id,
        fencingToken: row.fencing_token,
        rangeStart: Number(row.range_start),
        rangeEnd: Number(row.range_end),
        highWaterMark: Number(row.high_water_mark),
        status: row.status,
        allocatedAt: row.allocated_at,
        revokedAt: row.revoked_at,
        abandonedAt: row.abandoned_at,
        reconciledAt: row.reconciled_at,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // ignore rollback failure
      }
      throw err;
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Heartbeat endpoint logic per POST /api/v1/sync/leases/heartbeat.
   * Fences stale / zombie nodes (HTTP 403 LEASE_REVOKED) with zero Cloud mutation.
   * Updates high_water_mark monotonically if and only if epoch and fencing token match active lease.
   */
  public async heartbeat(
    options: HeartbeatLeaseOptions,
    clientOverride?: pg.PoolClient,
  ): Promise<HeartbeatAckResult> {
    if (!isValidFolioType(options.folioType)) {
      throw new InvalidFolioTypeError(`Invalid folio type '${String(options.folioType)}'`);
    }

    const client = clientOverride ?? (await this.#pool.connect());
    const shouldRelease = !clientOverride;

    try {
      await client.query('BEGIN;');

      // Enforce tenant context
      await setTenantContext(client, options.organizationId);

      // Advisory xact lock to serialize heartbeat and allocation updates
      const lockKey = `folio_lease:${options.organizationId}:${options.branchId}:${options.folioType}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1));', [lockKey]);

      // Query latest authoritative lease for this branch and folio_type
      const latestRes = await client.query<{
        id: string;
        epoch_id: string;
        fencing_token: string;
        range_start: string;
        range_end: string;
        high_water_mark: string;
        status: CloudFolioLeaseStatus;
      }>(
        `
        SELECT id, epoch_id, fencing_token, range_start, range_end, high_water_mark, status
        FROM folio_leases
        WHERE organization_id = $1 AND branch_id = $2 AND folio_type = $3
        ORDER BY range_end DESC
        LIMIT 1;
      `,
        [options.organizationId, options.branchId, options.folioType],
      );

      if (latestRes.rows.length === 0) {
        throw new LeaseNotFoundError(
          `No folio lease found for organization '${options.organizationId}', branch '${options.branchId}', folio type '${options.folioType}'.`,
        );
      }

      const activeLease = latestRes.rows[0]!;

      // 1. Monotonic Epoch Check — Zombie Node Fencing
      const epochComparison = compareEpochs(options.epochId, activeLease.epoch_id);
      if (epochComparison < 0) {
        // Incoming epoch is older than currently active epoch -> STALE / ZOMBIE NODE.
        // FAIL CLOSED: Zero mutation, exact HTTP 403, error code LEASE_REVOKED.
        throw new LeaseRevokedError(
          `Lease epoch '${options.epochId}' has been revoked. Authoritative active epoch is '${activeLease.epoch_id}'.`,
          activeLease.epoch_id,
        );
      }

      if (epochComparison > 0) {
        throw new FolioLeaseError(
          `Incoming epoch '${options.epochId}' exceeds authoritative active epoch '${activeLease.epoch_id}'.`,
          'INVALID_EPOCH',
          400,
        );
      }

      // 2. Fencing Token Cryptographic Check
      if (!timingSafeEqual(options.fencingToken, activeLease.fencing_token)) {
        throw new InvalidFencingTokenError(
          `Fencing token mismatch for lease '${activeLease.id}'. Authentication failed.`,
        );
      }

      // 3. Range Upper Bound Check
      const rangeStart = Number(activeLease.range_start);
      const rangeEnd = Number(activeLease.range_end);
      if (options.currentFolio < rangeStart - 1 || options.currentFolio > rangeEnd) {
        throw new FolioOutOfRangeError(
          `currentFolio ${options.currentFolio} is outside authoritative range [${rangeStart}, ${rangeEnd}]`,
        );
      }

      // 4. Monotonic High-Water Mark Progression
      const currentDbHwm = Number(activeLease.high_water_mark);
      if (options.currentFolio < currentDbHwm) {
        throw new HighWaterRegressionError(
          `currentFolio ${options.currentFolio} regresses prior high-water mark ${currentDbHwm}. Monotonic progression violation.`,
        );
      }

      // 5. Active Lease Status Check
      if (
        activeLease.status === 'REVOKED' ||
        activeLease.status === 'ABANDONED_CONTINGENCY_RANGE'
      ) {
        throw new LeaseRevokedError(
          `Lease '${activeLease.id}' is in status '${activeLease.status}' and cannot accept heartbeats.`,
          activeLease.epoch_id,
        );
      }

      // 6. Transactional State Update
      const newStatus: CloudFolioLeaseStatus =
        options.currentFolio === rangeEnd ? 'EXHAUSTED' : 'ACTIVE';

      await client.query(
        `UPDATE folio_leases
         SET high_water_mark = $1, status = $2
         WHERE id = $3;`,
        [options.currentFolio, newStatus, activeLease.id],
      );

      await client.query('COMMIT;');

      return {
        status: 'ACK',
        leaseId: activeLease.id,
        highWaterMark: options.currentFolio,
        activeEpoch: activeLease.epoch_id,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Retrieves the current authoritative lease for (organizationId, branchId, folioType).
   */
  public async getAuthoritativeLease(
    organizationId: string,
    branchId: string,
    folioType: FolioType,
    clientOverride?: pg.PoolClient,
  ): Promise<FolioLeaseRecord | null> {
    const client = clientOverride ?? (await this.#pool.connect());
    const shouldRelease = !clientOverride;

    try {
      await setTenantContext(client, organizationId);

      const res = await client.query<{
        id: string;
        organization_id: string;
        branch_id: string;
        folio_type: FolioType;
        epoch_id: string;
        fencing_token: string;
        range_start: string;
        range_end: string;
        high_water_mark: string;
        status: CloudFolioLeaseStatus;
        allocated_at: Date;
        revoked_at: Date | null;
        abandoned_at: Date | null;
        reconciled_at: Date | null;
      }>(
        `
        SELECT id, organization_id, branch_id, folio_type, epoch_id, fencing_token,
               range_start, range_end, high_water_mark, status, allocated_at, revoked_at,
               abandoned_at, reconciled_at
        FROM folio_leases
        WHERE organization_id = $1 AND branch_id = $2 AND folio_type = $3
        ORDER BY range_end DESC
        LIMIT 1;
      `,
        [organizationId, branchId, folioType],
      );

      if (res.rows.length === 0) return null;

      const row = res.rows[0]!;
      return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        folioType: row.folio_type,
        epochId: row.epoch_id,
        fencingToken: row.fencing_token,
        rangeStart: Number(row.range_start),
        rangeEnd: Number(row.range_end),
        highWaterMark: Number(row.high_water_mark),
        status: row.status,
        allocatedAt: row.allocated_at,
        revokedAt: row.revoked_at,
        abandonedAt: row.abandoned_at,
        reconciledAt: row.reconciled_at,
      };
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }
}
