# TRIDENTPOS — UI Preview: Salón / Mesas / Cuenta

**Status: `PREVIEW_FIXTURE_DATA` / `PREVIEW_UI_PREFERENCE` — visual/UX prototype only.**

This is a static, dependency-free, high-fidelity interactive preview of the
TRIDENTPOS "Salón" (dining room) module: collapsible navigation shell, table
grid, table/account drawer, and a POS-grade product selector with search,
favorites, and a modifier demo. It exists so the Product Owner can see,
click through, and validate the direction of the UI **before** any of it
becomes a governed Work Package.

**V2** evolves the Product-Owner-approved V1 direction (same navigation
pattern, same visual language) — it is not a redesign. V1's approval covered
the overall shell → sidebar → table → drawer → product-selector flow; V2
keeps that pattern and refines the sidebar (collapsible) and the product
selector (search, favorites, modifier preview, larger touch targets).

**V3** is a **visual reskin only** of the V2 UX/navigation/flows/states —
same interaction model, entirely new visual system (warm hospitality
palette, graphite action color, soft large-radius surfaces, photography-
forward product cards). The visual system is now documented as the
project's official reference at
[`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`](../../../docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md).

## What this is

- Plain HTML + CSS + vanilla JavaScript. No build step, no framework, no npm
  dependencies added to the monorepo.
- All data (tables, zones, waiters, open accounts, order lines, menu, prices,
  modifier options) is fixture data defined in `app.js`, held only in
  browser memory. Nothing is persisted to a server, and there is no network
  call anywhere in this preview.
- The **only** thing this preview writes to `localStorage` is one key,
  `tridentpos_preview_sidebar_v1`, storing whether the sidebar is
  expanded/collapsed. This is a cosmetic `PREVIEW_UI_PREFERENCE` for this
  demo only — it is not a real user preference, not synced anywhere, and
  unrelated to any canonical TRIDENTPOS settings system.
- All money values shown are 2-decimal display formatting for mockup
  purposes only. This is **not** TRIDENTPOS's authoritative financial engine
  (see ADR-012 — exact fixed-point Money in `bigint` scale-4, `roundDiv`
  half-away-from-zero). Do not treat the IVA/Total math here as a spec.
- The modifier selector (see below) is a **UX demonstration only**. It does
  not define canonical modifier rules and does not resolve `OQ-SSOT-07`
  (ModifierRecipeResolver) or any other Protected Product Owner Decision.

## What this is NOT

- Not a change to any backend, API, database, or migration.
- Not a change to Platform Core, POS domain, Inventory, Billing, or Finance.
- Not an implementation of WP-014 (Dining Room, Tables & Orders Domain
  Engine with OCC) — WP-014's real aggregates, OCC/`expectedVersion`, and
  canonical APIs (`POST /cuentas`, `POST /ordenes/partidas`,
  `PUT /cuentas/:id/cerrar`) are untouched and unreferenced here.
- Not a resolution of any pending Protected Product Owner Decision.
- Not a replacement for `packages/edge/src/index.html` or
  `packages/edge/src/renderer.ts` (the Edge Runtime isolation proof) — this
  preview lives entirely outside `packages/`.

## How to view it

Because the page uses only relative `<link>`/`<script>` tags (no `fetch`,
no modules), most browsers can open it directly from disk:

```bash
open design/ui-preview/pos-floor/index.html
```

If your browser blocks local file access for any reason, serve it with
Python's built-in server instead:

```bash
cd design/ui-preview/pos-floor
python3 -m http.server 8080
# then open http://localhost:8080 in a browser
```

## Navigation pattern (unchanged from V1, do not modify)

```text
App Shell → Sidebar → Workspace (Salón) → Mesa → Cuenta drawer
  → Agregar productos → POS workspace → back to previous context
```

The account drawer and product selector are never separate pages — they
stay within the same app shell, preserving the floor's visual context
underneath (dimmed backdrop), per the approved V1 direction.

## What's new in V2

### Collapsible sidebar
- Toggle control at the bottom of the sidebar ("Colapsar" / "Expandir",
  with a chevron that flips) — a natural part of the shell, not a floating
  button.
- Expanded ≈ `220px` (icon + label). Collapsed ≈ `72px` (icon only, plus the
  compact logo mark).
- Collapsed sidebar items show a custom tooltip on hover/focus with the
  module name, so icons are never left unexplained.
- Default state: expanded on load at widths `> 1280px`; collapsed by
  default at `≤ 1280px` (including 1024px). The user can always override
  this manually, and that choice is remembered for the session via
  `PREVIEW_UI_PREFERENCE` in `localStorage`.
- Width/label transitions run at ~200ms — fast, not decorative.

### Salón refinements
- Table cards gain a visible **selected** state (accent ring + border +
  subtle shadow) whenever their account drawer is open, in addition to the
  dimmed backdrop.
