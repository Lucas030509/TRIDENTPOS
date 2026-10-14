/**
 * TRIDENTPOS WP-024: Optimistic Notice & Toast Feedback Component
 * Informs user of pending background sync and alerts on rollback when errors occur.
 */

import React from 'react';

export interface OptimisticNoticeProps {
  status: 'PENDING' | 'COMMITTED' | 'ROLLED_BACK';
  message: string;
  onDismiss?: () => void;
}

export function OptimisticNotice({
  status,
  message,
  onDismiss,
}: OptimisticNoticeProps): React.JSX.Element {
  const getStyles = () => {
    switch (status) {
      case 'PENDING':
        return 'bg-amber-950/80 border-amber-500/50 text-amber-200';
      case 'COMMITTED':
        return 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200';
      case 'ROLLED_BACK':
        return 'bg-red-950/80 border-red-500/50 text-red-200';
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'PENDING':
        return '⏳';
      case 'COMMITTED':
        return '✓';
      case 'ROLLED_BACK':
        return '⚠';
    }
  };

  return (
    <div
      role="alert"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur text-xs font-medium ${getStyles()}`}
    >
      <span>{getIcon()}</span>
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-2 hover:opacity-75 focus:outline-none text-neutral-400 hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  );
}
