/**
 * TRIDENTPOS POS Dining Room & Account Domain Service
 * Pure business domain implementation per ADR-012, ADR-013, and DATA_MODEL.md.
 * Strictly uses scale-4 bigint for all financial arithmetic — zero floating point.
 */

import {
  calculateLineSubtotal,
  calculateNetSubtotal,
  calculateTaxAmount,
  calculateLineTotal,
} from '@trident/core';
import type { AccountType, Cuenta, CuentaItem, CuentaItemModificador, Mesa } from './types.js';
import { DomainError, OCCConflictError } from './errors.js';
import type { AccountRepositoryPort, DiningRoomRepositoryPort } from './ports.js';
import type {
  CancellationPolicy,
  CancellationContext,
  BillSplitProrationStrategy,
  SplitPartitionPlan,
  TransferValidationRule,
  TransferValidationContext,
} from './policies.js';

export interface CreateMesaInput {
  readonly id: string;
  readonly roomName: string;
  readonly tableNumber: string;
}

export interface OpenCuentaInput {
  readonly id: string;
  readonly mesaId?: string | null;
  readonly epochId: string;
  readonly accountType: AccountType;
  readonly openedByUserId: string;
}

export interface AddItemModifierInput {
  readonly id: string;
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
  readonly modifierPriceApplied: bigint; // Scale 4
}

export interface AddItemInput {
  readonly id: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPriceApplied: bigint; // Scale 4
  readonly quantity: bigint; // Scale 4 (e.g. 1.0000 = 10000n)
  readonly taxRateApplied: bigint; // Scale 4 (e.g. 16% = 1600n)
  readonly discountAmountApplied?: bigint; // Scale 4
  readonly modifiers?: readonly AddItemModifierInput[];
}

export interface DiningServiceOptions {
  readonly diningRepo: DiningRoomRepositoryPort;
  readonly accountRepo: AccountRepositoryPort;
  readonly cancellationPolicy?: CancellationPolicy;
  readonly splitStrategy?: BillSplitProrationStrategy;
  readonly transferRule?: TransferValidationRule;
}

export class DiningDomainService {
  readonly #diningRepo: DiningRoomRepositoryPort;
  readonly #accountRepo: AccountRepositoryPort;
  readonly #cancellationPolicy?: CancellationPolicy;
  readonly #splitStrategy?: BillSplitProrationStrategy;
  readonly #transferRule?: TransferValidationRule;

  constructor(options: DiningServiceOptions) {
    this.#diningRepo = options.diningRepo;
    this.#accountRepo = options.accountRepo;
    this.#cancellationPolicy = options.cancellationPolicy;
    this.#splitStrategy = options.splitStrategy;
    this.#transferRule = options.transferRule;
  }

  /**
   * Calculates a single line item's financials exactly per ADR-012 Sec 4.3.
   */
  public static calculateItemFinancials(
    unitPriceScale4: bigint,
    quantityScale4: bigint,
    taxRateScale4: bigint,
    discountAmountScale4: bigint = 0n,
  ): {
    subtotal: bigint;
    taxAmount: bigint;
    total: bigint;
  } {
    const subtotal = calculateLineSubtotal(unitPriceScale4, quantityScale4);
    const netSubtotal = calculateNetSubtotal(subtotal, discountAmountScale4);
    const taxAmount = calculateTaxAmount(netSubtotal, taxRateScale4);
    const total = calculateLineTotal(netSubtotal, taxAmount);

    return { subtotal, taxAmount, total };
  }

  /**
   * Recalculates aggregate totals for a Cuenta as the exact integer sums of line items.
   */
  public static recalculateCuentaTotals(
    items: readonly CuentaItem[],
    tipsTotal: bigint = 0n,
  ): {
    subtotal: bigint;
    taxTotal: bigint;
    discountsTotal: bigint;
    totalAmount: bigint;
  } {
    let subtotal = 0n;
    let taxTotal = 0n;
    let discountsTotal = 0n;
    let lineTotalSum = 0n;

    for (const item of items) {
      if (item.status !== 'CANCELADO') {
        subtotal += item.subtotal;
        taxTotal += item.taxAmountApplied;
        discountsTotal += item.discountAmountApplied;
        lineTotalSum += item.total;
      }
    }

    const totalAmount = lineTotalSum + tipsTotal;

    return {
      subtotal,
      taxTotal,
      discountsTotal,
      totalAmount,
    };
  }

