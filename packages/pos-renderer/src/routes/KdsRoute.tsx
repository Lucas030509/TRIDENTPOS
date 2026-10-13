import * as React from 'react';
import { Badge, Button, Timer } from '@trident/ui';
import { getTridentBridge, KdsTicketDTO } from '../bridge/trident-bridge.js';

export interface KdsRouteProps {
  readonly estacionId?: string;
}

export function KdsRoute({ estacionId = 'cocina-1' }: KdsRouteProps): React.JSX.Element {
  const bridge = getTridentBridge();
  const [tickets, setTickets] = React.useState<readonly KdsTicketDTO[]>([]);

  React.useEffect(() => {
    let mounted = true;
    bridge.kds.getTickets(estacionId).then((res) => {
      if (mounted && res.ok) {
        setTickets(res.data);
      }
    });
    return () => {
      mounted = false;
    };
  }, [bridge, estacionId]);

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-hidden [data-theme='dark']">
      <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">KDS Cocina — Estación: {estacionId}</h1>
          <p className="text-sm text-text-muted">Tickets de preparación en tiempo real</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge state="EN_TIEMPO" label="En tiempo" />
          <Badge state="POR_VENCER" label="Por vencer" />
          <Badge state="ATRASADO" label="Atrasado" />
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <svg
              className="w-16 h-16 stroke-current text-success-strong"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <h2 className="text-xl font-bold text-text">Estación sin tickets pendientes</h2>
            <p className="text-sm text-text-muted">Todos los pedidos han sido despachados.</p>
          </div>
        ) : (
          <div className="flex gap-4 h-full">
            {tickets.map((t) => (
              <div
                key={t.id}
                className="w-[320px] shrink-0 bg-surface rounded-xl border-2 border-border-control p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                    <span className="font-extrabold text-lg text-text">Ticket #{t.folio}</span>
                    <Timer startedAt={t.createdAt} targetSeconds={t.targetSeconds} />
                  </div>
                  <div className="text-sm font-semibold text-brand mb-3">Mesa {t.tableNumber}</div>
                  <ul className="flex flex-col gap-2">
                    {t.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between text-sm">
                        <span>
                          {item.quantity}x {item.productName}
                        </span>
                        <Badge state={item.status === 'LISTO' ? 'LISTO' : 'EN_TIEMPO'} size="sm" />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-3 border-t border-border mt-3">
                  <Button intent="primary" size="xl" className="w-full">
                    Despachar Ticket
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
