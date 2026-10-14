/**
 * TRIDENTPOS WP-024: Business Intelligence & Executive Dashboard View
 * Displays high-level restaurant KPIs, delivery channel distribution, and sales velocity heatmaps.
 */

import React from 'react';
import type {
  ChannelRevenueBreakdown,
  HourlySalesPoint,
  SalesKpiSummary,
  TopProductMetric,
} from '../../types.js';
import { formatCurrencyScale4 } from '../../numerics.js';

export interface BiDashboardViewProps {
  kpis: SalesKpiSummary;
  channels: readonly ChannelRevenueBreakdown[];
  hourlySales: readonly HourlySalesPoint[];
  topProducts: readonly TopProductMetric[];
}

export function BiDashboardView({
  kpis,
  channels,
  hourlySales,
  topProducts,
}: BiDashboardViewProps): React.JSX.Element {
  // Find max hourly sales to normalize bar heights
  const maxHourlyRevenue = Math.max(
    ...hourlySales.map((h) => parseFloat(h.totalAmountScale4) || 0),
    1,
  );

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            BI Dashboard & Métricas Ejecutivas
          </h1>
          <p className="text-xs text-neutral-400">
            Monitoreo en tiempo real de ingresos, canales de delivery, ticket promedio y mezcla de ventas.
          </p>
        </div>
        <div className="text-xs font-mono text-neutral-400 bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded">
          Período: {kpis.date}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            Venta Bruta
          </span>
          <div className="text-xl font-mono font-bold text-white">
            {formatCurrencyScale4(kpis.grossSalesScale4)}
          </div>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            Venta Neta
          </span>
          <div className="text-xl font-mono font-bold text-emerald-400">
            {formatCurrencyScale4(kpis.netSalesScale4)}
          </div>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            IVA Trasladado
          </span>
          <div className="text-xl font-mono font-bold text-blue-400">
            {formatCurrencyScale4(kpis.taxAmountScale4)}
          </div>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            Descuentos
          </span>
          <div className="text-xl font-mono font-bold text-amber-400">
            {formatCurrencyScale4(kpis.discountsScale4)}
          </div>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            Cuentas Cobradas
          </span>
          <div className="text-xl font-mono font-bold text-purple-400">
            {kpis.completedOrdersCount}
          </div>
        </div>

        <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800">
          <span className="text-[11px] text-neutral-400 uppercase tracking-wider block mb-1">
            Ticket Promedio
          </span>
          <div className="text-xl font-mono font-bold text-cyan-400">
            {formatCurrencyScale4(kpis.averageTicketScale4)}
          </div>
        </div>
      </div>

      {/* Middle Row: Channels & Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery & Sales Channels */}
        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 space-y-4">
          <h2 className="text-sm font-semibold text-white">Ingresos por Canal de Venta</h2>
          <div className="space-y-3">
            {channels.map((ch) => (
              <div key={ch.channel} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-neutral-200">{ch.channel}</span>
                  <span className="font-mono text-neutral-400">
                    {formatCurrencyScale4(ch.revenueScale4)} ({ch.percentOfTotal})
                  </span>
                </div>
                <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all duration-300"
                    style={{ width: ch.percentOfTotal }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Selling Products */}
        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 space-y-4">
          <h2 className="text-sm font-semibold text-white">Top 5 Platillos Más Vendidos</h2>
          <div className="divide-y divide-neutral-800">
            {topProducts.map((p, idx) => (
              <div key={p.productId} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-5 text-neutral-500 font-mono font-bold">#{idx + 1}</span>
                  <span className="text-neutral-200 font-medium">{p.productName}</span>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-white">
                    {formatCurrencyScale4(p.revenueScale4)}
                  </div>
                  <div className="text-[10px] text-neutral-400">{p.quantitySold} unidades</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: Hourly Sales Velocity */}
      <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 space-y-4">
        <h2 className="text-sm font-semibold text-white">Velocidad de Ventas por Hora (00:00 - 23:00)</h2>
        <div className="flex items-end gap-1.5 h-36 pt-4 border-b border-neutral-800">
          {hourlySales.map((h) => {
            const rev = parseFloat(h.totalAmountScale4) || 0;
            const heightPercent = Math.max(4, Math.round((rev / maxHourlyRevenue) * 100));
            return (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center h-full justify-end group relative"
              >
                <div
                  className="w-full bg-blue-600/70 hover:bg-blue-500 rounded-t transition-all"
                  style={{ height: `${heightPercent}%` }}
                />
                <span className="text-[9px] text-neutral-500 mt-2 font-mono">
                  {h.hour.toString().padStart(2, '0')}
                </span>
                {/* Tooltip on hover */}
                <div className="hidden group-hover:block absolute -top-8 bg-neutral-800 text-white text-[10px] px-2 py-1 rounded shadow whitespace-nowrap z-10 font-mono">
                  {formatCurrencyScale4(h.totalAmountScale4)} ({h.ordersCount} órdenes)
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
