# TRIDENTPOS — UI Preview: Salón / Mesas / Cuenta

**Status (V4): `PREVIEW_FIXTURE_DATA` / `PREVIEW_SESSION_STATE` /
`PREVIEW_EVENT_LOG` / `PREVIEW_POLICY_STUBS` / `PREVIEW_UI_PREFERENCE` —
functional interactive prototype, not a production implementation.**

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

## What's new in V3-R1 (typography remediation only)

The Product Owner reviewed V3 and rejected its Georgia/serif "editorial"
display typography as generic/traditional. **TRIDENTPOS does not use serif
display typography.** The approved direction is Rounded Geometric Sans:
Outfit (display/headings/KPI/metrics) + DM Sans (body/UI/controls),
documented in full in
[`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`](../../../docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md).

This preview stays dependency-free and network-free: Outfit/DM Sans are
not installed and are not fetched over the network (naming a font in a
CSS stack never triggers a request — only `@font-face`/a stylesheet
`<link>` would, and neither exists here). They resolve locally to
**Avenir Next** (confirmed installed — ships with macOS), a reasonable
stand-in for the same rounded-geometric character. Production frontend
should self-host Outfit + DM Sans once Frontend Architecture governance
approves the delivery mechanism.

Alongside the font-family swap, heading/body/label font-weights were
normalized system-wide away from 700/800 toward the new type scale (mostly
500, up to 600 for small badges/buttons/counters) — see the "Typography"
section of `?scene=design-system` for a live, rendered reference. No UX,
navigation, layout, spacing, or business logic changed in this revision.

## What's new in V4 (functional Salón operations prototype)

V4 turns the Salón preview from a click-through mockup into a genuinely
interactive operations console, per the Product Owner's functional mockup
spec (`TRIDENTPOS | Mockup funcional - Gestión de Salón`, Septiembre 2026).
**Same visual system as V3/V3-R1 — this is a functional expansion, not a
redesign.** See
[`docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md`](../../../docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md)
for the full classification matrix (which features are `CANONICAL_SUPPORTED`,
`PREVIEW_ONLY`, `PROTECTED_DECISION`, `FUTURE_MODULE`, or `NOT_IMPLEMENTED`)
and the explicit statement that **OQ-SSOT-01, OQ-SSOT-02, OQ-SSOT-06, and
OQ-SSOT-07 remain exactly as open as before** — nothing here resolves them.

Highlights:

- **Full table lifecycle**: Disponible → Abrir mesa → Ocupada → Enviar a
  cocina → (Atención overlay, independently resolvable) → Solicitar cuenta
  → Por cobrar → Cobrar (tarjeta/efectivo/transferencia/dividido) →
  Cuenta cerrada → Mesa liberada → Disponible. Reservations (Reservada →
  Sentar reservación → Ocupada) are also modeled.
- **Architectural rule enforced**: a table's visual state is never stored
  directly — `computeVisualState()` projects it on every render from
  session/account/attention/reservation fields, exactly like a real
  read-model would. "Atención" is always an overlay on top of the
  underlying state, never a replacement for it.
- **KPI filters + area filters, combinable**, a floor-plan view (with a
  session-only drag-to-reposition "configuration mode"), sortable/
  filterable table grid ("solo mis mesas", "mostrar reservaciones").
- **Global search** (`Cmd/Ctrl+K`) across mesas/cuentas/pedidos/clientes,
  a real notification center (individually markable as read, never
  auto-cleared), and a branch selector (Roma Norte/Condesa/Polanco) that
  simulates a full context reload and warns before discarding an open
  operation.
- **Sensitive actions gated by a fixture permission model**
  (Gerente/Cajero/Mesero, switchable via "Cambiar turno" in the user
  menu) — discount, cancel account, and force-release all show a real
  "requires manager authorization" block when the active role lacks the
  capability.
- **Protected-decision features are UX-only by design**: Mover mesa,
  Unir mesas, and Dividir cuenta all work as real interactions but
  produce explicitly labeled `PREVIEW_TRANSFER_VALIDATION_RESULT` /
  `PREVIEW_TABLE_MERGE` / `PREVIEW_SPLIT_RESULT` outcomes — none of them
  invent the actual business rule OQ-SSOT-02/06 are waiting on.
- **Full audit trail** (`PREVIEW_EVENT_LOG`, browser-memory only) visible
  per-table or globally via "Ver historial".
- **Six sidebar destinations** (Pedidos, Cocina/KDS, Caja, Inventario,
  Clientes, Reportes, Configuración) now show a visually complete
  "Módulo pendiente de implementación" placeholder naming that module's
  real future purpose — Salón is the only fully operational module.
  "Inicio" now really navigates to the (still fixture-only) Dashboard
  concept preview from V3.
- **A small demo/alert simulator** (bolt icon in the topbar, clearly
  labeled "SIMULADOR — PREVIEW") lets the Product Owner trigger attention
  causes, a check request, a stock alert, or advance a sent order through
  Preparación/Listo/Servido — this is a manual trigger, not a real rule
  engine.

