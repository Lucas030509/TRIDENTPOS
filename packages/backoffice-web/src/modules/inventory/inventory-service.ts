/**
 * TRIDENTPOS WP-024: Inventory & Kárdex Service
 * Tracks warehouse stock balances, alerts on min-par thresholds, and audits movement history.
 */

import type {
  StockBalanceEntry,
  WarehouseItem,
  KardexMovementEntry,
  KardexMovementType,
} from '../../types.js';
import { addScale4, compareScale4, multiplyScale4 } from '../../numerics.js';

export class InventoryService {
  private warehouses: WarehouseItem[] = [];
  private stockBalances: Map<string, StockBalanceEntry> = new Map(); // key: warehouseId:ingredientId
  private kardexLog: KardexMovementEntry[] = [];

  constructor(initialData?: {
    warehouses?: WarehouseItem[];
    stockBalances?: StockBalanceEntry[];
    kardexLog?: KardexMovementEntry[];
  }) {
    if (initialData?.warehouses) this.warehouses = [...initialData.warehouses];
    if (initialData?.stockBalances) {
      for (const entry of initialData.stockBalances) {
        this.stockBalances.set(`${entry.warehouseId}:${entry.ingredientId}`, entry);
      }
    }
    if (initialData?.kardexLog) {
      this.kardexLog = [...initialData.kardexLog];
    }
  }

  public getWarehouses(branchId?: string): readonly WarehouseItem[] {
    if (branchId) {
      return this.warehouses.filter((w) => w.branchId === branchId);
    }
    return this.warehouses;
  }

  public getStockBalances(warehouseId?: string): readonly StockBalanceEntry[] {
    const list = Array.from(this.stockBalances.values());
    if (warehouseId) {
      return list.filter((e) => e.warehouseId === warehouseId);
    }
    return list;
  }

  public getLowStockAlerts(branchWarehouseIds?: readonly string[]): readonly StockBalanceEntry[] {
    const list = Array.from(this.stockBalances.values());
    return list.filter((e) => {
      if (branchWarehouseIds && !branchWarehouseIds.includes(e.warehouseId)) {
        return false;
      }
      return compareScale4(e.currentStockScale4, e.minParLevelScale4) <= 0;
    });
  }

  public calculateTotalInventoryValuation(warehouseId?: string): string {
    const items = this.getStockBalances(warehouseId);
    let totalScale4 = '0.0000';
    for (const item of items) {
      const itemValuation = multiplyScale4(item.currentStockScale4, item.averageCostScale4);
      totalScale4 = addScale4(totalScale4, itemValuation);
    }
    return totalScale4;
  }

  public getKardexMovements(params?: {
    warehouseId?: string;
    ingredientId?: string;
    movementType?: KardexMovementType;
  }): readonly KardexMovementEntry[] {
    let result = [...this.kardexLog];
    if (params?.warehouseId) {
      result = result.filter((m) => m.warehouseId === params.warehouseId);
    }
    if (params?.ingredientId) {
      result = result.filter((m) => m.ingredientId === params.ingredientId);
    }
    if (params?.movementType) {
      result = result.filter((m) => m.movementType === params.movementType);
    }
    return result.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  }
}
