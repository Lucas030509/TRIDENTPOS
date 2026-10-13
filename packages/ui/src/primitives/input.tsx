import * as React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  readonly isError?: boolean;
  readonly isTabular?: boolean;
  readonly helperText?: string;
  readonly label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    isError = false,
    isTabular = false,
    label,
    helperText,
    id: explicitId,
    disabled = false,
    className,
    ...props
  },
  ref,
) {
  const generatedId = React.useId();
  const inputId = explicitId ?? generatedId;
  const helperId = helperText ? `${inputId}-helper` : undefined;

  const baseInput =
    'w-full min-h-[48px] px-3.5 py-2.5 text-md text-text bg-surface rounded-md border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:bg-surface-raised disabled:cursor-not-allowed';

  const borderState = isError
    ? 'border-danger focus:border-danger focus:ring-danger'
    : 'border-border-control focus:border-focus focus:ring-focus';

  const typographyState = isTabular ? 'font-mono [font-variant-numeric:tabular-nums]' : '';

  const inputClass = [baseInput, borderState, typographyState, className].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-semibold text-text select-none">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={isError ? 'true' : undefined}
        aria-describedby={helperId}
        className={inputClass}
        {...props}
      />
      {helperText ? (
        <p
          id={helperId}
          className={`text-xs ${isError ? 'text-danger font-medium' : 'text-text-muted'}`}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
