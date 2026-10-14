/**
 * TRIDENTPOS WP-024: Month-End Assisted Global Invoicing View (OQ-ARCH-02 / DEC-018)
 * Manages batch collation of unclaimed sales tickets for global SAT CFDI stamping.
 */

import React from 'react';
import type { GlobalInvoicingBatch, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface GlobalInvoicingBatchViewProps {
  batches: readonly GlobalInvoicingBatch[];
  canStamp?: boolean;
  onStampBatch?: (batch: GlobalInvoicingBatch) => void;
  onReviewBatch?: (batch: GlobalInvoicingBatch) => void;
}

export function GlobalInvoicingBatchView({
  batches,
  canStamp = false,
  onStampBatch,
  onReviewBatch,
}: GlobalInvoicingBatchViewProps): React.JSX.Element {
  const getStatusBadge = (status: GlobalInvoicingBatch['status']) => {
    switch (status) {
      case 'PENDING_REVIEW':
        return 'bg-amber-950/80 text-amber-300 border-amber-600/40';
      case 'STAMPED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40';
      case 'DISCARDED':
        return 'bg-neutral-800 text-neutral-400 border-neutral-700';
    }
  };

  const columns: readonly TableColumn<GlobalInvoicingBatch>[] = [
    { key: 'periodMonth', header: 'Período Mensual', sortable: true },
    { key: 'branchId', header: 'Sucursal' },
    {
      key: 'unclaimedTicketsCount',
      header: 'Tickets No Reclamados',
      align: 'center',
      render: (row) => `${row.unclaimedTicketsCount} tickets`,
    },
    {
      key: 'totalSubtotalScale4',
      header: 'Subtotal Base',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.totalSubtotalScale4),
    },
    {
      key: 'totalTaxScale4',
      header: 'IVA Trasladado',
      align: 'right',
      render: (row) => formatCurrencyScale4(row.totalTaxScale4),
    },
    {
      key: 'grandTotalScale4',
      header: 'Total Factura Global',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="font-mono font-bold text-white">
          {formatCurrencyScale4(row.grandTotalScale4)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'center',
      render: (row) => (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusBadge(
            row.status,
          )}`}
        >
          {row.status === 'PENDING_REVIEW'
            ? 'Por Timbrar'
            : row.status === 'STAMPED'
              ? 'Timbrada CFDI'
              : 'Descartada'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (row) => (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onReviewBatch?.(row)}
            className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Detalle
          </button>
          {canStamp && row.status === 'PENDING_REVIEW' && (
            <button
              onClick={() => onStampBatch?.(row)}
              className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold"
            >
              Timbrar Global
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Facturación Global Mensual
          </h1>
          <p className="text-xs text-neutral-400">
            Asistente de cierre de mes para agrupar y timbrar tickets no reclamados (OQ-ARCH-02 / DEC-018).
          </p>
        </div>
        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-sm transition-colors">
          + Generar Lote del Mes
        </button>
      </div>

      <DataTable
        data={batches as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No hay lotes de facturación global registrados."
      />
    </div>
  );
}
