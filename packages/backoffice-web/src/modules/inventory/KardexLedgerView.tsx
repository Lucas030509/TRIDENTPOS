/**
 * TRIDENTPOS WP-024: Kárdex Movement Audit Trail View
 * Audits immutable inventory transactions with sequence numbers, movement types, and resulting balances.
 */

import React, { useState } from 'react';
import type { KardexMovementEntry, KardexMovementType, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface KardexLedgerViewProps {
  movements: readonly KardexMovementEntry[];
}

export function KardexLedgerView({ movements }: KardexLedgerViewProps): React.JSX.Element {
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const filteredMovements = movements.filter((m) => {
    if (selectedType !== 'ALL' && m.movementType !== selectedType) {
      return false;
    }
    return true;
  });

  const getMovementBadge = (type: KardexMovementType) => {
    switch (type) {
      case 'COMPRA':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40';
      case 'VENTA':
        return 'bg-blue-950/80 text-blue-300 border-blue-600/40';
      case 'MERMA':
        return 'bg-red-950/80 text-red-300 border-red-600/40';
      case 'AJUSTE':
        return 'bg-purple-950/80 text-purple-300 border-purple-600/40';
      case 'TRASPASO':
        return 'bg-amber-950/80 text-amber-300 border-amber-600/40';
    }
  };

  const columns: readonly TableColumn<KardexMovementEntry>[] = [
    {
      key: 'sequenceNumber',
      header: 'Seq #',
      align: 'center',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-neutral-400 text-xs">#{row.sequenceNumber}</span>
      ),
    },
    {
      key: 'timestamp',
      header: 'Fecha / Hora',
      sortable: true,
      render: (row) => new Date(row.timestamp).toLocaleString('es-MX'),
    },
    { key: 'ingredientName', header: 'Insumo', sortable: true },
    {
      key: 'movementType',
      header: 'Tipo',
      align: 'center',
      render: (row) => (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getMovementBadge(
            row.movementType,
          )}`}
        >
          {row.movementType}
        </span>
      ),
    },
    { key: 'referenceFolio', header: 'Folio Ref.', align: 'center' },
    {
      key: 'quantityDeltaScale4',
      header: 'Delta Cant.',
      align: 'right',
      render: (row) => {
        const isNegative = row.quantityDeltaScale4.startsWith('-');
        return (
          <span
            className={`font-mono font-semibold ${
              isNegative ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {isNegative ? '' : '+'}
            {row.quantityDeltaScale4}
          </span>
        );
      },
    },
    {
      key: 'resultingBalanceScale4',
      header: 'Saldo Resultante',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-neutral-100 font-bold">
          {row.resultingBalanceScale4}
        </span>
      ),
    },
    {
      key: 'unitCostScale4',
      header: 'Costo Unit.',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.unitCostScale4),
    },
    { key: 'performedBy', header: 'Operador', align: 'left' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Kárdex de Movimientos
          </h1>
          <p className="text-xs text-neutral-400">
            Libro mayor inmutable de movimientos de almacén: compras, ventas, mermas y traspasos.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 bg-neutral-900 p-4 rounded-lg border border-neutral-800">
        <span className="text-xs text-neutral-400">Tipo de Movimiento:</span>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
        >
          <option value="ALL">Todos los Movimientos</option>
          <option value="COMPRA">COMPRA (Entrada)</option>
          <option value="VENTA">VENTA (Salida KDS)</option>
          <option value="MERMA">MERMA (Desperdicio)</option>
          <option value="AJUSTE">AJUSTE (Auditoría)</option>
          <option value="TRASPASO">TRASPASO (Entre Almacenes)</option>
        </select>
      </div>

      {/* Table */}
      <DataTable
        data={filteredMovements as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No se registraron movimientos en el período seleccionado."
      />
    </div>
  );
}
