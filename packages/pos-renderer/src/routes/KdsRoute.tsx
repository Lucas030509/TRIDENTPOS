import * as React from 'react';
import { KdsBoard } from '../features/kds/index.js';

export interface KdsRouteProps {
  readonly estacionId?: string;
}

export function KdsRoute({ estacionId = 'cocina-1' }: KdsRouteProps): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden [data-theme='dark']">
      <KdsBoard
        initialEstacionId={estacionId}
        onEstacionChange={(newEstacionId) => {
          if (typeof window !== 'undefined' && window.location) {
            window.location.hash = `/kds/${newEstacionId}`;
          }
        }}
      />
    </div>
  );
}
