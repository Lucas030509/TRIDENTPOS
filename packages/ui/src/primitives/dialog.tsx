import * as React from 'react';
import { Button } from './button.js';

export interface DialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}: DialogProps): React.JSX.Element | null {
  const titleId = React.useId();
  const descId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`w-full max-w-lg bg-surface border-2 border-border-control rounded-xl shadow-3 p-6 flex flex-col gap-4 text-text animate-in fade-in zoom-in-95 duration-fast ${
          className ?? ''
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-xl font-bold text-text">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-sm text-text-muted mt-1">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-focus select-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly intent?: 'primary' | 'danger';
  readonly isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  intent = 'primary',
  isLoading = false,
}: ConfirmDialogProps): React.JSX.Element | null {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-6">
        <p className="text-md text-text-muted">{message}</p>
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button intent="neutral" tone="outline" size="md" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button intent={intent} size="md" onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
