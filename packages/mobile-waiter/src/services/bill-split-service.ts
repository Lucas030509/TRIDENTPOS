/**
 * TRIDENTPOS WP-025: DEC-015 / OQ-SSOT-06 Bill Splitting Service
 * Stateful bill splitting coordinator for handheld waiter app.
 */

import type { BillSplitMode, BillSplitResult, ComandaItemDraft, DiningTable } from '../types.js';
import { calculateProportionalSplit } from '../numerics.js';

export class BillSplitService {
  /**
   * Generates a proportional split draft for a dining table.
   */
  public splitTableBill(params: {
    table: DiningTable;
    mode: BillSplitMode;
    splitCount?: number;
    itemAssignments?: readonly { subAccountIndex: number; item: ComandaItemDraft }[];
    totalDiscountScale4?: string;
    totalTipScale4?: string;
  }): BillSplitResult {
    return calculateProportionalSplit({
      mode: params.mode,
      splitCount: params.splitCount,
      itemAssignments: params.itemAssignments,
      originalTotalScale4: params.table.totalBalanceScale4,
      totalDiscountScale4: params.totalDiscountScale4,
      totalTipScale4: params.totalTipScale4,
    });
  }
}
