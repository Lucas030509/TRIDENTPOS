/**
 * TRIDENTPOS WP-024: Corporate Backoffice Web Portal Types
 * Authoritative types for multi-tenant administration, RBAC, Catalog, Inventory, Procurement, Finance, and BI.
 */

export type BackofficeRole = 'ADMIN' | 'GERENTE' | 'CHEF' | 'CAJERO' | 'MESERO' | 'AUDITOR';

export type BackofficePermission =
  | 'catalog.read'
  | 'catalog.write'
  | 'recipe.read'
  | 'recipe.write'
  | 'inventory.read'
  | 'inventory.adjust'
  | 'procurement.read'
  | 'procurement.write'
  | 'procurement.approve'
  | 'finance.read'
  | 'finance.settle'
  | 'finance.cash_reconciliation'
  | 'finance.global_invoice'
  | 'analytics.read'
  | 'settings.read'
  | 'settings.write'
  | 'users.manage';

export interface BackofficeUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly orgId: string;
  readonly assignedBranchIds: readonly string[];
  readonly roles: readonly BackofficeRole[];
  readonly permissions: readonly BackofficePermission[];
}

export interface BackofficeSession {
  readonly user: BackofficeUser;
  readonly activeBranchId: string;
  readonly token: string;
  readonly expiresAt: number;
}

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly requiredPermission?: BackofficePermission;
  readonly badge?: string;
}

export interface NavSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

// -------------------------------------------------------------
// Catalog & Recipe Builder
// -------------------------------------------------------------
export interface CategoryItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface ProductItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string;
  readonly categoryName?: string;
  readonly basePriceScale4: string; // ADR-012 scale-4 string
  readonly taxSchemeId: string;
  readonly taxRatePercent: string;
  readonly isKitchenItem: boolean;
  readonly hasRecipe: boolean;
  readonly isActive: boolean;
}

export interface RecipeItemEntry {
  readonly ingredientId: string;
  readonly ingredientCode: string;
  readonly ingredientName: string;
  readonly unitOfMeasure: string;
  readonly grossQuantityScale4: string;
  readonly netQuantityScale4: string;
  readonly wasteFactorPercent: string; // Merma
  readonly unitCostScale4: string;
  readonly subtotalCostScale4: string;
}

export interface RecipeDefinition {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly portionYield: number;
  readonly items: readonly RecipeItemEntry[];
  readonly totalBatchCostScale4: string;
  readonly portionCostScale4: string;
  readonly targetMarginPercent: string;
  readonly suggestedPriceScale4: string;
}

// -------------------------------------------------------------
// Inventory & Kárdex
// -------------------------------------------------------------
export interface WarehouseItem {
  readonly id: string;
  readonly branchId: string;
  readonly code: string;
  readonly name: string;
  readonly isProductionWarehouse: boolean;
  readonly isActive: boolean;
}

export interface StockBalanceEntry {
  readonly ingredientId: string;
  readonly ingredientCode: string;
  readonly ingredientName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly currentStockScale4: string;
  readonly unitOfMeasure: string;
  readonly minParLevelScale4: string;
  readonly maxParLevelScale4: string;
  readonly isLowStock: boolean;
  readonly averageCostScale4: string;
  readonly totalValuationScale4: string;
}

export type KardexMovementType = 'COMPRA' | 'VENTA' | 'MERMA' | 'AJUSTE' | 'TRASPASO';

export interface KardexMovementEntry {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly timestamp: string;
  readonly warehouseId: string;
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly movementType: KardexMovementType;
  readonly referenceFolio: string;
  readonly quantityDeltaScale4: string;
  readonly resultingBalanceScale4: string;
  readonly unitCostScale4: string;
  readonly performedBy: string;
}

// -------------------------------------------------------------
// Procurement & Purchase Orders
// -------------------------------------------------------------
export interface SupplierEntry {
  readonly id: string;
  readonly rfc: string;
  readonly legalName: string;
  readonly commercialName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly creditDays: number;
  readonly isActive: boolean;
}

