/**
 * TRIDENTPOS WP-025: DEC-015 / OQ-SSOT-06 Proportional Bill Splitting Modal
 * Handheld modal for splitting table accounts proportionally with zero float drift.
 */

import React, { useState } from 'react';
import type { DiningTable } from '../types.js';
import { formatCurrencyScale4 } from '../numerics.js';
import { BillSplitService } from '../services/bill-split-service.js';

export interface BillSplitModalProps {
  table: DiningTable;
  billSplitService: BillSplitService;
  onClose: () => void;
  onConfirmSplit?: (splitResult: unknown) => void;
}

export function BillSplitModal({
  table,
  billSplitService,
  onClose,
  onConfirmSplit,
}: BillSplitModalProps): React.JSX.Element {
  const [splitCount, setSplitCount] = useState<number>(2);
  const [tipScale4, setTipScale4] = useState<string>('0.0000');
  const [discountScale4, setDiscountScale4] = useState<string>('0.0000');

  const splitResult = billSplitService.splitTableBill({
    table,
    mode: 'EQUAL',
    splitCount,
    totalDiscountScale4: discountScale4,
    totalTipScale4: tipScale4,
  });

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-white">Dividir Cuenta — Mesa {table.code}</h3>
            <span className="text-xs text-neutral-400">
              Total Original: {formatCurrencyScale4(table.totalBalanceScale4)}
            </span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-sm">
            ✕
          </button>
        </div>

        {/* Number of Accounts Stepper */}
        <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-300">Número de Cuentas:</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSplitCount(Math.max(2, splitCount - 1))}
              className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm flex items-center justify-center"
            >
              -
            </button>
            <span className="text-base font-mono font-bold text-blue-400 w-6 text-center">
              {splitCount}
            </span>
            <button
              onClick={() => setSplitCount(Math.min(20, splitCount + 1))}
              className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>

        {/* Tip & Discount Modifiers */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <label className="text-[11px] text-neutral-400 block mb-1">Propina Total ($)</label>
            <input
              type="text"
              value={tipScale4}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTipScale4(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded font-mono text-xs text-white"
            />
          </div>
          <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <label className="text-[11px] text-neutral-400 block mb-1">Descuento Total ($)</label>
            <input
              type="text"
              value={discountScale4}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDiscountScale4(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded font-mono text-xs text-white"
            />
          </div>
        </div>

        {/* Subaccounts Preview */}
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {splitResult.subAccounts.map((sub, idx) => (
            <div
              key={sub.subAccountId}
              className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800/80 flex justify-between items-center text-xs"
            >
              <div className="space-y-0.5">
                <span className="font-semibold text-neutral-200">{sub.label}</span>
                {idx === splitResult.subAccounts.length - 1 &&
                  splitResult.roundingResidueScale4 !== '0.0000' && (
                    <span className="text-[10px] text-neutral-500 block">
                      (Ajuste residuo: {splitResult.roundingResidueScale4})
                    </span>
                  )}
              </div>
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {formatCurrencyScale4(sub.totalToPayScale4)}
              </span>
            </div>
          ))}
        </div>

        {/* Invariant Verification Banner */}
        <div className="p-2.5 bg-neutral-950 border border-neutral-800 rounded-lg flex justify-between items-center text-[11px]">
          <span className="text-neutral-400">Suma Subcuentas:</span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white">
              {formatCurrencyScale4(splitResult.sumOfSubAccountsScale4)}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                splitResult.balanced
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950 text-rose-400 border border-rose-800'
              }`}
            >
              {splitResult.balanced ? 'EXACTO 100%' : 'DESCUADRE'}
            </span>
          </div>
        </div>

        <div className="pt-2 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-xs font-semibold text-neutral-300"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onConfirmSplit?.(splitResult);
              onClose();
            }}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-bold text-white shadow-md"
          >
            Confirmar División
          </button>
        </div>
      </div>
    </div>
  );
}
