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
  MesaSummaryDTO,
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
  MesaSummaryDTO,
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

export interface KdsTicketPartidaModifierDTO {
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
}

export interface KdsTicketItemDTO {
  readonly id: string;
  readonly productName: string;
  readonly quantity: number | string;
  readonly notes?: string | null;
  readonly status: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';
  readonly modifiers?: readonly KdsTicketPartidaModifierDTO[];
}

export interface KdsTicketDTO {
  readonly id: string;
  readonly folio: number | string;
  readonly cuentaId?: string;
  readonly tableNumber: string;
  readonly waiterName?: string;
  readonly kdsEstacionId?: string;
  readonly urgencyLevel?: 'NORMAL' | 'ALTA' | 'URGENTE';
  readonly items: readonly KdsTicketItemDTO[];
  readonly status: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO';
  readonly printStatus?: 'PENDING' | 'QUEUED' | 'PRINTING' | 'PRINTED' | 'FAILED';
  readonly printerId?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly completedAt?: string | null;
  readonly preparationTimeMinutes?: number | null;
  readonly targetSeconds: number;
}

export interface KdsEstacionDTO {
  readonly id: string;
  readonly name: string;
  readonly stationType: 'COCINA' | 'BARRA';
  readonly status: 'ACTIVA' | 'INACTIVA';
}

export interface CashShiftStatusDTO {
  readonly turnoCajaId: string | null;
  readonly status: 'ABIERTO' | 'CERRADO' | 'NO_INICIADO';
  readonly openedAt: string | null;
  readonly cashierUserId: string | null;
  readonly startingCash: string;
  readonly currentBalance: string;
}

// ==========================================
// Salón & Catalog DTOs (WP-026B)
// ==========================================

export interface CatalogCategoryDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface CatalogModifierOptionDTO {
  readonly id: string;
  readonly name: string;
  readonly extraPrice: string; // Scale 4
}

export interface CatalogModifierGroupDTO {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly CatalogModifierOptionDTO[];
}

export interface CatalogProductDTO {
  readonly id: string;
  readonly categoryId: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly basePrice: string; // Scale 4
  readonly taxRate: string; // Scale 4 (e.g. "0.1600")
  readonly modifierGroups?: readonly CatalogModifierGroupDTO[];
}

export interface CuentaItemModificadorDTO {
  readonly id: string;
  readonly modifierId: string;
  readonly modifierNameSnapshot: string;
  readonly modifierPriceApplied: string; // Scale 4
}

export interface CuentaItemDTO {
  readonly id: string;
  readonly cuentaId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPriceApplied: string; // Scale 4
  readonly quantity: string; // Scale 4
  readonly taxRateApplied: string; // Scale 4
  readonly taxAmountApplied: string; // Scale 4
  readonly discountAmountApplied: string; // Scale 4
  readonly subtotal: string; // Scale 4
  readonly total: string; // Scale 4
  readonly status: 'ORDENADO' | 'EN_COCINA' | 'PREPARADO' | 'ENTREGADO' | 'CANCELADO';
  readonly cancellationReason?: string | null;
  readonly cancelledByUserId?: string | null;
  readonly notes?: string | null;
  readonly createdAt: string;
  readonly modifiers: readonly CuentaItemModificadorDTO[];
}

export interface CuentaDetalleDTO {
  readonly id: string;
  readonly folioNumber: number | null;
  readonly mesaId: string | null;
  readonly tableNumber?: string;
  readonly roomName?: string;
  readonly accountType: 'COMEDOR' | 'MOSTRADOR' | 'RAPPI' | 'UBER' | 'DOMICILIO';
  readonly status: 'ABIERTA' | 'IMPRESA' | 'PAGADA' | 'ANULADA';
  readonly subtotal: string; // Scale 4
  readonly taxTotal: string; // Scale 4
  readonly discountsTotal: string; // Scale 4
  readonly tipsTotal: string; // Scale 4
  readonly totalAmount: string; // Scale 4
  readonly openedByUserId: string;
  readonly currentWaiterUserId?: string | null;
  readonly guestCount: number;
  readonly openedAt: string;
  readonly printedAt?: string | null;
  readonly closedAt?: string | null;
  readonly version: number;
  readonly updatedAt: string;
  readonly items: readonly CuentaItemDTO[];
}

export interface OpenMesaDTO {
  readonly mesaId: string;
  readonly guestCount: number;
  readonly waiterUserId?: string;
}

export interface EnviarComandaItemInput {
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPriceApplied: string;
  readonly quantity: string;
  readonly taxRateApplied: string;
  readonly notes?: string;
  readonly modifiers?: readonly {
    readonly modifierId: string;
    readonly modifierNameSnapshot: string;
    readonly modifierPriceApplied: string;
  }[];
}

