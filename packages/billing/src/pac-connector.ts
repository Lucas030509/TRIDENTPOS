/**
 * TRIDENTPOS Billing: PAC (Proveedor Autorizado de Certificación) Connector Interface & Mock Adapter
 * Implements PAC Gateway boundary with circuit breaker protection and retry idempotency.
 */

import crypto from 'node:crypto';
import { PacCircuitBreakerOpenError, PacTimeoutError } from './errors.js';
import type {
  PacCancelRequest,
  PacCancelResult,
  PacStampRequest,
  PacStampResult,
} from './types.js';

export interface IPacConnector {
  timbrar(request: PacStampRequest): Promise<PacStampResult>;
  cancelar(request: PacCancelRequest): Promise<PacCancelResult>;
  consultarEstatus(uuid: string): Promise<{ status: string; esCancelable: boolean }>;
  stampInvoice(request: PacStampRequest): Promise<PacStampResult>;
  cancelInvoice(request: PacCancelRequest): Promise<PacCancelResult>;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of consecutive failures to trip
  cooldownMs?: number; // Time in ms before testing half-open
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
}

/**
 * Mock PAC Connector for unit, database, and integration testing.
 * Simulates real SAT PAC behavior with deterministic idempotency.
 */
export class MockPacConnector implements IPacConnector {
  public readonly circuitBreaker: PacCircuitBreaker;
  private behavior: MockPacBehaviorOptions = {};
  private readonly stampedRegistry = new Map<string, PacStampResult>();
  private readonly cancelledRegistry = new Set<string>();

  constructor(circuitBreakerOptions?: CircuitBreakerOptions) {
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

    // Check idempotency cache first
    const existing = this.stampedRegistry.get(refId);
    if (existing) {
      this.circuitBreaker.recordSuccess();
      return existing;
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
      this.circuitBreaker.recordSuccess(); // Rejections are valid PAC responses, not circuit-tripping failures
      return {
        status: 'REJECTED',
        errorCode: this.behavior.rejectErrorCode ?? '301',
        errorMessage:
          this.behavior.rejectErrorMessage ??
          'RFC del receptor no está registrado en el padrón del SAT',
      };
    }

    // Success stamping
    const uuid = crypto.randomUUID().toUpperCase();
    const nowIso = new Date().toISOString();
    const selloSat = crypto
      .createHash('sha256')
      .update(uuid + nowIso + xml)
      .digest('base64');
    const noCertificadoSat = '30001000000500003416';

    const stampedXml = xml.replace(
      '</cfdi:Comprobante>',
      `  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" Version="1.1" UUID="${uuid}" FechaTimbrado="${nowIso.substring(
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
      pacProvider: 'MOCK_PAC',
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

    if (this.behavior.simulateReject) {
      this.circuitBreaker.recordSuccess();
      return {
        status: 'REJECTED',
        uuid: request.uuid,
        cancellationCode: '702',
        errorMessage: 'El comprobante ya se encuentra cancelado o UUID no encontrado',
      };
    }

    this.cancelledRegistry.add(request.uuid);
    this.circuitBreaker.recordSuccess();
    return {
      status: 'CANCELLED',
      uuid: request.uuid,
      cancellationCode: '201',
    };
  }

  async consultarEstatus(uuid: string): Promise<{ status: string; esCancelable: boolean }> {
    this.circuitBreaker.checkExecutionAllowed();
    const isCancelled = this.cancelledRegistry.has(uuid);
    return {
      status: isCancelled ? 'Cancelado' : 'Vigente',
      esCancelable: true,
    };
  }

  async stampInvoice(request: PacStampRequest): Promise<PacStampResult> {
    return this.timbrar(request);
  }

  async cancelInvoice(request: PacCancelRequest): Promise<PacCancelResult> {
    return this.cancelar(request);
  }
}
