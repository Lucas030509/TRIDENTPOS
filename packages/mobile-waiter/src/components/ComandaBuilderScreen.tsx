/**
 * TRIDENTPOS WP-025: Comanda Builder & Order Dispatch Screen
 * Fast comanda entry, modifier selectors, cooking instructions, and kitchen dispatch with OCC version.
 */

import React, { useState } from 'react';
import type {
  ComandaItemDraft,
  DiningTable,
  MobileComandaDraft,
  SelectedModifier,
} from '../types.js';
import { formatCurrencyScale4 } from '../numerics.js';
import { DiningFloorService } from '../services/dining-floor-service.js';

export interface MenuItemCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly priceScale4: string;
  readonly availableModifiers?: readonly SelectedModifier[];
}

export interface ComandaBuilderScreenProps {
  table: DiningTable;
  waiterId: string;
  waiterName: string;
  menuCatalog: readonly MenuItemCatalogEntry[];
  diningFloorService: DiningFloorService;
  onDispatchSuccess: (comanda: MobileComandaDraft) => void;
  onOpenSplitModal?: () => void;
  onOpenTransferModal?: () => void;
  onOpenVoidModal?: () => void;
  onBackToMap: () => void;
}

export function ComandaBuilderScreen({
  table,
  waiterId,
  waiterName,
  menuCatalog,
  diningFloorService,
  onDispatchSuccess,
  onOpenSplitModal,
  onOpenTransferModal,
  onOpenVoidModal,
  onBackToMap,
}: ComandaBuilderScreenProps): React.JSX.Element {
  const [draftItems, setDraftItems] = useState<ComandaItemDraft[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const categories = Array.from(new Set(menuCatalog.map((m) => m.category)));
  const filteredCatalog = menuCatalog.filter((m) => {
    if (selectedCategory === 'all') return true;
    return m.category === selectedCategory;
  });

  const handleAddItem = (entry: MenuItemCatalogEntry) => {
    const newItem = diningFloorService.createItemDraft({
      productId: entry.id,
      productCode: entry.code,
      productName: entry.name,
      unitPriceScale4: entry.priceScale4,
      quantityScale4: '1.0000',
      selectedModifiers: entry.availableModifiers || [],
    });
    setDraftItems([...draftItems, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    const next = [...draftItems];
    next.splice(index, 1);
    setDraftItems(next);
  };

  const handleDispatch = async () => {
    if (draftItems.length === 0) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const draft = diningFloorService.assembleComandaDraft({
        tableId: table.id,
        waiterId,
        waiterName,
        items: draftItems,
      });

      const res = await diningFloorService.dispatchComandaToKitchen(draft);
      if (res.success) {
        setDraftItems([]);
        onDispatchSuccess(draft);
      } else {
        setErrorMessage(res.error?.message || 'Error al despachar la comanda a cocina.');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  let totalDraftScale4 = '0.0000';
  if (draftItems.length > 0) {
    try {
      const draft = diningFloorService.assembleComandaDraft({
        tableId: table.id,
        waiterId,
        waiterName,
        items: draftItems,
      });
      totalDraftScale4 = draft.totalComandaScale4;
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col md:flex-row h-full bg-neutral-950 text-white select-none">
      {/* Left Pane: Menu Catalog Selector */}
      <div className="flex-1 flex flex-col border-r border-neutral-800">
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToMap}
              className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-semibold"
            >
              ← Mesas
            </button>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                Mesa {table.code}{' '}
                <span className="text-xs font-normal text-neutral-400">({table.areaName})</span>
              </h2>
            </div>
          </div>

          {/* Quick Table Action Buttons */}
          <div className="flex items-center gap-2">
            {onOpenSplitModal && (
              <button
                onClick={onOpenSplitModal}
                className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-blue-400 rounded text-xs font-medium border border-neutral-700"
              >
                Dividir
              </button>
            )}
            {onOpenTransferModal && (
              <button
                onClick={onOpenTransferModal}
                className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-amber-400 rounded text-xs font-medium border border-neutral-700"
              >
                Transferir
              </button>
            )}
            {onOpenVoidModal && (
              <button
                onClick={onOpenVoidModal}
                className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-rose-400 rounded text-xs font-medium border border-neutral-700"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2 border-b border-neutral-800/80 bg-neutral-900/50">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            Todo
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c)}
              className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                selectedCategory === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {filteredCatalog.map((item) => (
            <div
              key={item.id}
              onClick={() => handleAddItem(item)}
              className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 cursor-pointer active:scale-95 transition-all flex flex-col justify-between"
            >
              <div>
                <span className="text-[10px] font-mono text-neutral-500 uppercase">{item.code}</span>
                <div className="text-xs font-semibold text-neutral-200 mt-0.5 line-clamp-2">
                  {item.name}
                </div>
              </div>
              <div className="text-sm font-mono font-bold text-emerald-400 mt-2">
                {formatCurrencyScale4(item.priceScale4)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Pane: Comanda Draft Order Cart */}
      <div className="w-full md:w-80 lg:w-96 flex flex-col bg-neutral-900/70 border-t md:border-t-0 border-neutral-800">
        <div className="p-3 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">
            Comanda en Captura ({draftItems.length})
          </span>
          <span className="text-xs font-mono text-neutral-500">v{table.version}</span>
        </div>

        {errorMessage && (
          <div className="mx-3 mt-3 p-2.5 bg-rose-950/80 border border-rose-800 rounded-lg text-xs text-rose-300 flex justify-between items-center">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Draft Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {draftItems.length === 0 ? (
            <div className="text-center py-12 text-neutral-500 text-xs">
              No hay platillos añadidos a la comanda.
            </div>
          ) : (
            draftItems.map((item, idx) => (
              <div
                key={item.draftItemId}
                className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800/90 flex justify-between items-start"
              >
                <div className="space-y-1">
                  <div className="text-xs font-medium text-neutral-200">{item.productName}</div>
                  {item.selectedModifiers.length > 0 && (
                    <div className="text-[10px] text-amber-400/90">
                      {item.selectedModifiers.map((m) => m.name).join(', ')}
                    </div>
                  )}
                  {item.cookingNote && (
                    <div className="text-[10px] text-neutral-400 italic">"{item.cookingNote}"</div>
                  )}
                  <div className="text-xs font-mono font-bold text-neutral-300">
                    {formatCurrencyScale4(item.subtotalScale4)}
                  </div>
                </div>

                <button
                  onClick={() => handleRemoveItem(idx)}
                  className="text-neutral-500 hover:text-rose-400 p-1 text-xs"
                  title="Eliminar ítem"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bottom Total & Send Button */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-900 space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-neutral-400 text-xs">Total Comanda:</span>
            <span className="text-lg font-mono font-bold text-amber-300">
              {formatCurrencyScale4(totalDraftScale4)}
            </span>
          </div>

          <button
            disabled={draftItems.length === 0 || isSubmitting}
            onClick={handleDispatch}
            className={`w-full py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all shadow-md ${
              draftItems.length === 0 || isSubmitting
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
            }`}
          >
            {isSubmitting ? 'Enviando a Cocina...' : 'Enviar a Cocina (KDS)'}
          </button>
        </div>
      </div>
    </div>
  );
}
