import * as React from 'react';
import { Dialog, Button, Input } from '@trident/ui';
import type { MesaSummaryDTO } from '../../bridge/trident-bridge.js';

export interface TransferTableDialogProps {
  readonly isOpen: boolean;
  readonly currentMesaId: string;
  readonly availableTables: readonly MesaSummaryDTO[];
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (targetMesaId: string, reason?: string) => void;
}

export function TransferTableDialog({
  isOpen,
  currentMesaId,
  availableTables,
  isLoading = false,
  onClose,
  onConfirm,
}: TransferTableDialogProps): React.JSX.Element {
  const [selectedTargetId, setSelectedTargetId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<string>('');

  React.useEffect(() => {
    if (isOpen) {
      setSelectedTargetId(null);
      setReason('');
    }
  }, [isOpen]);

  const candidateTables = availableTables.filter(
    (t) => t.id !== currentMesaId && t.status === 'DISPONIBLE',
  );

  const handleConfirm = () => {
    if (!selectedTargetId) return;
    onConfirm(selectedTargetId, reason.trim() || undefined);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title="Transferir Cuenta a Otra Mesa"
      description="Seleccione la mesa libre de destino para reubicar a los comensales y su comanda."
    >
      <div className="flex flex-col gap-5 py-2">
        <div>
          <span className="text-xs font-semibold text-text-muted mb-2 block uppercase tracking-wider">
            Mesas Libres Disponibles:
          </span>
          {candidateTables.length === 0 ? (
            <div className="p-4 rounded-xl border border-border bg-surface text-center text-text-muted text-sm">
              No hay otras mesas libres en este momento para realizar la transferencia.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 max-h-[40vh] overflow-y-auto pr-1">
              {candidateTables.map((table) => {
                const isSelected = selectedTargetId === table.id;
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => setSelectedTargetId(table.id)}
                    className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center transition-all select-none active:scale-95 ${
                      isSelected
                        ? 'border-brand bg-brand-soft ring-1 ring-brand text-text'
                        : 'border-border-control bg-surface hover:bg-surface-raised text-text'
                    }`}
                  >
                    <span className="text-lg font-black">Mesa {table.tableNumber}</span>
                    <span className="text-[11px] text-text-muted">{table.roomName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="transfer-reason-input" className="text-sm font-semibold text-text">
            Motivo de Cambio (Opcional):
          </label>
          <Input
            id="transfer-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Solicitud de comensal por sombra, unión de grupo..."
          />
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
            disabled={!selectedTargetId}
            onClick={handleConfirm}
          >
            Confirmar Transferencia
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
