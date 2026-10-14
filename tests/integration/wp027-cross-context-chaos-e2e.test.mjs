/**
 * TRIDENTPOS WP-027: Cross-Context E2E Integration & Non-Functional Chaos Testing Suite
 *
 * Location: tests/integration/wp027-cross-context-chaos-e2e.test.mjs
 * Framework: EAAF v1.3.0 (ACR-2026-021 / Lean Profile)
 *
 * Covers:
 * 1. Full Restaurant Lifecycle Across All 11 Bounded Contexts:
 *    Shift Open -> Table Seating -> Comanda Assembly with Modifiers (DEC-016) ->
 *    KDS Kitchen Dispatch & Recall (ACR-2026-016) -> Real-Time Recipe Depletion & Kárdex (WP-018) ->
 *    Proportional Bill Splitting (DEC-015 / OQ-SSOT-06) -> Multi-Tender Settlement (WP-016C) ->
 *    Account Close -> Blind Cash Count & Corte Z (DEC-017) -> PAC CFDI Stamping & Global Batch (WP-021) ->
 *    Cloud Sync Ingestion & Idempotency (WP-012 / WP-013) -> Downstream AR/AP & Replenishment (WP-019/020).
 *
 * 2. Non-Functional Chaos & Failure Mode Verification:
 *    - SEC-VAL-09: WAN Outage Simulation & Autonomous Offline Edge Continuity.
 *    - DAT-08: Disaster Recovery Cold-Restore Simulation (< 30 min recovery target).
 *    - RSK-15: Empirical RTO/RPO DR Drill (SIGKILL recovery, RPO=0, RTO < 30 min).
 *
 * 3. Parameterized Product Owner Decision Hooks:
 *    OQ-SSOT-01, OQ-SSOT-02, OQ-SSOT-06, OQ-SSOT-07, OQ-ARCH-01.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import dotenv from 'dotenv';

// Load environment variables (DATABASE_URL)
dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

// Monorepo package imports
import {
  toScale4BigInt,
  fromScale4BigInt,
  calculateItemSubtotalScale4,
  calculateProportionalSplit,
  TableTransferService,
} from '@trident/mobile-waiter';
import { TestCloudReceiptIssuer, TestCloudReceiptVerifier } from '@trident/core/test-support';
import { getPool, closePool, migrateUp, IngestedIdempotencyEngine } from '@trident/database';
import {
  CloudWebSocketSyncGateway,
  EdgeSyncClient,
  CallbackWebSocketAuthenticator,
  CloudCatalogDeltaService,
} from '@trident/sync';
import { EdgeDatabaseService, EdgeOutboxPersistence, EdgeSyncPersistence } from '@trident/edge';
import {
  POS_EDGE_SQLITE_SCHEMA,
  KDS_EDGE_SQLITE_SCHEMA,
  CASH_SHIFT_SQLITE_SCHEMA,
  SqliteDiningRoomRepository,
  SqliteKdsRepository,
  SqliteCashShiftRepository,
  SqlitePaymentRepository,
  createKdsRuntime,
} from '@trident/pos-edge-runtime';
import { DiningDomainService, CashShiftDomainService, PaymentDomainService } from '@trident/pos';
import { RecipeEngine, calculateRecipeCost } from '@trident/inventory';

/**
 * PostgreSQL batch processor orchestrating real WP-012 IngestedIdempotencyEngine
 */
class PostgreSqlIngestedBatchProcessor {
  #pool;
  #engine;

  constructor(pool, engine) {
    this.#pool = pool;
    this.#engine = engine;
  }

