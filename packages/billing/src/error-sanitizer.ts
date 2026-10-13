/**
 * TRIDENTPOS Billing: Fiscal Error Sanitizer
 * Governed by ACR-2026-020 and SEC-WP021-R4-MED-01.
 * Ensures that no private keys, passwords, PAC tokens, or raw sensitive internal payloads
 * leak into persisted tables, outbox events, or external responses.
 */

import crypto from 'node:crypto';
import {
  CancellationPendingApprovalError,
  CsdCertificateExpiredError,
  CsdCredentialsMissingError,
  CsdMismatchError,
  EventContractIncompatibleError,
  FiscalInvoiceInvalidStateError,
  FiscalSigningError,
  FiscalSuccessValidationError,
  InvalidEmisorConfigError,
  InvalidEventContractVersionError,
  InvalidFiscalInvoiceError,
  InvalidPostalCodeError,
  InvalidRegimenFiscalError,
  InvalidRfcError,
  InvalidTaxSchemeError,
  InvoiceIdempotencyConflictError,
  InvoiceStatusTransitionError,
  PacCancellationRejectedError,
  PacCapabilityMissingError,
  PacCircuitBreakerOpenError,
  PacContractProvenanceMissingError,
  PacProvenanceExpiredError,
  PacProvenanceRevokedError,
  PacProvenanceScopeMismatchError,
  PacProvenanceValidationError,
  PacStampRejectedError,
  PacTimeoutError,
  ReconciliationRequiredError,
} from './errors.js';
import type { SanitizedFiscalError } from './types.js';

export class FiscalErrorSanitizer {
  /**
   * Sanitizes any technical error into a safe domain representation.
   */
  public static sanitize(error: unknown, correlationId?: string): SanitizedFiscalError {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const resolvedCorrelationId =
      correlationId && /^[0-9a-f-]{36}$/i.test(correlationId) ? correlationId : crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const errorCode = this.resolveErrorCode(error);
    const sanitizedMessage = this.stripSensitiveMaterial(rawMessage);
    const isRetryable = this.isRetryableError(error);

    return {
      errorCode,
      sanitizedMessage,
      correlationId: resolvedCorrelationId,
      timestamp,
      isRetryable,
    };
  }

  /**
   * Cleans sensitive patterns: PEM blocks, passwords, tokens, connection strings, stack traces.
   */
  public static stripSensitiveMaterial(message: string): string {
    // Untrusted errors are opaque, including encoded/JSON/multiline secrets.
    // Retain only allowlisted domain code and generated correlation, never raw text.
    void message;
    return 'Fiscal operation failed; consult the correlation identifier';
  }

  private static resolveErrorCode(error: unknown): string {
    if (error instanceof PacTimeoutError) return 'PAC_TIMEOUT';
    if (error instanceof PacCircuitBreakerOpenError) return 'PAC_CIRCUIT_BREAKER_OPEN';
    if (error instanceof PacStampRejectedError) return 'PAC_STAMP_REJECTED';
    if (error instanceof PacCancellationRejectedError) return 'PAC_CANCEL_REJECTED';
    if (error instanceof PacProvenanceRevokedError) return 'PAC_PROVENANCE_REVOKED';
    if (error instanceof PacProvenanceExpiredError) return 'PAC_PROVENANCE_EXPIRED';
    if (error instanceof PacProvenanceScopeMismatchError) return 'PAC_PROVENANCE_SCOPE_MISMATCH';
    if (
      error instanceof PacProvenanceValidationError ||
      error instanceof PacCapabilityMissingError ||
      error instanceof PacContractProvenanceMissingError
    ) {
      return 'PAC_PROVENANCE_UNAVAILABLE';
    }
    if (
      error instanceof CsdCredentialsMissingError ||
      error instanceof CsdCertificateExpiredError ||
      error instanceof CsdMismatchError ||
      error instanceof FiscalSigningError
    ) {
      return 'CSD_CREDENTIALS_INVALID';
    }
    if (error instanceof FiscalSuccessValidationError) return 'FISCAL_SUCCESS_VALIDATION_ERROR';
    if (
      error instanceof InvalidEventContractVersionError ||
      error instanceof EventContractIncompatibleError
    ) {
      return 'EVENT_CONTRACT_VERSION_ERROR';
    }
    if (
      error instanceof InvalidFiscalInvoiceError ||
      error instanceof InvalidRfcError ||
      error instanceof InvalidPostalCodeError ||
      error instanceof InvalidRegimenFiscalError ||
      error instanceof InvalidEmisorConfigError ||
      error instanceof InvalidTaxSchemeError
    ) {
      return 'INVALID_FISCAL_INVOICE';
    }
    if (
      error instanceof InvoiceStatusTransitionError ||
      error instanceof FiscalInvoiceInvalidStateError
    ) {
      return 'INVALID_STATUS_TRANSITION';
    }
    if (error instanceof InvoiceIdempotencyConflictError) return 'IDEMPOTENCY_CONFLICT';
    if (error instanceof ReconciliationRequiredError) return 'RECONCILIATION_REQUIRED';
    if (error instanceof CancellationPendingApprovalError) return 'CANCELLATION_PENDING_APPROVAL';

    return 'INTERNAL_FISCAL_ERROR';
  }

  private static isRetryableError(error: unknown): boolean {
    if (error instanceof PacTimeoutError || error instanceof ReconciliationRequiredError) {
      return true;
    }
    return false;
  }
}
