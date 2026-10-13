/**
 * TRIDENTPOS WP-023: Delivery Hub & Aggregator Webhook Types
 * Canonical domain definitions for Uber Eats, Rappi, Didi Food & Fleet Logistics
 */

export type DeliveryChannel = 'UBER_EATS' | 'RAPPI' | 'DIDIFOOD' | 'DIRECT_FLEET';

export type DeliveryOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED';

export type WebhookVerificationAlgorithm = 'HMAC_SHA256';

export interface ConnectorContract {
  channel: DeliveryChannel;
  algorithm: WebhookVerificationAlgorithm;
  signatureHeader: string;
  timestampHeader?: string;
  replayWindowMs: number; // e.g. 300,000 ms (5 min) default per SEC-VAL-10
  signatureFormat: 'hex' | 'base64';
}

export interface DeliveryIntegrationConfig {
  id: string;
  orgId: string;
  branchId: string;
  channel: DeliveryChannel;
  storeExternalId: string;
  webhookSecret: string;
  apiKey?: string;
  isEnabled: boolean;
  autoAcceptEnabled: boolean;
  minOrderAmount?: string; // Scale-4
  maxOrderAmount?: string; // Scale-4
}

export interface IncomingWebhookRequest {
  channel: DeliveryChannel;
  headers: Record<string, string | undefined>;
  rawBody: string;
  receivedAt?: Date;
}

export interface ExternalOrderItemModifier {
  externalModifierId: string;
  name: string;
  quantity: number;
  unitPrice: string; // Scale-4
}

export interface ExternalOrderItem {
  externalItemId: string;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: string; // Scale-4
  totalPrice: string; // Scale-4
  notes?: string;
  modifiers?: ExternalOrderItemModifier[];
}

export interface ExternalOrderPayload {
  eventId: string;
  channel: DeliveryChannel;
  storeExternalId: string;
  externalOrderId: string;
  orderTimestamp: string; // ISO 8601 or epoch ms
  customer: {
    name: string;
    phone?: string;
    notes?: string;
  };
  deliveryAddress?: {
    street: string;
    interior?: string;
    colonia?: string;
    city?: string;
    postalCode?: string;
    latitude?: number;
    longitude?: number;
    deliveryNotes?: string;
  };
  courier?: {
    name?: string;
    phone?: string;
    vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
    licensePlate?: string;
  };
  items: ExternalOrderItem[];
  financials: {
    subtotal: string; // Scale-4
    taxTotal: string; // Scale-4
    platformCommission?: string; // Scale-4
    deliveryFee?: string; // Scale-4
    customerTip?: string; // Scale-4
    grandTotal: string; // Scale-4
  };
  notes?: string;
}

export interface DeliveryModifier {
  internalModifierId?: string;
  name: string;
  quantity: number;
  unitPrice: string; // Scale-4
}

export interface DeliveryItem {
  internalProductId: string;
  internalRecipeId?: string;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: string; // Scale-4
  totalPrice: string; // Scale-4
  notes?: string;
  modifiers: DeliveryModifier[];
}

export interface DeliveryFinancials {
  subtotal: string; // Scale-4
  taxTotal: string; // Scale-4
  platformCommission: string; // Scale-4
  deliveryFee: string; // Scale-4
  customerTip: string; // Scale-4
  grandTotal: string; // Scale-4
}

export interface DeliveryOrder {
  id: string;
  orgId: string;
  branchId: string;
  channel: DeliveryChannel;
  externalOrderId: string;
  eventId: string;
  status: DeliveryOrderStatus;
  customerName: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  courierName?: string;
  courierPhone?: string;
  items: DeliveryItem[];
  financials: DeliveryFinancials;
  orderNotes?: string;
  rejectionReason?: string;
  kdsComandaId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogItemMapping {
  externalItemId: string;
  sku?: string;
  internalProductId: string;
  internalRecipeId?: string;
  internalName: string;
  isAvailable: boolean;
}

export interface CatalogMappingProvider {
  resolveItem(
    orgId: string,
    channel: DeliveryChannel,
    externalItemId: string,
    sku?: string,
  ): Promise<CatalogItemMapping | null>;
}

export interface AutoAcceptDecision {
  accepted: boolean;
  reason?: string;
}

export interface KdsComandaItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  modifiers: { name: string; quantity: number }[];
  notes?: string;
}

export interface KdsComandaDispatch {
  comandaId: string;
  orgId: string;
  branchId: string;
  channel: DeliveryChannel;
  externalOrderId: string;
  customerName: string;
  orderType: 'DELIVERY';
  items: KdsComandaItem[];
  notes?: string;
  createdAt: string;
}
