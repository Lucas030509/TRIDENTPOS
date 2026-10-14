/**
 * TRIDENTPOS WP-024: Purchase Orders & Replenishment View
 * Manages PO lifecycle, approvals, and contract price variance warnings.
 */

import React, { useState } from 'react';
import type { PurchaseOrderEntry, TableColumn } from '../../types.js';
import { DataTable } from '../../components/table/DataTable.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface PurchaseOrdersViewProps {
  purchaseOrders: readonly PurchaseOrderEntry[];
  canApprove?: boolean;
  onApproveOrder?: (po: PurchaseOrderEntry) => void;
  onSelectOrder?: (po: PurchaseOrderEntry) => void;
}

export function PurchaseOrdersView({
  purchaseOrders,
  canApprove = false,
  onApproveOrder,
  onSelectOrder,
}: PurchaseOrdersViewProps): React.JSX.Element {
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  const filteredOrders = purchaseOrders.filter((po) => {
    if (selectedStatus !== 'ALL' && po.status !== selectedStatus) {
      return false;
    }
    return true;
  });

  const getStatusBadge = (status: PurchaseOrderEntry['status']) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-neutral-800 text-neutral-300 border-neutral-700';
      case 'SUBMITTED':
        return 'bg-amber-950/80 text-amber-300 border-amber-600/40';
      case 'APPROVED':
        return 'bg-blue-950/80 text-blue-300 border-blue-600/40';
      case 'PARTIALLY_RECEIVED':
        return 'bg-purple-950/80 text-purple-300 border-purple-600/40';
      case 'RECEIVED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40';
      case 'CANCELLED':
        return 'bg-red-950/80 text-red-300 border-red-600/40';
    }
  };

  const columns: readonly TableColumn<PurchaseOrderEntry>[] = [
    { key: 'folio', header: 'Folio OC', sortable: true },
    { key: 'supplierName', header: 'Proveedor', sortable: true },
    {
      key: 'createdAt',
      header: 'Fecha Emisión',
      sortable: true,
      render: (row) => new Date(row.createdAt).toLocaleDateString('es-MX'),
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
          {row.status}
        </span>
      ),
    },
    {
      key: 'itemsCount',
      header: 'Partidas',
      align: 'center',
      render: (row) => row.items.length,
    },
    {
      key: 'totalAmountScale4',
      header: 'Total OC',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="font-mono font-bold text-white">
          {formatCurrencyScale4(row.totalAmountScale4)}
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
            onClick={() => onSelectOrder?.(row)}
            className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Ver
          </button>
          {canApprove && (row.status === 'SUBMITTED' || row.status === 'DRAFT') && (
            <button
              onClick={() => onApproveOrder?.(row)}
              className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded font-medium"
            >
              Aprobar
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Órdenes de Compra</h1>
          <p className="text-xs text-neutral-400">
            Flujo de compras a proveedores, control de presupuesto y aprobación de órdenes.
          </p>
        </div>
        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-sm transition-colors">
          + Nueva Orden de Compra
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 bg-neutral-900 p-4 rounded-lg border border-neutral-800">
        <span className="text-xs text-neutral-400">Filtrar por Estado:</span>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="bg-neutral-800 text-xs text-white border border-neutral-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
        >
          <option value="ALL">Todas las Órdenes</option>
          <option value="DRAFT">Borradores (DRAFT)</option>
          <option value="SUBMITTED">Por Aprobar (SUBMITTED)</option>
          <option value="APPROVED">Aprobadas (APPROVED)</option>
          <option value="RECEIVED">Recibidas en Almacén (RECEIVED)</option>
        </select>
      </div>

      <DataTable
        data={filteredOrders as unknown as Record<string, unknown>[]}
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
        emptyMessage="No se encontraron órdenes de compra registradas."
      />
    </div>
  );
}
