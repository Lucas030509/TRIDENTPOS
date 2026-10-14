/**
 * TRIDENTPOS WP-024: BI Dashboard & Sales Analytics Service
 * Aggregates revenue, channel distribution, hourly velocity, and average ticket.
 */

import type {
  ChannelRevenueBreakdown,
  HourlySalesPoint,
  SalesKpiSummary,
  TopProductMetric,
} from '../../types.js';
import {
  addScale4,
  compareScale4,
  divideScale4,
  fromScale4BigInt,
  multiplyScale4,
  subScale4,
  toScale4BigInt,
} from '../../numerics.js';

export interface RawCompletedOrder {
  readonly orderId: string;
  readonly completedAt: string; // ISO date
  readonly channel: string; // 'SALON', 'UBER_EATS', 'RAPPI', 'DIDIFOOD', 'DIRECT_FLEET'
  readonly subtotalScale4: string;
  readonly taxScale4: string;
  readonly discountsScale4: string;
  readonly totalScale4: string;
  readonly items: readonly {
    productId: string;
    productName: string;
    quantity: number;
    priceScale4: string;
  }[];
}

export class AnalyticsService {
  /**
   * Aggregates orders into daily KPI summaries.
   */
  public computeSalesKpis(date: string, orders: readonly RawCompletedOrder[]): SalesKpiSummary {
    let grossSalesScale4 = '0.0000';
    let discountsScale4 = '0.0000';
    let taxAmountScale4 = '0.0000';

    for (const order of orders) {
      grossSalesScale4 = addScale4(grossSalesScale4, order.subtotalScale4);
      discountsScale4 = addScale4(discountsScale4, order.discountsScale4);
      taxAmountScale4 = addScale4(taxAmountScale4, order.taxScale4);
    }

    const netSalesScale4 = subScale4(grossSalesScale4, discountsScale4);
    const completedOrdersCount = orders.length;

    let averageTicketScale4 = '0.0000';
    if (completedOrdersCount > 0) {
      const countScale4 = fromScale4BigInt(BigInt(completedOrdersCount) * 10000n);
      const totalRevenue = addScale4(netSalesScale4, taxAmountScale4);
      averageTicketScale4 = divideScale4(totalRevenue, countScale4);
    }

    return {
      date,
      grossSalesScale4,
      netSalesScale4,
      taxAmountScale4,
      discountsScale4,
      completedOrdersCount,
      averageTicketScale4,
    };
  }

  /**
   * Calculates revenue share by ordering channel (Salón, Uber Eats, Rappi, etc.).
   */
  public computeChannelBreakdown(
    orders: readonly RawCompletedOrder[],
  ): readonly ChannelRevenueBreakdown[] {
    const channelMap = new Map<string, { count: number; totalScale4: string }>();
    let grandTotalScale4 = '0.0000';

    for (const order of orders) {
      const current = channelMap.get(order.channel) || { count: 0, totalScale4: '0.0000' };
      const updatedTotal = addScale4(current.totalScale4, order.totalScale4);
      channelMap.set(order.channel, {
        count: current.count + 1,
        totalScale4: updatedTotal,
      });
      grandTotalScale4 = addScale4(grandTotalScale4, order.totalScale4);
    }

    const result: ChannelRevenueBreakdown[] = [];
    const grandBig = toScale4BigInt(grandTotalScale4);

    for (const [channel, stats] of channelMap.entries()) {
      let percentOfTotal = '0.00%';
      if (grandBig > 0n) {
        const share = (toScale4BigInt(stats.totalScale4) * 10000n) / grandBig;
        const intP = share / 100n;
        const frac = (share % 100n).toString().padStart(2, '0');
        percentOfTotal = `${intP}.${frac}%`;
      }

      result.push({
        channel,
        ordersCount: stats.count,
        revenueScale4: stats.totalScale4,
        percentOfTotal,
      });
    }

    return result.sort((a, b) => compareScale4(b.revenueScale4, a.revenueScale4));
  }

  /**
   * Aggregates hourly sales volume and revenue.
   */
  public computeHourlySales(orders: readonly RawCompletedOrder[]): readonly HourlySalesPoint[] {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      ordersCount: 0,
      totalAmountScale4: '0.0000',
    }));

    for (const order of orders) {
      const date = new Date(order.completedAt);
      const h = isNaN(date.getHours()) ? 0 : date.getHours();
      const current = hours[h]!;
      hours[h] = {
        hour: h,
        ordersCount: current.ordersCount + 1,
        totalAmountScale4: addScale4(current.totalAmountScale4, order.totalScale4),
      };
    }

    return hours;
  }

  /**
   * Top selling products by revenue.
   */
  public computeTopProducts(
    orders: readonly RawCompletedOrder[],
    limit = 5,
  ): readonly TopProductMetric[] {
    const productMap = new Map<string, { name: string; qty: number; revenueScale4: string }>();

    for (const order of orders) {
      for (const item of order.items) {
        const current = productMap.get(item.productId) || {
          name: item.productName,
          qty: 0,
          revenueScale4: '0.0000',
        };
        const lineRevenue = multiplyScale4(
          fromScale4BigInt(BigInt(item.quantity) * 10000n),
          item.priceScale4,
        );
        productMap.set(item.productId, {
          name: item.productName,
          qty: current.qty + item.quantity,
          revenueScale4: addScale4(current.revenueScale4, lineRevenue),
        });
      }
    }

    const list: TopProductMetric[] = Array.from(productMap.entries()).map(([id, stats]) => ({
      productId: id,
      productName: stats.name,
      quantitySold: stats.qty,
      revenueScale4: stats.revenueScale4,
    }));

    return list.sort((a, b) => compareScale4(b.revenueScale4, a.revenueScale4)).slice(0, limit);
  }
}
