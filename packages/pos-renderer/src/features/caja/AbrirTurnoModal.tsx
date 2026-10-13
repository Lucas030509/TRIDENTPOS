import * as React from 'react';
import { Button, Dialog } from '@trident/ui';
import type { CashShiftStatusDTO } from '../../bridge/trident-bridge.js';

export interface AbrirTurnoModalProps {
  readonly isOpen: boolean;
  readonly defaultStartingCash?: string;
  readonly onOpenShift: (params: {
    startingCash: string;
    cashierUserId: string;
    cashierPin: string;
    clientOpId: string;
  }) => Promise<CashShiftStatusDTO | null>;
  readonly onClose: () => void;
}

export function AbrirTurnoModal({
  isOpen,
  defaultStartingCash = '1000.0000',
  onOpenShift,
  onClose,
}: AbrirTurnoModalProps): React.JSX.Element | null {
  const [startingCash, setStartingCash] = React.useState<string>(defaultStartingCash);
  const [cashierUserId, setCashierUserId] = React.useState<string>('usr-1');
  const [cashierPin, setCashierPin] = React.useState<string>('1234');
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setStartingCash(defaultStartingCash);
      setCashierUserId('usr-1');
      setCashierPin('1234');
      setErrorMessage(null);
    }
  }, [isOpen, defaultStartingCash]);

  const handleQuickFloat = (val: number) => {
    setStartingCash(val.toFixed(4));
  };

  const handleSubmit = async () => {
    setErrorMessage(null);

    const cash = parseFloat(startingCash);
    if (isNaN(cash) || cash < 0) {
      setErrorMessage('Ingrese un monto válido para el fondo inicial.');
      return;
    }

    if (!cashierPin || cashierPin.length < 4) {
      setErrorMessage('Ingrese un PIN de al menos 4 dígitos.');
      return;
    }

    setIsSubmitting(true);
    const clientOpId = crypto.randomUUID();

    const formatted = (Math.round(cash * 10000) / 10000).toFixed(4);

    const res = await onOpenShift({
      startingCash: formatted,
      cashierUserId,
      cashierPin,
      clientOpId,
    });

    setIsSubmitting(false);

    if (res) {
      onClose();
    } else {
      setErrorMessage('Error al abrir el turno de caja. Puede que ya exista uno abierto.');
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Apertura de Turno de Caja"
      description="Establezca el fondo de caja inicial para comenzar operaciones del día o turno."
      className="max-w-md"
    >
      <div className="flex flex-col gap-4">
        {/* Starting Cash */}
        <div className="flex flex-col gap-2">
          <label htmlFor="starting-cash-input" className="text-xs font-bold text-text uppercase">
            Fondo Inicial en Efectivo ($):
          </label>
          <input
            id="starting-cash-input"
            type="number"
            step="50"
            min="0"
            value={startingCash}
            onChange={(e) => setStartingCash(e.target.value)}
            className="min-h-[52px] text-2xl font-mono font-bold px-4 bg-surface rounded-xl border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
          />

          <div className="flex gap-2">
            {[500, 1000, 1500, 2000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleQuickFloat(v)}
                className="flex-1 min-h-[38px] text-xs font-bold rounded-lg border border-border-control bg-surface hover:bg-surface-raised text-text active:scale-95"
              >
                ${v}
              </button>
            ))}
          </div>
        </div>

        {/* Responsible Cashier */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cashier-select" className="text-xs font-bold text-text uppercase">
            Cajero Responsable:
          </label>
          <select
            id="cashier-select"
            value={cashierUserId}
            onChange={(e) => setCashierUserId(e.target.value)}
            className="min-h-[44px] px-3 bg-surface rounded-lg border-2 border-border-control text-text text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          >
            <option value="usr-1">Carlos Mendoza (Cajero Principal)</option>
            <option value="usr-2">Mariana Soto (Cajera Turno Vespertino)</option>
            <option value="usr-admin">Gerente de Turno</option>
          </select>
        </div>

        {/* PIN */}
        <div className="flex items-center justify-between gap-3 p-3 bg-surface-raised rounded-lg border border-border-control">
          <label htmlFor="pin-apertura" className="text-xs font-bold text-text-muted uppercase">
            PIN del Cajero:
          </label>
          <input
            id="pin-apertura"
            type="password"
            maxLength={6}
            value={cashierPin}
            onChange={(e) => setCashierPin(e.target.value)}
            className="w-24 min-h-[44px] text-center font-mono tracking-widest text-lg bg-surface rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>

        {errorMessage && (
          <div className="p-3 bg-danger-soft border-2 border-danger rounded-lg text-danger-strong text-xs font-bold">
            ⚠️ {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button intent="neutral" tone="outline" size="md" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            intent="primary"
            tone="solid"
            size="lg"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="min-h-[48px] px-6 font-bold"
          >
            {isSubmitting ? 'Abriendo Turno...' : 'Abrir Turno de Caja'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
