/**
 * TRIDENTPOS Design System Tokens & WCAG 2.2 Mathematical Engine
 * Strict implementation of VISUAL_SYSTEM.md (ARCH-UX-001) & UX-COND-015-01.
 */

export const COLOR_TOKENS_LIGHT = Object.freeze({
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  'surface-raised': '#F1F5F9',
  border: '#CBD5E1',
  'border-control': '#64748B',
  text: '#0F172A',
  'text-muted': '#475569',
  brand: '#0F5F73',
  'on-brand': '#FFFFFF',
  success: '#15803D',
  warning: '#B45309',
  danger: '#B91C1C',
  info: '#1D4ED8',
  focus: '#2563EB',
  'success-soft': '#E3F0E8',
  'success-strong': '#166534',
  'warning-soft': '#F6EAE1',
  'warning-strong': '#92400E',
  'danger-soft': '#F7E4E4',
  'danger-strong': '#991B1B',
  'info-soft': '#E4EAFA',
  'info-strong': '#1E40AF',
  'brand-soft': '#E2ECEE',
  'brand-strong': '#0C4A5A',
} as const);

export const COLOR_TOKENS_DARK = Object.freeze({
  bg: '#0B1220',
  surface: '#141C2E',
  'surface-raised': '#1E293B',
  border: '#334155',
  'border-control': '#7C8BA1',
  text: '#F1F5F9',
  'text-muted': '#A3B1C6',
  brand: '#4FC3D9',
  'on-brand': '#0B1220',
  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#93B4FF',
  focus: '#7DD3FC',
  'success-soft': '#1A3338',
  'success-strong': '#86EFAC',
  'warning-soft': '#30302D',
  'warning-strong': '#FDE68A',
  'danger-soft': '#2F2636',
  'danger-strong': '#FECACA',
  'info-soft': '#232E47',
  'info-strong': '#C7D7FE',
  'brand-soft': '#1B3043',
  'brand-strong': '#A5E8F3',
} as const);

export const SPACING_TOKENS = Object.freeze({
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '24px',
  'space-6': '32px',
  'space-7': '48px',
} as const);

export const RADIUS_TOKENS = Object.freeze({
  'radius-sm': '6px',
  'radius-md': '10px',
  'radius-lg': '16px',
  'radius-full': '9999px',
} as const);

export const TOUCH_TARGETS = Object.freeze({
  'target-min': 44,
  'target-md': 48,
  'target-lg': 56,
  'target-xl': 72,
} as const);

export const BREAKPOINTS = Object.freeze({
  'bp-sm': 1024,
  'bp-md': 1280,
  'bp-lg': 1440,
} as const);

export type SemanticStateKey =
  | 'DISPONIBLE'
  | 'OCUPADA'
  | 'EN_CUENTA'
  | 'BLOQUEADA'
  | 'EN_TIEMPO'
  | 'POR_VENCER'
  | 'ATRASADO'
  | 'LISTO'
  | 'VERIFICANDO'
  | 'PAGADO'
  | 'RECHAZADO';

export interface SemanticStateDefinition {
  readonly state: SemanticStateKey;
  readonly baseIntent: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  readonly label: string;
  readonly iconName: string;
  readonly bgVariable: string;
  readonly textVariable: string;
}

export const SEMANTIC_STATES: Readonly<Record<SemanticStateKey, SemanticStateDefinition>> =
  Object.freeze({
    DISPONIBLE: {
      state: 'DISPONIBLE',
      baseIntent: 'success',
      label: 'Disponible',
      iconName: 'circle-check',
      bgVariable: 'var(--color-success-soft)',
      textVariable: 'var(--color-success-strong)',
    },
    OCUPADA: {
      state: 'OCUPADA',
      baseIntent: 'info',
      label: 'Ocupada',
      iconName: 'users',
      bgVariable: 'var(--color-info-soft)',
      textVariable: 'var(--color-info-strong)',
    },
    EN_CUENTA: {
      state: 'EN_CUENTA',
      baseIntent: 'warning',
      label: 'En cuenta',
      iconName: 'receipt',
      bgVariable: 'var(--color-warning-soft)',
      textVariable: 'var(--color-warning-strong)',
    },
    BLOQUEADA: {
      state: 'BLOQUEADA',
      baseIntent: 'neutral',
      label: 'Bloqueada',
      iconName: 'lock',
      bgVariable: 'var(--color-surface-raised)',
      textVariable: 'var(--color-text-muted)',
    },
    EN_TIEMPO: {
      state: 'EN_TIEMPO',
      baseIntent: 'info',
      label: 'En tiempo',
      iconName: 'clock',
      bgVariable: 'var(--color-info-soft)',
      textVariable: 'var(--color-info-strong)',
    },
    POR_VENCER: {
      state: 'POR_VENCER',
      baseIntent: 'warning',
      label: 'Por vencer',
      iconName: 'alert-triangle',
      bgVariable: 'var(--color-warning-soft)',
      textVariable: 'var(--color-warning-strong)',
    },
    ATRASADO: {
      state: 'ATRASADO',
      baseIntent: 'danger',
      label: 'Atrasado',
      iconName: 'alarm-clock',
      bgVariable: 'var(--color-danger-soft)',
      textVariable: 'var(--color-danger-strong)',
    },
    LISTO: {
      state: 'LISTO',
      baseIntent: 'success',
      label: 'Listo',
      iconName: 'check',
      bgVariable: 'var(--color-success-soft)',
      textVariable: 'var(--color-success-strong)',
    },
    VERIFICANDO: {
      state: 'VERIFICANDO',
      baseIntent: 'warning',
      label: 'Verificando',
      iconName: 'refresh',
      bgVariable: 'var(--color-warning-soft)',
      textVariable: 'var(--color-warning-strong)',
    },
    PAGADO: {
      state: 'PAGADO',
      baseIntent: 'success',
      label: 'Pagado',
      iconName: 'check-circle',
      bgVariable: 'var(--color-success-soft)',
      textVariable: 'var(--color-success-strong)',
    },
    RECHAZADO: {
      state: 'RECHAZADO',
      baseIntent: 'danger',
      label: 'Rechazado',
      iconName: 'x-octagon',
      bgVariable: 'var(--color-danger-soft)',
      textVariable: 'var(--color-danger-strong)',
    },
  });

/**
 * Calculates WCAG 2.x relative luminance of an sRGB hex color.
 * Formula: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function calculateRelativeLuminance(hexColor: string): number {
  const clean = hexColor.replace(/^#/, '');
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color: '${hexColor}'. Expected #RRGGBB format.`);
  }

  const r255 = parseInt(clean.slice(0, 2), 16);
  const g255 = parseInt(clean.slice(2, 4), 16);
  const b255 = parseInt(clean.slice(4, 6), 16);

  const [rs, gs, bs] = [r255 / 255, g255 / 255, b255 / 255].map((c) => {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * (rs ?? 0) + 0.7152 * (gs ?? 0) + 0.0722 * (bs ?? 0);
}

/**
 * Calculates WCAG 2.x contrast ratio between two hex colors.
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color.
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateRelativeLuminance(hex1);
  const lum2 = calculateRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Verifies WCAG 2.2 AA conformance:
 * Normal text: >= 4.5:1
 * Large text (>= 18pt / 24px or >= 14pt / 18.66px bold): >= 3.0:1
 * Non-text UI components: >= 3.0:1
 */
export function meetsWcagAA(ratio: number, isLargeTextOrNonText = false): boolean {
  return isLargeTextOrNonText ? ratio >= 3.0 : ratio >= 4.5;
}
