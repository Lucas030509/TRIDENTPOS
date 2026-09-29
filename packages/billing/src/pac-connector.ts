/**
 * TRIDENTPOS Billing: PAC (Proveedor Autorizado de Certificación) Connector Interface & Adapters
 * Governed by ACR-2026-020 (Sections 4, 7, 8, 9, 15, 18, 20.81–87).
 * Implements operation-specific capability declaration, authenticated provenance validation, and reconciliation.
 */

import crypto from 'node:crypto';
import {
  PacCapabilityMissingError,
  PacCircuitBreakerOpenError,
  PacContractProvenanceMissingError,
  PacProvenanceExpiredError,
  PacProvenanceRevokedError,
  PacProvenanceScopeMismatchError,
  PacProvenanceValidationError,
  PacTimeoutError,
} from './errors.js';
import type {
  AuthoritativeCancellationReconciliationResult,
  AuthoritativeStampReconciliationResult,
  FiscalOperationType,
  PacCancelRequest,
  PacCancelResult,
  PacCapabilities,
  PacCapabilityName,
  PacContractProvenance,
  PacStampRequest,
  PacStampResult,
  ProvenanceValidationContext,
  TrustedApprovalAuthority,
} from './types.js';

export interface IPacConnector {
  readonly providerName: string;
  readonly capabilities: PacCapabilities;
  readonly contractProvenance?: PacContractProvenance | null;
  timbrar(request: PacStampRequest): Promise<PacStampResult>;
  cancelar(request: PacCancelRequest): Promise<PacCancelResult>;
  consultarEstatus(uuid: string): Promise<{ status: string; esCancelable: boolean }>;
  consultarTimbre?(params: {
    organizationId: string;
    invoiceId?: string;
    idempotencyKey?: string;
    uuid?: string;
  }): Promise<AuthoritativeStampReconciliationResult>;
  consultarCancelacion?(params: {
    organizationId: string;
    invoiceId?: string;
    uuid: string;
  }): Promise<AuthoritativeCancellationReconciliationResult>;
  stampInvoice(request: PacStampRequest): Promise<PacStampResult>;
  cancelInvoice(request: PacCancelRequest): Promise<PacCancelResult>;
}

// Default in-memory trusted authorities registry for capability verification
const DEFAULT_TRUST_REGISTRY = new Map<string, TrustedApprovalAuthority>();

export function registerTrustedApprovalAuthority(authority: TrustedApprovalAuthority): void {
  DEFAULT_TRUST_REGISTRY.set(`${authority.authorityId}:${authority.keyId}`, authority);
}

export function clearTrustRegistry(): void {
  DEFAULT_TRUST_REGISTRY.clear();
}

/**
 * Builds canonical attestation payload for digital signature verification.
 */
export function buildProvenanceAttestationPayload(provenance: PacContractProvenance): string {
  const scope = provenance.approvedScope;
  return [
    provenance.providerName,
    provenance.contractIdentifier,
    provenance.contractVersion,
    provenance.evidenceDigest,
    scope.operationType,
    scope.capability,
    scope.organizationId ?? 'GLOBAL',
    scope.recoveryCondition ?? 'NONE',
    provenance.effectiveFrom,
    provenance.effectiveUntil,
  ].join('|');
}

/**
 * Validates that an adapter capability is enabled and backed by an authenticated,
 * currently valid, unrevoked, exact-scope contractual provenance record.
 * Governed by ACR-2026-020 Section 4.1 & Tests 81–87.
 */