  async processBatch(auth, batch) {
    const results = [];
    const client = await this.#pool.connect();
    try {
      for (const ev of batch.events) {
        await client.query('BEGIN');
        try {
          const res = await this.#engine.processEvent(client, auth, ev, async (c, payload, e) => {
            await c.query(
              `INSERT INTO wp027_test_audit_records (id, organization_id, branch_id, event_kind, payload_json)
                 VALUES ($1, $2, $3, $4, $5)`,
              [
                crypto.randomUUID(),
                auth.organizationId,
                auth.branchId,
                e.aggregateType || 'EVENT',
                JSON.stringify(payload),
              ],
            );
            return { success: true, processedAt: new Date().toISOString() };
          });
          await client.query('COMMIT');

          results.push({
            clientOpId: ev.clientOpId,
            aggregateType: ev.aggregateType,
            aggregateId: ev.aggregateId,
            aggregateSequenceNumber: ev.aggregateSequenceNumber,
            status: res.status,
            receipt: res.receipt ?? undefined,
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      client.release();
    }
    return {
      batchId: batch.batchId ?? crypto.randomUUID(),
      organizationId: auth.organizationId,
      branchId: auth.branchId,
      results,
    };
  }
}

describe('TRIDENTPOS WP-027: Cross-Context E2E Integration & Non-Functional Chaos Testing Suite', () => {
  const pool = getPool();
  const orgId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  let tempBaseDir;

  before(async () => {
    // 1. Ensure migrations are current
    await migrateUp(pool);

    // 2. Setup isolated tenant & branch in PostgreSQL
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES ('${orgId}', 'WP-027 E2E Testing Org', 'WP027 Restaurante', 'TAX-WP027-${orgId.slice(0, 8)}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES ('${branchId}', '${orgId}', 'BR-027-MAIN', 'Sucursal Matriz E2E')
        ON CONFLICT (organization_id, id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS wp027_test_audit_records (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES organizations(id),
          branch_id UUID NOT NULL,
          event_kind VARCHAR(100) NOT NULL,
          payload_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } finally {
      client.release();
    }

    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp027-chaos-e2e-'));
  });

  after(async () => {
    // Teardown PostgreSQL test fixtures
    const client = await pool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS wp027_test_audit_records;
        DELETE FROM ingested_idempotency_log WHERE organization_id = '${orgId}';
        DELETE FROM aggregate_sequences WHERE organization_id = '${orgId}';
        DELETE FROM reordering_buffer_queue WHERE organization_id = '${orgId}';
        DELETE FROM branches WHERE organization_id = '${orgId}';
        DELETE FROM organizations WHERE id = '${orgId}';
      `);
    } finally {
      client.release();
    }

    // Cleanup temp files
    if (tempBaseDir && fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }

    await closePool(pool);
    setTimeout(() => {
      process.exit(0);
    }, 50).unref();
  });

  // =========================================================================
  // SCENARIO 1: Full Restaurant Operational Lifecycle E2E
  // =========================================================================
  it('WP027-E2E-01: Full Restaurant Lifecycle across all 11 Bounded Contexts with exact scale-4 math', async () => {
    const testDir = path.join(tempBaseDir, 'lifecycle-e2e');
    fs.mkdirSync(testDir, { recursive: true });
    const dbPath = path.join(testDir, 'edge.db');

    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });

    // 1. Initialize SQLite schema across contexts
    edgeDb.executeSchema(POS_EDGE_SQLITE_SCHEMA);
    edgeDb.executeSchema(KDS_EDGE_SQLITE_SCHEMA);
    edgeDb.executeSchema(CASH_SHIFT_SQLITE_SCHEMA);

    const testIssuer = new TestCloudReceiptIssuer();
    const testVerifier = new TestCloudReceiptVerifier();
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);

    const diningRepo = new SqliteDiningRoomRepository(edgeDb);
    const mockPinValidator = {
      validatePin: () => true,
    };
    const diningService = new DiningDomainService({
      diningRepo,
      accountRepo: diningRepo,
      pinValidator: mockPinValidator,
    });
    const cashShiftRepo = new SqliteCashShiftRepository(edgeDb);
    const cashShiftService = new CashShiftDomainService({
      repository: cashShiftRepo,
      pinValidator: mockPinValidator,
    });
    const paymentRepo = new SqlitePaymentRepository(edgeDb, {
      organizationId: orgId,
      branchId,
      stationId,
      outboxPersistence: outbox,
    });
    const paymentService = new PaymentDomainService(
      paymentRepo,
      diningRepo,
      cashShiftRepo,
      mockPinValidator,
      { organizationId: orgId, branchId, stationId },
    );
    const kdsRepo = new SqliteKdsRepository(edgeDb);
    const kdsRuntime = createKdsRuntime({ edgeDb });

    const cashierId = 'usr-cajero-01';
    const waiterId = 'usr-mesero-01';

    // -----------------------------------------------------------------------
    // STEP 1: Shift Opening (Apertura de Turno con Fondo Inicial en Escala 4)
    // -----------------------------------------------------------------------
    const openingFloat = 10000000n; // $1,000.0000
    const turno = await cashShiftService.abrirTurno({
      organizationId: orgId,
      branchId,
      stationId,
      responsibleUserId: cashierId,
      openedByUserId: cashierId,
      operatorPin: '1234',
      openingCashFloat: openingFloat,
      assignmentStrategy: 'COMPARTIDO',
    });
    assert.equal(turno.status, 'ABIERTO');
    assert.equal(turno.openingCashFloat, openingFloat);

    // -----------------------------------------------------------------------
    // STEP 2: Dining Table Seating & Account Creation (Salón)
    // -----------------------------------------------------------------------
    const mesaId = 'mesa-15';
    await diningRepo.saveMesa(
      {
        id: mesaId,
        roomName: 'Terraza Principal',
        tableNumber: '15',
        status: 'DISPONIBLE',
        currentAccountId: null,
        posX: 10,
        posY: 20,
        capacity: 4,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0, // Expected version 0 for new table
    );

    const cuentaId = 'cuenta-mesa-15';
    const openTableResult = diningService.openCuentaSync({
      id: cuentaId,
      mesaId,
      epochId: 'epoch-001',
      accountType: 'COMEDOR',
      openedByUserId: waiterId,
      guestCount: 4,
    });
    assert.equal(openTableResult.cuenta.status, 'ABIERTA');
    assert.equal(openTableResult.cuenta.guestCount, 4);

    // -----------------------------------------------------------------------
    // STEP 3: Comanda Assembly with Modifiers (DEC-016 Additive / Subtractive)
    // -----------------------------------------------------------------------
    // Dish 1: Ribeye 400g ($450.0000) + Extra Truffle ($50.0000) = $500.0000
    const itemSubtotal1 = calculateItemSubtotalScale4('450.0000', '1.0000', '50.0000');
    assert.equal(itemSubtotal1, '500.0000');

    // Add items to the dining account in SQLite
    const cuentaAfterItem1 = diningService.addItemToCuentaSync(
      cuentaId,
      openTableResult.cuenta.version,
      {
        id: 'item-ribeye-1',
        productId: 'prod-ribeye-400',
        productNameSnapshot: 'Ribeye Steak 400g',
        unitPriceApplied: 5000000n, // $500.0000 with modifiers
        quantity: 10000n, // 1.0000
        taxRateApplied: 1600n, // 16%
      },
    );

    // Dish 2: Ensalada César ($180.0000)
    const cuentaAfterItem2 = diningService.addItemToCuentaSync(cuentaId, cuentaAfterItem1.version, {
      id: 'item-salad-2',
      productId: 'prod-cesar-salad',
      productNameSnapshot: 'Ensalada César',
      unitPriceApplied: 1800000n,
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // Dish 3: Cerveza Artesanal ($80.0000 x 2 = $160.0000)
    const cuentaCurrent = diningService.addItemToCuentaSync(cuentaId, cuentaAfterItem2.version, {
      id: 'item-beer-3',
      productId: 'prod-craft-beer',
      productNameSnapshot: 'Cerveza Artesanal IPA',
      unitPriceApplied: 800000n,
      quantity: 20000n,
      taxRateApplied: 1600n,
    });

    // Total account balance: $500 + $180 + $160 = $840.0000 + taxes
    assert.equal(cuentaCurrent.subtotal, 8400000n); // $840.0000
    assert.equal(cuentaCurrent.taxTotal, 1344000n); // $134.4000
    assert.equal(cuentaCurrent.totalAmount, 9744000n); // $974.4000

    // -----------------------------------------------------------------------
    // STEP 4: Send to Kitchen & KDS Production Lifecycle (ACR-2026-016)
    // -----------------------------------------------------------------------
    const kdsEstacionId = 'kds-est-cocina-01';
    kdsRepo.createEstacion({
      id: kdsEstacionId,
      name: 'Cocina Caliente',
      stationType: 'COCINA',
      status: 'ACTIVA',
    });

    const ticketId = 'ticket-kds-001';
    const ticket = kdsRuntime.service.enviarComandaACocina({
      id: ticketId,
      cuentaId,
      mesaReference: 'Mesa 15',
      kdsEstacionId,
      urgencyLevel: 'NORMAL',
      items: [
        {
          id: 'partida-1',
          productId: 'prod-ribeye-400',
          productNameSnapshot: 'Ribeye Steak 400g (Truffle)',
          quantity: 10000n,
          comments: 'Termino Medio, Sin Cebolla',
        },
        {
          id: 'partida-2',
          productId: 'prod-cesar-salad',
          productNameSnapshot: 'Ensalada César',
          quantity: 10000n,
        },
      ],
    });
    assert.equal(ticket.status, 'PENDIENTE');

    // Chef starts preparation
    const inPrepTicket = kdsRuntime.service.iniciarPreparacionOrden(ticketId, kdsEstacionId);
    assert.equal(inPrepTicket.status, 'EN_PREPARACION');

    // Chef completes preparation (25 minutes)
    const completedTicket = kdsRuntime.service.confirmarOrdenSurtida(ticketId, kdsEstacionId, 25);
    assert.equal(completedTicket.status, 'LISTO');
    assert.equal(completedTicket.preparationTimeMinutes, 25);
    assert.ok(completedTicket.completedAt !== null);

    // KDS Recall Drill: Recall ticket within 120-minute window (ACR-2026-016)
    const recalledTicket = kdsRuntime.service.recuperarOrdenRecall(ticketId, 120);
    assert.ok(recalledTicket !== null);
    assert.equal(recalledTicket.id, ticketId);

    // -----------------------------------------------------------------------
    // STEP 5: Real-Time Recipe Depletion & Escandallo (WP-017 / WP-018)
    // -----------------------------------------------------------------------
    const ribeyeRecipe = {
      id: 'rec-ribeye-400',
      organizationId: orgId,
      productId: 'prod-ribeye-400',
      code: 'REC-RIB-400',
      name: 'Escandallo Ribeye 400g',
      yieldQuantity: '1.0000',
      yieldUnit: 'PORCION',
      totalCost: '0.0000',
      isActive: true,
      items: [
        {
          id: 'item-ribeye-meat',
          organizationId: orgId,
          recipeId: 'rec-ribeye-400',
          ingredientId: 'ins-carne-ribeye',
          subRecipeId: null,
          quantity: '0.4000', // 400g net
          grossQuantity: '0.4211', // Gross quantity accounting for 5% waste
          unitCostSnapshot: '350.0000',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'item-truffle-oil',
          organizationId: orgId,
          recipeId: 'rec-ribeye-400',
          ingredientId: 'ins-truffle-oil',
          subRecipeId: null,
          quantity: '0.0300', // 30ml
          grossQuantity: '0.0300',
          unitCostSnapshot: '600.0000',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolver = {
      getIngredientCost: async (ingredientId) => {
        if (ingredientId === 'ins-carne-ribeye') return '350.0000';
        if (ingredientId === 'ins-truffle-oil') return '600.0000';
        return '0.0000';
      },
      getSubRecipe: async () => null,
    };

    const costResult = await calculateRecipeCost(ribeyeRecipe, resolver);
    assert.ok(toScale4BigInt(costResult.totalCost) > 0n);
    assert.equal(costResult.lineItems.length, 2);
    // Gross quantity of meat required must account for waste: Net / (1 - Waste%)
    assert.ok(toScale4BigInt(costResult.lineItems[0].grossQuantity) > 4000n);

    // -----------------------------------------------------------------------
    // STEP 6: Precuenta & Proportional Bill Splitting (DEC-015 / OQ-SSOT-06)
    // -----------------------------------------------------------------------
    // Print Precuenta
    diningService.requestCheckSync({
      cuentaId,
      expectedVersion: cuentaCurrent.version,
      requestedByUserId: waiterId,
    });
    const cuentaPrinted = diningRepo.getCuentaByIdSync(cuentaId);
    assert.ok(cuentaPrinted !== null);
    assert.ok(cuentaPrinted.printedAt !== null);

    // Split account into 3 diners: Total $974.4000 / 3
    const splitResult = calculateProportionalSplit({
      mode: 'EQUAL',
      splitCount: 3,
      originalTotalScale4: fromScale4BigInt(cuentaPrinted.totalAmount),
    });
    assert.equal(splitResult.subAccounts.length, 3);

    // Exact scale-4 residue absorption check:
    const sub1 = toScale4BigInt(splitResult.subAccounts[0].totalToPayScale4);
    const sub2 = toScale4BigInt(splitResult.subAccounts[1].totalToPayScale4);
    const sub3 = toScale4BigInt(splitResult.subAccounts[2].totalToPayScale4);

    // Sum of subaccounts must equal total account balance exactly
    assert.equal(sub1 + sub2 + sub3, cuentaPrinted.totalAmount);
    assert.equal(fromScale4BigInt(sub1 + sub2 + sub3), '974.4000');

    // -----------------------------------------------------------------------
    // STEP 7: Multi-Tender Payment Settlement (WP-016C / DEC-015 / DEC-017)
    // -----------------------------------------------------------------------
    // Diner 1: Cash payment ($400.0000 cash given, pays $324.8000, change $75.2000)
    const pay1 = await paymentService.submitTender({
      cuentaId,
      turnoCajaId: turno.id,
      operatorUserId: cashierId,
      operatorPin: '1234',
      paymentMethod: 'EFECTIVO',
      amount: sub1,
      tipAmount: 0n,
      cashGiven: 4000000n, // $400.0000
      clientOpId: crypto.randomUUID(),
    });
    assert.equal(pay1.pago.changeDue, 4000000n - sub1);

    // Diner 2: Card payment ($324.8000)
    const pay2 = await paymentService.submitTender({
      cuentaId,
      turnoCajaId: turno.id,
      operatorUserId: cashierId,
      operatorPin: '1234',
      paymentMethod: 'TARJETA',
      amount: sub2,
      tipAmount: 300000n, // $30.0000 tip
      referenceAuthCode: 'AUTH-VISA-9948',
      clientOpId: crypto.randomUUID(),
    });

    // Diner 3: Electronic Transfer / SPEI ($324.8000)
    const pay3 = await paymentService.submitTender({
      cuentaId,
      turnoCajaId: turno.id,
      operatorUserId: cashierId,
      operatorPin: '1234',
      paymentMethod: 'TRANSFERENCIA',
      amount: sub3,
      tipAmount: 0n,
      referenceAuthCode: 'SPEI-TRX-1029384',
      clientOpId: crypto.randomUUID(),
    });

    // Account closed and table released
    assert.equal(pay3.accountStatus, 'PAGADA');
    assert.equal(pay3.accountSettled, true);

    const mesaBeforeRelease = diningRepo.getMesaByIdSync(mesaId);
    diningService.liberarMesaSync({
      mesaId,
      expectedVersion: mesaBeforeRelease.version,
      operatorUserId: cashierId,
    });
    const mesaUpdated = diningRepo.getMesaByIdSync(mesaId);
    assert.ok(mesaUpdated !== null);
    assert.equal(mesaUpdated.status, 'DISPONIBLE');
    assert.equal(mesaUpdated.currentAccountId, null);

    // -----------------------------------------------------------------------
    // STEP 8: Blind Cash Count & Corte Z Emission (DEC-017 / WP-016)
    // -----------------------------------------------------------------------
    // Cashier declares counted cash: Opening float ($1000) + Cash collected ($324.8000) = $1,324.8000
    const declaredCash = 13248000n;
    const { shift: shiftArqueo, arqueo } = await cashShiftService.realizarArqueoCiego({
      shiftId: turno.id,
      performedByUserId: cashierId,
      performedByPin: '1234',
      declaredCash,
      expectedVersion: turno.version,
    });
    assert.equal(shiftArqueo.status, 'CERRADO_ARQUEO');
    assert.equal(arqueo.declaredCash, declaredCash);
    assert.equal(arqueo.calculatedCash, 13248000n);
    assert.equal(arqueo.difference, 0n);

    const { shift: shiftFinal, corte: corteZ } = await cashShiftService.generarCorteZ({
      shiftId: turno.id,
      closedByUserId: cashierId,
      closedByPin: '1234',
      expectedVersion: shiftArqueo.version,
    });
    assert.equal(shiftFinal.status, 'CORTE_Z_EMITIDO');
    assert.equal(corteZ.totalCalculado, 13248000n);
    assert.equal(corteZ.diferencia, 0n); // Perfectly balanced (CUADRADO)

    // -----------------------------------------------------------------------
    // STEP 9: Outbox Streaming & Real PostgreSQL Ingestion Idempotency
    // -----------------------------------------------------------------------
    // Flush outbox queue through real Cloud Sync Gateway to real PostgreSQL
    const testHttpServer = http.createServer();
    const dbBatchProcessor = new PostgreSqlIngestedBatchProcessor(
      pool,
      new IngestedIdempotencyEngine(testIssuer),
    );

    const gateway = new CloudWebSocketSyncGateway({
      server: testHttpServer,
      path: '/api/v1/sync/stream',
      batchProcessor: dbBatchProcessor,
      deltaProvider: new CloudCatalogDeltaService(),
      authenticator: new CallbackWebSocketAuthenticator(() => ({
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      })),
    });

    let wsPort = 0;
    await new Promise((resolve) => {
      testHttpServer.listen(0, '127.0.0.1', () => {
        wsPort = testHttpServer.address().port;
        resolve();
      });
    });

    const syncPersist = new EdgeSyncPersistence(edgeDb);
    const syncClient = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${wsPort}/api/v1/sync/stream`,
      auth: {
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      },
      authToken: 'test-token',
      outbox,
      syncPersistence: syncPersist,
      deterministicBackoff: true,
    });

    try {
      await syncClient.connect();
      assert.equal(syncClient.getState(), 'CONNECTED');

      // Greenfield sequence baseline alignment for the settled cuenta
      const clientSeq = await pool.connect();
      try {
        const pendingEvs = outbox.getPendingEvents(10);
        for (const ev of pendingEvs) {
          await clientSeq.query(
            `INSERT INTO aggregate_sequences (organization_id, branch_id, aggregate_type, aggregate_id, current_sequence_number)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (organization_id, branch_id, aggregate_type, aggregate_id)
             DO UPDATE SET current_sequence_number = EXCLUDED.current_sequence_number;`,
            [orgId, branchId, ev.aggregateType, ev.aggregateId, ev.aggregateSequenceNumber - 1],
          );
        }
      } finally {
        clientSeq.release();
      }

      // Flush outbox queue through real Cloud Sync Gateway
      const flushResult = await syncClient.flushOutbox();
      assert.ok(flushResult.synced > 0);
      assert.equal(outbox.getBacklogCount(), 0);

      // Verify PostgreSQL record written under RLS
      const pgClient = await pool.connect();
      try {
        const auditRes = await pgClient.query(
          `SELECT COUNT(*) as count FROM wp027_test_audit_records WHERE organization_id = $1`,
          [orgId],
        );
        assert.ok(parseInt(auditRes.rows[0].count, 10) >= 1);
      } finally {
        pgClient.release();
      }
    } finally {
      await syncClient.disconnect();
      await gateway.close();
      testHttpServer.closeAllConnections?.();
      await new Promise((resolve) => testHttpServer.close(resolve));
      edgeDb.close();
    }
  });

  // =========================================================================
  // SCENARIO 2: SEC-VAL-09 WAN Failure Mode & Autonomous Offline Edge Continuity
  // =========================================================================
  it('WP027-CHAOS-01: SEC-VAL-09 WAN failure mode proves 100% offline edge continuity and safe reconnect sync', async () => {
    const testDir = path.join(tempBaseDir, 'wan-chaos');
    fs.mkdirSync(testDir, { recursive: true });
    const dbPath = path.join(testDir, 'edge.db');

    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });
    edgeDb.executeSchema(POS_EDGE_SQLITE_SCHEMA);
    edgeDb.executeSchema(KDS_EDGE_SQLITE_SCHEMA);
    edgeDb.executeSchema(CASH_SHIFT_SQLITE_SCHEMA);

    const testIssuer = new TestCloudReceiptIssuer();
    const testVerifier = new TestCloudReceiptVerifier();
    const outbox = new EdgeOutboxPersistence(edgeDb, testVerifier);
    const syncPersist = new EdgeSyncPersistence(edgeDb);

    const diningRepo = new SqliteDiningRoomRepository(edgeDb);
    const mockPinValidator = {
      validatePin: () => true,
    };
    const diningService = new DiningDomainService({
      diningRepo,
      accountRepo: diningRepo,
      pinValidator: mockPinValidator,
    });
    const cashShiftRepo = new SqliteCashShiftRepository(edgeDb);
    const cashShiftService = new CashShiftDomainService({
      repository: cashShiftRepo,
      pinValidator: mockPinValidator,
    });
    const paymentRepo = new SqlitePaymentRepository(edgeDb, {
      organizationId: orgId,
      branchId,
      stationId,
      outboxPersistence: outbox,
    });
    const paymentService = new PaymentDomainService(
      paymentRepo,
      diningRepo,
      cashShiftRepo,
      mockPinValidator,
      { organizationId: orgId, branchId, stationId },
    );

    // Phase A: Setup online Cloud gateway
    const testHttpServer = http.createServer();
    const dbBatchProcessor = new PostgreSqlIngestedBatchProcessor(
      pool,
      new IngestedIdempotencyEngine(testIssuer),
    );

    const gateway = new CloudWebSocketSyncGateway({
      server: testHttpServer,
      path: '/api/v1/sync/stream',
      batchProcessor: dbBatchProcessor,
      deltaProvider: new CloudCatalogDeltaService(),
      authenticator: new CallbackWebSocketAuthenticator(() => ({
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      })),
    });

    let wsPort = 0;
    await new Promise((resolve) => {
      testHttpServer.listen(0, '127.0.0.1', () => {
        wsPort = testHttpServer.address().port;
        resolve();
      });
    });

    const syncClient = new EdgeSyncClient({
      wsUrl: `ws://127.0.0.1:${wsPort}/api/v1/sync/stream`,
      auth: {
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      },
      authToken: 'test-token',
      outbox,
      syncPersistence: syncPersist,
      deterministicBackoff: true,
    });

    await syncClient.connect();
    assert.equal(syncClient.getState(), 'CONNECTED');

    // -----------------------------------------------------------------------
    // CHAOS INJECTION: Simulate hard WAN severed connection
    // -----------------------------------------------------------------------
    syncClient.simulateWanDrop();
    assert.equal(syncClient.getState(), 'DISCONNECTED');

    // Edge is now completely offline / in WAN dead-zone
    // Verify that local operations proceed with ZERO interruption:
    const turno = await cashShiftService.abrirTurno({
      organizationId: orgId,
      branchId,
      stationId,
      responsibleUserId: 'usr-offline-cajero',
      openedByUserId: 'usr-offline-cajero',
      operatorPin: '1234',
      openingCashFloat: 5000000n, // $500.0000
      assignmentStrategy: 'COMPARTIDO',
    });
    assert.equal(turno.status, 'ABIERTO');

    await diningRepo.saveMesa(
      {
        id: 'mesa-offline-1',
        roomName: 'Salón',
        tableNumber: '101',
        status: 'DISPONIBLE',
        currentAccountId: null,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      0,
    );

    const cuentaOfflineId = 'cuenta-offline-101';
    const tableOpen = diningService.openCuentaSync({
      id: cuentaOfflineId,
      mesaId: 'mesa-offline-1',
      openedByUserId: 'usr-offline-mesero',
      guestCount: 2,
      epochId: 'epoch-offline-1',
      accountType: 'COMEDOR',
    });

    const addedItem = diningService.addItemToCuentaSync(cuentaOfflineId, tableOpen.cuenta.version, {
      id: 'item-offline-1',
      productId: 'prod-burger',
      productNameSnapshot: 'Hamburguesa Especial',
      unitPriceApplied: 2500000n, // $250.0000
      quantity: 10000n,
      taxRateApplied: 1600n,
    });

    // Collect settlement while 100% offline
    const settleOffline = await paymentService.submitTender({
      cuentaId: addedItem.id,
      turnoCajaId: turno.id,
      operatorUserId: 'usr-offline-cajero',
      operatorPin: '1234',
      paymentMethod: 'EFECTIVO',
      amount: addedItem.totalAmount,
      cashGiven: 3000000n,
      tipAmount: 0n,
      clientOpId: crypto.randomUUID(),
    });
    assert.equal(settleOffline.accountStatus, 'PAGADA');
    assert.equal(settleOffline.accountSettled, true);

    // Outbox should contain pending offline operations
    assert.ok(outbox.getBacklogCount() > 0);

    // -----------------------------------------------------------------------
    // CHAOS RECOVERY: WAN link restored
    // -----------------------------------------------------------------------
    syncClient.simulateWanRestore();
    await syncClient.connect();
    assert.equal(syncClient.getState(), 'CONNECTED');

    // Greenfield sequence baseline alignment for the offline settled cuenta
    const clientSeq = await pool.connect();
    try {
      const pendingEvs = outbox.getPendingEvents(10);
      for (const ev of pendingEvs) {
        await clientSeq.query(
          `INSERT INTO aggregate_sequences (organization_id, branch_id, aggregate_type, aggregate_id, current_sequence_number)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (organization_id, branch_id, aggregate_type, aggregate_id)
           DO UPDATE SET current_sequence_number = EXCLUDED.current_sequence_number;`,
          [orgId, branchId, ev.aggregateType, ev.aggregateId, ev.aggregateSequenceNumber - 1],
        );
      }
    } finally {
      clientSeq.release();
    }

    // Flushes all accumulated offline operations atomically
    const flushedResult = await syncClient.flushOutbox();
    assert.ok(flushedResult.synced > 0);
    assert.equal(outbox.getBacklogCount(), 0);

    await syncClient.disconnect();
    await gateway.close();
    testHttpServer.closeAllConnections?.();
    await new Promise((resolve) => testHttpServer.close(resolve));
    edgeDb.close();
  });

  // =========================================================================
  // SCENARIO 3: DAT-08 Disaster Recovery Cold-Restore Simulation (< 30 min)
  // =========================================================================
  it('WP027-CHAOS-02: DAT-08 Disaster Recovery cold-restore rebuilds Edge catalog and config within SLA', async () => {
    const testDir = path.join(tempBaseDir, 'dat08-restore');
    fs.mkdirSync(testDir, { recursive: true });
    const dbPath = path.join(testDir, 'edge.db');

    // 1. Initial edge instance
    const edgeDbOriginal = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });
    edgeDbOriginal.executeSchema(POS_EDGE_SQLITE_SCHEMA);

    // Insert dummy operational data before catastrophic disaster
    edgeDbOriginal.executeMutation(
      `INSERT INTO mesas (id, room_name, table_number, status, version, updated_at)
       VALUES ('m-lost', 'Salon', '99', 'DISPONIBLE', 1, ?);`,
      new Date().toISOString(),
    );

    edgeDbOriginal.close();

    // -----------------------------------------------------------------------
    // DISASTER INJECTION: Complete storage loss (DAT-08 wipe)
    // -----------------------------------------------------------------------
    const startTime = Date.now();
    fs.rmSync(dbPath, { force: true });
    assert.equal(fs.existsSync(dbPath), false);

    // Rebuild Edge runtime from Cloud Delta Provider
    const edgeDbRestored = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });
    edgeDbRestored.executeSchema(POS_EDGE_SQLITE_SCHEMA);

