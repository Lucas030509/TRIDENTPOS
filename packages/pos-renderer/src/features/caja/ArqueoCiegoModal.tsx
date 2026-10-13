import * as React from 'react';
import { Button, Dialog, MoneyText } from '@trident/ui';
import type { ArqueoCiegoResultDTO, CashShiftStatusDTO } from '../../bridge/trident-bridge.js';

export interface ArqueoCiegoModalProps {
  readonly isOpen: boolean;
  readonly shift: CashShiftStatusDTO | null;
  readonly currentUserId: string;
  readonly onRealizarArqueo: (params: {
    declaredCash: string;
    operatorPin: string;
    expectedVersion: number;
    clientOpId: string;
  }) => Promise<ArqueoCiegoResultDTO | null>;
  readonly onGenerarCorteZ: (params: {
    expectedVersion: number;
    operatorPin: string;
    clientOpId: string;
  }) => Promise<boolean>;
  readonly onClose: () => void;
}

interface Denominacion {
  readonly valorCentavos: bigint; // Escala 4: $1000 = 10000000n
  readonly label: string;
  readonly tipo: 'BILLETE' | 'MONEDA';
}

const DENOMINACIONES: readonly Denominacion[] = [
  { valorCentavos: 10000000n, label: '$1,000', tipo: 'BILLETE' },
  { valorCentavos: 5000000n, label: '$500', tipo: 'BILLETE' },
  { valorCentavos: 2000000n, label: '$200', tipo: 'BILLETE' },
  { valorCentavos: 1000000n, label: '$100', tipo: 'BILLETE' },
  { valorCentavos: 500000n, label: '$50', tipo: 'BILLETE' },
  { valorCentavos: 200000n, label: '$20', tipo: 'BILLETE' },
  { valorCentavos: 100000n, label: '$10', tipo: 'MONEDA' },
  { valorCentavos: 50000n, label: '$5', tipo: 'MONEDA' },
  { valorCentavos: 20000n, label: '$2', tipo: 'MONEDA' },
  { valorCentavos: 10000n, label: '$1', tipo: 'MONEDA' },
  { valorCentavos: 5000n, label: '$0.50', tipo: 'MONEDA' },
];

