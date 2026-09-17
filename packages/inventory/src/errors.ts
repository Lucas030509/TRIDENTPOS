/**
 * TRIDENTPOS Inventory Domain Errors
 */

export class InventoryDomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string = 'INVENTORY_DOMAIN_ERROR', statusCode: number = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CycleDetectedError extends InventoryDomainError {
  public readonly cyclePath: readonly string[];

  constructor(cyclePath: readonly string[]) {
    super(
      `Direct or indirect cycle detected in recipe explosion graph: ${cyclePath.join(' -> ')}`,
      'CYCLE_DETECTED',
      422,
    );
    this.cyclePath = cyclePath;
  }
}

export class InvalidRecipeItemError extends InventoryDomainError {
  constructor(message: string) {
    super(message, 'INVALID_RECIPE_ITEM', 400);
  }
}

export class ZeroDivisorError extends InventoryDomainError {
  constructor(message: string) {
    super(message, 'ZERO_DIVISOR_ERROR', 422);
  }
}

export class RecipeNotFoundError extends InventoryDomainError {
  public readonly recipeId: string;

  constructor(recipeId: string) {
    super(`Recipe '${recipeId}' not found`, 'RECIPE_NOT_FOUND', 404);
    this.recipeId = recipeId;
  }
}