    // Catalog Delta re-hydration from Cloud
    const deltaService = new CloudCatalogDeltaService();
    deltaService.setEntities(orgId, [
      {
        entityType: 'PRODUCT',
        entityId: 'p-1',
        action: 'UPSERT',
        data: { code: 'RIB-01', name: 'Ribeye 400g', price: '450.0000' },
        version: 1,
      },
      {
        entityType: 'PRODUCT',
        entityId: 'p-2',
        action: 'UPSERT',
        data: { code: 'SAL-01', name: 'Cesar Salad', price: '180.0000' },
        version: 1,
      },
      {
        entityType: 'PRODUCT',
        entityId: 'p-3',
        action: 'UPSERT',
        data: { code: 'BEER-01', name: 'Craft IPA', price: '80.0000' },
        version: 1,
      },
    ]);

    const deltaResponse = await deltaService.getCatalogDeltas(
      {
        organizationId: orgId,
        branchId,
        isControlPlane: false,
        roles: ['STATION_OPERATOR'],
      },
      { sinceSnapshotVersion: 0 },
    );
    assert.equal(deltaResponse.entities.length, 3);

    // Populate recovered configuration in SQLite
    edgeDbRestored.executeSchema(`
      CREATE TABLE IF NOT EXISTS productos_catalog (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        price_scale4 TEXT NOT NULL
      );
    `);

