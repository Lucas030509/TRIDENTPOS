import * as React from 'react';
import { Badge, Button, EmptyState } from '@trident/ui';
import { getTridentBridge, SalonReadModelDTO, MesaSummaryDTO } from '../bridge/trident-bridge.js';
import { TableCard } from '../features/salon/TableCard.js';
import { OpenTableDialog } from '../features/salon/OpenTableDialog.js';
import { ComanderoView } from '../features/salon/ComanderoView.js';

export function SalonRoute(): React.JSX.Element {
  const bridge = getTridentBridge();

  const [readModel, setReadModel] = React.useState<SalonReadModelDTO | null>(null);
  const [selectedRoom, setSelectedRoom] = React.useState<string>('TODAS');
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  // Active table & open table dialog
  const [mesaToOpen, setMesaToOpen] = React.useState<MesaSummaryDTO | null>(null);
  const [isOpeningTable, setIsOpeningTable] = React.useState<boolean>(false);

  // Active view: Salon overview vs Comandero view
  const [activeComandero, setActiveComandero] = React.useState<{
    mesaId: string;
    cuentaId: string;
  } | null>(null);

  // Fetch read model
  const fetchSalon = React.useCallback(async () => {
    setIsLoading(true);
    const res = await bridge.salon.getSalonReadModel();
    if (res.ok) {
      setReadModel(res.data);
    }
    setIsLoading(false);
  }, [bridge]);

  React.useEffect(() => {
    fetchSalon();

    // Subscribe to domain event invalidations
    const unsubscribe = bridge.events.subscribe((event) => {
      if (
        event.eventType.includes('CUENTA') ||
        event.eventType.includes('MESA') ||
        event.eventType.includes('ORDEN')
      ) {
        fetchSalon();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, fetchSalon]);

  const allTables = React.useMemo(() => {
    if (!readModel) return [];
    return readModel.rooms.flatMap((r) => r.tables);
  }, [readModel]);

  const roomNames = React.useMemo(() => {
    if (!readModel) return [];
    return readModel.rooms.map((r) => r.name);
  }, [readModel]);

  const displayedTables = React.useMemo(() => {
    if (selectedRoom === 'TODAS') return allTables;
    return allTables.filter((t) => t.roomName === selectedRoom);
  }, [allTables, selectedRoom]);

  // Click on table card
  const handleTableClick = (mesa: MesaSummaryDTO) => {
    if (mesa.status === 'DISPONIBLE') {
      setMesaToOpen(mesa);
    } else if (mesa.status === 'OCUPADA' || mesa.status === 'EN_CUENTA') {
      if (mesa.currentAccountId) {
        setActiveComandero({
          mesaId: mesa.id,
          cuentaId: mesa.currentAccountId,
        });
      }
    }
  };

  // Confirm table opening
  const handleConfirmOpenTable = async ({
    mesaId,
    guestCount,
    waiterUserId,
  }: {
    mesaId: string;
    guestCount: number;
    waiterUserId: string;
  }) => {
    setIsOpeningTable(true);
    const res = await bridge.salon.openMesa({ mesaId, guestCount, waiterUserId });
    setIsOpeningTable(false);

    if (res.ok) {
      setMesaToOpen(null);
      await fetchSalon();
      setActiveComandero({
        mesaId,
        cuentaId: res.data.id,
      });
    }
  };

  // If in Comandero mode, render ComanderoView
  if (activeComandero) {
    return (
      <ComanderoView
        mesaId={activeComandero.mesaId}
        cuentaId={activeComandero.cuentaId}
        allTables={allTables}
        onBackToSalon={() => {
          setActiveComandero(null);
          fetchSalon();
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-hidden select-none">
      {/* Top Header: Title, Metric Badges & Refresh */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-text tracking-tight">Salón & Mesas</h1>
          <p className="text-xs text-text-muted">Distribución de mesas y comandas activas</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge state="DISPONIBLE" label={`Libres: ${readModel?.availableTables ?? 0}`} />
          <Badge state="OCUPADA" label={`Ocupadas: ${readModel?.occupiedTables ?? 0}`} />
          <Badge state="EN_CUENTA" label={`En Cuenta: ${readModel?.inCheckTables ?? 0}`} />
          <Button
            type="button"
            intent="secondary"
            size="md"
            isLoading={isLoading}
            onClick={fetchSalon}
            aria-label="Actualizar estado de mesas"
          >
            ↻ Actualizar
          </Button>
        </div>
      </header>

      {/* Room Selection Tabs */}
      <nav
        aria-label="Zonas del restaurante"
        className="flex items-center gap-2 pb-3 overflow-x-auto shrink-0 scrollbar-none"
      >
        <button
          type="button"
          onClick={() => setSelectedRoom('TODAS')}
          className={`h-11 px-4 rounded-xl text-xs font-bold transition-all border-2 active:scale-95 ${
            selectedRoom === 'TODAS'
              ? 'bg-brand text-brand-contrast border-brand shadow-sm'
              : 'bg-surface text-text border-border-control hover:bg-surface-raised'
          }`}
        >
          Todas las Zonas ({allTables.length})
        </button>

        {roomNames.map((name) => {
          const isSelected = selectedRoom === name;
          const count = allTables.filter((t) => t.roomName === name).length;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedRoom(name)}
              className={`h-11 px-4 rounded-xl text-xs font-bold transition-all border-2 active:scale-95 ${
                isSelected
                  ? 'bg-brand text-brand-contrast border-brand shadow-sm'
                  : 'bg-surface text-text border-border-control hover:bg-surface-raised'
              }`}
            >
              {name} ({count})
            </button>
          );
        })}
      </nav>

      {/* Tables Grid or Empty State */}
      <main className="flex-1 overflow-y-auto pt-2 pr-1">
        {displayedTables.length === 0 ? (
          <EmptyState
            title="No hay mesas en esta zona"
            description="Seleccione otra zona del restaurante o configure las mesas en administración."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
            {displayedTables.map((mesa) => (
              <TableCard key={mesa.id} mesa={mesa} onClick={handleTableClick} />
            ))}
          </div>
        )}
      </main>

      {/* Open Table Modal */}
      <OpenTableDialog
        mesa={mesaToOpen}
        isOpen={mesaToOpen !== null}
        isLoading={isOpeningTable}
        onClose={() => setMesaToOpen(null)}
        onConfirm={handleConfirmOpenTable}
      />
    </div>
  );
}
