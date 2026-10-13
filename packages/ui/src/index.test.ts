import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUiPackageInfo,
  UI_PACKAGE_NAME,
  COLOR_TOKENS_LIGHT,
  COLOR_TOKENS_DARK,
  SPACING_TOKENS,
  TOUCH_TARGETS,
  SEMANTIC_STATES,
  calculateContrastRatio,
  meetsWcagAA,
  getButtonClassName,
  formatMoneyScale4,
  formatElapsedSeconds,
  tridentTailwindPreset,
} from './index.js';

describe('@trident/ui Component & Visual System Engine', () => {
  it('returns valid package metadata and dependencies', () => {
    const info = getUiPackageInfo();
    assert.equal(info.name, UI_PACKAGE_NAME);
    assert.equal(info.version, '0.1.0');
    assert.equal(info.coreDependency, '@trident/core');
  });

  describe('VISUAL_SYSTEM.md Design Tokens & WCAG 2.2 Mathematical Engine', () => {
    it('verifies light theme text on background meets WCAG 2.2 AA (>= 4.5:1)', () => {
      const textRatio = calculateContrastRatio(COLOR_TOKENS_LIGHT.text, COLOR_TOKENS_LIGHT.bg);
      assert.ok(textRatio >= 15.0, `Expected primary text contrast >= 15:1, got ${textRatio}`);
      assert.ok(meetsWcagAA(textRatio));

      const mutedRatio = calculateContrastRatio(
        COLOR_TOKENS_LIGHT['text-muted'],
        COLOR_TOKENS_LIGHT.bg,
      );
      assert.ok(mutedRatio >= 4.5, `Expected muted text contrast >= 4.5:1, got ${mutedRatio}`);
      assert.ok(meetsWcagAA(mutedRatio));
    });

    it('verifies dark theme text on background meets WCAG 2.2 AA (>= 4.5:1)', () => {
      const textRatio = calculateContrastRatio(COLOR_TOKENS_DARK.text, COLOR_TOKENS_DARK.bg);
      assert.ok(textRatio >= 15.0, `Expected dark text contrast >= 15:1, got ${textRatio}`);
      assert.ok(meetsWcagAA(textRatio));

      const mutedRatio = calculateContrastRatio(
        COLOR_TOKENS_DARK['text-muted'],
        COLOR_TOKENS_DARK.bg,
      );
      assert.ok(mutedRatio >= 4.5, `Expected dark muted text contrast >= 4.5:1, got ${mutedRatio}`);
      assert.ok(meetsWcagAA(mutedRatio));
    });

    it('verifies opaque soft-state token pairings strictly meet WCAG 2.2 AA (FE-R1-UX-BLK-01 remediation)', () => {
      // Light soft pairings
      const lightSuccess = calculateContrastRatio(
        COLOR_TOKENS_LIGHT['success-strong'],
        COLOR_TOKENS_LIGHT['success-soft'],
      );
      assert.ok(
        lightSuccess >= 6.0,
        `Expected light success strong/soft >= 6.0:1, got ${lightSuccess}`,
      );

      const lightWarning = calculateContrastRatio(
        COLOR_TOKENS_LIGHT['warning-strong'],
        COLOR_TOKENS_LIGHT['warning-soft'],
      );
      assert.ok(
        lightWarning >= 6.0,
        `Expected light warning strong/soft >= 6.0:1, got ${lightWarning}`,
      );

      const lightDanger = calculateContrastRatio(
        COLOR_TOKENS_LIGHT['danger-strong'],
        COLOR_TOKENS_LIGHT['danger-soft'],
      );
      assert.ok(
        lightDanger >= 6.5,
        `Expected light danger strong/soft >= 6.5:1, got ${lightDanger}`,
      );

      // Dark soft pairings
      const darkSuccess = calculateContrastRatio(
        COLOR_TOKENS_DARK['success-strong'],
        COLOR_TOKENS_DARK['success-soft'],
      );
      assert.ok(
        darkSuccess >= 9.0,
        `Expected dark success strong/soft >= 9.0:1, got ${darkSuccess}`,
      );

      const darkDanger = calculateContrastRatio(
        COLOR_TOKENS_DARK['danger-strong'],
        COLOR_TOKENS_DARK['danger-soft'],
      );
      assert.ok(darkDanger >= 9.0, `Expected dark danger strong/soft >= 9.0:1, got ${darkDanger}`);
    });

    it('verifies control boundary border tokens meet WCAG 2.2 SC 1.4.11 non-text contrast (>= 3.0:1)', () => {
      const lightBorder = calculateContrastRatio(
        COLOR_TOKENS_LIGHT['border-control'],
        COLOR_TOKENS_LIGHT.surface,
      );
      assert.ok(
        lightBorder >= 3.0,
        `Expected light border-control contrast >= 3.0:1, got ${lightBorder}`,
      );

      const darkBorder = calculateContrastRatio(
        COLOR_TOKENS_DARK['border-control'],
        COLOR_TOKENS_DARK.surface,
      );
      assert.ok(
        darkBorder >= 3.0,
        `Expected dark border-control contrast >= 3.0:1, got ${darkBorder}`,
      );
    });

    it('enforces touch target floor constraints (UX-COND-015-01)', () => {
      assert.equal(SPACING_TOKENS['space-1'], '4px');
      assert.equal(SPACING_TOKENS['space-7'], '48px');
      assert.equal(TOUCH_TARGETS['target-min'], 44);
      assert.equal(TOUCH_TARGETS['target-md'], 48);
      assert.equal(TOUCH_TARGETS['target-lg'], 56);
      assert.equal(TOUCH_TARGETS['target-xl'], 72);
      assert.ok(TOUCH_TARGETS['target-min'] >= 44);
    });

    it('validates canonical semantic states have labels and icon pairings', () => {
      const states = Object.keys(SEMANTIC_STATES);
      assert.ok(states.length >= 10);
      for (const [key, def] of Object.entries(SEMANTIC_STATES)) {
        assert.equal(def.state, key);
        assert.ok(def.label.length > 0);
        assert.ok(def.iconName.length > 0);
        assert.ok(def.bgVariable.startsWith('var(--color-'));
        assert.ok(def.textVariable.startsWith('var(--color-'));
      }
    });
  });

  describe('Primitives & Formatting Integrity', () => {
    it('verifies button class generator includes proper target dimensions and tone classes', () => {
      const primaryMd = getButtonClassName('primary', 'md', 'solid');
      assert.match(primaryMd, /min-h-\[48px\]/);
      assert.match(primaryMd, /bg-brand/);

      const dangerLg = getButtonClassName('danger', 'lg', 'solid');
      assert.match(dangerLg, /min-h-\[56px\]/);
      assert.match(dangerLg, /bg-danger/);

      const keypadXl = getButtonClassName('neutral', 'xl', 'soft');
      assert.match(keypadXl, /min-h-\[72px\]/);
      assert.match(keypadXl, /bg-surface-raised/);
    });

    it('verifies exact fixed-point MoneyText formatting with zero floating point errors (ADR-012)', () => {
      // 150.0000 -> $150.00
      assert.equal(formatMoneyScale4(1500000n), '$150.00');
      // 1,234.5678 -> Half Away From Zero rounds 78 cents -> rounds to 57 cents -> $1,234.57
      assert.equal(formatMoneyScale4(12345678n), '$1,234.57');
      // Negative amount: -50.0000 -> -$50.00
      assert.equal(formatMoneyScale4(-500000n), '-$50.00');
      // Zero amount -> $0.00
      assert.equal(formatMoneyScale4(0n), '$0.00');
      // With currency code MXN
      assert.equal(formatMoneyScale4(2500000n, true), '$250.00 MXN');
      // Exact decimal string parsing
      assert.equal(formatMoneyScale4('199.9900'), '$199.99');
    });

    it('verifies elapsed time formatting (formatElapsedSeconds)', () => {
      assert.equal(formatElapsedSeconds(0), '00:00');
      assert.equal(formatElapsedSeconds(59), '00:59');
      assert.equal(formatElapsedSeconds(125), '02:05');
      assert.equal(formatElapsedSeconds(3600), '01:00:00');
      assert.equal(formatElapsedSeconds(3665), '01:01:05');
    });

    it('verifies Tailwind preset includes tokens mapped to CSS variables', () => {
      const colors = tridentTailwindPreset.theme.extend.colors;
      assert.equal(colors.bg, 'var(--color-bg)');
      assert.equal(colors.surface, 'var(--color-surface)');
      assert.equal(colors.brand, 'var(--color-brand)');
      assert.equal(colors['success-soft'], 'var(--color-success-soft)');
      assert.equal(colors['success-strong'], 'var(--color-success-strong)');
      assert.equal(colors['border-control'], 'var(--color-border-control)');

      const spacing = tridentTailwindPreset.theme.extend.spacing;
      assert.equal(spacing['target-min'], 'var(--target-min)');
      assert.equal(spacing['target-md'], 'var(--target-md)');
      assert.equal(spacing['target-lg'], 'var(--target-lg)');
      assert.equal(spacing['target-xl'], 'var(--target-xl)');
    });
  });
});
