import * as React from 'react';
import { ConnectivityIndicator, ConnectivityStatus } from './connectivity-indicator.js';

export interface StatusBarProps {
  readonly stationName: string;
  readonly branchName?: string;
  readonly operatorName?: string;
  readonly operatorRole?: string;
  readonly connectivityStatus: ConnectivityStatus;
  readonly onLockOrLogout?: () => void;
  readonly onOpenDiagnostics?: () => void;
  readonly className?: string;
}

export function StatusBar({
  stationName,
  branchName,
  operatorName,
  operatorRole,
  connectivityStatus,
  onLockOrLogout,
  onOpenDiagnostics,
  className,
}: StatusBarProps): React.JSX.Element {
  const [timeStr, setTimeStr] = React.useState<string>(() => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  });

  React.useEffect(() => {
    const interval = setInterval(() => {
      const d = new Date();
      setTimeStr(
        `${d.getHours().toString().padStart(2, '0')}:${d
          .getMinutes()
          .toString()
          .padStart(2, '0')}`,
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      role="banner"
      className={`h-12 min-h-[48px] w-full bg-surface border-b border-border px-4 flex items-center justify-between select-none shadow-1 z-30 shrink-0 ${
        className ?? ''
      }`}
    >
      {/* Station Profile & Branch */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-brand tracking-wide text-md">TRIDENTPOS</span>
          <span className="text-border">/</span>
          <span className="text-sm font-semibold text-text">{stationName}</span>
          {branchName ? (
            <span className="text-xs text-text-muted hidden sm:inline">({branchName})</span>
          ) : null}
        </div>
      </div>

      {/* Connectivity & Time & Operator */}
      <div className="flex items-center gap-4">
        <ConnectivityIndicator
          status={connectivityStatus}
          onOpenDiagnostics={onOpenDiagnostics}
        />

        {/* Real-time 24h Clock */}
        <span
          className="text-md font-bold font-mono [font-variant-numeric:tabular-nums] text-text"
          aria-label={`Hora actual: ${timeStr}`}
        >
          {timeStr}
        </span>

        {/* Active Session & Lock/Logout Action */}
        {operatorName ? (
          <div className="flex items-center gap-2 pl-2 border-l border-border">
            <div className="flex flex-col text-right">
              <span className="text-xs font-bold text-text truncate max-w-[120px]">
                {operatorName}
              </span>
              {operatorRole ? (
                <span className="text-[10px] text-text-muted uppercase font-medium">
                  {operatorRole}
                </span>
              ) : null}
            </div>

            {onLockOrLogout ? (
              <button
                type="button"
                onClick={onLockOrLogout}
                aria-label="Cerrar o bloquear sesión"
                title="Cerrar o bloquear sesión"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-surface-raised border border-border-control text-text-muted hover:text-danger hover:border-danger hover:bg-danger-soft transition-colors focus:outline-none focus:ring-2 focus:ring-danger"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
