/**
 * TRIDENTPOS Procurement Purchase Order Domain Functions
 */

import { PurchaseOrderStatus } from './types.js';
import {
  InvalidPurchaseOrderError,
  InvalidPurchaseOrderTransitionError,
  PurchaseOrderCancelledError,
} from './errors.js';
import {
  addScale4,
  isNonNegativeScale4,
  isPositiveScale4,
  mulScale4,
  ZERO_SCALE4,
} from './numerics.js';

export function calculatePoItemLineAmount(orderedQuantity: string, unitCost: string): string {
  if (!isPositiveScale4(orderedQuantity)) {
    throw new InvalidPurchaseOrderError(
      `Ordered quantity must be strictly positive (> 0.0000), received ${orderedQuantity}`,
    );
  }
  if (!isNonNegativeScale4(unitCost)) {
    throw new InvalidPurchaseOrderError(
      `Unit cost must be non-negative (>= 0.0000), received ${unitCost}`,
    );
  }
  return mulScale4(orderedQuantity, unitCost);
}

export function calculatePoTotalAmount(items: Array<{ lineAmount: string }>): string {
  let total = ZERO_SCALE4;
  for (const item of items) {
    total = addScale4(total, item.lineAmount);
  }
  return total;
}

export function validatePoTransition(
  currentStatus: PurchaseOrderStatus,
  targetStatus: PurchaseOrderStatus,
): void {
  if (currentStatus === targetStatus) {
    return;
  }

  if (currentStatus === 'CANCELLED') {
    throw new PurchaseOrderCancelledError('current purchase order');
  }

  switch (currentStatus) {
    case 'DRAFT':
      if (targetStatus !== 'SENT' && targetStatus !== 'CANCELLED') {
        throw new InvalidPurchaseOrderTransitionError(currentStatus, targetStatus);
      }
      break;
    case 'SENT':
      if (
        targetStatus !== 'PARTIAL' &&
        targetStatus !== 'RECEIVED' &&
        targetStatus !== 'CANCELLED'
      ) {
        throw new InvalidPurchaseOrderTransitionError(currentStatus, targetStatus);
      }
      break;
    case 'PARTIAL':
      if (targetStatus !== 'RECEIVED') {
        throw new InvalidPurchaseOrderTransitionError(currentStatus, targetStatus);
      }
      break;
    case 'RECEIVED':
      throw new InvalidPurchaseOrderTransitionError(currentStatus, targetStatus);
    default:
      throw new InvalidPurchaseOrderTransitionError(currentStatus, targetStatus);
  }
}

export function validateCanCancelPo(
  currentStatus: PurchaseOrderStatus,
  hasConfirmedReceipts: boolean,
): void {
  if (currentStatus === 'CANCELLED') {
    return;
  }
  if (currentStatus === 'RECEIVED') {
    throw new InvalidPurchaseOrderTransitionError(currentStatus, 'CANCELLED');
  }
  if (hasConfirmedReceipts || currentStatus === 'PARTIAL') {
    throw new InvalidPurchaseOrderError(
      'Cannot cancel purchase order with existing confirmed receipts; post-receipt goods returns require dedicated compensating flow',
    );
  }
  validatePoTransition(currentStatus, 'CANCELLED');
}
