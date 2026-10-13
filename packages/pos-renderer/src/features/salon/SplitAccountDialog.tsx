import * as React from 'react';
import { Dialog, Button, MoneyText } from '@trident/ui';
import type { CuentaDetalleDTO } from '../../bridge/trident-bridge.js';

export interface SplitAccountDialogProps {
  readonly cuenta: CuentaDetalleDTO | null;
  readonly isOpen: boolean;
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirmEqualParts: (parts: number) => void;
  readonly onConfirmByItems: (selectedItemIds: readonly string[]) => void;
}

export function SplitAccountDialog({
  cuenta,
  isOpen,
  isLoading = false,
  onClose,
  onConfirmEqualParts,
  onConfirmByItems,
}: SplitAccountDialogProps): React.JSX.Element {
  const [splitMode, setSplitMode] = React.useState<'EQUAL' | 'ITEMS'>('EQUAL');
  const [parts, setParts] = React.useState<number>(2);
  const [selectedItemIds, setSelectedItemIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (isOpen) {
      setSplitMode('EQUAL');
      setParts(2);
      setSelectedItemIds(new Set());
    }
  }, [isOpen]);

  if (!cuenta) return <></>;

  const activeItems = cuenta.items.filter((i) => i.status !== 'CANCELADO');

  const toggleItemSelection = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const amountPerPartScale4 = React.useMemo(() => {
    if (parts <= 0) return '0.0000';
    const total = BigInt(Math.round(parseFloat(cuenta.totalAmount) * 10000));
    const p = total / BigInt(parts);
    return (Number(p) / 10000).toFixed(4);
  }, [cuenta.totalAmount, parts]);

  const selectedItemsTotalScale4 = React.useMemo(() => {
    let sum = 0n;
    activeItems.forEach((i) => {
      if (selectedItemIds.has(i.id)) {
        sum += BigInt(Math.round(parseFloat(i.total) * 10000));
      }
    });
    return (Number(sum) / 10000).toFixed(4);
  }, [activeItems, selectedItemIds]);

  const handleConfirm = () => {
    if (splitMode === 'EQUAL') {
      onConfirmEqualParts(parts);
    } else {
      if (selectedItemIds.size === 0) return;
      onConfirmByItems(Array.from(selectedItemIds));
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title="Dividir Cuenta (DEC-015)"
      description={`Mesa ${cuenta.tableNumber ?? ''} — Total actual: $${cuenta.totalAmount}`}
    >
      <div className="flex flex-col gap-6 py-2">
        {/* Split Mode Selector Tabs */}
        <div className="grid grid-cols-2 p-1 bg-surface-raised rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setSplitMode('EQUAL')}
            className={`h-11 rounded-lg text-sm font-bold transition-all select-none ${
              splitMode === 'EQUAL'
                ? 'bg-brand text-brand-contrast shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            Partes Iguales (Equitativa)
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('ITEMS')}
            className={`h-11 rounded-lg text-sm font-bold transition-all select-none ${
              splitMode === 'ITEMS'
                ? 'bg-brand text-brand-contrast shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            Por Partidas (Separar Productos)
          </button>
        </div>

        {/* EQUAL MODE */}
        {splitMode === 'EQUAL' && (
          <div className="flex flex-col items-center justify-center p-6 bg-surface rounded-2xl border border-border gap-4">
            <span className="text-sm font-semibold text-text-muted uppercase tracking-wider">
              Dividir entre cuántas partes:
            </span>
            <div className="flex items-center gap-6">
              <button
                type="button"
                disabled={parts <= 2 || isLoading}
                onClick={() => setParts((p) => Math.max(2, p - 1))}
                className="w-14 h-14 rounded-2xl bg-surface-raised border-2 border-border-control flex items-center justify-center text-2xl font-bold text-text hover:bg-surface disabled:opacity-40"
              >
                −
              </button>
              <span className="text-5xl font-black text-text font-mono [font-variant-numeric:tabular-nums]">
                {parts}
              </span>
              <button
                type="button"
                disabled={parts >= 20 || isLoading}
                onClick={() => setParts((p) => p + 1)}
                className="w-14 h-14 rounded-2xl bg-surface-raised border-2 border-border-control flex items-center justify-center text-2xl font-bold text-text hover:bg-surface disabled:opacity-40"
              >
                +
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 w-full mt-2">
              {[2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setParts(num)}
                  className={`h-10 rounded-lg text-xs font-bold border-2 transition-all ${
                    parts === num
                      ? 'bg-brand text-brand-contrast border-brand'
                      : 'bg-surface border-border-control hover:bg-surface-raised text-text'
                  }`}
                >
                  {num} partes
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ITEMS MODE */}
        {splitMode === 'ITEMS' && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Toque las partidas para transferir a la nueva subcuenta:
            </span>
            <div className="max-h-[45vh] overflow-y-auto flex flex-col gap-2 pr-1">
              {activeItems.map((item) => {
                const isSelected = selectedItemIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItemSelection(item.id)}
                    className={`p-3.5 rounded-xl border-2 flex items-center justify-between text-left transition-all ${
                      isSelected
                        ? 'border-brand bg-brand-soft ring-1 ring-brand text-text'
                        : 'border-border-control bg-surface hover:bg-surface-raised text-text'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-bold ${
                          isSelected
                            ? 'bg-brand text-brand-contrast border-brand'
                            : 'border-border-control bg-surface'
                        }`}
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                      <div>
                        <span className="text-sm font-bold block">
                          {item.quantity}x {item.productNameSnapshot}
                        </span>
                        {item.modifiers.length > 0 && (
                          <span className="text-xs text-text-muted block">
                            {item.modifiers.map((m) => m.modifierNameSnapshot).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-mono font-bold text-text">
                      <MoneyText amount={item.total} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
          <div className="text-sm font-semibold text-text">
            {splitMode === 'EQUAL' ? (
              <span>
                {parts} partes de <MoneyText amount={amountPerPartScale4} /> c/u
              </span>
            ) : (
              <span>
                Seleccionado: <MoneyText amount={selectedItemsTotalScale4} /> (
                {selectedItemIds.size} partidas)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              intent="secondary"
              size="lg"
              disabled={isLoading}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              intent="primary"
              size="lg"
              isLoading={isLoading}
              disabled={splitMode === 'ITEMS' && selectedItemIds.size === 0}
              onClick={handleConfirm}
            >
              Confirmar División
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
