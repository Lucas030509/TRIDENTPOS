# TRIDENTPOS — Visual Reference Spec

**Status:** Official visual system reference for TRIDENTPOS frontend modules,
established by the V3 reskin of the Salón/Mesas/Cuenta UI preview
(`design/ui-preview/pos-floor/`, branch `design/ui-preview-pos-floor-v3`).

This document governs the *visual* system only: color, typography, spacing,
radius, elevation, components, motion, and responsive/accessibility rules.
It does not define UX flows, navigation architecture, or business logic —
those remain governed by their own Work Packages and Protected Product
Owner Decisions (see `docs/architecture/` and OQ/ADR records).

---

## 1. Product visual principles

TRIDENTPOS should feel like **premium hospitality technology**: modern
restaurant operations software that is calm, fast, clean, visual, and
touch-friendly — enterprise-capable without reading as a "traditional ERP."
Concretely, that means:

- Warm, light neutrals instead of dark corporate chrome.
- Generous whitespace and a clear content hierarchy over dense screens.
- Soft, large-radius surfaces instead of hard borders and heavy shadows.
- Status communicated redundantly (color + icon + text), never by color alone.
- Motion that confirms an action happened, never motion for its own sake.

## 2. Reference interpretation

Visual inspiration: *ERP UI – POS & Restaurant Operations System*
(Behance, external reference, inspiration only — not linked or embedded
here per governance; see the V3 work order for the URL).

### What to adopt
- Overall visual language: warm neutral palette, generous spacing, soft
  large-radius cards, restrained accent color usage.
- Composition/density: fewer elements per screen, larger type for key
  numbers, breathing room around groups of information.
- Component treatment: pill buttons/chips, KPI-card and gauge patterns for
  future dashboards, photography-forward product cards.

### What NOT to copy
- Logos, brand name, proprietary imagery, illustrations, or copy text from
  the reference.
- The reference's exact layout or any full screen, pixel-for-pixel.
- Any asset extracted directly from the Behance gallery. All colors,
  imagery placeholders, and component code in this repository are
  original TRIDENTPOS work product, built from the *interpreted* visual
  language described in this document, not traced from the source.

## 3. Color system

### 3.1 Neutrals (warm, not cool gray)

| Token | Value | Role |
|---|---|---|
| `--gray-50` | `#faf8f4` | `--surface-page` — warm white page background |
| `--gray-100` | `#f3efe7` | `--surface-muted` — off-white muted surfaces |
| `--gray-200` | `#e8e2d6` | `--border-subtle` — soft gray borders |
| `--gray-300`–`--gray-600` | — | secondary text, disabled states, icons |
| `--gray-900` | `#1c1912` | Graphite / near-black — `--action-primary`, sidebar base |

### 3.2 Operational accents (used with moderation — never large fills)

| Token | Value | Meaning |
|---|---|---|
| `--status-success` | `#3e8f5c` (fresh green) | disponible, ready, positive, KPI progress |
| `--status-warning` | `#c98a12` (warm yellow) | preparing, waiting, pending |
| `--status-attention` | `#d9652f` (soft orange/coral) | attention, urgent-but-not-critical, special CTA |
| `--status-info` | `#5b6b7d` (muted slate) | neutral operational state (e.g. "ocupada") — the one status role with no direct match in the 3-hue accent set from the work order; introduced so 4 table states remain each visually distinct without stretching green/yellow/orange past their semantic meaning |

### 3.3 Color roles (semantic tokens — never hardcode raw hex in new code)

```
--surface-page, --surface-card, --surface-muted, --surface-raised
--text-primary, --text-secondary, --text-muted
--action-primary, --action-primary-hover, --action-secondary
--status-success, --status-warning, --status-attention, --status-info
--border-subtle
```

Legacy per-status aliases (`--status-disponible`, `--status-ocupada`, etc.)
are kept pointing at the semantic roles above, for backward compatibility
with the existing table/account state classes — new components should use
the semantic names directly.

## 4. Typography

**TRIDENTPOS DOES NOT USE SERIF DISPLAY TYPOGRAPHY.** V3's initial
Georgia/serif "editorial" treatment was reviewed by the Product Owner and
rejected as generic/traditional — it did not reproduce the premium
hospitality-tech character of the approved visual reference. This decision
is superseded (V3-R1).

### Approved direction: Rounded Geometric Sans

TRIDENTPOS typography should read as modern, rounded, premium, friendly,
and highly readable — rounded geometric shapes, generous counters, soft
curves, medium/light weights, strong-but-not-heavy headings, elegant
numerical metrics. Never corporate-rigid, never traditional-ERP-dense.

**Preferred typefaces** (chosen to reproduce the *character* of the
approved reference, not its exact proprietary typography — these are not
claimed to be the fonts used in the Behance source):

