import * as React from 'react';
import { Button, Dialog, MoneyText } from '@trident/ui';
import type { TenderResultDTO } from '../../bridge/trident-bridge.js';

export interface CobroExitosoModalProps {
  readonly isOpen: boolean;
  readonly result: TenderResultDTO | null;
  readonly tableOrAccountLabel: string;
  readonly onDismiss: () => void;
}

export function CobroExitosoModal({
  isOpen,
  result,
  tableOrAccountLabel,
  onDismiss,
}: CobroExitosoModalProps): React.JSX.Element | null {
  if (!isOpen || !result) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onDismiss}
      title="¡Cobro Exitoso y Cuenta Liquidada!"
      description="La transacción ha sido registrada y respaldada en el libro inmutable."
      className="max-w-md text-center"
    >
      <div className="flex flex-col gap-4 text-center items-center py-2">
        {/* Animated Celebration / Success Badge */}
        <div className="w-16 h-16 rounded-full bg-success-soft border-2 border-success flex items-center justify-center text-3xl shadow-sm">
          ✅
        </div>

        <div>
          <span className="text-xs uppercase font-extrabold text-text-muted tracking-wider">
            {tableOrAccountLabel}
          </span>
          <h3 className="text-xl font-black text-text mt-0.5">
            Comprobante #{result.id.slice(-6)}
          </h3>
        </div>

        {/* Change due highlight if cash */}
        {result.paymentMethod === 'EFECTIVO' && result.changeDue && result.changeDue !== '0.0000' && (
          <div className="w-full p-4 bg-success-soft border-2 border-success rounded-xl flex flex-col items-center">
            <span className="text-xs font-extrabold text-success-strong uppercase tracking-wider">
              Entregar Cambio al Cliente:
            </span>
            <div className="text-3xl font-black text-success-strong mt-1">
              <MoneyText amount={result.changeDue} size="2xl" isPositiveGreen />
            </div>
          </div>
        )}

        {/* Payment Summary */}
        <div className="w-full p-3.5 bg-surface-raised rounded-xl border border-border-control flex flex-col gap-2 text-xs text-text">
          <div className="flex justify-between">
            <span className="text-text-muted">Método:</span>
            <span className="font-bold">
              {result.paymentMethod === 'EFECTIVO'
                ? '💵 Efectivo'
                : result.paymentMethod === 'TARJETA'
                  ? '💳 Tarjeta Bancaria'
                  : '📲 Transferencia SPEI'}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-text-muted">Monto Pagado:</span>
            <MoneyText amount={result.amount} size="sm" className="font-bold" />
          </div>

          {result.tipAmount !== '0.0000' && (
            <div className="flex justify-between text-primary">
              <span>Propina:</span>
              <MoneyText amount={result.tipAmount} size="sm" className="font-bold" />
            </div>
          )}

          {result.referenceAuthCode && (
            <div className="flex justify-between font-mono">
              <span className="text-text-muted">Autorización:</span>
              <span>{result.referenceAuthCode}</span>
            </div>
          )}
        </div>

        {/* POS Hardware Signals */}
        <div className="flex items-center justify-center gap-4 text-xs font-semibold text-text-muted pt-1">
          <span className="flex items-center gap-1.5 text-success-strong">
            <span>📥</span> Cajón de dinero abierto
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5 text-primary">
            <span>🖨️</span> Ticket impreso
          </span>
        </div>

        {/* Giant Next Operation Button */}
        <div className="w-full pt-3 border-t border-border mt-1">
          <Button
            intent="primary"
            tone="solid"
            size="xl"
            onClick={onDismiss}
            className="w-full min-h-[56px] font-black text-lg"
            aria-label="Aceptar y continuar a la siguiente cuenta"
          >
            Siguiente Operación
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
