/**
 * TRIDENTPOS Billing Bounded Context: Types & Interfaces
 * Governed by DATA_MODEL.md Sec. 2.4, MODULE_CATALOG.md MOD-BILL, and ACR-2026-020 R5.
 */

import crypto from 'node:crypto';
import { InvalidEventContractVersionError } from './errors.js';

export type TaxType =
  'IVA' | 'IEPS' | 'ISR' | 'RETENCION_IVA' | 'RETENCION_ISR' | 'PROPINA_LEGAL' | 'LOCAL';

export type TaxFactorType = 'Tasa' | 'Cuota' | 'Exento';

export interface TaxScheme {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  rate: string; // Scale-4 decimal string e.g. "0.1600"
  isInclusive?: boolean;
  taxType: TaxType;
  factorType?: TaxFactorType;
  isRetention?: boolean;
  isLocal?: boolean;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type FiscalInvoiceStatus = 'DRAFT' | 'STAMPED' | 'CANCELLED' | 'REJECTED';

export type CfdiTipoComprobante = 'I' | 'E' | 'T' | 'N' | 'P';

export type CfdiUse =
  | 'G01' // Adquisición de mercancías
  | 'G02' // Devoluciones, descuentos o bonificaciones
  | 'G03' // Gastos en general
  | 'I01' // Construcciones
  | 'I02' // Mobiliario y equipo de oficina por inversiones
  | 'I03' // Equipo de transporte
  | 'I04' // Equipo de cómputo y accesorios
  | 'I08' // Otra maquinaria y equipo
  | 'D01' // Honorarios médicos, dentales y gastos hospitalarios
  | 'D02' // Gastos médicos por incapacidad o discapacidad
  | 'D03' // Gastos funerales
  | 'D04' // Donativos
  | 'D07' // Primas por seguros de gastos médicos
  | 'D08' // Gastos de transportación escolar obligatoria
  | 'D10' // Pagos por servicios educativos (colegiaturas)
  | 'S01' // Sin efectos fiscales
  | 'CP01'; // Pagos

export type CfdiPaymentMethod =
  | 'PUE' // Pago en una sola exhibición
  | 'PPD'; // Pago en parcialidades o diferido

export type CfdiPaymentWay =
  | '01' // Efectivo
  | '02' // Cheque nominativo
  | '03' // Transferencia electrónica de fondos
  | '04' // Tarjeta de crédito
  | '05' // Monedero electrónico
  | '06' // Dinero electrónico
  | '08' // Vales de despensa
  | '12' // Dación en pago
  | '28' // Tarjeta de débito
  | '29' // Tarjeta de servicios
  | '99'; // Por definir

export type CfdiCancellationReason =
  | '01' // Comprobante emitido con errores con relación
  | '02' // Comprobante emitido con errores sin relación
  | '03' // No se llevó a cabo la operación
  | '04'; // Operación nominativa relacionada en una factura global

export interface FiscalInvoiceItem {
  id: string;
  invoiceId?: string;
  fiscalInvoiceId?: string;
  organizationId?: string;
  lineNumber: number;
  productCode?: string;
  sku?: string;
  description: string;
  satProductCode?: string; // e.g. "90101501" (Restaurantes)
  claveProdServ?: string;
  satUnitCode?: string; // e.g. "E48" (Unidad de servicio) or "H87" (Pieza)
  claveUnidad?: string;
  quantity: string; // Scale-4 decimal string e.g. "1.0000"
  unitPrice: string; // Scale-4 decimal string
  subtotal?: string; // Scale-4 decimal string
  subtotalAmount?: string;
  discountAmount?: string;
  taxSchemeId?: string;
  taxAmount: string; // Scale-4 decimal string
  totalAmount: string; // Scale-4 decimal string
  taxRate?: string; // Scale-4 decimal string e.g. "0.1600"
  createdAt?: string;
}

export interface FiscalInvoice {
  id: string;
  organizationId: string;
  branchId: string;
  invoiceUuid?: string | null;
  uuid?: string | null;
  cfdiVersion?: string;
  tipoComprobante?: CfdiTipoComprobante;
  series?: string;
  serie?: string | null;
  folio: string | null;
  customerTaxId?: string;
  customerName?: string;
  customerRegimenFiscal?: string;
  customerPostalCode?: string;
  emisorRfc?: string;
  emisorNombre?: string;
  emisorRegimenFiscal?: string;
  emisorCodigoPostal?: string;
  receptorRfc?: string;
  receptorNombre?: string;
  receptorRegimenFiscal?: string;
  receptorCodigoPostal?: string;
  receptorUsoCfdi?: string;
  cfdiUse?: CfdiUse;
  paymentMethod?: CfdiPaymentMethod;
  paymentWay?: CfdiPaymentWay;
  formaPago?: string;
  metodoPago?: string;
  moneda?: string;
  tipoCambio?: string;
  subtotal?: string;
  subtotalAmount?: string;
  discountAmount?: string;
  taxTotal?: string;
  taxAmount?: string;
  totalAmount: string;
  condicionesDePago?: string | null;
  status: FiscalInvoiceStatus;
  cancellationReason: CfdiCancellationReason | string | null;
  cancellationReplacementUuid?: string | null;
  uuidSustitucion?: string | null;
  stampedAt?: string | null;
  fechaTimbrado?: string | null;
  cancelledAt?: string | null;
  xmlPayload?: string | null;
  xmlContent?: string | null;
  stampedXml?: string | null;
  selloEmisor?: string | null;
  selloSat?: string | null;
  noCertificadoSat?: string | null;
  cadenaOriginal?: string | null;
  cadenaOriginalHash?: string | null;
  pacRequestReferenceId?: string | null;
  pacProvider?: string | null;
  pacTransactionId?: string | null;
  sourceFolioId?: string | null;
  sourceBatchId?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: FiscalInvoiceItem[];
}

export interface EmisorFiscalConfig {
  id: string;
  organizationId: string;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string; // e.g. "601", "612", "626"
  codigoPostal: string;
  curp?: string | null;
  certificateNumber?: string | null;
  certificadoSatNumber?: string | null;
  certificatePem?: string | null;
  certificadoPem?: string | null;
  privateKeyVaultId?: string | null;
  pacEnvironment?: 'TEST' | 'PRODUCTION';
  pacUsername?: string | null;
  pacSecretRef?: string | null;
  pacPrimaryProvider?: string | null;
  pacFallbackProvider?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CsdCredentials {
  certificateNumber: string;
  certificatePem: string;
  privateKeyPem: string;
  validFrom: string;
  validTo: string;
}

export interface PacStampRequest {
  organizationId: string;
  invoiceId?: string;
  referenceId?: string;
  idempotencyKey?: string;
  xmlPayload?: string;
  xml?: string;
  rfcEmisor?: string;
  totalAmount?: string;
}

export interface PacStampResult {
  status: 'STAMPED' | 'REJECTED' | 'TIMEOUT';
  uuid?: string;
  selloSat?: string;
  fechaTimbrado?: string;
  noCertificadoSat?: string;
  stampedXml?: string;
  xmlTimbrado?: string;
  pacProvider?: string;
  pacTransactionId?: string;
  errorMessage?: string;
  errorCode?: string;
}

export interface PacCancelRequest {
  organizationId: string;
  uuid: string;
  rfcEmisor: string;
  total?: string;
  reason?: CfdiCancellationReason | string;
  motivo?: string;
  replacementUuid?: string;
  uuidSustitucion?: string;
  idempotencyKey?: string;
}

export interface PacCancelResult {
  status: 'CANCELLED' | 'REJECTED' | 'PENDING_APPROVAL' | 'TIMEOUT';
  uuid: string;
  cancellationCode?: string;
  errorMessage?: string;
  pacTransactionId?: string;
  pacProvider?: string;
}

export type FiscalOperationType = 'STAMP' | 'CANCEL';

export type PacCapabilityName =
  | 'supportsStamp'
  | 'supportsCancel'
  | 'supportsStampIdempotencyKey'
  | 'supportsCancellationIdempotencyKey'
  | 'supportsAuthoritativeStampLookup'
  | 'supportsAuthoritativeCancellationLookup'
  | 'supportsSafeStampReplayAfterConfirmedNotFound'
  | 'supportsSafeCancellationReplayAfterConfirmedNotFound';

export interface PacApprovedScope {
  organizationId?: string | 'GLOBAL';
  operationType: FiscalOperationType | '*';
  capability: PacCapabilityName | '*';
  recoveryCondition?: string | '*';
}

export interface PacContractProvenance {
  providerName: string;
  contractIdentifier: string;
  contractVersion: string;
  evidenceUriOrReference: string;
  evidenceMediaType: string;
  evidenceByteLength: number;
  evidenceDigestAlgorithm: 'SHA-256';
  evidenceDigest: string; // SHA-256 hex string over raw bytes
  approvalAuthorityId: string;
  approvalKeyId: string;
  approvalAttestation: string;
  approvedScope: PacApprovedScope;
  effectiveFrom: string; // ISO-8601
  effectiveUntil: string; // ISO-8601
  revocationAuthorityId: string;
  revocationKeyId: string;
  revocationSequence: number;
  revocationStatus: 'ACTIVE' | 'REVOKED' | 'SUPERSEDED';
  revocationAttestation: string;
  revocationSnapshotIssuedAt: string; // ISO-8601
  revocationSnapshotValidUntil: string; // ISO-8601
  guaranteeScopeOrLimitations?: string;
}

export interface TrustedApprovalAuthority {
  authorityId: string;
  keyId: string;
  publicKeyPem: string;
  allowedScopes: Array<{
    providerName: string;
    scope: 'GLOBAL' | string;
    allowedOperations: FiscalOperationType[];
  }>;
  status: 'ACTIVE' | 'REVOKED';
}

export interface ProvenanceValidationContext {
  organizationId: string;
  operationType: FiscalOperationType;
  capability: PacCapabilityName;
  recoveryCondition?: string;
  evidenceBytes?: Buffer | Uint8Array;
  maxStatusAgeMs?: number;
}

export interface PacCapabilities {
  supportsStamp?: boolean;
  supportsCancel?: boolean;
  supportsStampIdempotencyKey: boolean;
  supportsCancellationIdempotencyKey: boolean;
  supportsAuthoritativeStampLookup: boolean;
  supportsAuthoritativeCancellationLookup: boolean;
  supportsSafeStampReplayAfterConfirmedNotFound: boolean;
  supportsSafeCancellationReplayAfterConfirmedNotFound: boolean;
  stampLookupKeyType?: string;
  cancellationLookupKeyType?: string;
}

export type NormalizedStampReconciliationOutcome =
  'STAMPED_CONFIRMED' | 'REJECTED_CONFIRMED' | 'NOT_FOUND_CONFIRMED' | 'PENDING' | 'UNKNOWN';

export interface AuthoritativeStampReconciliationResult {
  outcome: NormalizedStampReconciliationOutcome;
  uuid?: string;
  stampedXml?: string;
  selloSat?: string;
  fechaTimbrado?: string;
  noCertificadoSat?: string;
  errorMessage?: string;
  errorCode?: string;
  providerReference?: string;
}

export type NormalizedCancellationReconciliationOutcome =
  | 'CANCELLATION_CONFIRMED'
  | 'PENDING_APPROVAL'
  | 'REJECTED_CONFIRMED'
  | 'NOT_FOUND_CONFIRMED'
  | 'UNKNOWN';

export interface AuthoritativeCancellationReconciliationResult {
  outcome: NormalizedCancellationReconciliationOutcome;
  uuid: string;
  cancellationCode?: string;
  errorMessage?: string;
  providerReference?: string;
}

export interface UnclaimedFiscalTicket {
  ticketFolio: string;
  branchId: string;
  paidAt: string;
  subtotal: string;
  taxTotal: string;
  totalAmount: string;
  isClaimed: boolean;
}

export interface BatchInvoiceCandidate {
  organizationId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  ticketFolios: string[];
  subtotal: string;
  taxTotal: string;
  totalAmount: string;
}

export interface CreateTaxSchemeCommand {
  id?: string;
  organizationId: string;
  code: string;
  name: string;
  rate: string;
  taxType: TaxType;
  factorType?: TaxFactorType;
  isRetention?: boolean;
  isLocal?: boolean;
  isInclusive?: boolean;
  isActive?: boolean;
}

export interface ConfigureEmisorFiscalCommand {
  id?: string;
  organizationId: string;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  curp?: string;
  certificateNumber?: string;
  certificadoSatNumber?: string;
  certificatePem?: string;
  certificadoPem?: string;
  privateKeyVaultId?: string;
  pacEnvironment?: 'TEST' | 'PRODUCTION';
  pacUsername?: string;
  pacSecretRef?: string;
  pacPrimaryProvider?: string;
  pacFallbackProvider?: string;
  isActive?: boolean;
}

export interface CreateDraftInvoiceItemInput {
  id?: string;
  lineNumber?: number;
  productCode?: string;
  sku?: string;
  description: string;
  claveProdServ: string;
  claveUnidad: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  taxSchemeId?: string;
}

export interface CreateDraftInvoiceCommand {
  id?: string;
  organizationId: string;
  branchId: string;
  tipoComprobante?: CfdiTipoComprobante;
  serie?: string;
  folio?: string;
  receptorRfc: string;
  receptorNombre: string;
  receptorRegimenFiscal: string;
  receptorCodigoPostal: string;
  receptorUsoCfdi: string;
  formaPago?: string;
  metodoPago?: string;
  condicionesDePago?: string;
  sourceFolioId?: string;
  sourceBatchId?: string;
  items: CreateDraftInvoiceItemInput[];
}

export type FiscalStampingOperationStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_FLIGHT'
  | 'RETRYABLE'
  | 'RETRYABLE_CONFIRMED'
  | 'SUCCEEDED'
  | 'FAILED_TERMINAL'
  | 'RECONCILIATION_REQUIRED';

export type FiscalOperationStatus = FiscalStampingOperationStatus;

export interface FiscalStampingOperation {
  id: string;
  organizationId: string;
  branchId: string;
  invoiceId: string;
  operationType?: FiscalOperationType;
  idempotencyKey: string;
  semanticIdempotencyKey?: string;
  requestHash: string;
  status: FiscalStampingOperationStatus;
  attemptCount: number;
  lastError?: string | null;
  externalReference?: string | null;
  externalUuid?: string | null;
  targetUuid?: string | null;
  providerName?: string | null;
  contractProvenanceRef?: string | null;
  reconciliationStatus?: string | null;
  stampedXml?: string | null;
  semanticEventId?: string | null;
  eventContractVersion?: string | null;
  nextRetryAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StampFiscalInvoiceCommand {
  organizationId: string;
  invoiceId: string;
  idempotencyKey?: string;
  actorId?: string;
}

export interface CancelFiscalInvoiceCommand {
  organizationId: string;
  invoiceId: string;
  motivo: string;
  uuidSustitucion?: string;
  idempotencyKey?: string;
  actorId?: string;
}

export interface BatchCandidateQueryCommand {
  organizationId: string;
  branchId: string;
  startDate: string;
  endDate: string;
}

export interface BatchCandidateResult {
  organizationId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  candidateFolios: string[];
  totalFolios: number;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
}

export interface CreateGlobalInvoiceBatchCommand {
  id?: string;
  organizationId: string;
  branchId: string;
  periodo: string;
  mes: string;
  anio: number;
  folioCount: number;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  metadata?: Record<string, unknown>;
}

export interface GlobalInvoiceBatch {
  id: string;
  organizationId: string;
  branchId: string;
  status: 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'PROCESSED';
  periodo?: string;
  mes?: string;
  anio?: number;
  folioCount?: number;
  batchReference?: string;
  periodStart?: string;
  periodEnd?: string;
  ticketFolios?: string[];
  subtotal?: string;
  subtotalAmount: string;
  taxTotal?: string;
  taxAmount: string;
  totalAmount: string;
  fiscalInvoiceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumerInboxRecord {
  id: string;
  organizationId: string;
  semanticEventId: string;
  eventKind: string;
  consumerContext: string;
  processedAt: string;
}

export interface SanitizedFiscalError {
  errorCode: string;
  sanitizedMessage: string;
  correlationId: string;
  timestamp: string;
  isRetryable: boolean;
}

export interface SubscriberDeclaration {
  subscriberName: string;
  supportedMajors: number[];
  requiredFields: string[];
}

export const FISCAL_EVENT_CONTRACT_VERSION = '1.0';

export function validateEventContractVersion(version: unknown): { major: number; minor: number } {
  if (typeof version !== 'string') {
    throw new InvalidEventContractVersionError(
      'eventContractVersion must be a string in major.minor format',
    );
  }
  const match = version.trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) {
    throw new InvalidEventContractVersionError(
      `Malformed eventContractVersion '${version}'; must be canonical major.minor format`,
    );
  }
  return { major: parseInt(match[1]!, 10), minor: parseInt(match[2]!, 10) };
}

export function generateFiscalSemanticEventId(
  organizationId: string,
  operationId: string,
  eventKind: 'FacturaFiscalEmitida' | 'FacturaFiscalCancelada' | string,
): string {
  // Deterministic identity: hash(organizationId:operationId:eventKind)
  // Stable across retries, restores, and outbox row recreation.
  return crypto
    .createHash('sha256')
    .update(`${organizationId}:${operationId}:${eventKind}`)
    .digest('hex');
}
