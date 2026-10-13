/**
 * TRIDENTPOS WP-023: Delivery KDS Comanda Dispatcher
 * Dispatches accepted external delivery orders into kitchen comanda format for real-time display on KDS stations.
 */

import type { DeliveryOrder, KdsComandaDispatch, KdsComandaItem } from './types.js';

export class DeliveryKdsDispatcher {
  /**
   * Generates a KDS comanda dispatch payload from an accepted delivery order.
   */
  public createComanda(order: DeliveryOrder): KdsComandaDispatch {
    if (order.status !== 'ACCEPTED') {
      throw new Error(
        `Cannot dispatch unaccepted delivery order '${order.id}' (Status: ${order.status}) to KDS.`,
      );
    }

    const items: KdsComandaItem[] = order.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.internalProductId,
      name: item.name,
      quantity: item.quantity,
      modifiers: item.modifiers.map((m) => ({
        name: m.name,
        quantity: m.quantity,
      })),
      notes: item.notes,
    }));

    const combinedNotes = [
      order.orderNotes ? `[NOTAS PEDIDO] ${order.orderNotes}` : '',
      order.deliveryNotes ? `[ENTREGA] ${order.deliveryNotes}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      comandaId: crypto.randomUUID(),
      orgId: order.orgId,
      branchId: order.branchId,
      channel: order.channel,
      externalOrderId: order.externalOrderId,
      customerName: order.customerName,
      orderType: 'DELIVERY',
      items,
      notes: combinedNotes || undefined,
      createdAt: new Date().toISOString(),
    };
  }
}
