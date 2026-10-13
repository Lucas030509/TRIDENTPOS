import * as React from 'react';
import { Button, IconButton } from '@trident/ui';
import type { KdsEstacionDTO } from '../../bridge/trident-bridge.js';

export interface KdsHeaderProps {
  readonly estaciones: readonly KdsEstacionDTO[];
  readonly activeEstacionId: string;
  readonly onSelectEstacion: (id: string) => void;
  readonly ticketCounts: {
    readonly total: number;
    readonly pending: number;
    readonly inProgress: number;
    readonly overdue: number;
  };
  readonly printerStatus?: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  readonly isConnected?: boolean;
  readonly onOpenRecall: () => void;
  readonly onOpenHelp: () => void;
  readonly completedCount?: number;
}

export function KdsHeader({
  estaciones,
  activeEstacionId,
  onSelectEstacion,
  ticketCounts,
  printerStatus = 'ONLINE',
  isConnected = true,
  onOpenRecall,
  onOpenHelp,
  completedCount = 0,
}: KdsHeaderProps): React.JSX.Element {
  // Digital clock
  const [currentTime, setCurrentTime] = React.useState<string>(() => {
    return new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  });

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeEstacion = estaciones.find((e) => e.id === activeEstacionId);

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-surface border-b-2 border-border-control shrink-0 shadow-sm select-none">
      {/* Left: Station Identity & Switcher */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-on-brand shadow-sm">
            <svg
              className="w-6 h-6 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 11h.01" />
              <path d="M11 15h.01" />
              <path d="M16.5 4H7.5a2.5 2.5 0 0 0-2.5 2.5v11A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 16.5 4Z" />
              <path d="M12 2v2" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-text">
                KDS Cocina
              </h1>
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-brand-soft text-brand-strong border border-brand/30">
                {activeEstacion?.stationType === 'BARRA' ? 'Barra' : 'Cocina'}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Estación activa: <strong className="text-text">{activeEstacion?.name ?? activeEstacionId}</strong>
            </p>
          </div>
        </div>

        {/* Station Tabs */}
        {estaciones.length > 1 && (
          <nav aria-label="Estaciones de cocina" className="flex items-center gap-1.5 ml-2 bg-surface-raised p-1 rounded-xl border border-border">
            {estaciones.map((est) => {
              const isActive = est.id === activeEstacionId;
              return (
                <button
                  key={est.id}
                  type="button"
                  onClick={() => onSelectEstacion(est.id)}
                  aria-pressed={isActive}
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
                    isActive
                      ? 'bg-brand text-on-brand shadow-sm'
                      : 'text-text-muted hover:text-text hover:bg-surface'
                  }`}
                >
                  {est.name}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Center: Operational Metrics Pills */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-raised border border-border">
          <span className="text-xs text-text-muted font-medium">En cola:</span>
          <span className="text-sm font-extrabold text-text">{ticketCounts.total}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warning-soft border border-warning/40">
          <span className="text-xs text-warning-strong font-medium">Pendientes:</span>
          <span className="text-sm font-extrabold text-warning-strong">{ticketCounts.pending}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-info-soft border border-info/40">
          <span className="text-xs text-info-strong font-medium">En Preparación:</span>
          <span className="text-sm font-extrabold text-info-strong">{ticketCounts.inProgress}</span>
        </div>

        {ticketCounts.overdue > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-danger-soft border-2 border-danger animate-pulse motion-reduce:animate-none">
            <svg
              className="w-4 h-4 text-danger-strong shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-xs font-extrabold text-danger-strong uppercase tracking-wide">
              Atrasados: {ticketCounts.overdue}
            </span>
          </div>
        )}
      </div>

      {/* Right: Telemetry, Printer, Clock & Actions */}
      <div className="flex items-center gap-3">
        {/* Network / Edge Connectivity */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
            isConnected
              ? 'bg-success-soft text-success-strong border-success/30'
              : 'bg-danger-soft text-danger-strong border-danger/40 animate-pulse'
          }`}
          title={isConnected ? 'Conectado al Edge Host LAN' : 'Reconectando con el Edge Host...'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-success-strong' : 'bg-danger-strong'
            }`}
            aria-hidden="true"
          />
          <span>{isConnected ? 'LAN OK' : 'Reconectando'}</span>
        </div>

        {/* Printer Status */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
            printerStatus === 'ONLINE'
              ? 'bg-surface-raised text-text-muted border-border'
              : 'bg-warning-soft text-warning-strong border-warning/40'
          }`}
          title={`Estado de impresora de comandas: ${printerStatus}`}
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect width="12" height="8" x="6" y="14" />
          </svg>
          <span>{printerStatus === 'ONLINE' ? 'Impresora OK' : 'Impresora Alerta'}</span>
        </div>

        {/* Real-time Clock */}
        <div
          className="px-3 py-1 bg-surface-raised border border-border rounded-lg text-sm font-mono font-bold text-text tabular-nums"
          aria-label={`Hora actual: ${currentTime}`}
        >
          {currentTime}
        </div>

        {/* Recall Button */}
        <Button
          intent="secondary"
          size="md"
          onClick={onOpenRecall}
          className="min-h-[48px] px-3.5 gap-2 relative"
          aria-label="Abrir historial de órdenes despachadas (Recall)"
        >
          <svg
            className="w-4 h-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
          <span>Recall</span>
          {completedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-xs font-extrabold bg-brand text-on-brand">
              {completedCount}
            </span>
          )}
          <span className="hidden xl:inline text-xs opacity-75 font-mono ml-0.5">[R]</span>
        </Button>

        {/* Shortcut Help Button */}
        <IconButton
          aria-label="Guía de atajos de teclado y Bump Bar"
          onClick={onOpenHelp}
          intent="neutral"
          tone="soft"
          size="md"
        >
          <svg
            className="w-5 h-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </IconButton>
      </div>
    </header>
  );
}
