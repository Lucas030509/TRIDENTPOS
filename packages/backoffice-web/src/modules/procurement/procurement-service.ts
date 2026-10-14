/**
 * TRIDENTPOS WP-024: Procurement & Replenishment Service
 * Manages purchase orders, price variance enforcement, and par-level replenishment suggestions (OQ-SSOT-05).
 */

import type {
  PurchaseOrderEntry,
  PurchaseOrderItemEntry,
  ReplenishmentSuggestion,
  StockBalanceEntry,
  SupplierEntry,
} from '../../types.js';
import {
  addScale4,
  compareScale4,
  multiplyScale4,
  subScale4,
  toScale4BigInt,
} from '../../numerics.js';

export interface CreatePurchaseOrderParams {
  supplierId: string;
  supplierName: string;
  branchId: string;
  items: readonly {
    ingredientId: string;
    ingredientName: string;
    orderedQuantityScale4: string;
    unitCostScale4: string;
    contractPriceScale4?: string;
  }[];
  taxRatePercent?: string; // e.g. "16.0000" for 16% IVA
}

export class ProcurementService {
  private suppliers: SupplierEntry[] = [];
  private purchaseOrders: Map<string, PurchaseOrderEntry> = new Map();

  constructor(initialData?: {
    suppliers?: SupplierEntry[];
    purchaseOrders?: PurchaseOrderEntry[];
  }) {
    if (initialData?.suppliers) this.suppliers = [...initialData.suppliers];
    if (initialData?.purchaseOrders) {
      for (const po of initialData.purchaseOrders) {
        this.purchaseOrders.set(po.id, po);
      }
    }
  }

  public getSuppliers(): readonly SupplierEntry[] {
    return this.suppliers;
  }

  public getPurchaseOrders(branchId?: string): readonly PurchaseOrderEntry[] {
    const list = Array.from(this.purchaseOrders.values());
    if (branchId) {
      return list.filter((po) => po.branchId === branchId);
    }
    return list;
  }

  /**
   * Generates automated replenishment suggestions based on min/max par level delta (OQ-SSOT-05).
   */
  public generateReplenishmentSuggestions(
    stockBalances: readonly StockBalanceEntry[],
    defaultSupplierId = 'sup-default',
  ): readonly ReplenishmentSuggestion[] {
    const suggestions: ReplenishmentSuggestion[] = [];

    for (const item of stockBalances) {
      // Suggest order when currentStock <= minParLevel
      if (compareScale4(item.currentStockScale4, item.minParLevelScale4) <= 0) {
        // Delta needed to reach maxParLevel: suggestedQty = maxPar - currentStock
        const suggestedQuantityScale4 = subScale4(item.maxParLevelScale4, item.currentStockScale4);
        const estimatedCostScale4 = multiplyScale4(suggestedQuantityScale4, item.averageCostScale4);

        suggestions.push({
          ingredientId: item.ingredientId,
          ingredientCode: item.ingredientCode,
          ingredientName: item.ingredientName,
          currentStockScale4: item.currentStockScale4,
          minParScale4: item.minParLevelScale4,
          maxParScale4: item.maxParLevelScale4,
          suggestedQuantityScale4,
          preferredSupplierId: defaultSupplierId,
          estimatedCostScale4,
        });
      }
    }

    return suggestions;
  }

  /**
   * Creates a draft purchase order and calculates line items, taxes, and price variances.
   */
  public createPurchaseOrder(params: CreatePurchaseOrderParams): PurchaseOrderEntry {
    const poId = `po-${Date.now()}`;
    const folio = `OC-${Math.floor(100000 + Math.random() * 900000)}`;

    let subtotalScale4 = '0.0000';
    const computedItems: PurchaseOrderItemEntry[] = [];

    for (const item of params.items) {
      const lineSubtotal = multiplyScale4(item.orderedQuantityScale4, item.unitCostScale4);
      subtotalScale4 = addScale4(subtotalScale4, lineSubtotal);

      let priceVariancePercent: string | undefined;
      if (item.contractPriceScale4) {
        const diff = subScale4(item.unitCostScale4, item.contractPriceScale4);
        const contractBig = toScale4BigInt(item.contractPriceScale4);
        if (contractBig > 0n) {
          const varianceRatio = (toScale4BigInt(diff) * 100n * 10000n) / contractBig;
          const isNeg = varianceRatio < 0n;
          const abs = isNeg ? -varianceRatio : varianceRatio;
          const intP = abs / 10000n;
          const frac = (abs % 10000n).toString().padStart(4, '0');
          priceVariancePercent = `${isNeg ? '-' : ''}${intP}.${frac}`;
        }
      }

      computedItems.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        orderedQuantityScale4: item.orderedQuantityScale4,
        unitCostScale4: item.unitCostScale4,
        subtotalScale4: lineSubtotal,
        contractPriceScale4: item.contractPriceScale4,
        priceVariancePercent,
      });
    }

    const taxRate = params.taxRatePercent || '16.0000';
    const taxFactor = multiplyScale4(taxRate, '0.0100');
    const taxAmountScale4 = multiplyScale4(subtotalScale4, taxFactor);
    const totalAmountScale4 = addScale4(subtotalScale4, taxAmountScale4);

    const po: PurchaseOrderEntry = {
      id: poId,
      folio,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      branchId: params.branchId,
      status: 'DRAFT',
      subtotalScale4,
      taxAmountScale4,
      totalAmountScale4,
      createdAt: new Date().toISOString(),
      items: computedItems,
    };

    this.purchaseOrders.set(po.id, po);
    return po;
  }

  public updateOrderStatus(
    poId: string,
    status: PurchaseOrderEntry['status'],
    approverName?: string,
  ): PurchaseOrderEntry {
    const po = this.purchaseOrders.get(poId);
    if (!po) {
      throw new Error(`Purchase order '${poId}' not found`);
    }

    const updated: PurchaseOrderEntry = {
      ...po,
      status,
      approvedAt: status === 'APPROVED' ? new Date().toISOString() : po.approvedAt,
      approvedBy: status === 'APPROVED' ? approverName : po.approvedBy,
    };

    this.purchaseOrders.set(poId, updated);
    return updated;
  }
}
