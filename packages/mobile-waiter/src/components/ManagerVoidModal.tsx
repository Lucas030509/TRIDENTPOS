/**
 * TRIDENTPOS WP-025: DEC-013 / OQ-SSOT-04 Manager Void from Mobile Modal
 * Requires manager PIN authentication and mandatory reason code before voiding a table account.
 */

import React, { useState } from 'react';
import type { DiningTable } from '../types.js';
import { MobileVoidService, CANCELLATION_REASONS } from '../services/mobile-void-service.js';

export interface ManagerVoidModalProps {
  table: DiningTable;
  mobileVoidService: MobileVoidService;
  onClose: () => void;
  onSuccess: (folioAnnulled?: string) => void;
}

export function ManagerVoidModal({
  table,
  mobileVoidService,
  onClose,
  onSuccess,
}: ManagerVoidModalProps): React.JSX.Element {
  const [reasonCode, setReasonCode] = useState<string>(CANCELLATION_REASONS[0]?.code || '');
  const [reasonNotes, setReasonNotes] = useState<string>('');
  const [managerPin, setManagerPin] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleKeypadPress = (digit: string) => {
    if (managerPin.length < 6) {
      setManagerPin(managerPin + digit);
    }
  };

  const handleBackspace = () => {
    setManagerPin(managerPin.slice(0, -1));
  };

  const handleConfirmVoid = async () => {
    if (!reasonCode || managerPin.length < 4) {
      setErrorMessage('Seleccione un motivo e ingrese el PIN de gerente.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await mobileVoidService.voidAccount({
        tableId: table.id,
        accountId: table.activeAccountId || `acc-${table.id}`,
        managerPin,
        reasonCode,
        reasonNotes,
        hadPrecuentaPrinted: table.status === 'PRINTED',
      });

      if (res.success) {
        onSuccess(res.folioAnnulled);
        onClose();
      } else {
        setErrorMessage(res.error || 'Autorización denegada. PIN de gerente inválido.');
        setManagerPin('');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error inesperado.');
      setManagerPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-rose-400">Cancelar Cuenta — Mesa {table.code}</h3>
            <span className="text-[11px] text-neutral-400">
              Requiere PIN de Gerente / Supervisor (DEC-013)
            </span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-sm">
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-2.5 bg-rose-950/90 border border-rose-800 rounded-lg text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Reason Code Picker */}
        <div className="space-y-1">
          <label className="text-[11px] text-neutral-400 block font-semibold">
            Motivo de Cancelación (Catálogo Obligatorio):
          </label>
          <select
            value={reasonCode}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setReasonCode(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 px-3 py-2 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-rose-500"
          >
            {CANCELLATION_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* Reason Notes */}
        <div className="space-y-1">
          <label className="text-[11px] text-neutral-400 block font-semibold">Observaciones:</label>
          <input
            type="text"
            value={reasonNotes}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReasonNotes(e.target.value)}
            placeholder="Detalle adicional de la cancelación..."
            className="w-full bg-neutral-950 border border-neutral-700 px-3 py-1.5 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
          />
        </div>

        {/* PIN Dots Display */}
        <div className="flex flex-col items-center py-1 space-y-2">
          <span className="text-[11px] text-neutral-400 font-medium">PIN de Gerente:</span>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full border transition-all ${
                  managerPin.length > idx
                    ? 'bg-rose-400 border-rose-400 scale-110 shadow-sm'
                    : 'bg-neutral-800 border-neutral-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Numeric Touch Keypad */}
        <div className="grid grid-cols-3 gap-2 py-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => {
            if (!key) return <div key={i} />;
            const isBack = key === '⌫';
            return (
              <button
                key={key}
                type="button"
                onClick={() => (isBack ? handleBackspace() : handleKeypadPress(key))}
                className="h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 transition-all text-sm font-bold text-white flex items-center justify-center border border-neutral-700/60"
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="pt-2 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-xs font-semibold text-neutral-300"
          >
            Atrás
          </button>
          <button
            disabled={!reasonCode || managerPin.length < 4 || isSubmitting}
            onClick={handleConfirmVoid}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
              !reasonCode || managerPin.length < 4 || isSubmitting
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-rose-600 hover:bg-rose-500 text-white active:scale-95'
            }`}
          >
            {isSubmitting ? 'Cancelando...' : 'Autorizar Anulación'}
          </button>
        </div>
      </div>
    </div>
  );
}
