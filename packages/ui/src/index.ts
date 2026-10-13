/**
 * @trident/ui
 * Design System, Accessible Primitives & Shared POS Shell Components
 * Authoritative implementation per VISUAL_SYSTEM.md (ARCH-UX-001) & FRONTEND_ARCHITECTURE.md (ARCH-FE-001)
 */

export const UI_PACKAGE_NAME = '@trident/ui';
export const UI_PACKAGE_VERSION = '0.1.0';

export interface UiPackageInfo {
  readonly name: string;
  readonly version: string;
  readonly coreDependency: string;
}

export function getUiPackageInfo(): UiPackageInfo {
  return {
    name: UI_PACKAGE_NAME,
    version: UI_PACKAGE_VERSION,
    coreDependency: '@trident/core',
  };
}

// Tokens & Visual System Models
export * from './tokens/tokens.js';
export * from './tailwind-preset.js';

// Primitives
export * from './primitives/button.js';
export * from './primitives/icon-button.js';
export * from './primitives/input.js';
export * from './primitives/numeric-keypad.js';
export * from './primitives/pin-pad.js';
export * from './primitives/badge.js';
export * from './primitives/money-text.js';
export * from './primitives/timer.js';
export * from './primitives/dialog.js';
export * from './primitives/drawer.js';
export * from './primitives/tabs.js';
export * from './primitives/skeleton.js';

// Composite Domain-Agnostic Components
export * from './components/connectivity-indicator.js';
export * from './components/status-bar.js';
export * from './components/supervisor-pin-dialog.js';
export * from './components/conflict-notice.js';
export * from './components/empty-state.js';
export * from './components/error-state.js';
