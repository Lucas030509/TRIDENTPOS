import * as React from 'react';

export interface DrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly width?: '380px' | '420px' | 'full';
  readonly isModal?: boolean;
  readonly className?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = '380px',
  isModal = true,
  className,
}: DrawerProps): React.JSX.Element | null {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!isOpen || !isModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isModal, onClose]);

  if (!isOpen) return null;

  const widthClass =
    width === 'full'
      ? 'w-full'
      : width === '420px'
        ? 'w-full max-w-[420px]'
        : 'w-full max-w-[380px]';

  return (
    <div
      role="presentation"
      className={
        isModal
          ? 'fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity'
          : 'h-full flex shrink-0'
      }
    >
      <div
        role={isModal ? 'dialog' : 'region'}
        aria-modal={isModal ? 'true' : undefined}
        aria-labelledby={titleId}
        className={`h-full bg-surface border-l-2 border-border-control shadow-2 flex flex-col ${widthClass} text-text animate-in slide-in-from-right duration-fast ${
          className ?? ''
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface-raised min-h-[56px]">
          <h2 id={titleId} className="text-lg font-bold text-text truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel lateral"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface focus:outline-none focus:ring-2 focus:ring-focus select-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
