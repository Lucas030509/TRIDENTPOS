# VISUAL SYSTEM — TRIDENTPOS NATIVE POS

**Document ID:** `ARCH-UX-001`
**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW` (canonical Visual System prerequisite of `WP-026B/C/D`)
**Author role:** `06_UX_UI_Design_Architect` (design mode: High-Speed Operations)
**Date:** 2026-10-06
**Consumed by:** `FRONTEND_ARCHITECTURE.md` §10–12 (`@trident/ui` tokens, Tailwind preset)
**Binds:** `UX-COND-015-01` (visual NFR floor) and `UX-COND-015-02` (one visual language for Salón, KDS and Caja).

All contrast ratios below were computed against the WCAG 2.x relative-luminance formula; every text/background pair used for text meets AA (≥ 4.5:1) and every non-text indicator meets ≥ 3:1.

---

## 1. Principles

1. **Speed over decoration:** the most frequent action is the largest and closest; no decorative motion.
2. **State is never color alone:** every status pairs color + icon + label.
3. **One language, three densities:** Salón (touch, medium density), KDS (glanceable from 2 m, low density, dark), Caja (precision, numeric, high contrast).
4. **Money and time are typographic first-class citizens:** tabular numerals everywhere numbers align.

## 2. Color tokens

### 2.1 Light theme (POS / Caja default)

| Token                    | Value     | Use                             | Contrast on `bg` / `surface` |
| ------------------------ | --------- | ------------------------------- | ---------------------------- |
| `--color-bg`             | `#F8FAFC` | app background                  | —                            |
| `--color-surface`        | `#FFFFFF` | cards, drawers, dialogs         | —                            |
| `--color-surface-raised` | `#F1F5F9` | table headers, keypad keys      | —                            |
| `--color-border`         | `#CBD5E1` | dividers, inputs                | non-text                     |
| `--color-text`           | `#0F172A` | primary text                    | 17.1 / 17.9                  |
| `--color-text-muted`     | `#475569` | secondary text                  | 7.2 / 7.6                    |
| `--color-brand`          | `#0F5F73` | primary actions, active nav     | 6.9 / 7.2                    |
| `--color-on-brand`       | `#FFFFFF` | text on brand                   | 7.2                          |
| `--color-success`        | `#15803D` | paid, ready, available          | 4.8 / 5.0                    |
| `--color-warning`        | `#B45309` | attention, nearing SLA          | 4.8 / 5.0                    |
| `--color-danger`         | `#B91C1C` | late, error, cancel             | 6.2 / 6.5                    |
| `--color-info`           | `#1D4ED8` | informational, in progress      | 6.4 / 6.7                    |
| `--color-focus`          | `#2563EB` | focus ring (2 px + 2 px offset) | 4.9                          |

Soft tones for badges/backgrounds use the same hue at 12 % opacity over `surface`, always with the solid token for text.

### 2.2 Dark theme (KDS default, optional elsewhere)

| Token                    | Value     | Contrast on `bg` / `surface` |
| ------------------------ | --------- | ---------------------------- |
| `--color-bg`             | `#0B1220` | —                            |
| `--color-surface`        | `#141C2E` | —                            |
| `--color-surface-raised` | `#1E293B` | —                            |
| `--color-border`         | `#334155` | non-text                     |
| `--color-text`           | `#F1F5F9` | 17.1 / 15.5                  |
| `--color-text-muted`     | `#A3B1C6` | 8.6 / 7.8                    |
| `--color-brand`          | `#4FC3D9` | 9.0 / 8.2                    |
| `--color-on-brand`       | `#0B1220` | 9.0                          |
| `--color-success`        | `#4ADE80` | 10.7 / 9.8                   |
| `--color-warning`        | `#FBBF24` | 11.2 / 10.2                  |
| `--color-danger`         | `#F87171` | 6.8 / 6.2                    |
| `--color-info`           | `#93B4FF` | 9.1 / 8.3                    |
| `--color-focus`          | `#7DD3FC` | 11.2                         |

### 2.3 Semantic operational states (shared by Salón, KDS, Caja)

| Domain state                       | Token      | Icon           | Label (es-MX) |
| ---------------------------------- | ---------- | -------------- | ------------- |
| Mesa `DISPONIBLE`                  | success    | circle-check   | Disponible    |
| Mesa `OCUPADA`                     | info       | users          | Ocupada       |
| Mesa `EN_CUENTA`                   | warning    | receipt        | En cuenta     |
| Mesa `BLOQUEADA`                   | text-muted | lock           | Bloqueada     |
| KDS on time                        | info       | clock          | En tiempo     |
| KDS nearing SLA (≥ 75 % of target) | warning    | alert-triangle | Por vencer    |
| KDS late (> target)                | danger     | alarm-clock    | Atrasado      |
| KDS ready                          | success    | check          | Listo         |
| Payment pending / reconciling      | warning    | refresh        | Verificando   |
| Payment settled                    | success    | check-circle   | Pagado        |
| Error / rejected                   | danger     | x-octagon      | Rechazado     |

