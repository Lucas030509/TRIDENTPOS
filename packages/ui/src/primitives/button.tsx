import * as React from 'react';

export type ButtonIntent = 'primary' | 'secondary' | 'neutral' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'xl';
export type ButtonTone = 'solid' | 'soft' | 'outline';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly intent?: ButtonIntent;
  readonly size?: ButtonSize;
  readonly tone?: ButtonTone;
  readonly isLoading?: boolean;
}

export function getButtonClassName(
  intent: ButtonIntent = 'primary',
  size: ButtonSize = 'md',
  tone: ButtonTone = 'solid',
  className?: string,
): string {
  const base =
    'inline-flex items-center justify-center font-medium select-none rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

  // Sizing strictly aligned to VISUAL_SYSTEM.md touch targets
  const sizeClasses: Record<ButtonSize, string> = {
    md: 'min-h-[48px] min-w-[48px] px-4 py-2 text-md gap-2', // --target-md
    lg: 'min-h-[56px] min-w-[56px] px-6 py-3 text-lg font-semibold gap-3', // --target-lg (primary floor/caja)
    xl: 'min-h-[72px] min-w-[72px] px-8 py-4 text-xl font-bold gap-4', // --target-xl (KDS bump/keypad)
  };

  // Intent + Tone matrix strictly adhering to contrast tokens
  let toneClass = '';
  if (tone === 'solid') {
    switch (intent) {
      case 'primary':
        toneClass = 'bg-brand text-on-brand hover:brightness-110 active:brightness-95 focus:ring-focus';
        break;
      case 'secondary':
        toneClass = 'bg-info text-surface hover:brightness-110 active:brightness-95 focus:ring-focus';
        break;
      case 'danger':
        toneClass = 'bg-danger text-surface hover:brightness-110 active:brightness-95 focus:ring-danger';
        break;
      case 'neutral':
      default:
        toneClass = 'bg-surface-raised text-text hover:bg-border active:brightness-95 focus:ring-focus';
        break;
    }
  } else if (tone === 'soft') {
    switch (intent) {
      case 'primary':
        toneClass = 'bg-brand-soft text-brand-strong hover:brightness-95 focus:ring-focus';
        break;
      case 'secondary':
        toneClass = 'bg-info-soft text-info-strong hover:brightness-95 focus:ring-focus';
        break;
      case 'danger':
        toneClass = 'bg-danger-soft text-danger-strong hover:brightness-95 focus:ring-danger';
        break;
      case 'neutral':
      default:
        toneClass = 'bg-surface-raised text-text-muted hover:bg-border focus:ring-focus';
        break;
    }
  } else if (tone === 'outline') {
    switch (intent) {
      case 'primary':
        toneClass = 'border-2 border-brand text-brand bg-transparent hover:bg-brand-soft focus:ring-focus';
        break;
      case 'secondary':
        toneClass = 'border-2 border-info text-info bg-transparent hover:bg-info-soft focus:ring-focus';
        break;
      case 'danger':
        toneClass = 'border-2 border-danger text-danger bg-transparent hover:bg-danger-soft focus:ring-danger';
        break;
      case 'neutral':
      default:
        toneClass = 'border-2 border-border-control text-text bg-transparent hover:bg-surface-raised focus:ring-focus';
        break;
    }
  }

  return [base, sizeClasses[size], toneClass, className].filter(Boolean).join(' ');
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    intent = 'primary',
    size = 'md',
    tone = 'solid',
    isLoading = false,
    disabled = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const isEffectivelyDisabled = disabled || isLoading;

  return (
    <button
      ref={ref}
      type="button"
      disabled={isEffectivelyDisabled}
      aria-busy={isLoading ? 'true' : undefined}
      className={getButtonClassName(intent, size, tone, className)}
      {...props}
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-2">
          <svg
            className="animate-spin h-5 w-5 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span>{children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
});
