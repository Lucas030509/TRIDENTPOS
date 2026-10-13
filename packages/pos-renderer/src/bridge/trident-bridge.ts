/**
 * TRIDENTPOS Typed IPC Bridge Client (FRONTEND_ARCHITECTURE.md Sec 5 & Decision FE-05)
 * Strict types and result envelopes for window.trident bridge API.
 * Renderer NEVER talks directly to network (connect-src 'none').
 */

import type {
  CancelCuentaItemDTO,
  TransferCuentaDTO,
  SplitCuentaDTO,
  ReassignWaiterDTO,
  ChangeGuestCountDTO,
  RequestCheckDTO,
  ReleaseMesaDTO,
  SalonReadModelDTO,
  SubmitTenderRequestDTO,
  TenderResultDTO,
  AccountPaymentsSummaryDTO,
} from '@trident/core';

export type {
  CancelCuentaItemDTO,
  TransferCuentaDTO,
  SplitCuentaDTO,
  ReassignWaiterDTO,
  ChangeGuestCountDTO,
  RequestCheckDTO,
  ReleaseMesaDTO,
  SalonReadModelDTO,
  SubmitTenderRequestDTO,
  TenderResultDTO,
  AccountPaymentsSummaryDTO,
};

export type ErrorCode =
  | 'CONFLICT_VERSION'
  | 'AUTHORIZATION_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'EDGE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL';

export interface ConflictInfo {
  readonly expectedVersion: number;
  readonly serverVersion: number;
  readonly entityId: string;
}

export type BridgeResult<T> =
  | { readonly ok: true; readonly data: T; readonly version?: number }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: ErrorCode;
        readonly message: string;
        readonly retryable: boolean;
        readonly conflict?: ConflictInfo;
        readonly requiredPermission?: string;
      };
    };

export interface SessionView {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly branchId: string;
  readonly stationId: string;
  readonly expiresAt: string;
}

export type StationMode = 'POS' | 'KDS' | 'CAJA' | 'POS+CAJA';

export interface StationProfile {
  readonly stationId: string;
  readonly stationName: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly mode: StationMode;
}

export interface ConnectivityStatus {
  readonly edge: 'online' | 'degraded' | 'offline';
  readonly lan: 'online' | 'degraded' | 'offline';
  readonly cloud: 'online' | 'degraded' | 'offline';
}

export interface DomainEvent {
  readonly eventType: string;
  readonly eventContractVersion: number;
  readonly entityId: string;
  readonly payload: unknown;
  readonly timestamp: string;
}

export interface KdsTicketItemDTO {
  readonly id: string;
  readonly productName: string;
  readonly quantity: number;
  readonly notes?: string;
  readonly status: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';
}

export interface KdsTicketDTO {
  readonly id: string;
  readonly folio: number;
  readonly tableNumber: string;
  readonly waiterName: string;
  readonly items: readonly KdsTicketItemDTO[];
  readonly status: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO';
  readonly createdAt: string;
  readonly targetSeconds: number;
}

export interface CashShiftStatusDTO {
  readonly turnoCajaId: string | null;
  readonly status: 'ABIERTO' | 'CERRADO' | 'NO_INICIADO';
  readonly openedAt: string | null;
  readonly cashierUserId: string | null;
  readonly startingCash: string;
  readonly currentBalance: string;
}

