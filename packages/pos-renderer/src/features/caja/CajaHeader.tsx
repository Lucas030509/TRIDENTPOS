import * as React from 'react';
import { Badge, Button, MoneyText } from '@trident/ui';
import type { CashShiftStatusDTO } from '../../bridge/trident-bridge.js';

export interface CajaHeaderProps {
  readonly shift: CashShiftStatusDTO | null;
  readonly onOpenShiftClick: () => void;
  readonly onMovementClick: () => void;
  readonly onCorteXClick: () => void;
  readonly onArqueoClick: () => void;
  readonly className?: string;
}

export function CajaHeader({
  shift,
  onOpenShiftClick,
  onMovementClick,
  onCorteXClick,
  onArqueoClick,
  className,
}: CajaHeaderProps): React.JSX.Element {
  const isShiftOpen = shift?.status === 'ABIERTO';

  const badgeState = isShiftOpen
    ? 'DISPONIBLE'
    : shift?.status === 'CERRADO'
      ? 'BLOQUEADA'
      : 'POR_VENCER';

  const badgeLabel = isShiftOpen
    ? 'Turno Abierto'
    : shift?.status === 'CERRADO'
      ? 'Turno Cerrado'
      : 'Turno No Iniciado';

  return (
    <header
      role="banner"
      aria-label="Cabecera operacional de caja"
      className={`flex flex-col gap-4 pb-4 border-b border-border bg-surface-raised/40 p-4 rounded-xl border border-border-control shadow-1 ${
        className ?? ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-text">
                Terminal de Caja y Cobro
              </h1>
              <Badge state={badgeState} label={badgeLabel} />
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              {isShiftOpen
                ? `Turno Activo: ${shift?.turnoCajaId ?? 'Principal'} • Operador: ${shift?.cashierUserId ?? 'usr-1'}`
                : 'Turno inactivo. Debe abrir el turno de caja para procesar cobros y movimientos.'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {!isShiftOpen ? (
            <Button
              intent="primary"
              tone="solid"
              size="lg"
              onClick={onOpenShiftClick}
              className="min-h-[48px] px-6 font-semibold"
              aria-label="Abrir turno de caja"
            >
              Abrir Turno de Caja
            </Button>
          ) : (
            <>
              <Button
                intent="neutral"
                tone="outline"
                size="md"
                onClick={onMovementClick}
                className="min-h-[48px]"
                aria-label="Registrar movimiento de efectivo"
              >
                Movimiento de Efectivo
              </Button>
              <Button
                intent="neutral"
                tone="outline"
                size="md"
                onClick={onCorteXClick}
                className="min-h-[48px]"
                aria-label="Generar corte parcial X"
              >
                Corte X (Parcial)
              </Button>
              <Button
                intent="danger"
                tone="outline"
                size="md"
                onClick={onArqueoClick}
                className="min-h-[48px] font-semibold"
                aria-label="Realizar arqueo ciego y corte Z"
              >
                Arqueo Ciego / Corte Z
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Metrics Row (when shift is open) */}
      {isShiftOpen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border">
          <div className="p-3 bg-surface rounded-lg border border-border-control">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
              Fondo Inicial
            </span>
            <div className="text-xl font-bold text-text mt-1">
              <MoneyText amount={shift?.startingCash ?? '0.0000'} size="lg" />
            </div>
          </div>

          <div className="p-3 bg-surface rounded-lg border border-border-control">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
              Saldo Efectivo en Caja
            </span>
            <div className="text-xl font-bold text-success-strong mt-1">
              <MoneyText amount={shift?.currentBalance ?? '0.0000'} size="lg" isPositiveGreen />
            </div>
          </div>

          <div className="p-3 bg-surface rounded-lg border border-border-control">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
              Hora de Apertura
            </span>
            <div className="text-base font-semibold text-text mt-1">
              {shift?.openedAt
                ? new Date(shift.openedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '--:--'}
            </div>
          </div>

          <div className="p-3 bg-surface rounded-lg border border-border-control">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
              Estrategia Turno
            </span>
            <div className="text-base font-semibold text-text mt-1">
              Compartido (DEC-017)
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
