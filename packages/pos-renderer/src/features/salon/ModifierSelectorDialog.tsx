import * as React from 'react';
import { Dialog, Button, MoneyText, Input } from '@trident/ui';
import type { CatalogProductDTO, CatalogModifierOptionDTO } from '../../bridge/trident-bridge.js';

export interface SelectedModifier {
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
  readonly modifierPriceApplied: string;
}

export interface ModifierSelectorDialogProps {
  readonly product: CatalogProductDTO | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (params: {
    readonly product: CatalogProductDTO;
    readonly modifiers: readonly SelectedModifier[];
    readonly notes?: string;
  }) => void;
}

export function ModifierSelectorDialog({
  product,
  isOpen,
  onClose,
  onConfirm,
}: ModifierSelectorDialogProps): React.JSX.Element {
  const [selectedOptionsByGroup, setSelectedOptionsByGroup] = React.useState<
    Record<string, CatalogModifierOptionDTO[]>
  >({});
  const [kitchenNotes, setKitchenNotes] = React.useState<string>('');

  // Reset state when opening product
  React.useEffect(() => {
    if (isOpen && product) {
      setKitchenNotes('');
      const initial: Record<string, CatalogModifierOptionDTO[]> = {};
      // For required single-choice groups, auto-select first option if desired or leave empty
      product.modifierGroups?.forEach((g) => {
        const firstOpt = g.options[0];
        if (g.required && g.minSelect === 1 && firstOpt) {
          initial[g.id] = [firstOpt];
        } else {
          initial[g.id] = [];
        }
      });
      setSelectedOptionsByGroup(initial);
    }
  }, [isOpen, product]);

  if (!product) return <></>;

  const modifierGroups = product.modifierGroups ?? [];

  // Toggle option selection respecting maxSelect
  const handleToggleOption = (
    groupId: string,
    option: CatalogModifierOptionDTO,
    maxSelect: number,
  ) => {
    setSelectedOptionsByGroup((prev) => {
      const currentList = prev[groupId] ?? [];
      const alreadySelected = currentList.some((opt) => opt.id === option.id);

      if (alreadySelected) {
        return {
          ...prev,
          [groupId]: currentList.filter((opt) => opt.id !== option.id),
        };
      }

      if (maxSelect === 1) {
        return {
          ...prev,
          [groupId]: [option],
        };
      }

      if (currentList.length < maxSelect) {
        return {
          ...prev,
          [groupId]: [...currentList, option],
        };
      }

      return prev;
    });
  };

  // Validation: all required groups must have at least minSelect options
  const isValid = modifierGroups.every((g) => {
    const list = selectedOptionsByGroup[g.id] ?? [];
    if (g.required && list.length < g.minSelect) {
      return false;
    }
    return true;
  });

  // Calculate total price with extras
  const extraTotalScale4 = React.useMemo(() => {
    let sumExtra = 0n;
    Object.values(selectedOptionsByGroup)
      .flat()
      .forEach((opt) => {
        const p = BigInt(Math.round(parseFloat(opt.extraPrice) * 10000));
        sumExtra += p;
      });
    const baseP = BigInt(Math.round(parseFloat(product.basePrice) * 10000));
    return (Number(baseP + sumExtra) / 10000).toFixed(4);
  }, [selectedOptionsByGroup, product.basePrice]);

  const handleConfirm = () => {
    if (!isValid) return;

    const allSelected: SelectedModifier[] = Object.values(selectedOptionsByGroup)
      .flat()
      .map((opt) => ({
        modifierId: opt.id,
        modifierNameSnapshot: opt.name,
        modifierPriceApplied: opt.extraPrice,
      }));

    onConfirm({
      product,
      modifiers: allSelected,
      notes: kitchenNotes.trim() ? kitchenNotes.trim() : undefined,
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={product.name}
      description={`Personalice la preparación y agregue notas para cocina.`}
    >
      <div className="flex flex-col gap-6 py-2 max-h-[60vh] overflow-y-auto pr-1">
        {/* Modifier Groups */}
        {modifierGroups.map((group) => {
          const selected = selectedOptionsByGroup[group.id] ?? [];
          const meetsRequirement = !group.required || selected.length >= group.minSelect;

          return (
            <div
              key={group.id}
              className={`p-4 rounded-2xl border-2 transition-colors ${
                meetsRequirement
                  ? 'border-border bg-surface'
                  : 'border-warning/60 bg-warning-soft/20'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-text text-base">{group.name}</span>
                  {group.required ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-danger-soft text-danger-text uppercase">
                      Obligatorio ({group.minSelect})
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-surface-raised text-text-muted">
                      Opcional (máx {group.maxSelect})
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {selected.length}/{group.maxSelect} seleccionados
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {group.options.map((option) => {
                  const isChecked = selected.some((opt) => opt.id === option.id);
                  const hasExtra = parseFloat(option.extraPrice) > 0;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleToggleOption(group.id, option, group.maxSelect)}
                      className={`h-14 px-4 rounded-xl border-2 flex items-center justify-between transition-all select-none active:scale-[0.98] ${
                        isChecked
                          ? 'border-brand bg-brand-soft ring-1 ring-brand text-text'
                          : 'border-border-control bg-surface hover:bg-surface-raised text-text'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-black ${
                            isChecked
                              ? 'bg-brand text-brand-contrast border-brand'
                              : 'border-border-control bg-surface'
                          }`}
                        >
                          {isChecked ? '✓' : ''}
                        </span>
                        <span className="text-sm font-semibold">{option.name}</span>
                      </div>
                      {hasExtra && (
                        <span className="text-xs font-mono font-bold text-text-secondary">
                          +<MoneyText amount={option.extraPrice} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Kitchen Notes */}
        <div className="flex flex-col gap-2">
          <label htmlFor="kitchen-notes-input" className="text-sm font-semibold text-text">
            Instrucciones para Cocina (Opcional):
          </label>
          <Input
            id="kitchen-notes-input"
            value={kitchenNotes}
            onChange={(e) => setKitchenNotes(e.target.value)}
            placeholder="Ej: Término muy sellado, salsa aparte, alérgico a nueces..."
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-muted">Total partida:</span>
            <span className="text-xl font-black text-text">
              <MoneyText amount={extraTotalScale4} />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" intent="secondary" size="lg" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              intent="primary"
              size="lg"
              disabled={!isValid}
              onClick={handleConfirm}
            >
              Agregar a Comanda
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
