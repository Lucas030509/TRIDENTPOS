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

## Fixture data summary

- 20 tables across 4 zones (Salón Principal, Terraza, Barra, Privado).
- 6 open accounts (4 `ocupada`, 1 `atención`, 1 `por cobrar`), 14 `disponible`.
- 28 menu items across 5 categories (Entradas, Tacos, Platos, Bebidas,
  Postres), plus a curated 6-item Favoritos list.
- One product (`Taco Rib Eye`) wired to the modifier preview demo.

## Design language (Light Mode, V1 → V2 evolution, not a redesign)

- Cool, light neutral background; dark navy sidebar; white elevated cards;
  soft shadows and 12–20px radii instead of heavy borders.
- Single accent: teal/cyan (`#0ea5a4`), reserved for primary actions, active
  states, and the Favoritos chip.
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
handoff. Two real defects were found and fixed this way: a horizontal
scrollbar caused by a CSS `overflow-y`/`overflow-x` interaction with an
absolutely-positioned product badge, and a text-overflow collision in the
ticket line at the narrowest breakpoint. Console output was checked for
JS errors on every scene; there are none.

## Screenshots

See `screenshots_v2/` in this directory for captured evidence of all
required V2 screens and breakpoints (the original V1 set remains in
`screenshots/` for reference/comparison).
