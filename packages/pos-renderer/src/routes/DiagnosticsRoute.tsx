import * as React from 'react';
import { Badge, Button } from '@trident/ui';
import { useStation } from '../context/StationContext.js';

export function DiagnosticsRoute(): React.JSX.Element {
  const { profile, connectivity, refreshConnectivity } = useStation();

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Diagnóstico del Sistema</h1>
          <p className="text-sm text-text-muted">Estado operativo de la terminal y conectividad</p>
        </div>

        <Button intent="neutral" tone="outline" size="md" onClick={refreshConnectivity}>
          Actualizar Diagnóstico
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        {/* Terminal Enrollment Card */}
        <div className="p-6 bg-surface rounded-xl border-2 border-border-control shadow-1 flex flex-col gap-3">
          <h2 className="text-lg font-bold text-text">Perfil de la Terminal</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-text-muted">ID Terminal:</span>
            <span className="font-mono font-semibold text-text">{profile?.stationId ?? '—'}</span>
            <span className="text-text-muted">Nombre:</span>
            <span className="font-semibold text-text">{profile?.stationName ?? '—'}</span>
            <span className="text-text-muted">Sucursal:</span>
            <span className="font-semibold text-text">{profile?.branchName ?? '—'}</span>
            <span className="text-text-muted">Modo Asignado:</span>
            <span className="font-semibold text-brand">{profile?.mode ?? '—'}</span>
          </div>
        </div>

        {/* Connectivity Status Card */}
        <div className="p-6 bg-surface rounded-xl border-2 border-border-control shadow-1 flex flex-col gap-3">
          <h2 className="text-lg font-bold text-text">Conectividad</h2>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">Servidor Local (Fastify / SQLite)</span>
              <Badge
                state={connectivity.edge === 'online' ? 'LISTO' : 'RECHAZADO'}
                label={connectivity.edge === 'online' ? 'En línea' : 'Desconectado'}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">Red de Área Local (LAN)</span>
              <Badge
                state={connectivity.lan === 'online' ? 'LISTO' : 'RECHAZADO'}
                label={connectivity.lan === 'online' ? 'En línea' : 'Desconectado'}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">Sincronización Nube</span>
              <Badge
                state={connectivity.cloud === 'online' ? 'LISTO' : 'POR_VENCER'}
                label={connectivity.cloud === 'online' ? 'Sincronizado' : 'Pendiente'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
