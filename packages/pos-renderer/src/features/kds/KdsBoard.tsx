import * as React from 'react';
import { Button } from '@trident/ui';
import {
  getTridentBridge,
  type KdsEstacionDTO,
  type KdsTicketDTO,
} from '../../bridge/trident-bridge.js';
import { KdsHeader } from './KdsHeader.js';
import { KdsTicketCard } from './KdsTicketCard.js';
import { KdsRecallDrawer } from './KdsRecallDrawer.js';
import { KdsShortcutHelpDialog } from './KdsShortcutHelpDialog.js';

export interface KdsBoardProps {
  readonly initialEstacionId?: string;
  readonly onEstacionChange?: (estacionId: string) => void;
}

export type KdsFilterKey = 'TODOS' | 'PENDIENTES' | 'EN_PREPARACION' | 'ATRASADOS';

export function KdsBoard({
  initialEstacionId = 'cocina-1',
  onEstacionChange,
}: KdsBoardProps): React.JSX.Element {
  const bridge = getTridentBridge();

  const [estaciones, setEstaciones] = React.useState<readonly KdsEstacionDTO[]>([]);
  const [activeEstacionId, setActiveEstacionId] = React.useState<string>(initialEstacionId);
  const [tickets, setTickets] = React.useState<readonly KdsTicketDTO[]>([]);
  const [completedTickets, setCompletedTickets] = React.useState<readonly KdsTicketDTO[]>([]);
  const [filter, setFilter] = React.useState<KdsFilterKey>('TODOS');

  const [isRecallOpen, setIsRecallOpen] = React.useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = React.useState<boolean>(false);
  const [isConnected, setIsConnected] = React.useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = React.useState<boolean>(false);
  const [attentionBanner, setAttentionBanner] = React.useState<string | null>(null);

  // Sync with prop if it changes
  React.useEffect(() => {
    if (initialEstacionId && initialEstacionId !== activeEstacionId) {
      setActiveEstacionId(initialEstacionId);
    }
  }, [initialEstacionId]);

  // Load stations on mount
  React.useEffect(() => {
    let mounted = true;
    bridge.kds.getEstaciones().then((res) => {
      if (mounted && res.ok && res.data.length > 0) {
        setEstaciones(res.data);
      }
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  // Load tickets and completed recall tickets whenever active station changes
  const refreshTickets = React.useCallback(async () => {
    const [ticketsRes, completedRes] = await Promise.all([
      bridge.kds.getTickets(activeEstacionId),
      bridge.kds.getRecentCompletedTickets(activeEstacionId, 120),
    ]);

    if (ticketsRes.ok) {
      setTickets(ticketsRes.data);
    }
    if (completedRes.ok) {
      setCompletedTickets(completedRes.data);
    }
  }, [bridge, activeEstacionId]);

  React.useEffect(() => {
    refreshTickets();
  }, [refreshTickets]);

  // Check connectivity
  React.useEffect(() => {
    let mounted = true;
    bridge.station.getConnectivityStatus().then((res) => {
      if (mounted && res.ok) {
        setIsConnected(res.data.edge === 'online');
      }
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  // Event Subscription for Real-time LAN updates
  React.useEffect(() => {
    const unsubscribe = bridge.events.subscribe((event) => {
      switch (event.eventType) {
        case 'ComandaEnviadaACocina':
        case 'OrdenProduccionIniciadaEnKDS':
        case 'OrdenProduccionConfirmadaEnKDS':
        case 'KdsTicketCreado':
        case 'KdsTicketActualizado':
        case 'KDS_RESYNC': {
          refreshTickets();
          if (event.eventType === 'ComandaEnviadaACocina') {
            setAttentionBanner('Nueva comanda recibida');
            setTimeout(() => setAttentionBanner(null), 5000);
          }
          break;
        }
        case 'connectivity.restored': {
          setIsConnected(true);
          refreshTickets();
          break;
        }
        case 'connectivity.lost': {
          setIsConnected(false);
          break;
        }
        default:
          break;
      }
    });

    return () => unsubscribe();
  }, [bridge, refreshTickets]);

  // Handle station change
  const handleSelectEstacion = (id: string) => {
    setActiveEstacionId(id);
    if (onEstacionChange) {
      onEstacionChange(id);
    }
  };

  // Actions
  const handleStartPreparation = async (ticketId: string) => {
    setIsActionLoading(true);
    const clientOpId = `op-start-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await bridge.kds.startPreparation(ticketId, activeEstacionId, clientOpId);
      if (res.ok) {
        await refreshTickets();
      }
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleBumpTicket = async (ticketId: string) => {
    setIsActionLoading(true);
    const clientOpId = `op-bump-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await bridge.kds.bumpTicket(ticketId, clientOpId);
      if (res.ok) {
        await refreshTickets();
      }
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReopenTicket = async (ticketId: string) => {
    setIsActionLoading(true);
    const clientOpId = `op-reopen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await bridge.kds.reopenTicket(ticketId, clientOpId);
      if (res.ok) {
        await refreshTickets();
        setIsRecallOpen(false);
      }
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleItemStatus = async (
    ticketId: string,
    itemId: string,
    newStatus: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO',
  ) => {
    const res = await bridge.kds.toggleItemStatus(ticketId, itemId, newStatus);
    if (res.ok) {
      await refreshTickets();
    }
  };

  // Counts & Calculations
  const counts = React.useMemo(() => {
    let pending = 0;
    let inProgress = 0;
    let overdue = 0;

    const now = Date.now();
    for (const t of tickets) {
      if (t.status === 'PENDIENTE') pending += 1;
      if (t.status === 'EN_PREPARACION') inProgress += 1;

      const elapsed = (now - new Date(t.createdAt).getTime()) / 1000;
      const target = t.targetSeconds || 900;
      if (elapsed >= target) overdue += 1;
    }

    return {
      total: tickets.length,
      pending,
      inProgress,
      overdue,
    };
  }, [tickets]);

  // Filtered tickets
  const filteredTickets = React.useMemo(() => {
    const now = Date.now();
    return tickets.filter((t) => {
      if (filter === 'PENDIENTES') return t.status === 'PENDIENTE';
      if (filter === 'EN_PREPARACION') return t.status === 'EN_PREPARACION';
      if (filter === 'ATRASADOS') {
        const elapsed = (now - new Date(t.createdAt).getTime()) / 1000;
        const target = t.targetSeconds || 900;
        return elapsed >= target;
      }
      return true;
    });
  }, [tickets, filter]);

  // Keyboard Bump-Bar Handler (Keys 1-8, Space, Enter, R, ?)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger if user is in an input or dialog is open
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (isRecallOpen) setIsRecallOpen(false);
        if (isHelpOpen) setIsHelpOpen(false);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setIsRecallOpen((prev) => !prev);
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setIsHelpOpen((prev) => !prev);
        return;
      }

      // Space or Enter: bumps the first visible ticket
      if (e.key === ' ' || e.key === 'Enter') {
        if (!isRecallOpen && !isHelpOpen && filteredTickets.length > 0) {
          const first = filteredTickets[0];
          if (first) {
            e.preventDefault();
            if (first.status === 'PENDIENTE') {
              handleStartPreparation(first.id);
            } else {
              handleBumpTicket(first.id);
            }
          }
        }
        return;
      }

      // Number keys 1-8 for Bump-Bar
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8) {
        const targetTicket = filteredTickets[num - 1];
        if (targetTicket && !isRecallOpen && !isHelpOpen) {
          e.preventDefault();
          if (targetTicket.status === 'PENDIENTE') {
            handleStartPreparation(targetTicket.id);
          } else {
            handleBumpTicket(targetTicket.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredTickets, isRecallOpen, isHelpOpen]);

  return (
    <div className="flex-1 flex flex-col h-full bg-bg text-text overflow-hidden [data-theme='dark'] select-none">
      {/* KDS Header */}
      <KdsHeader
        estaciones={estaciones}
        activeEstacionId={activeEstacionId}
        onSelectEstacion={handleSelectEstacion}
        ticketCounts={counts}
        isConnected={isConnected}
        onOpenRecall={() => setIsRecallOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        completedCount={completedTickets.length}
      />

      {/* Attention / Operational Alert Banner */}
      {attentionBanner && (
        <aside
          role="status"
          aria-live="polite"
          className="bg-brand text-on-brand px-6 py-2 flex items-center justify-between text-xs font-bold animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>{attentionBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setAttentionBanner(null)}
            className="text-on-brand/80 hover:text-on-brand"
            aria-label="Cerrar notificación"
          >
            ✕
          </button>
        </aside>
      )}

      {/* Sub-bar: Filter Tabs & Quick Info */}
      <div className="flex items-center justify-between px-6 py-2.5 bg-surface-raised border-b border-border text-xs shrink-0">
        <nav aria-label="Filtros de tickets" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('TODOS')}
            aria-pressed={filter === 'TODOS'}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-lg font-bold transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
              filter === 'TODOS'
                ? 'bg-brand text-on-brand shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            Todos ({counts.total})
          </button>

          <button
            type="button"
            onClick={() => setFilter('PENDIENTES')}
            aria-pressed={filter === 'PENDIENTES'}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-lg font-bold transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
              filter === 'PENDIENTES'
                ? 'bg-warning-soft text-warning-strong border border-warning/40 shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            Pendientes ({counts.pending})
          </button>

          <button
            type="button"
            onClick={() => setFilter('EN_PREPARACION')}
            aria-pressed={filter === 'EN_PREPARACION'}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-lg font-bold transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
              filter === 'EN_PREPARACION'
                ? 'bg-info-soft text-info-strong border border-info/40 shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            En Preparación ({counts.inProgress})
          </button>

          {counts.overdue > 0 && (
            <button
              type="button"
              onClick={() => setFilter('ATRASADOS')}
              aria-pressed={filter === 'ATRASADOS'}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-lg font-bold transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
                filter === 'ATRASADOS'
                  ? 'bg-danger-soft text-danger-strong border-2 border-danger shadow-xs'
                  : 'text-danger-strong hover:bg-danger-soft/40'
              }`}
            >
              Atrasados ({counts.overdue})
            </button>
          )}
        </nav>

        <div className="flex items-center gap-3 text-text-muted">
          <span className="hidden md:inline font-mono text-2xs">
            Atajos: <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border">1–8</kbd> Despachar |{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border">Espacio</kbd> Primero |{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border">R</kbd> Recall
          </span>
        </div>
      </div>

      {/* Main Ticket Board: Horizontal Touch Scroll */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        {filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-4">
            <div className="w-20 h-20 rounded-full bg-success-soft border-2 border-success/40 flex items-center justify-center text-success-strong">
              <svg
                className="w-10 h-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black text-text mb-1">
                {filter === 'TODOS'
                  ? 'Estación al día'
                  : `Sin tickets con filtro: ${filter}`}
              </h2>
              <p className="text-sm text-text-muted max-w-sm mx-auto">
                {filter === 'TODOS'
                  ? 'Todos los pedidos de la cocina han sido despachados. Las nuevas comandas aparecerán en tiempo real automáticamente.'
                  : 'No hay pedidos que coincidan con el criterio seleccionado actualmente.'}
              </p>
            </div>
            {filter !== 'TODOS' && (
              <Button
                intent="secondary"
                size="md"
                onClick={() => setFilter('TODOS')}
                className="min-h-[48px]"
              >
                Ver todos los tickets
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-5 h-full items-stretch">
            {filteredTickets.map((ticket, index) => (
              <KdsTicketCard
                key={ticket.id}
                ticket={ticket}
                shortcutNumber={index < 8 ? index + 1 : undefined}
                onStartPreparation={handleStartPreparation}
                onBumpTicket={handleBumpTicket}
                onToggleItemStatus={handleToggleItemStatus}
                isActionLoading={isActionLoading}
              />
            ))}
          </div>
        )}
      </main>

      {/* Recall Drawer */}
      <KdsRecallDrawer
        isOpen={isRecallOpen}
        onClose={() => setIsRecallOpen(false)}
        completedTickets={completedTickets}
        onReopenTicket={handleReopenTicket}
        isLoading={isActionLoading}
      />

      {/* Shortcut Help Modal */}
      <KdsShortcutHelpDialog
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
