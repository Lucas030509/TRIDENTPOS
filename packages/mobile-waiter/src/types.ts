/**
 * TRIDENTPOS WP-025: Mobile Waiter Handheld Client Domain Types
 * Floor plan, comanda assembly, OCC conflict resolution, bill splitting (DEC-015),
 * table transfers with receiver PIN (DEC-011), manager void (DEC-013), and QR trust bootstrap (SEC-VAL-03).
 */

// -------------------------------------------------------------
// Dining & Floor Plan Models
// -------------------------------------------------------------
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'PRINTED' | 'RESERVED' | 'PAYING';

export interface TableArea {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly displayOrder: number;
}

export interface DiningTable {
  readonly id: string;
  readonly code: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly capacity: number;
  readonly status: TableStatus;
  readonly activeAccountId?: string;
  readonly assignedWaiterId?: string;
  readonly assignedWaiterName?: string;
  readonly dinerCount?: number;
  readonly openedAt?: string;
  readonly totalBalanceScale4: string; // ADR-012 exact scale-4
  readonly version: number; // For OCC 409 concurrency control
}

// -------------------------------------------------------------
// Comanda & Modifiers Models
// -------------------------------------------------------------
export type ModifierKind = 'ADDITIVE' | 'SUBTRACTIVE'; // DEC-016

export interface SelectedModifier {
  readonly id: string;
  readonly name: string;
  readonly kind: ModifierKind;
  readonly priceDeltaScale4: string; // Extra $15.0000 or $0.0000
}

export interface ComandaItemDraft {
  readonly draftItemId: string;
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly unitPriceScale4: string;
  readonly quantityScale4: string; // e.g. "1.0000"
  readonly selectedModifiers: readonly SelectedModifier[];
  readonly cookingNote?: string;
  readonly subtotalScale4: string;
}

export interface MobileComandaDraft {
  readonly tableId: string;
  readonly tableCode: string;
  readonly accountId: string;
  readonly waiterId: string;
  readonly waiterName: string;
  readonly expectedTableVersion: number;
  readonly items: readonly ComandaItemDraft[];
  readonly totalComandaScale4: string;
}

export interface ComandaDispatchResult {
  readonly success: boolean;
  readonly orderId?: string;
  readonly newTableVersion?: number;
  readonly dispatchedAt: string;
  readonly kdsTicketId?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly remoteVersion?: number;
  };
}

// -------------------------------------------------------------
// OCC 409 Concurrency Control
// -------------------------------------------------------------
export interface OccConflictResolution {
  readonly tableId: string;
  readonly expectedVersion: number;
  readonly remoteVersion: number;
  readonly remoteTableState: DiningTable;
  readonly strategy: 'RELOAD_AND_DISCARD' | 'REAPPLY_ON_TOP';
}

// -------------------------------------------------------------
// DEC-015 / OQ-SSOT-06: Proportional Bill Splitting Models
// -------------------------------------------------------------
export type BillSplitMode = 'EQUAL' | 'BY_ITEM' | 'CUSTOM_PERCENT';

export interface SubAccountDraft {
  readonly subAccountId: string;
  readonly label: string; // e.g. "Persona 1"
  readonly items: readonly ComandaItemDraft[];
  readonly rawSubtotalScale4: string;
  readonly proratedDiscountScale4: string;
  readonly proratedTipScale4: string;
  readonly totalToPayScale4: string;
}

export interface BillSplitResult {
  readonly originalTotalScale4: string;
  readonly subAccounts: readonly SubAccountDraft[];
  readonly sumOfSubAccountsScale4: string;
  readonly roundingResidueScale4: string; // Always allocated to the last subaccount
  readonly balanced: boolean; // Must strictly equal true
}

// -------------------------------------------------------------
// DEC-011 / OQ-SSOT-02: Table Transfer with Receiver PIN Models
// -------------------------------------------------------------
export interface TableTransferRequest {
  readonly tableId: string;
  readonly fromWaiterId: string;
  readonly toWaiterId: string;
  readonly receiverPin: string;
  readonly reason?: string;
}

export interface TableTransferResult {
  readonly success: boolean;
  readonly tableId: string;
  readonly transferredAt: string;
  readonly previousWaiterId: string;
  readonly newWaiterId: string;
  readonly error?: string;
}

// -------------------------------------------------------------
// DEC-013 / OQ-SSOT-04: Manager Void from Mobile Models
// -------------------------------------------------------------
export interface MobileVoidRequest {
  readonly tableId: string;
  readonly accountId: string;
  readonly managerPin: string;
  readonly reasonCode: string; // Mandatory catalog reason
  readonly reasonNotes: string;
  readonly hadPrecuentaPrinted: boolean;
}

export interface MobileVoidResult {
  readonly success: boolean;
  readonly accountId: string;
  readonly voidedAt: string;
  readonly authorizedByManagerId: string;
  readonly voidReason: string;
  readonly folioAnnulled?: string;
  readonly error?: string;
}

// -------------------------------------------------------------
// SEC-VAL-03: QR Station Enrollment & Trust Bootstrap
// -------------------------------------------------------------
export interface QrEnrollmentPayload {
  readonly edgeHostUrl: string; // e.g. "https://192.168.1.100:8443"
  readonly stationId: string;
  readonly pairingToken: string;
  readonly serverFingerprintSha256: string; // 64 hex chars
  readonly issuedAt: number;
}

export interface StationPairingState {
  readonly isEnrolled: boolean;
  readonly edgeHostUrl: string | null;
  readonly stationId: string | null;
  readonly stationToken: string | null;
  readonly verifiedFingerprintSha256: string | null;
  readonly enrolledAt: number | null;
}

// -------------------------------------------------------------
// ADR-005: Network Health & Dead-Zone Queue
// -------------------------------------------------------------
export type NetworkState = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'DEAD_ZONE';

export interface QueuedMutation {
  readonly id: string;
  readonly type: 'DISPATCH_COMANDA' | 'TRANSFER_TABLE' | 'VOID_ACCOUNT';
  readonly payload: unknown;
  readonly queuedAt: number;
  readonly retryCount: number;
  readonly status: 'PENDING' | 'SENDING' | 'FAILED';
}

export interface WaiterProfile {
  readonly id: string;
  readonly name: string;
  readonly pinHash: string; // Salted SHA-256 for local fast login
  readonly activeBranchId: string;
}
