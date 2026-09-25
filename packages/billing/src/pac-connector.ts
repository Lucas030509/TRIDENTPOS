/**
 * TRIDENTPOS Billing: PAC (Proveedor Autorizado de Certificación) Connector Interface & Adapters
 * Governed by ACR-2026-020 (Sections 4, 7, 8, 9, 15).
 * Implements operation-specific capability declaration, contractual provenance validation, and reconciliation.
 */

import crypto from 'node:crypto';
import {
  PacCircuitBreakerOpenError,
  PacTimeoutError,
  PacCapabilityMissingError,
  PacContractProvenanceMissingError,
} from './errors.js';
import type {
  AuthoritativeCancellationReconciliationResult,
  AuthoritativeStampReconciliationResult,
  PacCancelRequest,
  PacCancelResult,
  PacCapabilities,
  PacContractProvenance,
  PacStampRequest,
  PacStampResult,
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

/**
 * Validates that an adapter capability is enabled and supported by valid contractual provenance.
 * Governed by ACR-2026-020 Section 4.1.
 */
export function validatePacCapabilityProvenance(
  connector: IPacConnector,
  requiredCapability: keyof PacCapabilities,
): void {
  const isEnabled = Boolean(connector.capabilities[requiredCapability]);
  if (!isEnabled) {
    throw new PacCapabilityMissingError(
      `Provider '${connector.providerName}' does not support required capability '${String(requiredCapability)}'`,
    );
  }
  if (!connector.contractProvenance || !connector.contractProvenance.contractIdentifier) {
    throw new PacContractProvenanceMissingError(
      `Provider '${connector.providerName}' declared capability '${String(requiredCapability)}' without verified contract provenance`,
    );
  }
}

/**
 * Fail-closed PAC Connector for production runtime when no certified PAC adapter is configured.
 * Implements QI-BLK-021-R1-02 fail-closed requirement.
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
 * Simulates SAT PAC behavior with configurable operation-specific capabilities.
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
