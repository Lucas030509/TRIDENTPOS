/**
 * TRIDENTPOS Product Owner Decision Policies (DEC-010, DEC-011, DEC-015)
 * Pure domain implementations per ADR-012, ADR-013, and PRODUCT_OWNER_OQ_RESOLUTION.md.
 * Strictly uses scale-4 bigint for all financial arithmetic — zero floating point.
 */

import type { Cuenta, CuentaItem, Mesa } from './types.js';
import { DomainError } from './errors.js';

/**
 * DEC-010 (OQ-SSOT-01): Post-kitchen cancellation semantics.
 * Governs whether and how kitchen-committed lines can be cancelled.
 */
export interface CancellationContext {
  readonly operatorUserId: string;
  readonly operatorRole?: string;
  readonly kitchenStatus: string;
  readonly hasSupervisorAuthorization?: boolean;
  readonly reason?: string;
}

export interface CancellationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresWasteRecord?: boolean;
}

export interface CancellationPolicy {
  canCancelItem(item: CuentaItem, context: CancellationContext): CancellationResult;
}

export class KdsStateBasedCancellationPolicy implements CancellationPolicy {
  public canCancelItem(item: CuentaItem, context: CancellationContext): CancellationResult {
    const reason = context.reason?.trim();
    if (!reason) {
      return {
        allowed: false,
        reason: 'Cancellation reason is mandatory',
        requiresWasteRecord: false,
      };
    }

    const status = context.kitchenStatus?.toUpperCase();
    const isUnstarted =
      status === 'SIN_INICIAR' ||
      status === 'PENDIENTE' ||
      status === 'RECIBIDO' ||
      status === 'ORDENADO';

    if (isUnstarted) {
      // Unstarted in kitchen: waiter/operator can cancel with mandatory reason; 0 waste.
      return {
        allowed: true,
        requiresWasteRecord: false,
      };
    }

    const isInProgressOrDelivered =
      status === 'EN_PREPARACION' ||
      status === 'EN_COCINA' ||
      status === 'PREPARADO' ||
      status === 'LISTO' ||
      status === 'ENTREGADO';

    if (isInProgressOrDelivered) {
      // In preparation / ready / delivered: requires supervisor PIN / authorization + mandatory reason; automatic waste record.
      if (!context.hasSupervisorAuthorization) {
        return {
          allowed: false,
          reason:
            'Cancellation of in-preparation/ready/delivered item requires supervisor authorization',
          requiresWasteRecord: false,
        };
      }

      return {
        allowed: true,
        requiresWasteRecord: true,
      };
    }

    // Default unknown state: fail closed
    if (!context.hasSupervisorAuthorization) {
      return {
        allowed: false,
        reason: `Cancellation disallowed for kitchen status '${status}' without supervisor authorization`,
        requiresWasteRecord: false,
      };
    }

    return {
      allowed: true,
      requiresWasteRecord: true,
    };
  }
}

/**
 * DEC-011 (OQ-SSOT-02): Table and account transfer validation rules.
 * Governs whether transfers require receiving waiter PIN confirmation.
 */
export interface TransferValidationContext {
  readonly operatorUserId: string;
  readonly targetWaiterUserId?: string;
  readonly targetWaiterPinProvided?: boolean;
  readonly reason?: string;
}

export interface TransferValidationResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface TransferValidationRule {
  validateTransfer(
    sourceMesa: Mesa,
    targetMesa: Mesa,
    cuenta: Cuenta,
    context: TransferValidationContext,
  ): TransferValidationResult;
}

