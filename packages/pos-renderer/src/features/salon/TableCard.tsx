import * as React from 'react';
import { Badge, MoneyText } from '@trident/ui';
import type { MesaSummaryDTO } from '../../bridge/trident-bridge.js';

export interface TableCardProps {
  readonly mesa: MesaSummaryDTO;
  readonly isSelected?: boolean;
  readonly onClick: (mesa: MesaSummaryDTO) => void;
}

export function TableCard({
  mesa,
  isSelected = false,
  onClick,
}: TableCardProps): React.JSX.Element {
  const isAvailable = mesa.status === 'DISPONIBLE';
  const isOccupied = mesa.status === 'OCUPADA';
  const isInCheck = mesa.status === 'EN_CUENTA';
  const isBlocked = mesa.status === 'BLOQUEADA';

  // Calculate elapsed time formatted for occupied tables
  const elapsedText = React.useMemo(() => {
    if (!mesa.openedAt) return null;
    const diffMs = Math.max(0, Date.now() - new Date(mesa.openedAt).getTime());
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  }, [mesa.openedAt]);

  const cardBorderClass = isSelected
    ? 'border-brand ring-2 ring-brand bg-brand-soft'
    : isBlocked
      ? 'border-border-control/40 bg-surface/40 opacity-75 cursor-not-allowed'
      : isInCheck
        ? 'border-warning/70 bg-warning-soft/30 hover:border-warning'
        : isOccupied
          ? 'border-border-control bg-surface hover:bg-surface-raised hover:border-brand/50'
          : 'border-border-control bg-surface hover:border-success/60 hover:bg-success-soft/20';

  const ariaLabel = `Mesa ${mesa.tableNumber}, ${mesa.status}${
    isOccupied || isInCheck
      ? `, ${mesa.guestCount} comensales, total $${mesa.totalAmount}${elapsedText ? `, abierta hace ${elapsedText}` : ''}`
      : ''
  }`;

  return (
    <button
      type="button"
      role="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      disabled={isBlocked}
      onClick={() => onClick(mesa)}
      className={`relative min-h-[140px] p-4 rounded-2xl border-2 flex flex-col justify-between text-left transition-all focus:outline-none focus:ring-2 focus:ring-focus select-none shadow-sm active:scale-[0.98] ${cardBorderClass}`}
    >
      {/* Top Header: Table Number & Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black tracking-tight text-text">
            Mesa {mesa.tableNumber}
          </span>
        </div>
        <Badge state={mesa.status} size="sm" showIcon={false} />
      </div>

      {/* Attention Signal Banner if flagged */}
      {mesa.attentionSignal?.flagged && (
        <div
          role="alert"
          className="my-1.5 px-2.5 py-1 rounded-lg bg-warning/20 border border-warning/40 text-[11px] font-semibold text-warning-text flex items-center gap-1.5 animate-pulse"
        >
          <span className="w-2 h-2 rounded-full bg-warning inline-block" />
          <span className="truncate">{mesa.attentionSignal.reason ?? 'Atención requerida'}</span>
        </div>
      )}

      {/* Middle/Bottom Information */}
      <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1">
        {isAvailable && (
          <div className="text-xs text-text-muted flex items-center justify-between">
            <span className="font-medium text-success-text">Lista para abrir</span>
            <span className="text-[11px]">Tocar para comensales</span>
          </div>
        )}

        {isBlocked && <div className="text-xs text-text-muted italic">Mesa fuera de servicio</div>}

        {(isOccupied || isInCheck) && (
          <>
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>
                {mesa.guestCount} {mesa.guestCount === 1 ? 'comensal' : 'comensales'}
              </span>
              {elapsedText && (
                <span className="font-mono [font-variant-numeric:tabular-nums] text-text-secondary">
                  ⏱ {elapsedText}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30">
              <span className="text-xs text-text-muted">Total:</span>
              <span className="text-base font-bold text-text">
                <MoneyText amount={mesa.totalAmount} />
              </span>
            </div>
          </>
        )}
      </div>
    </button>
  );
}
