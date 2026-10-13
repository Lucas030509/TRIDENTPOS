import * as React from 'react';

export type ConnectivitySignal = 'online' | 'degraded' | 'offline';

export interface ConnectivityStatus {
  readonly edge: ConnectivitySignal; // Local Fastify reachable
  readonly lan: ConnectivitySignal; // LAN host reachable
  readonly cloud: ConnectivitySignal; // Cloud sync reachable
}

export interface ConnectivityIndicatorProps {
  readonly status: ConnectivityStatus;
  readonly className?: string;
  readonly onOpenDiagnostics?: () => void;
}

function getSignalColor(signal: ConnectivitySignal): string {
  switch (signal) {
    case 'online':
      return 'bg-success text-success-strong';
    case 'degraded':
      return 'bg-warning text-warning-strong';
    case 'offline':
    default:
      return 'bg-danger text-danger-strong';
  }
}

function getSignalLabel(signal: ConnectivitySignal): string {
  switch (signal) {
    case 'online':
      return 'Conectado';
    case 'degraded':
      return 'Degradado';
    case 'offline':
    default:
      return 'Desconectado';
  }
}

export function ConnectivityIndicator({
  status,
  className,
  onOpenDiagnostics,
}: ConnectivityIndicatorProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label={`Conectividad: Local ${getSignalLabel(status.edge)}, Red ${getSignalLabel(
        status.lan,
      )}, Nube ${getSignalLabel(status.cloud)}`}
      onClick={onOpenDiagnostics}
      className={`inline-flex items-center gap-3 px-3 py-1.5 rounded-md border border-border-control bg-surface cursor-pointer select-none hover:bg-surface-raised transition-colors focus:outline-none focus:ring-2 focus:ring-focus ${
        className ?? ''
      }`}
      tabIndex={onOpenDiagnostics ? 0 : undefined}
    >
      {/* Edge Local Host Signal (Critical) */}
      <div className="flex items-center gap-1.5" title={`Servidor Local (Edge): ${getSignalLabel(status.edge)}`}>
        <span
          className={`h-2.5 w-2.5 rounded-full ${getSignalColor(status.edge)}`}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-text uppercase">Local</span>
      </div>

      <span className="text-border" aria-hidden="true">|</span>

      {/* LAN Network Signal */}
      <div className="flex items-center gap-1.5" title={`Red Local (LAN): ${getSignalLabel(status.lan)}`}>
        <span
          className={`h-2.5 w-2.5 rounded-full ${getSignalColor(status.lan)}`}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-text uppercase">LAN</span>
      </div>

      <span className="text-border" aria-hidden="true">|</span>

      {/* Cloud Sync Signal */}
      <div className="flex items-center gap-1.5" title={`Sincronización Nube: ${getSignalLabel(status.cloud)}`}>
        <span
          className={`h-2.5 w-2.5 rounded-full ${getSignalColor(status.cloud)}`}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-text-muted uppercase">Nube</span>
      </div>
    </div>
  );
}
