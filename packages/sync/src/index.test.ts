/**
 * TRIDENTPOS WP-011 Sync Leases & HTTP Router Test Suite
 * Conforms to:
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3
 * - ADR-002, ADR-008
 * - COORDINATOR_PROMPT_WP011_START.md & COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BLOCK_SIZE,
  ERROR_CODE_FOLIO_OUT_OF_RANGE,
  ERROR_CODE_HIGH_WATER_REGRESSION,
  ERROR_CODE_INVALID_BLOCK_SIZE,
  ERROR_CODE_INVALID_FENCING_TOKEN,
  ERROR_CODE_INVALID_FOLIO_TYPE,
  ERROR_CODE_LEASE_REVOKED,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  compareEpochs,
  formatEpochId,
  isValidEpochId,
  isValidFolioType,
  nextEpochId,
  parseEpochNumber,
} from '@trident/core';
import {
  SyncLeaseRouter,
  ICloudLeaseService,
  getSyncPackageInfo,
  SYNC_PACKAGE_NAME,
  SYNC_PACKAGE_VERSION,
} from './index.js';

describe('TRIDENTPOS WP-011 Domain Contracts & Epoch Monotonicity Suite', () => {
  it('package info returns expected metadata and dependency', () => {
    const info = getSyncPackageInfo();
    assert.equal(info.name, SYNC_PACKAGE_NAME);
    assert.equal(info.version, SYNC_PACKAGE_VERSION);
  });

  it('validates canonical folio types', () => {
    assert.equal(isValidFolioType('TICKET'), true);
    assert.equal(isValidFolioType('CORTE_X'), true);
    assert.equal(isValidFolioType('CORTE_Z'), true);
    assert.equal(isValidFolioType('FACTURA'), true);
    assert.equal(isValidFolioType('OTHER'), false);
    assert.equal(isValidFolioType(''), false);
  });

  it('WP011-T08: parses and validates epochIds with monotonic numeric progression', () => {
    assert.equal(isValidEpochId('ep_1'), true);
    assert.equal(isValidEpochId('ep_2'), true);
    assert.equal(isValidEpochId('ep_10'), true);
    assert.equal(isValidEpochId('ep_999'), true);
    assert.equal(isValidEpochId('ep_0'), false);
    assert.equal(isValidEpochId('epoch_1'), false);
    assert.equal(isValidEpochId('1'), false);

    assert.equal(parseEpochNumber('ep_1'), 1);
    assert.equal(parseEpochNumber('ep_2'), 2);
    assert.equal(parseEpochNumber('ep_10'), 10);
    assert.equal(formatEpochId(1), 'ep_1');
    assert.equal(formatEpochId(10), 'ep_10');
  });

  it('WP011-T09: non-lexical epoch comparison (ep_10 > ep_2)', () => {
    // Under naive string comparison, 'ep_10' < 'ep_2'.
    // Under monotonic numeric comparison, ep_10 MUST be strictly greater than ep_2.
    assert.ok('ep_10' < 'ep_2', 'Lexical comparison is broken (ep_10 < ep_2 in strings)');
    assert.ok(compareEpochs('ep_10', 'ep_2') > 0, 'compareEpochs correctly proves ep_10 > ep_2');
    assert.ok(compareEpochs('ep_2', 'ep_10') < 0, 'compareEpochs correctly proves ep_2 < ep_10');
    assert.equal(compareEpochs('ep_5', 'ep_5'), 0);
  });

  it('WP011-T10: nextEpochId generates monotonic successor', () => {
    assert.equal(nextEpochId(null), 'ep_1');
    assert.equal(nextEpochId(undefined), 'ep_1');
    assert.equal(nextEpochId('ep_1'), 'ep_2');
    assert.equal(nextEpochId('ep_9'), 'ep_10');
    assert.equal(nextEpochId('ep_10'), 'ep_11');
  });
});

describe('TRIDENTPOS WP-011 SyncLeaseRouter HTTP Protocol Suite', () => {
  const mockOrgId = '11111111-1111-1111-1111-111111111111';
  const mockBranchId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const authContext = { organizationId: mockOrgId, branchId: mockBranchId };

  function createMockLeaseService(): ICloudLeaseService {
    return {
      async allocateLease(options) {
        const blockSize = options.requestedBlockSize ?? DEFAULT_BLOCK_SIZE;
        return {
          id: 'mock-lease-uuid-01',
          organizationId: options.organizationId,
          branchId: options.branchId,
          folioType: options.folioType,
          epochId: 'ep_1',
          fencingToken: 'mock-fencing-token-abc',
          rangeStart: 1,
          rangeEnd: blockSize,
          highWaterMark: 0,
          status: 'ACTIVE',
          allocatedAt: new Date('2026-09-12T00:00:00Z'),
          revokedAt: null,
          abandonedAt: null,
          reconciledAt: null,
        };
      },
      async heartbeat(options) {
        if (options.epochId === 'ep_0') {
          const err = new Error('Lease revoked');
          Object.assign(err, {
            code: ERROR_CODE_LEASE_REVOKED,
            httpStatus: 403,
            activeEpoch: 'ep_2',
          });
          throw err;
        }
        if (options.fencingToken !== 'valid-token') {
          const err = new Error('Invalid fencing token');
          Object.assign(err, { code: ERROR_CODE_INVALID_FENCING_TOKEN, httpStatus: 403 });
          throw err;
        }
        if (options.currentFolio > 500) {
          const err = new Error('Folio out of range');
          Object.assign(err, { code: ERROR_CODE_FOLIO_OUT_OF_RANGE, httpStatus: 400 });
          throw err;
        }
        if (options.currentFolio < 10) {
          const err = new Error('High water regression');
          Object.assign(err, { code: ERROR_CODE_HIGH_WATER_REGRESSION, httpStatus: 400 });
          throw err;
        }
        return {
          status: 'ACK',
          leaseId: options.leaseId,
          highWaterMark: options.currentFolio,
          activeEpoch: options.epochId,
        };
      },
    };
  }

  it('rejects lease request without authenticated tenant context with HTTP 401', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'TICKET' }),
      undefined,
    );
    assert.equal(res.status, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_UNAUTHORIZED_TENANT);
  });

  it('rejects lease request with invalid folioType with HTTP 400', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'INVALID_TYPE' }),
      authContext,
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_INVALID_FOLIO_TYPE);
  });

  it('WP011-T27: invalid requestedBlockSize strictly rejected with HTTP 400 without clamping', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());

    // Case 1: < MIN_BLOCK_SIZE (e.g. 5)
    const resSmall = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'TICKET', requestedBlockSize: 5 }),
      authContext,
    );
    assert.equal(resSmall.status, 400);
    const bodySmall = JSON.parse(resSmall.body);
    assert.equal(bodySmall.error, ERROR_CODE_INVALID_BLOCK_SIZE);

    // Case 2: > MAX_BLOCK_SIZE (e.g. 6000)
    const resLarge = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'TICKET', requestedBlockSize: 6000 }),
      authContext,
    );
    assert.equal(resLarge.status, 400);
    const bodyLarge = JSON.parse(resLarge.body);
    assert.equal(bodyLarge.error, ERROR_CODE_INVALID_BLOCK_SIZE);

    // Case 3: Non-integer float (e.g. 100.5)
    const resFloat = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'TICKET', requestedBlockSize: 100.5 }),
      authContext,
    );
    assert.equal(resFloat.status, 400);
    const bodyFloat = JSON.parse(resFloat.body);
    assert.equal(bodyFloat.error, ERROR_CODE_INVALID_BLOCK_SIZE);
  });

  it('allocates lease successfully with default block size (500) and returns HTTP 201', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/request',
      JSON.stringify({ folioType: 'TICKET' }),
      authContext,
    );
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.lease);
    assert.equal(body.lease.rangeStart, 1);
    assert.equal(body.lease.rangeEnd, 500);
    assert.equal(body.lease.epochId, 'ep_1');
  });

  it('WP011-T11: stale epoch in heartbeat returns exact HTTP 403 LEASE_REVOKED with activeEpoch', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/heartbeat',
      JSON.stringify({
        leaseId: 'mock-lease-uuid-01',
        folioType: 'TICKET',
        epochId: 'ep_0',
        fencingToken: 'valid-token',
        currentFolio: 25,
      }),
      authContext,
    );
    assert.equal(res.status, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_LEASE_REVOKED);
    assert.equal(body.activeEpoch, 'ep_2');
  });

  it('heartbeat with invalid fencing token returns HTTP 403', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/heartbeat',
      JSON.stringify({
        leaseId: 'mock-lease-uuid-01',
        folioType: 'TICKET',
        epochId: 'ep_1',
        fencingToken: 'wrong-token',
        currentFolio: 25,
      }),
      authContext,
    );
    assert.equal(res.status, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_INVALID_FENCING_TOKEN);
  });

  it('heartbeat with out-of-range folio returns HTTP 400', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/heartbeat',
      JSON.stringify({
        leaseId: 'mock-lease-uuid-01',
        folioType: 'TICKET',
        epochId: 'ep_1',
        fencingToken: 'valid-token',
        currentFolio: 9999,
      }),
      authContext,
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_FOLIO_OUT_OF_RANGE);
  });

  it('heartbeat with regressing high water mark returns HTTP 400', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/heartbeat',
      JSON.stringify({
        leaseId: 'mock-lease-uuid-01',
        folioType: 'TICKET',
        epochId: 'ep_1',
        fencingToken: 'valid-token',
        currentFolio: 5,
      }),
      authContext,
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, ERROR_CODE_HIGH_WATER_REGRESSION);
  });

  it('valid heartbeat returns HTTP 200 with ACK', async () => {
    const router = new SyncLeaseRouter(createMockLeaseService());
    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/leases/heartbeat',
      JSON.stringify({
        leaseId: 'mock-lease-uuid-01',
        folioType: 'TICKET',
        epochId: 'ep_1',
        fencingToken: 'valid-token',
        currentFolio: 50,
      }),
      authContext,
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ACK');
    assert.equal(body.highWaterMark, 50);
  });
});
