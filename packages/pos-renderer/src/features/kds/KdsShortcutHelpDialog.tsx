import * as React from 'react';
import { Dialog, Button } from '@trident/ui';

export interface KdsShortcutHelpDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function KdsShortcutHelpDialog({
  isOpen,
  onClose,
}: KdsShortcutHelpDialogProps): React.JSX.Element {
  const shortcuts = [
    { key: '1 – 8', desc: 'Despachar (Bump) o Iniciar el ticket en la posición indicada.' },
    { key: 'Espacio / Enter', desc: 'Despachar el ticket más urgente o antiguo en la cola.' },
    { key: 'R / r', desc: 'Abrir / Cerrar el historial de órdenes despachadas (Recall).' },
    { key: '?', desc: 'Abrir esta guía de atajos de teclado.' },
    { key: 'Escape', desc: 'Cerrar cualquier diálogo o panel lateral abierto.' },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Atajos de Bump Bar & Teclado Industrial"
      description="El KDS está optimizado para teclados de membrana, bump bars USB y atajos rápidos sin necesidad de tocar la pantalla."
    >
      <div className="flex flex-col gap-4 py-2 select-none">
        <div className="flex flex-col gap-2.5">
          {shortcuts.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-raised border border-border"
            >
              <kbd className="px-2.5 py-1 rounded-lg bg-surface border-2 border-border-control font-mono font-black text-sm text-text shadow-xs">
                {s.key}
              </kbd>
              <span className="text-xs font-medium text-text-muted text-right max-w-[260px]">
                {s.desc}
              </span>
            </div>
          ))}
        </div>

        <div className="p-3 rounded-xl bg-brand-soft border border-brand/30 text-xs text-brand-strong font-medium flex items-center gap-2">
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            Compatible con Bump Bars Logic Controls, Bematech y teclados USB estándar.
          </span>
        </div>

        <div className="pt-2 flex justify-end">
          <Button intent="primary" size="lg" onClick={onClose} className="min-h-[48px] px-6">
            Entendido
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
