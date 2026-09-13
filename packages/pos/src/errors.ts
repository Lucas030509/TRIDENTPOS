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
