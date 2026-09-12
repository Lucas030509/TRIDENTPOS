/**
 * TRIDENTPOS Folio Lease & Fencing Protocol Domain Contracts
 * Conforms to DATA_MODEL.md Sec. 2.1, 3, SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3,
 * ADR-008, and COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md.
 */

export type FolioType = 'TICKET' | 'CORTE_X' | 'CORTE_Z' | 'FACTURA';

export const VALID_FOLIO_TYPES: ReadonlySet<FolioType> = new Set([
  'TICKET',
  'CORTE_X',
  'CORTE_Z',
  'FACTURA',
]);

export function isValidFolioType(val: unknown): val is FolioType {
  return typeof val === 'string' && VALID_FOLIO_TYPES.has(val as FolioType);
}

export type CloudFolioLeaseStatus =
  'ALLOCATED' | 'ACTIVE' | 'EXHAUSTED' | 'REVOKED' | 'ABANDONED_CONTINGENCY_RANGE' | 'RECONCILED';

export const VALID_CLOUD_LEASE_STATUSES: ReadonlySet<CloudFolioLeaseStatus> = new Set([
  'ALLOCATED',
  'ACTIVE',
  'EXHAUSTED',
  'REVOKED',
  'ABANDONED_CONTINGENCY_RANGE',
  'RECONCILED',
]);

export type LocalFolioLeaseStatus = 'ACTIVE' | 'EXHAUSTED' | 'REVOKED';

export const VALID_LOCAL_LEASE_STATUSES: ReadonlySet<LocalFolioLeaseStatus> = new Set([
  'ACTIVE',
  'EXHAUSTED',
  'REVOKED',
]);

// Governed Policy Values (COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md)
export const DEFAULT_BLOCK_SIZE = 500;
export const MIN_BLOCK_SIZE = 10;
export const MAX_BLOCK_SIZE = 5000;
export const NOMINAL_HEARTBEAT_INTERVAL_SECONDS = 60;
export const GREENFIELD_INITIAL_RANGE_START = 1;

// Canonical Protocol Error Codes
export const ERROR_CODE_LEASE_REVOKED = 'LEASE_REVOKED';
export const ERROR_CODE_INVALID_BLOCK_SIZE = 'INVALID_BLOCK_SIZE';
export const ERROR_CODE_INVALID_FOLIO_TYPE = 'INVALID_FOLIO_TYPE';
export const ERROR_CODE_FOLIO_OUT_OF_RANGE = 'FOLIO_OUT_OF_RANGE';
export const ERROR_CODE_HIGH_WATER_REGRESSION = 'HIGH_WATER_REGRESSION';
export const ERROR_CODE_UNAUTHORIZED_TENANT = 'UNAUTHORIZED_TENANT';
export const ERROR_CODE_UNAUTHORIZED_BRANCH = 'UNAUTHORIZED_BRANCH';
export const ERROR_CODE_INVALID_FENCING_TOKEN = 'INVALID_FENCING_TOKEN';
export const ERROR_CODE_LEASE_NOT_FOUND = 'LEASE_NOT_FOUND';
export const ERROR_CODE_ACTIVE_LEASE_EXISTS = 'ACTIVE_LEASE_EXISTS';
export const ERROR_CODE_INVALID_REQUEST = 'INVALID_REQUEST';

const EPOCH_REGEX = /^ep_([1-9]\d*)$/;

/**
 * Validates whether an epochId conforms to the canonical generation format ('ep_1', 'ep_2', etc.).
 */
export function isValidEpochId(epochId: unknown): epochId is string {
  return typeof epochId === 'string' && EPOCH_REGEX.test(epochId);
}

/**
 * Parses the numeric generation number from an epochId string.
 * Throws an Error if the epochId does not conform to 'ep_<positive_integer>'.
 */
export function parseEpochNumber(epochId: string): number {
  const match = EPOCH_REGEX.exec(epochId);
  if (!match || !match[1]) {
    throw new Error(
      `Malformed epochId '${epochId}'. Must match format 'ep_<positive_integer>' (e.g. 'ep_1').`,
    );
  }
  const num = parseInt(match[1], 10);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new Error(`Invalid epoch number parsed from '${epochId}'. Must be a positive integer.`);
  }
  return num;
}

/**
 * Formats a numeric generation number into an authoritative epochId ('ep_1', 'ep_2', etc.).
 */
export function formatEpochId(generationNumber: number): string {
  if (!Number.isSafeInteger(generationNumber) || generationNumber <= 0) {
    throw new Error(
      `Cannot format invalid epoch generation number: ${generationNumber}. Must be a positive integer.`,
    );
  }
  return `ep_${generationNumber}`;
}

/**
 * Compares two epochIds numerically and monotonically.
 * Returns negative if a < b, 0 if a == b, positive if a > b.
 * Guaranteed NON-LEXICAL: compareEpochs('ep_10', 'ep_2') > 0.
 */
export function compareEpochs(a: string, b: string): number {
  const numA = parseEpochNumber(a);
  const numB = parseEpochNumber(b);
  return numA - numB;
}

/**
 * Calculates the next sequential epochId.
 * If priorEpochId is omitted or null, returns 'ep_1'.
 * Otherwise returns 'ep_${num + 1}'.
 */
export function nextEpochId(priorEpochId?: string | null): string {
  if (!priorEpochId) {
    return 'ep_1';
  }
  const currentNum = parseEpochNumber(priorEpochId);
  return formatEpochId(currentNum + 1);
}
