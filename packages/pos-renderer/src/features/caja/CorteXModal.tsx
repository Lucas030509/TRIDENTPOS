import * as React from 'react';
import { Button, Dialog, MoneyText } from '@trident/ui';
import type { CorteCajaDTO } from '../../bridge/trident-bridge.js';

export interface CorteXModalProps {
  readonly isOpen: boolean;
  readonly corte: CorteCajaDTO | null;
  readonly onClose: () => void;
}

export function CorteXModal({
  isOpen,
  corte,
  onClose,
}: CorteXModalProps): React.JSX.Element | null {
  const [isPrinted, setIsPrinted] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (isOpen) {
      setIsPrinted(false);
    }
  }, [isOpen]);

  if (!isOpen || !corte) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Corte Parcial X (Informativo)"
      description="Resumen de operaciones y recaudación del turno actual. No cierra el turno."
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Metadatos */}
        <div className="flex items-center justify-between text-xs text-text-muted pb-2 border-b border-border">
          <span>Turno: {corte.turnoCajaId}</span>
          <span>
            Generado:{' '}
            {new Date(corte.generatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>

        {/* Ventas por Método de Pago */}
        <div className="flex flex-col gap-2 p-3 bg-surface-raised rounded-xl border border-border-control">
          <span className="text-xs font-bold text-text-muted uppercase">
            Ventas Registradas por Método
          </span>

          <div className="flex justify-between text-sm text-text">
            <span>💵 Efectivo:</span>
            <MoneyText amount={corte.totalVentasEfectivo} size="sm" className="font-semibold" />
          </div>

          <div className="flex justify-between text-sm text-text">
            <span>💳 Tarjeta (Terminales):</span>
            <MoneyText amount={corte.totalVentasTarjeta} size="sm" className="font-semibold" />
          </div>

          <div className="flex justify-between text-sm text-text">
            <span>📲 Transferencia / SPEI:</span>
            <MoneyText amount={corte.totalVentasTransferencia} size="sm" className="font-semibold" />
          </div>

          <div className="flex justify-between text-sm text-text pt-1 border-t border-border">
            <span>Total Propinas Recibidas:</span>
            <MoneyText amount={corte.totalPropinas} size="sm" className="font-semibold text-primary" />
          </div>

          <div className="flex justify-between text-xs text-text-muted">
            <span>Tickets / Cuentas Cobradas:</span>
            <span className="font-mono font-bold text-text">{corte.ticketsCount} operaciones</span>
          </div>
        </div>

        {/* Flujo de Efectivo en Caja */}
        <div className="flex flex-col gap-2 p-3 bg-surface-raised rounded-xl border border-border-control">
          <span className="text-xs font-bold text-text-muted uppercase">
            Balance de Efectivo en Caja
          </span>

          <div className="flex justify-between text-sm text-text">
            <span>Fondo Inicial:</span>
            <MoneyText amount={corte.openingCashFloat} size="sm" />
          </div>

          <div className="flex justify-between text-sm text-success-strong">
            <span>+ Ingresos / Entradas Extra:</span>
            <MoneyText amount={corte.totalIngresos} size="sm" />
          </div>

          <div className="flex justify-between text-sm text-danger-strong">
            <span>- Egresos / Retiros:</span>
            <MoneyText amount={corte.totalEgresos} size="sm" />
          </div>

          <div className="flex justify-between items-baseline pt-2 border-t-2 border-border-control">
            <span className="text-sm font-extrabold text-text uppercase">Saldo Actual en Cajón:</span>
            <div className="text-xl font-black text-success-strong">
              <MoneyText amount={corte.totalCalculado} size="xl" isPositiveGreen />
            </div>
          </div>
        </div>

        {/* Print Feedback */}
        {isPrinted ? (
          <div className="p-3 bg-success-soft border border-success rounded-lg text-success-strong text-xs font-bold text-center">
            🖨️ Ticket de Corte X enviado a la impresora de recibos.
          </div>
        ) : (
          <Button
            intent="neutral"
            tone="outline"
            size="md"
            onClick={() => setIsPrinted(true)}
            className="min-h-[44px]"
          >
            🖨️ Imprimir Ticket de Corte X
          </Button>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <Button intent="primary" tone="solid" size="md" onClick={onClose}>
            Entendido
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