export type PurchaseOrderStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItemEntry {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly orderedQuantityScale4: string;
  readonly unitCostScale4: string;
  readonly subtotalScale4: string;
  readonly contractPriceScale4?: string;
  readonly priceVariancePercent?: string;
}

export interface PurchaseOrderEntry {
  readonly id: string;
  readonly folio: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly branchId: string;
  readonly status: PurchaseOrderStatus;
  readonly subtotalScale4: string;
  readonly taxAmountScale4: string;
  readonly totalAmountScale4: string;
  readonly createdAt: string;
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly items: readonly PurchaseOrderItemEntry[];
}

export interface ReplenishmentSuggestion {
  readonly ingredientId: string;
  readonly ingredientCode: string;
  readonly ingredientName: string;
  readonly currentStockScale4: string;
  readonly minParScale4: string;
  readonly maxParScale4: string;
  readonly suggestedQuantityScale4: string;
  readonly preferredSupplierId: string;
  readonly estimatedCostScale4: string;
}

// -------------------------------------------------------------
// Finance, Cash Control & Reconciliation
// -------------------------------------------------------------
export interface ApRecord {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly invoiceFolio: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly originalAmountScale4: string;
  readonly remainingBalanceScale4: string;
  readonly status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
}

export interface ArRecord {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly folio: string;
  readonly issueDate: string;
  readonly originalAmountScale4: string;
  readonly remainingBalanceScale4: string;
  readonly status: 'ACTIVE' | 'SETTLED' | 'DELINQUENT';
}

export interface CashShiftReconciliation {
  readonly shiftId: string;
  readonly cashierName: string;
  readonly stationName: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly startingFloatScale4: string;
  readonly totalCashSalesScale4: string;
  readonly totalCashPayoutsScale4: string;
  readonly expectedCashScale4: string;
  readonly declaredCashScale4: string;
  readonly varianceScale4: string; // declared - expected
  readonly status: 'BALANCED' | 'SHORTAGE' | 'SURPLUS';
  readonly supervisorApproved: boolean;
}

export interface GlobalInvoicingBatch {
  readonly batchId: string;
  readonly periodMonth: string; // e.g. "2026-10"
  readonly branchId: string;
  readonly unclaimedTicketsCount: number;
  readonly totalSubtotalScale4: string;
  readonly totalTaxScale4: string;
  readonly grandTotalScale4: string;
  readonly status: 'PENDING_REVIEW' | 'STAMPED' | 'DISCARDED';
}

// -------------------------------------------------------------
// BI Dashboard & Analytics
// -------------------------------------------------------------
export interface SalesKpiSummary {
  readonly date: string;
  readonly grossSalesScale4: string;
  readonly netSalesScale4: string;
  readonly taxAmountScale4: string;
  readonly discountsScale4: string;
  readonly completedOrdersCount: number;
  readonly averageTicketScale4: string;
}

export interface HourlySalesPoint {
  readonly hour: number; // 0-23
  readonly ordersCount: number;
  readonly totalAmountScale4: string;
}

export interface ChannelRevenueBreakdown {
  readonly channel: string;
  readonly ordersCount: number;
  readonly revenueScale4: string;
  readonly percentOfTotal: string;
}

export interface TopProductMetric {
  readonly productId: string;
  readonly productName: string;
  readonly quantitySold: number;
  readonly revenueScale4: string;
}

// -------------------------------------------------------------
// Data Table State & Controls
// -------------------------------------------------------------
export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  readonly render?: (row: T) => React.ReactNode;
}

export interface TableSortState {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

export interface TableFilterState {
  readonly [key: string]: string | undefined;
}

export interface TablePaginationState {
  readonly pageIndex: number;
  readonly pageSize: number;
}

export interface TableResult<T> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly totalPages: number;
  readonly pageIndex: number;
  readonly pageSize: number;
}

// -------------------------------------------------------------
// API & Optimistic UI
// -------------------------------------------------------------
export interface ApiResponse<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface OptimisticMutationResult<T> {
  readonly optimisticItem: T;
  readonly commitPromise: Promise<ApiResponse<T>>;
  readonly rollback: () => void;
}
