/**
 * TRIDENTPOS Finance Types & Domain Contracts (WP-020)
 * Bounded Context: Finance
 */

export type AccountsPayableStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export type AccountsReceivableStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'DEFAULTED';

export type ScheduledPaymentStatus = 'PENDING' | 'EXECUTED' | 'CANCELLED';

export type FinanceTransactionKind = 'APPLY' | 'REVERSAL';

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

export interface AccountsPayablePayment {
  id: string;
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  transactionKind: FinanceTransactionKind;
  amount: string; // Scale-4 string
  paymentDate: string; // ISO timestamp
  referenceId: string;
  reversalOfTransactionId?: string | null;
  createdAt: string;
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

export interface AccountsReceivableSettlement {
  id: string;
  organizationId: string;
  branchId: string;
  accountsReceivableId: string;
  transactionKind: FinanceTransactionKind;
  amount: string; // Scale-4 string
  settlementDate: string; // ISO timestamp
  referenceId: string;
  reversalOfTransactionId?: string | null;
  createdAt: string;
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
 * Neutral Payment Terms Due Date Resolver Contract
 * Note: Contract only - contains NO concrete default product policy.
 */
export interface PaymentTermsDueDateResolverContext {
  organizationId: string;
  branchId: string;
  supplierId: string;
  purchaseReceiptId: string;
  receivedAt: string;
  paymentTerms?: string | null;
}

export interface PaymentTermsDueDateResolver {
  resolveDueDate(context: PaymentTermsDueDateResolverContext): Promise<string> | string;
}

/**
 * Finance Neutral Cash Closing Facts Input for Reconciliation
 * Note: Finance pure domain input representing resolved cash facts.
 */
export interface CashClosingFacts {
  organizationId: string;
  branchId: string;
  sourceCutId: string;
  operationalDate: string; // YYYY-MM-DD
  expectedCash: string; // Scale-4 string
  actualCash: string; // Scale-4 string
  notes?: string | null;
}

/**
 * Commands
 */
export interface ApplyAccountsPayablePaymentCommand {
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  paymentAmount: string; // Scale-4 string
  referenceId?: string;
  reference?: string; // Backwards-compatible alias
  paymentDate?: string;
}

export interface ReverseAccountsPayablePaymentCommand {
  organizationId: string;
  branchId: string;
  accountsPayableId: string;
  originalPaymentTransactionId: string;
  reversalReferenceId: string;
  reversalDate?: string;
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
  referenceId?: string;
  reference?: string; // Backwards-compatible alias
  settlementDate?: string;
}

export interface ReverseAccountsReceivableSettlementCommand {
  organizationId: string;
  branchId: string;
  accountsReceivableId: string;
  originalSettlementTransactionId: string;
  reversalReferenceId: string;
  reversalDate?: string;
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

export interface ApplyAccountsPayablePaymentResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsPayable: AccountsPayable;
  payment: AccountsPayablePayment;
}

export interface ReverseAccountsPayablePaymentResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsPayable: AccountsPayable;
  reversal: AccountsPayablePayment;
}

export interface CreateReceivableChargeResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsReceivable: AccountsReceivable;
}

export interface SettleAccountsReceivableResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsReceivable: AccountsReceivable;
  settlement: AccountsReceivableSettlement;
}

export interface ReverseAccountsReceivableSettlementResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  accountsReceivable: AccountsReceivable;
  reversal: AccountsReceivableSettlement;
}

export interface ReconcileCashResult {
  status: 'APPLIED' | 'DUPLICATE_ACCEPTED';
  reconciliation: CashReconciliation;
}