- **Display / headings / KPI / large numbers**: **Outfit**
- **Body / UI / controls / labels**: **DM Sans**

Georgia, Times, and serif typefaces of any kind must not appear anywhere
in the visual system.

### Font loading — preview vs. production

`--font-sans`/`--font-body` and `--font-display` remain **dependency-free,
no-network-call** in this preview, consistent with V1/V2/V3 (see the
preview's README): the page must work fully offline from `file://`, with
zero requests. Outfit and DM Sans are open-source and self-hostable, but
are **not loaded over the network here** — they are named first in each
stack as the documented target, and the browser silently falls through to
whatever is actually installed. Naming an unavailable font in a
`font-family` list never triggers a fetch; only `@font-face` or a
stylesheet `<link>` would, and neither exists in this preview.

On the machine this preview was built and validated on, that fallback
resolves to **Avenir Next** (confirmed installed — ships with macOS), which
is a reasonable stand-in for the rounded-geometric-sans character this
system targets. On a machine without Avenir Next, it falls through further
to Helvetica Neue / the OS UI sans stack — still sans-serif, never serif.

**Production frontend must self-host Outfit + DM Sans** (e.g. via a
bundled webfont, not a third-party CDN) once Frontend Architecture
governance approves the delivery mechanism. Do not copy proprietary font
files from anywhere, and do not commit unauthorized font binaries into
this repository.

```
--font-display  → Outfit, Avenir Next, Avenir, Helvetica Neue, system sans
--font-body     → DM Sans, Avenir Next, Avenir, Helvetica Neue, Arial, system sans
--font-sans     → alias of --font-body (legacy name, still referenced across the preview)
--font-metric   → alias of --font-display, used specifically for money/KPI numerals
```

Usage: `--font-display` for view `<h1>`, drawer/modal `<h2>`/`<h3>`, the
brand mark/name, table numbers ("Mesa 01"); `--font-metric` for every money
value and KPI number (table totals, drawer/ticket subtotal-IVA-total rows,
KPI card values); `--font-body` for everything else — body copy, buttons,
labels, inputs, metadata (waiter names, elapsed time, capacity, branch
name) — which stays visually subordinate at regular-to-medium weight.

### Type scale

| Role | Size | Weight |
|---|---|---|
| Display XL | 32px | 500 |
| Heading L | 28px | 500 |
| Heading M | 22px | 500 |
| Heading S | 18px | 500 |
| Body | 14px | 400 |
| Body strong | 14px | 500 |
| Small (labels, metadata, timestamps) | 12px | 400–500 |
| Metric XL (large KPI numbers) | 32–40px | 500 |
| Metric (inline money values) | 20–24px | 500 |
| Button | 14px | 500–600 |

**Do not use 700/800 as a default heading weight anywhere in this system.**
A small number of compact UI elements — status badges, small numeric
badges/counters, buttons — use up to 600 for legibility at very small
sizes; nothing in the system goes beyond 600. This is a deliberate,
system-wide reduction from V3's initial 700 defaults, not limited to the
display typeface swap.

A live, rendered reference of this scale is available at
`?scene=design-system` (dev/QA helper, not linked from the UI).

If a future module needs typography beyond this system (a new weight, a
genuinely different typeface), that requires a `DESIGN CHANGE REQUEST`
(section 23) — reviewed and approved before implementation.

## 5. Spacing

An 8px-based scale, used for all new component padding/gaps:

```
--space-1: 4px   --space-2: 8px   --space-3: 12px  --space-4: 16px
--space-5: 24px  --space-6: 32px  --space-7: 40px  --space-8: 48px
```

Existing components keep their original pixel values where changing them
would touch layout math tied to UX (e.g. grid `minmax()` widths); new
components (dashboard, design system overview) use the scale exclusively.

## 6. Radius

```
--radius-sm: 10px   small controls, inputs, tooltips
--radius-md: 16px   modifier options, secondary cards
--radius-lg: 22px   drawer panel, ticket panel
--radius-xl: 28px   table cards, product cards, KPI/panel cards, modal
```

Buttons and chips use `999px` (full pill), per section 14 of the work
order — pills are not part of the radius scale above since they are
context-driven (element height), not a fixed value.

## 7. Surfaces

- `--surface-page`: page background (warm white).
- `--surface-card` / `--surface-raised`: pure white — the *only* place we
  intentionally break from "warm neutral everywhere," to make elevated
  content (cards, drawers, modals) pop against the warm page background.
- `--surface-muted`: off-white, used for secondary fills (search bar
  container backgrounds, dividers-adjacent zones, muted badges).
- Elevation uses very soft, low-opacity shadows (`--shadow-xs` through
  `--shadow-lg`) — never a hard drop shadow. Borders are `1px` and low
  contrast (`--border-subtle`); large flat color fills are avoided.

## 8. Buttons

| Tier | Style | Example |
|---|---|---|
| Primary | Pill, `--action-primary` (graphite) fill, white text | Agregar a la cuenta, Confirmar (modifier) |
| Cobrar / high-attention primary | Pill, `--status-attention` fill | Cobrar |
| Secondary | Pill, `--surface-card` fill, `--border-subtle` outline | Cancelar, Volver, category chips |
| Tertiary / chip | Pill, transparent-to-muted, no fill until active | Zone/category chips |
| Icon | Circular (`999px`), `--surface-card` fill | Notificaciones, cerrar, avatar |
| Danger | Icon-only, red tint on hover | Ticket line remove |

All interactive controls keep a minimum `44×44px` touch target
(`--touch-target-min`), unchanged from V2.

## 9. Navigation

Sidebar remains graphite (`--navy-900`→`--navy-800` gradient) rather than
teal-navy — same structure, same collapse/expand, same tooltip behavior as
V2. The active item indicator changed from a teal background fill to a
subtle white-overlay background plus a thin `--status-success` (green)
left accent bar, so the sidebar reads as premium/graphite rather than
"dark SaaS admin," while still clearly marking the active section.

## 10. Cards

`--radius-xl` (28px), `--shadow-sm` at rest / `--shadow-md` on hover,
`1px --border-subtle` border, generous internal padding (`20px+`). Status
is indicated by a small colored dot (table cards) rather than a heavy
top-border stripe, consistent with "communicate via color + icon + text,
never color alone" (section 18) — the dot is one of three signals, next to
the status badge's icon+label.

## 11. Product imagery

For this preview, product "photography" is a CSS gradient placeholder
per category (`--status`-adjacent hues, distinct from the operational
accent palette so they don't collide with status meaning), with a large
emoji as a category glyph — **no photos were copied from any external
source**, consistent with governance section 21.

| Property | Spec |
|---|---|
| Aspect ratio | `4:3`, full card width, flush to the card's top radius |
| `object-fit` | N/A in preview (CSS gradient, not `<img>`) — a real
implementation should use `object-fit: cover` |
| Background | Category-tinted gradient (`.product-thumb.cat-*`) |
| Crop | Center-weighted; a subtle bottom gradient overlay improves text
legibility if a name/price is ever overlaid directly on the image |
| Fallback | The gradient + glyph *is* the fallback — there is no broken-image
state possible since no network image request exists |
| Loading state | N/A in preview; a real implementation should render the
same gradient placeholder as a skeleton until the real photo decodes |

## 12. Dashboard visual language

Not a functional module in this preview (out of scope per the work order),
but the pattern is established for future modules:

- **KPI Card**: label (muted, uppercase, small) → large `--font-metric`
  value → small trend line (`up`/`down`/`flat`, colored by
  success/attention/muted).
- **Quick Insight**: a small progress ring (`gaugeSvg` helper) + title +
  value, for "at a glance" operational status.
- **Operational Feed**: a chronological list of short events, each with a
  colored status dot (success/warning/info/attention), a title, a subtitle,
  and a relative timestamp.

Reachable in the preview only via `?scene=dashboard` (dev/QA helper,
undocumented in the product UI) — see section 22/29 and the preview
README's query-parameter table.

## 13. Status system

Four canonical table/account states, each communicated with **three**
redundant signals — color, icon, and text label — never color alone:

| State | Color role | Icon | Label |
|---|---|---|---|
| Disponible | success (green) | check | "Disponible" |
| Ocupada | info (slate) | clock | "Ocupada" |
| Atención | warning (amber) | alert triangle | "Atención" |
| Por cobrar | attention (coral) | receipt | "Por cobrar" |

## 14. Drawers / modals

`--radius-lg` on the account drawer (rounded only on the two left corners,
since it's edge-docked), `--radius-xl` on the fully-floating modifier
modal. Both use `--shadow-panel` / `--shadow-lg` (soft, large-blur, low
opacity) instead of a hard shadow. Order lines and modifier options gained
subtle dividers (`--surface-muted` 1px borders) instead of relying purely
on vertical gap, for cleaner scanning at high item counts (validated at
2/10/20 lines, unchanged from V2's scroll behavior).

## 15. Charts / gauges

A single reusable pattern: an SVG progress ring (`gaugeSvg(pct, color)` in
`app.js`), stroke-only, rounded line caps, colored by the semantic status
role it represents. No axes, no dense BI-style charts — every chart in
this system answers one question at a glance ("how full/complete is X").

## 16. Responsive

Unchanged breakpoints from V2: `1440×900` (primary), `1280×800`,
`1024×768`. The reskin must not degrade layout behavior at any of the
three — verified for Salón, product selector/ticket, account drawer, and
modifier modal (see the V3 handoff report for the screenshot evidence
matrix).

## 17. Touch

Minimum `44×44px` (`--touch-target-min`) preserved on every interactive
control introduced or restyled in V3 — ticket steppers, chips, buttons,
search input, modifier options.

## 18. Accessibility

Target: WCAG 2.2 AA. What was actually checked in this reskin (not
declared without evidence, per governance section 32):

- **Contrast**: primary text (`--text-primary` `#1c1912`) on
  `--surface-card`/`--surface-page` exceeds 4.5:1. Status badge text uses
  the same saturated status color on its own light tint background
  (unchanged pairing strategy from V2, already tuned for contrast).
- **Non-color status**: every status pairs color with an icon and a text
  label (section 13) — unchanged requirement, re-verified after the
  recolor.
- **Focus**: `:focus-visible` outline (`--accent-500`, 2px, 2px offset) is
  unchanged and still present on every interactive class.
- **Touch targets**: unchanged 44×44px minimum, re-verified after the
  pill-button conversion (padding recalculated to keep min-height).
- **Keyboard**: search-focus and Escape-to-close shortcuts (`/`,
  Cmd/Ctrl+K, `Escape`) are unchanged from V2 and unaffected by the reskin.
- **Reduced motion**: not yet implemented (`prefers-reduced-motion` is not
  queried anywhere in `styles.css`). This is a known gap, not a silent
  omission — flagged here for a follow-up `DESIGN CHANGE REQUEST` rather
  than declared as passing.

Given the last point, **AA is not declared as a blanket PASS** — contrast,
non-color-status, focus, and touch-target checks pass; reduced-motion
support does not exist yet.

## 19. Motion

```
--motion-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
--motion-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1)
```

Used for hover/press feedback, the sidebar collapse transition, and
drawer/modal transitions (which keep their original, slightly longer,
cubic-bezier timings tuned for a physical "slide in" feel). No animation
in the system runs longer than the drawer/modal open transitions
(~240ms) — nothing is decorative-only.

## 20. Component inventory

| Component | Where |
|---|---|
| App Shell | `.app`, `.main` |
| Sidebar | `.sidebar`, `.nav-item`, `.sidebar-toggle` |
| Header | `.topbar`, `.status-pill`, `.profile-chip` |
| Pill Navigation | `.chip`, `.chip-favorite`, `.zone-tabs`, `.category-tabs` |
| KPI Card | `.kpi-card` (dashboard concept preview) |
| Insight Card | `.insight-row` + `gaugeSvg()` (dashboard concept preview) |
| Table Card | `.table-card` |
| Product Card | `.product-card`, `.product-thumb`, `.product-card-body` |
| Ticket Line | `.ticket-line` |
| Drawer | `.account-panel` |
| Modal | `.modifier-modal` |
| Search | `.pos-search`, `.pos-search-input` |
| Button | `.btn-primary`, `.btn-secondary`, `.btn-action`, `.btn-back` |
| Icon Button | `.icon-btn` |
| Badge | `.notif-badge`, `.product-card-qty-badge` |
| Status Pill | `.status-badge`, `.status-pill` |
| Gauge | `gaugeSvg()` (dashboard concept preview / design system overview) |
| Progress Bar | `.progress-bar-track` / `.progress-bar-fill` (design system overview) |
| Activity Feed Item | `.feed-item` (dashboard concept preview) |

A live, rendered reference of most of the above (color, radius, buttons,
badges, KPI card, gauge, feed item) is available in the preview itself via
`?scene=design-system` (dev/QA helper, not linked from the UI).

## 21. Future frontend rules — FRONTEND VISUAL GOVERNANCE

From this version onward, every new TRIDENTPOS frontend module **must**:

1. Read this document (`TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`) before
   starting visual work.
2. Reuse the existing design tokens (color, radius, spacing, motion,
   typography) — do not invent parallel token names for the same concept.
3. Reuse existing component patterns (buttons, chips, cards, badges,
   drawers, modals) rather than building visually incompatible one-offs.
4. Never introduce a new visual language alongside this one.
5. Never hardcode a raw color value where a semantic token already exists
   for that role.
6. Respect the UX already approved for that module — this document governs
   visuals only, never navigation, flows, or business logic.
7. Maintain the responsive, touch-target, and accessibility rules in
   sections 16–18.

If a module genuinely needs to deviate from this system (a new token, a
new component family, a different type treatment), that requires a
**`DESIGN CHANGE REQUEST`** — a short written proposal describing the
deviation and its rationale — reviewed and approved *before*
implementation, not after.
