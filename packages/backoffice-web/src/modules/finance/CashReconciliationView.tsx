/**
 * TRIDENTPOS WP-024: Cash Shifts & Corte Z Reconciliation View
 * Audits daily register shifts, cash declared vs expected, and over/short variances.
 */

import React, { useState } from 'react';
import type { CashShiftReconciliation, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface CashReconciliationViewProps {
  reconciliations: readonly CashShiftReconciliation[];
  canApprove?: boolean;
  onApproveShift?: (reconciliation: CashShiftReconciliation) => void;
}

export function CashReconciliationView({
  reconciliations,
  canApprove = false,
  onApproveShift,
}: CashReconciliationViewProps): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredItems = reconciliations.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const getStatusBadge = (status: CashShiftReconciliation['status']) => {
    switch (status) {
      case 'BALANCED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40';
      case 'SHORTAGE':
        return 'bg-red-950/80 text-red-300 border-red-600/40';
      case 'SURPLUS':
        return 'bg-blue-950/80 text-blue-300 border-blue-600/40';
    }
  };

  const columns: readonly TableColumn<CashShiftReconciliation>[] = [
    { key: 'shiftId', header: 'ID Turno' },
    { key: 'cashierName', header: 'Cajero', sortable: true },
    { key: 'stationName', header: 'Terminal POS' },
    {
      key: 'closedAt',
      header: 'Cierre',
      sortable: true,
      render: (row) => new Date(row.closedAt).toLocaleString('es-MX'),
    },
    {
      key: 'startingFloatScale4',
      header: 'Fondo Inicial',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.startingFloatScale4),
    },
    {
      key: 'totalCashSalesScale4',
      header: 'Ventas Efectivo',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.totalCashSalesScale4),
    },
    {
      key: 'expectedCashScale4',
      header: 'Efectivo Esperado',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-neutral-300">
          {formatCurrencyScale4(row.expectedCashScale4)}
        </span>
      ),
    },
    {
      key: 'declaredCashScale4',
      header: 'Efectivo Declarado',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-bold text-white">
          {formatCurrencyScale4(row.declaredCashScale4)}
        </span>
      ),
    },
    {
      key: 'varianceScale4',
      header: 'Diferencia (Varianza)',
      align: 'right',
      render: (row) => {
        const isNegative = row.varianceScale4.startsWith('-');
        return (
          <span
            className={`font-mono font-bold ${
              row.status === 'BALANCED'
                ? 'text-emerald-400'
                : isNegative
                  ? 'text-red-400'
                  : 'text-blue-400'
            }`}
          >
            {formatCurrencyScale4(row.varianceScale4)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Dictamen',
      align: 'center',
      render: (row) => (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusBadge(
            row.status,
          )}`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'supervisorApproved',
      header: 'Visto Bueno',
      align: 'center',
      render: (row) =>
        row.supervisorApproved ? (
          <span className="text-emerald-400 text-xs font-semibold">✓ Aprobado</span>
        ) : canApprove ? (
          <button
            onClick={() => onApproveShift?.(row)}
            className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded font-medium"
          >
            Validar
          </button>
        ) : (
          <span className="text-amber-400 text-xs">Pendiente</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Conciliación de Caja & Cortes Z
          </h1>
          <p className="text-xs text-neutral-400">
            Arqueo de turnos cerrados, auditoría de efectivo ciego y detección de faltantes o sobrantes.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 bg-neutral-900 p-4 rounded-lg border border-neutral-800">
        <span className="text-xs text-neutral-400">Dictamen:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
        >
          <option value="ALL">Todos los Turnos</option>
          <option value="BALANCED">Cuadrados (BALANCED)</option>
          <option value="SHORTAGE">Faltantes (SHORTAGE)</option>
          <option value="SURPLUS">Sobrantes (SURPLUS)</option>
        </select>
      </div>

      <DataTable
        data={filteredItems as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No hay turnos pendientes de conciliación."
      />
    </div>
  );
}
