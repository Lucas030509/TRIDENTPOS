import * as React from 'react';
import { Badge, Button, Timer } from '@trident/ui';
import type { KdsTicketDTO } from '../../bridge/trident-bridge.js';

export interface KdsTicketCardProps {
  readonly ticket: KdsTicketDTO;
  readonly shortcutNumber?: number; // 1 to 8
  readonly onStartPreparation: (ticketId: string) => void;
  readonly onBumpTicket: (ticketId: string) => void;
  readonly onToggleItemStatus?: (ticketId: string, itemId: string, newStatus: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO') => void;
  readonly isActionLoading?: boolean;
}

export function KdsTicketCard({
  ticket,
  shortcutNumber,
  onStartPreparation,
  onBumpTicket,
  onToggleItemStatus,
  isActionLoading = false,
}: KdsTicketCardProps): React.JSX.Element {
  const isPending = ticket.status === 'PENDIENTE';
  const isInPrep = ticket.status === 'EN_PREPARACION';

  // Compute SLA state based on creation time and target
  const startMs = React.useMemo(() => new Date(ticket.createdAt).getTime(), [ticket.createdAt]);
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(() => {
    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  });

  React.useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [startMs]);

  const targetSecs = ticket.targetSeconds || 900;
  const isOverdue = elapsedSeconds >= targetSecs;
  const isWarning = !isOverdue && elapsedSeconds >= targetSecs * 0.75;

  const slaState = isOverdue ? 'ATRASADO' : isWarning ? 'POR_VENCER' : 'EN_TIEMPO';

  // Card border styling according to urgency and SLA
  const cardBorderClass = isOverdue
    ? 'border-danger ring-2 ring-danger/40 bg-surface shadow-md'
    : ticket.urgencyLevel === 'URGENTE'
      ? 'border-danger/80 bg-surface shadow-md'
      : ticket.urgencyLevel === 'ALTA'
        ? 'border-warning/80 bg-surface'
        : isInPrep
          ? 'border-brand/70 bg-surface'
          : 'border-border-control bg-surface';

  const cardHeaderBg = isOverdue
    ? 'bg-danger-soft border-b border-danger/30 text-danger-strong'
    : ticket.urgencyLevel === 'URGENTE'
      ? 'bg-danger-soft border-b border-danger/20 text-danger-strong'
      : ticket.urgencyLevel === 'ALTA'
        ? 'bg-warning-soft border-b border-warning/30 text-warning-strong'
        : isInPrep
          ? 'bg-brand-soft border-b border-brand/20 text-brand-strong'
          : 'bg-surface-raised border-b border-border text-text';

  const allItemsReady = ticket.items.length > 0 && ticket.items.every((it) => it.status === 'LISTO');