- Elapsed time gets a second, still-subtle hierarchy tier: ≥ 45 min is
  amber (as in V1); ≥ 60 min is a slightly bolder/darker amber
  ("time-critical") — never a loud alarm treatment.
- The grid naturally reflows to use the freed width when the sidebar is
  collapsed (CSS `auto-fill` grid, no separate collapsed-specific layout
  needed).

### Account drawer
- The "Partidas" heading now shows a live count (e.g. "Partidas (20
  partidas)").
- Verified with 2, 10, and 20-line accounts (see Screenshots): only the
  itemized partidas list scrolls; the metadata header, financial summary,
  and full action row (including the "Agregar productos" CTA and "Cobrar")
  stay fixed and visible regardless of order size.

### Product selector — the main V2 investment
- **Search** (`Buscar producto...`) filters the fixture menu in real time
  by product name or category name, across all categories at once.
- **Favoritos** is a first-class category chip (curated fixture list of 6
  commonly-ordered items) shown by default when entering the selector, so
  the fastest path to a common order is one tap away.
- Category chips are larger and more touch-friendly than V1.
- Product cards show immediate feedback on tap: a brief scale pulse, a
  floating "+1", and a persistent small badge reflecting how many of that
  item are currently in the ticket.
- **Modifier preview** (UX demo only, `Taco Rib Eye`): tapping it opens a
  small modal with a "Término" radio group, "Extras" checkboxes, and a
  "Quitar" checkbox, matching the shape described in the brief. Confirming
  adds a distinctly-labeled ticket line (e.g. "Medio, Aguacate"); adding the
  same product with different modifier choices creates separate ticket
  lines instead of merging quantities, the way a real POS ticket would.
- Ticket quantity steppers are now full touch-target size
  (`--touch-target-min`, 44×44px), and the "Agregar a la cuenta" CTA stays
  full-width and visible even with many distinct ticket lines (independent
  scroll on the item list only).
- Keyboard: `/` or `Cmd/Ctrl+K` focuses the search input while in the
  product selector; `Escape` closes the modifier modal if open, otherwise
  closes the account drawer if open. Preview-only, desktop convenience.

### Design tokens
Consolidated in `styles.css` `:root` for a future formal Design System:
`--sidebar-expanded-width`, `--sidebar-collapsed-width`, `--header-height`,
`--drawer-width`, `--ticket-width`, `--touch-target-min`, plus semantic
aliases `--accent`, `--surface`, `--border`.

## What's new in V3 (visual reskin only)

Same UX, same navigation, same flows, same states, same interaction model
as V2 — this section is exclusively about the visual system.

- **Palette**: moved from the V2 dark-navy/teal SaaS look to a warm
  hospitality palette — warm white/off-white page and muted surfaces,
  graphite/near-black as the primary action color, with fresh green, warm
  yellow, and soft coral reserved for operational status only.
- **Sidebar**: still collapsible with the same preference persistence and
  tooltip behavior as V2, now graphite instead of navy, with a thin green
  accent bar (instead of a teal fill) marking the active item.
- **Typography**: view titles, drawer/modal headings, table numbers, and
  money/KPI values use a serif display face (`--font-display`, from the
  system stack — no font was loaded over the network, preserving the
  dependency-free/no-network-call guarantee from V1/V2); everything else
  stays on the system sans stack.
- **Cards/buttons**: table and product cards moved to a larger, softer
  radius (`--radius-xl`, 28px) with much lighter shadows; all buttons and
  chips are now full pills; primary actions (Agregar a la cuenta,
  Confirmar) use the graphite action color, with Cobrar kept as a coral
  high-attention primary.
- **Product cards**: reworked to be photography-forward — a full-width
  category-tinted image area on top (fixture-only gradient + glyph, no
  photos copied from any external source), name, a new one-line optional
  description, and price below.
- **Status color mapping**: disponible→success (green), ocupada→info
  (muted slate — there's no 4th hue in the green/yellow/coral accent set,
  so a neutral "info" role was introduced), atención→warning (amber),
  por cobrar→attention (coral). Still communicated via color **and** icon
  **and** text label, unchanged from V2.
- **Two new dev-only preview scenes** (not linked from the UI, same
  pattern as the existing QA query parameters): `?scene=dashboard` (a
  fixture-only KPI/operational-feed/gauge concept preview, illustrating a
  *future* dashboard visual language — not a functional module) and
  `?scene=design-system` (a live reference of the color/radius/button/
  KPI/gauge tokens and components documented in
  `TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`).

Three real layout bugs were found and fixed during this round's real-Chrome
validation, all the same underlying class of issue: Chrome's CSS Grid
row auto-sizing under-measuring a flex-column grid item with variable
content, confirmed by measuring actual rendered rects (not assumed) before
fixing:
1. Occupied-table cards' total/attention-flag block spilling into the row
   below on the Salón grid (`.table-card` moved from `min-height` to a
   deterministic fixed `height`).
