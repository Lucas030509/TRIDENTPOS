import * as React from 'react';
import { NumericKeypad } from './numeric-keypad.js';

export interface PinPadProps {
  readonly maxLength?: number;
  readonly value?: string;
  readonly onChange?: (pin: string) => void;
  readonly onComplete?: (pin: string) => void;
  readonly isError?: boolean;
  readonly errorMessage?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly label?: string;
}

export function PinPad({
  maxLength = 4,
  value: controlledValue,
  onChange,
  onComplete,
  isError = false,
  errorMessage,
  disabled = false,
  className,
  label = 'Ingrese su PIN',
}: PinPadProps): React.JSX.Element {
  const [internalPin, setInternalPin] = React.useState('');
  const currentPin = controlledValue !== undefined ? controlledValue : internalPin;

  const updatePin = React.useCallback(
    (newPin: string) => {
      if (newPin.length <= maxLength) {
        if (controlledValue === undefined) {
          setInternalPin(newPin);
        }
        onChange?.(newPin);
        if (newPin.length === maxLength) {
          onComplete?.(newPin);
        }
      }
    },
    [controlledValue, maxLength, onChange, onComplete],
  );

  const handleDigit = React.useCallback(
    (digit: string) => {
      if (currentPin.length < maxLength) {
        updatePin(currentPin + digit);
      }
    },
    [currentPin, maxLength, updatePin],
  );

  const handleBackspace = React.useCallback(() => {
    if (currentPin.length > 0) {
      updatePin(currentPin.slice(0, -1));
    }
  }, [currentPin, updatePin]);

  const handleClear = React.useCallback(() => {
    updatePin('');
  }, [updatePin]);

  const slots = Array.from({ length: maxLength }, (_, i) => i);

  return (
    <div className={`flex flex-col items-center gap-4 w-full ${className ?? ''}`}>
      {label ? (
        <span className="text-md font-semibold text-text select-none">{label}</span>
      ) : null}

      {/* Masked PIN slots indicator — strictly masks every digit (never exposes last digit) */}
      <div
        role="status"
        aria-label={`PIN con ${currentPin.length} de ${maxLength} dígitos ingresados`}
        className="flex items-center gap-3 my-2"
      >
        {slots.map((idx) => {
          const isFilled = idx < currentPin.length;
          return (
            <div
              key={idx}
              className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all ${
                isError
                  ? 'border-danger bg-danger-soft'
                  : isFilled
                    ? 'border-brand bg-brand'
                    : 'border-border-control bg-surface-raised'
              }`}
            >
              {isFilled ? (
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    isError ? 'bg-danger-strong' : 'bg-on-brand'
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {errorMessage ? (
        <p className="text-sm font-semibold text-danger-strong bg-danger-soft px-3 py-1 rounded-md border border-danger">
          {errorMessage}
        </p>
      ) : null}

      {/* Integrated 3x4 Touch Keypad */}
      <NumericKeypad
        onDigit={handleDigit}
        onBackspace={handleBackspace}
        onClear={handleClear}
        allowDecimal={false}
        disabled={disabled}
      />
    </div>
  );
}
