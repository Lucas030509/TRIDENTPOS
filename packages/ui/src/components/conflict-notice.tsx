import * as React from 'react';
import { Button } from '../primitives/button.js';

export interface ConflictNoticeProps {
  readonly expectedVersion?: number;
  readonly serverVersion?: number;
  readonly message?: string;
  readonly onRefresh: () => void;
  readonly onDismiss?: () => void;
  readonly isRefreshing?: boolean;
  readonly className?: string;
}

export function ConflictNotice({
  expectedVersion,
  serverVersion,
  message = 'Los datos fueron modificados recientemente en otra terminal o estación. Para evitar sobrescribir información ajena, debe actualizar la vista antes de reintentar.',
  onRefresh,
  onDismiss,
  isRefreshing = false,
  className,
}: ConflictNoticeProps): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`p-4 rounded-lg border-2 border-warning bg-warning-soft text-warning-strong flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-1 ${
        className ?? ''
      }`}
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-6 h-6 shrink-0 mt-0.5 text-warning-strong"
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

        <div className="flex flex-col gap-1">
          <span className="font-bold text-md text-warning-strong">
            Conflicto de Concurrencia (Versión no sincronizada)
          </span>
          <p className="text-sm font-medium text-text-muted">{message}</p>
          {expectedVersion !== undefined && serverVersion !== undefined ? (
            <div className="text-xs font-mono [font-variant-numeric:tabular-nums] text-warning-strong mt-0.5">
              Versión enviada: {expectedVersion} | Versión remota: {serverVersion}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto justify-end">
        {onDismiss ? (
          <Button
            type="button"
            intent="neutral"
            tone="outline"
            size="md"
            onClick={onDismiss}
            disabled={isRefreshing}
          >
            Descartar
          </Button>
        ) : null}

        <Button
          type="button"
          intent="primary"
          size="md"
          onClick={onRefresh}
          isLoading={isRefreshing}
        >
          Recargar datos frescos
        </Button>
      </div>
    </div>
  );
}
