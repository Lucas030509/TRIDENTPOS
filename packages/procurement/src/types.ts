/**
 * TRIDENTPOS Procurement Bounded Context Types
 * Implements authoritative domain models per ACR-2026-018 and DATA_MODEL.md Sec 2.3.
 */

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export interface Supplier {
  id: string;
  organizationId: string;
  code: string;
  tradeName: string;
  taxId: string;
  creditDays: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateSupplierCommand {
  organizationId: string;
  code: string;
  tradeName: string;
  taxId: string;
  creditDays?: number;
  isActive?: boolean;
}

export interface PurchaseOrderItem {
  id: string;
  organizationId: string;
  purchaseOrderId: string;
  ingredientId: string;
  orderedQuantity: string;
  unitCost: string;
  lineAmount: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  branchId: string;
  supplierId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  totalAmount: string;
  items?: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseOrderItemInput {
  ingredientId: string;
  orderedQuantity: string;
  unitCost: string;
}

export interface CreatePurchaseOrderCommand {
  organizationId: string;
  branchId: string;
  supplierId: string;
  orderNumber: string;
  items: CreatePurchaseOrderItemInput[];
}

export interface PurchaseReceiptItem {
  id: string;
  organizationId: string;
  purchaseReceiptId: string;
  purchaseOrderItemId: string;
  ingredientId: string;
  receivedQuantity: string;
  acceptedUnitCost: string;
  lineAmount: string;
  createdAt: string;
}

export interface PurchaseReceipt {
  id: string;
  organizationId: string;
  branchId: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  receiptNumber: string;
  invoiceReference?: string | null;
  totalAmount: string;
  status: 'CONFIRMED' | 'CANCELLED';
  receivedAt: string;
  createdAt: string;
  items?: PurchaseReceiptItem[];
}

export interface ConfirmReceiptItemInput {
  purchaseOrderItemId: string;
  ingredientId: string;
  receivedQuantity: string;
  acceptedUnitCost: string;
}

export interface ConfirmPurchaseReceiptCommand {
  organizationId: string;
  branchId: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  receiptNumber: string;
  invoiceReference?: string | null;
  receivedAt?: string;
  paymentTerms?: string | null;
  items: ConfirmReceiptItemInput[];
  supervisorAuthorizationToken?: string;
}

export interface RecepcionCompraItemPayload {
  ingredientId: string;
  purchaseOrderItemId: string;
  orderedQuantity: string;
  previouslyReceivedQuantity: string;
  receivedQuantity: string;
  cumulativeReceivedQuantity: string;
  remainingQuantity: string;
  acceptedUnitCost: string;
  lineAmount: string;
}

export interface RecepcionCompraRegistradaPayload {
  recepcionId: string;
  organizationId: string;
  branchId: string;
  supplierId: string;
  purchaseOrderId: string;
  warehouseId: string;
  receiptNumber: string;
  invoiceReference: string | null;
  receivedAt: string;
  paymentTerms: string | null;
  totalAmount: string;
  items: RecepcionCompraItemPayload[];
}

export interface ConfirmReceiptResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  receipt: PurchaseReceipt;
  eventPayload: RecepcionCompraRegistradaPayload;
  updatedPurchaseOrderStatus: PurchaseOrderStatus;
}

export type PriceVarianceDisposition =
  'NO_AUTHORIZATION_REQUIRED' | 'SUPERVISOR_AUTHORIZATION_REQUIRED' | 'REJECTED';

export interface PriceVarianceContext {
  organizationId: string;
  branchId: string;
  supplierId: string;
  ingredientId: string;
  orderedUnitCost: string;
  receivedUnitCost: string;
  supervisorAuthorizationToken?: string;
}

export interface PurchasePriceVarianceAuthorizationPolicy {
  evaluatePriceVariance(
    context: PriceVarianceContext,
  ): PriceVarianceDisposition | Promise<PriceVarianceDisposition>;
}
