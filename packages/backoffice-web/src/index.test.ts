/**
 * TRIDENTPOS WP-024: Corporate Backoffice Web Portal Test Suite
 * Validates SEC-VAL-07 CSP & XSS sanitization, ADR-012 scale-4 numerics, RBAC route guards,
 * data table engine, optimistic mutation rollback, and module services.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackofficeWebPackageInfo,
  BACKOFFICE_WEB_PACKAGE_NAME,
  CANONICAL_BACKOFFICE_CSP,
  buildCspHeader,
  validateCspPolicy,
  escapeHtml,
  sanitizeUserInput,
  toScale4BigInt,
  fromScale4BigInt,
  addScale4,
  subScale4,
  multiplyScale4,
  divideScale4,
  compareScale4,
  formatCurrencyScale4,
  parseCurrencyToScale4,
  calculatePortionCostScale4,
  calculateGrossQuantityScale4,
  hasPermission,
  hasRole,
  canAccessBranch,
  evaluateRouteGuard,
  ROLE_DEFAULT_PERMISSIONS,
  BackofficeSessionStore,
  BackofficeApiClient,
  processTableData,
  CatalogService,
  InventoryService,
  ProcurementService,
  FinanceService,
  AnalyticsService,
  type BackofficeUser,
  type BackofficeSession,
  type StockBalanceEntry,
  type RawCompletedOrder,
} from './index.js';

describe('TRIDENTPOS WP-024: Corporate Backoffice Web Portal Suite', () => {
  // =========================================================================
  // 1. Package Metadata & Architecture
  // =========================================================================
  describe('Package Metadata & Boundaries', () => {
    it('returns valid package metadata and dependencies', () => {
      const info = getBackofficeWebPackageInfo();
      assert.equal(info.name, BACKOFFICE_WEB_PACKAGE_NAME);
      assert.equal(info.version, '0.1.0');
      assert.equal(info.coreDependency, '@trident/core');
      assert.equal(info.uiDependency, '@trident/ui');
    });
  });

  // =========================================================================
  // 2. SEC-VAL-07: Content Security Policy & XSS Prevention
  // =========================================================================
  describe('SEC-VAL-07: CSP & XSS Sanitization Engine', () => {
    it('generates canonical CSP header with strict clickjacking and plugin protections', () => {
      const header = buildCspHeader(CANONICAL_BACKOFFICE_CSP);
      assert.ok(header.includes("default-src 'self'"));
      assert.ok(header.includes("frame-ancestors 'none'"));
      assert.ok(header.includes("object-src 'none'"));
      assert.ok(header.includes("base-uri 'self'"));
    });

    it('validates CSP policy and passes canonical configuration', () => {
      const header = buildCspHeader(CANONICAL_BACKOFFICE_CSP);
      const report = validateCspPolicy(header);
      assert.equal(report.isValid, true);
      assert.equal(report.errors.length, 0);
    });

    it('detects insecure CSP configurations fail-closed', () => {
      // Insecure: allows wildcard in script-src and missing frame-ancestors
      const insecureCsp = "default-src 'self'; script-src *; object-src 'none'";
      const report = validateCspPolicy(insecureCsp);
      assert.equal(report.isValid, false);
      assert.ok(report.errors.some((e) => e.includes("Missing or non-strict 'frame-ancestors'")));
      assert.ok(
        report.errors.some((e) => e.includes("Dangerous wildcard '*' found in script-src")),
      );
    });

    it('escapes dangerous HTML characters to neutralize reflected XSS', () => {
      const dirty = '<script>alert("xss & stolen")</script>';
      const clean = escapeHtml(dirty);
      assert.equal(clean, '&lt;script&gt;alert(&quot;xss &amp; stolen&quot;)&lt;&#x2F;script&gt;');
    });

    it('strips dangerous scripts, iframes, and inline JS protocols', () => {
      const dirty =
        '<script>alert(1)</script>Hola <iframe src="evil.com"></iframe><a href="javascript:alert(2)">Link</a>';
      const clean = sanitizeUserInput(dirty);
      assert.equal(clean, 'Hola <a href="alert(2)">Link</a>');
    });
  });

  // =========================================================================
  // 3. ADR-012: Scale-4 Numerics & Exact Currency Formatting
  // =========================================================================
  describe('ADR-012 Scale-4 UI Numerics & Exact Money', () => {
    it('converts between BigInt and canonical scale-4 strings without precision loss', () => {
      assert.equal(toScale4BigInt('1250.5000'), 12505000n);
      assert.equal(toScale4BigInt('-45.1234'), -451234n);
      assert.equal(fromScale4BigInt(12505000n), '1250.5000');
      assert.equal(fromScale4BigInt(-451234n), '-45.1234');
    });

    it('executes scale-4 arithmetic accurately', () => {
      assert.equal(addScale4('100.2500', '50.7500'), '151.0000');
      assert.equal(subScale4('100.2500', '25.5000'), '74.7500');
      assert.equal(multiplyScale4('10.0000', '2.5000'), '25.0000');
      assert.equal(divideScale4('100.0000', '4.0000'), '25.0000');
      assert.equal(compareScale4('100.0000', '99.9999'), 1);
    });

    it('formats scale-4 values into human currency ($1,250.00)', () => {
      assert.equal(formatCurrencyScale4('1250.0000'), '$1,250.00');
      assert.equal(formatCurrencyScale4('0.0000'), '$0.00');
      assert.equal(formatCurrencyScale4('-50.2500'), '-$50.25');
      assert.equal(formatCurrencyScale4('99.9999'), '$100.00'); // rounded cents
    });

    it('parses user currency inputs back into scale-4 strings', () => {
      assert.equal(parseCurrencyToScale4('$1,250.50'), '1250.5000');
      assert.equal(parseCurrencyToScale4('1250.5'), '1250.5000');
      assert.equal(parseCurrencyToScale4(''), '0.0000');
    });

    it('calculates gross ingredient quantity accounting for waste/merma factor', () => {
      // 1.0000 kg net with 20% waste factor: gross = 1.0000 / (1 - 0.20) = 1.2500 kg
      const gross = calculateGrossQuantityScale4('1.0000', '20.0000');
      assert.equal(gross, '1.2500');
    });

    it('calculates portion cost from batch cost and yield', () => {
      // $500.00 batch cost yielding 10 portions = $50.00 per portion
      const portionCost = calculatePortionCostScale4('500.0000', 10);
      assert.equal(portionCost, '50.0000');
    });
  });

  // =========================================================================
  // 4. RBAC Route Guards & Authorization Engine
  // =========================================================================
  describe('RBAC Route Guards & Authorization', () => {
    const adminUser: BackofficeUser = {
      id: 'u-admin',
      email: 'admin@restaurant.com',
      displayName: 'Administrador General',
      orgId: 'org-01',
      assignedBranchIds: [], // Global access
      roles: ['ADMIN'],
      permissions: [],
    };

    const chefUser: BackofficeUser = {
      id: 'u-chef',
      email: 'chef@restaurant.com',
      displayName: 'Chef Ejecutivo',
      orgId: 'org-01',
      assignedBranchIds: ['br-01'],
      roles: ['CHEF'],
      permissions: [],
    };

    const cajeroUser: BackofficeUser = {
      id: 'u-cajero',
      email: 'caja@restaurant.com',
      displayName: 'Cajero Turno',
      orgId: 'org-01',
      assignedBranchIds: ['br-01'],
      roles: ['CAJERO'],
      permissions: [],
    };

    it('evaluates role permissions correctly across profiles', () => {
      assert.equal(hasRole(chefUser, 'CHEF'), true);
      assert.equal(hasRole(chefUser, 'ADMIN'), false);
      assert.ok(ROLE_DEFAULT_PERMISSIONS.CHEF.includes('recipe.write'));

      assert.equal(hasPermission(adminUser, 'catalog.write'), true);
      assert.equal(hasPermission(adminUser, 'finance.settle'), true);

      assert.equal(hasPermission(chefUser, 'recipe.write'), true);
      assert.equal(hasPermission(chefUser, 'catalog.read'), true);
      assert.equal(hasPermission(chefUser, 'finance.settle'), false);

      assert.equal(hasPermission(cajeroUser, 'finance.cash_reconciliation'), true);
      assert.equal(hasPermission(cajeroUser, 'recipe.write'), false);
    });

    it('enforces route protection fail-closed on unauthorized paths', () => {
      // Chef accessing /recetas -> ALLOWED
      const chefRecipeAccess = evaluateRouteGuard(chefUser, '/recetas');
      assert.equal(chefRecipeAccess.allowed, true);

      // Chef accessing /finanzas -> DENIED with required permission
      const chefFinanceAccess = evaluateRouteGuard(chefUser, '/finanzas');
      assert.equal(chefFinanceAccess.allowed, false);
      assert.equal(chefFinanceAccess.requiredPermission, 'finance.read');

      // Cajero accessing /corte-caja -> ALLOWED
      const cajeroCutAccess = evaluateRouteGuard(cajeroUser, '/corte-caja');
      assert.equal(cajeroCutAccess.allowed, true);

      // Cajero accessing /usuarios -> DENIED
      const cajeroUsersAccess = evaluateRouteGuard(cajeroUser, '/usuarios');
      assert.equal(cajeroUsersAccess.allowed, false);
      assert.equal(cajeroUsersAccess.requiredPermission, 'users.manage');
    });

    it('verifies branch access restrictions', () => {
      // Admin has global branch access
      assert.equal(canAccessBranch(adminUser, 'br-01'), true);
      assert.equal(canAccessBranch(adminUser, 'br-02'), true);

      // Chef assigned only to br-01
      assert.equal(canAccessBranch(chefUser, 'br-01'), true);
      assert.equal(canAccessBranch(chefUser, 'br-02'), false);
    });

    it('manages session store and enforces branch switching guards', () => {
      const session: BackofficeSession = {
        user: chefUser,
        activeBranchId: 'br-01',
        token: 'jwt-token-123',
        expiresAt: Date.now() + 3600000,
      };

      const store = new BackofficeSessionStore(session);
      assert.equal(store.getSession()?.activeBranchId, 'br-01');

      // Permitted branch switch
      const switchAllowed = store.switchBranch('br-01');
      assert.equal(switchAllowed, true);

      // Unauthorized branch switch (chef does not have br-02)
      const switchDenied = store.switchBranch('br-02');
      assert.equal(switchDenied, false);
      assert.equal(store.getSession()?.activeBranchId, 'br-01');
    });
  });

  // =========================================================================
  // 5. Data Table Engine (Search, Filter, Sort, Pagination)
  // =========================================================================
  describe('High-Performance Data Table Engine', () => {
    interface TestItem extends Record<string, unknown> {
      id: string;
      name: string;
      category: string;
      price: number;
    }

    const testData: TestItem[] = [
      { id: '1', name: 'Tacos al Pastor', category: 'Alimentos', price: 95 },
      { id: '2', name: 'Guacamole Especial', category: 'Entradas', price: 120 },
      { id: '3', name: 'Cerveza Corona', category: 'Bebidas', price: 55 },
      { id: '4', name: 'Refresco Cola', category: 'Bebidas', price: 40 },
      { id: '5', name: 'Tacos de Asada', category: 'Alimentos', price: 110 },
    ];

    it('filters data by text search across specified fields', () => {
      const res = processTableData({
        data: testData,
        searchQuery: 'tacos',
        searchFields: ['name'],
      });
      assert.equal(res.items.length, 2);
      assert.equal(res.totalCount, 2);
    });

    it('filters data by column filter', () => {
      const res = processTableData({
        data: testData,
        filters: { category: 'Bebidas' },
      });
      assert.equal(res.items.length, 2);
    });

    it('sorts numeric fields ascending and descending', () => {
      const asc = processTableData({
        data: testData,
        sort: { key: 'price', direction: 'asc' },
      });
      assert.equal(asc.items[0]?.name, 'Refresco Cola'); // 40
      assert.equal(asc.items[asc.items.length - 1]?.name, 'Guacamole Especial'); // 120

      const desc = processTableData({
        data: testData,
        sort: { key: 'price', direction: 'desc' },
      });
      assert.equal(desc.items[0]?.name, 'Guacamole Especial'); // 120
    });

    it('paginates large datasets smoothly', () => {
      const res = processTableData({
        data: testData,
        pagination: { pageIndex: 1, pageSize: 2 },
      });
      assert.equal(res.totalPages, 3);
      assert.equal(res.items.length, 2);
      assert.equal(res.items[0]?.id, '3');
      assert.equal(res.items[1]?.id, '4');
    });
  });

  // =========================================================================
  // 6. Optimistic UI Updates & Error Rollback
  // =========================================================================
  describe('Optimistic Updates & Error Rollback Engine', () => {
    it('commits state when remote API call succeeds', async () => {
      const client = new BackofficeApiClient({ baseUrl: 'https://api.tridentpos.internal' });
      let appState = { count: 10 };

      const res = await client.executeOptimisticMutation({
        currentState: appState,
        applyOptimistic: (s) => ({ count: s.count + 1 }),
        apiCall: async () => ({ ok: true, data: { count: 11 } }),
        onUpdate: (newState) => {
          appState = newState;
        },
      });

      assert.equal(res.ok, true);
      assert.equal(appState.count, 11);
    });

    it('rolls back state cleanly when remote API call fails', async () => {
      const client = new BackofficeApiClient({ baseUrl: 'https://api.tridentpos.internal' });
      let appState = { count: 10 };
      let errorNotified = false;

      const res = await client.executeOptimisticMutation({
        currentState: appState,
        applyOptimistic: (s) => ({ count: s.count + 1 }),
        apiCall: async () => ({
          ok: false,
          error: { code: 'CONFLICT_OCC', message: 'Stale version', retryable: true },
        }),
        onUpdate: (newState) => {
          appState = newState;
        },
        onError: () => {
          errorNotified = true;
        },
      });

      assert.equal(res.ok, false);
      assert.equal(appState.count, 10); // Rolled back to 10
      assert.equal(errorNotified, true);
    });
  });

  // =========================================================================
  // 7. Domain Modules Services
  // =========================================================================
  describe('Backoffice Domain Services', () => {
    it('CatalogService formulates recipe, calculates waste and suggested retail price', () => {
      const service = new CatalogService();
      const recipe = service.formulateRecipe({
        productId: 'prod-burger',
        productName: 'Hamburguesa Especial',
        portionYield: 1,
        targetMarginPercent: '65.0000', // 65% target margin -> 35% food cost
        items: [
          {
            ingredientId: 'ing-carne',
            ingredientCode: 'CARNE-01',
            ingredientName: 'Carne Molida Sirloin',
            unitOfMeasure: 'KG',
            netQuantityScale4: '0.2000', // 200g
            wasteFactorPercent: '10.0000', // 10% cooking shrinkage
            unitCostScale4: '180.0000', // $180/kg
          },
          {
            ingredientId: 'ing-pan',
            ingredientCode: 'PAN-01',
            ingredientName: 'Pan Brioche Artesanal',
            unitOfMeasure: 'PZA',
            netQuantityScale4: '1.0000',
            wasteFactorPercent: '0.0000',
            unitCostScale4: '12.5000', // $12.50
          },
        ],
      });

      assert.ok(recipe);
      assert.equal(recipe.productId, 'prod-burger');
      // Gross carne = 0.2000 / (1 - 0.10) = 0.2222
      // Line cost carne = 0.2222 * 180 = ~40.00
      // Portion cost = batch cost
      assert.ok(toScale4BigInt(recipe.portionCostScale4) > 500000n); // > $50.00
      assert.ok(toScale4BigInt(recipe.suggestedPriceScale4) > 1400000n); // > $140.00
    });

    it('InventoryService detects low stock items below min-par and calculates total valuation', () => {
      const balances: StockBalanceEntry[] = [
        {
          ingredientId: 'ing-1',
          ingredientCode: 'TOMATE',
          ingredientName: 'Tomate Saladet',
          warehouseId: 'wh-main',
          warehouseName: 'Almacén Central',
          currentStockScale4: '3.0000',
          unitOfMeasure: 'KG',
          minParLevelScale4: '10.0000', // Critical
          maxParLevelScale4: '30.0000',
          isLowStock: true,
          averageCostScale4: '25.0000',
          totalValuationScale4: '75.0000',
        },
        {
          ingredientId: 'ing-2',
          ingredientCode: 'CEBOLLA',
          ingredientName: 'Cebolla Blanca',
          warehouseId: 'wh-main',
          warehouseName: 'Almacén Central',
          currentStockScale4: '20.0000',
          unitOfMeasure: 'KG',
          minParLevelScale4: '5.0000',
          maxParLevelScale4: '25.0000',
          isLowStock: false,
          averageCostScale4: '15.0000',
          totalValuationScale4: '300.0000',
        },
      ];

      const service = new InventoryService({ stockBalances: balances });
      const alerts = service.getLowStockAlerts();
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0]?.ingredientCode, 'TOMATE');

      const totalVal = service.calculateTotalInventoryValuation();
      assert.equal(totalVal, '375.0000'); // 75 + 300
    });

    it('ProcurementService generates replenishment suggestions (OQ-SSOT-05) and flags price variances', () => {
      const balances: StockBalanceEntry[] = [
        {
          ingredientId: 'ing-1',
          ingredientCode: 'QUESO',
          ingredientName: 'Queso Gouda',
          warehouseId: 'wh-01',
          warehouseName: 'Cámara Fría',
          currentStockScale4: '2.0000',
          unitOfMeasure: 'KG',
          minParLevelScale4: '10.0000',
          maxParLevelScale4: '25.0000',
          isLowStock: true,
          averageCostScale4: '140.0000',
          totalValuationScale4: '280.0000',
        },
      ];

      const service = new ProcurementService();
      // OQ-SSOT-05 Par-level replenishment
      const suggestions = service.generateReplenishmentSuggestions(balances);
      assert.equal(suggestions.length, 1);
      assert.equal(suggestions[0]?.suggestedQuantityScale4, '23.0000'); // maxPar(25) - current(2)

      // PO creation with contract price variance
      const po = service.createPurchaseOrder({
        supplierId: 'sup-lacteos',
        supplierName: 'Lácteos del Norte',
        branchId: 'br-01',
        items: [
          {
            ingredientId: 'ing-1',
            ingredientName: 'Queso Gouda',
            orderedQuantityScale4: '23.0000',
            unitCostScale4: '154.0000', // $154 vs contract $140 (+10% variance)
            contractPriceScale4: '140.0000',
          },
        ],
      });

      assert.equal(po.status, 'DRAFT');
      assert.equal(po.items[0]?.priceVariancePercent, '10.0000'); // +10%
    });

    it('FinanceService reconciles cash shift and flags shortages, balanced and surplus', () => {
      const service = new FinanceService();

      // Balanced shift: starting 500 + sales 1500 - payouts 200 = expected 1800. declared 1800 -> BALANCED
      const balanced = service.reconcileCashShift({
        shiftId: 'sh-01',
        cashierName: 'Ana López',
        stationName: 'Caja 1',
        openedAt: '2026-10-14T08:00:00Z',
        closedAt: '2026-10-14T16:00:00Z',
        startingFloatScale4: '500.0000',
        totalCashSalesScale4: '1500.0000',
        totalCashPayoutsScale4: '200.0000',
        declaredCashScale4: '1800.0000',
      });
      assert.equal(balanced.status, 'BALANCED');
      assert.equal(balanced.varianceScale4, '0.0000');

      // Shortage shift: expected 1800, declared 1750 -> -$50 SHORTAGE
      const shortage = service.reconcileCashShift({
        shiftId: 'sh-02',
        cashierName: 'Carlos Ruiz',
        stationName: 'Caja 2',
        openedAt: '2026-10-14T16:00:00Z',
        closedAt: '2026-10-14T23:30:00Z',
        startingFloatScale4: '500.0000',
        totalCashSalesScale4: '1500.0000',
        totalCashPayoutsScale4: '200.0000',
        declaredCashScale4: '1750.0000',
      });
      assert.equal(shortage.status, 'SHORTAGE');
      assert.equal(shortage.varianceScale4, '-50.0000');
    });

    it('FinanceService collates month-end global invoicing batch (OQ-ARCH-02 / DEC-018)', () => {
      const service = new FinanceService();
      const batch = service.prepareGlobalInvoicingBatch({
        periodMonth: '2026-10',
        branchId: 'br-01',
        tickets: [
          { subtotalScale4: '200.0000', taxScale4: '32.0000', totalScale4: '232.0000' },
          { subtotalScale4: '300.0000', taxScale4: '48.0000', totalScale4: '348.0000' },
        ],
      });

      assert.equal(batch.periodMonth, '2026-10');
      assert.equal(batch.unclaimedTicketsCount, 2);
      assert.equal(batch.totalSubtotalScale4, '500.0000');
      assert.equal(batch.totalTaxScale4, '80.0000');
      assert.equal(batch.grandTotalScale4, '580.0000');
      assert.equal(batch.status, 'PENDING_REVIEW');
    });

    it('AnalyticsService aggregates sales KPIs, channels and hourly velocity', () => {
      const service = new AnalyticsService();
      const orders: RawCompletedOrder[] = [
        {
          orderId: 'ord-1',
          completedAt: '2026-10-14T14:30:00Z',
          channel: 'SALON',
          subtotalScale4: '400.0000',
          taxScale4: '64.0000',
          discountsScale4: '0.0000',
          totalScale4: '464.0000',
          items: [
            { productId: 'p1', productName: 'Corte Ribeye', quantity: 1, priceScale4: '400.0000' },
          ],
        },
        {
          orderId: 'ord-2',
          completedAt: '2026-10-14T14:45:00Z',
          channel: 'UBER_EATS',
          subtotalScale4: '200.0000',
          taxScale4: '32.0000',
          discountsScale4: '20.0000',
          totalScale4: '212.0000',
          items: [
            { productId: 'p2', productName: 'Hamburguesa', quantity: 1, priceScale4: '200.0000' },
          ],
        },
      ];

      const kpis = service.computeSalesKpis('2026-10-14', orders);
      assert.equal(kpis.grossSalesScale4, '600.0000');
      assert.equal(kpis.netSalesScale4, '580.0000'); // 600 - 20
      assert.equal(kpis.taxAmountScale4, '96.0000');
      assert.equal(kpis.completedOrdersCount, 2);
      assert.equal(kpis.averageTicketScale4, '338.0000'); // (580 + 96) / 2

      const channels = service.computeChannelBreakdown(orders);
      assert.equal(channels.length, 2);
      assert.equal(channels[0]?.channel, 'SALON'); // $464 > $212
    });
  });
});
