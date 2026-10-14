/**
 * TRIDENTPOS WP-025: ADR-005 Network Health & Dead-Zone Status Banner
 * Handheld status header displaying real-time LAN connectivity and pending offline comanda counts.
 */

import React from 'react';
import type { NetworkState } from '../types.js';

export interface OfflineIndicatorBannerProps {
  networkState: NetworkState;
  pendingCount: number;
  onRetrySync?: () => void;
}

export function OfflineIndicatorBanner({
  networkState,
  pendingCount,
  onRetrySync,
}: OfflineIndicatorBannerProps): React.JSX.Element | null {
  if (networkState === 'ONLINE' && pendingCount === 0) {
    return null;
  }

  const isDeadZone = networkState === 'DEAD_ZONE';
  const isOffline = networkState === 'OFFLINE';

  return (
    <div
      className={`px-4 py-2 flex items-center justify-between text-xs font-semibold select-none transition-colors ${
        isDeadZone || isOffline
          ? 'bg-amber-600 text-amber-950 shadow-md'
          : 'bg-blue-600 text-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-current animate-ping" />
        <span>
          {isDeadZone
            ? 'Zona muerta Wi-Fi detectada'
            : isOffline
              ? 'Sin conexión con Host Local'
              : 'Sincronizando con Servidor...'}
        </span>
        {pendingCount > 0 && (
          <span className="bg-black/30 px-2 py-0.5 rounded-full font-mono text-[11px] font-bold">
            {pendingCount} comanda{pendingCount > 1 ? 's' : ''} en cola
          </span>
        )}
      </div>

      {onRetrySync && (
        <button
          onClick={onRetrySync}
          className="bg-black/20 hover:bg-black/30 px-2.5 py-1 rounded text-[11px] font-bold"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