Projection-only states (attention signals) reuse these tokens but never introduce new authoritative status labels (`DATA-COND-015-03`).

## 3. Typography

- **Family:** `Inter` (bundled, variable, OFL), fallback `system-ui, sans-serif`. Numerals use `font-variant-numeric: tabular-nums` in tables, money, timers and keypads.

| Token        | Size / line height | Weight  | Use                                         |
| ------------ | ------------------ | ------- | ------------------------------------------- |
| `--text-xs`  | 12 / 16            | 500     | metadata only (never actionable)            |
| `--text-sm`  | 14 / 20            | 500     | secondary labels                            |
| `--text-md`  | 16 / 24            | 400–500 | body, inputs (minimum for operational text) |
| `--text-lg`  | 20 / 28            | 600     | card titles, table names                    |
| `--text-xl`  | 24 / 32            | 600     | drawer titles, amounts in lists             |
| `--text-2xl` | 32 / 40            | 700     | totals, KDS item names                      |
| `--text-3xl` | 48 / 56            | 700     | change due, KDS timers                      |

## 4. Spacing, radius, elevation

- **Spacing scale (px):** 4, 8, 12, 16, 24, 32, 48 (`--space-1` … `--space-7`). Touch targets keep ≥ 8 px gap between adjacent targets.
- **Radius:** `--radius-sm` 6, `--radius-md` 10, `--radius-lg` 16, `--radius-full` 9999.
- **Elevation:** `--shadow-1` (cards), `--shadow-2` (drawers/sheets), `--shadow-3` (dialogs). Dark theme uses border + surface step instead of heavy shadows.

## 5. Touch and sizing

| Token          | Value | Use                                            |
| -------------- | ----- | ---------------------------------------------- |
| `--target-min` | 44 px | absolute minimum (`UX-COND-015-01`)            |
| `--target-md`  | 48 px | default buttons, list rows                     |
| `--target-lg`  | 56 px | primary actions in Salón and Caja              |
| `--target-xl`  | 72 px | KDS bump buttons, payment confirm, keypad keys |

Numeric keypad: 3×4 grid of `--target-xl` keys; PIN pad masks digits and never shows the last digit after entry.

## 6. Layout and breakpoints

| Breakpoint | Size     | Layout rule                                                            |
| ---------- | -------- | ---------------------------------------------------------------------- |
| `bp-sm`    | 1024×768 | single main column + drawer overlays content; KDS 3 columns of tickets |
| `bp-md`    | 1280×800 | floor grid + side drawer (380 px); KDS 4 columns                       |
| `bp-lg`    | 1440×900 | floor grid + persistent drawer (420 px); KDS 5 columns                 |

- Shell: top status bar 48 px (station, user, connectivity, clock); no sidebar on KDS; Salón and Caja use a bottom or left action rail depending on breakpoint.
- Reflow, never horizontal scroll, at the three breakpoints.

## 7. Motion

- Durations: `--motion-fast` 120 ms, `--motion-base` 180 ms; easing `cubic-bezier(0.2, 0, 0, 1)`.
- Only for state feedback (press, drawer open, toast). KDS late tickets use a static danger border + icon, not blinking.
- `prefers-reduced-motion: reduce` → all transitions 0 ms except focus ring.

## 8. Iconography and imagery

- One open-source outline icon set (e.g. Lucide, ISC license), 24 px default, 32 px on KDS; icons always paired with text for actions.
- No product photos in operational screens (speed and memory); optional thumbnails only in catalog admin (out of scope here).

## 9. Language and formatting

- UI language es-MX; currency `MXN` formatted by `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })` from fixed-point strings; time `HH:mm` 24 h; elapsed timers `mm:ss`.
- Copy: imperative verbs on buttons ("Enviar a cocina", "Cobrar", "Cancelar producto"); errors say what happened and what to do, never internal codes.

## 10. Component inventory (visual spec owners in `@trident/ui`)

Button, IconButton, Input, NumericKeypad, PinPad, Dialog, ConfirmDialog, SupervisorPinDialog, Sheet/Drawer, Tabs, Toast, Badge/StatusChip, Card, ListRow, Table, Timer, MoneyText, StatusBar, ConnectivityIndicator, ConflictNotice, EmptyState, ErrorState, Skeleton.

Each component spec in `@trident/ui` documents: anatomy, sizes (`md`/`lg`/`xl`), intents, states (default, hover, pressed, focus, disabled, loading), and accessibility notes.

## 11. Acceptance checks for WP-026B/C/D

- All interactive targets ≥ 44×44 (audit script).
- axe-core: 0 serious/critical violations at the three breakpoints, light and dark, with reduced motion on and off.
- No raw palette classes outside `@trident/ui` (lint).
- Screenshot review at 1024×768, 1280×800, 1440×900 for each delivered screen.

## Formal status

```
DOCUMENT=VISUAL_SYSTEM.md
STATUS=PROPOSED
REQUIRED_FOR=WP-026B/C/D (APPROVED/FROZEN); consumed by WP-026A tokens
REVIEW=one round: 06_UX_UI_Design_Architect (independent instance)
```