function fromScale4BigInt(val: bigint): string {
  const isNegative = val < 0n;
  const absVal = isNegative ? -val : val;
  const intPart = absVal / 10000n;
  const fracPart = (absVal % 10000n).toString().padStart(4, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

export function ArqueoCiegoModal({
  isOpen,
  shift,
  currentUserId: _currentUserId,
  onRealizarArqueo,
  onGenerarCorteZ,
  onClose,
}: ArqueoCiegoModalProps): React.JSX.Element | null {
  // Mode: 'COUNTING' | 'RECONCILIATION'
  const [step, setStep] = React.useState<'COUNTING' | 'RECONCILIATION'>('COUNTING');
  const [useDenominations, setUseDenominations] = React.useState<boolean>(true);
  const [piezas, setPiezas] = React.useState<Record<string, number>>({});
  const [directDeclaredString, setDirectDeclaredString] = React.useState<string>('');
  const [operatorPin, setOperatorPin] = React.useState<string>('1234');
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Result after blind submission
  const [arqueoResult, setArqueoResult] = React.useState<ArqueoCiegoResultDTO | null>(null);
  const [corteZSuccess, setCorteZSuccess] = React.useState<boolean>(false);

  // Reset when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setStep('COUNTING');
      setPiezas({});
      setDirectDeclaredString('');
      setOperatorPin('1234');
      setErrorMessage(null);
      setArqueoResult(null);
      setCorteZSuccess(false);
    }
  }, [isOpen]);

  // Calculate declared total from denominations
  const totalDenominacionesBigInt = React.useMemo(() => {
    let sum = 0n;
    for (const d of DENOMINACIONES) {
      const count = BigInt(piezas[d.label] || 0);
      sum += d.valorCentavos * count;
    }
    return sum;
  }, [piezas]);

  const totalDeclaradoString = React.useMemo(() => {
    if (useDenominations) {
      return fromScale4BigInt(totalDenominacionesBigInt);
    }
    return directDeclaredString || '0.0000';
  }, [useDenominations, totalDenominacionesBigInt, directDeclaredString]);

  const handleUpdatePieza = (label: string, delta: number) => {
    setPiezas((prev) => {
      const cur = prev[label] || 0;
      const next = Math.max(0, cur + delta);
      return { ...prev, [label]: next };
    });
  };

  const handleConfirmArqueo = async () => {
    setErrorMessage(null);
    if (!operatorPin || operatorPin.length < 4) {
      setErrorMessage('Ingrese un PIN de operador válido de 4 dígitos.');
      return;
    }

    setIsSubmitting(true);
    const clientOpId = crypto.randomUUID();

    const res = await onRealizarArqueo({
      declaredCash: totalDeclaradoString,
      operatorPin,
      expectedVersion: shift?.version ?? 1,
      clientOpId,
    });

    setIsSubmitting(false);

    if (res) {
      setArqueoResult(res);
      setStep('RECONCILIATION');
    } else {
      setErrorMessage('Error al registrar el arqueo ciego. Verifique la versión del turno.');
    }
  };

  const handleConfirmCorteZ = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const clientOpId = crypto.randomUUID();

    const success = await onGenerarCorteZ({
      expectedVersion: arqueoResult?.turno.version ?? shift?.version ?? 1,
      operatorPin,
      clientOpId,
    });

    setIsSubmitting(false);

    if (success) {
      setCorteZSuccess(true);
    } else {
      setErrorMessage('Error al emitir el Corte Z definitivo.');
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'COUNTING' ? 'Arqueo Ciego de Caja (DEC-017)' : 'Conciliación de Caja & Corte Z'}
      description={
        step === 'COUNTING'
          ? 'Conteo ciego de efectivo físico sin revelación previa del total del sistema.'
          : 'Resultados del arqueo comparados contra el saldo calculado por el sistema.'
      }
      className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
    >
      {step === 'COUNTING' ? (
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Method selector */}
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <button
              type="button"
              onClick={() => setUseDenominations(true)}
              className={`flex-1 min-h-[44px] rounded-lg font-bold text-xs transition-all border-2 ${
                useDenominations
                  ? 'bg-primary text-white border-primary shadow-xs'
                  : 'bg-surface hover:bg-surface-raised text-text border-border-control'
              }`}
            >
              Desglose por Denominaciones
            </button>
            <button
              type="button"
              onClick={() => setUseDenominations(false)}
              className={`flex-1 min-h-[44px] rounded-lg font-bold text-xs transition-all border-2 ${
                !useDenominations
                  ? 'bg-primary text-white border-primary shadow-xs'
                  : 'bg-surface hover:bg-surface-raised text-text border-border-control'
              }`}
            >
              Entrada de Total Directo
            </button>
          </div>

          {useDenominations ? (
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-text-muted uppercase">
                Conteo de Billetes y Monedas
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto p-2 bg-surface-raised/40 rounded-xl border border-border-control">
                {DENOMINACIONES.map((d) => {
                  const count = piezas[d.label] || 0;
                  return (
                    <div
                      key={d.label}
                      className="flex items-center justify-between p-2.5 bg-surface rounded-lg border border-border-control"
                    >
                      <div className="flex flex-col">
                        <span className="font-extrabold text-text font-mono text-base">{d.label}</span>
                        <span className="text-[10px] text-text-muted uppercase font-semibold">
                          {d.tipo}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdatePieza(d.label, -1)}
                          disabled={count === 0}
                          className="w-10 h-10 flex items-center justify-center rounded-lg border border-border-control bg-surface-raised text-text font-bold text-lg active:scale-95 disabled:opacity-30"
                          aria-label={`Restar ${d.label}`}
                        >
                          -
                        </button>
                        <span className="w-10 text-center font-mono font-bold text-base text-text">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdatePieza(d.label, 1)}
                          className="w-10 h-10 flex items-center justify-center rounded-lg border border-border-control bg-surface-raised text-text font-bold text-lg active:scale-95"
                          aria-label={`Sumar ${d.label}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-4 bg-surface-raised rounded-xl border-2 border-border-control">
              <label htmlFor="direct-amount" className="text-xs font-bold text-text uppercase">
                Total de Efectivo Físico Contado ($):
              </label>
              <input
                id="direct-amount"
                type="text"
                value={directDeclaredString}
                onChange={(e) => setDirectDeclaredString(e.target.value)}
                placeholder="0.0000"
                className="min-h-[56px] text-2xl font-mono font-bold px-4 bg-surface rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
              />
            </div>
          )}

          {/* Declared Total Preview */}
          <div className="p-4 bg-surface rounded-xl border-2 border-primary/30 flex items-center justify-between">
            <span className="text-sm font-extrabold text-text uppercase">Total Físico Declarado:</span>
            <div className="text-2xl font-black text-text">
              <MoneyText amount={totalDeclaradoString} size="2xl" />
            </div>
          </div>

          {/* PIN Input */}
          <div className="flex items-center justify-between gap-3 p-3 bg-surface-raised rounded-lg border border-border-control">
            <label htmlFor="pin-arqueo" className="text-xs font-bold text-text-muted uppercase">
              PIN de Cajero Responsable:
            </label>
            <input
              id="pin-arqueo"
              type="password"
              maxLength={6}
              value={operatorPin}
              onChange={(e) => setOperatorPin(e.target.value)}
              className="w-28 min-h-[44px] text-center font-mono tracking-widest text-lg bg-surface rounded-lg border-2 border-border-control text-text focus:outline-none focus:ring-2 focus:ring-focus"
            />
          </div>

          {errorMessage && (
            <div className="p-3 bg-danger-soft border-2 border-danger rounded-lg text-danger-strong text-sm font-semibold">
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Confirm Button */}
          <div className="pt-2 flex justify-end gap-3">
            <Button intent="neutral" tone="outline" size="lg" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button
              intent="primary"
              tone="solid"
              size="lg"
              onClick={handleConfirmArqueo}
              disabled={isSubmitting}
              className="min-h-[56px] px-8 font-bold"
            >
              {isSubmitting ? 'Registrando Arqueo...' : 'Confirmar Arqueo Ciego'}
            </Button>
          </div>
        </div>
      ) : (
        /* Reconciliation Step */
        <div className="flex flex-col gap-5 overflow-y-auto">
          {arqueoResult && (
            <>
              {/* Difference Status Banner */}
              {arqueoResult.arqueo.difference === '0.0000' ? (
                <div className="p-4 bg-success-soft border-2 border-success rounded-xl text-success-strong flex items-center gap-3">
                  <span className="text-3xl">✅</span>
                  <div>
                    <h3 className="text-base font-extrabold">Cuadre Exacto de Caja</h3>
                    <p className="text-xs">
                      El efectivo físico contado coincide exactamente con el total registrado por el sistema.
                    </p>
                  </div>
                </div>
              ) : arqueoResult.arqueo.difference.startsWith('-') ? (
                <div className="p-4 bg-danger-soft border-2 border-danger rounded-xl text-danger-strong flex items-center gap-3">
                  <span className="text-3xl">⚠️</span>
                  <div>
                    <h3 className="text-base font-extrabold">Faltante de Efectivo Detectado</h3>
                    <p className="text-xs">
                      El efectivo físico declarado es menor que el saldo esperado por el sistema.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-primary-soft border-2 border-primary rounded-xl text-primary-strong flex items-center gap-3">
                  <span className="text-3xl">ℹ️</span>
                  <div>
                    <h3 className="text-base font-extrabold">Sobrante de Efectivo Detectado</h3>
                    <p className="text-xs">
                      El efectivo físico declarado supera el saldo esperado por el sistema.
                    </p>
                  </div>
                </div>
              )}

              {/* Numbers Comparison */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 bg-surface rounded-xl border border-border-control">
                  <span className="text-xs font-bold text-text-muted uppercase block">Declarado</span>
                  <div className="text-xl font-black text-text mt-1">
                    <MoneyText amount={arqueoResult.arqueo.declaredCash} size="xl" />
                  </div>
                </div>

                <div className="p-4 bg-surface rounded-xl border border-border-control">
                  <span className="text-xs font-bold text-text-muted uppercase block">Calculado Sistema</span>
                  <div className="text-xl font-black text-text mt-1">
                    <MoneyText amount={arqueoResult.arqueo.calculatedCash} size="xl" />
                  </div>
                </div>

                <div className="p-4 bg-surface rounded-xl border border-border-control">
                  <span className="text-xs font-bold text-text-muted uppercase block">Diferencia</span>
                  <div
                    className={`text-xl font-black mt-1 ${
                      arqueoResult.arqueo.difference === '0.0000'
                        ? 'text-success-strong'
                        : arqueoResult.arqueo.difference.startsWith('-')
                          ? 'text-danger-strong'
                          : 'text-primary'
                    }`}
                  >
                    <MoneyText amount={arqueoResult.arqueo.difference} size="xl" />
                  </div>
                </div>
              </div>

              {corteZSuccess ? (
                <div className="p-4 bg-success-soft border border-success rounded-xl text-success-strong font-bold text-center">
                  🎉 Corte Z emitido y Turno de Caja Cerrado Definitivamente.
                </div>
              ) : (
                <div className="flex flex-col gap-3 pt-3 border-t border-border">
                  <p className="text-xs text-text-muted">
                    El arqueo ha sido registrado en el log inmutable. Ahora puede emitir el Corte Z definitivo para cerrar el turno de caja.
                  </p>
                  <Button
                    intent="danger"
                    tone="solid"
                    size="xl"
                    onClick={handleConfirmCorteZ}
                    disabled={isSubmitting}
                    className="min-h-[64px] font-extrabold text-lg"
                  >
                    {isSubmitting ? 'Cerrando Turno...' : 'Emitir Corte Z y Cerrar Turno'}
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end pt-2">
            <Button intent="neutral" tone="outline" size="md" onClick={onClose}>
              Finalizar y Salir
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
