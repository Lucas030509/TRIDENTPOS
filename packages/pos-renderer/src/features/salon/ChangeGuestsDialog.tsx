import * as React from 'react';
import { Dialog, Button } from '@trident/ui';

export interface ChangeGuestsDialogProps {
  readonly currentCount: number;
  readonly isOpen: boolean;
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (count: number) => void;
}

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

export function ChangeGuestsDialog({
  currentCount,
  isOpen,
  isLoading = false,
  onClose,
  onConfirm,
}: ChangeGuestsDialogProps): React.JSX.Element {
  const [count, setCount] = React.useState<number>(currentCount);

  React.useEffect(() => {
    if (isOpen) {
      setCount(currentCount);
    }
  }, [isOpen, currentCount]);

  const handleConfirm = () => {
    onConfirm(Math.max(1, count));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title="Ajustar Número de Comensales"
      description="Actualice el conteo de personas en la mesa."
    >
      <div className="flex flex-col gap-6 py-2">
        <div className="flex items-center justify-center gap-6 p-4 bg-surface-raised rounded-2xl border border-border">
          <button
            type="button"
            disabled={count <= 1 || isLoading}
            onClick={() => setCount((prev) => Math.max(1, prev - 1))}
            className="w-12 h-12 rounded-xl bg-surface border-2 border-border-control flex items-center justify-center text-xl font-bold text-text hover:bg-surface-raised disabled:opacity-40"
          >
            −
          </button>
          <span className="text-4xl font-black text-text font-mono [font-variant-numeric:tabular-nums] min-w-[2ch] text-center">
            {count}
          </span>
          <button
            type="button"
            disabled={count >= 99 || isLoading}
            onClick={() => setCount((prev) => prev + 1)}
            className="w-12 h-12 rounded-xl bg-surface border-2 border-border-control flex items-center justify-center text-xl font-bold text-text hover:bg-surface-raised disabled:opacity-40"
          >
            +
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {QUICK_COUNTS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCount(c)}
              className={`h-11 rounded-xl text-sm font-bold border-2 transition-all select-none active:scale-95 ${
                count === c
                  ? 'bg-brand text-brand-contrast border-brand shadow-sm'
                  : 'bg-surface text-text border-border-control hover:bg-surface-raised'
              }`}
            >
              {c} {c === 1 ? 'persona' : 'personas'}
            </button>
          ))}
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
            Guardar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
