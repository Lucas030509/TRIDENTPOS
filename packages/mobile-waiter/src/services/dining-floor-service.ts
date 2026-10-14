/**
 * TRIDENTPOS WP-025: Dining Floor & Comanda Builder Service
 * Table map management, order assembly, modifier attachment, and KDS comanda dispatching.
 */

import type {
  DiningTable,
  TableArea,
  ComandaItemDraft,
  MobileComandaDraft,
  SelectedModifier,
  ComandaDispatchResult,
} from '../types.js';
import { addScale4, calculateItemSubtotalScale4 } from '../numerics.js';
import { MobileLanClient } from '../network/lan-client.js';

export class DiningFloorService {
  private tables: Map<string, DiningTable> = new Map();
  private areas: TableArea[] = [];
  private readonly lanClient: MobileLanClient;

  constructor(
    lanClient: MobileLanClient,
    initialData?: { tables?: DiningTable[]; areas?: TableArea[] },
  ) {
    this.lanClient = lanClient;
    if (initialData?.areas) {
      this.areas = [...initialData.areas];
    }
    if (initialData?.tables) {
      for (const t of initialData.tables) {
        this.tables.set(t.id, t);
      }
    }

    // Subscribe to real-time table push events
    this.lanClient.onTableUpdate((updatedTable) => {
      this.tables.set(updatedTable.id, updatedTable);
    });
  }

  public getAreas(): readonly TableArea[] {
    return [...this.areas].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  public getTables(areaId?: string): readonly DiningTable[] {
    const list = Array.from(this.tables.values());
    if (areaId) {
      return list.filter((t) => t.areaId === areaId);
    }
    return list;
  }

  public getTableById(tableId: string): DiningTable | undefined {
    return this.tables.get(tableId);
  }

  /**
   * Builds an item draft with modifiers and recalculates exact scale-4 subtotal.
   */
  public createItemDraft(params: {
    productId: string;
    productCode: string;
    productName: string;
    unitPriceScale4: string;
    quantityScale4: string;
    selectedModifiers?: readonly SelectedModifier[];
    cookingNote?: string;
  }): ComandaItemDraft {
    const mods = params.selectedModifiers || [];
    let modifiersDelta = '0.0000';
    for (const m of mods) {
      if (m.kind === 'ADDITIVE') {
        modifiersDelta = addScale4(modifiersDelta, m.priceDeltaScale4);
      }
    }

    const subtotalScale4 = calculateItemSubtotalScale4(
      params.unitPriceScale4,
      params.quantityScale4,
      modifiersDelta,
    );

    return {
      draftItemId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId: params.productId,
      productCode: params.productCode,
      productName: params.productName,
      unitPriceScale4: params.unitPriceScale4,
      quantityScale4: params.quantityScale4,
      selectedModifiers: mods,
      cookingNote: params.cookingNote,
      subtotalScale4,
    };
  }

  /**
   * Assembles a complete mobile comanda draft from current draft items.
   */
  public assembleComandaDraft(params: {
    tableId: string;
    waiterId: string;
    waiterName: string;
    items: readonly ComandaItemDraft[];
  }): MobileComandaDraft {
    const table = this.tables.get(params.tableId);
    if (!table) {
      throw new Error(`TABLE_NOT_FOUND: Table ${params.tableId} does not exist.`);
    }

    let totalScale4 = '0.0000';
    for (const it of params.items) {
      totalScale4 = addScale4(totalScale4, it.subtotalScale4);
    }

    return {
      tableId: table.id,
      tableCode: table.code,
      accountId: table.activeAccountId || `acc-${table.id}`,
      waiterId: params.waiterId,
      waiterName: params.waiterName,
      expectedTableVersion: table.version,
      items: params.items,
      totalComandaScale4: totalScale4,
    };
  }

  /**
   * Dispatches the comanda to the kitchen KDS with OCC expectedVersion protection.
   */
  public async dispatchComandaToKitchen(
    comanda: MobileComandaDraft,
  ): Promise<ComandaDispatchResult> {
    const res = await this.lanClient.executeMutation<MobileComandaDraft, ComandaDispatchResult>({
      endpoint: `/api/v1/dining/tables/${comanda.tableId}/orders`,
      method: 'POST',
      body: comanda,
      expectedVersion: comanda.expectedTableVersion,
      mutationType: 'DISPATCH_COMANDA',
    });

    if (res.ok) {
      if (res.fromQueue) {
        return {
          success: true,
          orderId: (res.data as unknown as Record<string, unknown>).queueId as string,
          dispatchedAt: new Date().toISOString(),
        };
      }

      // Update local table version and status
      const table = this.tables.get(comanda.tableId);
      if (table) {
        const updatedTable: DiningTable = {
          ...table,
          status: 'OCCUPIED',
          version: (res.data.newTableVersion || table.version) + 1,
          totalBalanceScale4: addScale4(table.totalBalanceScale4, comanda.totalComandaScale4),
        };
        this.tables.set(table.id, updatedTable);
      }

      return res.data;
    }

    return {
      success: false,
      dispatchedAt: new Date().toISOString(),
      error: {
        code: res.conflict ? 'OCC_409_CONFLICT' : 'DISPATCH_FAILED',
        message: res.error,
        remoteVersion: res.conflict?.remoteVersion,
      },
    };
  }
}
