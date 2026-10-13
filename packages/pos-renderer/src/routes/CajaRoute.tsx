import * as React from 'react';
import { Button, EmptyState } from '@trident/ui';
import {
  getTridentBridge,
  type CashShiftStatusDTO,
  type CuentaDetalleDTO,
  type CorteCajaDTO,
  type SubmitTenderRequestDTO,
  type TenderResultDTO,
} from '../bridge/trident-bridge.js';
import {
  CajaHeader,
  CuentasPorCobrarList,
  TenderPaymentView,
  ArqueoCiegoModal,
  MovimientoCajaModal,
  AbrirTurnoModal,
  CorteXModal,
  CobroExitosoModal,
} from '../features/caja/index.js';

export function CajaRoute(): React.JSX.Element {
  const bridge = getTridentBridge();

  const [shift, setShift] = React.useState<CashShiftStatusDTO | null>(null);
  const [cuentas, setCuentas] = React.useState<readonly CuentaDetalleDTO[]>([]);
  const [selectedCuenta, setSelectedCuenta] = React.useState<CuentaDetalleDTO | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  // Modals state
  const [isAbrirTurnoOpen, setIsAbrirTurnoOpen] = React.useState<boolean>(false);
  const [isMovimientoOpen, setIsMovimientoOpen] = React.useState<boolean>(false);
  const [isArqueoOpen, setIsArqueoOpen] = React.useState<boolean>(false);
  const [isCorteXOpen, setIsCorteXOpen] = React.useState<boolean>(false);
  const [activeCorteX, setActiveCorteX] = React.useState<CorteCajaDTO | null>(null);
  const [cobroExitoso, setCobroExitoso] = React.useState<{
    result: TenderResultDTO;
    label: string;
  } | null>(null);

  // Fetch shift and accounts
  const refreshData = React.useCallback(async () => {
    setIsLoading(true);
    const [shiftRes, cuentasRes] = await Promise.all([
      bridge.caja.getShiftStatus(),
      bridge.caja.getCuentasPorCobrar(),
    ]);

    if (shiftRes.ok) {
      setShift(shiftRes.data);
    }
    if (cuentasRes.ok) {
      setCuentas(cuentasRes.data);
      // Auto-update selected account if its details changed
      if (selectedCuenta) {
        const updated = cuentasRes.data.find((c) => c.id === selectedCuenta.id);
        if (updated) {
          setSelectedCuenta(updated);
        } else {
          setSelectedCuenta(null);
        }
      }
    }
    setIsLoading(false);
  }, [bridge, selectedCuenta]);

  // Initial load
  React.useEffect(() => {
    refreshData();
  }, []);

  // Event Subscription for Real-time LAN domain events
  React.useEffect(() => {
    const unsubscribe = bridge.events.subscribe((event) => {
      switch (event.eventType) {
        case 'TurnoCajaAbierto':
        case 'TurnoCajaCerrado':
        case 'MovimientoCajaRegistrado':
        case 'ArqueoCiegoRegistrado':
        case 'CorteCajaGenerado':
        case 'PagoRegistrado':
        case 'CuentaPagada':
        case 'CuentaAbierta':
        case 'PartidaAgregada':
        case 'connectivity.restored': {
          refreshData();
          break;
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, refreshData]);

  // Handle open shift
  const handleOpenShift = async (params: {
    startingCash: string;
    cashierUserId: string;
    cashierPin: string;
    clientOpId: string;
  }) => {
    const res = await bridge.caja.openShift(params);
    if (res.ok) {
      setShift(res.data);
      await refreshData();
      return res.data;
    }
    return null;
  };

  // Handle movement
  const handleRegisterMovement = async (params: {
    movementType: 'INGRESO' | 'EGRESO';
    amount: string;
    reason: string;
    operatorPin: string;
    clientOpId: string;
  }) => {
    if (!shift?.turnoCajaId) return null;
    const res = await bridge.caja.registerMovement({
      turnoCajaId: shift.turnoCajaId,
      operatorUserId: shift.cashierUserId ?? 'usr-1',
      ...params,
    });
    if (res.ok) {
      await refreshData();
      return res.data;
    }
    return null;
  };

  // Handle Corte X
  const handleCorteXClick = async () => {
    if (!shift?.turnoCajaId) return;
    const res = await bridge.caja.generarCorteX({
      shiftId: shift.turnoCajaId,
      operatorUserId: shift.cashierUserId ?? 'usr-1',
      operatorPin: '1234',
      clientOpId: crypto.randomUUID(),
    });
    if (res.ok) {
      setActiveCorteX(res.data);
      setIsCorteXOpen(true);
    }
  };

  // Handle Arqueo Ciego
  const handleRealizarArqueo = async (params: {
    declaredCash: string;
    operatorPin: string;
    expectedVersion: number;
    clientOpId: string;
  }) => {
    if (!shift?.turnoCajaId) return null;
    const res = await bridge.caja.realizarArqueoCiego({
      shiftId: shift.turnoCajaId,
      performedByUserId: shift.cashierUserId ?? 'usr-1',
      performedByPin: params.operatorPin,
      declaredCash: params.declaredCash,
      expectedVersion: params.expectedVersion,
      clientOpId: params.clientOpId,
    });
    if (res.ok) {
      await refreshData();
      return res.data;
    }
    return null;
  };

  // Handle Corte Z
  const handleGenerarCorteZ = async (params: {
    expectedVersion: number;
    operatorPin: string;
    clientOpId: string;
  }) => {
    if (!shift?.turnoCajaId) return false;
    const res = await bridge.caja.generarCorteZ({
      shiftId: shift.turnoCajaId,
      closedByUserId: shift.cashierUserId ?? 'usr-1',
      closedByPin: params.operatorPin,
      expectedVersion: params.expectedVersion,
      clientOpId: params.clientOpId,
    });
    if (res.ok) {
      await refreshData();
      return true;
    }
    return false;
  };

  // Handle Submit Tender
  const handleSubmitTender = async (request: SubmitTenderRequestDTO) => {
    const res = await bridge.caja.submitTender(request);
    if (res.ok) {
      const tender = res.data;
      const accountLabel = selectedCuenta
        ? selectedCuenta.mesaId
          ? `Mesa ${selectedCuenta.tableNumber ?? '?'}`
          : selectedCuenta.tableNumber ?? 'Mostrador'
        : 'Cuenta';

      setCobroExitoso({ result: tender, label: accountLabel });
      setSelectedCuenta(null);
      await refreshData();
      return tender;
    }
    return null;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-4 sm:p-6 overflow-hidden gap-4">
      {/* 1. Header */}
      <CajaHeader
        shift={shift}
        onOpenShiftClick={() => setIsAbrirTurnoOpen(true)}
        onMovementClick={() => setIsMovimientoOpen(true)}
        onCorteXClick={handleCorteXClick}
        onArqueoClick={() => setIsArqueoOpen(true)}
      />

      {/* 2. Main Work Area: Accounts List + Tender Payment Panel */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden min-h-0">
        {/* Left Side: Pending Accounts Tray */}
        <div className="w-full md:w-[360px] lg:w-[400px] h-full shrink-0 flex flex-col min-h-0">
          <CuentasPorCobrarList
            cuentas={cuentas}
            selectedCuentaId={selectedCuenta?.id ?? null}
            onSelectCuenta={(c) => setSelectedCuenta(c)}
            isLoading={isLoading}
            className="h-full"
          />
        </div>

        {/* Right Side: Active Payment View or Selection Prompt */}
        <main className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
          {selectedCuenta && shift?.status === 'ABIERTO' ? (
            <TenderPaymentView
              key={selectedCuenta.id}
              cuenta={selectedCuenta}
              turnoCajaId={shift.turnoCajaId ?? 'turno-1'}
              currentUserId={shift.cashierUserId ?? 'usr-1'}
              onSubmitTender={handleSubmitTender}
              onClose={() => setSelectedCuenta(null)}
              className="h-full"
            />
          ) : shift?.status !== 'ABIERTO' ? (
            <div className="h-full bg-surface rounded-xl border-2 border-border-control p-8 flex flex-col items-center justify-center text-center gap-4 shadow-1">
              <span className="text-5xl">🔒</span>
              <h2 className="text-xl font-extrabold text-text">Turno de Caja Cerrado</h2>
              <p className="text-sm text-text-muted max-w-md">
                Para recibir pagos, capturar propinas y emitir comprobantes de venta, debe abrir el turno de caja con su fondo inicial.
              </p>
              <Button
                intent="primary"
                tone="solid"
                size="lg"
                onClick={() => setIsAbrirTurnoOpen(true)}
                className="min-h-[48px] px-6 font-bold"
              >
                Abrir Turno de Caja Ahora
              </Button>
            </div>
          ) : (
            <div className="h-full bg-surface rounded-xl border-2 border-border-control p-8 flex flex-col items-center justify-center text-center gap-4 shadow-1">
              <EmptyState
                title="Seleccione una cuenta para cobrar"
                description="Elija una cuenta pendiente del panel izquierdo (Salón, Mostrador o Delivery) para abrir la pantalla táctil de cobro y liquidación."
                className="max-w-md"
              />
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <AbrirTurnoModal
        isOpen={isAbrirTurnoOpen}
        onOpenShift={handleOpenShift}
        onClose={() => setIsAbrirTurnoOpen(false)}
      />

      <MovimientoCajaModal
        isOpen={isMovimientoOpen}
        turnoCajaId={shift?.turnoCajaId ?? 'turno-1'}
        currentUserId={shift?.cashierUserId ?? 'usr-1'}
        onRegisterMovement={handleRegisterMovement}
        onClose={() => setIsMovimientoOpen(false)}
      />

      <ArqueoCiegoModal
        isOpen={isArqueoOpen}
        shift={shift}
        currentUserId={shift?.cashierUserId ?? 'usr-1'}
        onRealizarArqueo={handleRealizarArqueo}
        onGenerarCorteZ={handleGenerarCorteZ}
        onClose={() => setIsArqueoOpen(false)}
      />

      <CorteXModal
        isOpen={isCorteXOpen}
        corte={activeCorteX}
        onClose={() => setIsCorteXOpen(false)}
      />

      <CobroExitosoModal
        isOpen={cobroExitoso !== null}
        result={cobroExitoso?.result ?? null}
        tableOrAccountLabel={cobroExitoso?.label ?? ''}
        onDismiss={() => setCobroExitoso(null)}
      />
    </div>
  );
}
