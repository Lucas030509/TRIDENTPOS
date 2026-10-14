/**
 * TRIDENTPOS WP-025: DEC-011 / OQ-SSOT-02 Table Transfer with Receiver PIN Modal
 * Transfers table account only upon successful authentication of the receiving waiter's PIN.
 */

import React, { useState } from 'react';
import type { DiningTable } from '../types.js';
import { TableTransferService } from '../services/table-transfer-service.js';

export interface TableTransferModalProps {
  table: DiningTable;
  currentWaiterId: string;
  tableTransferService: TableTransferService;
  onClose: () => void;
  onSuccess: (newWaiterId: string) => void;
}

export function TableTransferModal({
  table,
  currentWaiterId,
  tableTransferService,
  onClose,
  onSuccess,
}: TableTransferModalProps): React.JSX.Element {
  const availableWaiters = tableTransferService.getAvailableWaiters(currentWaiterId);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string>(
    availableWaiters[0]?.id || '',
  );
  const [receiverPin, setReceiverPin] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleKeypadPress = (digit: string) => {
    if (receiverPin.length < 6) {
      setReceiverPin(receiverPin + digit);
    }
  };

  const handleBackspace = () => {
    setReceiverPin(receiverPin.slice(0, -1));
  };

  const handleConfirmTransfer = async () => {
    if (!selectedReceiverId || !receiverPin) {
      setErrorMessage('Seleccione un mesero receptor e ingrese su PIN.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await tableTransferService.transferTable({
        tableId: table.id,
        fromWaiterId: currentWaiterId,
        toWaiterId: selectedReceiverId,
        receiverPin,
      });

      if (res.success) {
        onSuccess(selectedReceiverId);
        onClose();
      } else {
        setErrorMessage(res.error || 'Error en transferencia. PIN rechazado.');
        setReceiverPin('');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error inesperado.');
      setReceiverPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-white">Transferir Mesa {table.code}</h3>
            <span className="text-[11px] text-neutral-400">
              Requiere PIN del mesero receptor (DEC-011)
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

        {/* Receiver Waiter Selector */}
        <div className="space-y-1">
          <label className="text-[11px] text-neutral-400 block font-semibold">
            Mesero Receptor:
          </label>
          <select
            value={selectedReceiverId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedReceiverId(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 px-3 py-2 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
          >
            {availableWaiters.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {/* PIN Dots Display */}
        <div className="flex flex-col items-center py-2 space-y-2">
          <span className="text-[11px] text-neutral-400 font-medium">
            PIN del Mesero Receptor:
          </span>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full border transition-all ${
                  receiverPin.length > idx
                    ? 'bg-amber-400 border-amber-400 scale-110 shadow-sm'
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
            Cancelar
          </button>
          <button
            disabled={!selectedReceiverId || receiverPin.length < 4 || isSubmitting}
            onClick={handleConfirmTransfer}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
              !selectedReceiverId || receiverPin.length < 4 || isSubmitting
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-500 text-white active:scale-95'
            }`}
          >
            {isSubmitting ? 'Verificando...' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  );
}
