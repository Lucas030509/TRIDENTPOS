/**
 * TRIDENTPOS WP-011 Edge Local Folio Leases Test Suite
 * Conforms to:
 * - DATA_MODEL.md Sec. 3 (local_folio_leases)
 * - SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3 (SQLite WAL durability)
 * - COORDINATOR_PROMPT_WP011_START.md (Tests WP011-T23 through WP011-T26)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EdgeDatabaseService } from './db/edge-database.js';
import {
  FolioPersistence,
  FolioLeaseExhaustedError,
  FolioLeaseRevokedError,
  FolioLeaseUnavailableError,
} from './db/folio-persistence.js';

describe('TRIDENTPOS WP-011 Edge Local Folio Leases & Monotonic Consumption Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let edgeDb: EdgeDatabaseService;
  let folioPersistence: FolioPersistence;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp011-edge-folio-'));
    dbPath = path.join(tempDir, 'trident-edge-folio.db');
    edgeDb = new EdgeDatabaseService({
      databasePath: dbPath,
      defaultDurabilityMode: 'NORMAL',
    });
    folioPersistence = new FolioPersistence(edgeDb);
  });

  after(() => {
    edgeDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('WP011-T23: Edge local_folio_leases persists lease transactionally', () => {
    folioPersistence.setActiveLease({
      folioType: 'TICKET',
      epochId: 'ep_1',
      fencingToken: 'mock-fencing-token-ticket-001',
      rangeStart: 1001,
      rangeEnd: 1500,
      currentFolio: 1000,
    });

    const lease = folioPersistence.getLocalLease('TICKET');
    assert.ok(lease);
    assert.equal(lease.folioType, 'TICKET');
    assert.equal(lease.epochId, 'ep_1');
    assert.equal(lease.fencingToken, 'mock-fencing-token-ticket-001');
    assert.equal(lease.rangeStart, 1001);
    assert.equal(lease.rangeEnd, 1500);
    assert.equal(lease.currentFolio, 1000);
    assert.equal(lease.status, 'ACTIVE');
  });

  it('WP011-T24: Edge local folio consumption is monotonic', () => {
    // Consume 5 folios consecutively
    const folios: number[] = [];
    for (let i = 0; i < 5; i++) {
      const f = folioPersistence.consumeNextFolio('TICKET');
      folios.push(f);
    }

    assert.deepEqual(folios, [1001, 1002, 1003, 1004, 1005]);

    // Check each is strictly greater than the previous
    for (let i = 1; i < folios.length; i++) {
      assert.ok(folios[i]! > folios[i - 1]!);
    }

    const lease = folioPersistence.getLocalLease('TICKET');
    assert.ok(lease);
    assert.equal(lease.currentFolio, 1005);
    assert.equal(lease.status, 'ACTIVE');
  });

  it('WP011-T25: Edge cannot consume beyond range_end', () => {
    // Set a short lease of 3 folios: [2001..2003]
    folioPersistence.setActiveLease({
      folioType: 'CORTE_X',
      epochId: 'ep_1',
      fencingToken: 'mock-fencing-token-corte-x',
      rangeStart: 2001,
      rangeEnd: 2003,
      currentFolio: 2000,
    });

    assert.equal(folioPersistence.consumeNextFolio('CORTE_X'), 2001);
    assert.equal(folioPersistence.consumeNextFolio('CORTE_X'), 2002);
    assert.equal(folioPersistence.consumeNextFolio('CORTE_X'), 2003);

    // 4th consumption MUST fail closed with FolioLeaseExhaustedError
    assert.throws(
      () => {
        folioPersistence.consumeNextFolio('CORTE_X');
      },
      (err: unknown) => {
        return err instanceof FolioLeaseExhaustedError && err.code === 'LEASE_EXHAUSTED';
      },
    );

    const lease = folioPersistence.getLocalLease('CORTE_X');
    assert.ok(lease);
    assert.equal(lease.currentFolio, 2003);
    assert.equal(lease.status, 'EXHAUSTED');
  });

  it('WP011-T26: Edge EXHAUSTED lease cannot issue another folio', () => {
    // Attempting to consume on an already EXHAUSTED lease
    assert.throws(
      () => {
        folioPersistence.consumeNextFolio('CORTE_X');
      },
      (err: unknown) => {
        return err instanceof FolioLeaseExhaustedError && err.code === 'LEASE_EXHAUSTED';
      },
    );

    // Verify it never wraps around to rangeStart, never auto-resets
    const lease = folioPersistence.getLocalLease('CORTE_X');
    assert.ok(lease);
    assert.equal(lease.currentFolio, 2003);
    assert.equal(lease.status, 'EXHAUSTED');
  });

  it('Edge SQLite transaction failure produces no partial folio consumption', () => {
    folioPersistence.setActiveLease({
      folioType: 'CORTE_Z',
      epochId: 'ep_1',
      fencingToken: 'mock-fencing-token-corte-z',
      rangeStart: 3001,
      rangeEnd: 3100,
      currentFolio: 3000,
    });

    const first = folioPersistence.consumeNextFolio('CORTE_Z');
    assert.equal(first, 3001);

    // Inject fault in next consumption
    folioPersistence.setSimulateConsumeFailure(true);
    assert.throws(() => {
      folioPersistence.consumeNextFolio('CORTE_Z');
    }, /Injected fault/);
    folioPersistence.setSimulateConsumeFailure(false);

    // Verify currentFolio remains 3001
    const lease = folioPersistence.getLocalLease('CORTE_Z');
    assert.ok(lease);
    assert.equal(lease.currentFolio, 3001);
  });

  it('Edge revoked lease immediately denies folio consumption', () => {
    folioPersistence.revokeLease('TICKET');

    assert.throws(
      () => {
        folioPersistence.consumeNextFolio('TICKET');
      },
      (err: unknown) => {
        return err instanceof FolioLeaseRevokedError && err.code === 'LEASE_REVOKED';
      },
    );

    const lease = folioPersistence.getLocalLease('TICKET');
    assert.ok(lease);
    assert.equal(lease.status, 'REVOKED');
  });

  it('Edge consumption without configured lease fails closed', () => {
    assert.throws(
      () => {
        folioPersistence.consumeNextFolio('FACTURA');
      },
      (err: unknown) => {
        return err instanceof FolioLeaseUnavailableError && err.code === 'LEASE_UNAVAILABLE';
      },
    );
  });
});
