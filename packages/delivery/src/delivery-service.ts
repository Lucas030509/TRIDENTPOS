/**
 * TRIDENTPOS WP-023: Delivery Integration Hub Service
 * Orchestrates incoming webhooks, cryptographic authentication, schema transformation, auto-accept logic, and KDS comanda dispatch.
 */

import type {
  DeliveryIntegrationConfig,
  DeliveryOrder,
  ExternalOrderPayload,
  IncomingWebhookRequest,
  KdsComandaDispatch,
} from './types.js';
import { WebhookCryptographicVerifier } from './webhook-verifier.js';
import { DeliveryOrderTransformer } from './order-transformer.js';
import { DeliveryKdsDispatcher } from './kds-dispatcher.js';
import { IntegrationDisabledError } from './errors.js';

export interface ProcessWebhookResult {
  verified: boolean;
  order: DeliveryOrder;
  kdsComanda?: KdsComandaDispatch;
}

export class DeliveryHubService {
  private readonly verifier: WebhookCryptographicVerifier;
  private readonly transformer: DeliveryOrderTransformer;
  private readonly kdsDispatcher: DeliveryKdsDispatcher;

  constructor(
    verifier = new WebhookCryptographicVerifier(),
    transformer = new DeliveryOrderTransformer(),
    kdsDispatcher = new DeliveryKdsDispatcher(),
  ) {
    this.verifier = verifier;
    this.transformer = transformer;
    this.kdsDispatcher = kdsDispatcher;
  }

  /**
   * Processes an incoming delivery webhook request end-to-end.
   */
  public async processWebhook(
    request: IncomingWebhookRequest,
    config: DeliveryIntegrationConfig,
    operationalContext?: { isKitchenBusy?: boolean; isStoreOpen?: boolean },
    nowMs: number = Date.now(),
  ): Promise<ProcessWebhookResult> {
    if (!config.isEnabled) {
      throw new IntegrationDisabledError(request.channel, config.branchId);
    }

    // 1. Parse raw body to extract eventId and payload
    let payload: ExternalOrderPayload;
    try {
      payload = JSON.parse(request.rawBody) as ExternalOrderPayload;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[${request.channel}] Failed to parse webhook raw body as JSON: ${msg}`);
    }

    // 2. Verify Cryptographic Authenticity & Freshness
    const { verified } = this.verifier.verify(
      request,
      config.webhookSecret,
      payload.eventId,
      nowMs,
    );

    // 3. Transform to Canonical DeliveryOrder
    const order = await this.transformer.transform(payload, {
      orgId: config.orgId,
      branchId: config.branchId,
      allowUnmappedItems: false,
    });

    // 4. Evaluate Auto-Accept Policy
    const decision = this.transformer.evaluateAutoAccept(order, config, operationalContext);
    const finalizedOrder = this.transformer.applyDecision(order, decision);

    // 5. If Accepted, Dispatch to KDS
    let kdsComanda: KdsComandaDispatch | undefined = undefined;
    if (finalizedOrder.status === 'ACCEPTED') {
      kdsComanda = this.kdsDispatcher.createComanda(finalizedOrder);
      finalizedOrder.kdsComandaId = kdsComanda.comandaId;
    }

    return {
      verified,
      order: finalizedOrder,
      kdsComanda,
    };
  }

  public getVerifier(): WebhookCryptographicVerifier {
    return this.verifier;
  }

  public getTransformer(): DeliveryOrderTransformer {
    return this.transformer;
  }

  public getKdsDispatcher(): DeliveryKdsDispatcher {
    return this.kdsDispatcher;
  }
}