2. Product cards silently losing their name/description/price entirely at
   1024px width, clipped by the card's own `overflow: hidden` (same fix
   pattern applied to `.product-card` and `.product-thumb`).
3. Long-ticket product names truncating to a single letter at the
   `--ticket-width: 300px` breakpoint because two 44×44px touch targets
   plus the subtotal left almost no room on one row — fixed with a
   responsive two-row grid for `.ticket-line` at ≤1100px, without shrinking
   any touch target below 44×44px.

## What you can click

- **Zone tabs** (`Todos | Salón | Terraza | Barra | Privado`) filter the
  table grid.
- **Sidebar collapse toggle** expands/collapses the navigation; the choice
  persists for your session.
- **Any table card** opens the account drawer without navigating away from
  the floor.
- **Agregar productos** switches the workspace into the product selector.
  **Volver** or **Agregar a la cuenta** both return you to the Salón.
- **Search**, **category chips (including Favoritos)**, and **product
  cards** work as described above. Tapping `Taco Rib Eye` opens the
  modifier demo instead of adding it directly.
- **Enviar a cocina / Mover mesa / Dividir cuenta / Imprimir / Cobrar** are
  intentionally inert beyond a toast notification — these are the
  protected, governed behaviors that must not be implemented ahead of an
  actual Work Package and Product Owner decision.
- Sidebar items other than **Salón** show a "module under construction"
  toast.

## Screenshot / QA helper query parameters (not part of the product UX)

These exist purely so evidence-capture tooling (or you) can jump straight
to a specific state without manual clicking; none are linked from the UI
itself:

| Parameter | Effect |
|---|---|
| `?sidebar=collapsed` / `?sidebar=expanded` | Force the sidebar state on load |
| `?scene=table&id=mesa-3` | Open the account drawer for a given table id |
| `?scene=table&id=mesa-18&stress=20` | Same, and pad the account to N line items (stress-tests drawer scroll) |
| `?scene=pos&table=mesa-5` | Enter the product selector for a given table |
| `?scene=pos&table=mesa-5&demo=1` | ...with 4 sample items pre-added to the ticket |
| `?scene=pos&table=mesa-5&demoLong=1` | ...with 9 distinct items pre-added (long-ticket scroll test) |
| `?scene=pos&table=mesa-5&modifier=1` | ...with the Taco Rib Eye modifier modal pre-opened |
| `?scene=pos&table=mesa-5&search=taco` | ...with the search box pre-filled and applied |
| `?qaTooltip=disabled` | Force one collapsed-sidebar tooltip visible (headless screenshots can't simulate `:hover`) |
| `?scene=dashboard` | (V3) Open the Dashboard concept-preview screen (KPI cards, quick insights, operational feed) |
| `?scene=design-system` | (V3) Open the Design System component-overview screen (color, radius, buttons, badges, KPI card, gauge) |

## Fixture data summary

- 20 tables across 4 zones (Salón Principal, Terraza, Barra, Privado).
- 6 open accounts (4 `ocupada`, 1 `atención`, 1 `por cobrar`), 14 `disponible`.
- 28 menu items across 5 categories (Entradas, Tacos, Platos, Bebidas,
  Postres), plus a curated 6-item Favoritos list.
- One product (`Taco Rib Eye`) wired to the modifier preview demo.

## Design language (Light Mode — V3 visual reskin, see spec doc for full detail)

- Warm white/off-white neutral background; graphite (near-black) sidebar;
  white elevated cards; very soft shadows and 16–28px radii instead of
  heavy borders — see
  [`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`](../../../docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md)
  for the full token set and rationale.
- Graphite as the primary action color; fresh green, warm yellow, and soft
  coral reserved for operational status, used with moderation.
- Table/account status is communicated with **both** color and a text
  label + icon — never color alone.
- Touch targets: all primary buttons, table cards, and ticket steppers meet
  or exceed 44×44px.
- Verified responsive at 1440×900 (primary), 1280×800, and 1024×768 for
  both the Salón grid and the product-selector/ticket workspace.
- Dark Mode remains intentionally out of scope.

## Real-browser validation

Every screen listed above, at all three breakpoints, was rendered with a
real headless Chrome (not just written and assumed correct) before this
handoff. See "What's new in V3" above for the three real layout bugs found
and fixed this round (all a Chrome CSS Grid row auto-sizing quirk with
flex-column grid items of variable content height, confirmed by measuring
actual rendered element rects before fixing, not assumed). Console output
was checked for JS errors on every scene, including the two new dev-only
V3 scenes; there are none.

V2's real-browser findings (horizontal scrollbar from an `overflow-y`/
`overflow-x` interaction, a ticket-line text-overflow collision) remain
fixed and were re-verified as part of this round's screenshot pass.

## Screenshots

See `screenshots_v3/` in this directory for captured evidence of all
required V3 screens and breakpoints (the V1 and V2 sets remain in
`screenshots/` and `screenshots_v2/` for reference/comparison).
