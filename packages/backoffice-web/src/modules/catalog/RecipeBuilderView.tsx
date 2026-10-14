/**
 * TRIDENTPOS WP-024: Interactive Recipe Builder & Food Costing View
 * Calculates ingredient line costs, merma/waste adjustments, portion cost, and margin analysis.
 */

import React, { useState } from 'react';
import type { ProductItem, RecipeDefinition, RecipeItemEntry, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import {
  formatCurrencyScale4,
  calculateGrossQuantityScale4,
  multiplyScale4,
  addScale4,
  calculatePortionCostScale4,
  divideScale4,
  fromScale4BigInt,
  toScale4BigInt,
} from '../../numerics.js';

export interface RecipeBuilderViewProps {
  product: ProductItem;
  initialRecipe?: RecipeDefinition;
  onSaveRecipe?: (recipe: RecipeDefinition) => void;
  onClose?: () => void;
}

export function RecipeBuilderView({
  product,
  initialRecipe,
  onSaveRecipe,
  onClose,
}: RecipeBuilderViewProps): React.JSX.Element {
  const [portionYield, setPortionYield] = useState<number>(initialRecipe?.portionYield || 1);
  const [targetMarginPercent, setTargetMarginPercent] = useState<string>(
    initialRecipe?.targetMarginPercent || '65.0000',
  );
  const [items, setItems] = useState<RecipeItemEntry[]>(
    initialRecipe ? [...initialRecipe.items] : [],
  );

  // Recalculate totals
  let totalBatchCostScale4 = '0.0000';
  for (const item of items) {
    totalBatchCostScale4 = addScale4(totalBatchCostScale4, item.subtotalCostScale4);
  }

  const portionCostScale4 = calculatePortionCostScale4(totalBatchCostScale4, portionYield);

  // Suggested price = portionCost / ( (100 - targetMargin) / 100 )
  let suggestedPriceScale4 = portionCostScale4;
  const marginBig = toScale4BigInt(targetMarginPercent);
  const hundredBig = 100n * 10000n;
  if (marginBig > 0n && marginBig < hundredBig) {
    const foodCostFactorScale4 = fromScale4BigInt(hundredBig - marginBig);
    const numerator = multiplyScale4(portionCostScale4, '100.0000');
    suggestedPriceScale4 = divideScale4(numerator, foodCostFactorScale4);
  }

  const handleUpdateItem = (
    index: number,
    field: 'netQuantityScale4' | 'wasteFactorPercent' | 'unitCostScale4',
    val: string,
  ) => {
    const next = [...items];
    const current = next[index]!;
    const updatedField = {
      ...current,
      [field]: val,
    };

    const grossQuantityScale4 = calculateGrossQuantityScale4(
      updatedField.netQuantityScale4,
      updatedField.wasteFactorPercent,
    );
    const subtotalCostScale4 = multiplyScale4(
      grossQuantityScale4,
      updatedField.unitCostScale4,
    );

    next[index] = {
      ...updatedField,
      grossQuantityScale4,
      subtotalCostScale4,
    };
    setItems(next);
  };

  const columns: readonly TableColumn<RecipeItemEntry>[] = [
    { key: 'ingredientCode', header: 'Código Insumo' },
    { key: 'ingredientName', header: 'Insumo' },
    { key: 'unitOfMeasure', header: 'U.M.', align: 'center' },
    {
      key: 'netQuantityScale4',
      header: 'Cant. Neta',
      align: 'right',
      render: (row) => {
        const idx = items.findIndex((i) => i.ingredientId === row.ingredientId);
        return (
          <input
            type="text"
            className="w-20 bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded text-right font-mono text-xs text-white"
            value={row.netQuantityScale4}
            onChange={(e) => handleUpdateItem(idx, 'netQuantityScale4', e.target.value)}
          />
        );
      },
    },
    {
      key: 'wasteFactorPercent',
      header: 'Merma %',
      align: 'right',
      render: (row) => `${row.wasteFactorPercent}%`,
    },
    {
      key: 'grossQuantityScale4',
      header: 'Cant. Bruta',
      align: 'right',
      render: (row) => (
        <span className="font-semibold text-neutral-200">{row.grossQuantityScale4}</span>
      ),
    },
    {
      key: 'unitCostScale4',
      header: 'Costo Unit.',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.unitCostScale4),
    },
    {
      key: 'subtotalCostScale4',
      header: 'Subtotal Costo',
      align: 'right',
      render: (row) => (
        <span className="font-bold text-amber-300">
          {formatCurrencyScale4(row.subtotalCostScale4)}
        </span>
      ),
    },
  ];

  const handleSave = () => {
    const recipe: RecipeDefinition = {
      id: initialRecipe?.id || `rcp-${product.id}`,
      productId: product.id,
      productName: product.name,
      portionYield,
      items,
      totalBatchCostScale4,
      portionCostScale4,
      targetMarginPercent,
      suggestedPriceScale4,
    };
    onSaveRecipe?.(recipe);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-blue-400 font-semibold">
            Escandallo de Cocina & Receta Maestra
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            {product.name}{' '}
            <span className="text-sm font-mono font-normal text-neutral-400">({product.code})</span>
          </h1>
        </div>
        <div className="flex gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs font-semibold"
            >
              Cerrar
            </button>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-sm"
          >
            Guardar Receta
          </button>
        </div>
      </div>

      {/* Yield & Target Margin Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <label className="text-[11px] text-neutral-400 block mb-1">Rendimiento (Porciones)</label>
          <input
            type="number"
            min={1}
            value={portionYield}
            onChange={(e) => setPortionYield(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-neutral-800 text-white font-mono text-sm px-3 py-1.5 rounded border border-neutral-700 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <label className="text-[11px] text-neutral-400 block mb-1">Margen Deseado (%)</label>
          <input
            type="text"
            value={targetMarginPercent}
            onChange={(e) => setTargetMarginPercent(e.target.value)}
            className="w-full bg-neutral-800 text-white font-mono text-sm px-3 py-1.5 rounded border border-neutral-700 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 block mb-1">Costo por Porción</span>
          <div className="text-lg font-mono font-bold text-amber-300">
            {formatCurrencyScale4(portionCostScale4)}
          </div>
          <span className="text-[10px] text-neutral-500">
            Batch Total: {formatCurrencyScale4(totalBatchCostScale4)}
          </span>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 block mb-1">Precio Sugerido Venta</span>
          <div className="text-lg font-mono font-bold text-emerald-400">
            {formatCurrencyScale4(suggestedPriceScale4)}
          </div>
          <span className="text-[10px] text-neutral-500">
            Precio Carta Actual: {formatCurrencyScale4(product.basePriceScale4)}
          </span>
        </div>
      </div>

      {/* Ingredients Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">Insumos de la Receta</h2>
          <span className="text-xs text-neutral-500">{items.length} insumos asignados</span>
        </div>

        <DataTable
          data={items as unknown as Record<string, unknown>[]}
          columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
          emptyMessage="No se han añadido insumos a esta receta."
        />
      </div>
    </div>
  );
}
