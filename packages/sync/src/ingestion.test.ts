/**
 * TRIDENTPOS WP-012 Sync Ingestion Router & Pattern B Auth Verification Suite
 * Conforms strictly to:
 * - ADR-006 & Pattern B AuthContext Authority
 * - COORDINATOR_PROMPT_WP012_START.md (WP012-T44, WP012-T45)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AuthContext,
  createCloudReceipt,
  ERROR_CODE_INVALID_REQUEST,
  ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH,
  ERROR_CODE_UNAUTHORIZED_TENANT,
  SyncBatchAckDTO,
  SyncBatchDTO,
} from '@trident/core';
import { SyncIngestionRouter } from './sync-ingestion-router.js';
import { ISyncBatchProcessor } from './types.js';

describe('TRIDENTPOS WP-012 Sync Ingestion Router Suite', () => {
  const verifiedAuth: AuthContext = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    branchId: '22222222-2222-4222-8222-222222222222',
  };

  class MockBatchProcessor implements ISyncBatchProcessor {
    public processedBatches: SyncBatchDTO[] = [];

    async processBatch(auth: AuthContext, batch: SyncBatchDTO): Promise<SyncBatchAckDTO> {
      this.processedBatches.push(batch);
      return {
        batchId: batch.batchId ?? crypto.randomUUID(),
        organizationId: auth.organizationId,
        branchId: auth.branchId,
        results: batch.events.map((e) => ({
          clientOpId: e.clientOpId,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          aggregateSequenceNumber: e.aggregateSequenceNumber,
          status: 'APPLIED',
          receipt: createCloudReceipt(
            `receipt_${e.clientOpId}`,
            `sig_${e.clientOpId}`,
            e.clientOpId,
            e.aggregateSequenceNumber,
          ),
        })),
      };
    }
  }

  it('WP012-T44: Malformed SyncBatchDTO fails closed before mutation', async () => {
    const processor = new MockBatchProcessor();
    const router = new SyncIngestionRouter(processor);

    // 1. Missing batchId
    const res1 = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [],
      }),
      verifiedAuth,
    );
    assert.equal(res1.status, 400);
    const body1 = JSON.parse(res1.body);
    assert.equal(body1.error, ERROR_CODE_INVALID_REQUEST);

    // 2. Malformed non-UUID batchId
    const res2 = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: 'not-a-uuid',
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: '1',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 1,
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(res2.status, 400);
    const body2 = JSON.parse(res2.body);
    assert.equal(body2.error, ERROR_CODE_INVALID_REQUEST);

    // 3. Empty events array
    const res3 = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [],
      }),
      verifiedAuth,
    );
    assert.equal(res3.status, 400);
    const body3 = JSON.parse(res3.body);
    assert.equal(body3.error, ERROR_CODE_INVALID_REQUEST);

    // 4. Malformed clientOpId inside event (non-UUIDv4)
    const res4 = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_1',
            action: 'CREATE',
            clientOpId: 'non-uuid-client-op',
            aggregateSequenceNumber: 1,
            payload: {},
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(res4.status, 400);
    const body4 = JSON.parse(res4.body);
    assert.equal(body4.error, ERROR_CODE_INVALID_REQUEST);

    // 5. Invalid aggregateSequenceNumber (< 1 or non-integer)
    const res5 = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_1',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 0, // invalid sequence < 1
            payload: {},
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(res5.status, 400);
    const body5 = JSON.parse(res5.body);
    assert.equal(body5.error, ERROR_CODE_INVALID_REQUEST);

    // Verify processor received ZERO mutations
    assert.equal(
      processor.processedBatches.length,
      0,
      'Zero mutations executed on malformed payload',
    );
  });

  it('WP012-T45: Untrusted tenant/branch fields cannot override verified AuthContext', async () => {
    const processor = new MockBatchProcessor();
    const router = new SyncIngestionRouter(processor);

    // Attacker sends payload with spoofed organizationId / branchId
    const spoofedOrgId = '99999999-9999-4999-8999-999999999999';
    const spoofedBranchId = '88888888-8888-4888-8888-888888888888';

    // 1. Batch header spoofed orgId
    const resOrg = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: spoofedOrgId,
        branchId: verifiedAuth.branchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_spoof',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 1,
            payload: {},
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(resOrg.status, 403, 'Must reject tenant mismatch with 403');
    const bodyOrg = JSON.parse(resOrg.body);
    assert.equal(bodyOrg.error, ERROR_CODE_UNAUTHORIZED_TENANT);

    // 2. Batch header spoofed branchId
    const resBranch = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: verifiedAuth.organizationId,
        branchId: spoofedBranchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_spoof2',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 1,
            payload: {},
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(resBranch.status, 403, 'Must reject branch mismatch with 403');
    const bodyBranch = JSON.parse(resBranch.body);
    assert.equal(bodyBranch.error, ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH);

    // 3. Event-level spoofed orgId
    const resEventOrg = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        organizationId: verifiedAuth.organizationId,
        branchId: verifiedAuth.branchId,
        events: [
          {
            organizationId: spoofedOrgId,
            aggregateType: 'ORDER',
            aggregateId: 'ord_spoof3',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 1,
            payload: {},
          },
        ],
      }),
      verifiedAuth,
    );
    assert.equal(resEventOrg.status, 403);

    // 4. Missing AuthContext returns 401
    const resNoAuth = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId: crypto.randomUUID(),
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_no_auth',
            action: 'CREATE',
            clientOpId: crypto.randomUUID(),
            aggregateSequenceNumber: 1,
            payload: {},
          },
        ],
      }),
      undefined, // Missing auth
    );
    assert.equal(resNoAuth.status, 401);

    // Zero batches processed!
    assert.equal(processor.processedBatches.length, 0);
  });

  it('Valid SyncBatchDTO dispatches successfully using verified authority', async () => {
    const processor = new MockBatchProcessor();
    const router = new SyncIngestionRouter(processor);
    const batchId = crypto.randomUUID();
    const clientOpId = crypto.randomUUID();

    const res = await router.handleRequest(
      'POST',
      '/api/v1/sync/batches',
      JSON.stringify({
        batchId,
        events: [
          {
            aggregateType: 'ORDER',
            aggregateId: 'ord_valid_1',
            action: 'CREATE',
            clientOpId,
            aggregateSequenceNumber: 1,
            payload: { items: ['Item 1'] },
          },
        ],
      }),
      verifiedAuth,
    );

    assert.equal(res.status, 200);
    const ack: SyncBatchAckDTO = JSON.parse(res.body);
    assert.equal(ack.batchId, batchId);
    assert.equal(ack.organizationId, verifiedAuth.organizationId);
    assert.equal(ack.branchId, verifiedAuth.branchId);
    assert.equal(ack.results.length, 1);
    const firstResult = ack.results[0];
    assert.ok(firstResult);
    assert.equal(firstResult.status, 'APPLIED');
    assert.equal(firstResult.clientOpId, clientOpId);
    assert.ok(firstResult.receipt);
  });
});
