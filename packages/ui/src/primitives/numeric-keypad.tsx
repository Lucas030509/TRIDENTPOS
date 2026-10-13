import * as React from 'react';

export interface NumericKeypadProps {
  readonly onDigit: (digit: string) => void;
  readonly onBackspace: () => void;
  readonly onClear?: () => void;
  readonly onSubmit?: () => void;
  readonly allowDecimal?: boolean;
  readonly submitLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
  allowDecimal = true,
  submitLabel = 'Aceptar',
  disabled = false,
  className,
}: NumericKeypadProps): React.JSX.Element {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  const buttonKeyBase =
    'min-h-[72px] min-w-[72px] h-18 w-full flex items-center justify-center text-2xl font-bold font-mono [font-variant-numeric:tabular-nums] rounded-lg border-2 border-border-control bg-surface-raised text-text hover:bg-border active:scale-[0.96] transition-all select-none focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-50 disabled:pointer-events-none';

  return (
    <div
      role="group"
      aria-label="Teclado numérico táctil"
      className={`grid grid-cols-3 gap-2.5 max-w-[340px] w-full ${className ?? ''}`}
    >
      {/* Digits 1 through 9 */}
      {digits.map((digit) => (
        <button
          key={digit}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(digit)}
          className={buttonKeyBase}
          aria-label={`Número ${digit}`}
        >
          {digit}
        </button>
      ))}

      {/* Row 4: Decimal/Clear, 0, Backspace */}
      {allowDecimal ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDigit('.')}
          className={buttonKeyBase}
          aria-label="Punto decimal"
        >
          .
        </button>
      ) : onClear ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className={`${buttonKeyBase} text-sm font-semibold text-danger-strong bg-danger-soft border-danger`}
          aria-label="Limpiar entrada"
        >
          C
        </button>
      ) : (
        <div aria-hidden="true" className="min-h-[72px]" />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onDigit('0')}
        className={buttonKeyBase}
        aria-label="Número 0"
      >
        0
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        className={`${buttonKeyBase} text-lg text-danger-strong bg-danger-soft border-danger hover:brightness-95`}
        aria-label="Borrar último dígito"
      >
        ⌫
      </button>

      {/* Optional Full-width Submit Row if onSubmit is provided */}
      {onSubmit ? (
        <div className="col-span-3 pt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={onSubmit}
            className="w-full min-h-[56px] h-14 bg-brand text-on-brand font-semibold text-lg rounded-lg border-2 border-brand hover:brightness-110 active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-focus"
            aria-label={submitLabel}
          >
            {submitLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
