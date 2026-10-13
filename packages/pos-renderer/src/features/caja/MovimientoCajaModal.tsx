import * as React from 'react';
import { Button, Dialog } from '@trident/ui';
import type { MovimientoCajaDTO } from '../../bridge/trident-bridge.js';

export interface MovimientoCajaModalProps {
  readonly isOpen: boolean;
  readonly turnoCajaId: string;
  readonly currentUserId: string;
  readonly onRegisterMovement: (params: {
    movementType: 'INGRESO' | 'EGRESO';
    amount: string;
    reason: string;
    operatorPin: string;
    clientOpId: string;
  }) => Promise<MovimientoCajaDTO | null>;
  readonly onClose: () => void;
}

export function MovimientoCajaModal({
  isOpen,
  turnoCajaId: _turnoCajaId,
  currentUserId: _currentUserId,
  onRegisterMovement,
  onClose,
}: MovimientoCajaModalProps): React.JSX.Element | null {
  const [movementType, setMovementType] = React.useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [amountString, setAmountString] = React.useState<string>('');
  const [reason, setReason] = React.useState<string>('');
  const [operatorPin, setOperatorPin] = React.useState<string>('1234');
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setMovementType('INGRESO');
      setAmountString('');
      setReason('');
      setOperatorPin('1234');
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleQuickAmount = (val: number) => {
    setAmountString(val.toFixed(4));
  };

  const handleSubmit = async () => {
    setErrorMessage(null);

    const amt = parseFloat(amountString);
    if (isNaN(amt) || amt <= 0) {
      setErrorMessage('Ingrese un monto válido mayor a cero.');
      return;
    }

    if (!reason.trim()) {
      setErrorMessage('Debe especificar un motivo justificado para el movimiento.');
      return;
    }

    if (!operatorPin || operatorPin.length < 4) {
      setErrorMessage('Ingrese un PIN de operador de al menos 4 dígitos.');
      return;
    }

    setIsSubmitting(true);
    const clientOpId = crypto.randomUUID();

    const formattedAmount = (Math.round(amt * 10000) / 10000).toFixed(4);

    const res = await onRegisterMovement({
      movementType,
      amount: formattedAmount,
      reason: reason.trim(),
      operatorPin,
      clientOpId,
    });

    setIsSubmitting(false);

    if (res) {
      onClose();
    } else {
      setErrorMessage('Error al registrar el movimiento. Verifique el saldo disponible.');
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Movimiento de Efectivo en Caja"
      description="Registre entradas adicionales o retiros justificados del fondo de caja."
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Movement Type Toggle */}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
          <button
            type="button"
            role="radio"
            aria-checked={movementType === 'INGRESO'}
            onClick={() => setMovementType('INGRESO')}
            className={`min-h-[52px] rounded-xl font-extrabold text-sm border-2 transition-all select-none flex items-center justify-center gap-2 ${
              movementType === 'INGRESO'
                ? 'bg-success-soft border-success text-success-strong shadow-xs'
                : 'bg-surface hover:bg-surface-raised border-border-control text-text-muted'
            }`}
          >
            📥 Entrada (Ingreso)
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={movementType === 'EGRESO'}
            onClick={() => setMovementType('EGRESO')}
            className={`min-h-[52px] rounded-xl font-extrabold text-sm border-2 transition-all select-none flex items-center justify-center gap-2 ${
              movementType === 'EGRESO'
                ? 'bg-danger-soft border-danger text-danger-strong shadow-xs'
                : 'bg-surface hover:bg-surface-raised border-border-control text-text-muted'
            }`}
          >
            📤 Retiro (Egreso)
          </button>
        </div>

        {/* Amount Input & Quick buttons */}
        <div className="flex flex-col gap-2">
          <label htmlFor="amount-input" className="text-xs font-bold text-text uppercase">
            Monto a {movementType === 'INGRESO' ? 'Ingresar' : 'Retirar'} ($):
          </label>
          <input
            id="amount-input"
            type="number"
            step="0.5"
            min="0"
            value={amountString}
            onChange={(e) => setAmountString(e.target.value)}
            placeholder="0.0000"
            className="min-h-[52px] text-2xl font-mono font-bold px-4 bg-surface rounded-xl border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
          />

          <div className="flex gap-2">
            {[100, 200, 500, 1000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleQuickAmount(v)}
                className="flex-1 min-h-[38px] text-xs font-bold rounded-lg border border-border-control bg-surface hover:bg-surface-raised text-text active:scale-95"
              >
                +${v}
              </button>
            ))}
          </div>
        </div>

        {/* Reason / Motivo */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason-input" className="text-xs font-bold text-text uppercase">
            Motivo / Justificación (Obligatorio):
          </label>
          <input
            id="reason-input"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Retiro parcial de seguridad, Cambio de morralla..."
            className="min-h-[44px] px-3.5 text-sm bg-surface rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>

        {/* PIN de operador */}
        <div className="flex items-center justify-between gap-3 p-3 bg-surface-raised rounded-lg border border-border-control">
          <label htmlFor="pin-movimiento" className="text-xs font-bold text-text-muted uppercase">
            PIN de Operador:
          </label>
          <input
            id="pin-movimiento"
            type="password"
            maxLength={6}
            value={operatorPin}
            onChange={(e) => setOperatorPin(e.target.value)}
            className="w-24 min-h-[44px] text-center font-mono tracking-widest text-lg bg-surface rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>

        {errorMessage && (
          <div className="p-3 bg-danger-soft border-2 border-danger rounded-lg text-danger-strong text-xs font-bold">
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button intent="neutral" tone="outline" size="md" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            intent={movementType === 'INGRESO' ? 'primary' : 'danger'}
            tone="solid"
            size="lg"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="min-h-[48px] px-6 font-bold"
          >
            {isSubmitting ? 'Registrando...' : 'Confirmar Movimiento'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