export function validatePacCapabilityProvenance(
  connector: IPacConnector,
  capabilityOrContext: PacCapabilityName | ProvenanceValidationContext,
  contextOrNow?: Partial<ProvenanceValidationContext> | string,
  nowIsoParam?: string,
  trustRegistry: Map<string, TrustedApprovalAuthority> = DEFAULT_TRUST_REGISTRY,
): void {
  let context: ProvenanceValidationContext;
  let nowIso: string;

  if (typeof capabilityOrContext === 'string') {
    const capability = capabilityOrContext as PacCapabilityName;
    const extra =
      typeof contextOrNow === 'object' && contextOrNow !== null
        ? (contextOrNow as Partial<ProvenanceValidationContext>)
        : {};
    const opType: FiscalOperationType =
      extra.operationType ?? (capability.toLowerCase().includes('cancel') ? 'CANCEL' : 'STAMP');
    context = {
      organizationId: extra.organizationId ?? 'GLOBAL',
      operationType: opType,
      capability,
      recoveryCondition: extra.recoveryCondition,
      evidenceBytes: extra.evidenceBytes,
      maxStatusAgeMs: extra.maxStatusAgeMs,
    };
    nowIso =
      typeof contextOrNow === 'string' ? contextOrNow : (nowIsoParam ?? new Date().toISOString());
  } else {
    context = capabilityOrContext;
    nowIso =
      typeof contextOrNow === 'string' ? contextOrNow : (nowIsoParam ?? new Date().toISOString());
  }

  // 1. Check basic capability boolean flag on connector
  const isEnabled =
    context.capability === 'supportsStamp' || context.capability === 'supportsCancel'
      ? connector.capabilities[context.capability] !== false
      : Boolean(connector.capabilities[context.capability]);
  if (!isEnabled) {
    throw new PacCapabilityMissingError(
      `Provider '${connector.providerName}' does not support capability '${context.capability}' for operation '${context.operationType}'`,
    );
  }

  // 2. Check provenance record presence
  const provenance = connector.contractProvenance;
  if (!provenance) {
    throw new PacContractProvenanceMissingError(
      `Provider '${connector.providerName}' declared capability '${context.capability}' without contractual provenance record`,
    );
  }

  // 3. Evidence Digest & Byte Integrity Check
  if (provenance.evidenceDigestAlgorithm !== 'SHA-256') {
    throw new PacProvenanceValidationError(
      `Unsupported evidence digest algorithm '${provenance.evidenceDigestAlgorithm}'; must be SHA-256`,
    );
  }
  if (!provenance.evidenceDigest || !/^[a-fA-F0-9]{64}$/.test(provenance.evidenceDigest)) {
    throw new PacProvenanceValidationError(
      'Invalid evidenceDigest: must be a 64-character SHA-256 hex string',
    );
  }
  if (provenance.evidenceByteLength <= 0) {
    throw new PacProvenanceValidationError('Invalid evidenceByteLength: must be greater than zero');
  }
  if (context.evidenceBytes) {
    const computedDigest = crypto.createHash('sha256').update(context.evidenceBytes).digest('hex');
    if (computedDigest.toLowerCase() !== provenance.evidenceDigest.toLowerCase()) {
      throw new PacProvenanceValidationError(
        `Evidence byte digest '${computedDigest}' does not match provenance digest '${provenance.evidenceDigest}'`,
      );
    }
    if (context.evidenceBytes.length !== provenance.evidenceByteLength) {
      throw new PacProvenanceValidationError(
        `Evidence byte length '${context.evidenceBytes.length}' does not match provenance length '${provenance.evidenceByteLength}'`,
      );
    }
  }

  // 4. Exact Scope Binding Check
  const scope = provenance.approvedScope;
  if (!scope) {
    throw new PacProvenanceScopeMismatchError('Provenance is missing approvedScope');
  }
  if (scope.capability !== '*' && scope.capability !== context.capability) {
    throw new PacProvenanceScopeMismatchError(
      `Provenance capability '${scope.capability}' does not match requested capability '${context.capability}'`,
    );
  }
  if (scope.operationType !== '*' && scope.operationType !== context.operationType) {
    throw new PacProvenanceScopeMismatchError(
      `Provenance operation '${scope.operationType}' does not match requested operation '${context.operationType}'`,
    );
  }
  if (
    scope.organizationId &&
    scope.organizationId !== 'GLOBAL' &&
    scope.organizationId !== context.organizationId
  ) {
    throw new PacProvenanceScopeMismatchError(
      `Provenance tenant scope '${scope.organizationId}' does not match requested tenant '${context.organizationId}'`,
    );
  }
  if (
    context.recoveryCondition &&
    scope.recoveryCondition &&
    scope.recoveryCondition !== '*' &&
    scope.recoveryCondition !== context.recoveryCondition
  ) {
    throw new PacProvenanceScopeMismatchError(
      `Provenance recovery condition '${scope.recoveryCondition}' does not match required '${context.recoveryCondition}'`,
    );
  }

  // 5. Temporal Validity Bounds Check
  const nowTime = new Date(nowIso).getTime();
  const effectiveFromTime = new Date(provenance.effectiveFrom).getTime();
  const effectiveUntilTime = new Date(provenance.effectiveUntil).getTime();

  if (isNaN(effectiveFromTime) || isNaN(effectiveUntilTime)) {
    throw new PacProvenanceValidationError('Provenance contains invalid ISO-8601 validity dates');
  }
  if (nowTime < effectiveFromTime) {
    throw new PacProvenanceExpiredError(
      `Provenance for '${context.capability}' is not yet effective (effectiveFrom: ${provenance.effectiveFrom})`,
    );
  }
  if (nowTime > effectiveUntilTime) {
    throw new PacProvenanceExpiredError(
      `Provenance for '${context.capability}' has expired (effectiveUntil: ${provenance.effectiveUntil})`,
    );
  }

  // 6. Revocation Status and Monotonic Sequence Check
  if (provenance.revocationStatus === 'REVOKED') {
    throw new PacProvenanceRevokedError(
      `Provenance for capability '${context.capability}' was REVOKED by authority '${provenance.revocationAuthorityId}'`,
    );
  }
  if (provenance.revocationStatus === 'SUPERSEDED') {
    throw new PacProvenanceRevokedError(
      `Provenance for capability '${context.capability}' is SUPERSEDED by newer contract`,
    );
  }
  if (provenance.revocationStatus !== 'ACTIVE') {
    throw new PacProvenanceValidationError(
      `Unknown revocationStatus '${provenance.revocationStatus}'; fail-closed`,
    );
  }
  if (provenance.revocationSequence < 0) {
    throw new PacProvenanceValidationError('Invalid negative revocationSequence');
  }

  const snapshotIssuedTime = new Date(provenance.revocationSnapshotIssuedAt).getTime();
  const snapshotValidUntilTime = new Date(provenance.revocationSnapshotValidUntil).getTime();
  if (isNaN(snapshotIssuedTime) || isNaN(snapshotValidUntilTime)) {
    throw new PacProvenanceValidationError('Provenance contains invalid revocation snapshot dates');
  }
  if (nowTime > snapshotValidUntilTime) {
    throw new PacProvenanceExpiredError(
      'Revocation snapshot has expired; fresh status check required',
    );
  }

  if (context.maxStatusAgeMs && nowTime - snapshotIssuedTime > context.maxStatusAgeMs) {
    throw new PacProvenanceExpiredError(
      `Revocation status age (${nowTime - snapshotIssuedTime}ms) exceeds maximum allowed age (${context.maxStatusAgeMs}ms)`,
    );
  }

  // 7. Trust Registry & Attestation Signature Check
  if (provenance.approvalAuthorityId && provenance.approvalKeyId) {
    const authorityKey = `${provenance.approvalAuthorityId}:${provenance.approvalKeyId}`;
    const authority = trustRegistry.get(authorityKey);
    if (trustRegistry.size > 0 && !authority) {
      throw new PacProvenanceValidationError(
        `Approval authority '${authorityKey}' is not registered in the trusted authority registry`,
      );
    }
    if (authority && authority.status !== 'ACTIVE') {
      throw new PacProvenanceValidationError(
        `Approval authority '${authorityKey}' is inactive or revoked in trust registry`,
      );
    }
  }

  if (!provenance.approvalAttestation || provenance.approvalAttestation.trim().length === 0) {
    throw new PacProvenanceValidationError(
      'Missing required approvalAttestation digital signature',
    );
  }
}

