import * as React from 'react';
import { Dialog, Button, Input } from '@trident/ui';
import type { CuentaItemDTO } from '../../bridge/trident-bridge.js';

export interface CancelItemDialogProps {
  readonly item: CuentaItemDTO | null;
  readonly isOpen: boolean;
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string, supervisorPin?: string) => void;
}

const COMMON_REASONS = [
  'Error al capturar',
  'Comensal canceló a tiempo',
  'Cambio por otro platillo',
  'Demora excesiva de cocina',
  'Alergia / Restricción no especificada',
];

export function CancelItemDialog({
  item,
  isOpen,
  isLoading = false,
  onClose,
  onConfirm,
}: CancelItemDialogProps): React.JSX.Element {
  const [reason, setReason] = React.useState<string>('');
  const [supervisorPin, setSupervisorPin] = React.useState<string>('');

  React.useEffect(() => {
    if (isOpen) {
      setReason('');
      setSupervisorPin('');
    }
  }, [isOpen]);

  if (!item) return <></>;

  const isReasonValid = reason.trim().length >= 3;

  const handleConfirm = () => {
    if (!isReasonValid) return;
    onConfirm(reason.trim(), supervisorPin.trim() || undefined);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title="Cancelar Partida de Comanda"
      description={`Partida: "${item.productNameSnapshot}" (${item.quantity} pza). Requiere motivo obligatorio para auditoría.`}
    >
      <div className="flex flex-col gap-5 py-2">
        {/* Predefined Reasons */}
        <div>
          <span className="text-xs font-semibold text-text-muted mb-2 block uppercase tracking-wider">
            Motivos Frecuentes:
          </span>
          <div className="flex flex-wrap gap-2">
            {COMMON_REASONS.map((r) => {
              const isSelected = reason === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-all select-none active:scale-95 ${
                    isSelected
                      ? 'bg-danger text-danger-contrast border-danger shadow-sm'
                      : 'bg-surface text-text border-border-control hover:bg-surface-raised'
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Reason Input */}
        <div className="flex flex-col gap-2">
          <label htmlFor="cancel-reason-input" className="text-sm font-semibold text-text">
            Detalle del Motivo (Obligatorio):
          </label>
          <Input
            id="cancel-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Escriba o seleccione un motivo..."
          />
        </div>

        {/* Optional Supervisor Step-up PIN */}
        <div className="flex flex-col gap-2 p-3 bg-surface rounded-xl border border-border">
          <label htmlFor="cancel-pin-input" className="text-xs font-semibold text-text-muted">
            PIN de Supervisor (si la partida ya está en preparación):
          </label>
          <Input
            id="cancel-pin-input"
            type="password"
            value={supervisorPin}
            onChange={(e) => setSupervisorPin(e.target.value)}
            placeholder="PIN de autorización (4 dígitos)"
            maxLength={6}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" intent="secondary" size="lg" disabled={isLoading} onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            intent="danger"
            size="lg"
            isLoading={isLoading}
            disabled={!isReasonValid}
            onClick={handleConfirm}
          >
            Confirmar Cancelación
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
