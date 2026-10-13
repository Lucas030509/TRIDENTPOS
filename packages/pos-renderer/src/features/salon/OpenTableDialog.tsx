import * as React from 'react';
import { Dialog, Button } from '@trident/ui';
import type { MesaSummaryDTO } from '../../bridge/trident-bridge.js';
import { useSession } from '../../context/SessionContext.js';

export interface OpenTableDialogProps {
  readonly mesa: MesaSummaryDTO | null;
  readonly isOpen: boolean;
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (params: {
    mesaId: string;
    guestCount: number;
    waiterUserId: string;
  }) => void;
}

const QUICK_GUEST_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

export function OpenTableDialog({
  mesa,
  isOpen,
  isLoading = false,
  onClose,
  onConfirm,
}: OpenTableDialogProps): React.JSX.Element {
  const { session } = useSession();
  const [guestCount, setGuestCount] = React.useState<number>(2);

  React.useEffect(() => {
    if (isOpen) {
      setGuestCount(2);
    }
  }, [isOpen]);

  if (!mesa) return <></>;

  const handleConfirm = () => {
    onConfirm({
      mesaId: mesa.id,
      guestCount: Math.max(1, guestCount),
      waiterUserId: session?.userId ?? 'usr-1',
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title={`Abrir Mesa ${mesa.tableNumber}`}
      description={`Zona: ${mesa.roomName} — Seleccione el número de comensales para iniciar la cuenta.`}
    >
      <div className="flex flex-col gap-6 py-2">
        {/* Stepper Display */}
        <div className="flex flex-col items-center justify-center p-6 bg-surface-raised rounded-2xl border border-border">
          <span className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-2">
            Número de Comensales
          </span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              disabled={guestCount <= 1 || isLoading}
              onClick={() => setGuestCount((prev) => Math.max(1, prev - 1))}
              className="w-14 h-14 rounded-2xl bg-surface border-2 border-border-control flex items-center justify-center text-2xl font-bold text-text hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed focus:ring-2 focus:ring-focus transition-all active:scale-95"
              aria-label="Disminuir comensales"
            >
              −
            </button>
            <span
              className="text-5xl font-black text-text font-mono [font-variant-numeric:tabular-nums] min-w-[3ch] text-center"
              aria-live="polite"
            >
              {guestCount}
            </span>
            <button
              type="button"
              disabled={guestCount >= 99 || isLoading}
              onClick={() => setGuestCount((prev) => prev + 1)}
              className="w-14 h-14 rounded-2xl bg-surface border-2 border-border-control flex items-center justify-center text-2xl font-bold text-text hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed focus:ring-2 focus:ring-focus transition-all active:scale-95"
              aria-label="Aumentar comensales"
            >
              +
            </button>
          </div>
        </div>

        {/* Quick Selection Buttons */}
        <div>
          <span className="text-xs font-semibold text-text-muted mb-2 block">
            Selección Rápida:
          </span>
          <div className="grid grid-cols-4 gap-2.5">
            {QUICK_GUEST_COUNTS.map((count) => {
              const isSelected = guestCount === count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => setGuestCount(count)}
                  className={`h-12 rounded-xl text-base font-bold transition-all border-2 flex items-center justify-center select-none active:scale-95 ${
                    isSelected
                      ? 'bg-brand text-brand-contrast border-brand shadow-sm'
                      : 'bg-surface text-text border-border-control hover:bg-surface-raised'
                  }`}
                >
                  {count} {count === 1 ? 'persona' : 'personas'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Waiter Attribution Info */}
        <div className="p-3.5 bg-surface rounded-xl border border-border/80 flex items-center justify-between text-xs text-text-muted">
          <span>Mesero Responsable:</span>
          <span className="font-semibold text-text">
            {session?.displayName ?? 'Mesero en Turno'}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" intent="secondary" size="lg" disabled={isLoading} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            intent="primary"
            size="lg"
            isLoading={isLoading}
            onClick={handleConfirm}
          >
            Abrir Mesa e Iniciar Comanda
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
