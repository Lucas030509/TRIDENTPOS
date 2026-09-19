/**
 * TRIDENTPOS Finance Types & Domain Contracts (WP-020)
 * Bounded Context: Finance
 */

export type AccountsPayableStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export type AccountsReceivableStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'DEFAULTED';

export type ScheduledPaymentStatus = 'PENDING' | 'EXECUTED' | 'CANCELLED';

export interface AccountsPayable {
  id: string;
  organizationId: string;
  branchId: string;
  supplierId: string;
  purchaseReceiptId: string;
  totalAmount: string; // Scale-4 string
  balanceDue: string; // Scale-4 string
  dueDate: string; // YYYY-MM-DD
  status: AccountsPayableStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface ScheduledPayment {
  id: string;
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  scheduledAmount: string; // Scale-4 string
  scheduledDate: string; // YYYY-MM-DD
  status: ScheduledPaymentStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface AccountsReceivable {
  id: string;
  organizationId: string;
  branchId: string;
  customerId: string;
  referenceAccountId: string;
  totalAmount: string; // Scale-4 string
  balanceDue: string; // Scale-4 string
  dueDate: string; // YYYY-MM-DD
  status: AccountsReceivableStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface BranchOperatingExpense {
  id: string;
  organizationId: string;
  branchId: string;
  amount: string; // Scale-4 string
  expenseDate: string; // ISO timestamp
  category: string;
  receiptAttachmentUrl?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface CashReconciliation {
  id: string;
  organizationId: string;
  branchId: string;
  sourceCutId: string;
  operationalDate: string; // YYYY-MM-DD
  expectedCash: string; // Scale-4 string
  actualCash: string; // Scale-4 string
  variance: string; // Scale-4 string (actual - expected)
  hasVariance: boolean;
  createdAt: string;
}

/**
 * Consumed WP-019 Procurement Event (RecepcionCompraRegistrada)
 */
export interface RecepcionCompraRegistradaEvent {
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
  items: Array<{
    purchaseOrderItemId: string;
    ingredientId: string;
    orderedQuantity: string;
    receivedQuantity: string;
    cumulativeReceivedQuantity: string;
    remainingQuantity: string;
    acceptedUnitCost: string;
    lineAmount: string;
  }>;
}

/**
 * Consumed POS Closing Event (CorteZGenerado)
 */
export interface CorteZGeneradoEvent {
  corteZId?: string;
  sourceCutId?: string;
  folio?: string;
  organizationId: string;
  branchId: string;
  operationalDate: string; // YYYY-MM-DD
  expectedCash: string; // Scale-4 string (expected physical cash in drawer)
  actualCash: string; // Scale-4 string (actual declared physical cash)
  totalGrossSales?: string;
  totalNetSales?: string;
  paymentBreakdown?: Array<{
    method: string;
    amount: string;
  }>;
}

/**
 * Commands
 */
export interface ApplyAccountsPayablePaymentCommand {
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  paymentAmount: string; // Scale-4 string
  paymentDate?: string;
  reference?: string;
}

export interface CreateScheduledPaymentCommand {
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  scheduledAmount: string; // Scale-4 string
  scheduledDate: string; // YYYY-MM-DD
}

export interface CreateReceivableChargeCommand {
  organizationId: string;
  branchId: string;
  customerId: string;
  referenceAccountId: string;
  totalAmount: string; // Scale-4 string
  dueDate: string; // YYYY-MM-DD
  requireCreditPolicy?: boolean;
  requiresCreditCheck?: boolean;
}

export interface SettleReceivableCommand {
  organizationId: string;
  branchId: string;
  accountsReceivableId: string;
  settlementAmount: string; // Scale-4 string
  settlementDate?: string;
}

export interface RegisterOperatingExpenseCommand {
  organizationId: string;
  branchId: string;
  amount: string; // Scale-4 string
  category: string;
  expenseDate?: string;
  receiptAttachmentUrl?: string | null;
  notes?: string | null;
}

export interface ReconcileCashCommand {
  organizationId: string;
  branchId: string;
  sourceCutId: string;
  operationalDate: string; // YYYY-MM-DD
  expectedCash: string; // Scale-4 string
  actualCash: string; // Scale-4 string
}

/**
 * Results
 */
export interface ProcessPurchaseReceiptResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsPayable: AccountsPayable;
}

export interface CreateReceivableChargeResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsReceivable: AccountsReceivable;
}

export interface ReconcileCashResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  reconciliation: CashReconciliation;
}