export interface TridentApi {
  readonly session: {
    readonly login: (credentials: {
      readonly userCode: string;
      readonly pin: string;
    }) => Promise<BridgeResult<SessionView>>;
    readonly logout: () => Promise<BridgeResult<{ readonly loggedOut: boolean }>>;
    readonly getCurrentSession: () => Promise<BridgeResult<SessionView | null>>;
    readonly authorize: (params: {
      readonly commandRef: string;
      readonly pin: string;
    }) => Promise<BridgeResult<{ readonly authorized: boolean }>>;
  };
  readonly station: {
    readonly getStationProfile: () => Promise<BridgeResult<StationProfile>>;
    readonly getConnectivityStatus: () => Promise<BridgeResult<ConnectivityStatus>>;
  };
  readonly salon: {
    readonly getSalonReadModel: () => Promise<BridgeResult<SalonReadModelDTO>>;
    readonly cancelItem: (
      params: CancelCuentaItemDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly transferCuenta: (
      params: TransferCuentaDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly splitCuenta: (
      params: SplitCuentaDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly reassignWaiter: (
      params: ReassignWaiterDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly changeGuestCount: (
      params: ChangeGuestCountDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly requestCheck: (
      params: RequestCheckDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly releaseMesa: (
      params: ReleaseMesaDTO,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
  };
  readonly kds: {
    readonly getTickets: (estacionId: string) => Promise<BridgeResult<readonly KdsTicketDTO[]>>;
    readonly bumpTicket: (
      ticketId: string,
      clientOpId: string,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
  };
  readonly caja: {
    readonly getShiftStatus: () => Promise<BridgeResult<CashShiftStatusDTO>>;
    readonly submitTender: (
      request: SubmitTenderRequestDTO,
    ) => Promise<BridgeResult<TenderResultDTO>>;
    readonly getAccountPayments: (
      cuentaId: string,
    ) => Promise<BridgeResult<AccountPaymentsSummaryDTO>>;
  };
  readonly events: {
    readonly subscribe: (callback: (event: DomainEvent) => void) => () => void;
  };
  readonly diagnostics: {
    readonly report: (error: {
      readonly message: string;
      readonly context?: string;
    }) => Promise<void>;
  };
}

declare global {
  interface Window {
    readonly trident?: TridentApi;
  }
}

/**
 * Creates an in-memory Mock Trident API for testing and fallback environments.
 */
export function createMockTridentBridge(initialSession: SessionView | null = null): TridentApi {
  let sessionState: SessionView | null = initialSession;
  const eventListeners = new Set<(event: DomainEvent) => void>();

  return {
    session: {
      async login({ userCode, pin }) {
        if (pin === '0000' || pin === '1234') {
          sessionState = {
            userId: 'usr-1',
            displayName: userCode === 'admin' ? 'Gerente Principal' : 'Mesero / Cajero',
            roles: userCode === 'admin' ? ['GERENTE', 'CAJERO'] : ['MESERO'],
            permissions: ['pos.access', 'caja.access', 'salon.access'],
            branchId: 'branch-1',
            stationId: 'st-01',
            expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
          };
          return { ok: true, data: sessionState };
        }
        return {
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Credenciales inválidas', retryable: false },
        };
      },
      async logout() {
        sessionState = null;
        return { ok: true, data: { loggedOut: true } };
      },
      async getCurrentSession() {
        return { ok: true, data: sessionState };
      },
      async authorize({ pin }) {
        if (pin === '9999' || pin === '0000') {
          return { ok: true, data: { authorized: true } };
        }
        return {
          ok: false,
          error: { code: 'FORBIDDEN', message: 'PIN de supervisor incorrecto', retryable: false },
        };
      },
    },
    station: {
      async getStationProfile() {
        return {
          ok: true,
          data: {
            stationId: 'st-01',
            stationName: 'Terminal Principal Salón',
            branchId: 'branch-1',
            branchName: 'Sucursal Matriz',
            mode: 'POS+CAJA',
          },
        };
      },
      async getConnectivityStatus() {
        return {
          ok: true,
          data: { edge: 'online', lan: 'online', cloud: 'online' },
        };
      },
    },
    salon: {
      async getSalonReadModel() {
        return {
          ok: true,
          data: {
            rooms: [
              {
                name: 'Principal',
                tables: [
                  {
                    id: 'mesa-1',
                    roomName: 'Principal',
                    tableNumber: '1',
                    status: 'DISPONIBLE',
                    currentAccountId: null,
                    assignedWaiterUserId: null,
                    guestCount: 0,
                    subtotal: '0.0000',
                    totalAmount: '0.0000',
                    openedAt: null,
                    attentionSignal: { flagged: false, reason: null, elapsedMinutes: 0 },
                    version: 1,
                    updatedAt: new Date().toISOString(),
                  },
                ],
              },
            ],
            totalTables: 1,
            occupiedTables: 0,
            inCheckTables: 0,
            availableTables: 1,
            generatedAt: new Date().toISOString(),
          },
        };
      },
      async cancelItem() {
        return { ok: true, data: { success: true } };
      },
      async transferCuenta() {
        return { ok: true, data: { success: true } };
      },
      async splitCuenta() {
        return { ok: true, data: { success: true } };
      },
      async reassignWaiter() {
        return { ok: true, data: { success: true } };
      },
      async changeGuestCount() {
        return { ok: true, data: { success: true } };
      },
      async requestCheck() {
        return { ok: true, data: { success: true } };
      },
      async releaseMesa() {
        return { ok: true, data: { success: true } };
      },
    },
    kds: {
      async getTickets() {
        return { ok: true, data: [] };
      },
      async bumpTicket() {
        return { ok: true, data: { success: true } };
      },
    },
    caja: {
      async getShiftStatus() {
        return {
          ok: true,
          data: {
            turnoCajaId: 'turno-1',
            status: 'ABIERTO',
            openedAt: new Date().toISOString(),
            cashierUserId: 'usr-1',
            startingCash: '1000.0000',
            currentBalance: '1000.0000',
          },
        };
      },
      async submitTender(req) {
        return {
          ok: true,
          data: {
            id: 'pago-1',
            cuentaId: req.cuentaId,
            turnoCajaId: req.turnoCajaId,
            operatorUserId: req.operatorUserId,
            paymentMethod: req.paymentMethod,
            amount: req.amount,
            tipAmount: req.tipAmount ?? '0.0000',
            cashGiven: req.cashGiven ?? null,
            changeDue: '0.0000',
            referenceAuthCode: req.referenceAuthCode ?? null,
            clientOpId: req.clientOpId,
            remainingBalance: '0.0000',
            accountSettled: true,
            accountStatus: 'CERRADA_PAGADA',
            closedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        };
      },
      async getAccountPayments(cuentaId) {
        return {
          ok: true,
          data: {
            cuentaId,
            totalAmount: '0.0000',
            totalPaid: '0.0000',
            totalTips: '0.0000',
            remainingBalance: '0.0000',
            isSettled: true,
            accountStatus: 'ABIERTA',
            payments: [],
          },
        };
      },
    },
    events: {
      subscribe(callback) {
        eventListeners.add(callback);
        return () => {
          eventListeners.delete(callback);
        };
      },
    },
    diagnostics: {
      async report() {
        // no-op in mock
      },
    },
  };
}

/**
 * Returns the authoritative window.trident bridge, or a mock fallback in testing/headless mode.
 */
export function getTridentBridge(): TridentApi {
  if (typeof window !== 'undefined' && window.trident) {
    return window.trident;
  }
  return createMockTridentBridge();
}