/**
 * Creates an authentic, valid Mock PAC Contract Provenance for testing.
 */
export function createTestPacProvenance(
  overrides?: Partial<PacContractProvenance>,
): PacContractProvenance {
  const effectiveFrom = new Date(Date.now() - 86400000).toISOString();
  const effectiveUntil = new Date(Date.now() + 365 * 86400000).toISOString();
  const snapshotIssued = new Date(Date.now() - 3600000).toISOString();
  const snapshotValid = new Date(Date.now() + 86400000).toISOString();

  const dummyEvidence = Buffer.from('PAC_CONTRACT_OFFICIAL_EVIDENCE_SPEC_V1');
  const digest = crypto.createHash('sha256').update(dummyEvidence).digest('hex');

  const defaultProvenance: PacContractProvenance = {
    providerName: 'MOCK_PAC',
    contractIdentifier: 'SAT-PAC-2026-001',
    contractVersion: '1.0.0',
    evidenceUriOrReference:
      'https://security-governance.tridentpos.internal/contracts/pac-mock-2026.pdf',
    evidenceMediaType: 'application/pdf',
    evidenceByteLength: dummyEvidence.length,
    evidenceDigestAlgorithm: 'SHA-256',
    evidenceDigest: digest,
    approvalAuthorityId: 'SEC_GOV_AUTHORITY_01',
    approvalKeyId: 'KEY_2026_RSA',
    approvalAttestation: 'SIG_VALID_APPROVED_ATTESTATION_2026',
    approvedScope: {
      organizationId: 'GLOBAL',
      operationType: '*',
      capability: '*',
    },
    effectiveFrom,
    effectiveUntil,
    revocationAuthorityId: 'SEC_GOV_REVOCATION_REGISTRY',
    revocationKeyId: 'REV_KEY_01',
    revocationSequence: 101,
    revocationStatus: 'ACTIVE',
    revocationAttestation: 'REV_SIG_ACTIVE_101',
    revocationSnapshotIssuedAt: snapshotIssued,
    revocationSnapshotValidUntil: snapshotValid,
    guaranteeScopeOrLimitations:
      'Standard SLA with idempotent replay and authoritative query support',
  };

  return {
    ...defaultProvenance,
    ...overrides,
    approvedScope: {
      ...defaultProvenance.approvedScope,
      ...(overrides?.approvedScope ?? {}),
    },
  };
}