30 deterministic QA scenarios are reachable via `?qa=01` … `?qa=30`
(matching the work order's own numbered list) plus `?qa=menu` — see the
query-parameter table below.

### A note on scope

`+ Nueva mesa` was deliberately **not** added as an operator action —
per the source PDF's own recommendation, creating a physical table is a
Configuración concern; the primary path is clicking a Disponible table
directly, with `+ Abrir cuenta` as a secondary shortcut.

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
itself. **V4 replaced V2/V3's ad-hoc `?scene=table&id=...` /
`?scene=pos&table=...&demo=1` style params with a single deterministic
`?qa=NN` scenario list**, matching the functional work order's own
numbering — the old params are no longer wired up.

| Parameter | Effect |
|---|---|
| `?sidebar=collapsed` / `?sidebar=expanded` | Force the sidebar state on load |
| `?scene=dashboard` | Open the Dashboard concept-preview screen (KPI cards, quick insights, operational feed) — now also reachable via the real "Inicio" nav item |
| `?scene=design-system` | Open the Design System component-overview screen (color, radius, buttons, badges, KPI card, gauge, typography scale) |
| `?qa=01` … `?qa=30` | Deterministic functional scenarios — see table below |
| `?qa=menu` | Extra (beyond the required 30): opens the table secondary-action popover for Mesa 03, for the "Secondary menu" evidence screenshot |

### `?qa=` scenario reference

| qa | Scenario | qa | Scenario |
|---|---|---|---|
| 01 | Available table (default Salón view) | 16 | Table released (confirms §15's end state) |
| 02 | Open-table modal (Mesa 01) | 17 | Reservation panel (Mesa 02) |
| 03 | Newly occupied table (Mesa 02) | 18 | Seat reservation (Mesa 15 → Ocupada) |
| 04 | Occupied account drawer (Mesa 03) | 19 | Move-table modal (Mesa 03) |
| 05 | Add products (product selector, Mesa 05) | 20 | Split-bill modal, "Por producto" (Mesa 18) |
| 06 | Send to kitchen (Mesa 03) | 21 | Change-waiter modal (Mesa 03) |
| 07 | Attention — time threshold (Mesa 11, fixture) | 22 | Event history modal (global) |
| 08 | Attention — KDS delay (Mesa 07, triggered) | 23 | Global search, prefilled "mesa 07" |
| 09 | Resolve attention (Mesa 11) | 24 | Notification center (seeded with 2 alerts) |
| 10 | Request check (Mesa 03 → Por cobrar) | 25 | Area filter (Terraza) |
| 11 | To collect (Mesa 14, fixture) | 26 | Status KPI filter (Ocupadas) |
| 12 | Payment — card (Mesa 14) | 27 | Floor plan view |
| 13 | Payment — cash (Mesa 14) | 28 | Floor plan configuration mode |
| 14 | Split payment — card + cash (Mesa 14) | 29 | Role without permission (Mesero) + blocked discount modal (Mesa 03) |
| 15 | Close account → table released (Mesa 18, full cycle) | 30 | Insight banner |

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

**V4** added the same discipline for a much larger interaction surface: all
30 `?qa=` scenarios plus both scene helpers were rendered and checked for
console errors at both 1440×900 and 1024×768 (60 checks total, 0 errors),
and several scenarios were additionally inspected visually and via direct
DOM assertions (e.g. confirming Mesa 18 actually carries
`status-disponible` in the rendered markup after a full open → order →
pay → close → release cycle, not just "looks right" in a screenshot). Two
real bugs were found and fixed this round:

1. The table card's new "..." secondary-menu button was absolutely
   positioned into the same corner as the status badge, overlapping it —
   fixed by making it a normal flex sibling of the badge instead.
2. A systemic bug affecting every element toggled via the `hidden`
   property/attribute: several classes (`.attention-banner`,
   `.insight-banner`, `.notif-badge`, `.tables-grid`) declare their own
   `display` value, which has equal CSS specificity to the browser's
   built-in `[hidden] { display: none }` rule — and since the author rule
   comes later in the cascade, it silently won, so `hidden = true` had no
   visual effect. Caught by an actual screenshot (an attention banner
   stayed visible on a table with no attention) rather than assumed
   correct. Fixed with a single `[hidden] { display: none !important; }`
   rule.

V2's real-browser findings (horizontal scrollbar from an `overflow-y`/
`overflow-x` interaction, a ticket-line text-overflow collision) remain
fixed and were re-verified as part of this round's screenshot pass.

## Screenshots

See `screenshots_v4/` in this directory for captured evidence of the
functional Salón operations prototype (all required scenarios and both
narrower breakpoints). Earlier rounds remain for reference/comparison:
`screenshots/` (V1), `screenshots_v2/` (V2), `screenshots_v3/` (V3 visual
reskin), `screenshots_v3r1/` (V3-R1 typography remediation).
