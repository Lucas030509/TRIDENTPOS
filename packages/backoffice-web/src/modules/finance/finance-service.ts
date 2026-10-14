/**
 * TRIDENTPOS WP-024: Finance & Cash Reconciliation Service
 * Handles AP/AR balance tracking, daily cash shift variances, and month-end global invoicing batches (OQ-ARCH-02 / DEC-018).
 */

import type {
  ApRecord,
  ArRecord,
  CashShiftReconciliation,
  GlobalInvoicingBatch,
} from '../../types.js';
import { addScale4, compareScale4, subScale4 } from '../../numerics.js';

export interface ComputeCashShiftVarianceParams {
  shiftId: string;
  cashierName: string;
  stationName: string;
  openedAt: string;
  closedAt: string;
  startingFloatScale4: string;
  totalCashSalesScale4: string;
  totalCashPayoutsScale4: string;
  declaredCashScale4: string;
}

export class FinanceService {
  private apRecords: ApRecord[] = [];
  private arRecords: ArRecord[] = [];
  private reconciliations: CashShiftReconciliation[] = [];
  private globalBatches: GlobalInvoicingBatch[] = [];

  constructor(initialData?: {
    apRecords?: ApRecord[];
    arRecords?: ArRecord[];
    reconciliations?: CashShiftReconciliation[];
    globalBatches?: GlobalInvoicingBatch[];
  }) {
    if (initialData?.apRecords) this.apRecords = [...initialData.apRecords];
    if (initialData?.arRecords) this.arRecords = [...initialData.arRecords];
    if (initialData?.reconciliations) this.reconciliations = [...initialData.reconciliations];
    if (initialData?.globalBatches) this.globalBatches = [...initialData.globalBatches];
  }

  public getApRecords(): readonly ApRecord[] {
    return this.apRecords;
  }

  public getArRecords(): readonly ArRecord[] {
    return this.arRecords;
  }

  public getReconciliations(): readonly CashShiftReconciliation[] {
    return this.reconciliations;
  }

  public getGlobalInvoicingBatches(branchId?: string): readonly GlobalInvoicingBatch[] {
    if (branchId) {
      return this.globalBatches.filter((b) => b.branchId === branchId);
    }
    return this.globalBatches;
  }

  /**
   * Reconciles cash shift:
   * Expected = startingFloat + cashSales - cashPayouts
   * Variance = declared - expected
   */
  public reconcileCashShift(params: ComputeCashShiftVarianceParams): CashShiftReconciliation {
    // 1. Expected Cash
    const totalInflow = addScale4(params.startingFloatScale4, params.totalCashSalesScale4);
    const expectedCashScale4 = subScale4(totalInflow, params.totalCashPayoutsScale4);

    // 2. Variance = declared - expected
    const varianceScale4 = subScale4(params.declaredCashScale4, expectedCashScale4);
    const comparison = compareScale4(varianceScale4, '0.0000');

    let status: CashShiftReconciliation['status'] = 'BALANCED';
    if (comparison < 0) {
      status = 'SHORTAGE';
    } else if (comparison > 0) {
      status = 'SURPLUS';
    }

    const record: CashShiftReconciliation = {
      shiftId: params.shiftId,
      cashierName: params.cashierName,
      stationName: params.stationName,
      openedAt: params.openedAt,
      closedAt: params.closedAt,
      startingFloatScale4: params.startingFloatScale4,
      totalCashSalesScale4: params.totalCashSalesScale4,
      totalCashPayoutsScale4: params.totalCashPayoutsScale4,
      expectedCashScale4,
      declaredCashScale4: params.declaredCashScale4,
      varianceScale4,
      status,
      supervisorApproved: false,
    };

    this.reconciliations.push(record);
    return record;
  }

  /**
   * Approves a cash shift reconciliation with supervisor sign-off.
   */
  public approveReconciliation(shiftId: string): CashShiftReconciliation {
    const idx = this.reconciliations.findIndex((r) => r.shiftId === shiftId);
    if (idx === -1) {
      throw new Error(`Shift reconciliation '${shiftId}' not found`);
    }

    const updated = {
      ...this.reconciliations[idx]!,
      supervisorApproved: true,
    };
    this.reconciliations[idx] = updated;
    return updated;
  }

  /**
   * Prepares a month-end global invoicing batch for unclaimed tickets (OQ-ARCH-02 / DEC-018).
   */
  public prepareGlobalInvoicingBatch(params: {
    periodMonth: string;
    branchId: string;
    tickets: readonly { subtotalScale4: string; taxScale4: string; totalScale4: string }[];
  }): GlobalInvoicingBatch {
    let totalSubtotalScale4 = '0.0000';
    let totalTaxScale4 = '0.0000';
    let grandTotalScale4 = '0.0000';

    for (const ticket of params.tickets) {
      totalSubtotalScale4 = addScale4(totalSubtotalScale4, ticket.subtotalScale4);
      totalTaxScale4 = addScale4(totalTaxScale4, ticket.taxScale4);
      grandTotalScale4 = addScale4(grandTotalScale4, ticket.totalScale4);
    }

    const batch: GlobalInvoicingBatch = {
      batchId: `gb-${params.periodMonth}-${params.branchId}`,
      periodMonth: params.periodMonth,
      branchId: params.branchId,
      unclaimedTicketsCount: params.tickets.length,
      totalSubtotalScale4,
      totalTaxScale4,
      grandTotalScale4,
      status: 'PENDING_REVIEW',
    };

    this.globalBatches.push(batch);
    return batch;
  }
}
