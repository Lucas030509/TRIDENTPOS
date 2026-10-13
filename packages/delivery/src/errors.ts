/**
 * TRIDENTPOS WP-023: Delivery Hub Domain Errors
 */

export class InvalidWebhookSignatureError extends Error {
  public readonly channel: string;

  constructor(channel: string, message = 'Invalid webhook cryptographic signature.') {
    super(`[${channel}] ${message}`);
    this.name = 'InvalidWebhookSignatureError';
    this.channel = channel;
  }
}

export class StaleWebhookTimestampError extends Error {
  public readonly channel: string;
  public readonly eventAgeMs: number;
  public readonly maxToleranceMs: number;

  constructor(channel: string, eventAgeMs: number, maxToleranceMs: number) {
    super(
      `[${channel}] Webhook timestamp outside allowed replay window. Age: ${eventAgeMs}ms, Max tolerance: ${maxToleranceMs}ms.`,
    );
    this.name = 'StaleWebhookTimestampError';
    this.channel = channel;
    this.eventAgeMs = eventAgeMs;
    this.maxToleranceMs = maxToleranceMs;
  }
}

export class DuplicateWebhookEventError extends Error {
  public readonly channel: string;
  public readonly eventId: string;

  constructor(channel: string, eventId: string) {
    super(`[${channel}] Duplicate webhook event detected. EventId '${eventId}' already processed.`);
    this.name = 'DuplicateWebhookEventError';
    this.channel = channel;
    this.eventId = eventId;
  }
}

export class UnknownDeliveryProviderError extends Error {
  public readonly channel: string;

  constructor(channel: string) {
    super(`Unknown or unsupported delivery aggregator channel: '${channel}'.`);
    this.name = 'UnknownDeliveryProviderError';
    this.channel = channel;
  }
}

export class IntegrationDisabledError extends Error {
  public readonly channel: string;
  public readonly branchId: string;

  constructor(channel: string, branchId: string) {
    super(`[${channel}] Delivery integration is disabled for branch '${branchId}'.`);
    this.name = 'IntegrationDisabledError';
    this.channel = channel;
    this.branchId = branchId;
  }
}

export class DeliveryOrderRejectedError extends Error {
  public readonly channel: string;
  public readonly reason: string;

  constructor(channel: string, reason: string) {
    super(`[${channel}] Delivery order rejected by auto-accept policy: ${reason}`);
    this.name = 'DeliveryOrderRejectedError';
    this.channel = channel;
    this.reason = reason;
  }
}

export class UnmappedCatalogItemError extends Error {
  public readonly channel: string;
  public readonly externalItemId: string;
  public readonly sku?: string;

  constructor(channel: string, externalItemId: string, sku?: string) {
    super(
      `[${channel}] External item '${externalItemId}' (SKU: ${sku || 'N/A'}) cannot be mapped to internal catalog.`,
    );
    this.name = 'UnmappedCatalogItemError';
    this.channel = channel;
    this.externalItemId = externalItemId;
    this.sku = sku;
  }
}
