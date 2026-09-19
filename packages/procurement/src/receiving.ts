/**
 * TRIDENTPOS Procurement Physical Receiving Domain Functions
 */

import { PurchaseOrderStatus } from './types.js';
import { InvalidReceiptItemError, OverReceiptNotAuthorizedError } from './errors.js';
import {
  addScale4,
  cmpScale4,
  isNonNegativeScale4,
  isPositiveScale4,
  mulScale4,
  subScale4,
  ZERO_SCALE4,
} from './numerics.js';

export function calculateReceiptItemLineAmount(
  receivedQuantity: string,
  acceptedUnitCost: string,
): string {
  if (!isPositiveScale4(receivedQuantity)) {
    throw new InvalidReceiptItemError(
      `Received quantity must be strictly positive (> 0.0000), received ${receivedQuantity}`,
    );
  }
  if (!isNonNegativeScale4(acceptedUnitCost)) {
    throw new InvalidReceiptItemError(
      `Accepted unit cost must be non-negative (>= 0.0000), received ${acceptedUnitCost}`,
    );
  }
  return mulScale4(receivedQuantity, acceptedUnitCost);
}

export function calculateReceiptTotalAmount(items: Array<{ lineAmount: string }>): string {
  let total = ZERO_SCALE4;
  for (const item of items) {
    total = addScale4(total, item.lineAmount);
  }
  return total;
}

export function evaluateOverReceipt(
  ingredientId: string,
  orderedQuantity: string,
  previouslyReceivedQuantity: string,
  currentReceivedQuantity: string,
): void {
  const totalAttempted = addScale4(previouslyReceivedQuantity, currentReceivedQuantity);
  if (cmpScale4(totalAttempted, orderedQuantity) > 0) {
    throw new OverReceiptNotAuthorizedError({
      ingredientId,
      orderedQuantity,
      previouslyReceivedQuantity,
      attemptedQuantity: currentReceivedQuantity,
      totalAttempted,
    });
  }
}

export interface CumulativeQuantityResult {
  cumulativeReceivedQuantity: string;
  remainingQuantity: string;
  isFullyReceived: boolean;
}

export function deriveCumulativeReceivingQuantities(
  orderedQuantity: string,
  previouslyReceivedQuantity: string,
  currentReceivedQuantity: string,
): CumulativeQuantityResult {
  const cumulativeReceivedQuantity = addScale4(previouslyReceivedQuantity, currentReceivedQuantity);
  const remainingQuantity = subScale4(orderedQuantity, cumulativeReceivedQuantity);
  const isFullyReceived = cmpScale4(cumulativeReceivedQuantity, orderedQuantity) >= 0;

  return {
    cumulativeReceivedQuantity,
    remainingQuantity,
    isFullyReceived,
  };
}

export function determinePostReceiptPoStatus(allItemsFullyReceived: boolean): PurchaseOrderStatus {
  return allItemsFullyReceived ? 'RECEIVED' : 'PARTIAL';
}
