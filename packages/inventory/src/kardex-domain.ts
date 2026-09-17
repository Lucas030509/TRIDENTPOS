/**
 * TRIDENTPOS Inventory Kárdex & Waste Domain Validation & Helpers
 *
 * Pure domain logic for WP-018:
 * - Waste command validation
 * - Movement type validation
 * - Exact fixed-point aggregation of ingredient deltas
 * - Scale-4 numerical validation
 */

import type { RegisterWasteCommand, StockMovementType } from './types.js';
import { CANONICAL_STOCK_MOVEMENT_TYPES } from './types.js';
import {
  InvalidMovementTypeError,
  InvalidQuantityDeltaError,
  InvalidWasteCommandError,
} from './errors.js';
import { addScale4, parseDecimal12x4 } from './numerics.js';

/**
 * Validates a RegisterWasteCommand per ACR-2026-017 §6, §11.
 * Fails closed on blank/empty fields, zero quantity, or negative caller quantity.
 */
export function validateWasteCommand(command: RegisterWasteCommand): void {
  if (!command) {
    throw new InvalidWasteCommandError('Waste command is required');
  }

  if (!command.commandId || command.commandId.trim().length === 0) {
    throw new InvalidWasteCommandError('commandId is mandatory and cannot be blank');
  }

  if (!command.organizationId || command.organizationId.trim().length === 0) {
    throw new InvalidWasteCommandError('organizationId is mandatory');
  }

  if (!command.branchId || command.branchId.trim().length === 0) {
    throw new InvalidWasteCommandError('branchId is mandatory');
  }

  if (!command.warehouseId || command.warehouseId.trim().length === 0) {
    throw new InvalidWasteCommandError('warehouseId is mandatory');
  }

  if (!command.ingredientId || command.ingredientId.trim().length === 0) {
    throw new InvalidWasteCommandError('ingredientId is mandatory');
  }

  if (!command.reasonCode || command.reasonCode.trim().length === 0) {
    throw new InvalidWasteCommandError('reasonCode is mandatory and cannot be blank');
  }

  if (!command.photoAttachmentUrl || command.photoAttachmentUrl.trim().length === 0) {
    throw new InvalidWasteCommandError('photoAttachmentUrl is mandatory and cannot be blank');
  }

  const quantityScaled = parseDecimal12x4(command.quantity);
  if (quantityScaled <= 0n) {
    throw new InvalidQuantityDeltaError(
      `Waste quantity must be strictly positive (scale-4), got '${command.quantity}'`,
    );
  }
}

/**
 * Validates whether a string is a canonical stock movement type.
 */
export function validateMovementType(type: string): StockMovementType {
  if (!CANONICAL_STOCK_MOVEMENT_TYPES.includes(type as StockMovementType)) {
    throw new InvalidMovementTypeError(type);
  }
  return type as StockMovementType;
}

/**
 * Deterministically aggregates gross ingredient quantities by ingredientId using exact scale-4 arithmetic.
 * Returns array sorted by ingredientId ASC to guarantee deterministic processing order and prevent deadlocks.
 */
export function aggregateIngredientQuantities(
  items: readonly { ingredientId: string; grossScaled: bigint }[],
): readonly { ingredientId: string; totalGrossScaled: bigint }[] {
  const map = new Map<string, bigint>();

  for (const item of items) {
    const current = map.get(item.ingredientId) ?? 0n;
    map.set(item.ingredientId, addScale4(current, item.grossScaled));
  }

  const sortedIds = Array.from(map.keys()).sort();
  return sortedIds.map((ingredientId) => ({
    ingredientId,
    totalGrossScaled: map.get(ingredientId)!,
  }));
}
