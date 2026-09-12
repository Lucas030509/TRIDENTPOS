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

  it('WP011-R1-T45: ep_2 installed, then replay ep_1 => rejected and ep_2 remains unchanged', () => {
    folioPersistence.setActiveLease({
      folioType: 'FACTURA',
      epochId: 'ep_2',
      fencingToken: 'fencing-token-factura-ep2',
      rangeStart: 5001,
      rangeEnd: 5500,
      currentFolio: 5000,
    });

    const currentBefore = folioPersistence.getLocalLease('FACTURA');
    assert.ok(currentBefore);
    assert.equal(currentBefore.epochId, 'ep_2');

    // Attempt to replay ep_1
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_1',
        fencingToken: 'stale-fencing-token-factura-ep1',
        rangeStart: 4001,
        rangeEnd: 4500,
        currentFolio: 4000,
      });
    }, /stale lease epoch/i);

    const currentAfter = folioPersistence.getLocalLease('FACTURA');
    assert.ok(currentAfter);
    assert.equal(currentAfter.epochId, 'ep_2');
    assert.equal(currentAfter.rangeStart, 5001);
    assert.equal(currentAfter.rangeEnd, 5500);
    assert.equal(currentAfter.fencingToken, 'fencing-token-factura-ep2');
  });

  it('WP011-R1-T46: ep_10 cannot be overwritten by ep_2', () => {
    folioPersistence.setActiveLease({
      folioType: 'FACTURA',
      epochId: 'ep_10',
      fencingToken: 'fencing-token-factura-ep10',
      rangeStart: 6001,
      rangeEnd: 6500,
      currentFolio: 6000,
    });

    // Attempt to install ep_2 (which is lexically > ep_10 but numerically < ep_10)
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_2',
        fencingToken: 'stale-token',
        rangeStart: 5001,
        rangeEnd: 5500,
      });
    }, /stale lease epoch/i);

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.epochId, 'ep_10');
  });

  it('WP011-R1-T47: same epoch + different fencing token rejected', () => {
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_10',
        fencingToken: 'tampered-or-different-token',
        rangeStart: 6001,
        rangeEnd: 6500,
        currentFolio: 6000,
      });
    }, /Conflicting fencing token/i);

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.fencingToken, 'fencing-token-factura-ep10');
  });

  it('WP011-R1-T48: same epoch + conflicting range rejected', () => {
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_10',
        fencingToken: 'fencing-token-factura-ep10',
        rangeStart: 7001,
        rangeEnd: 7500,
        currentFolio: 7000,
      });
    }, /Conflicting range/i);

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.rangeStart, 6001);
  });

  it('WP011-R1-T49: newer epoch accepted transactionally', () => {
    folioPersistence.setActiveLease({
      folioType: 'FACTURA',
      epochId: 'ep_11',
      fencingToken: 'fencing-token-factura-ep11',
      rangeStart: 6501,
      rangeEnd: 7000,
      currentFolio: 6500,
    });

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.epochId, 'ep_11');
    assert.equal(current.rangeStart, 6501);
    assert.equal(current.rangeEnd, 7000);
    assert.equal(current.status, 'ACTIVE');
  });

  it('WP011-R1-T50: invalid currentFolio outside range rejected with zero mutation', () => {
    // currentFolio < rangeStart - 1
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_12',
        fencingToken: 'fencing-token-ep12',
        rangeStart: 7001,
        rangeEnd: 7500,
        currentFolio: 5000,
      });
    }, /outside valid lease bounds/i);

    // currentFolio > rangeEnd
    assert.throws(() => {
      folioPersistence.setActiveLease({
        folioType: 'FACTURA',
        epochId: 'ep_12',
        fencingToken: 'fencing-token-ep12',
        rangeStart: 7001,
        rangeEnd: 7500,
        currentFolio: 7501,
      });
    }, /outside valid lease bounds/i);

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.epochId, 'ep_11');
  });

  it('WP011-R1-T51: currentFolio == range_end persists EXHAUSTED', () => {
    folioPersistence.setActiveLease({
      folioType: 'FACTURA',
      epochId: 'ep_12',
      fencingToken: 'fencing-token-ep12',
      rangeStart: 7001,
      rangeEnd: 7500,
      currentFolio: 7500,
    });

    const current = folioPersistence.getLocalLease('FACTURA');
    assert.ok(current);
    assert.equal(current.epochId, 'ep_12');
    assert.equal(current.currentFolio, 7500);
    assert.equal(current.status, 'EXHAUSTED');
  });
});
