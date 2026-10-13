import * as React from 'react';
import { Badge, Button, MoneyText } from '@trident/ui';
import { getTridentBridge, CashShiftStatusDTO } from '../bridge/trident-bridge.js';

export function CajaRoute(): React.JSX.Element {
  const bridge = getTridentBridge();
  const [shift, setShift] = React.useState<CashShiftStatusDTO | null>(null);

  React.useEffect(() => {
    let mounted = true;
    bridge.caja.getShiftStatus().then((res) => {
      if (mounted && res.ok) {
        setShift(res.data);
      }
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Terminal de Caja y Cobro</h1>
          <p className="text-sm text-text-muted">Turno de caja y operaciones de liquidación</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            state={shift?.status === 'ABIERTO' ? 'DISPONIBLE' : 'BLOQUEADA'}
            label={shift?.status === 'ABIERTO' ? 'Turno Abierto' : 'Turno Cerrado'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="p-6 bg-surface rounded-xl border-2 border-border-control shadow-1">
          <span className="text-sm font-semibold text-text-muted uppercase">Fondo Inicial</span>
          <div className="text-2xl font-extrabold text-text mt-2">
            <MoneyText amount={shift?.startingCash ?? '0.0000'} size="2xl" />
          </div>
        </div>

        <div className="p-6 bg-surface rounded-xl border-2 border-border-control shadow-1">
          <span className="text-sm font-semibold text-text-muted uppercase">Saldo en Caja</span>
          <div className="text-2xl font-extrabold text-text mt-2">
            <MoneyText amount={shift?.currentBalance ?? '0.0000'} size="2xl" isPositiveGreen />
          </div>
        </div>

        <div className="p-6 bg-surface rounded-xl border-2 border-border-control shadow-1 flex flex-col justify-between">
          <span className="text-sm font-semibold text-text-muted uppercase">
            Operaciones de Turno
          </span>
          <div className="flex items-center gap-3 mt-4">
            <Button intent="neutral" tone="outline" size="md" className="flex-1">
              Corte X / Z
            </Button>
            <Button intent="danger" tone="outline" size="md" className="flex-1">
              Cerrar Turno
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 bg-surface rounded-xl border-2 border-border-control flex items-center justify-center">
        <p className="text-md text-text-muted">
          Seleccione una cuenta desde el Salón para iniciar el flujo de cobro y liquidación.
        </p>
      </div>
    </div>
  );
}
