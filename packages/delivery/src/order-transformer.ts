/**
 * TRIDENTPOS WP-023: Delivery Order Transformation & Catalog Resolver
 * Maps external aggregator schemas (Uber Eats, Rappi, Didi Food) to canonical DeliveryOrder and evaluates auto-accept rules.
 */

import type {
  CatalogMappingProvider,
  DeliveryFinancials,
  DeliveryIntegrationConfig,
  DeliveryItem,
  DeliveryOrder,
  ExternalOrderPayload,
  AutoAcceptDecision,
} from './types.js';
import { UnmappedCatalogItemError } from './errors.js';
import { compareScale4, toScale4BigInt, fromScale4BigInt } from './numerics.js';

export interface TransformOptions {
  orgId: string;
  branchId: string;
  allowUnmappedItems?: boolean;
}

export class DeliveryOrderTransformer {
  private readonly catalogProvider?: CatalogMappingProvider;

  constructor(catalogProvider?: CatalogMappingProvider) {
    this.catalogProvider = catalogProvider;
  }

  /**
   * Transforms an external aggregator payload into the canonical DeliveryOrder domain aggregate.
   */
  public async transform(
    payload: ExternalOrderPayload,
    options: TransformOptions,
  ): Promise<DeliveryOrder> {
    const { orgId, branchId, allowUnmappedItems = false } = options;

    // 1. Transform Items and Resolve Internal Catalog
    const transformedItems: DeliveryItem[] = [];

    for (const extItem of payload.items) {
      let internalProductId = `mapped-prod-${extItem.externalItemId}`;
      let internalRecipeId: string | undefined = undefined;
      let internalName = extItem.name;

      if (this.catalogProvider) {
        const mapping = await this.catalogProvider.resolveItem(
          orgId,
          payload.channel,
          extItem.externalItemId,
          extItem.sku,
        );

        if (mapping) {
          internalProductId = mapping.internalProductId;
          internalRecipeId = mapping.internalRecipeId;
          internalName = mapping.internalName;
        } else if (!allowUnmappedItems) {
          throw new UnmappedCatalogItemError(payload.channel, extItem.externalItemId, extItem.sku);
        }
      }

      transformedItems.push({
        internalProductId,
        internalRecipeId,
        sku: extItem.sku,
        name: internalName,
        quantity: extItem.quantity,
        unitPrice: fromScale4BigInt(toScale4BigInt(extItem.unitPrice)),
        totalPrice: fromScale4BigInt(toScale4BigInt(extItem.totalPrice)),
        notes: extItem.notes,
        modifiers: (extItem.modifiers || []).map((m) => ({
          internalModifierId: m.externalModifierId,
          name: m.name,
          quantity: m.quantity,
          unitPrice: fromScale4BigInt(toScale4BigInt(m.unitPrice)),
        })),
      });
    }

    // 2. Canonical Scale-4 Financials
    const financials: DeliveryFinancials = {
      subtotal: fromScale4BigInt(toScale4BigInt(payload.financials.subtotal)),
      taxTotal: fromScale4BigInt(toScale4BigInt(payload.financials.taxTotal)),
      platformCommission: fromScale4BigInt(
        toScale4BigInt(payload.financials.platformCommission || '0.0000'),
      ),
      deliveryFee: fromScale4BigInt(toScale4BigInt(payload.financials.deliveryFee || '0.0000')),
      customerTip: fromScale4BigInt(toScale4BigInt(payload.financials.customerTip || '0.0000')),
      grandTotal: fromScale4BigInt(toScale4BigInt(payload.financials.grandTotal)),
    };

    // 3. Format Delivery Address
    let formattedAddress: string | undefined = undefined;
    if (payload.deliveryAddress) {
      const parts = [
        payload.deliveryAddress.street,
        payload.deliveryAddress.interior,
        payload.deliveryAddress.colonia,
        payload.deliveryAddress.city,
        payload.deliveryAddress.postalCode,
      ].filter(Boolean);
      formattedAddress = parts.join(', ');
    }

    const now = new Date();

    return {
      id: crypto.randomUUID(),
      orgId,
      branchId,
      channel: payload.channel,
      externalOrderId: payload.externalOrderId,
      eventId: payload.eventId,
      status: 'PENDING',
      customerName: payload.customer.name.trim(),
      customerPhone: payload.customer.phone,
      deliveryAddress: formattedAddress,
      deliveryNotes: payload.deliveryAddress?.deliveryNotes || payload.customer.notes,
      courierName: payload.courier?.name,
      courierPhone: payload.courier?.phone,
      items: transformedItems,
      financials,
      orderNotes: payload.notes,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Evaluates auto-accept policies for incoming delivery order.
   */
  public evaluateAutoAccept(
    order: DeliveryOrder,
    config: DeliveryIntegrationConfig,
    operationalContext?: { isKitchenBusy?: boolean; isStoreOpen?: boolean },
  ): AutoAcceptDecision {
    if (!config.isEnabled) {
      return { accepted: false, reason: 'INTEGRATION_DISABLED' };
    }

    if (operationalContext?.isStoreOpen === false) {
      return { accepted: false, reason: 'STORE_CLOSED' };
    }

    if (operationalContext?.isKitchenBusy === true) {
      return { accepted: false, reason: 'KITCHEN_BUSY' };
    }

    if (!config.autoAcceptEnabled) {
      return { accepted: false, reason: 'AUTO_ACCEPT_OFF' };
    }

    // Min order amount check
    if (
      config.minOrderAmount &&
      compareScale4(order.financials.grandTotal, config.minOrderAmount) < 0
    ) {
      return {
        accepted: false,
        reason: `ORDER_BELOW_MINIMUM_${config.minOrderAmount}`,
      };
    }

    // Max order amount check
    if (
      config.maxOrderAmount &&
      compareScale4(order.financials.grandTotal, config.maxOrderAmount) > 0
    ) {
      return {
        accepted: false,
        reason: `ORDER_EXCEEDS_MAXIMUM_${config.maxOrderAmount}`,
      };
    }

    return { accepted: true };
  }

  /**
   * Applies auto-accept decision to the DeliveryOrder.
   */
  public applyDecision(order: DeliveryOrder, decision: AutoAcceptDecision): DeliveryOrder {
    if (decision.accepted) {
      return {
        ...order,
        status: 'ACCEPTED',
        updatedAt: new Date(),
      };
    } else {
      return {
        ...order,
        status: 'REJECTED',
        rejectionReason: decision.reason,
        updatedAt: new Date(),
      };
    }
  }
}
