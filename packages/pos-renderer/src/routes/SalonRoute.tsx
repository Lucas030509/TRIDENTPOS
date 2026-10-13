import * as React from 'react';
import { Badge, Button } from '@trident/ui';
import { getTridentBridge, SalonReadModelDTO } from '../bridge/trident-bridge.js';

export function SalonRoute(): React.JSX.Element {
  const bridge = getTridentBridge();
  const [readModel, setReadModel] = React.useState<SalonReadModelDTO | null>(null);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    bridge.salon.getSalonReadModel().then((res) => {
      if (mounted && res.ok) {
        setReadModel(res.data);
      }
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  const tables = React.useMemo(() => {
    if (!readModel) return [];
    return readModel.rooms.flatMap((r) => r.tables);
  }, [readModel]);

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-hidden">
      {/* Top Floor Summary Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Salón Principal</h1>
          <p className="text-sm text-text-muted">Distribución de mesas y comandas activas</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge state="DISPONIBLE" label={`Libres: ${readModel?.availableTables ?? 0}`} />
          <Badge state="OCUPADA" label={`Ocupadas: ${readModel?.occupiedTables ?? 0}`} />
          <Badge state="EN_CUENTA" label={`En Cuenta: ${readModel?.inCheckTables ?? 0}`} />
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {tables.map((table) => {
            const isSelected = selectedTableId === table.id;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => setSelectedTableId(table.id)}
                className={`min-h-[120px] p-4 rounded-xl border-2 flex flex-col justify-between text-left transition-all focus:outline-none focus:ring-2 focus:ring-focus select-none ${
                  isSelected
                    ? 'border-brand bg-brand-soft ring-2 ring-brand'
                    : 'border-border-control bg-surface hover:bg-surface-raised'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold text-text">Mesa {table.tableNumber}</span>
                  <Badge state={table.status} size="sm" showIcon={false} />
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-xs text-text-muted">
                  <span>{table.guestCount > 0 ? `${table.guestCount} comensales` : 'Sin abrir'}</span>
                  <span className="font-mono [font-variant-numeric:tabular-nums] font-semibold text-text">
                    ${table.totalAmount}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floor Bottom Actions */}
      <div className="pt-4 border-t border-border flex items-center justify-between">
        <span className="text-sm text-text-muted">
          {selectedTableId ? `Mesa seleccionada: ${selectedTableId}` : 'Seleccione una mesa'}
        </span>
        <div className="flex items-center gap-3">
          <Button intent="primary" size="lg" disabled={!selectedTableId}>
            Abrir Comandero
          </Button>
        </div>
      </div>
    </div>
  );
}
