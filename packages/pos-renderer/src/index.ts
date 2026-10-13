/**
 * @trident/pos-renderer
 * React 19 Native POS App Shell, Typed Bridge, Routing & Feature Modules
 * Authoritative implementation per FRONTEND_ARCHITECTURE.md (ARCH-FE-001) & WP-026A/B
 */

export const POS_RENDERER_PACKAGE_NAME = '@trident/pos-renderer';
export const POS_RENDERER_PACKAGE_VERSION = '0.1.0';

export interface PosRendererPackageInfo {
  readonly name: string;
  readonly version: string;
  readonly coreDependency: string;
  readonly uiDependency: string;
}

export function getPosRendererPackageInfo(): PosRendererPackageInfo {
  return {
    name: POS_RENDERER_PACKAGE_NAME,
    version: POS_RENDERER_PACKAGE_VERSION,
    coreDependency: '@trident/core',
    uiDependency: '@trident/ui',
  };
}

// IPC Bridge & Contracts
export * from './bridge/trident-bridge.js';

// Contexts & Providers
export * from './context/SessionContext.js';
export * from './context/StationContext.js';

// Data Layer & Hooks
export * from './data/event-invalidator.js';
export * from './data/use-conflict-aware-mutation.js';

// App Shell & Guards
export * from './shell/AppShell.js';
export * from './shell/RequireSession.js';
export * from './shell/StationGuard.js';
export * from './shell/ErrorBoundary.js';

// Feature Routes
export * from './routes/LoginRoute.js';
export * from './routes/SalonRoute.js';
export * from './routes/KdsRoute.js';
export * from './routes/CajaRoute.js';
export * from './routes/DiagnosticsRoute.js';

// Feature: Salón & Comandero (WP-026B)
export * from './features/salon/TableCard.js';
export * from './features/salon/OpenTableDialog.js';
export * from './features/salon/ModifierSelectorDialog.js';
export * from './features/salon/CancelItemDialog.js';
export * from './features/salon/TransferTableDialog.js';
export * from './features/salon/ChangeGuestsDialog.js';
export * from './features/salon/SplitAccountDialog.js';
export * from './features/salon/ComanderoView.js';

// Root Router
export * from './router.js';