export class ReceivingWaiterPinTransferValidationRule implements TransferValidationRule {
  public validateTransfer(
    sourceMesa: Mesa,
    targetMesa: Mesa,
    cuenta: Cuenta,
    context: TransferValidationContext,
  ): TransferValidationResult {
    if (cuenta.status !== 'ABIERTA' && cuenta.status !== 'IMPRESA') {
      return {
        allowed: false,
        reason: `Cannot transfer cuenta in status '${cuenta.status}'`,
      };
    }

    if (
      sourceMesa.id === targetMesa.id &&
      context.targetWaiterUserId === cuenta.currentWaiterUserId
    ) {
      return {
        allowed: false,
        reason: 'Source and target table/waiter are identical',
      };
    }

    if (sourceMesa.id !== targetMesa.id && targetMesa.status !== 'DISPONIBLE') {
      return {
        allowed: false,
        reason: `Target table '${targetMesa.tableNumber}' is not available (current status: ${targetMesa.status})`,
      };
    }

    if (!context.targetWaiterPinProvided) {
      return {
        allowed: false,
        reason: 'Transfer requires target waiter PIN confirmation',
      };
    }

    return { allowed: true };
  }
}

/**
 * DEC-015 (OQ-SSOT-06): Bill splitting proration semantics.
 * Governs how shared discounts, taxes, and items are split across sub-accounts.
 */
export interface SplitPartitionPlan {
  readonly partitionId: string;
  readonly itemIds?: readonly string[];
  readonly ratioScale4?: bigint;
}

export interface BillSplitProrationStrategy {
  prorateSplit(
    originalCuenta: Cuenta,
    partitions: readonly SplitPartitionPlan[],
  ): readonly Cuenta[];
}

export class ProportionalBillSplitStrategy implements BillSplitProrationStrategy {
  public prorateSplit(
    originalCuenta: Cuenta,
    partitions: readonly SplitPartitionPlan[],
  ): readonly Cuenta[] {
    if (partitions.length < 2) {
      throw new DomainError(
        'Split requires at least 2 partitions',
        'INVALID_SPLIT_PARTITIONS',
        400,
      );
    }

    const now = new Date().toISOString();
    const isByItems = partitions.some((p) => p.itemIds && p.itemIds.length > 0);

    if (isByItems) {
      return this.#splitByItems(originalCuenta, partitions, now);
    }

    return this.#splitByRatio(originalCuenta, partitions, now);
  }

