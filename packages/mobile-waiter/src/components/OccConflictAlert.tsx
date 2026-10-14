/**
 * TRIDENTPOS WP-025: OCC 409 Concurrency Conflict Resolution Alert
 * Notifies waitstaff when a dining table was modified concurrently by another terminal.
 */

import React from 'react';
import type { OccConflictResolution } from '../types.js';

export interface OccConflictAlertProps {
  conflict: OccConflictResolution;
  onReload: () => void;
  onReapply?: () => void;
  onCancel: () => void;
}

export function OccConflictAlert({
  conflict,
  onReload,
  onReapply,
  onCancel,
}: OccConflictAlertProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-neutral-900 border border-amber-600/80 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-neutral-800 pb-3">
          <div className="w-9 h-9 rounded-full bg-amber-950 border border-amber-600 flex items-center justify-center text-amber-400 font-bold text-lg">
            ⚠
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Conflicto de Concurrencia (OCC 409)</h3>
            <span className="text-[11px] text-neutral-400">Mesa modificada simultáneamente</span>
          </div>
        </div>

        <div className="space-y-2 text-xs text-neutral-300">
          <p>
            Otra terminal o mesero actualizó el estado de esta mesa mientras preparabas la orden.
          </p>
          <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 font-mono text-[11px] space-y-1">
            <div className="text-neutral-400">
              Versión esperada por este handheld: <span className="text-amber-400">v{conflict.expectedVersion}</span>
            </div>
            <div className="text-neutral-400">
              Versión actual en el Servidor: <span className="text-emerald-400">v{conflict.remoteVersion}</span>
            </div>
          </div>
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <button
            onClick={onReload}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-bold text-white shadow-md active:scale-95 transition-all"
          >
            Recargar Cambios de la Mesa
          </button>
          {onReapply && (
            <button
              onClick={onReapply}
              className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-xs font-semibold text-neutral-300 active:scale-95 transition-all"
            >
              Reaplicar Comanda sobre Nueva Versión
            </button>
          )}
          <button
            onClick={onCancel}
            className="w-full py-1.5 text-xs text-neutral-500 hover:text-neutral-400"
          >
            Descartar Orden
          </button>
        </div>
      </div>
    </div>
  );
}
