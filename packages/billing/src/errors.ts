/**
 * TRIDENTPOS Billing Bounded Context: Domain Errors
 */

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

export class InvalidRfcError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRfcError';
  }
}

export class InvalidPostalCodeError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPostalCodeError';
  }
}

export class InvalidRegimenFiscalError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRegimenFiscalError';
  }
}

export class InvalidTaxSchemeError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaxSchemeError';
  }
}

export class InvalidEmisorConfigError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEmisorConfigError';
  }
}

export class InvalidFiscalInvoiceError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFiscalInvoiceError';
  }
}

export class FiscalInvoiceNotFoundError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalInvoiceNotFoundError';
  }
}

export class InvoiceStatusTransitionError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceStatusTransitionError';
  }
}

export class FiscalInvoiceInvalidStateError extends InvoiceStatusTransitionError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalInvoiceInvalidStateError';
  }
}

export class FiscalInvoiceAlreadyStampedError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalInvoiceAlreadyStampedError';
  }
}

export class FiscalInvoiceAlreadyCancelledError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalInvoiceAlreadyCancelledError';
  }
}

export class CsdCredentialsMissingError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'CsdCredentialsMissingError';
  }
}

export class CsdCertificateExpiredError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'CsdCertificateExpiredError';
  }
}

export class CsdSignatureError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'CsdSignatureError';
  }
}

export class FiscalSigningError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalSigningError';
  }
}

export class TaxCalculationError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'TaxCalculationError';
  }
}

export class PacConnectorError extends BillingError {
  public readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PacConnectorError';
    this.code = code;
  }
}

export class PacTimeoutError extends BillingError {
  constructor(message: string = 'PAC gateway request timed out') {
    super(message);
    this.name = 'PacTimeoutError';
  }
}

export class PacCircuitBreakerOpenError extends BillingError {
  constructor(message: string = 'PAC Circuit Breaker is OPEN') {
    super(message);
    this.name = 'PacCircuitBreakerOpenError';
  }
}

export class PacStampRejectedError extends BillingError {
  public readonly errorCode?: string;
  constructor(message: string, errorCode?: string) {
    super(message);
    this.name = 'PacStampRejectedError';
    this.errorCode = errorCode;
  }
}

export class PacCancellationRejectedError extends BillingError {
  public readonly cancellationCode?: string;
  constructor(message: string, cancellationCode?: string) {
    super(message);
    this.name = 'PacCancellationRejectedError';
    this.cancellationCode = cancellationCode;
  }
}

export class InvoiceIdempotencyConflictError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceIdempotencyConflictError';
  }
}

export class CsdMismatchError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'CsdMismatchError';
  }
}

export class FiscalSuccessValidationError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalSuccessValidationError';
  }
}

export class PacCapabilityMissingError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacCapabilityMissingError';
  }
}

export class PacContractProvenanceMissingError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacContractProvenanceMissingError';
  }
}

export class PacProvenanceValidationError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacProvenanceValidationError';
  }
}

export class PacProvenanceRevokedError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacProvenanceRevokedError';
  }
}

export class PacProvenanceExpiredError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacProvenanceExpiredError';
  }
}

export class PacProvenanceScopeMismatchError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'PacProvenanceScopeMismatchError';
  }
}

export class InvalidEventContractVersionError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventContractVersionError';
  }
}

export class EventContractIncompatibleError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'EventContractIncompatibleError';
  }
}

export class ConsumerRestoreDomainError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'ConsumerRestoreDomainError';
  }
}

export class DestructiveDownMigrationError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'DestructiveDownMigrationError';
  }
}

export class ReconciliationRequiredError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationRequiredError';
  }
}

export class CancellationPendingApprovalError extends BillingError {
  constructor(message: string) {
    super(message);
    this.name = 'CancellationPendingApprovalError';
  }
}

export class FiscalStampingDisabledError extends BillingError {
  public readonly code: string = 'FISCAL_STAMPING_DISABLED';
  constructor(
    message: string = 'FISCAL_STAMPING_DISABLED: Direct fiscal stamping is disabled by configuration (kill switch OFF)',
  ) {
    super(message);
    this.name = 'FiscalStampingDisabledError';
  }
}

export class SanitizedBillingError extends BillingError {
  public readonly sanitizedMessage: string;
  public readonly errorCode: string;
  public readonly correlationId: string;

  constructor(
    sanitizedMessage: string,
    errorCode: string = 'FISCAL_ERROR',
    correlationId: string = '',
  ) {
    super(sanitizedMessage);
    this.name = 'SanitizedBillingError';
    this.sanitizedMessage = sanitizedMessage;
    this.errorCode = errorCode;
    this.correlationId = correlationId;
  }
}