  #splitByItems(
    originalCuenta: Cuenta,
    partitions: readonly SplitPartitionPlan[],
    now: string,
  ): readonly Cuenta[] {
    const activeItems = originalCuenta.items.filter((i) => i.status !== 'CANCELADO');
    const assignedItemIds = new Set<string>();

    for (const p of partitions) {
      for (const id of p.itemIds ?? []) {
        if (assignedItemIds.has(id)) {
          throw new DomainError(
            `Item '${id}' assigned to multiple partitions`,
            'DUPLICATE_SPLIT_ITEM',
            400,
          );
        }
        assignedItemIds.add(id);
      }
    }

    if (assignedItemIds.size !== activeItems.length) {
      throw new DomainError(
        'All active items must be assigned to exactly one partition for item-based split',
        'INCOMPLETE_ITEM_SPLIT',
        400,
      );
    }

    const itemMap = new Map<string, CuentaItem>(activeItems.map((i) => [i.id, i]));
    const totalOriginalSubtotal = activeItems.reduce((sum, item) => sum + item.subtotal, 0n);

    const subCuentas: Cuenta[] = [];
    let runningTips = 0n;

    for (let i = 0; i < partitions.length; i++) {
      const p = partitions[i]!;
      const isLast = i === partitions.length - 1;
      const partItems: CuentaItem[] = [];

      for (const id of p.itemIds ?? []) {
        const it = itemMap.get(id);
        if (it) {
          partItems.push(it);
        }
      }

      let partSubtotal = 0n;
      let partTax = 0n;
      let partItemDiscounts = 0n;

      for (const it of partItems) {
        partSubtotal += it.subtotal;
        partTax += it.taxAmountApplied;
        partItemDiscounts += it.discountAmountApplied;
      }

      let proratedTips = 0n;
      if (totalOriginalSubtotal > 0n) {
        if (isLast) {
          proratedTips = originalCuenta.tipsTotal - runningTips;
        } else {
          proratedTips = (originalCuenta.tipsTotal * partSubtotal) / totalOriginalSubtotal;
          runningTips += proratedTips;
        }
      }

      const partTotalAmount = partSubtotal - partItemDiscounts + partTax + proratedTips;

      subCuentas.push({
        id: p.partitionId,
        folioNumber: null,
        epochId: originalCuenta.epochId,
        mesaId: originalCuenta.mesaId,
        accountType: originalCuenta.accountType,
        status: 'ABIERTA',
        subtotal: partSubtotal,
        taxTotal: partTax,
        discountsTotal: partItemDiscounts,
        tipsTotal: proratedTips,
        totalAmount: partTotalAmount,
        openedByUserId: originalCuenta.openedByUserId,
        currentWaiterUserId: originalCuenta.currentWaiterUserId,
        guestCount: 1,
        openedAt: now,
        closedAt: null,
        version: 1,
        updatedAt: now,
        parentCuentaId: originalCuenta.id,
        splitSequence: i + 1,
        items: partItems,
      });
    }

    return subCuentas;
  }

  #splitByRatio(
    originalCuenta: Cuenta,
    partitions: readonly SplitPartitionPlan[],
    now: string,
  ): readonly Cuenta[] {
    const totalRatio = partitions.reduce((sum, p) => sum + (p.ratioScale4 ?? 10000n), 0n);
    if (totalRatio <= 0n) {
      throw new DomainError(
        'Total split ratio must be greater than zero',
        'INVALID_SPLIT_RATIO',
        400,
      );
    }

    const subCuentas: Cuenta[] = [];
    let runningSubtotal = 0n;
    let runningTax = 0n;
    let runningDiscounts = 0n;
    let runningTips = 0n;
    let runningTotalAmount = 0n;

    for (let i = 0; i < partitions.length; i++) {
      const p = partitions[i]!;
      const ratio = p.ratioScale4 ?? 10000n;
      const isLast = i === partitions.length - 1;

      let subtotal: bigint;
      let taxTotal: bigint;
      let discountsTotal: bigint;
      let tipsTotal: bigint;
      let totalAmount: bigint;

      if (isLast) {
        // Residual allocated to last sub-account
        subtotal = originalCuenta.subtotal - runningSubtotal;
        taxTotal = originalCuenta.taxTotal - runningTax;
        discountsTotal = originalCuenta.discountsTotal - runningDiscounts;
        tipsTotal = originalCuenta.tipsTotal - runningTips;
        totalAmount = originalCuenta.totalAmount - runningTotalAmount;
      } else {
        subtotal = (originalCuenta.subtotal * ratio) / totalRatio;
        taxTotal = (originalCuenta.taxTotal * ratio) / totalRatio;
        discountsTotal = (originalCuenta.discountsTotal * ratio) / totalRatio;
        tipsTotal = (originalCuenta.tipsTotal * ratio) / totalRatio;
        totalAmount = (originalCuenta.totalAmount * ratio) / totalRatio;

        runningSubtotal += subtotal;
        runningTax += taxTotal;
        runningDiscounts += discountsTotal;
        runningTips += tipsTotal;
        runningTotalAmount += totalAmount;
      }

      subCuentas.push({
        id: p.partitionId,
        folioNumber: null,
        epochId: originalCuenta.epochId,
        mesaId: originalCuenta.mesaId,
        accountType: originalCuenta.accountType,
        status: 'ABIERTA',
        subtotal,
        taxTotal,
        discountsTotal,
        tipsTotal,
        totalAmount,
        openedByUserId: originalCuenta.openedByUserId,
        currentWaiterUserId: originalCuenta.currentWaiterUserId,
        guestCount: 1,
        openedAt: now,
        closedAt: null,
        version: 1,
        updatedAt: now,
        parentCuentaId: originalCuenta.id,
        splitSequence: i + 1,
        items: [],
      });
    }

    return subCuentas;
  }
}
