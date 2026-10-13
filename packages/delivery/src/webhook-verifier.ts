/**
 * TRIDENTPOS WP-023: Webhook Cryptographic Verifier & Replay Guard (SEC-VAL-10)
 * Implements provider-specific HMAC verification, timing-safe equality, timestamp replay tolerance, and event deduplication.
 */

import crypto from 'node:crypto';
import type { ConnectorContract, DeliveryChannel, IncomingWebhookRequest } from './types.js';
import {
  InvalidWebhookSignatureError,
  StaleWebhookTimestampError,
  DuplicateWebhookEventError,
  UnknownDeliveryProviderError,
} from './errors.js';

export const DEFAULT_REPLAY_WINDOW_MS = 300_000; // 5 minutes (SEC-VAL-10 baseline)
export const MAX_FUTURE_CLOCK_DRIFT_MS = 60_000; // 1 minute future drift limit

export const STANDARD_CONNECTOR_CONTRACTS: Record<DeliveryChannel, ConnectorContract> = {
  UBER_EATS: {
    channel: 'UBER_EATS',
    algorithm: 'HMAC_SHA256',
    signatureHeader: 'x-uber-signature',
    timestampHeader: 'x-delivery-timestamp',
    replayWindowMs: DEFAULT_REPLAY_WINDOW_MS,
    signatureFormat: 'hex',
  },
  RAPPI: {
    channel: 'RAPPI',
    algorithm: 'HMAC_SHA256',
    signatureHeader: 'x-rappi-signature',
    timestampHeader: 'x-rappi-timestamp',
    replayWindowMs: DEFAULT_REPLAY_WINDOW_MS,
    signatureFormat: 'hex',
  },
  DIDIFOOD: {
    channel: 'DIDIFOOD',
    algorithm: 'HMAC_SHA256',
    signatureHeader: 'x-didi-signature',
    timestampHeader: 'x-didi-timestamp',
    replayWindowMs: DEFAULT_REPLAY_WINDOW_MS,
    signatureFormat: 'hex',
  },
  DIRECT_FLEET: {
    channel: 'DIRECT_FLEET',
    algorithm: 'HMAC_SHA256',
    signatureHeader: 'x-trident-signature',
    timestampHeader: 'x-trident-timestamp',
    replayWindowMs: DEFAULT_REPLAY_WINDOW_MS,
    signatureFormat: 'hex',
  },
};

export class WebhookDeduplicationStore {
  private readonly processedEvents = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 86_400_000) {
    // 24 hours retention
    this.ttlMs = ttlMs;
  }

  public has(eventId: string): boolean {
    this.purgeStale();
    return this.processedEvents.has(eventId);
  }

  public record(eventId: string, processedAt = Date.now()): void {
    this.purgeStale();
    this.processedEvents.set(eventId, processedAt);
  }

  public clear(): void {
    this.processedEvents.clear();
  }

  private purgeStale(): void {
    const threshold = Date.now() - this.ttlMs;
    for (const [key, timestamp] of this.processedEvents.entries()) {
      if (timestamp < threshold) {
        this.processedEvents.delete(key);
      }
    }
  }
}

export class WebhookCryptographicVerifier {
  private readonly deduplicationStore: WebhookDeduplicationStore;
  private readonly contracts: Map<DeliveryChannel, ConnectorContract>;

  constructor(
    deduplicationStore = new WebhookDeduplicationStore(),
    customContracts?: Partial<Record<DeliveryChannel, ConnectorContract>>,
  ) {
    this.deduplicationStore = deduplicationStore;
    this.contracts = new Map(
      Object.entries(STANDARD_CONNECTOR_CONTRACTS) as [DeliveryChannel, ConnectorContract][],
    );

    if (customContracts) {
      for (const [channel, contract] of Object.entries(customContracts)) {
        if (contract) {
          this.contracts.set(channel as DeliveryChannel, contract);
        }
      }
    }
  }

