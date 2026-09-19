/**
 * TRIDENTPOS Finance Domain Errors (WP-020)
 * Bounded Context: Finance
 */

export class FinanceDomainError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AccountsPayableOverpaymentError extends FinanceDomainError {
  constructor(message = 'Payment amount exceeds outstanding accounts payable balance') {
    super(message, 'ACCOUNTS_PAYABLE_OVERPAYMENT');
  }
}

export class AccountsPayableInvalidStateError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'ACCOUNTS_PAYABLE_INVALID_STATE');
  }
}

export class AccountsReceivableOverpaymentError extends FinanceDomainError {
  constructor(message = 'Settlement amount exceeds outstanding accounts receivable balance') {
    super(message, 'ACCOUNTS_RECEIVABLE_OVERPAYMENT');
  }
}

export class AccountsReceivableInvalidStateError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'ACCOUNTS_RECEIVABLE_INVALID_STATE');
  }
}

export class CreditPolicyRequiredError extends FinanceDomainError {
  constructor(
    message = 'Operation requires an authorized CreditLimitValidator policy (OQ-SSOT-03)',
  ) {
    super(message, 'CREDIT_POLICY_REQUIRED');
  }
}

export class PaymentTermsResolverRequiredError extends FinanceDomainError {
  constructor(
    message = 'Operation requires an authorized PaymentTermsDueDateResolver policy to derive AP due date',
  ) {
    super(message, 'PAYMENT_TERMS_RESOLVER_REQUIRED');
  }
}

export class APIdempotencyConflictError extends FinanceDomainError {
  constructor(
    message = 'Accounts payable idempotency conflict: existing record differs from incoming event facts',
  ) {
    super(message, 'AP_IDEMPOTENCY_CONFLICT');
  }
}

export class ARIdempotencyConflictError extends FinanceDomainError {
  constructor(
    message = 'Accounts receivable idempotency conflict: existing record differs from incoming charge facts',
  ) {
    super(message, 'AR_IDEMPOTENCY_CONFLICT');
  }
}

export class CashReconciliationIdempotencyConflictError extends FinanceDomainError {
  constructor(
    message = 'Cash reconciliation idempotency conflict: existing record differs from incoming closing facts',
  ) {
    super(message, 'CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT');
  }
}

export class CreditLimitExceededError extends FinanceDomainError {
  constructor(
    message = 'Requested charge exceeds customer credit limit or policy disposition is rejected',
  ) {
    super(message, 'CREDIT_LIMIT_EXCEEDED');
  }
}

export class InvalidPaymentTermsError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'INVALID_PAYMENT_TERMS');
  }
}

export class InvalidFinancialAmountError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'INVALID_FINANCIAL_AMOUNT');
  }
}

export class OperatingExpenseError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'OPERATING_EXPENSE_ERROR');
  }
}

export class CashReconciliationError extends FinanceDomainError {
  constructor(message: string) {
    super(message, 'CASH_RECONCILIATION_ERROR');
  }
}