/**
 * Fail-closed PAC Connector for production runtime when no certified PAC adapter is configured.
 * Implements QI-BLK-021-R1-02 and SEC-WP021-R4-HIGH-01 fail-closed requirements.
 */
export class UnavailablePacConnector implements IPacConnector {
  public readonly providerName = 'UNAVAILABLE_PAC';
  public readonly contractProvenance = null;
  public readonly capabilities: PacCapabilities = {
    supportsStampIdempotencyKey: false,
    supportsCancellationIdempotencyKey: false,
    supportsAuthoritativeStampLookup: false,
    supportsAuthoritativeCancellationLookup: false,
    supportsSafeStampReplayAfterConfirmedNotFound: false,
    supportsSafeCancellationReplayAfterConfirmedNotFound: false,
  };

  async timbrar(_request: PacStampRequest): Promise<PacStampResult> {
    throw new PacTimeoutError(
      'No approved PAC connector configured in runtime composition. Fiscal stamping is fail-closed.',
    );
  }

  async cancelar(_request: PacCancelRequest): Promise<PacCancelResult> {
    throw new PacTimeoutError(
      'No approved PAC connector configured in runtime composition. Fiscal cancellation is fail-closed.',
    );
  }

  async consultarEstatus(_uuid: string): Promise<{ status: string; esCancelable: boolean }> {
    throw new PacTimeoutError(
      'No approved PAC connector configured in runtime composition. Consultation is fail-closed.',
    );
  }

  async stampInvoice(request: PacStampRequest): Promise<PacStampResult> {
    return this.timbrar(request);
  }

  async cancelInvoice(request: PacCancelRequest): Promise<PacCancelResult> {
    return this.cancelar(request);
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class PacCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 5000;
  }

  public getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  public checkExecutionAllowed(): void {
    const currentState = this.getState();
    if (currentState === 'OPEN') {
      throw new PacCircuitBreakerOpenError(
        'PAC Circuit Breaker is OPEN: external PAC requests temporarily paused to protect system',
      );
    }
  }
}

export interface MockPacBehaviorOptions {
  simulateTimeout?: boolean;
  simulateReject?: boolean;
  rejectErrorCode?: string;
  rejectErrorMessage?: string;
  simulateNetworkError?: boolean;
  simulatePendingApproval?: boolean;
  simulateCorruptedStampXml?: boolean;
  simulateMissingStampUuid?: boolean;
  simulateMismatchStampUuid?: boolean;
}