  /**
   * Generates a valid HMAC signature for mock and testing harnesses.
   */
  public generateSignature(
    channel: DeliveryChannel,
    rawBody: string,
    secret: string,
    timestamp?: string | number,
  ): string {
    const contract = this.getContract(channel);
    const payloadToSign = timestamp ? `${timestamp}.${rawBody}` : rawBody;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadToSign);
    return hmac.digest(contract.signatureFormat);
  }

  /**
   * Verifies incoming webhook request cryptographic authenticity, freshness, and uniqueness.
   */
  public verify(
    request: IncomingWebhookRequest,
    secret: string,
    eventId: string,
    nowMs: number = Date.now(),
  ): { verified: boolean; timestampMs: number } {
    const contract = this.getContract(request.channel);

    // 1. Replay Protection: Check event deduplication
    if (this.deduplicationStore.has(eventId)) {
      throw new DuplicateWebhookEventError(request.channel, eventId);
    }

    // 2. Extract and Validate Signature Header
    const signature = this.getHeaderCaseInsensitive(request.headers, contract.signatureHeader);
    if (!signature) {
      throw new InvalidWebhookSignatureError(
        request.channel,
        `Missing required signature header '${contract.signatureHeader}'.`,
      );
    }

    // 3. Extract and Validate Timestamp
    let timestampMs: number;
    let timestampHeaderValue: string | undefined;

    if (contract.timestampHeader) {
      timestampHeaderValue = this.getHeaderCaseInsensitive(
        request.headers,
        contract.timestampHeader,
      );
    }

    if (timestampHeaderValue) {
      const parsedNum = Number(timestampHeaderValue);
      timestampMs = Number.isFinite(parsedNum)
        ? parsedNum > 10_000_000_000
          ? parsedNum // epoch ms
          : parsedNum * 1000 // epoch s
        : Date.parse(timestampHeaderValue);
    } else {
      // Fallback: try parsing orderTimestamp from json payload if rawBody is valid json
      try {
        const parsedBody = JSON.parse(request.rawBody) as { orderTimestamp?: string };
        timestampMs = parsedBody.orderTimestamp ? Date.parse(parsedBody.orderTimestamp) : nowMs;
      } catch {
        timestampMs = nowMs;
      }
    }

    if (!Number.isFinite(timestampMs)) {
      throw new StaleWebhookTimestampError(request.channel, Infinity, contract.replayWindowMs);
    }

    // Check future clock drift (over 60s into the future)
    if (timestampMs > nowMs + MAX_FUTURE_CLOCK_DRIFT_MS) {
      throw new StaleWebhookTimestampError(
        request.channel,
        timestampMs - nowMs,
        contract.replayWindowMs,
      );
    }

    // Check past age beyond provider replay window
    const ageMs = nowMs - timestampMs;
    if (ageMs > contract.replayWindowMs) {
      throw new StaleWebhookTimestampError(request.channel, ageMs, contract.replayWindowMs);
    }

    // 4. Compute Expected Signature
    const payloadToSign = timestampHeaderValue
      ? `${timestampHeaderValue}.${request.rawBody}`
      : request.rawBody;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadToSign)
      .digest(contract.signatureFormat);

    // 5. Timing-Safe Comparison
    const sigBuffer = Buffer.from(signature, contract.signatureFormat);
    const expectedBuffer = Buffer.from(expectedSignature, contract.signatureFormat);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      // If timestamp header was used, also check rawBody-only as backward compatibility fallback
      if (timestampHeaderValue) {
        const altExpected = crypto
          .createHmac('sha256', secret)
          .update(request.rawBody)
          .digest(contract.signatureFormat);
        const altBuffer = Buffer.from(altExpected, contract.signatureFormat);
        if (sigBuffer.length === altBuffer.length && crypto.timingSafeEqual(sigBuffer, altBuffer)) {
          // Alternative rawBody-only matched
          this.deduplicationStore.record(eventId, nowMs);
          return { verified: true, timestampMs };
        }
      }
      throw new InvalidWebhookSignatureError(
        request.channel,
        'Signature does not match computed HMAC digest.',
      );
    }

    // 6. Record processed event in deduplication store
    this.deduplicationStore.record(eventId, nowMs);

    return { verified: true, timestampMs };
  }

  private getContract(channel: DeliveryChannel): ConnectorContract {
    const contract = this.contracts.get(channel);
    if (!contract) {
      throw new UnknownDeliveryProviderError(channel);
    }
    return contract;
  }

  private getHeaderCaseInsensitive(
    headers: Record<string, string | undefined>,
    targetName: string,
  ): string | undefined {
    const lowerTarget = targetName.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerTarget) {
        return value;
      }
    }
    return undefined;
  }
}
