import * as React from 'react';
import { ButtonIntent, ButtonSize, ButtonTone } from './button.js';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly 'aria-label': string; // Strictly required for WCAG 2.2 AA non-text content
  readonly intent?: ButtonIntent;
  readonly size?: ButtonSize;
  readonly tone?: ButtonTone;
  readonly isLoading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    'aria-label': ariaLabel,
    intent = 'neutral',
    size = 'md',
    tone = 'soft',
    isLoading = false,
    disabled = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const isEffectivelyDisabled = disabled || isLoading;

  const sizeDimensions: Record<ButtonSize, string> = {
    md: 'min-h-[48px] min-w-[48px] h-12 w-12 p-2.5', // 48px
    lg: 'min-h-[56px] min-w-[56px] h-14 w-14 p-3', // 56px
    xl: 'min-h-[72px] min-w-[72px] h-[72px] w-[72px] p-4', // 72px
  };

  const base =
    'inline-flex items-center justify-center rounded-md select-none transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.96]';

  let toneClass = '';
  if (tone === 'solid') {
    toneClass =
      intent === 'danger'
        ? 'bg-danger text-surface hover:brightness-110 focus:ring-danger'
        : intent === 'primary'
          ? 'bg-brand text-on-brand hover:brightness-110 focus:ring-focus'
          : 'bg-surface-raised text-text hover:bg-border focus:ring-focus';
  } else if (tone === 'soft') {
    toneClass =
      intent === 'danger'
        ? 'bg-danger-soft text-danger-strong hover:brightness-95 focus:ring-danger'
        : intent === 'primary'
          ? 'bg-brand-soft text-brand-strong hover:brightness-95 focus:ring-focus'
          : 'bg-surface-raised text-text-muted hover:bg-border focus:ring-focus';
  } else {
    toneClass =
      intent === 'danger'
        ? 'border-2 border-danger text-danger hover:bg-danger-soft focus:ring-danger'
        : 'border-2 border-border-control text-text hover:bg-surface-raised focus:ring-focus';
  }

  const combinedClass = [base, sizeDimensions[size], toneClass, className].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      disabled={isEffectivelyDisabled}
      aria-busy={isLoading ? 'true' : undefined}
      className={combinedClass}
      {...props}
    >
      {isLoading ? (
        <svg
          className="animate-spin h-5 w-5 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ) : (
        children
      )}
    </button>
  );
});
