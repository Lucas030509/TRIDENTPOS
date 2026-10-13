/**
 * TRIDENTPOS POS Dining Room & Account Domain Service
 * Pure business domain implementation per ADR-012, ADR-013, DATA_MODEL.md,
 * IMPLEMENTATION_PLAN.md (WP-014A), and PRODUCT_OWNER_OQ_RESOLUTION.md (DEC-010, DEC-011, DEC-013, DEC-015).
 * Strictly uses scale-4 bigint for all financial arithmetic — zero floating point.
 */

import {
  calculateLineSubtotal,
  calculateNetSubtotal,
  calculateTaxAmount,
  calculateLineTotal,
} from '@trident/core';
import type {
  AccountType,
  AttentionSignal,
  Cuenta,
  CuentaItem,
  CuentaItemModificador,
  Mesa,
  MesaSummary,
  SalonReadModel,
  SalonRoomSummary,
} from './types.js';
import { DomainError, OCCConflictError } from './errors.js';
import type {
  AccountRepositoryPort,
  DiningRoomRepositoryPort,
  IamPinValidatorPort,
} from './ports.js';
import {
  type CancellationPolicy,
  type BillSplitProrationStrategy,
  type SplitPartitionPlan,
  type TransferValidationRule,
  KdsStateBasedCancellationPolicy,
  ReceivingWaiterPinTransferValidationRule,
  ProportionalBillSplitStrategy,
} from './policies.js';

export interface CreateMesaInput {
  readonly id: string;
  readonly roomName: string;
  readonly tableNumber: string;
  readonly posX?: number | null;
  readonly posY?: number | null;
  readonly capacity?: number | null;
}

export interface OpenCuentaInput {
  readonly id: string;
  readonly mesaId?: string | null;
  readonly epochId: string;
  readonly accountType: AccountType;
  readonly openedByUserId: string;
  readonly currentWaiterUserId?: string | null;
  readonly guestCount?: number | null;
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

export interface CancelItemInput {
  readonly cuentaId: string;
  readonly itemId: string;
  readonly expectedVersion: number;
  readonly operatorUserId: string;
  readonly operatorPin: string;
  readonly supervisorPin?: string;
  readonly kitchenStatus?: string;
  readonly reason: string;
}

export interface TransferCuentaInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly sourceMesaId: string;
  readonly targetMesaId: string;
  readonly sourceWaiterUserId: string;
  readonly targetWaiterUserId: string;
  readonly targetWaiterPin: string;
  readonly reason?: string;
}

export interface CancelCuentaInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly requestedByUserId: string;
  readonly requestedByPin: string;
  readonly managerPin?: string;
}

export interface SplitCuentaInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly partitions: readonly SplitPartitionPlan[];
  readonly performedByUserId: string;
  readonly operatorPin: string;
}

export interface ReassignWaiterInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly newWaiterUserId: string;
  readonly requestingUserId: string;
  readonly requestingPin: string;
  readonly reason?: string;
}

export interface ChangeGuestCountInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly guestCount: number;
  readonly performedByUserId: string;
  readonly operatorPin?: string;
}

export interface RequestCheckInput {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly requestedByUserId: string;
  readonly operatorPin?: string;
  readonly nextFolioNumber?: number;
}

export interface LiberarMesaInput {
  readonly mesaId: string;
  readonly expectedVersion: number;
  readonly performedByUserId: string;
  readonly force?: boolean;
}

export interface MergeTablesInput {
  readonly primaryMesaId: string;
  readonly secondaryMesaIds: readonly string[];
  readonly operatorUserId: string;
  readonly operatorPin?: string;
}

export interface DiningServiceOptions {
  readonly diningRepo: DiningRoomRepositoryPort;
  readonly accountRepo: AccountRepositoryPort;
  readonly pinValidator: IamPinValidatorPort;
  readonly cancellationPolicy?: CancellationPolicy;
  readonly splitStrategy?: BillSplitProrationStrategy;
  readonly transferRule?: TransferValidationRule;
}

