import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
if (!process.env['DATABASE_URL']) {
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

import { getPool, migrateUp } from '@trident/database';
import {
  PostgresBillingService,
  MockPacConnector,
  InvalidRfcError,
  InvalidFiscalInvoiceError,
  InvoiceStatusTransitionError,
  PacTimeoutError,
} from './index.js';

describe(
  'TRIDENTPOS WP-021 Cloud Server Billing & Fiscal Invoicing Engine Suite',
  { concurrency: 1 },
  () => {
    let pool: ReturnType<typeof getPool>;
    const testRunId = crypto.randomUUID().substring(0, 8);
    const tenantAId = crypto.randomUUID();
    const tenantBId = crypto.randomUUID();
    const branchA1Id = crypto.randomUUID();
    const branchB1Id = crypto.randomUUID();

    const rfcEmisorA = 'AAA010101AAA';
    const rfcReceptor = 'URE180429TM6';

    let billingService: PostgresBillingService;
    let taxSchemeIva16Id: string;

    before(async () => {
      pool = getPool();
      await migrateUp(pool);

      const client = await pool.connect();
      try {
        // Seed organizations and branches
        await client.query(`
        INSERT INTO organizations (id, legal_name, trade_name, tax_id)
        VALUES
          ('${tenantAId}', 'Empresa Fiscal A S.A.', 'Empresa A', 'RFC-BILL-A-${testRunId}'),
          ('${tenantBId}', 'Empresa Fiscal B S.A.', 'Empresa B', 'RFC-BILL-B-${testRunId}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO branches (id, organization_id, code, name)
        VALUES
          ('${branchA1Id}', '${tenantAId}', 'SUC-A1', 'Sucursal A1'),
          ('${branchB1Id}', '${tenantBId}', 'SUC-B1', 'Sucursal B1')
        ON CONFLICT (id) DO NOTHING;
      `);
      } finally {
        client.release();
      }

      billingService = new PostgresBillingService(pool, new MockPacConnector());
    });

    after(async () => {
      const client = await pool.connect();
      try {
        await client.query(`
        DELETE FROM lotes_facturacion_global WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM fiscal_invoice_items WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM fiscal_invoices WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM emisor_fiscal_config WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM tax_schemes WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM cloud_integration_outbox WHERE organization_id IN ('${tenantAId}', '${tenantBId}');
        DELETE FROM branches WHERE id IN ('${branchA1Id}', '${branchB1Id}');
        DELETE FROM organizations WHERE id IN ('${tenantAId}', '${tenantBId}');
      `);
      } finally {
        client.release();
      }
    });

    it('WP021-CS-01: Create and retrieve Tax Schemes with exact scale-4 precision', async () => {
      const iva16 = await billingService.createTaxScheme({
        organizationId: tenantAId,
        code: `IVA16-${testRunId}`,
        name: 'IVA 16% General',
        taxType: 'IVA',
        factorType: 'Tasa',
        rate: '0.1600',
      });
      taxSchemeIva16Id = iva16.id;

      assert.equal(iva16.organizationId, tenantAId);
      assert.equal(iva16.rate, '0.1600');
      assert.equal(iva16.taxType, 'IVA');
      assert.equal(iva16.factorType, 'Tasa');
      assert.equal(iva16.isActive, true);

      const ieps8 = await billingService.createTaxScheme({
        organizationId: tenantAId,
        code: `IEPS8-${testRunId}`,
        name: 'IEPS 8% Alimentos',
        taxType: 'IEPS',
        factorType: 'Tasa',
        rate: '0.0800',
      });
      assert.ok(ieps8.id);

      const schemesA = await billingService.getTaxSchemes(tenantAId);
      assert.ok(schemesA.length >= 2);
      assert.ok(schemesA.some((s) => s.id === taxSchemeIva16Id));

      // Tenant B cannot see Tenant A schemes
      const schemesB = await billingService.getTaxSchemes(tenantBId);
      assert.equal(
        schemesB.some((s) => s.id === taxSchemeIva16Id),
        false,
      );
    });

    it('WP021-CS-02: Configure Emisor Fiscal with SAT validation and RFC rules', async () => {
      // Rejects invalid RFC
      await assert.rejects(
        billingService.configureEmisorFiscal({
          organizationId: tenantAId,
          rfc: 'INVALID_RFC',
          razonSocial: 'Empresa Invalida',
          regimenFiscal: '601',
          codigoPostal: '06600',
        }),
        InvalidRfcError,
      );

      // Valid configuration
      const emisor = await billingService.configureEmisorFiscal({
        organizationId: tenantAId,
        rfc: rfcEmisorA,
        razonSocial: 'TRIDENT RESTAURANTES S.A. DE C.V.',
        regimenFiscal: '601',
        codigoPostal: '06600',
        pacEnvironment: 'TEST',
        pacPrimaryProvider: 'MOCK_PAC',
      });

      assert.equal(emisor.rfc, rfcEmisorA);
      assert.equal(emisor.razonSocial, 'TRIDENT RESTAURANTES S.A. DE C.V.');
      assert.equal(emisor.regimenFiscal, '601');
      assert.equal(emisor.codigoPostal, '06600');
      assert.equal(emisor.pacEnvironment, 'TEST');

      const fetched = await billingService.getEmisorFiscalConfig(tenantAId);
      assert.ok(fetched);
      assert.equal(fetched.rfc, rfcEmisorA);
    });

    it('WP021-CS-03: Create Draft Invoice with multi-item tax calculation', async () => {
      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1001-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE PRUEBA SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        formaPago: '01',
        metodoPago: 'PUE',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Consumo de Alimentos',
            quantity: '2.0000',
            unitPrice: '150.0000',
            taxSchemeId: taxSchemeIva16Id,
          },
          {
            claveProdServ: '90101502',
            claveUnidad: 'H87',
            description: 'Bebida Refrescante',
            quantity: '1.0000',
            unitPrice: '50.0000',
            taxSchemeId: taxSchemeIva16Id,
          },
        ],
      });

      assert.equal(draft.status, 'DRAFT');
      assert.equal(draft.emisorRfc, rfcEmisorA);
      assert.equal(draft.receptorRfc, rfcReceptor);
      assert.equal(draft.subtotalAmount, '350.0000'); // 300 + 50
      assert.equal(draft.taxAmount, '56.0000'); // 16% of 350 = 56.0000
      assert.equal(draft.totalAmount, '406.0000'); // 350 + 56 = 406.0000
      assert.equal(draft.items?.length, 2);
    });

    it('WP021-CS-04: Stamp Fiscal Invoice with Cadena Original, XML and Outbox Event', async () => {
      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1002-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE PRUEBA SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Comida Buffet',
            quantity: '1.0000',
            unitPrice: '200.0000',
            taxSchemeId: taxSchemeIva16Id,
          },
        ],
      });

      const stamped = await billingService.stampFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
      });

      assert.equal(stamped.status, 'STAMPED');
      assert.ok(stamped.uuid, 'UUID must be populated');
      assert.ok(stamped.selloSat, 'Sello SAT must be populated');
      assert.ok(stamped.fechaTimbrado, 'Fecha timbrado must be populated');
      assert.ok(stamped.cadenaOriginal, 'Cadena original must be populated');
      assert.ok(stamped.xmlContent, 'XML content must be populated');
      assert.equal(stamped.pacProvider, 'MOCK_PAC');

      // Verify Outbox Event was emitted atomically
      const client = await pool.connect();
      try {
        const outboxRes = await client.query<{
          id: string;
          event_type: string;
          aggregate_id: string;
          payload: string | Record<string, unknown>;
        }>(
          `SELECT * FROM cloud_integration_outbox
         WHERE organization_id = $1 AND aggregate_id = $2 AND event_type = 'FacturaFiscalEmitida';`,
          [tenantAId, draft.id],
        );
        assert.equal(outboxRes.rows.length, 1);
        const event = outboxRes.rows[0]!;
        const payload =
          typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        assert.equal(payload.uuid, stamped.uuid);
        assert.equal(payload.totalAmount, stamped.totalAmount);
      } finally {
        client.release();
      }
    });

    it('WP021-CS-05: Stamping is strictly idempotent upon retries', async () => {
      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1003-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE REINTENTO SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Cena Gourmet',
            quantity: '1.0000',
            unitPrice: '500.0000',
            taxSchemeId: taxSchemeIva16Id,
          },
        ],
      });

      const stamp1 = await billingService.stampFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
      });

      // Second stamp call on same invoice
      const stamp2 = await billingService.stampFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
      });

      assert.equal(stamp1.uuid, stamp2.uuid);
      assert.equal(stamp1.status, 'STAMPED');
      assert.equal(stamp2.status, 'STAMPED');
    });

    it('WP021-CS-06: Cancel Fiscal Invoice with Motivo and Outbox Event', async () => {
      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1004-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE CANCELACION SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Servicio Para Cancelar',
            quantity: '1.0000',
            unitPrice: '100.0000',
          },
        ],
      });

      // Cannot cancel DRAFT invoice
      await assert.rejects(
        billingService.cancelFiscalInvoice({
          organizationId: tenantAId,
          invoiceId: draft.id,
          motivo: '02',
        }),
        InvoiceStatusTransitionError,
      );

      // Stamp first
      const stamped = await billingService.stampFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
      });
      assert.equal(stamped.status, 'STAMPED');

      // Cancel with motive 02
      const cancelled = await billingService.cancelFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
        motivo: '02',
      });

      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancellationReason, '02');
      assert.ok(cancelled.cancelledAt);

      // Idempotent cancellation
      const cancelledAgain = await billingService.cancelFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
        motivo: '02',
      });
      assert.equal(cancelledAgain.status, 'CANCELLED');

      // Verify FacturaFiscalCancelada Outbox Event
      const client = await pool.connect();
      try {
        const outboxRes = await client.query<{
          id: string;
          event_type: string;
          aggregate_id: string;
          payload: string | Record<string, unknown>;
        }>(
          `SELECT * FROM cloud_integration_outbox
         WHERE organization_id = $1 AND aggregate_id = $2 AND event_type = 'FacturaFiscalCancelada';`,
          [tenantAId, draft.id],
        );
        assert.equal(outboxRes.rows.length, 1);
      } finally {
        client.release();
      }
    });

    it('WP021-CS-07: Motivo 01 requires uuidSustitucion', async () => {
      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1005-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE PRUEBA SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Item Test',
            quantity: '1.0000',
            unitPrice: '100.0000',
          },
        ],
      });

      const stamped = await billingService.stampFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: draft.id,
      });

      // Motivo 01 without substitution UUID must be rejected
      await assert.rejects(
        billingService.cancelFiscalInvoice({
          organizationId: tenantAId,
          invoiceId: stamped.id,
          motivo: '01',
        }),
        InvalidFiscalInvoiceError,
      );

      // Motivo 01 with substitution UUID succeeds
      const cancelled = await billingService.cancelFiscalInvoice({
        organizationId: tenantAId,
        invoiceId: stamped.id,
        motivo: '01',
        uuidSustitucion: crypto.randomUUID(),
      });
      assert.equal(cancelled.status, 'CANCELLED');
    });

    it('WP021-CS-08: PAC Connector Timeout and Circuit Breaker fail closed without corrupting DB state', async () => {
      const failingPac = new MockPacConnector();
      failingPac.setBehavior({ simulateTimeout: true });
      const serviceWithFailingPac = new PostgresBillingService(pool, failingPac);

      const draft = await billingService.createDraftInvoice({
        organizationId: tenantAId,
        branchId: branchA1Id,
        tipoComprobante: 'I',
        serie: 'FAC',
        folio: `1006-${testRunId}`,
        receptorRfc: rfcReceptor,
        receptorNombre: 'CLIENTE FALLO PAC SA DE CV',
        receptorRegimenFiscal: '601',
        receptorCodigoPostal: '64000',
        receptorUsoCfdi: 'G03',
        items: [
          {
            claveProdServ: '90101501',
            claveUnidad: 'E48',
            description: 'Item PAC Timeout',
            quantity: '1.0000',
            unitPrice: '100.0000',
          },
        ],
      });

      // Stamp fails due to simulated PAC timeout
      await assert.rejects(
        serviceWithFailingPac.stampFiscalInvoice({
          organizationId: tenantAId,
          invoiceId: draft.id,
        }),
        PacTimeoutError,
      );

      // Verify invoice remains in DRAFT in database
      const fetchedDraft = await billingService.getFiscalInvoiceById(tenantAId, draft.id);
      assert.equal(fetchedDraft?.status, 'DRAFT');
      assert.equal(fetchedDraft?.uuid, null);
    });

    it('WP021-CS-09: OQ-ARCH-02 Batch Candidate Query and Global Invoice Batch creation', async () => {
      const queryResult = await billingService.queryUnclaimedFiscalFolios({
        organizationId: tenantAId,
        branchId: branchA1Id,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });

      assert.equal(queryResult.organizationId, tenantAId);
      assert.equal(queryResult.branchId, branchA1Id);
      assert.ok(Array.isArray(queryResult.candidateFolios));

      const batch = await billingService.createGlobalInvoiceBatch({
        organizationId: tenantAId,
        branchId: branchA1Id,
        periodo: '04', // Mensual
        mes: '09',
        anio: 2026,
        folioCount: 15,
        subtotalAmount: '15000.0000',
        taxAmount: '2400.0000',
        totalAmount: '17400.0000',
        metadata: { note: 'Global ticket consolidation for September' },
      });

      assert.equal(batch.organizationId, tenantAId);
      assert.equal(batch.periodo, '04');
      assert.equal(batch.mes, '09');
      assert.equal(batch.anio, 2026);
      assert.equal(batch.folioCount, 15);
      assert.equal(batch.totalAmount, '17400.0000');
      assert.equal(batch.status, 'DRAFT');
    });
  },
);
