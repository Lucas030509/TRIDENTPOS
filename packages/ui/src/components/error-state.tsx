import * as React from 'react';
import { Button } from '../primitives/button.js';

export interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
  readonly isRetrying?: boolean;
  readonly className?: string;
}

export function ErrorState({
  title = 'Ocurrió un problema',
  message,
  onRetry,
  isRetrying = false,
  className,
}: ErrorStateProps): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex flex-col items-center justify-center p-8 text-center rounded-xl border-2 border-danger bg-danger-soft text-danger-strong ${
        className ?? ''
      }`}
    >
      <div className="mb-3 text-danger-strong">
        <svg
          className="w-12 h-12 stroke-current"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h3 className="text-lg font-bold text-danger-strong mb-1">{title}</h3>
      <p className="text-sm font-medium text-text max-w-md mb-4">{message}</p>

      {onRetry ? (
        <Button
          intent="danger"
          size="md"
          onClick={onRetry}
          isLoading={isRetrying}
          className="min-w-[140px]"
        >
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
