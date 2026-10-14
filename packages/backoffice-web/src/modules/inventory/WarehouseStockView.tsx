/**
 * TRIDENTPOS WP-024: Warehouse Stock & Par Levels View
 * Displays current stock balances, min/max par level alerts, and inventory valuation.
 */

import React, { useState } from 'react';
import type { StockBalanceEntry, TableColumn, WarehouseItem } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface WarehouseStockViewProps {
  warehouses: readonly WarehouseItem[];
  stockBalances: readonly StockBalanceEntry[];
  totalValuationScale4: string;
}

export function WarehouseStockView({
  warehouses,
  stockBalances,
  totalValuationScale4,
}: WarehouseStockViewProps): React.JSX.Element {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL');
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);

  const filteredItems = stockBalances.filter((item) => {
    if (selectedWarehouseId !== 'ALL' && item.warehouseId !== selectedWarehouseId) {
      return false;
    }
    if (lowStockOnly && !item.isLowStock) {
      return false;
    }
    return true;
  });

  const columns: readonly TableColumn<StockBalanceEntry>[] = [
    { key: 'ingredientCode', header: 'Código Insumo', sortable: true },
    { key: 'ingredientName', header: 'Insumo', sortable: true },
    { key: 'warehouseName', header: 'Almacén' },
    { key: 'unitOfMeasure', header: 'U.M.', align: 'center' },
    {
      key: 'currentStockScale4',
      header: 'Stock Actual',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span
          className={`font-mono font-bold ${
            row.isLowStock ? 'text-red-400' : 'text-neutral-100'
          }`}
        >
          {row.currentStockScale4}
        </span>
      ),
    },
    {
      key: 'minParLevelScale4',
      header: 'Par Mín.',
      align: 'right',
      render: (row) => row.minParLevelScale4,
    },
    {
      key: 'maxParLevelScale4',
      header: 'Par Máx.',
      align: 'right',
      render: (row) => row.maxParLevelScale4,
    },
    {
      key: 'averageCostScale4',
      header: 'Costo Prom.',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.averageCostScale4),
    },
    {
      key: 'totalValuationScale4',
      header: 'Valuación Total',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.totalValuationScale4),
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'center',
      render: (row) =>
        row.isLowStock ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-900/60 text-red-300 border border-red-600/40">
            BAJO PAR
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-300">
            ÓPTIMO
          </span>
        ),
    },
  ];

  const lowStockCount = stockBalances.filter((s) => s.isLowStock).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Inventario & Almacenes
          </h1>
          <p className="text-xs text-neutral-400">
            Existencias en tiempo real, umbrales de punto de reorden y valuación de insumos.
          </p>
        </div>

        {/* Valuation badge */}
        <div className="bg-neutral-900 px-4 py-2 rounded-lg border border-neutral-800 text-right">
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider block">
            Valuación Total Inventario
          </span>
          <span className="text-lg font-mono font-bold text-emerald-400">
            {formatCurrencyScale4(totalValuationScale4)}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-neutral-900 p-4 rounded-lg border border-neutral-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Almacén:</span>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">Todos los Almacenes</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-300 select-none">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
              className="rounded bg-neutral-800 border-neutral-700 text-blue-600 focus:ring-0"
            />
            <span>Solo Bajo Par ({lowStockCount})</span>
          </label>
        </div>
      </div>

      {/* Stock table */}
      <DataTable
        data={filteredItems as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No se encontraron insumos con los filtros seleccionados."
      />
    </div>
  );
}
