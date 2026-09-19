/**
 * TRIDENTPOS Procurement Bounded Context Domain Errors
 */

export class ProcurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcurementError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidSupplierError extends ProcurementError {
  constructor(message: string) {
    super(`Invalid supplier: ${message}`);
    this.name = 'InvalidSupplierError';
  }
}

export class InvalidPurchaseOrderError extends ProcurementError {
  constructor(message: string) {
    super(`Invalid purchase order: ${message}`);
    this.name = 'InvalidPurchaseOrderError';
  }
}

export class InvalidPurchaseOrderTransitionError extends ProcurementError {
  constructor(fromStatus: string, toStatus: string) {
    super(`Invalid purchase order status transition from '${fromStatus}' to '${toStatus}'`);
    this.name = 'InvalidPurchaseOrderTransitionError';
  }
}

export class PurchaseOrderCancelledError extends ProcurementError {
  constructor(orderId: string) {
    super(`Purchase order '${orderId}' is cancelled and cannot accept modifications or receipts`);
    this.name = 'PurchaseOrderCancelledError';
  }
}

export class OverReceiptNotAuthorizedError extends ProcurementError {
  public readonly orderedQuantity: string;
  public readonly previouslyReceivedQuantity: string;
  public readonly attemptedQuantity: string;
  public readonly totalAttempted: string;

  constructor(details: {
    ingredientId: string;
    orderedQuantity: string;
    previouslyReceivedQuantity: string;
    attemptedQuantity: string;
    totalAttempted: string;
  }) {
    super(
      `OVER_RECEIPT_NOT_AUTHORIZED: Ingredient '${details.ingredientId}' ordered ${details.orderedQuantity}, previously received ${details.previouslyReceivedQuantity}, attempted receipt ${details.attemptedQuantity} (total ${details.totalAttempted} exceeds ordered)`,
    );
    this.name = 'OverReceiptNotAuthorizedError';
    this.orderedQuantity = details.orderedQuantity;
    this.previouslyReceivedQuantity = details.previouslyReceivedQuantity;
    this.attemptedQuantity = details.attemptedQuantity;
    this.totalAttempted = details.totalAttempted;
  }
}

export class PriceVariancePolicyRequiredError extends ProcurementError {
  constructor(ingredientId: string, orderedCost: string, receivedCost: string) {
    super(
      `PRICE_VARIANCE_POLICY_REQUIRED: Unit cost mismatch for ingredient '${ingredientId}' (ordered: ${orderedCost}, received: ${receivedCost}) and no price variance policy was supplied`,
    );
    this.name = 'PriceVariancePolicyRequiredError';
  }
}

export class PriceVarianceSupervisorAuthorizationRequiredError extends ProcurementError {
  constructor(ingredientId: string, orderedCost: string, receivedCost: string) {
    super(
      `SUPERVISOR_AUTHORIZATION_REQUIRED: Unit cost variance for ingredient '${ingredientId}' (ordered: ${orderedCost}, received: ${receivedCost}) requires supervisor authorization token`,
    );
    this.name = 'PriceVarianceSupervisorAuthorizationRequiredError';
  }
}

export class PriceVarianceRejectedError extends ProcurementError {
  constructor(ingredientId: string, orderedCost: string, receivedCost: string) {
    super(
      `PRICE_VARIANCE_REJECTED: Price variance policy rejected unit cost ${receivedCost} (ordered: ${orderedCost}) for ingredient '${ingredientId}'`,
    );
    this.name = 'PriceVarianceRejectedError';
  }
}

export class InvalidReceiptItemError extends ProcurementError {
  constructor(message: string) {
    super(`Invalid receipt item: ${message}`);
    this.name = 'InvalidReceiptItemError';
  }
}

export class DuplicateReceiptNumberError extends ProcurementError {
  constructor(receiptNumber: string) {
    super(`Duplicate receipt number '${receiptNumber}' within branch`);
    this.name = 'DuplicateReceiptNumberError';
  }
}

export class ReceiptIdempotencyConflictError extends ProcurementError {
  constructor(message: string) {
    super(`RECEIPT_IDEMPOTENCY_CONFLICT: ${message}`);
    this.name = 'ReceiptIdempotencyConflictError';
  }
}

export class ReceiptOutboxIntegrityError extends ProcurementError {
  constructor(message: string) {
    super(`RECEIPT_OUTBOX_INTEGRITY_ERROR: ${message}`);
    this.name = 'ReceiptOutboxIntegrityError';
  }
}
