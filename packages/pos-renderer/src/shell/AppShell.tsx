import * as React from 'react';
import { StatusBar } from '@trident/ui';
import { useSession } from '../context/SessionContext.js';
import { useStation } from '../context/StationContext.js';
import { Button } from '@trident/ui';

export interface AppShellProps {
  readonly children: React.ReactNode;
  readonly onOpenDiagnostics?: () => void;
}

export function AppShell({ children, onOpenDiagnostics }: AppShellProps): React.JSX.Element {
  const { session, logout } = useSession();
  const { profile, connectivity, refreshConnectivity } = useStation();

  const [isRetryingEdge, setIsRetryingEdge] = React.useState(false);

  const handleRetryEdge = React.useCallback(async () => {
    setIsRetryingEdge(true);
    try {
      await refreshConnectivity();
    } finally {
      setIsRetryingEdge(false);
    }
  }, [refreshConnectivity]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg text-text select-none">
      {/* 48px Top Fixed Status Bar */}
      <StatusBar
        stationName={profile?.stationName ?? 'Terminal POS'}
        branchName={profile?.branchName}
        operatorName={session?.displayName}
        operatorRole={session?.roles[0]}
        connectivityStatus={connectivity}
        onLockOrLogout={session ? logout : undefined}
        onOpenDiagnostics={onOpenDiagnostics}
      />

      {/* LAN Network Degraded Banner (Informational / warning) */}
      {connectivity.lan === 'offline' && connectivity.edge === 'online' ? (
        <div
          role="status"
          className="bg-warning-soft text-warning-strong border-b border-warning px-4 py-2 text-sm font-semibold flex items-center justify-between"
        >
          <span>
            Sin conexión a la red de área local (LAN). Operando en modo autónomo local.
          </span>
          <Button intent="neutral" tone="outline" size="md" onClick={refreshConnectivity}>
            Reintentar red
          </Button>
        </div>
      ) : null}

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden relative">{children}</main>

      {/* Edge Offline Blocking Overlay (Decision FE-01 & Sec 8) */}
      {connectivity.edge === 'offline' ? (
        <div
          role="alert"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
        >
          <div className="max-w-md w-full p-8 rounded-xl border-2 border-danger bg-surface text-text flex flex-col items-center text-center gap-5 shadow-3 animate-in fade-in duration-base">
            <div className="h-16 w-16 rounded-full bg-danger-soft text-danger-strong flex items-center justify-center">
              <svg
                className="w-8 h-8 stroke-current"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-bold text-danger-strong">
                Terminal sin conexión con el servidor local
              </h2>
              <p className="text-sm font-medium text-text-muted">
                No es posible comunicar con el servicio de base de datos local (Fastify/SQLite). Las
                operaciones están suspendidas para proteger la integridad de los datos.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                intent="danger"
                size="lg"
                onClick={handleRetryEdge}
                isLoading={isRetryingEdge}
              >
                Reconectar servidor local
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
