import * as React from 'react';
import { Button } from '../primitives/button.js';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly icon?: React.ReactNode;
  readonly className?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center p-8 text-center rounded-xl border-2 border-dashed border-border-control bg-surface-raised/50 select-none ${
        className ?? ''
      }`}
    >
      <div className="text-text-muted mb-3 flex items-center justify-center">
        {icon ?? (
          <svg
            className="w-12 h-12 stroke-current opacity-60"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
        )}
      </div>

      <h3 className="text-lg font-bold text-text mb-1">{title}</h3>
      {description ? (
        <p className="text-sm text-text-muted max-w-sm mb-4 font-normal">{description}</p>
      ) : null}

      {actionLabel && onAction ? (
        <Button intent="primary" size="md" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