export class DiningDomainService {
  readonly #diningRepo: DiningRoomRepositoryPort;
  readonly #accountRepo: AccountRepositoryPort;
  readonly #pinValidator: IamPinValidatorPort;
  readonly #cancellationPolicy: CancellationPolicy;
  readonly #splitStrategy: BillSplitProrationStrategy;
  readonly #transferRule: TransferValidationRule;

  constructor(options: DiningServiceOptions) {
    if (!options.pinValidator) {
      throw new DomainError(
        'pinValidator is mandatory for DiningDomainService (fail-closed)',
        'PIN_VALIDATOR_REQUIRED',
        500,
      );
    }
    this.#diningRepo = options.diningRepo;
    this.#accountRepo = options.accountRepo;
    this.#pinValidator = options.pinValidator;
    this.#cancellationPolicy = options.cancellationPolicy ?? new KdsStateBasedCancellationPolicy();
    this.#splitStrategy = options.splitStrategy ?? new ProportionalBillSplitStrategy();
    this.#transferRule = options.transferRule ?? new ReceivingWaiterPinTransferValidationRule();
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

  // ==========================================
  // Mesa / Table Aggregate Operations
  // ==========================================

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
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      capacity: input.capacity ?? null,
      version: 1,
      updatedAt: now,
    };