  /**
   * Creates a new Mesa aggregate synchronously.
   */
  public createMesaSync(input: CreateMesaInput): Mesa {
    if (!this.#diningRepo.getMesaByIdSync || !this.#diningRepo.saveMesaSync) {
      throw new DomainError(
        'Dining repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }
    const existing = this.#diningRepo.getMesaByIdSync(input.id);
    if (existing) {
      throw new DomainError(`Mesa with id '${input.id}' already exists`, 'DUPLICATE_MESA', 409);
    }

    const now = new Date().toISOString();
    const mesa: Mesa = {
      id: input.id,
      roomName: input.roomName,
      tableNumber: input.tableNumber,
      status: 'DISPONIBLE',
      currentAccountId: null,
      version: 1,
      updatedAt: now,
    };

    return this.#diningRepo.saveMesaSync(mesa, 0);
  }

  /**
   * Creates a new Mesa aggregate.
   */
  public async createMesa(input: CreateMesaInput): Promise<Mesa> {
    if (this.#diningRepo.getMesaByIdSync && this.#diningRepo.saveMesaSync) {
      return this.createMesaSync(input);
    }

    const existing = await this.#diningRepo.getMesaById(input.id);
    if (existing) {
      throw new DomainError(`Mesa with id '${input.id}' already exists`, 'DUPLICATE_MESA', 409);
    }

    const now = new Date().toISOString();
    const mesa: Mesa = {
      id: input.id,
      roomName: input.roomName,
      tableNumber: input.tableNumber,
      status: 'DISPONIBLE',
      currentAccountId: null,
      version: 1,
      updatedAt: now,
    };

    return this.#diningRepo.saveMesa(mesa, 0);
  }

  /**
   * Opens a new Cuenta synchronously, optionally linking and occupying a Mesa with OCC.
   */
  public openCuentaSync(input: OpenCuentaInput): { cuenta: Cuenta; mesa?: Mesa } {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const existingCuenta = this.#accountRepo.getCuentaByIdSync(input.id);
    if (existingCuenta) {
      throw new DomainError(`Cuenta with id '${input.id}' already exists`, 'DUPLICATE_CUENTA', 409);
    }

    let updatedMesa: Mesa | undefined;
    if (input.mesaId) {
      if (!this.#diningRepo.getMesaByIdSync || !this.#diningRepo.saveMesaSync) {
        throw new DomainError(
          'Dining repository does not support synchronous operations',
          'SYNC_UNSUPPORTED',
          500,
        );
      }
      const mesa = this.#diningRepo.getMesaByIdSync(input.mesaId);
      if (!mesa) {
        throw new DomainError(`Mesa '${input.mesaId}' not found`, 'MESA_NOT_FOUND', 404);
      }
      if (mesa.status !== 'DISPONIBLE') {
        throw new DomainError(
          `Mesa '${input.mesaId}' is not available (current status: ${mesa.status})`,
          'MESA_NOT_AVAILABLE',
          409,
        );
      }

      const occupiedMesa: Mesa = {
        ...mesa,
        status: 'OCUPADA',
        currentAccountId: input.id,
        version: mesa.version + 1,
        updatedAt: new Date().toISOString(),
      };

      updatedMesa = this.#diningRepo.saveMesaSync(occupiedMesa, mesa.version);
    }

    const now = new Date().toISOString();
    const cuenta: Cuenta = {
      id: input.id,
      folioNumber: null,
      epochId: input.epochId,
      mesaId: input.mesaId ?? null,
      accountType: input.accountType,
      status: 'ABIERTA',
      subtotal: 0n,
      taxTotal: 0n,
      discountsTotal: 0n,
      tipsTotal: 0n,
      totalAmount: 0n,
      openedByUserId: input.openedByUserId,
      openedAt: now,
      closedAt: null,
      version: 1,
      updatedAt: now,
      items: [],
    };

    const savedCuenta = this.#accountRepo.saveCuentaSync(cuenta, 0);
    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  /**
   * Opens a new Cuenta, optionally linking and occupying a Mesa with OCC.
   */
  public async openCuenta(input: OpenCuentaInput): Promise<{ cuenta: Cuenta; mesa?: Mesa }> {
    if (this.#accountRepo.getCuentaByIdSync && this.#accountRepo.saveCuentaSync) {
      return this.openCuentaSync(input);
    }

    const existingCuenta = await this.#accountRepo.getCuentaById(input.id);
    if (existingCuenta) {
      throw new DomainError(`Cuenta with id '${input.id}' already exists`, 'DUPLICATE_CUENTA', 409);
    }

    let updatedMesa: Mesa | undefined;
    if (input.mesaId) {
      const mesa = await this.#diningRepo.getMesaById(input.mesaId);
      if (!mesa) {
        throw new DomainError(`Mesa '${input.mesaId}' not found`, 'MESA_NOT_FOUND', 404);
      }
      if (mesa.status !== 'DISPONIBLE') {
        throw new DomainError(
          `Mesa '${input.mesaId}' is not available (current status: ${mesa.status})`,
          'MESA_NOT_AVAILABLE',
          409,
        );
      }

      const occupiedMesa: Mesa = {
        ...mesa,
        status: 'OCUPADA',
        currentAccountId: input.id,
        version: mesa.version + 1,
        updatedAt: new Date().toISOString(),
      };

      updatedMesa = await this.#diningRepo.saveMesa(occupiedMesa, mesa.version);
    }

    const now = new Date().toISOString();
    const cuenta: Cuenta = {
      id: input.id,
      folioNumber: null,
      epochId: input.epochId,
      mesaId: input.mesaId ?? null,
      accountType: input.accountType,
      status: 'ABIERTA',
      subtotal: 0n,
      taxTotal: 0n,
      discountsTotal: 0n,
      tipsTotal: 0n,
      totalAmount: 0n,
      openedByUserId: input.openedByUserId,
      openedAt: now,
      closedAt: null,
      version: 1,
      updatedAt: now,
      items: [],
    };

    const savedCuenta = await this.#accountRepo.saveCuenta(cuenta, 0);
    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  /**
   * Synchronously adds an item with optional modifiers to an open Cuenta under OCC.
   */
  public addItemToCuentaSync(
    cuentaId: string,
    expectedVersion: number,
    itemInput: AddItemInput,
  ): Cuenta {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA') {
      throw new DomainError(
        `Cannot add items to cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== expectedVersion) {
      throw new OCCConflictError(cuentaId, expectedVersion, cuenta.version, cuenta);
    }

    const discount = itemInput.discountAmountApplied ?? 0n;
    const { subtotal, taxAmount, total } = DiningDomainService.calculateItemFinancials(
      itemInput.unitPriceApplied,
      itemInput.quantity,
      itemInput.taxRateApplied,
      discount,
    );

    const now = new Date().toISOString();
    const modifiers: CuentaItemModificador[] = (itemInput.modifiers ?? []).map((mod) => ({
      id: mod.id,
      cuentaItemId: itemInput.id,
      modifierId: mod.modifierId,
      modifierNameSnapshot: mod.modifierNameSnapshot,
      modifierPriceApplied: mod.modifierPriceApplied,
    }));

    const newItem: CuentaItem = {
      id: itemInput.id,
      cuentaId,
      productId: itemInput.productId,
      productNameSnapshot: itemInput.productNameSnapshot,
      unitPriceApplied: itemInput.unitPriceApplied,
      quantity: itemInput.quantity,
      taxRateApplied: itemInput.taxRateApplied,
      taxAmountApplied: taxAmount,
      discountAmountApplied: discount,
      subtotal,
      total,
      status: 'ORDENADO',
      createdAt: now,
      modifiers,
    };

    const updatedItems = [...cuenta.items, newItem];
    const totals = DiningDomainService.recalculateCuentaTotals(updatedItems, cuenta.tipsTotal);

    const updatedCuenta: Cuenta = {
      ...cuenta,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountsTotal: totals.discountsTotal,
      totalAmount: totals.totalAmount,
      version: cuenta.version + 1,
      updatedAt: now,
      items: updatedItems,
    };

    return this.#accountRepo.saveCuentaSync(updatedCuenta, expectedVersion);
  }

  /**
   * Adds an item with optional modifiers to an open Cuenta under OCC.
   */
  public async addItemToCuenta(
    cuentaId: string,
    expectedVersion: number,
    itemInput: AddItemInput,
  ): Promise<Cuenta> {
    if (this.#accountRepo.getCuentaByIdSync && this.#accountRepo.saveCuentaSync) {
      return this.addItemToCuentaSync(cuentaId, expectedVersion, itemInput);
    }

    const cuenta = await this.#accountRepo.getCuentaById(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA') {
      throw new DomainError(
        `Cannot add items to cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== expectedVersion) {
      throw new OCCConflictError(cuentaId, expectedVersion, cuenta.version, cuenta);
    }

    const discount = itemInput.discountAmountApplied ?? 0n;
    const { subtotal, taxAmount, total } = DiningDomainService.calculateItemFinancials(
      itemInput.unitPriceApplied,
      itemInput.quantity,
      itemInput.taxRateApplied,
      discount,
    );

    const now = new Date().toISOString();
    const modifiers: CuentaItemModificador[] = (itemInput.modifiers ?? []).map((mod) => ({
      id: mod.id,
      cuentaItemId: itemInput.id,
      modifierId: mod.modifierId,
      modifierNameSnapshot: mod.modifierNameSnapshot,
      modifierPriceApplied: mod.modifierPriceApplied,
    }));

    const newItem: CuentaItem = {
      id: itemInput.id,
      cuentaId,
      productId: itemInput.productId,
      productNameSnapshot: itemInput.productNameSnapshot,
      unitPriceApplied: itemInput.unitPriceApplied,
      quantity: itemInput.quantity,
      taxRateApplied: itemInput.taxRateApplied,
      taxAmountApplied: taxAmount,
      discountAmountApplied: discount,
      subtotal,
      total,
      status: 'ORDENADO',
      createdAt: now,
      modifiers,
    };

    const updatedItems = [...cuenta.items, newItem];
    const totals = DiningDomainService.recalculateCuentaTotals(updatedItems, cuenta.tipsTotal);

    const updatedCuenta: Cuenta = {
      ...cuenta,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountsTotal: totals.discountsTotal,
      totalAmount: totals.totalAmount,
      version: cuenta.version + 1,
      updatedAt: now,
      items: updatedItems,
    };

    return this.#accountRepo.saveCuenta(updatedCuenta, expectedVersion);
  }

  /**
   * Synchronously closes a Cuenta under OCC, transitioning its associated table to DISPONIBLE.
   */
  public closeCuentaSync(
    cuentaId: string,
    expectedVersion: number,
    closedStatus: 'PAGADA' | 'ANULADA' = 'PAGADA',
  ): { cuenta: Cuenta; mesa?: Mesa } {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot close cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== expectedVersion) {
      throw new OCCConflictError(cuentaId, expectedVersion, cuenta.version, cuenta);
    }

    const now = new Date().toISOString();
    const updatedCuenta: Cuenta = {
      ...cuenta,
      status: closedStatus,
      closedAt: now,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedCuenta = this.#accountRepo.saveCuentaSync(updatedCuenta, expectedVersion);

    let updatedMesa: Mesa | undefined;
    if (savedCuenta.mesaId) {
      if (!this.#diningRepo.getMesaByIdSync || !this.#diningRepo.saveMesaSync) {
        throw new DomainError(
          'Dining repository does not support synchronous operations',
          'SYNC_UNSUPPORTED',
          500,
        );
      }
      const mesa = this.#diningRepo.getMesaByIdSync(savedCuenta.mesaId);
      if (mesa && mesa.currentAccountId === cuentaId) {
        const freedMesa: Mesa = {
          ...mesa,
          status: 'DISPONIBLE',
          currentAccountId: null,
          version: mesa.version + 1,
          updatedAt: now,
        };
        updatedMesa = this.#diningRepo.saveMesaSync(freedMesa, mesa.version);
      }
    }

    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  /**
   * Closes a Cuenta under OCC, transitioning its associated table to DISPONIBLE.
   */
  public async closeCuenta(
    cuentaId: string,
    expectedVersion: number,
    closedStatus: 'PAGADA' | 'ANULADA' = 'PAGADA',
  ): Promise<{ cuenta: Cuenta; mesa?: Mesa }> {
    if (this.#accountRepo.getCuentaByIdSync && this.#accountRepo.saveCuentaSync) {
      return this.closeCuentaSync(cuentaId, expectedVersion, closedStatus);
    }

    const cuenta = await this.#accountRepo.getCuentaById(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot close cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== expectedVersion) {
      throw new OCCConflictError(cuentaId, expectedVersion, cuenta.version, cuenta);
    }

    const now = new Date().toISOString();
    const updatedCuenta: Cuenta = {
      ...cuenta,
      status: closedStatus,
      closedAt: now,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedCuenta = await this.#accountRepo.saveCuenta(updatedCuenta, expectedVersion);

    let updatedMesa: Mesa | undefined;
    if (savedCuenta.mesaId) {
      const mesa = await this.#diningRepo.getMesaById(savedCuenta.mesaId);
      if (mesa && mesa.currentAccountId === cuentaId) {
        const freedMesa: Mesa = {
          ...mesa,
          status: 'DISPONIBLE',
          currentAccountId: null,
          version: mesa.version + 1,
          updatedAt: now,
        };
        updatedMesa = await this.#diningRepo.saveMesa(freedMesa, mesa.version);
      }
    }

    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  /**
   * Cancels a line item, evaluating CancellationPolicy hook (OQ-SSOT-01).
   * GOVERNED INVARIANT:
   * If cancellation requires the policy and none is configured, it MUST FAIL CLOSED.
   * Throws PROTECTED_POLICY_NOT_CONFIGURED. Account MUST NOT be mutated.
   */
  public async cancelItem(
    cuentaId: string,
    itemId: string,
    expectedVersion: number,
    context: CancellationContext,
  ): Promise<Cuenta> {
    if (!this.#cancellationPolicy) {
      throw new DomainError(
        'Cancellation policy not configured (OQ-SSOT-01 PENDING PO DECISION)',
        'PROTECTED_POLICY_NOT_CONFIGURED',
        501,
      );
    }

    const cuenta = await this.#accountRepo.getCuentaById(cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.version !== expectedVersion) {
      throw new OCCConflictError(cuentaId, expectedVersion, cuenta.version, cuenta);
    }

    const itemIndex = cuenta.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) {
      throw new DomainError(`Item '${itemId}' not found in cuenta`, 'ITEM_NOT_FOUND', 404);
    }

    const item = cuenta.items[itemIndex];
    if (!item) {
      throw new DomainError(`Item '${itemId}' not found in cuenta`, 'ITEM_NOT_FOUND', 404);
    }

    const check = this.#cancellationPolicy.canCancelItem(item, context);
    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? 'Cancellation disallowed by cancellation policy',
        'CANCELLATION_DISALLOWED',
        403,
      );
    }

    const updatedItem: CuentaItem = {
      ...item,
      status: 'CANCELADO',
    };

    const updatedItems = [...cuenta.items];
    updatedItems[itemIndex] = updatedItem;

    const totals = DiningDomainService.recalculateCuentaTotals(updatedItems, cuenta.tipsTotal);
    const now = new Date().toISOString();

    const updatedCuenta: Cuenta = {
      ...cuenta,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountsTotal: totals.discountsTotal,
      totalAmount: totals.totalAmount,
      version: cuenta.version + 1,
      updatedAt: now,
      items: updatedItems,
    };

    return this.#accountRepo.saveCuenta(updatedCuenta, expectedVersion);
  }

  /**
   * Splits a bill, delegating to BillSplitProrationStrategy (OQ-SSOT-06) if present.
   * GOVERNED INVARIANT:
   * If bill split strategy is not configured, it MUST FAIL CLOSED.
   */
  public splitCuenta(cuenta: Cuenta, partitions: readonly SplitPartitionPlan[]): readonly Cuenta[] {
    if (!this.#splitStrategy) {
      throw new DomainError(
        'Bill split strategy not configured (OQ-SSOT-06 PENDING PO DECISION)',
        'STRATEGY_NOT_CONFIGURED',
        501,
      );
    }
    return this.#splitStrategy.prorateSplit(cuenta, partitions);
  }

  /**
   * Validates and transfers account between tables, delegating to TransferValidationRule (OQ-SSOT-02).
   * GOVERNED INVARIANT:
   * If transfer rule is not configured, it MUST FAIL CLOSED.
   * Throws PROTECTED_POLICY_NOT_CONFIGURED. Does NOT return true or allowed by default.
   */
  public validateTransfer(
    sourceMesa: Mesa,
    targetMesa: Mesa,
    cuenta: Cuenta,
    context: TransferValidationContext,
  ): boolean {
    if (!this.#transferRule) {
      throw new DomainError(
        'Transfer validation rule not configured (OQ-SSOT-02 PENDING PO DECISION)',
        'PROTECTED_POLICY_NOT_CONFIGURED',
        501,
      );
    }
    const result = this.#transferRule.validateTransfer(sourceMesa, targetMesa, cuenta, context);
    if (!result.allowed) {
      throw new DomainError(
        result.reason ?? 'Transfer disallowed by transfer validation rule',
        'TRANSFER_DISALLOWED',
        403,
      );
    }
    return true;
  }
}
