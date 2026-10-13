import * as React from 'react';
import { useStation } from '../context/StationContext.js';
import { StationMode } from '../bridge/trident-bridge.js';
import { EmptyState } from '@trident/ui';

export interface StationGuardProps {
  readonly requiredModes: readonly StationMode[];
  readonly children: React.ReactNode;
  readonly fallbackRouteTitle?: string;
}

export function StationGuard({
  requiredModes,
  children,
  fallbackRouteTitle = 'Módulo no disponible en esta terminal',
}: StationGuardProps): React.JSX.Element {
  const { mode } = useStation();

  // 'POS+CAJA' mode is allowed on both POS and CAJA routes
  const isAllowed =
    requiredModes.includes(mode) ||
    (mode === 'POS+CAJA' && (requiredModes.includes('POS') || requiredModes.includes('CAJA')));

  if (!isAllowed) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          title={fallbackRouteTitle}
          description={`Esta terminal está enrolada en modo ${mode}. Para acceder a este módulo, configure el perfil de estación o acceda desde una terminal autorizada.`}
          icon={
            <svg
              className="w-12 h-12 stroke-current opacity-60 text-warning-strong"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
