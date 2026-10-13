import * as React from 'react';
import { Button, MoneyText, NumericKeypad } from '@trident/ui';
import type {
  CuentaDetalleDTO,
  PaymentMethod,
  SubmitTenderRequestDTO,
  TenderResultDTO,
} from '../../bridge/trident-bridge.js';

export interface TenderPaymentViewProps {
  readonly cuenta: CuentaDetalleDTO;
  readonly turnoCajaId: string;
  readonly currentUserId: string;
  readonly onSubmitTender: (request: SubmitTenderRequestDTO) => Promise<TenderResultDTO | null>;
  readonly onClose: () => void;
  readonly className?: string;
}

// Helpers for zero-float scale-4 calculations
function toScale4BigInt(val: string): bigint {
  const parts = val.split('.');
  const intPart = BigInt(parts[0] || '0');
  const fracPart = (parts[1] || '').padEnd(4, '0').slice(0, 4);
  const frac = BigInt(fracPart);
  return intPart < 0n ? -(intPart * 10000n - frac) : intPart * 10000n + frac;
}

function fromScale4BigInt(val: bigint): string {
  const isNegative = val < 0n;
  const absVal = isNegative ? -val : val;
  const intPart = absVal / 10000n;
  const fracPart = (absVal % 10000n).toString().padStart(4, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

export function TenderPaymentView({
  cuenta,
  turnoCajaId,
  currentUserId,
  onSubmitTender,
  onClose,
  className,
}: TenderPaymentViewProps): React.JSX.Element {
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('EFECTIVO');
  const [tipPercentage, setTipPercentage] = React.useState<number>(0);
  const [customTipAmount, setCustomTipAmount] = React.useState<string>('0.0000');
  const [isCustomTip, setIsCustomTip] = React.useState<boolean>(false);

  // Cash tendered state
  const [cashGivenString, setCashGivenString] = React.useState<string>('');
  const [referenceCode, setReferenceCode] = React.useState<string>('');
  const [operatorPin, setOperatorPin] = React.useState<string>('1234');
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Partial / Mixed payment toggle
  const [isPartialPayment, setIsPartialPayment] = React.useState<boolean>(false);
  const [partialAmountString, setPartialAmountString] = React.useState<string>('');

  // Active keypad focus: 'CASH_GIVEN' | 'PARTIAL_AMOUNT' | 'CUSTOM_TIP'
  const [keypadTarget, setKeypadTarget] = React.useState<
    'CASH_GIVEN' | 'PARTIAL_AMOUNT' | 'CUSTOM_TIP'
  >('CASH_GIVEN');

  // Tip calculation
  const calculatedTipBigInt = React.useMemo(() => {
    if (isCustomTip) {
      return toScale4BigInt(customTipAmount || '0.0000');
    }
    if (tipPercentage === 0) return 0n;
    const subtotalBigInt = toScale4BigInt(cuenta.subtotal);
    // Tip % over subtotal
    return (subtotalBigInt * BigInt(tipPercentage)) / 100n;
  }, [cuenta.subtotal, isCustomTip, customTipAmount, tipPercentage]);

  const tipAmountString = React.useMemo(() => {
    return fromScale4BigInt(calculatedTipBigInt);
  }, [calculatedTipBigInt]);

  // Account total + tip
  const totalWithTipBigInt = React.useMemo(() => {
    const totalBigInt = toScale4BigInt(cuenta.totalAmount);
    return totalBigInt + calculatedTipBigInt;
  }, [cuenta.totalAmount, calculatedTipBigInt]);

  const totalWithTipString = React.useMemo(() => {
    return fromScale4BigInt(totalWithTipBigInt);
  }, [totalWithTipBigInt]);

  // Base amount to pay (partial or full)
  const amountToTenderBigInt = React.useMemo(() => {
    if (isPartialPayment && partialAmountString) {
      return toScale4BigInt(partialAmountString);
    }
    return toScale4BigInt(cuenta.totalAmount);
  }, [isPartialPayment, partialAmountString, cuenta.totalAmount]);

  const amountToTenderString = React.useMemo(() => {
    return fromScale4BigInt(amountToTenderBigInt);
  }, [amountToTenderBigInt]);

  // Cash given calculation and change due
  const cashGivenBigInt = React.useMemo(() => {
    return toScale4BigInt(cashGivenString || '0.0000');
  }, [cashGivenString]);

  // Total required in cash = amount to pay + tip
  const cashRequiredBigInt = amountToTenderBigInt + calculatedTipBigInt;

  const changeDueBigInt = React.useMemo(() => {
    if (paymentMethod !== 'EFECTIVO') return 0n;
    if (cashGivenBigInt <= cashRequiredBigInt) return 0n;
    return cashGivenBigInt - cashRequiredBigInt;
  }, [paymentMethod, cashGivenBigInt, cashRequiredBigInt]);

  const changeDueString = React.useMemo(() => {
    return fromScale4BigInt(changeDueBigInt);
  }, [changeDueBigInt]);

  // Quick cash buttons
  const handleQuickCash = (amount: number) => {
    setCashGivenString(amount.toFixed(4));
  };

  const handleExactCash = () => {
    setCashGivenString(fromScale4BigInt(cashRequiredBigInt));
  };

  // Keypad inputs
  const handleKeypadDigit = (digit: string) => {
    if (keypadTarget === 'CASH_GIVEN') {
      if (digit === '.' && cashGivenString.includes('.')) return;
      setCashGivenString((prev) => (prev === '0.0000' || prev === '' ? digit : prev + digit));
    } else if (keypadTarget === 'PARTIAL_AMOUNT') {
      if (digit === '.' && partialAmountString.includes('.')) return;
      setPartialAmountString((prev) => (prev === '0.0000' || prev === '' ? digit : prev + digit));
    } else if (keypadTarget === 'CUSTOM_TIP') {
      if (digit === '.' && customTipAmount.includes('.')) return;
      setCustomTipAmount((prev) => (prev === '0.0000' || prev === '' ? digit : prev + digit));
    }
  };

  const handleKeypadBackspace = () => {
    if (keypadTarget === 'CASH_GIVEN') {
      setCashGivenString((prev) => prev.slice(0, -1));
    } else if (keypadTarget === 'PARTIAL_AMOUNT') {
      setPartialAmountString((prev) => prev.slice(0, -1));
    } else if (keypadTarget === 'CUSTOM_TIP') {
      setCustomTipAmount((prev) => prev.slice(0, -1));
    }
  };

  const handleKeypadClear = () => {
    if (keypadTarget === 'CASH_GIVEN') {
      setCashGivenString('');
    } else if (keypadTarget === 'PARTIAL_AMOUNT') {
      setPartialAmountString('');
    } else if (keypadTarget === 'CUSTOM_TIP') {
      setCustomTipAmount('');
    }
  };

  // Submit tender action
  const handleConfirmPayment = async () => {
    setErrorMessage(null);

    if (paymentMethod === 'EFECTIVO' && cashGivenBigInt < cashRequiredBigInt) {
      setErrorMessage('El efectivo recibido es menor al total requerido.');
      return;
    }

    if (amountToTenderBigInt <= 0n) {
      setErrorMessage('El monto a cobrar debe ser mayor a cero.');
      return;
    }

    setIsSubmitting(true);
    const clientOpId = crypto.randomUUID();

    const request: SubmitTenderRequestDTO = {
      cuentaId: cuenta.id,
      turnoCajaId,
      operatorUserId: currentUserId,
      operatorPin,
      paymentMethod,
      amount: amountToTenderString,
      tipAmount: tipAmountString,
      cashGiven: paymentMethod === 'EFECTIVO' ? fromScale4BigInt(cashGivenBigInt) : undefined,
      referenceAuthCode:
        paymentMethod === 'TARJETA' || paymentMethod === 'TRANSFERENCIA'
          ? referenceCode || `AUTH-${Date.now().toString().slice(-6)}`
          : null,
      clientOpId,
    };

    const res = await onSubmitTender(request);
    setIsSubmitting(false);

    if (!res) {
      setErrorMessage('Error al procesar el cobro. Verifique la conexión.');
    }
  };

  return (
    <div
      role="region"
      aria-label="Panel de cobro y liquidación"
      className={`flex-1 flex flex-col md:flex-row h-full bg-surface border-2 border-border-control rounded-xl shadow-2 overflow-hidden ${
        className ?? ''
      }`}
    >
      {/* Left Column: Account Details & Financial Breakdown */}
      <div className="w-full md:w-[380px] p-5 border-b md:border-b-0 md:border-r border-border bg-surface flex flex-col justify-between overflow-y-auto">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <span className="text-xs uppercase font-extrabold text-primary tracking-wider">
                Cobro de Cuenta
              </span>
              <h2 className="text-xl font-black text-text">
                {cuenta.mesaId ? `Mesa ${cuenta.tableNumber ?? '?'}` : cuenta.tableNumber ?? 'Mostrador'}
              </h2>
            </div>

            <Button intent="neutral" tone="outline" size="md" onClick={onClose} aria-label="Cerrar cobro">
              ✕
            </Button>
          </div>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Folio: #{cuenta.folioNumber ?? cuenta.id.slice(-6)}</span>
            <span>Comensales: {cuenta.guestCount}</span>
            <span>Versión: v{cuenta.version}</span>
          </div>

          {/* Items Summary */}
          <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto p-2.5 bg-surface-raised rounded-lg border border-border-control">
            <span className="text-xs font-bold uppercase text-text-muted">Partidas Ordenadas</span>
            {cuenta.items.length === 0 ? (
              <span className="text-xs text-text-muted italic">Sin partidas desglosadas</span>
            ) : (
              cuenta.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs text-text">
                  <span className="truncate pr-2">
                    {item.quantity.split('.')[0]}x {item.productNameSnapshot}
                  </span>
                  <MoneyText amount={item.total} size="sm" className="font-semibold shrink-0" />
                </div>
              ))
            )}
          </div>

          {/* Financial Breakdown */}
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <div className="flex justify-between text-sm text-text-muted">
              <span>Subtotal:</span>
              <MoneyText amount={cuenta.subtotal} size="sm" />
            </div>

            <div className="flex justify-between text-sm text-text-muted">
              <span>Impuestos (IVA 16%):</span>
              <MoneyText amount={cuenta.taxTotal} size="sm" />
            </div>

            {cuenta.discountsTotal !== '0.0000' && (
              <div className="flex justify-between text-sm text-danger-strong">
                <span>Descuento:</span>
                <span>-<MoneyText amount={cuenta.discountsTotal} size="sm" /></span>
              </div>
            )}

            <div className="flex justify-between text-sm text-text-muted">
              <span>Propina Sugerida:</span>
              <MoneyText amount={tipAmountString} size="sm" className="font-semibold text-primary" />
            </div>

            <div className="flex justify-between items-baseline pt-2 border-t-2 border-border-control">
              <span className="text-base font-extrabold text-text uppercase">Total a Liquidar:</span>
              <div className="text-2xl font-black text-text">
                <MoneyText amount={totalWithTipString} size="2xl" />
              </div>
            </div>
          </div>
        </div>

        {/* PIN input for DEC-017 Operator Trazability */}
        <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
          <label htmlFor="cajero-pin-input" className="text-xs font-semibold text-text-muted uppercase">
            PIN Cajero:
          </label>
          <input
            id="cajero-pin-input"
            type="password"
            maxLength={6}
            value={operatorPin}
            onChange={(e) => setOperatorPin(e.target.value)}
            className="w-24 min-h-[44px] text-center text-lg font-mono tracking-widest bg-surface-raised rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
            aria-label="PIN de cajero"
          />
        </div>
      </div>

      {/* Right Column: Interactive Tender & Payment Processing */}
      <div className="flex-1 p-5 bg-surface-raised/20 flex flex-col justify-between overflow-y-auto">
        <div className="flex flex-col gap-5">
          {/* Tip Selection */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-text-muted">
              1. Propina del Servicio (Voluntaria)
            </span>
            <div className="grid grid-cols-5 gap-2" role="group" aria-label="Porcentaje de propina">
              {[0, 10, 15, 20].map((pct) => {
                const isSelected = !isCustomTip && tipPercentage === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setIsCustomTip(false);
                      setTipPercentage(pct);
                    }}
                    className={`min-h-[48px] rounded-lg font-bold text-sm border-2 transition-all select-none ${
                      isSelected
                        ? 'bg-primary text-white border-primary shadow-sm'
                        : 'bg-surface hover:bg-surface-raised text-text border-border-control'
                    }`}
                  >
                    {pct === 0 ? 'Sin Propina' : `${pct}%`}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setIsCustomTip(true);
                  setKeypadTarget('CUSTOM_TIP');
                }}
                className={`min-h-[48px] rounded-lg font-bold text-xs border-2 transition-all select-none ${
                  isCustomTip
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-surface hover:bg-surface-raised text-text border-border-control'
                }`}
              >
                Manual
              </button>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-text-muted">
                2. Método de Pago
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !isPartialPayment;
                  setIsPartialPayment(next);
                  if (next) setKeypadTarget('PARTIAL_AMOUNT');
                }}
                className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-bold border-2 transition-all select-none ${
                  isPartialPayment
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-surface hover:bg-surface-raised text-text-muted border-border-control'
                }`}
              >
                {isPartialPayment ? '✓ Abono Parcial Activo' : '+ Pago Dividido'}
              </button>
            </div>

            {isPartialPayment && (
              <div
                onClick={() => setKeypadTarget('PARTIAL_AMOUNT')}
                className={`p-3 bg-surface rounded-xl border-2 cursor-pointer flex items-center justify-between transition-all ${
                  keypadTarget === 'PARTIAL_AMOUNT'
                    ? 'border-focus ring-2 ring-focus/20 shadow-xs'
                    : 'border-border-control'
                }`}
              >
                <span className="text-xs font-bold text-text-muted uppercase">Monto de este abono:</span>
                <span className="text-lg font-mono font-black text-text">
                  ${partialAmountString || '0.0000'}
                </span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Método de pago">
              {(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const).map((method) => {
                const isSelected = paymentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setPaymentMethod(method);
                      if (method === 'EFECTIVO') {
                        setKeypadTarget('CASH_GIVEN');
                      }
                    }}
                    className={`min-h-[56px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 border-2 transition-all select-none ${
                      isSelected
                        ? 'bg-surface border-primary text-primary-strong ring-2 ring-primary/20 shadow-md'
                        : 'bg-surface hover:bg-surface-raised text-text-muted border-border-control'
                    }`}
                  >
                    {method === 'EFECTIVO' ? '💵 Efectivo' : method === 'TARJETA' ? '💳 Tarjeta' : '📲 SPEI'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cash Details & Keypad Section */}
          {paymentMethod === 'EFECTIVO' ? (
            <div className="flex flex-col md:flex-row gap-5 items-start">
              {/* Quick Cash Buttons & Calculation Display */}
              <div className="flex-1 w-full flex flex-col gap-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-text-muted">
                  3. Efectivo Recibido y Cambio
                </span>

                {/* Quick bill denominations */}
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Billetes rápidos">
                  {[50, 100, 200, 500, 1000].map((bill) => (
                    <button
                      key={bill}
                      type="button"
                      onClick={() => handleQuickCash(bill)}
                      className="min-h-[48px] rounded-lg font-bold font-mono text-base border-2 border-border-control bg-surface hover:bg-surface-raised text-text select-none active:scale-95"
                    >
                      ${bill}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleExactCash}
                    className="min-h-[48px] rounded-lg font-bold text-xs border-2 border-primary bg-primary-soft/40 text-primary-strong select-none active:scale-95"
                  >
                    Exacto
                  </button>
                </div>

                {/* Cash Tendered & Change Boxes */}
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div
                    onClick={() => setKeypadTarget('CASH_GIVEN')}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      keypadTarget === 'CASH_GIVEN'
                        ? 'border-focus bg-surface ring-2 ring-focus/20 shadow-sm'
                        : 'border-border-control bg-surface'
                    }`}
                  >
                    <span className="text-xs font-bold text-text-muted uppercase block">Recibido</span>
                    <div className="text-xl font-black text-text mt-1">
                      <MoneyText amount={fromScale4BigInt(cashGivenBigInt)} size="xl" />
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-xl border-2 transition-all ${
                      cashGivenBigInt >= cashRequiredBigInt && cashGivenBigInt > 0n
                        ? 'border-success bg-success-soft/30'
                        : 'border-border-control bg-surface'
                    }`}
                  >
                    <span className="text-xs font-bold text-text-muted uppercase block">Cambio a Devolver</span>
                    <div className="text-xl font-black text-success-strong mt-1">
                      <MoneyText amount={changeDueString} size="xl" isPositiveGreen />
                    </div>
                  </div>
                </div>
              </div>

              {/* Touch Numeric Keypad */}
              <div className="flex justify-center w-full md:w-auto">
                <NumericKeypad
                  onDigit={handleKeypadDigit}
                  onBackspace={handleKeypadBackspace}
                  onClear={handleKeypadClear}
                  allowDecimal={true}
                  className="w-full"
                />
              </div>
            </div>
          ) : (
            /* Card / Transfer Reference Input */
            <div className="flex flex-col gap-4 p-5 bg-surface rounded-xl border-2 border-border-control">
              <span className="text-xs font-extrabold uppercase tracking-wider text-text-muted">
                3. Datos de la Transacción Bancaria
              </span>

              <div className="flex flex-col gap-2">
                <label htmlFor="ref-input" className="text-xs font-semibold text-text">
                  Código de Autorización / Referencia (Voucher):
                </label>
                <input
                  id="ref-input"
                  type="text"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value)}
                  placeholder="Ej: AUTH-982341 ó SPEI-20261013"
                  className="w-full min-h-[48px] px-4 text-base font-mono bg-surface-raised rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>

              <div className="p-3 bg-surface-raised rounded-lg border border-border text-xs text-text-muted">
                ℹ️ Verifique que la terminal bancaria haya emitido el ticket de "APROBADA" antes de confirmar la liquidación de la cuenta.
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-danger-soft border-2 border-danger rounded-lg text-danger-strong text-sm font-semibold flex items-center gap-2">
              ⚠️ {errorMessage}
            </div>
          )}
        </div>

        {/* Primary Giant Action Button (72px touch target) */}
        <div className="pt-4 border-t border-border mt-4">
          <Button
            intent="primary"
            tone="solid"
            size="xl"
            disabled={
              isSubmitting ||
              (paymentMethod === 'EFECTIVO' && cashGivenBigInt < cashRequiredBigInt)
            }
            onClick={handleConfirmPayment}
            className="w-full min-h-[72px] text-xl font-extrabold shadow-2 active:scale-[0.99] transition-all"
            aria-label="Confirmar cobro y cerrar cuenta"
          >
            {isSubmitting ? (
              'Procesando Cobro...'
            ) : (
              <span className="flex items-center justify-center gap-3">
                <span>COBRAR Y CERRAR CUENTA</span>
                <span>•</span>
                <MoneyText amount={totalWithTipString} size="xl" className="text-white" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
