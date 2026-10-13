/**
 * TRIDENTPOS Tailwind CSS Preset (FRONTEND_ARCHITECTURE.md Sec 11)
 * Maps design tokens from VISUAL_SYSTEM.md to Tailwind utility classes.
 */

export const tridentTailwindPreset = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        border: 'var(--color-border)',
        'border-control': 'var(--color-border-control)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        brand: 'var(--color-brand)',
        'on-brand': 'var(--color-on-brand)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        info: 'var(--color-info)',
        focus: 'var(--color-focus)',
        'success-soft': 'var(--color-success-soft)',
        'success-strong': 'var(--color-success-strong)',
        'warning-soft': 'var(--color-warning-soft)',
        'warning-strong': 'var(--color-warning-strong)',
        'danger-soft': 'var(--color-danger-soft)',
        'danger-strong': 'var(--color-danger-strong)',
        'info-soft': 'var(--color-info-soft)',
        'info-strong': 'var(--color-info-strong)',
        'brand-soft': 'var(--color-brand-soft)',
        'brand-strong': 'var(--color-brand-strong)',
      },
      fontSize: {
        xs: ['var(--text-xs-size)', { lineHeight: 'var(--text-xs-lh)' }],
        sm: ['var(--text-sm-size)', { lineHeight: 'var(--text-sm-lh)' }],
        md: ['var(--text-md-size)', { lineHeight: 'var(--text-md-lh)' }],
        lg: ['var(--text-lg-size)', { lineHeight: 'var(--text-lg-lh)' }],
        xl: ['var(--text-xl-size)', { lineHeight: 'var(--text-xl-lh)' }],
        '2xl': ['var(--text-2xl-size)', { lineHeight: 'var(--text-2xl-lh)' }],
        '3xl': ['var(--text-3xl-size)', { lineHeight: 'var(--text-3xl-lh)' }],
      },
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
        'space-7': 'var(--space-7)',
        'target-min': 'var(--target-min)',
        'target-md': 'var(--target-md)',
        'target-lg': 'var(--target-lg)',
        'target-xl': 'var(--target-xl)',
      },
      minHeight: {
        'target-min': 'var(--target-min)',
        'target-md': 'var(--target-md)',
        'target-lg': 'var(--target-lg)',
        'target-xl': 'var(--target-xl)',
      },
      minWidth: {
        'target-min': 'var(--target-min)',
        'target-md': 'var(--target-md)',
        'target-lg': 'var(--target-lg)',
        'target-xl': 'var(--target-xl)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
      },
      screens: {
        'bp-sm': '1024px',
        'bp-md': '1280px',
        'bp-lg': '1440px',
      },
    },
  },
};

export default tridentTailwindPreset;
