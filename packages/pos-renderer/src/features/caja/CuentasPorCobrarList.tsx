import * as React from 'react';
import { Badge, EmptyState, MoneyText } from '@trident/ui';
import type { CuentaDetalleDTO } from '../../bridge/trident-bridge.js';

export interface CuentasPorCobrarListProps {
  readonly cuentas: readonly CuentaDetalleDTO[];
  readonly selectedCuentaId: string | null;
  readonly onSelectCuenta: (cuenta: CuentaDetalleDTO) => void;
  readonly isLoading?: boolean;
  readonly className?: string;
}

export type CuentaFilterType = 'TODAS' | 'COMEDOR' | 'MOSTRADOR' | 'DELIVERY';

export function CuentasPorCobrarList({
  cuentas,
  selectedCuentaId,
  onSelectCuenta,
  isLoading = false,
  className,
}: CuentasPorCobrarListProps): React.JSX.Element {
  const [filter, setFilter] = React.useState<CuentaFilterType>('TODAS');
  const [searchTerm, setSearchTerm] = React.useState<string>('');

  const filteredCuentas = React.useMemo(() => {
    return cuentas.filter((c) => {
      // Filter by type
      if (filter === 'COMEDOR' && c.accountType !== 'COMEDOR') return false;
      if (filter === 'MOSTRADOR' && c.accountType !== 'MOSTRADOR') return false;
      if (
        filter === 'DELIVERY' &&
        c.accountType !== 'RAPPI' &&
        c.accountType !== 'UBER' &&
        c.accountType !== 'DOMICILIO'
      ) {
        return false;
      }

      // Filter by search query
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesFolio = c.folioNumber?.toString().includes(query) ?? false;
        const matchesTable = c.tableNumber?.toLowerCase().includes(query) ?? false;
        const matchesRoom = c.roomName?.toLowerCase().includes(query) ?? false;
        const matchesType = c.accountType.toLowerCase().includes(query);
        return matchesFolio || matchesTable || matchesRoom || matchesType;
      }

      return true;
    });
  }, [cuentas, filter, searchTerm]);

  // Aggregate pending total
  const totalPendiente = React.useMemo(() => {
    let sum = 0n;
    for (const c of filteredCuentas) {
      const parts = c.totalAmount.split('.');
      const intPart = BigInt(parts[0] || '0');
      const frac = BigInt((parts[1] || '').padEnd(4, '0').slice(0, 4));
      sum += intPart * 10000n + frac;
    }
    const intRes = sum / 10000n;
    const fracRes = (sum % 10000n).toString().padStart(4, '0');
    return `${intRes.toString()}.${fracRes}`;
  }, [filteredCuentas]);

  return (
    <aside
      aria-label="Cuentas pendientes por cobrar"
      className={`flex flex-col h-full bg-surface border-2 border-border-control rounded-xl shadow-1 overflow-hidden ${
        className ?? ''
      }`}
    >
      {/* Search and Summary */}
      <div className="p-4 border-b border-border bg-surface-raised/30 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Cuentas Pendientes ({filteredCuentas.length})
          </span>
          <div className="text-sm font-semibold text-text">
            Total:{' '}
            <MoneyText amount={totalPendiente} size="md" className="font-bold text-primary-strong" />
          </div>
        </div>

        {/* Search input with 44px min touch target */}
        <div className="relative">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por mesa, folio (#)..."
            aria-label="Buscar cuentas pendientes"
            className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-surface rounded-lg border-2 border-border-control text-text placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-focus"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted p-1 hover:text-text"
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills with 44px min height */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filtro de cuentas">
          {(['TODAS', 'COMEDOR', 'MOSTRADOR', 'DELIVERY'] as const).map((tab) => {
            const isActive = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(tab)}
                className={`min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 select-none border ${
                  isActive
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-surface hover:bg-surface-raised text-text-muted border-border-control'
                }`}
              >
                {tab === 'TODAS'
                  ? 'Todas'
                  : tab === 'COMEDOR'
                    ? 'Comedor'
                    : tab === 'MOSTRADOR'
                      ? 'Mostrador'
                      : 'Delivery'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Accounts List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-text-muted text-sm">
            Cargando cuentas activas...
          </div>
        ) : filteredCuentas.length === 0 ? (
          <EmptyState
            title="Sin cuentas pendientes"
            description="No hay cuentas por cobrar en este filtro o criterio de búsqueda."
            actionLabel={searchTerm ? 'Limpiar búsqueda' : undefined}
            onAction={searchTerm ? () => setSearchTerm('') : undefined}
            className="p-6"
          />
        ) : (
          filteredCuentas.map((cuenta) => {
            const isSelected = selectedCuentaId === cuenta.id;
            const isPrinted = cuenta.status === 'IMPRESA';

            return (
              <button
                key={cuenta.id}
                type="button"
                onClick={() => onSelectCuenta(cuenta)}
                aria-pressed={isSelected}
                className={`w-full text-left p-3.5 rounded-xl border-2 transition-all flex flex-col gap-2 relative ${
                  isSelected
                    ? 'bg-primary-soft/30 border-primary shadow-md ring-2 ring-primary/30'
                    : 'bg-surface hover:bg-surface-raised border-border-control shadow-xs active:scale-[0.99]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold text-text">
                      {cuenta.mesaId ? `Mesa ${cuenta.tableNumber ?? '?'}` : cuenta.tableNumber ?? 'Mostrador'}
                    </span>
                    <span className="text-xs text-text-muted font-mono">
                      #{cuenta.folioNumber ?? cuenta.id.slice(-4)}
                    </span>
                  </div>

                  <Badge
                    state={isPrinted ? 'EN_CUENTA' : 'DISPONIBLE'}
                    label={isPrinted ? 'Cuenta Pedida' : 'Abierta'}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>
                    {cuenta.accountType === 'COMEDOR'
                      ? `${cuenta.guestCount} comensal${cuenta.guestCount !== 1 ? 'es' : ''}`
                      : cuenta.accountType}
                  </span>
                  <span>{cuenta.roomName ?? 'General'}</span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border mt-0.5">
                  <span className="text-xs font-semibold text-text-muted uppercase">Total:</span>
                  <div className="text-lg font-black text-text">
                    <MoneyText amount={cuenta.totalAmount} size="lg" className="font-extrabold" />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