    return this.#diningRepo.saveMesaSync(mesa, 0);
  }

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
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      capacity: input.capacity ?? null,
      version: 1,
      updatedAt: now,
    };

    return this.#diningRepo.saveMesa(mesa, 0);
  }

  // ==========================================
  // Cuenta Operations
  // ==========================================

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
      currentWaiterUserId: input.currentWaiterUserId ?? input.openedByUserId,
      guestCount: input.guestCount ?? 1,
      openedAt: now,
      printedAt: null,
      closedAt: null,
      version: 1,
      updatedAt: now,
      items: [],
    };

    const savedCuenta = this.#accountRepo.saveCuentaSync(cuenta, 0);
    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  public async openCuenta(input: OpenCuentaInput): Promise<{ cuenta: Cuenta; mesa?: Mesa }> {
    return this.openCuentaSync(input);
  }

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

  public async addItemToCuenta(
    cuentaId: string,
    expectedVersion: number,
    itemInput: AddItemInput,
  ): Promise<Cuenta> {
    return this.addItemToCuentaSync(cuentaId, expectedVersion, itemInput);
  }

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

  public async closeCuenta(
    cuentaId: string,
    expectedVersion: number,
    closedStatus: 'PAGADA' | 'ANULADA' = 'PAGADA',
  ): Promise<{ cuenta: Cuenta; mesa?: Mesa }> {
    return this.closeCuentaSync(cuentaId, expectedVersion, closedStatus);
  }

  // ==========================================
  // DEC-010: Line Item Cancellation
  // ==========================================

  public cancelItemSync(input: CancelItemInput): {
    cuenta: Cuenta;
    cancelledItem: CuentaItem;
    requiresWasteRecord: boolean;
  } {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    if (!input.reason || input.reason.trim().length === 0) {
      throw new DomainError('Cancellation reason is mandatory (DEC-010)', 'MISSING_REASON', 400);
    }

    const validOperator = this.#pinValidator.validatePin(input.operatorUserId, input.operatorPin);
    if (!validOperator) {
      throw new DomainError(
        `Invalid PIN for user '${input.operatorUserId}'`,
        'INVALID_OPERATOR_PIN',
        401,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const itemIndex = cuenta.items.findIndex((i) => i.id === input.itemId);
    if (itemIndex === -1) {
      throw new DomainError(`Item '${input.itemId}' not found in cuenta`, 'ITEM_NOT_FOUND', 404);
    }

    const item = cuenta.items[itemIndex]!;
    if (item.status === 'CANCELADO') {
      throw new DomainError(
        `Item '${input.itemId}' is already cancelled`,
        'ITEM_ALREADY_CANCELLED',
        400,
      );
    }

    const kitchenStatus = input.kitchenStatus ?? item.status;
    let hasSupervisorAuthorization = false;

    if (input.supervisorPin) {
      // Validate supervisor authorization
      hasSupervisorAuthorization = Boolean(
        this.#pinValidator.validatePin('supervisor', input.supervisorPin) ||
        this.#pinValidator.validatePin(input.operatorUserId, input.supervisorPin),
      );
      if (!hasSupervisorAuthorization) {
        throw new DomainError('Invalid supervisor PIN provided', 'INVALID_SUPERVISOR_PIN', 401);
      }
    }

    const check = this.#cancellationPolicy.canCancelItem(item, {
      operatorUserId: input.operatorUserId,
      kitchenStatus,
      hasSupervisorAuthorization,
      reason: input.reason,
    });

    if (!check.allowed) {
      throw new DomainError(
        check.reason ?? 'Cancellation disallowed by policy',
        'CANCELLATION_DISALLOWED',
        403,
      );
    }

    const now = new Date().toISOString();
    const updatedItem: CuentaItem = {
      ...item,
      status: 'CANCELADO',
      cancellationReason: input.reason,
      cancelledByUserId: input.operatorUserId,
      cancelledAt: now,
      requiresWasteRecord: check.requiresWasteRecord ?? false,
    };

    const updatedItems = [...cuenta.items];
    updatedItems[itemIndex] = updatedItem;

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

    const savedCuenta = this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);
    return {
      cuenta: savedCuenta,
      cancelledItem: updatedItem,
      requiresWasteRecord: check.requiresWasteRecord ?? false,
    };
  }

  public async cancelItem(input: CancelItemInput): Promise<{
    cuenta: Cuenta;
    cancelledItem: CuentaItem;
    requiresWasteRecord: boolean;
  }> {
    return this.cancelItemSync(input);
  }

  // ==========================================
  // DEC-011: Account & Table Transfer
  // ==========================================

  public transferCuentaSync(input: TransferCuentaInput): {
    cuenta: Cuenta;
    sourceMesa: Mesa;
    targetMesa: Mesa;
  } {
    if (
      !this.#accountRepo.getCuentaByIdSync ||
      !this.#accountRepo.saveCuentaSync ||
      !this.#diningRepo.getMesaByIdSync ||
      !this.#diningRepo.saveMesaSync
    ) {
      throw new DomainError(
        'Repositories do not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const validTargetWaiterPin = this.#pinValidator.validatePin(
      input.targetWaiterUserId,
      input.targetWaiterPin,
    );

    if (!validTargetWaiterPin) {
      throw new DomainError(
        `Invalid PIN for target waiter '${input.targetWaiterUserId}'`,
        'INVALID_TARGET_WAITER_PIN',
        401,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const sourceMesa = this.#diningRepo.getMesaByIdSync(input.sourceMesaId);
    if (!sourceMesa) {
      throw new DomainError(
        `Source table '${input.sourceMesaId}' not found`,
        'SOURCE_MESA_NOT_FOUND',
        404,
      );
    }

    const targetMesa = this.#diningRepo.getMesaByIdSync(input.targetMesaId);
    if (!targetMesa) {
      throw new DomainError(
        `Target table '${input.targetMesaId}' not found`,
        'TARGET_MESA_NOT_FOUND',
        404,
      );
    }

    const validation = this.#transferRule.validateTransfer(sourceMesa, targetMesa, cuenta, {
      operatorUserId: input.sourceWaiterUserId,
      targetWaiterUserId: input.targetWaiterUserId,
      targetWaiterPinProvided: true,
      reason: input.reason,
    });

    if (!validation.allowed) {
      throw new DomainError(validation.reason ?? 'Transfer disallowed', 'TRANSFER_DISALLOWED', 403);
    }

    const now = new Date().toISOString();

    // Update source mesa to DISPONIBLE
    const updatedSourceMesa: Mesa = {
      ...sourceMesa,
      status: 'DISPONIBLE',
      currentAccountId: null,
      version: sourceMesa.version + 1,
      updatedAt: now,
    };

    // Update target mesa to OCUPADA
    const updatedTargetMesa: Mesa = {
      ...targetMesa,
      status: 'OCUPADA',
      currentAccountId: cuenta.id,
      version: targetMesa.version + 1,
      updatedAt: now,
    };

    // Update cuenta
    const updatedCuenta: Cuenta = {
      ...cuenta,
      mesaId: targetMesa.id,
      currentWaiterUserId: input.targetWaiterUserId,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedSourceMesa = this.#diningRepo.saveMesaSync(updatedSourceMesa, sourceMesa.version);
    const savedTargetMesa = this.#diningRepo.saveMesaSync(updatedTargetMesa, targetMesa.version);
    const savedCuenta = this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);

    return {
      cuenta: savedCuenta,
      sourceMesa: savedSourceMesa,
      targetMesa: savedTargetMesa,
    };
  }

  public async transferCuenta(input: TransferCuentaInput): Promise<{
    cuenta: Cuenta;
    sourceMesa: Mesa;
    targetMesa: Mesa;
  }> {
    return this.transferCuentaSync(input);
  }

  // ==========================================
  // DEC-013: Cancel Cuenta (Printed or Open)
  // ==========================================

  public cancelCuentaSync(input: CancelCuentaInput): {
    cuenta: Cuenta;
    mesa?: Mesa;
  } {
    if (
      !this.#accountRepo.getCuentaByIdSync ||
      !this.#accountRepo.saveCuentaSync ||
      !this.#diningRepo.getMesaByIdSync ||
      !this.#diningRepo.saveMesaSync
    ) {
      throw new DomainError(
        'Repositories do not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    if (!input.reason || input.reason.trim().length === 0) {
      throw new DomainError('Cancellation reason is mandatory (DEC-013)', 'MISSING_REASON', 400);
    }

    const validRequestedPin = this.#pinValidator.validatePin(
      input.requestedByUserId,
      input.requestedByPin,
    );
    if (!validRequestedPin) {
      throw new DomainError(
        `Invalid PIN for user '${input.requestedByUserId}'`,
        'INVALID_OPERATOR_PIN',
        401,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status === 'PAGADA') {
      throw new DomainError('Cannot cancel a settled/paid account', 'INVALID_ACCOUNT_STATUS', 400);
    }

    if (cuenta.status === 'ANULADA') {
      throw new DomainError('Account is already cancelled', 'ALREADY_CANCELLED', 400);
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    if (cuenta.status === 'IMPRESA') {
      // DEC-013: Printed account cancellation requires Manager PIN
      if (!input.managerPin) {
        throw new DomainError(
          'Printed account cancellation requires manager PIN (DEC-013)',
          'MANAGER_PIN_REQUIRED',
          403,
        );
      }

      const validManager = Boolean(
        this.#pinValidator.validatePin('manager', input.managerPin) ||
        this.#pinValidator.validatePin('gerente', input.managerPin) ||
        this.#pinValidator.validatePin(input.requestedByUserId, input.managerPin),
      );

      if (!validManager) {
        throw new DomainError('Invalid manager PIN provided', 'INVALID_MANAGER_PIN', 401);
      }
    }

    const now = new Date().toISOString();
    const updatedCuenta: Cuenta = {
      ...cuenta,
      status: 'ANULADA',
      closedAt: now,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedCuenta = this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);

    let updatedMesa: Mesa | undefined;
    if (savedCuenta.mesaId) {
      const mesa = this.#diningRepo.getMesaByIdSync(savedCuenta.mesaId);
      if (mesa && mesa.currentAccountId === savedCuenta.id) {
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

  public async cancelCuenta(input: CancelCuentaInput): Promise<{
    cuenta: Cuenta;
    mesa?: Mesa;
  }> {
    return this.cancelCuentaSync(input);
  }

  // ==========================================
  // DEC-015: Account Split with Proration
  // ==========================================

  public splitCuentaSync(input: SplitCuentaInput): {
    originalCuenta: Cuenta;
    subCuentas: readonly Cuenta[];
    mesa?: Mesa;
  } {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const validPin = this.#pinValidator.validatePin(input.performedByUserId, input.operatorPin);
    if (!validPin) {
      throw new DomainError(
        `Invalid PIN for user '${input.performedByUserId}'`,
        'INVALID_OPERATOR_PIN',
        401,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot split cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const subCuentas = this.#splitStrategy.prorateSplit(cuenta, input.partitions);

    // Assert exact invariant: sum of subcuenta totals equals original total
    const sumTotalAmount = subCuentas.reduce((sum, c) => sum + c.totalAmount, 0n);
    if (sumTotalAmount !== cuenta.totalAmount) {
      throw new DomainError(
        `Split total sum (${sumTotalAmount}) does not match original total (${cuenta.totalAmount})`,
        'SPLIT_INVARIANT_VIOLATION',
        500,
      );
    }

    // Save subcuentas
    for (const sub of subCuentas) {
      this.#accountRepo.saveCuentaSync(sub, 0);
    }

    // Mark original cuenta as ANULADA/SPLIT
    const now = new Date().toISOString();
    const updatedOriginal: Cuenta = {
      ...cuenta,
      status: 'ANULADA',
      closedAt: now,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedOriginal = this.#accountRepo.saveCuentaSync(updatedOriginal, input.expectedVersion);

    let updatedMesa: Mesa | undefined;
    if (cuenta.mesaId && this.#diningRepo.getMesaByIdSync && this.#diningRepo.saveMesaSync) {
      const mesa = this.#diningRepo.getMesaByIdSync(cuenta.mesaId);
      if (mesa && subCuentas[0]) {
        // Link table to first subcuenta
        const tableWithSub: Mesa = {
          ...mesa,
          currentAccountId: subCuentas[0].id,
          version: mesa.version + 1,
          updatedAt: now,
        };
        updatedMesa = this.#diningRepo.saveMesaSync(tableWithSub, mesa.version);
      }
    }

    return {
      originalCuenta: savedOriginal,
      subCuentas,
      mesa: updatedMesa,
    };
  }

  public async splitCuenta(input: SplitCuentaInput): Promise<{
    originalCuenta: Cuenta;
    subCuentas: readonly Cuenta[];
    mesa?: Mesa;
  }> {
    return this.splitCuentaSync(input);
  }

  // ==========================================
  // Operational Dining Commands
  // ==========================================

  public reassignWaiterSync(input: ReassignWaiterInput): Cuenta {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const validPin = this.#pinValidator.validatePin(input.requestingUserId, input.requestingPin);
    if (!validPin) {
      throw new DomainError(
        `Invalid PIN for user '${input.requestingUserId}'`,
        'INVALID_OPERATOR_PIN',
        401,
      );
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot reassign waiter for cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const now = new Date().toISOString();
    const updatedCuenta: Cuenta = {
      ...cuenta,
      currentWaiterUserId: input.newWaiterUserId,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    return this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);
  }

  public changeGuestCountSync(input: ChangeGuestCountInput): Cuenta {
    if (!this.#accountRepo.getCuentaByIdSync || !this.#accountRepo.saveCuentaSync) {
      throw new DomainError(
        'Account repository does not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    if (input.guestCount < 1) {
      throw new DomainError('Guest count must be at least 1', 'INVALID_GUEST_COUNT', 400);
    }

    if (input.operatorPin) {
      const validPin = this.#pinValidator.validatePin(input.performedByUserId, input.operatorPin);
      if (!validPin) {
        throw new DomainError(
          `Invalid PIN for user '${input.performedByUserId}'`,
          'INVALID_OPERATOR_PIN',
          401,
        );
      }
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot change guest count for cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const now = new Date().toISOString();
    const updatedCuenta: Cuenta = {
      ...cuenta,
      guestCount: input.guestCount,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    return this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);
  }

  public requestCheckSync(input: RequestCheckInput): {
    cuenta: Cuenta;
    mesa?: Mesa;
  } {
    if (
      !this.#accountRepo.getCuentaByIdSync ||
      !this.#accountRepo.saveCuentaSync ||
      !this.#diningRepo.getMesaByIdSync ||
      !this.#diningRepo.saveMesaSync
    ) {
      throw new DomainError(
        'Repositories do not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    if (input.operatorPin) {
      const validPin = this.#pinValidator.validatePin(input.requestedByUserId, input.operatorPin);
      if (!validPin) {
        throw new DomainError(
          `Invalid PIN for user '${input.requestedByUserId}'`,
          'INVALID_OPERATOR_PIN',
          401,
        );
      }
    }

    const cuenta = this.#accountRepo.getCuentaByIdSync(input.cuentaId);
    if (!cuenta) {
      throw new DomainError(`Cuenta '${input.cuentaId}' not found`, 'CUENTA_NOT_FOUND', 404);
    }

    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      throw new DomainError(
        `Cannot request check for cuenta in status '${cuenta.status}'`,
        'INVALID_ACCOUNT_STATUS',
        400,
      );
    }

    if (cuenta.version !== input.expectedVersion) {
      throw new OCCConflictError(input.cuentaId, input.expectedVersion, cuenta.version, cuenta);
    }

    const now = new Date().toISOString();
    // DEC-006: Sales folio assigned only at printed-precuenta time
    const folioNumber =
      cuenta.folioNumber ?? input.nextFolioNumber ?? Math.floor(Date.now() / 1000);

    const updatedCuenta: Cuenta = {
      ...cuenta,
      folioNumber,
      status: 'IMPRESA',
      printedAt: cuenta.printedAt ?? now,
      version: cuenta.version + 1,
      updatedAt: now,
    };

    const savedCuenta = this.#accountRepo.saveCuentaSync(updatedCuenta, input.expectedVersion);

    let updatedMesa: Mesa | undefined;
    if (savedCuenta.mesaId) {
      const mesa = this.#diningRepo.getMesaByIdSync(savedCuenta.mesaId);
      if (mesa) {
        const mesaInCheck: Mesa = {
          ...mesa,
          status: 'EN_CUENTA',
          version: mesa.version + 1,
          updatedAt: now,
        };
        updatedMesa = this.#diningRepo.saveMesaSync(mesaInCheck, mesa.version);
      }
    }

    return { cuenta: savedCuenta, mesa: updatedMesa };
  }

  public liberarMesaSync(input: LiberarMesaInput): Mesa {
    if (
      !this.#diningRepo.getMesaByIdSync ||
      !this.#diningRepo.saveMesaSync ||
      !this.#accountRepo.getCuentaByIdSync
    ) {
      throw new DomainError(
        'Repositories do not support synchronous operations',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const mesa = this.#diningRepo.getMesaByIdSync(input.mesaId);
    if (!mesa) {
      throw new DomainError(`Mesa '${input.mesaId}' not found`, 'MESA_NOT_FOUND', 404);
    }

    if (mesa.version !== input.expectedVersion) {
      throw new OCCConflictError(input.mesaId, input.expectedVersion, mesa.version, mesa);
    }

    if (mesa.status === 'DISPONIBLE') {
      return mesa;
    }

    if (mesa.currentAccountId && !input.force) {
      const cuenta = this.#accountRepo.getCuentaByIdSync(mesa.currentAccountId);
      if (cuenta && cuenta.status !== 'PAGADA' && cuenta.status !== 'ANULADA') {
        throw new DomainError(
          `Cannot release table '${mesa.tableNumber}' with active account '${cuenta.id}' in status '${cuenta.status}' without force`,
          'TABLE_HAS_ACTIVE_ACCOUNT',
          409,
        );
      }
    }

    const now = new Date().toISOString();
    const freedMesa: Mesa = {
      ...mesa,
      status: 'DISPONIBLE',
      currentAccountId: null,
      version: mesa.version + 1,
      updatedAt: now,
    };

    return this.#diningRepo.saveMesaSync(freedMesa, input.expectedVersion);
  }

  // ==========================================
  // Salón Read Model & Attention Projection
  // ==========================================

  public getSalonReadModelSync(nowIso?: string): SalonReadModel {
    if (!this.#diningRepo.listMesasSync || !this.#accountRepo.listOpenCuentasSync) {
      throw new DomainError(
        'Repositories do not support synchronous listing',
        'SYNC_UNSUPPORTED',
        500,
      );
    }

    const mesas = this.#diningRepo.listMesasSync();
    const openCuentas = this.#accountRepo.listOpenCuentasSync();
    const cuentaMap = new Map<string, Cuenta>(openCuentas.map((c) => [c.id, c]));

    const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();

    const roomMap = new Map<string, MesaSummary[]>();
    let occupiedTables = 0;
    let inCheckTables = 0;
    let availableTables = 0;

    for (const mesa of mesas) {
      if (mesa.status === 'OCUPADA') occupiedTables++;
      else if (mesa.status === 'EN_CUENTA') inCheckTables++;
      else if (mesa.status === 'DISPONIBLE') availableTables++;

      const cuenta = mesa.currentAccountId ? cuentaMap.get(mesa.currentAccountId) : undefined;
      const openedAtMs = cuenta?.openedAt ? new Date(cuenta.openedAt).getTime() : 0;
      const elapsedMinutes =
        openedAtMs > 0 ? Math.max(0, Math.floor((nowMs - openedAtMs) / 60000)) : 0;

      let attentionFlagged = false;
      let attentionReason: string | null = null;

      if (mesa.status === 'EN_CUENTA') {
        attentionFlagged = true;
        attentionReason = 'PRECUENTA_IMPRESA';
      } else if (mesa.status === 'OCUPADA' && elapsedMinutes > 60) {
        attentionFlagged = true;
        attentionReason = 'LONG_OCCUPATION';
      }

      const attentionSignal: AttentionSignal = {
        flagged: attentionFlagged,
        reason: attentionReason,
        elapsedMinutes,
      };

      const summary: MesaSummary = {
        id: mesa.id,
        roomName: mesa.roomName,
        tableNumber: mesa.tableNumber,
        status: mesa.status,
        currentAccountId: mesa.currentAccountId,
        assignedWaiterUserId: cuenta?.currentWaiterUserId ?? cuenta?.openedByUserId ?? null,
        guestCount: cuenta?.guestCount ?? (mesa.status === 'DISPONIBLE' ? 0 : 1),
        subtotal: cuenta?.subtotal ?? 0n,
        totalAmount: cuenta?.totalAmount ?? 0n,
        openedAt: cuenta?.openedAt ?? null,
        attentionSignal,
        version: mesa.version,
        updatedAt: mesa.updatedAt,
      };

      const list = roomMap.get(mesa.roomName) ?? [];
      list.push(summary);
      roomMap.set(mesa.roomName, list);
    }

    const rooms: SalonRoomSummary[] = Array.from(roomMap.entries()).map(([name, tables]) => ({
      name,
      tables,
    }));

    return {
      rooms,
      totalTables: mesas.length,
      occupiedTables,
      inCheckTables,
      availableTables,
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  // ==========================================
  // Table Merge Neutral Hook
  // ==========================================

  public mergeTablesHook(input: MergeTablesInput): void {
    if (input.operatorPin) {
      this.#pinValidator.validatePin(input.operatorUserId, input.operatorPin);
    }
    // As mandated by IMPLEMENTATION_PLAN.md: table-merge semantics remain neutral hook pending PO decision
    throw new DomainError(
      'Table merge semantics remain pending explicit Product Owner specification beyond neutral hook',
      'TABLE_MERGE_NOT_SPECIFIED',
      501,
    );
  }
}