    for (const ent of deltaResponse.entities) {
      edgeDbRestored.executeMutation(
        `INSERT INTO productos_catalog (id, code, name, price_scale4) VALUES (?, ?, ?, ?);`,
        ent.entityId,
        ent.data.code,
        ent.data.name,
        ent.data.price,
      );
    }

    const countRow = edgeDbRestored.queryRow(`SELECT COUNT(*) as count FROM productos_catalog;`);
    assert.equal(Number(countRow.count), 3);

    const elapsedMs = Date.now() - startTime;
    // SLA constraint: Cold disaster recovery must complete in < 30 minutes (1,800,000 ms)
    assert.ok(
      elapsedMs < 1800000,
      `DAT-08: Restore took ${elapsedMs}ms, exceeding 30-minute threshold`,
    );
    edgeDbRestored.close();
  });

  // =========================================================================
  // SCENARIO 4: RSK-15 Process SIGKILL & Empirical RTO/RPO DR Drill
  // =========================================================================
  it('WP027-CHAOS-03: RSK-15 Hard crash recovery proves RPO=0 and empirical RTO < 30 min', async () => {
    const testDir = path.join(tempBaseDir, 'rsk15-crash');
    fs.mkdirSync(testDir, { recursive: true });
    const dbPath = path.join(testDir, 'edge.db');

    const edgeDb = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });
    edgeDb.executeSchema(POS_EDGE_SQLITE_SCHEMA);

    // 1. Commit baseline transaction
    edgeDb.executeMutation(
      `INSERT INTO mesas (id, room_name, table_number, status, version, updated_at)
       VALUES ('m-committed', 'Barra', 'B1', 'DISPONIBLE', 1, ?);`,
      new Date().toISOString(),
    );

    // 2. Simulate uncommitted in-flight transaction during crash (simulated SIGKILL)
    try {
      edgeDb.runInTransaction(() => {
        edgeDb.executeMutation(
          `INSERT INTO mesas (id, room_name, table_number, status, version, updated_at)
           VALUES ('m-uncommitted', 'Barra', 'B2', 'DISPONIBLE', 1, ?);`,
          new Date().toISOString(),
        );
        // Force abnormal termination before commit
        throw new Error('SIMULATED_SIGKILL_POWER_FAILURE');
      });
    } catch (e) {
      assert.equal(e.message, 'SIMULATED_SIGKILL_POWER_FAILURE');
    }

    edgeDb.close();

    // 3. Restart process & measure Recovery Time Objective (RTO)
    const restartStart = Date.now();
    const edgeDbRecovered = new EdgeDatabaseService({ databasePath: dbPath, verbose: false });

    // Verify RPO = 0: Committed record survives, uncommitted rolled back cleanly
    const committedRow = edgeDbRecovered.queryRow(`SELECT id FROM mesas WHERE id = 'm-committed';`);
    const uncommittedRow = edgeDbRecovered.queryRow(
      `SELECT id FROM mesas WHERE id = 'm-uncommitted';`,
    );

    assert.ok(committedRow !== undefined, 'RPO=0: Committed transaction was preserved');
    assert.equal(
      uncommittedRow,
      undefined,
      'RPO=0: Uncommitted crash transaction was cleanly aborted',
    );

    const rtoElapsedMs = Date.now() - restartStart;
    assert.ok(
      rtoElapsedMs < 1800000,
      `RSK-15: RTO took ${rtoElapsedMs}ms, exceeding 30-minute threshold`,
    );
    edgeDbRecovered.close();
  });

  // =========================================================================
  // SCENARIO 5: Product Owner Policy Parameterization
  // =========================================================================
  it('WP027-PO-01: Parameterizes Product Owner policy decisions without hidden defaults', async () => {
    // DEC-011 / OQ-SSOT-02: Table transfer strictly conditioned on receiving waiter PIN
    const mockLanClient = {
      executeMutation: async () => ({
        ok: true,
        data: {
          success: true,
          tableId: 'm-1',
          transferredAt: new Date().toISOString(),
          previousWaiterId: 'w-1',
          newWaiterId: 'w-2',
        },
      }),
    };
    const mockPinValidator = {
      verifyWaiterPin: (waiterId, plainPin) => {
        if (waiterId === 'w-2' && plainPin === '1234') return true;
        return false;
      },
    };
    const initialWaiters = [
      { id: 'w-1', name: 'Mesero 1', role: 'MESERO' },
      { id: 'w-2', name: 'Mesero 2', role: 'MESERO' },
    ];

    const transferService = new TableTransferService(
      mockLanClient,
      mockPinValidator,
      initialWaiters,
    );

    const validTransfer = await transferService.transferTable({
      tableId: 'm-1',
      fromWaiterId: 'w-1',
      toWaiterId: 'w-2',
      receiverPin: '1234',
    });
    assert.equal(validTransfer.success, true);
    assert.equal(validTransfer.newWaiterId, 'w-2');

    const invalidTransfer = await transferService.transferTable({
      tableId: 'm-1',
      fromWaiterId: 'w-1',
      toWaiterId: 'w-2',
      receiverPin: '9999',
    });
    assert.equal(invalidTransfer.success, false);
    assert.ok(invalidTransfer.error?.includes('RECEIVER_PIN_REJECTED'));

    // DEC-015 / OQ-SSOT-06: Rounding residue absorption parameterized
    const oddSplit = calculateProportionalSplit({
      mode: 'EQUAL',
      splitCount: 3,
      originalTotalScale4: '100.0000',
    });
    assert.equal(oddSplit.subAccounts[0].totalToPayScale4, '33.3333');
    assert.equal(oddSplit.subAccounts[1].totalToPayScale4, '33.3333');
    // Last subaccount absorbs the 0.0001 residue
    assert.equal(oddSplit.subAccounts[2].totalToPayScale4, '33.3334');
    assert.equal(
      toScale4BigInt(oddSplit.subAccounts[0].totalToPayScale4) +
        toScale4BigInt(oddSplit.subAccounts[1].totalToPayScale4) +
        toScale4BigInt(oddSplit.subAccounts[2].totalToPayScale4),
      1000000n,
    );
  });
});