  return (
    <article
      aria-label={`Ticket ${ticket.folio}, ${ticket.tableNumber}, estado ${ticket.status}, SLA ${slaState}`}
      className={`w-[340px] shrink-0 rounded-2xl border-2 flex flex-col justify-between overflow-hidden select-none transition-all ${cardBorderClass}`}
    >
      {/* Ticket Header */}
      <div>
        <div className={`p-3.5 flex items-center justify-between gap-2 ${cardHeaderBg}`}>
          <div className="flex items-center gap-2">
            {shortcutNumber !== undefined && (
              <span
                className="w-7 h-7 rounded-lg bg-surface border border-border-control text-text font-mono font-extrabold text-sm flex items-center justify-center shadow-xs"
                title={`Atajo Bump Bar: tecla ${shortcutNumber}`}
              >
                {shortcutNumber}
              </span>
            )}
            <div>
              <span className="font-mono font-extrabold text-lg tracking-tight">
                #{ticket.folio}
              </span>
            </div>
          </div>

          {/* Urgency & SLA Badges */}
          <div className="flex items-center gap-1.5">
            {ticket.urgencyLevel && ticket.urgencyLevel !== 'NORMAL' && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-extrabold uppercase tracking-wide flex items-center gap-1 ${
                  ticket.urgencyLevel === 'URGENTE'
                    ? 'bg-danger text-on-brand animate-pulse motion-reduce:animate-none'
                    : 'bg-warning text-text font-bold'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                </svg>
                {ticket.urgencyLevel}
              </span>
            )}
            <Badge state={slaState} size="sm" showIcon />
          </div>
        </div>

        {/* Subheader: Table, Waiter, Timer */}
        <div className="px-4 py-2.5 bg-surface-raised/60 border-b border-border flex items-center justify-between text-xs">
          <div className="flex flex-col">
            <span className="font-extrabold text-sm text-text">
              {ticket.tableNumber}
            </span>
            <span className="text-text-muted text-xs truncate max-w-[160px]">
              {ticket.waiterName ? `Mesero: ${ticket.waiterName}` : 'Mostrador'}
            </span>
          </div>

          {/* Timer Display */}
          <div className="text-right flex flex-col items-end">
            <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-text">
              <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <Timer
                startedAt={ticket.createdAt}
                targetSeconds={targetSecs}
                size="sm"
              />
            </div>
            <span className="text-3xs text-text-muted">
              Objetivo: {Math.round(targetSecs / 60)} min
            </span>
          </div>
        </div>

        {/* Ticket Items List */}
        <div className="p-4 flex flex-col gap-3 max-h-[380px] overflow-y-auto">
          {ticket.items.map((item) => {
            const isItemReady = item.status === 'LISTO';
            const isItemInPrep = item.status === 'EN_PREPARACION';

            const handleToggle = () => {
              if (!onToggleItemStatus) return;
              const nextStatus = isItemReady
                ? 'PENDIENTE'
                : isItemInPrep
                  ? 'LISTO'
                  : 'EN_PREPARACION';
              onToggleItemStatus(ticket.id, item.id, nextStatus);
            };

            return (
              <div
                key={item.id}
                onClick={handleToggle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleToggle();
                  }
                }}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-focus ${
                  isItemReady
                    ? 'bg-surface-raised/40 border-border opacity-70'
                    : 'bg-surface border-border hover:border-brand/40 hover:bg-surface-raised'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <span
                      className={`min-w-[28px] h-7 rounded-lg text-xs font-black flex items-center justify-center shrink-0 ${
                        isItemReady
                          ? 'bg-success-soft text-success-strong border border-success/30'
                          : 'bg-brand text-on-brand'
                      }`}
                    >
                      {String(item.quantity).replace(/\.0000$/, '')}x
                    </span>
                    <div>
                      <span
                        className={`text-sm font-bold text-text leading-tight block ${
                          isItemReady ? 'line-through text-text-muted' : ''
                        }`}
                      >
                        {item.productName}
                      </span>
                    </div>
                  </div>

                  {/* Item Status Indicator */}
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border text-xs ${
                      isItemReady
                        ? 'bg-success text-on-brand border-success'
                        : isItemInPrep
                          ? 'bg-info-soft text-info-strong border-info'
                          : 'border-border-control text-transparent'
                    }`}
                    title={`Estado: ${item.status}`}
                  >
                    {isItemReady ? '✓' : isItemInPrep ? '●' : ''}
                  </span>
                </div>

                {/* Modifiers List */}
                {item.modifiers && item.modifiers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 pl-9">
                    {item.modifiers.map((mod) => (
                      <span
                        key={mod.modifierId}
                        className="px-2 py-0.5 rounded-md text-2xs font-semibold bg-surface-raised border border-border-control/50 text-text"
                      >
                        {mod.modifierNameSnapshot}
                      </span>
                    ))}
                  </div>
                )}

                {/* Special Notes / Comments */}
                {item.notes && (
                  <div className="mt-2 pl-9">
                    <div className="px-2 py-1 rounded-md bg-warning-soft border border-warning/40 text-warning-strong text-2xs font-semibold flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                      <span>Nota: {item.notes}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Ticket Footer Action Button */}
      <div className="p-3 bg-surface-raised border-t-2 border-border mt-2">
        {isPending ? (
          <Button
            intent="primary"
            size="lg"
            disabled={isActionLoading}
            onClick={() => onStartPreparation(ticket.id)}
            className="w-full min-h-[56px] text-base font-extrabold flex items-center justify-center gap-2 shadow-sm"
          >
            <svg
              className="w-5 h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Iniciar Preparación</span>
            {shortcutNumber !== undefined && (
              <span className="font-mono text-xs opacity-80">[{shortcutNumber}]</span>
            )}
          </Button>
        ) : (
          <Button
            intent={allItemsReady ? 'primary' : 'primary'}
            size="xl"
            disabled={isActionLoading}
            onClick={() => onBumpTicket(ticket.id)}
            className={`w-full min-h-[72px] text-lg font-black uppercase tracking-wide flex items-center justify-center gap-3 shadow-md active:scale-[0.98] transition-transform ${
              isOverdue
                ? 'bg-danger hover:bg-danger-strong text-on-brand'
                : allItemsReady
                  ? 'bg-success hover:bg-success-strong text-on-brand'
                  : 'bg-brand hover:bg-brand-strong text-on-brand'
            }`}
          >
            <svg
              className="w-7 h-7 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>DESPACHAR (BUMP)</span>
            {shortcutNumber !== undefined && (
              <span className="font-mono text-sm px-2 py-0.5 rounded bg-black/20 text-white">
                [{shortcutNumber}]
              </span>
            )}
          </Button>
        )}
      </div>
    </article>
  );
}
