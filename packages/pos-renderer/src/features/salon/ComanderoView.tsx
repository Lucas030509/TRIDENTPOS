import * as React from 'react';
import {
  Button,
  Badge,
  MoneyText,
  ConflictNotice,
  SupervisorPinDialog,
  Skeleton,
} from '@trident/ui';
import {
  getTridentBridge,
  CatalogCategoryDTO,
  CatalogProductDTO,
  CuentaDetalleDTO,
  CuentaItemDTO,
  MesaSummaryDTO,
} from '../../bridge/trident-bridge.js';
import { ModifierSelectorDialog, SelectedModifier } from './ModifierSelectorDialog.js';
import { CancelItemDialog } from './CancelItemDialog.js';
import { TransferTableDialog } from './TransferTableDialog.js';
import { ChangeGuestsDialog } from './ChangeGuestsDialog.js';
import { SplitAccountDialog } from './SplitAccountDialog.js';

export interface DraftItem {
  readonly clientItemId: string;
  readonly product: CatalogProductDTO;
  readonly quantity: number;
  readonly modifiers: readonly SelectedModifier[];
  readonly notes?: string;
  readonly unitPriceApplied: string;
  readonly taxRateApplied: string;
}

export interface ComanderoViewProps {
  readonly mesaId: string;
  readonly cuentaId: string;
  readonly allTables: readonly MesaSummaryDTO[];
  readonly onBackToSalon: () => void;
}

