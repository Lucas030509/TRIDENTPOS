/**
 * TRIDENTPOS POS Domain Errors
 */

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string = 'DOMAIN_ERROR', statusCode: number = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Optimistic Concurrency Control Conflict Error (HTTP 409).
 * Returns the current aggregate snapshot to allow the client to resolve or re-fetch.
 */
export class OCCConflictError extends DomainError {
  public readonly aggregateId: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;
  public readonly currentSnapshot: unknown;

  constructor(
    aggregateId: string,
    expectedVersion: number,
    actualVersion: number,
    currentSnapshot: unknown,
    message?: string,
  ) {
    super(
      message ??
        `OCC conflict on aggregate '${aggregateId}': expected version ${expectedVersion}, but current version is ${actualVersion}`,
      'OCC_CONFLICT',
      409,
    );
    this.name = 'OCCConflictError';
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    this.currentSnapshot = currentSnapshot;
  }
}

export class ShiftAlreadyOpenError extends DomainError {
  constructor(stationId: string) {
    super(`Station '${stationId}' already has an active open shift`, 'SHIFT_ALREADY_OPEN', 409);
    this.name = 'ShiftAlreadyOpenError';
  }
}

export class ShiftNotFoundError extends DomainError {
  constructor(shiftId: string) {
    super(`Shift '${shiftId}' not found`, 'SHIFT_NOT_FOUND', 404);
    this.name = 'ShiftNotFoundError';
  }
}

export class ShiftInvalidStatusError extends DomainError {
  constructor(shiftId: string, currentStatus: string, expectedStatus: string) {
    super(
      `Shift '${shiftId}' is in status '${currentStatus}', but expected '${expectedStatus}'`,
      'SHIFT_INVALID_STATUS',
      400,
    );
    this.name = 'ShiftInvalidStatusError';
  }
}

export class ShiftLockedError extends DomainError {
  constructor(shiftId: string) {
    super(
      `Shift '${shiftId}' is permanently locked (Corte Z issued) and cannot be modified`,
      'SHIFT_LOCKED',
      409,
    );
    this.name = 'ShiftLockedError';
  }
}

export class UnauthorizedShiftOperatorError extends DomainError {
  constructor(operatorUserId: string, shiftId: string) {
    super(
      `User '${operatorUserId}' is not authorized or participating in shift '${shiftId}'`,
      'UNAUTHORIZED_SHIFT_OPERATOR',
      403,
    );
    this.name = 'UnauthorizedShiftOperatorError';
  }
}

export class InvalidCashMovementError extends DomainError {
  constructor(reason: string) {
    super(`Invalid cash movement: ${reason}`, 'INVALID_CASH_MOVEMENT', 400);
    this.name = 'InvalidCashMovementError';
  }
}

export class InvalidOperatorPinError extends DomainError {
  constructor(userId: string) {
    super(`Invalid or unauthorized PIN for user '${userId}'`, 'INVALID_OPERATOR_PIN', 401);
    this.name = 'InvalidOperatorPinError';
  }
}

export class PaymentValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'PAYMENT_VALIDATION_ERROR', 400);
    this.name = 'PaymentValidationError';
  }
}

export class AccountNotPayableError extends DomainError {
  constructor(cuentaId: string, currentStatus: string) {
    super(
      `Account '${cuentaId}' is in status '${currentStatus}' and cannot receive payments`,
      'ACCOUNT_NOT_PAYABLE',
      400,
    );
    this.name = 'AccountNotPayableError';
  }
}

export class ShiftNotOpenError extends DomainError {
  constructor(shiftId: string, currentStatus: string) {
    super(
      `Shift '${shiftId}' is in status '${currentStatus}' and cannot process payments (must be ABIERTO)`,
      'SHIFT_NOT_OPEN',
      400,
    );
    this.name = 'ShiftNotOpenError';
  }
}