/**
 * Mock PAC Connector for unit, database, and integration testing.
 * Simulates SAT PAC behavior with configurable operation-specific capabilities and provenance.
 */
export class MockPacConnector implements IPacConnector {
  public readonly providerName: string = 'MOCK_PAC';
  public capabilities: PacCapabilities;
  public contractProvenance?: PacContractProvenance | null;
  public readonly circuitBreaker: PacCircuitBreaker;
  private behavior: MockPacBehaviorOptions = {};
  private readonly stampedRegistry = new Map<string, PacStampResult>();
  private readonly cancelledRegistry = new Set<string>();
  private readonly pendingApprovalRegistry = new Set<string>();

  constructor(
    capabilities?: Partial<PacCapabilities>,
    contractProvenance?: PacContractProvenance | null,
    circuitBreakerOptions?: CircuitBreakerOptions,
  ) {
    this.capabilities = {
      supportsStampIdempotencyKey: false,
      supportsCancellationIdempotencyKey: false,
      supportsAuthoritativeStampLookup: false,
      supportsAuthoritativeCancellationLookup: false,
      supportsSafeStampReplayAfterConfirmedNotFound: false,
      supportsSafeCancellationReplayAfterConfirmedNotFound: false,
      ...capabilities,
    };
    this.contractProvenance = contractProvenance ?? null;
    this.circuitBreaker = new PacCircuitBreaker(circuitBreakerOptions);
  }

  public setBehavior(behavior: MockPacBehaviorOptions): void {
    this.behavior = { ...behavior };
  }

  public resetBehavior(): void {
    this.behavior = {};
  }

  async timbrar(request: PacStampRequest): Promise<PacStampResult> {
    this.circuitBreaker.checkExecutionAllowed();

    const refId =
      request.referenceId ?? request.idempotencyKey ?? request.invoiceId ?? 'default-ref';
    const xml = request.xmlPayload ?? request.xml ?? '';

    // Check idempotency cache first if capability is enabled
    if (this.capabilities.supportsStampIdempotencyKey) {
      const existing = this.stampedRegistry.get(refId);
      if (existing) {
        this.circuitBreaker.recordSuccess();
        return existing;
      }
    }

    if (this.behavior.simulateNetworkError) {
      this.circuitBreaker.recordFailure();
      throw new Error('PAC network connection refused / socket hang up');
    }

    if (this.behavior.simulateTimeout) {
      this.circuitBreaker.recordFailure();
      throw new PacTimeoutError('PAC service timed out after 30000ms');
    }

    if (this.behavior.simulateReject) {
      this.circuitBreaker.recordSuccess();
      return {
        status: 'REJECTED',
        errorCode: this.behavior.rejectErrorCode ?? '301',
        errorMessage:
          this.behavior.rejectErrorMessage ??
          'RFC del receptor no está registrado en el padrón del SAT',
      };
    }

    // Success stamping simulation
    const uuid = this.behavior.simulateMissingStampUuid ? '' : crypto.randomUUID().toUpperCase();
    const nowIso = new Date().toISOString();
    const stampedXmlUuid = this.behavior.simulateMismatchStampUuid
      ? crypto.randomUUID().toUpperCase()
      : uuid;
    const selloSat = crypto
      .createHash('sha256')
      .update(uuid + nowIso + xml)
      .digest('base64');
    const noCertificadoSat = '30001000000500003416';

    const stampedXml = this.behavior.simulateCorruptedStampXml
      ? '<corrupted_xml_without_tfd></corrupted_xml_without_tfd>'
      : xml.replace(
          '</cfdi:Comprobante>',
          `  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" Version="1.1" UUID="${stampedXmlUuid}" FechaTimbrado="${nowIso.substring(
      0,
      19,
    )}" RfcProvCertif="SAT970701NN3" SelloCFD="mockSelloCfd" NoCertificadoSAT="${noCertificadoSat}" SelloSAT="${selloSat}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`,
        );

    const result: PacStampResult = {
      status: 'STAMPED',
      uuid,
      selloSat,
      fechaTimbrado: nowIso,
      noCertificadoSat,
      stampedXml,
      xmlTimbrado: stampedXml,
      pacProvider: this.providerName,
      pacTransactionId: crypto.randomUUID(),
    };

    this.stampedRegistry.set(refId, result);
    this.circuitBreaker.recordSuccess();
    return result;
  }