export function ComanderoView({
  mesaId,
  cuentaId,
  allTables,
  onBackToSalon,
}: ComanderoViewProps): React.JSX.Element {
  const bridge = getTridentBridge();

  // Data states
  const [cuenta, setCuenta] = React.useState<CuentaDetalleDTO | null>(null);
  const [categories, setCategories] = React.useState<readonly CatalogCategoryDTO[]>([]);
  const [products, setProducts] = React.useState<readonly CatalogProductDTO[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [draftItems, setDraftItems] = React.useState<readonly DraftItem[]>([]);

  // Loading & conflict states
  const [isLoadingCuenta, setIsLoadingCuenta] = React.useState<boolean>(true);
  const [isSendingToKitchen, setIsSendingToKitchen] = React.useState<boolean>(false);
  const [conflictError, setConflictError] = React.useState<{
    expected: number;
    actual: number;
  } | null>(null);
  const [generalError, setGeneralError] = React.useState<string | null>(null);

  // Dialog states
  const [activeProductForModifiers, setActiveProductForModifiers] =
    React.useState<CatalogProductDTO | null>(null);
  const [itemToCancel, setItemToCancel] = React.useState<CuentaItemDTO | null>(null);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = React.useState<boolean>(false);
  const [isChangeGuestsOpen, setIsChangeGuestsOpen] = React.useState<boolean>(false);
  const [isSplitDialogOpen, setIsSplitDialogOpen] = React.useState<boolean>(false);
  const [isSupervisorPinOpen, setIsSupervisorPinOpen] = React.useState<boolean>(false);

  // Load Cuenta Detalle & Catalog
  const reloadCuenta = React.useCallback(async () => {
    setIsLoadingCuenta(true);
    setConflictError(null);
    setGeneralError(null);
    const res = await bridge.salon.getCuentaDetalle(cuentaId);
    if (res.ok) {
      setCuenta(res.data);
    } else {
      setGeneralError(res.error.message);
    }
    setIsLoadingCuenta(false);
  }, [bridge, cuentaId]);

  React.useEffect(() => {
    let mounted = true;

    // Load catalog
    bridge.salon.getCatalog().then((catRes) => {
      if (mounted && catRes.ok) {
        setCategories(catRes.data.categories);
        setProducts(catRes.data.products);
        if (catRes.data.categories.length > 0 && catRes.data.categories[0]) {
          setSelectedCategoryId(catRes.data.categories[0].id);
        }
      }
    });

    // Load account
    reloadCuenta();

    return () => {
      mounted = false;
    };
  }, [bridge, reloadCuenta]);

  // Filter products by selected category
  const filteredProducts = React.useMemo(() => {
    if (!selectedCategoryId) return products;
    return products.filter((p) => p.categoryId === selectedCategoryId);
  }, [products, selectedCategoryId]);

  // Add product to draft items (either directly or via modifier dialog)
  const handleSelectProduct = (product: CatalogProductDTO) => {
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      setActiveProductForModifiers(product);
    } else {
      // Add directly
      setDraftItems((prev) => {
        const existingIdx = prev.findIndex(
          (i) => i.product.id === product.id && i.modifiers.length === 0 && !i.notes,
        );
        if (existingIdx >= 0 && prev[existingIdx]) {
          const updated = [...prev];
          const curr = prev[existingIdx]!;
          updated[existingIdx] = {
            ...curr,
            quantity: curr.quantity + 1,
          };
          return updated;
        }
        return [
          ...prev,
          {
            clientItemId: `draft-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            product,
            quantity: 1,
            modifiers: [],
            unitPriceApplied: product.basePrice,
            taxRateApplied: product.taxRate,
          },
        ];
      });
    }
  };

  const handleConfirmModifiers = ({
    product,
    modifiers,
    notes,
  }: {
    product: CatalogProductDTO;
    modifiers: readonly SelectedModifier[];
    notes?: string;
  }) => {
    setDraftItems((prev) => [
      ...prev,
      {
        clientItemId: `draft-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        product,
        quantity: 1,
        modifiers,
        notes,
        unitPriceApplied: product.basePrice,
        taxRateApplied: product.taxRate,
      },
    ]);
    setActiveProductForModifiers(null);
  };

  const updateDraftQuantity = (clientItemId: string, delta: number) => {
    setDraftItems((prev) =>
      prev
        .map((item) => {
          if (item.clientItemId === clientItemId) {
            const newQ = item.quantity + delta;
            return newQ > 0 ? { ...item, quantity: newQ } : null;
          }
          return item;
        })
        .filter((item): item is DraftItem => item !== null),
    );
  };

  // Dispatch draft items to kitchen
  const handleSendToKitchen = async () => {
    if (!cuenta || draftItems.length === 0 || isSendingToKitchen) return;

    setIsSendingToKitchen(true);
    setGeneralError(null);

    const payloadItems = draftItems.map((item) => ({
      productId: item.product.id,
      productNameSnapshot: item.product.name,
      unitPriceApplied: item.unitPriceApplied,
      quantity: `${item.quantity}.0000`,
      taxRateApplied: item.taxRateApplied,
      notes: item.notes,
      modifiers: item.modifiers,
    }));

    const res = await bridge.salon.enviarComanda({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      items: payloadItems,
    });

    if (res.ok) {
      setCuenta(res.data);
      setDraftItems([]);
    } else {
      if (res.error.code === 'CONFLICT_VERSION') {
        setConflictError({
          expected: cuenta.version,
          actual: res.error.conflict?.serverVersion ?? cuenta.version + 1,
        });
      } else {
        setGeneralError(res.error.message);
      }
    }
    setIsSendingToKitchen(false);
  };

  // Cancel sent item (DEC-010)
  const handleConfirmCancelItem = async (reason: string, supervisorPin?: string) => {
    if (!cuenta || !itemToCancel) return;

    const res = await bridge.salon.cancelItem({
      cuentaId: cuenta.id,
      itemId: itemToCancel.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      reason,
      operatorUserId: cuenta.openedByUserId,
      operatorPin: '1234',
      supervisorPin,
    });

    if (res.ok) {
      setItemToCancel(null);
      await reloadCuenta();
    } else {
      if (res.error.code === 'CONFLICT_VERSION') {
        setConflictError({
          expected: cuenta.version,
          actual: res.error.conflict?.serverVersion ?? cuenta.version + 1,
        });
      } else {
        setGeneralError(res.error.message);
      }
    }
  };

  // Request Check (Precuenta)
  const handleRequestCheck = async () => {
    if (!cuenta) return;
    const res = await bridge.salon.requestCheck({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      requestedByUserId: cuenta.openedByUserId,
    });
    if (res.ok) {
      await reloadCuenta();
    } else {
      setGeneralError(res.error.message);
    }
  };

  // Transfer Table (DEC-011)
  const handleTransferTable = async (targetMesaId: string, reason?: string) => {
    if (!cuenta) return;
    const res = await bridge.salon.transferCuenta({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      sourceMesaId: mesaId,
      targetMesaId,
      sourceWaiterUserId: cuenta.currentWaiterUserId ?? 'usr-1',
      targetWaiterUserId: cuenta.currentWaiterUserId ?? 'usr-1',
      targetWaiterPin: '1234',
      reason,
    });
    if (res.ok) {
      setIsTransferDialogOpen(false);
      onBackToSalon();
    } else {
      setGeneralError(res.error.message);
    }
  };

  // Change Guest Count
  const handleChangeGuests = async (count: number) => {
    if (!cuenta) return;
    const res = await bridge.salon.changeGuestCount({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      guestCount: count,
      performedByUserId: cuenta.openedByUserId,
    });
    if (res.ok) {
      setIsChangeGuestsOpen(false);
      await reloadCuenta();
    } else {
      setGeneralError(res.error.message);
    }
  };

  // Split Account (DEC-015)
  const handleSplitEqualParts = async (parts: number) => {
    if (!cuenta) return;
    const ratio = (10000 / parts / 10000).toFixed(4);
    const partitions = Array.from({ length: parts }).map((_, idx) => ({
      partitionId: `part-${idx + 1}`,
      ratioScale4: ratio,
    }));

    const res = await bridge.salon.splitCuenta({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      splitType: 'EQUAL_PARTS',
      partitions,
      performedByUserId: cuenta.openedByUserId,
      operatorPin: '1234',
    });
    if (res.ok) {
      setIsSplitDialogOpen(false);
      await reloadCuenta();
    } else {
      setGeneralError(res.error.message);
    }
  };

  const handleSplitByItems = async (itemIds: readonly string[]) => {
    if (!cuenta) return;
    const partitions = [
      { partitionId: 'part-selected', itemIds: [...itemIds] },
      { partitionId: 'part-remaining' },
    ];
    const res = await bridge.salon.splitCuenta({
      cuentaId: cuenta.id,
      expectedVersion: cuenta.version,
      clientOpId: `op-${Date.now()}`,
      splitType: 'BY_ITEMS',
      partitions,
      performedByUserId: cuenta.openedByUserId,
      operatorPin: '1234',
    });
    if (res.ok) {
      setIsSplitDialogOpen(false);
      await reloadCuenta();
    } else {
      setGeneralError(res.error.message);
    }
  };

  // Calculate Draft Totals
  const draftSubtotalScale4 = React.useMemo(() => {
    let sum = 0n;
    draftItems.forEach((item) => {
      const unitP = BigInt(Math.round(parseFloat(item.unitPriceApplied) * 10000));
      let modSum = 0n;
      item.modifiers.forEach((m) => {
        modSum += BigInt(Math.round(parseFloat(m.modifierPriceApplied) * 10000));
      });
      const q = BigInt(item.quantity);
      sum += (unitP + modSum) * q;
    });
    return (Number(sum) / 10000).toFixed(4);
  }, [draftItems]);

  const grandTotalScale4 = React.useMemo(() => {
    if (!cuenta) return '0.0000';
    const cTotal = BigInt(Math.round(parseFloat(cuenta.totalAmount) * 10000));
    const dSub = BigInt(Math.round(parseFloat(draftSubtotalScale4) * 10000));
    const dTax = (dSub * 1600n) / 10000n; // 16% standard tax
    return (Number(cTotal + dSub + dTax) / 10000).toFixed(4);
  }, [cuenta, draftSubtotalScale4]);

  if (isLoadingCuenta && !cuenta) {
    return (
      <div className="flex-1 flex flex-col p-6 bg-bg h-full gap-4">
        <Skeleton width="40%" height="40px" />
        <div className="grid grid-cols-12 gap-6 flex-1">
          <div className="col-span-7 flex flex-col gap-4">
            <Skeleton width="100%" height="56px" />
            <Skeleton width="100%" height="400px" />
          </div>
          <div className="col-span-5 flex flex-col gap-4">
            <Skeleton width="100%" height="100%" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-bg overflow-hidden select-none">
      {/* Top Header Bar */}
      <header className="h-16 px-6 bg-surface border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Button
            type="button"
            intent="secondary"
            size="md"
            onClick={onBackToSalon}
            aria-label="Volver al Salón de Mesas"
          >
            ← Salón
          </Button>

          <div className="flex items-center gap-3">
            <span className="text-xl font-black text-text">Mesa {cuenta?.tableNumber ?? ''}</span>
            <span className="text-xs text-text-muted">({cuenta?.roomName ?? 'Salón'})</span>
            <Badge state={cuenta?.status === 'IMPRESA' ? 'EN_CUENTA' : 'OCUPADA'} size="sm" />
          </div>
        </div>

        {/* Account Details & Quick Guest Count */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsChangeGuestsOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border-control bg-surface-raised hover:bg-surface text-xs font-semibold text-text active:scale-95 transition-all"
            aria-label="Modificar comensales"
          >
            <span>👥 {cuenta?.guestCount ?? 1} comensales</span>
            <span className="text-text-muted">✎</span>
          </button>

          {cuenta?.folioNumber && (
            <span className="text-xs font-mono text-text-muted">Folio #{cuenta.folioNumber}</span>
          )}
        </div>
      </header>

      {/* Conflict / General Error Banners */}
      {conflictError && (
        <div className="p-4 bg-surface border-b border-warning">
          <ConflictNotice
            expectedVersion={conflictError.expected}
            serverVersion={conflictError.actual}
            onRefresh={reloadCuenta}
          />
        </div>
      )}

      {generalError && (
        <div
          role="alert"
          className="p-3 bg-danger-soft border-b border-danger text-xs font-bold text-danger-text flex items-center justify-between"
        >
          <span>Error: {generalError}</span>
          <Button type="button" intent="secondary" size="md" onClick={() => setGeneralError(null)}>
            Cerrar
          </Button>
        </div>
      )}

      {/* Main Split Layout: Left Menu (60%), Right Order (40%) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Catalog Categories & Products */}
        <section
          aria-label="Catálogo de Menú"
          className="w-[60%] flex flex-col border-r border-border bg-bg p-4 overflow-hidden"
        >
          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-3 shrink-0 scrollbar-none">
            {categories.map((cat) => {
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`h-12 px-5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border-2 active:scale-95 ${
                    isSelected
                      ? 'bg-brand text-brand-contrast border-brand shadow-sm'
                      : 'bg-surface text-text border-border-control hover:bg-surface-raised'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>

          {/* Product Cards Grid */}
          <div className="flex-1 overflow-y-auto pt-1 pr-1">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleSelectProduct(product)}
                  className="min-h-[110px] p-4 rounded-2xl border-2 border-border-control bg-surface hover:bg-surface-raised hover:border-brand/60 flex flex-col justify-between text-left transition-all active:scale-[0.98] shadow-sm focus:outline-none focus:ring-2 focus:ring-focus"
                >
                  <div>
                    <span className="text-base font-black text-text block line-clamp-2">
                      {product.name}
                    </span>
                    {product.description && (
                      <span className="text-xs text-text-muted block mt-1 line-clamp-1">
                        {product.description}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between">
                    <span className="text-sm font-black font-mono text-brand">
                      <MoneyText amount={product.basePrice} />
                    </span>
                    {product.modifierGroups && product.modifierGroups.length > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-brand-soft text-brand-text">
                        Opciones
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Order Ticket & Totals */}
        <section
          aria-label="Comanda y Partidas"
          className="w-[40%] flex flex-col bg-surface overflow-hidden"
        >
          {/* Header of Order */}
          <div className="p-4 border-b border-border bg-surface-raised flex items-center justify-between shrink-0">
            <span className="font-bold text-text text-sm uppercase tracking-wider">
              Partidas de la Cuenta
            </span>
            <span className="text-xs text-text-muted">
              {cuenta?.items.filter((i) => i.status !== 'CANCELADO').length ?? 0} enviadas ·{' '}
              {draftItems.length} pendientes
            </span>
          </div>

          {/* Order Items List */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {/* 1. Sent to Kitchen Items */}
            {cuenta?.items.map((item) => {
              const isCancelled = item.status === 'CANCELADO';
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-1.5 ${
                    isCancelled
                      ? 'border-border/40 bg-surface/50 opacity-60 line-through'
                      : 'border-border bg-surface hover:border-border-control'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-text">
                          {item.quantity}x {item.productNameSnapshot}
                        </span>
                        <Badge
                          state={isCancelled ? 'BLOQUEADA' : 'OCUPADA'}
                          label={item.status}
                          size="sm"
                          showIcon={false}
                        />
                      </div>

                      {item.modifiers.length > 0 && (
                        <div className="text-xs text-text-muted mt-0.5 pl-2 border-l border-border">
                          {item.modifiers.map((m) => m.modifierNameSnapshot).join(', ')}
                        </div>
                      )}

                      {item.notes && (
                        <div className="text-xs text-brand font-medium italic mt-0.5">
                          Nota: {item.notes}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-sm font-mono font-bold text-text block">
                        <MoneyText amount={item.total} />
                      </span>
                      {!isCancelled && (
                        <button
                          type="button"
                          onClick={() => setItemToCancel(item)}
                          className="text-[11px] font-bold text-danger hover:underline mt-1"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 2. Draft / Pending Items */}
            {draftItems.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-brand/50">
                <span className="text-xs font-bold text-brand uppercase tracking-wider block mb-2">
                  Nuevas por enviar a cocina ({draftItems.length}):
                </span>

                <div className="flex flex-col gap-2">
                  {draftItems.map((item) => (
                    <div
                      key={item.clientItemId}
                      className="p-3 rounded-xl border-2 border-brand/40 bg-brand-soft/20 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1">
                        <span className="text-sm font-bold text-text block">
                          {item.quantity}x {item.product.name}
                        </span>
                        {item.modifiers.length > 0 && (
                          <span className="text-xs text-text-muted block">
                            {item.modifiers.map((m) => m.modifierNameSnapshot).join(', ')}
                          </span>
                        )}
                        {item.notes && (
                          <span className="text-xs text-brand italic block">
                            Nota: {item.notes}
                          </span>
                        )}
                      </div>

                      {/* Stepper controls */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateDraftQuantity(item.clientItemId, -1)}
                          className="w-8 h-8 rounded-lg border border-border-control bg-surface flex items-center justify-center font-bold text-text text-base active:scale-95"
                          aria-label="Restar 1"
                        >
                          −
                        </button>
                        <span className="font-mono font-bold text-sm w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateDraftQuantity(item.clientItemId, 1)}
                          className="w-8 h-8 rounded-lg border border-border-control bg-surface flex items-center justify-center font-bold text-text text-base active:scale-95"
                          aria-label="Sumar 1"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Financial Totals & Actions Footer */}
          <div className="p-4 border-t border-border bg-surface-raised shrink-0 flex flex-col gap-3">
            {/* Subtotal & Tax breakdown */}
            <div className="flex flex-col gap-1 text-xs text-text-muted">
              <div className="flex items-center justify-between">
                <span>Subtotal Cuenta:</span>
                <span className="font-mono text-text">
                  <MoneyText amount={cuenta?.subtotal ?? '0.0000'} />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>IVA (16%):</span>
                <span className="font-mono text-text">
                  <MoneyText amount={cuenta?.taxTotal ?? '0.0000'} />
                </span>
              </div>
              {draftItems.length > 0 && (
                <div className="flex items-center justify-between text-brand font-semibold">
                  <span>Adicionales pendientes:</span>
                  <span className="font-mono">
                    +<MoneyText amount={draftSubtotalScale4} />
                  </span>
                </div>
              )}
            </div>

            {/* Grand Total */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-base font-black text-text">TOTAL:</span>
              <span className="text-2xl font-black text-text font-mono">
                <MoneyText amount={grandTotalScale4} />
              </span>
            </div>

            {/* Primary Action: Send to Kitchen */}
            <Button
              type="button"
              intent="primary"
              size="lg"
              disabled={draftItems.length === 0 || isSendingToKitchen}
              isLoading={isSendingToKitchen}
              onClick={handleSendToKitchen}
              className="w-full h-14 text-base font-bold shadow-md"
            >
              {draftItems.length > 0
                ? `Enviar ${draftItems.length} Partidas a Cocina`
                : 'Sin Partidas Nuevas'}
            </Button>

            {/* Operational Action Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                intent="secondary"
                size="md"
                onClick={handleRequestCheck}
                disabled={cuenta?.status === 'IMPRESA'}
              >
                Precuenta
              </Button>
              <Button
                type="button"
                intent="secondary"
                size="md"
                onClick={() => setIsTransferDialogOpen(true)}
              >
                Transferir
              </Button>
              <Button
                type="button"
                intent="secondary"
                size="md"
                onClick={() => setIsSplitDialogOpen(true)}
              >
                Dividir
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* Sub-Dialogs */}
      <ModifierSelectorDialog
        product={activeProductForModifiers}
        isOpen={activeProductForModifiers !== null}
        onClose={() => setActiveProductForModifiers(null)}
        onConfirm={handleConfirmModifiers}
      />

      <CancelItemDialog
        item={itemToCancel}
        isOpen={itemToCancel !== null}
        onClose={() => setItemToCancel(null)}
        onConfirm={handleConfirmCancelItem}
      />

      <TransferTableDialog
        isOpen={isTransferDialogOpen}
        currentMesaId={mesaId}
        availableTables={allTables}
        onClose={() => setIsTransferDialogOpen(false)}
        onConfirm={handleTransferTable}
      />

      <ChangeGuestsDialog
        currentCount={cuenta?.guestCount ?? 1}
        isOpen={isChangeGuestsOpen}
        onClose={() => setIsChangeGuestsOpen(false)}
        onConfirm={handleChangeGuests}
      />

      <SplitAccountDialog
        cuenta={cuenta}
        isOpen={isSplitDialogOpen}
        onClose={() => setIsSplitDialogOpen(false)}
        onConfirmEqualParts={handleSplitEqualParts}
        onConfirmByItems={handleSplitByItems}
      />

      <SupervisorPinDialog
        isOpen={isSupervisorPinOpen}
        requiredActionDescription="Autorizar Operación Crítica de Salón"
        onClose={() => setIsSupervisorPinOpen(false)}
        onAuthorize={async () => {
          setIsSupervisorPinOpen(false);
        }}
      />
    </div>
  );
}
