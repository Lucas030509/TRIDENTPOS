/**
 * TRIDENTPOS WP-025: Mobile Waiter Table Map Screen
 * Touch-optimized floor plan for tablets & phones, showing areas, table states, balances and quick selection.
 */

import React, { useState } from 'react';
import type { DiningTable, TableArea, TableStatus } from '../types.js';
import { formatCurrencyScale4 } from '../numerics.js';

export interface TableMapScreenProps {
  areas: readonly TableArea[];
  tables: readonly DiningTable[];
  selectedTableId?: string;
  onSelectTable: (table: DiningTable) => void;
  onRefresh?: () => void;
  pendingSyncCount?: number;
}

const STATUS_BADGES: Record<TableStatus, { label: string; bg: string; text: string; border: string }> = {
  AVAILABLE: {
    label: 'Libre',
    bg: 'bg-emerald-950/60',
    text: 'text-emerald-400',
    border: 'border-emerald-800/80',
  },
  OCCUPIED: {
    label: 'Ocupada',
    bg: 'bg-amber-950/60',
    text: 'text-amber-400',
    border: 'border-amber-800/80',
  },
  PRINTED: {
    label: 'Precuenta',
    bg: 'bg-blue-950/60',
    text: 'text-blue-400',
    border: 'border-blue-800/80',
  },
  RESERVED: {
    label: 'Reservada',
    bg: 'bg-purple-950/60',
    text: 'text-purple-400',
    border: 'border-purple-800/80',
  },
  PAYING: {
    label: 'Cobrando',
    bg: 'bg-rose-950/60',
    text: 'text-rose-400',
    border: 'border-rose-800/80',
  },
};

export function TableMapScreen({
  areas,
  tables,
  selectedTableId,
  onSelectTable,
  onRefresh,
  pendingSyncCount = 0,
}: TableMapScreenProps): React.JSX.Element {
  const [selectedAreaId, setSelectedAreaId] = useState<string>(areas[0]?.id || 'all');

  const filteredTables = tables.filter((t) => {
    if (selectedAreaId === 'all') return true;
    return t.areaId === selectedAreaId;
  });

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-white select-none">
      {/* Area Selector Tabs */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 bg-neutral-900">
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setSelectedAreaId('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedAreaId === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            Todas ({tables.length})
          </button>
          {areas.map((area) => {
            const count = tables.filter((t) => t.areaId === area.id).length;
            const isSelected = selectedAreaId === area.id;
            return (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId(area.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {area.name} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {pendingSyncCount > 0 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-900/60 text-amber-300 border border-amber-700 animate-pulse">
              {pendingSyncCount} pendientes
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-300 text-xs"
              title="Actualizar mesas"
            >
              ↻
            </button>
          )}
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredTables.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-neutral-500 text-sm">
            No hay mesas configuradas en esta área.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredTables.map((table) => {
              const badge = STATUS_BADGES[table.status];
              const isSelected = selectedTableId === table.id;

              return (
                <div
                  key={table.id}
                  onClick={() => onSelectTable(table)}
                  className={`flex flex-col justify-between p-3.5 rounded-xl border cursor-pointer transition-all active:scale-95 ${
                    badge.bg
                  } ${badge.border} ${
                    isSelected ? 'ring-2 ring-blue-500 shadow-lg' : 'hover:border-neutral-600'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-lg font-black tracking-tight">{table.code}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${badge.border} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1">
                    <div className="text-xs text-neutral-400 truncate">
                      {table.assignedWaiterName || 'Sin mesero'}
                    </div>

                    <div className="text-sm font-mono font-bold text-white">
                      {formatCurrencyScale4(table.totalBalanceScale4)}
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-neutral-800/60 flex justify-between items-center text-[10px] text-neutral-500">
                    <span>Cap: {table.capacity}p</span>
                    <span>v{table.version}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
