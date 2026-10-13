import * as React from 'react';
import { Drawer, Button } from '@trident/ui';
import type { KdsTicketDTO } from '../../bridge/trident-bridge.js';

export interface KdsRecallDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly completedTickets: readonly KdsTicketDTO[];
  readonly onReopenTicket: (ticketId: string) => void;
  readonly isLoading?: boolean;
}

export function KdsRecallDrawer({
  isOpen,
  onClose,
  completedTickets,
  onReopenTicket,
  isLoading = false,
}: KdsRecallDrawerProps): React.JSX.Element {
  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Órdenes Despachadas (Recall)"
      width="420px"
    >
      <div className="flex flex-col h-full overflow-hidden p-4 select-none">
        <p className="text-xs text-text-muted mb-4">
          Historial de comandas despachadas en la estación. Puede reabrir un ticket si fue despachado por error.
        </p>

        {completedTickets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
            <div className="w-12 h-12 rounded-full bg-surface-raised flex items-center justify-center text-text-muted">
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-text">Sin órdenes en memoria de Recall</h3>
            <p className="text-xs text-text-muted max-w-[240px]">
              Los tickets despachados recientemente aparecerán aquí para consulta o reapertura.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 pr-1">
            {completedTickets.map((t) => {
              const prepMins = t.preparationTimeMinutes ?? 0;
              const formattedCompleted = t.completedAt
                ? new Date(t.completedAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })
                : 'Reciente';

              return (
                <div
                  key={t.id}
                  className="p-3.5 rounded-xl border border-border bg-surface-raised flex flex-col gap-2.5 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-extrabold text-base text-text">
                        #{t.folio}
                      </span>
                      <span className="text-xs font-bold text-brand">
                        {t.tableNumber}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-2xs font-bold bg-success-soft text-success-strong border border-success/30">
                        {prepMins} min prep
                      </span>
                      <span className="text-2xs font-mono text-text-muted">
                        {formattedCompleted}
                      </span>
                    </div>
                  </div>

                  {/* Items snapshot */}
                  <ul className="text-xs text-text-muted flex flex-col gap-1 pl-1 border-l-2 border-border">
                    {t.items.map((item) => (
                      <li key={item.id} className="truncate">
                        <strong className="text-text">
                          {String(item.quantity).replace(/\.0000$/, '')}x
                        </strong>{' '}
                        {item.productName}
                      </li>
                    ))}
                  </ul>

                  {/* Reopen Action */}
                  <div className="pt-2 border-t border-border flex justify-end">
                    <Button
                      intent="secondary"
                      size="md"
                      disabled={isLoading}
                      onClick={() => onReopenTicket(t.id)}
                      className="min-h-[44px] text-xs font-bold gap-1.5"
                    >
                      <svg
                        className="w-4 h-4 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      <span>Reabrir en Cocina (Deshacer Bump)</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-4 border-t border-border mt-auto">
          <Button intent="neutral" size="lg" onClick={onClose} className="w-full min-h-[48px]">
            Cerrar Recall
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
