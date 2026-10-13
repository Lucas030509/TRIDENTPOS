/**
 * TRIDENTPOS Billing: Pure Domain Invoicing Lifecycle & State Transitions
 */

import {
  FiscalInvoiceAlreadyCancelledError,
  FiscalInvoiceAlreadyStampedError,
  FiscalInvoiceInvalidStateError,
} from './errors.js';
import {
  assertValidRfc,
  assertValidPostalCode,
  assertValidRegimenFiscal,
} from './rfc-validator.js';
import type {
  CfdiCancellationReason,
  EmisorFiscalConfig,
  FiscalInvoice,
  FiscalInvoiceItem,
  PacStampResult,
} from './types.js';

export function validateInvoiceForStamping(
  invoice: FiscalInvoice,
  items: FiscalInvoiceItem[],
  emisor: EmisorFiscalConfig,
): void {
  if (invoice.status !== 'DRAFT') {
    if (invoice.status === 'STAMPED') {
      throw new FiscalInvoiceAlreadyStampedError(
        `Invoice '${invoice.id}' is already STAMPED with UUID '${invoice.invoiceUuid}'`,
      );
    }
    throw new FiscalInvoiceInvalidStateError(
      `Cannot stamp invoice '${invoice.id}' in status '${invoice.status}'. Must be in DRAFT status`,
    );
  }

  // Validate emisor
  assertValidRfc(emisor.rfc);
  assertValidPostalCode(emisor.codigoPostal);
  assertValidRegimenFiscal(emisor.regimenFiscal);

  // Validate receptor
  const receptorRfc = invoice.receptorRfc ?? invoice.customerTaxId ?? '';
  const receptorCp = invoice.receptorCodigoPostal ?? invoice.customerPostalCode ?? '';
  const receptorRegimen = invoice.receptorRegimenFiscal ?? invoice.customerRegimenFiscal ?? '';
  assertValidRfc(receptorRfc);
  assertValidPostalCode(receptorCp);
  assertValidRegimenFiscal(receptorRegimen);

  if (!items || items.length === 0) {
    throw new FiscalInvoiceInvalidStateError(
      `Invoice '${invoice.id}' cannot be stamped without line items`,
    );
  }
}

export function applyStampToInvoice(
  invoice: FiscalInvoice,
  stampResult: PacStampResult,
): FiscalInvoice {
  if (invoice.status !== 'DRAFT') {
    throw new FiscalInvoiceInvalidStateError(
      `Cannot apply stamp to invoice in status '${invoice.status}'`,
    );
  }

  if (stampResult.status !== 'STAMPED' || !stampResult.uuid) {
    throw new FiscalInvoiceInvalidStateError(
      `Cannot apply stamp from non-successful PAC stamp result (${stampResult.status})`,
    );
  }

  const nowIso = new Date().toISOString();

  return {
    ...invoice,
    status: 'STAMPED',
    invoiceUuid: stampResult.uuid,
    selloSat: stampResult.selloSat ?? null,
    stampedXml: stampResult.stampedXml ?? null,
    stampedAt: stampResult.fechaTimbrado ?? nowIso,
    updatedAt: nowIso,
  };
}

export function applyCancellationToInvoice(
  invoice: FiscalInvoice,
  reason: CfdiCancellationReason,
  replacementUuid?: string,
): FiscalInvoice {
  if (invoice.status === 'CANCELLED') {
    throw new FiscalInvoiceAlreadyCancelledError(
      `Invoice '${invoice.id}' (${invoice.invoiceUuid}) is already CANCELLED`,
    );
  }

  if (invoice.status !== 'STAMPED') {
    throw new FiscalInvoiceInvalidStateError(
      `Cannot cancel invoice in status '${invoice.status}'. Only STAMPED invoices can be cancelled`,
    );
  }

  const nowIso = new Date().toISOString();

  return {
    ...invoice,
    status: 'CANCELLED',
    cancellationReason: reason,
    cancellationReplacementUuid: replacementUuid ?? null,
    cancelledAt: nowIso,
    updatedAt: nowIso,
  };
}

export function validateCanStamp(status: string): void {
  if (status !== 'DRAFT') {
    if (status === 'STAMPED') {
      throw new FiscalInvoiceAlreadyStampedError('Invoice is already stamped');
    }
    throw new FiscalInvoiceInvalidStateError(`Cannot stamp invoice in status '${status}'`);
  }
}

export function validateCanCancel(status: string): void {
  if (status === 'CANCELLED') {
    throw new FiscalInvoiceAlreadyCancelledError('Invoice is already cancelled');
  }
  if (status !== 'STAMPED') {
    throw new FiscalInvoiceInvalidStateError(
      `Cannot cancel invoice in status '${status}'. Only STAMPED invoices can be cancelled`,
    );
  }
}

export function validateDraftTransition(status: string): void {
  if (status !== 'DRAFT') {
    throw new FiscalInvoiceInvalidStateError(`Cannot modify invoice in status '${status}'`);
  }
}

export const validateDraftCreation = validateDraftTransition;
