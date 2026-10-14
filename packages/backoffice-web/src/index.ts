/**
 * TRIDENTPOS WP-024: Corporate Backoffice Web Portal Barrel Export
 * Authoritative exports for multi-tenant administration, RBAC, Catalog, Inventory, Procurement, Finance, and BI.
 */

export const BACKOFFICE_WEB_PACKAGE_NAME = '@trident/backoffice-web';
export const BACKOFFICE_WEB_PACKAGE_VERSION = '0.1.0';

export interface BackofficeWebPackageInfo {
  readonly name: string;
  readonly version: string;
  readonly coreDependency: string;
  readonly uiDependency: string;
}

export function getBackofficeWebPackageInfo(): BackofficeWebPackageInfo {
  return {
    name: BACKOFFICE_WEB_PACKAGE_NAME,
    version: BACKOFFICE_WEB_PACKAGE_VERSION,
    coreDependency: '@trident/core',
    uiDependency: '@trident/ui',
  };
}

// Canonical Types
export * from './types.js';

// Security & CSP (SEC-VAL-07)
export * from './security.js';

// ADR-012 Scale-4 Numerics & Currency Formatter
export * from './numerics.js';

// RBAC & Session Management
export * from './auth/rbac-guard.js';
export * from './auth/session-store.js';

// API Client & Optimistic Mutations
export * from './api/client.js';

// Domain Services
export * from './modules/catalog/catalog-service.js';
export * from './modules/inventory/inventory-service.js';
export * from './modules/procurement/procurement-service.js';
export * from './modules/finance/finance-service.js';
export * from './modules/analytics/analytics-service.js';

// UI Components & Layouts
export * from './components/layout/BackofficeLayout.js';
export * from './components/table/DataTable.js';
export * from './components/feedback/OptimisticNotice.js';

// Module Feature Views
export * from './modules/catalog/CatalogView.js';
export * from './modules/catalog/RecipeBuilderView.js';
export * from './modules/inventory/WarehouseStockView.js';
export * from './modules/inventory/KardexLedgerView.js';
export * from './modules/procurement/PurchaseOrdersView.js';
export * from './modules/finance/CashReconciliationView.js';
export * from './modules/finance/GlobalInvoicingBatchView.js';
export * from './modules/analytics/BiDashboardView.js';
export * from './modules/settings/StaffRbacView.js';