export interface EnviarComandaDTO {
  readonly cuentaId: string;
  readonly expectedVersion: number;
  readonly items: readonly EnviarComandaItemInput[];
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
    readonly getCuentaDetalle: (cuentaId: string) => Promise<BridgeResult<CuentaDetalleDTO>>;
    readonly getCatalog: () => Promise<
      BridgeResult<{
        readonly categories: readonly CatalogCategoryDTO[];
        readonly products: readonly CatalogProductDTO[];
      }>
    >;
    readonly openMesa: (params: OpenMesaDTO) => Promise<BridgeResult<CuentaDetalleDTO>>;
    readonly enviarComanda: (params: EnviarComandaDTO) => Promise<BridgeResult<CuentaDetalleDTO>>;
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
    readonly getEstaciones: () => Promise<BridgeResult<readonly KdsEstacionDTO[]>>;
    readonly startPreparation: (
      ticketId: string,
      estacionId: string,
      clientOpId: string,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly bumpTicket: (
      ticketId: string,
      clientOpId: string,
      preparationTimeMinutes?: number,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly recallTicket: (
      ticketId: string,
      windowMinutes?: number,
    ) => Promise<BridgeResult<KdsTicketDTO | null>>;
    readonly getRecentCompletedTickets: (
      estacionId: string,
      windowMinutes?: number,
    ) => Promise<BridgeResult<readonly KdsTicketDTO[]>>;
    readonly reopenTicket: (
      ticketId: string,
      clientOpId: string,
    ) => Promise<BridgeResult<{ readonly success: boolean }>>;
    readonly toggleItemStatus: (
      ticketId: string,
      itemId: string,
      newStatus: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO',
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

  const broadcastEvent = (event: DomainEvent) => {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors in mock
      }
    }
  };

  // In-memory mock database for KDS
  const mockEstaciones: readonly KdsEstacionDTO[] = [
    { id: 'cocina-1', name: 'Cocina Caliente', stationType: 'COCINA', status: 'ACTIVA' },
    { id: 'cocina-2', name: 'Cocina Fría & Ensaladas', stationType: 'COCINA', status: 'ACTIVA' },
    { id: 'parrilla-1', name: 'Parrilla & Cortes', stationType: 'COCINA', status: 'ACTIVA' },
    { id: 'bar-1', name: 'Bar & Bebidas', stationType: 'BARRA', status: 'ACTIVA' },
  ];

  const mockKdsTickets: KdsTicketDTO[] = [
    {
      id: 'kds-ticket-1',
      folio: 101,
      cuentaId: 'cta-1',
      tableNumber: 'Mesa 4',
      waiterName: 'Carlos Mendoza',
      kdsEstacionId: 'cocina-1',
      urgencyLevel: 'NORMAL',
      status: 'EN_PREPARACION',
      printStatus: 'PRINTED',
      printerId: 'prn-cocina',
      targetSeconds: 900,
      createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      items: [
        {
          id: 'kds-item-1',
          productName: 'Tacos de Ribeye (Orden 3 pzas)',
          quantity: '2.0000',
          status: 'EN_PREPARACION',
          notes: 'Término medio, salsa verde aparte',
          modifiers: [
            { modifierId: 'm-1', modifierNameSnapshot: 'Término Medio' },
            { modifierId: 'm-2', modifierNameSnapshot: 'Salsa Verde Aparte' },
          ],
        },
        {
          id: 'kds-item-2',
          productName: 'Guacamole Rústico con Totopos',
          quantity: '1.0000',
          status: 'LISTO',
          notes: 'Sin cebolla',
          modifiers: [{ modifierId: 'm-3', modifierNameSnapshot: 'Sin Cebolla' }],
        },
      ],
    },
    {
      id: 'kds-ticket-2',
      folio: 102,
      cuentaId: 'cta-2',
      tableNumber: 'Mesa 2',
      waiterName: 'Ana Rojas',
      kdsEstacionId: 'cocina-1',
      urgencyLevel: 'ALTA',
      status: 'PENDIENTE',
      printStatus: 'PRINTED',
      printerId: 'prn-cocina',
      targetSeconds: 600,
      createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      items: [
        {
          id: 'kds-item-3',
          productName: 'Hamburguesa Trident Wagyu',
          quantity: '1.0000',
          status: 'PENDIENTE',
          notes: 'Término 3/4, Extra Queso Gouda',
          modifiers: [{ modifierId: 'm-4', modifierNameSnapshot: 'Extra Queso Gouda' }],
        },
        {
          id: 'kds-item-4',
          productName: 'Papas Trufadas con Parmesano',
          quantity: '1.0000',
          status: 'PENDIENTE',
          modifiers: [],
        },
      ],
    },
    {
      id: 'kds-ticket-3',
      folio: 103,
      cuentaId: 'cta-3',
      tableNumber: 'Para Llevar / Rappi',
      waiterName: 'Repartidor #482',
      kdsEstacionId: 'cocina-1',
      urgencyLevel: 'URGENTE',
      status: 'EN_PREPARACION',
      printStatus: 'PRINTED',
      printerId: 'prn-cocina',
      targetSeconds: 720,
      createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      items: [
        {
          id: 'kds-item-5',
          productName: 'Corte New York 400g',
          quantity: '1.0000',
          status: 'EN_PREPARACION',
          notes: 'URGENTE: Lleva 15 min en comanda',
          modifiers: [{ modifierId: 'm-5', modifierNameSnapshot: 'Término Tres Cuartos' }],
        },
      ],
    },
    {
      id: 'kds-ticket-4',
      folio: 104,
      cuentaId: 'cta-1',
      tableNumber: 'Mesa 4',
      waiterName: 'Carlos Mendoza',
      kdsEstacionId: 'bar-1',
      urgencyLevel: 'NORMAL',
      status: 'PENDIENTE',
      printStatus: 'PRINTED',
      printerId: 'prn-bar',
      targetSeconds: 300,
      createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      items: [
        {
          id: 'kds-item-6',
          productName: 'Margarita de la Casa (Mezcal)',
          quantity: '2.0000',
          status: 'PENDIENTE',
          notes: 'Escarchada con sal de gusano',
        },
      ],
    },
  ];

  const mockCompletedKdsTickets: KdsTicketDTO[] = [
    {
      id: 'kds-comp-1',
      folio: 100,
      cuentaId: 'cta-0',
      tableNumber: 'Mesa 1',
      waiterName: 'Carlos Mendoza',
      kdsEstacionId: 'cocina-1',
      urgencyLevel: 'NORMAL',
      status: 'LISTO',
      printStatus: 'PRINTED',
      printerId: 'prn-cocina',
      targetSeconds: 900,
      createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      preparationTimeMinutes: 15,
      items: [
        {
          id: 'kds-item-comp-1',
          productName: 'Tacos de Asada (Orden 3 pzas)',
          quantity: '1.0000',
          status: 'LISTO',
        },
      ],
    },
  ];

  // In-memory mock database for Salón
  const catalogCategories: readonly CatalogCategoryDTO[] = [
    { id: 'cat-1', code: 'ENT', name: 'Entradas', sortOrder: 1 },
    { id: 'cat-2', code: 'PRIN', name: 'Platos Fuertes', sortOrder: 2 },
    { id: 'cat-3', code: 'BEB', name: 'Bebidas & Coctelería', sortOrder: 3 },
    { id: 'cat-4', code: 'POS', name: 'Postres', sortOrder: 4 },
  ];

  const catalogProducts: readonly CatalogProductDTO[] = [
    {
      id: 'prod-1',
      categoryId: 'cat-1',
      code: 'E01',
      name: 'Guacamole Rústico con Totopos',
      description: 'Aguacate hass, pico de gallo, cilantro fresco y totopos artesanales.',
      basePrice: '120.0000',
      taxRate: '0.1600',
      modifierGroups: [
        {
          id: 'modg-picante',
          name: 'Nivel de Picante',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: 'opt-sin', name: 'Sin picante', extraPrice: '0.0000' },
            { id: 'opt-medio', name: 'Medio (Serrano picado)', extraPrice: '0.0000' },
            { id: 'opt-bravo', name: 'Muy bravo (Habanero)', extraPrice: '10.0000' },
          ],
        },
      ],
    },
    {
      id: 'prod-2',
      categoryId: 'cat-2',
      code: 'P01',
      name: 'Rib Eye Prime 400g',
      description: 'Corte prime al carbón con papas al romero y vegetales grill.',
      basePrice: '480.0000',
      taxRate: '0.1600',
      modifierGroups: [
        {
          id: 'modg-termino',
          name: 'Término de la Carne',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: 'opt-t1', name: 'Término Medio (Rosa)', extraPrice: '0.0000' },
            { id: 'opt-t2', name: 'Tres Cuartos', extraPrice: '0.0000' },
            { id: 'opt-t3', name: 'Bien Cocido', extraPrice: '0.0000' },
          ],
        },
        {
          id: 'modg-guarnicion',
          name: 'Guarnición Extra',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          options: [
            { id: 'opt-g1', name: 'Puré de papa trufado', extraPrice: '65.0000' },
            { id: 'opt-g2', name: 'Espárragos asados', extraPrice: '55.0000' },
          ],
        },
      ],
    },
    {
      id: 'prod-3',
      categoryId: 'cat-2',
      code: 'P02',
      name: 'Hamburguesa Monumental TRIDENT',
      description: 'Carne wagyu 220g, queso cheddar añejo, mermelada de tocino y brioche.',
      basePrice: '260.0000',
      taxRate: '0.1600',
      modifierGroups: [
        {
          id: 'modg-queso',
          name: 'Extras Opcionales',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          options: [
            { id: 'opt-tocino', name: 'Doble Tocino Crujiente', extraPrice: '35.0000' },
            { id: 'opt-queso', name: 'Queso Gouda Adicional', extraPrice: '25.0000' },
          ],
        },
      ],
    },
    {
      id: 'prod-4',
      categoryId: 'cat-3',
      code: 'B01',
      name: 'Cerveza Artesanal IPA 355ml',
      description: 'Notas cítricas y herbales, amargor balanceado.',
      basePrice: '95.0000',
      taxRate: '0.1600',
    },
    {
      id: 'prod-5',
      categoryId: 'cat-3',
      code: 'B02',
      name: 'Limonada Natural con Hierbabuena',
      description: 'Refrescante, endulzada al gusto.',
      basePrice: '55.0000',
      taxRate: '0.1600',
    },
    {
      id: 'prod-6',
      categoryId: 'cat-4',
      code: 'D01',
      name: 'Cheesecake Vasco Caramelizado',
      description: 'Textura cremosa fundente con reducción de frutos rojos silvestres.',
      basePrice: '135.0000',
      taxRate: '0.1600',
    },
  ];

  // Mock accounts and tables state
  const mockCuentas = new Map<string, CuentaDetalleDTO>();

  // Pre-seed cuenta-2
  mockCuentas.set('cuenta-2', {
    id: 'cuenta-2',
    folioNumber: 1042,
    mesaId: 'mesa-2',
    tableNumber: '2',
    roomName: 'Principal',
    accountType: 'COMEDOR',
    status: 'ABIERTA',
    subtotal: '550.0000',
    taxTotal: '88.0000',
    discountsTotal: '0.0000',
    tipsTotal: '0.0000',
    totalAmount: '638.0000',
    guestCount: 2,
    openedByUserId: 'usr-1',
    currentWaiterUserId: 'usr-1',
    openedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    version: 3,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        cuentaId: 'cuenta-2',
        productId: 'prod-1',
        productNameSnapshot: 'Guacamole Rústico con Totopos',
        unitPriceApplied: '120.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
        taxAmountApplied: '19.2000',
        discountAmountApplied: '0.0000',
        subtotal: '120.0000',
        total: '139.2000',
        status: 'PREPARADO',
        createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
        modifiers: [
          {
            id: 'm-1',
            modifierId: 'opt-medio',
            modifierNameSnapshot: 'Medio (Serrano picado)',
            modifierPriceApplied: '0.0000',
          },
        ],
      },
      {
        id: 'item-2',
        cuentaId: 'cuenta-2',
        productId: 'prod-2',
        productNameSnapshot: 'Rib Eye Prime 400g',
        unitPriceApplied: '480.0000',
        quantity: '1.0000',
        taxRateApplied: '0.1600',
        taxAmountApplied: '76.8000',
        discountAmountApplied: '0.0000',
        subtotal: '480.0000',
        total: '556.8000',
        status: 'EN_COCINA',
        createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        modifiers: [
          {
            id: 'm-2',
            modifierId: 'opt-t1',
            modifierNameSnapshot: 'Término Medio (Rosa)',
            modifierPriceApplied: '0.0000',
          },
        ],
      },
    ],
  });

  // Pre-seed cuenta-3 (En Cuenta)
  mockCuentas.set('cuenta-3', {
    id: 'cuenta-3',
    folioNumber: 1043,
    mesaId: 'mesa-3',
    tableNumber: '3',
    roomName: 'Principal',
    accountType: 'COMEDOR',
    status: 'IMPRESA',
    subtotal: '835.0000',
    taxTotal: '133.6000',
    discountsTotal: '0.0000',
    tipsTotal: '0.0000',
    totalAmount: '968.6000',
    guestCount: 4,
    openedByUserId: 'usr-1',
    currentWaiterUserId: 'usr-1',
    openedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    printedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    version: 4,
    updatedAt: new Date().toISOString(),
    items: [],
  });

  // Salon room structure
  let roomsState: { readonly name: string; readonly tables: readonly MesaSummaryDTO[] }[] = [
    {
      name: 'Salón Principal',
      tables: [
        {
          id: 'mesa-1',
          roomName: 'Salón Principal',
          tableNumber: '1',
          status: 'DISPONIBLE' as const,
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
        {
          id: 'mesa-2',
          roomName: 'Salón Principal',
          tableNumber: '2',
          status: 'OCUPADA' as const,
          currentAccountId: 'cuenta-2',
          assignedWaiterUserId: 'usr-1',
          guestCount: 2,
          subtotal: '550.0000',
          totalAmount: '638.0000',
          openedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
          attentionSignal: { flagged: false, reason: null, elapsedMinutes: 42 },
          version: 3,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'mesa-3',
          roomName: 'Salón Principal',
          tableNumber: '3',
          status: 'EN_CUENTA' as const,
          currentAccountId: 'cuenta-3',
          assignedWaiterUserId: 'usr-1',
          guestCount: 4,
          subtotal: '835.0000',
          totalAmount: '968.6000',
          openedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
          attentionSignal: {
            flagged: true,
            reason: 'Ticket de precuenta solicitado hace >5 min',
            elapsedMinutes: 75,
          },
          version: 4,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'mesa-4',
          roomName: 'Salón Principal',
          tableNumber: '4',
          status: 'BLOQUEADA' as const,
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
    {
      name: 'Terraza',
      tables: [
        {
          id: 'mesa-5',
          roomName: 'Terraza',
          tableNumber: '5',
          status: 'DISPONIBLE' as const,
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
        {
          id: 'mesa-6',
          roomName: 'Terraza',
          tableNumber: '6',
          status: 'DISPONIBLE' as const,
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
    {
      name: 'Barra',
      tables: [
        {
          id: 'mesa-7',
          roomName: 'Barra',
          tableNumber: 'B1',
          status: 'DISPONIBLE' as const,
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
  ];

  return {
    session: {
      async login({ userCode, pin }) {
        if (pin === '0000' || pin === '1234') {
          sessionState = {
            userId: 'usr-1',
            displayName: userCode === 'admin' ? 'Gerente Principal' : 'Carlos Mesero',
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
        const allTables = roomsState.flatMap((r) => r.tables);
        return {
          ok: true,
          data: {
            rooms: roomsState,
            totalTables: allTables.length,
            occupiedTables: allTables.filter((t) => t.status === 'OCUPADA').length,
            inCheckTables: allTables.filter((t) => t.status === 'EN_CUENTA').length,
            availableTables: allTables.filter((t) => t.status === 'DISPONIBLE').length,
            generatedAt: new Date().toISOString(),
          },
        };
      },

      async getCatalog() {
        return {
          ok: true,
          data: {
            categories: catalogCategories,
            products: catalogProducts,
          },
        };
      },

      async getCuentaDetalle(cuentaId: string) {
        const c = mockCuentas.get(cuentaId);
        if (!c) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: `Cuenta con ID ${cuentaId} no encontrada`,
              retryable: false,
            },
          };
        }
        return { ok: true, data: c, version: c.version };
      },

      async openMesa({ mesaId, guestCount, waiterUserId }) {
        const table = roomsState.flatMap((r) => r.tables).find((t) => t.id === mesaId);
        if (!table) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Mesa no encontrada', retryable: false },
          };
        }
        if (table.status !== 'DISPONIBLE') {
          return {
            ok: false,
            error: {
              code: 'CONFLICT_VERSION',
              message: 'La mesa no está disponible para apertura',
              retryable: false,
            },
          };
        }

        const newCuentaId = `cuenta-${Date.now()}`;
        const newCuenta: CuentaDetalleDTO = {
          id: newCuentaId,
          folioNumber: Math.floor(1000 + Math.random() * 9000),
          mesaId: table.id,
          tableNumber: table.tableNumber,
          roomName: table.roomName,
          accountType: 'COMEDOR',
          status: 'ABIERTA',
          subtotal: '0.0000',
          taxTotal: '0.0000',
          discountsTotal: '0.0000',
          tipsTotal: '0.0000',
          totalAmount: '0.0000',
          guestCount: guestCount > 0 ? guestCount : 1,
          openedByUserId: waiterUserId ?? sessionState?.userId ?? 'usr-1',
          currentWaiterUserId: waiterUserId ?? sessionState?.userId ?? 'usr-1',
          openedAt: new Date().toISOString(),
          version: 1,
          updatedAt: new Date().toISOString(),
          items: [],
        };

        mockCuentas.set(newCuentaId, newCuenta);

        // Update table in roomState
        roomsState = roomsState.map((room) => ({
          ...room,
          tables: room.tables.map((t) =>
            t.id === mesaId
              ? {
                  ...t,
                  status: 'OCUPADA' as const,
                  currentAccountId: newCuentaId,
                  assignedWaiterUserId: newCuenta.currentWaiterUserId ?? null,
                  guestCount: newCuenta.guestCount,
                  openedAt: newCuenta.openedAt,
                  version: t.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        }));

        return { ok: true, data: newCuenta, version: newCuenta.version };
      },

      async enviarComanda({ cuentaId, expectedVersion, items }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }
        if (cuenta.version !== expectedVersion) {
          return {
            ok: false,
            error: {
              code: 'CONFLICT_VERSION',
              message: 'La cuenta fue modificada en otra estación. Se requiere recargar.',
              retryable: true,
              conflict: {
                expectedVersion,
                serverVersion: cuenta.version,
                entityId: cuentaId,
              },
            },
          };
        }

        // Calculate additions
        let addedSubtotal = 0n;
        let addedTax = 0n;
        const newItems: CuentaItemDTO[] = items.map((it, idx) => {
          const qty = BigInt(Math.round(parseFloat(it.quantity) * 10000));
          const unitPrice = BigInt(Math.round(parseFloat(it.unitPriceApplied) * 10000));
          const taxRate = BigInt(Math.round(parseFloat(it.taxRateApplied) * 10000));

          let modTotal = 0n;
          const mappedMods: CuentaItemModificadorDTO[] = (it.modifiers ?? []).map((m, mIdx) => {
            const mPrice = BigInt(Math.round(parseFloat(m.modifierPriceApplied) * 10000));
            modTotal += mPrice;
            return {
              id: `mod-${Date.now()}-${idx}-${mIdx}`,
              modifierId: m.modifierId,
              modifierNameSnapshot: m.modifierNameSnapshot,
              modifierPriceApplied: m.modifierPriceApplied,
            };
          });

          const itemSubtotal = ((unitPrice + modTotal) * qty) / 10000n;
          const itemTax = (itemSubtotal * taxRate) / 10000n;
          const itemTotal = itemSubtotal + itemTax;

          addedSubtotal += itemSubtotal;
          addedTax += itemTax;

          return {
            id: `item-${Date.now()}-${idx}`,
            cuentaId,
            productId: it.productId,
            productNameSnapshot: it.productNameSnapshot,
            unitPriceApplied: it.unitPriceApplied,
            quantity: it.quantity,
            taxRateApplied: it.taxRateApplied,
            taxAmountApplied: (Number(itemTax) / 10000).toFixed(4),
            discountAmountApplied: '0.0000',
            subtotal: (Number(itemSubtotal) / 10000).toFixed(4),
            total: (Number(itemTotal) / 10000).toFixed(4),
            status: 'EN_COCINA' as const,
            notes: it.notes ?? null,
            createdAt: new Date().toISOString(),
            modifiers: mappedMods,
          };
        });

        const currentSubtotal = BigInt(Math.round(parseFloat(cuenta.subtotal) * 10000));
        const currentTax = BigInt(Math.round(parseFloat(cuenta.taxTotal) * 10000));

        const updatedSubtotal = currentSubtotal + addedSubtotal;
        const updatedTax = currentTax + addedTax;
        const updatedTotal = updatedSubtotal + updatedTax;

        const updatedCuenta: CuentaDetalleDTO = {
          ...cuenta,
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
          subtotal: (Number(updatedSubtotal) / 10000).toFixed(4),
          taxTotal: (Number(updatedTax) / 10000).toFixed(4),
          totalAmount: (Number(updatedTotal) / 10000).toFixed(4),
          items: [...cuenta.items, ...newItems],
        };

        mockCuentas.set(cuentaId, updatedCuenta);

        // Update table in roomState
        roomsState = roomsState.map((room) => ({
          ...room,
          tables: room.tables.map((t) =>
            t.currentAccountId === cuentaId
              ? {
                  ...t,
                  subtotal: updatedCuenta.subtotal,
                  totalAmount: updatedCuenta.totalAmount,
                  version: t.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        }));

        // Broadcast comanda creation to KDS
        const newTicketId = `kds-t-${Date.now()}`;
        const nextFolio = mockKdsTickets.length + mockCompletedKdsTickets.length + 101;
        const newKdsTicket: KdsTicketDTO = {
          id: newTicketId,
          folio: nextFolio,
          cuentaId,
          tableNumber: updatedCuenta.tableNumber
            ? `Mesa ${updatedCuenta.tableNumber}`
            : 'Mostrador',
          waiterName: sessionState?.displayName ?? 'Mesero en turno',
          kdsEstacionId: 'cocina-1',
          urgencyLevel: 'NORMAL',
          status: 'PENDIENTE',
          printStatus: 'PRINTED',
          printerId: 'prn-cocina',
          targetSeconds: 900,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items: items.map((it, idx) => ({
            id: `kds-partida-${Date.now()}-${idx}`,
            productName: it.productNameSnapshot,
            quantity: it.quantity,
            notes: it.notes ?? null,
            status: 'PENDIENTE',
            modifiers: it.modifiers?.map((m) => ({
              modifierId: m.modifierId,
              modifierNameSnapshot: m.modifierNameSnapshot,
            })),
          })),
        };
        mockKdsTickets.push(newKdsTicket);
        broadcastEvent({
          eventType: 'ComandaEnviadaACocina',
          eventContractVersion: 1,
          entityId: newTicketId,
          payload: newKdsTicket,
          timestamp: new Date().toISOString(),
        });

        return { ok: true, data: updatedCuenta, version: updatedCuenta.version };
      },

      async cancelItem({ cuentaId, itemId, expectedVersion, reason }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }
        if (cuenta.version !== expectedVersion) {
          return {
            ok: false,
            error: {
              code: 'CONFLICT_VERSION',
              message: 'La cuenta cambió de versión. Recargue antes de cancelar.',
              retryable: true,
              conflict: {
                expectedVersion,
                serverVersion: cuenta.version,
                entityId: cuentaId,
              },
            },
          };
        }

        const item = cuenta.items.find((i) => i.id === itemId);
        if (!item) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Partida no encontrada', retryable: false },
          };
        }

        // Deduct item total from subtotal and tax
        const itemSub = BigInt(Math.round(parseFloat(item.subtotal) * 10000));
        const itemTax = BigInt(Math.round(parseFloat(item.taxAmountApplied) * 10000));
        const curSub = BigInt(Math.round(parseFloat(cuenta.subtotal) * 10000));
        const curTax = BigInt(Math.round(parseFloat(cuenta.taxTotal) * 10000));

        const newSub = curSub >= itemSub ? curSub - itemSub : 0n;
        const newTax = curTax >= itemTax ? curTax - itemTax : 0n;
        const newTotal = newSub + newTax;

        const updatedCuenta: CuentaDetalleDTO = {
          ...cuenta,
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
          subtotal: (Number(newSub) / 10000).toFixed(4),
          taxTotal: (Number(newTax) / 10000).toFixed(4),
          totalAmount: (Number(newTotal) / 10000).toFixed(4),
          items: cuenta.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  status: 'CANCELADO' as const,
                  cancellationReason: reason,
                  cancelledByUserId: sessionState?.userId ?? 'usr-supervisor',
                }
              : i,
          ),
        };

        mockCuentas.set(cuentaId, updatedCuenta);

        // Update table in roomState
        roomsState = roomsState.map((room) => ({
          ...room,
          tables: room.tables.map((t) =>
            t.currentAccountId === cuentaId
              ? {
                  ...t,
                  subtotal: updatedCuenta.subtotal,
                  totalAmount: updatedCuenta.totalAmount,
                  version: t.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        }));

        return { ok: true, data: { success: true }, version: updatedCuenta.version };
      },

      async transferCuenta({ cuentaId, targetMesaId, sourceMesaId }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }

        const targetTable = roomsState.flatMap((r) => r.tables).find((t) => t.id === targetMesaId);
        if (!targetTable || targetTable.status !== 'DISPONIBLE') {
          return {
            ok: false,
            error: {
              code: 'VALIDATION',
              message: 'La mesa destino no está disponible',
              retryable: false,
            },
          };
        }

        const updatedCuenta: CuentaDetalleDTO = {
          ...cuenta,
          mesaId: targetMesaId,
          tableNumber: targetTable.tableNumber,
          roomName: targetTable.roomName,
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
        };
        mockCuentas.set(cuentaId, updatedCuenta);

        // Update source and target tables
        roomsState = roomsState.map((room) => ({
          ...room,
          tables: room.tables.map((t) => {
            if (t.id === sourceMesaId) {
              return {
                ...t,
                status: 'DISPONIBLE' as const,
                currentAccountId: null,
                assignedWaiterUserId: null,
                guestCount: 0,
                subtotal: '0.0000',
                totalAmount: '0.0000',
                openedAt: null,
                version: t.version + 1,
                updatedAt: new Date().toISOString(),
              };
            }
            if (t.id === targetMesaId) {
              return {
                ...t,
                status: 'OCUPADA' as const,
                currentAccountId: cuentaId,
                assignedWaiterUserId: cuenta.currentWaiterUserId ?? null,
                guestCount: cuenta.guestCount,
                subtotal: cuenta.subtotal,
                totalAmount: cuenta.totalAmount,
                openedAt: cuenta.openedAt,
                version: t.version + 1,
                updatedAt: new Date().toISOString(),
              };
            }
            return t;
          }),
        }));

        return { ok: true, data: { success: true }, version: updatedCuenta.version };
      },

      async splitCuenta() {
        return { ok: true, data: { success: true } };
      },

      async reassignWaiter({ cuentaId, newWaiterUserId }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }
        const updated: CuentaDetalleDTO = {
          ...cuenta,
          currentWaiterUserId: newWaiterUserId,
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
        };
        mockCuentas.set(cuentaId, updated);
        return { ok: true, data: { success: true }, version: updated.version };
      },

      async changeGuestCount({ cuentaId, guestCount }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }
        const updated: CuentaDetalleDTO = {
          ...cuenta,
          guestCount,
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
        };
        mockCuentas.set(cuentaId, updated);

        // Also update table guestCount
        roomsState = roomsState.map((r) => ({
          ...r,
          tables: r.tables.map((t) => (t.currentAccountId === cuentaId ? { ...t, guestCount } : t)),
        }));

        return { ok: true, data: { success: true }, version: updated.version };
      },

      async requestCheck({ cuentaId }) {
        const cuenta = mockCuentas.get(cuentaId);
        if (!cuenta) {
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada', retryable: false },
          };
        }
        const updated: CuentaDetalleDTO = {
          ...cuenta,
          status: 'IMPRESA',
          printedAt: new Date().toISOString(),
          version: cuenta.version + 1,
          updatedAt: new Date().toISOString(),
        };
        mockCuentas.set(cuentaId, updated);

        roomsState = roomsState.map((r) => ({
          ...r,
          tables: r.tables.map((t) =>
            t.currentAccountId === cuentaId ? { ...t, status: 'EN_CUENTA' as const } : t,
          ),
        }));

        return { ok: true, data: { success: true }, version: updated.version };
      },

      async releaseMesa({ mesaId }) {
        roomsState = roomsState.map((r) => ({
          ...r,
          tables: r.tables.map((t) =>
            t.id === mesaId
              ? {
                  ...t,
                  status: 'DISPONIBLE' as const,
                  currentAccountId: null,
                  assignedWaiterUserId: null,
                  guestCount: 0,
                  subtotal: '0.0000',
                  totalAmount: '0.0000',
                  openedAt: null,
                  version: t.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        }));
        return { ok: true, data: { success: true } };
      },
    },
    kds: {
      async getTickets(estacionId: string) {
        if (!estacionId || estacionId === 'todos') {
          return { ok: true, data: [...mockKdsTickets] };
        }
        const filtered = mockKdsTickets.filter((t) => t.kdsEstacionId === estacionId);
        return { ok: true, data: filtered };
      },
      async getEstaciones() {
        return { ok: true, data: [...mockEstaciones] };
      },
      async startPreparation(ticketId: string, estacionId: string, clientOpId: string) {
        const ticketIndex = mockKdsTickets.findIndex((t) => t.id === ticketId);
        const current = ticketIndex >= 0 ? mockKdsTickets[ticketIndex] : undefined;
        if (!current || ticketIndex === -1) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: `Ticket '${ticketId}' no encontrado`,
              retryable: false,
            },
          };
        }
        const updated: KdsTicketDTO = {
          ...current,
          status: 'EN_PREPARACION',
          updatedAt: new Date().toISOString(),
          items: current.items.map((i) => ({ ...i, status: 'EN_PREPARACION' })),
        };
        mockKdsTickets[ticketIndex] = updated;
        broadcastEvent({
          eventType: 'OrdenProduccionIniciadaEnKDS',
          eventContractVersion: 1,
          entityId: ticketId,
          payload: { ticket: updated, clientOpId },
          timestamp: new Date().toISOString(),
        });
        return { ok: true, data: { success: true } };
      },
      async bumpTicket(ticketId: string, clientOpId: string, preparationTimeMinutes?: number) {
        const ticketIndex = mockKdsTickets.findIndex((t) => t.id === ticketId);
        const ticket = ticketIndex >= 0 ? mockKdsTickets[ticketIndex] : undefined;
        if (!ticket || ticketIndex === -1) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: `Ticket '${ticketId}' no encontrado`,
              retryable: false,
            },
          };
        }
        const elapsedMs = Math.max(0, Date.now() - new Date(ticket.createdAt).getTime());
        const calculatedMins = Math.max(1, Math.round(elapsedMs / 60000));
        const prepMins = preparationTimeMinutes ?? calculatedMins;

        const completedTicket: KdsTicketDTO = {
          ...ticket,
          status: 'LISTO',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          preparationTimeMinutes: prepMins,
          items: ticket.items.map((i) => ({ ...i, status: 'LISTO' })),
        };

        mockKdsTickets.splice(ticketIndex, 1);
        mockCompletedKdsTickets.unshift(completedTicket);

        broadcastEvent({
          eventType: 'OrdenProduccionConfirmadaEnKDS',
          eventContractVersion: 1,
          entityId: ticketId,
          payload: {
            ordenProduccionId: ticketId,
            completedAt: completedTicket.completedAt,
            tiempoPreparacionMinutos: prepMins,
            ticket: completedTicket,
            clientOpId,
          },
          timestamp: new Date().toISOString(),
        });

        return { ok: true, data: { success: true } };
      },
      async recallTicket(ticketId: string, windowMinutes: number = 120) {
        const cutoffTime = Date.now() - windowMinutes * 60 * 1000;
        const found = mockCompletedKdsTickets.find((t) => {
          if (t.id !== ticketId) return false;
          if (!t.completedAt) return true;
          return new Date(t.completedAt).getTime() >= cutoffTime;
        });
        return { ok: true, data: found ?? null };
      },
      async getRecentCompletedTickets(estacionId: string, windowMinutes: number = 120) {
        const cutoffTime = Date.now() - windowMinutes * 60 * 1000;
        const filtered = mockCompletedKdsTickets.filter((t) => {
          if (estacionId && estacionId !== 'todos' && t.kdsEstacionId !== estacionId) {
            return false;
          }
          if (!t.completedAt) return true;
          return new Date(t.completedAt).getTime() >= cutoffTime;
        });
        return { ok: true, data: filtered };
      },
      async reopenTicket(ticketId: string, clientOpId: string) {
        const completedIndex = mockCompletedKdsTickets.findIndex((t) => t.id === ticketId);
        const completed = completedIndex >= 0 ? mockCompletedKdsTickets[completedIndex] : undefined;
        if (!completed || completedIndex === -1) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: `Ticket recall '${ticketId}' no encontrado`,
              retryable: false,
            },
          };
        }
        const reopened: KdsTicketDTO = {
          ...completed,
          status: 'EN_PREPARACION',
          completedAt: null,
          preparationTimeMinutes: null,
          updatedAt: new Date().toISOString(),
        };
        mockCompletedKdsTickets.splice(completedIndex, 1);
        mockKdsTickets.unshift(reopened);

        broadcastEvent({
          eventType: 'KdsTicketActualizado',
          eventContractVersion: 1,
          entityId: ticketId,
          payload: { ticket: reopened, clientOpId, action: 'REOPEN' },
          timestamp: new Date().toISOString(),
        });

        return { ok: true, data: { success: true } };
      },
      async toggleItemStatus(
        ticketId: string,
        itemId: string,
        newStatus: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO',
      ) {
        const ticketIndex = mockKdsTickets.findIndex((t) => t.id === ticketId);
        const ticket = ticketIndex >= 0 ? mockKdsTickets[ticketIndex] : undefined;
        if (!ticket || ticketIndex === -1) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: `Ticket '${ticketId}' no encontrado`,
              retryable: false,
            },
          };
        }
        const updatedItems = ticket.items.map((i) =>
          i.id === itemId ? { ...i, status: newStatus } : i,
        );
        const updated: KdsTicketDTO = {
          ...ticket,
          items: updatedItems,
          updatedAt: new Date().toISOString(),
        };
        mockKdsTickets[ticketIndex] = updated;

        broadcastEvent({
          eventType: 'KdsTicketActualizado',
          eventContractVersion: 1,
          entityId: ticketId,
          payload: { ticket: updated, itemId, newStatus },
          timestamp: new Date().toISOString(),
        });

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