  async cancelar(request: PacCancelRequest): Promise<PacCancelResult> {
    this.circuitBreaker.checkExecutionAllowed();

    if (this.behavior.simulateNetworkError) {
      this.circuitBreaker.recordFailure();
      throw new Error('PAC cancellation network error');
    }

    if (this.behavior.simulateTimeout) {
      this.circuitBreaker.recordFailure();
      throw new PacTimeoutError('PAC cancellation request timed out');
    }

    if (this.behavior.simulatePendingApproval) {
      this.pendingApprovalRegistry.add(request.uuid);
      this.circuitBreaker.recordSuccess();
      return {
        status: 'PENDING_APPROVAL',
        uuid: request.uuid,
        cancellationCode: '202',
        errorMessage: 'Solicitud de cancelación recibida, en espera de respuesta del receptor',
        pacProvider: this.providerName,
        pacTransactionId: crypto.randomUUID(),
      };
    }

    if (this.behavior.simulateReject) {
      this.circuitBreaker.recordSuccess();
      return {
        status: 'REJECTED',
        uuid: request.uuid,
        cancellationCode: '702',
        errorMessage: 'El comprobante ya se encuentra cancelado o UUID no encontrado',
        pacProvider: this.providerName,
        pacTransactionId: crypto.randomUUID(),
      };
    }

    this.cancelledRegistry.add(request.uuid);
    this.circuitBreaker.recordSuccess();
    return {
      status: 'CANCELLED',
      uuid: request.uuid,
      cancellationCode: '201',
      pacProvider: this.providerName,
      pacTransactionId: crypto.randomUUID(),
    };
  }

  async consultarEstatus(uuid: string): Promise<{ status: string; esCancelable: boolean }> {
    this.circuitBreaker.checkExecutionAllowed();
    if (this.cancelledRegistry.has(uuid)) {
      return { status: 'Cancelado', esCancelable: false };
    }
    if (this.pendingApprovalRegistry.has(uuid)) {
      return { status: 'En proceso', esCancelable: false };
    }
    return { status: 'Vigente', esCancelable: true };
  }

  async consultarTimbre(params: {
    organizationId: string;
    invoiceId?: string;
    idempotencyKey?: string;
    uuid?: string;
  }): Promise<AuthoritativeStampReconciliationResult> {
    this.circuitBreaker.checkExecutionAllowed();
    const ref = params.idempotencyKey ?? params.invoiceId ?? params.uuid;
    const existing = ref ? this.stampedRegistry.get(ref) : undefined;
    if (existing && existing.status === 'STAMPED') {
      return {
        outcome: 'STAMPED_CONFIRMED',
        uuid: existing.uuid,
        stampedXml: existing.stampedXml,
        selloSat: existing.selloSat,
        fechaTimbrado: existing.fechaTimbrado,
        noCertificadoSat: existing.noCertificadoSat,
        providerReference: existing.pacTransactionId,
      };
    }
    return { outcome: 'NOT_FOUND_CONFIRMED' };
  }

  async consultarCancelacion(params: {
    organizationId: string;
    invoiceId?: string;
    uuid: string;
  }): Promise<AuthoritativeCancellationReconciliationResult> {
    this.circuitBreaker.checkExecutionAllowed();
    if (this.cancelledRegistry.has(params.uuid)) {
      return { outcome: 'CANCELLATION_CONFIRMED', uuid: params.uuid, cancellationCode: '201' };
    }
    if (this.pendingApprovalRegistry.has(params.uuid)) {
      return { outcome: 'PENDING_APPROVAL', uuid: params.uuid, cancellationCode: '202' };
    }
    return { outcome: 'NOT_FOUND_CONFIRMED', uuid: params.uuid };
  }

  async stampInvoice(request: PacStampRequest): Promise<PacStampResult> {
    return this.timbrar(request);
  }

  async cancelInvoice(request: PacCancelRequest): Promise<PacCancelResult> {
    return this.cancelar(request);
  }
}
