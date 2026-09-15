# TRIDENTPOS — UI Preview 01: Salón / Mesas / Cuenta

**Status: `PREVIEW_FIXTURE_DATA` — visual/UX prototype only.**

This is a static, dependency-free, high-fidelity interactive preview of the
TRIDENTPOS "Salón" (dining room) module: table grid, table/account side panel,
and product selector. It exists so the Product Owner can see, click through,
and validate the direction of the UI **before** any of it becomes a governed
Work Package.

## What this is

- Plain HTML + CSS + vanilla JavaScript. No build step, no framework, no npm
  dependencies added to the monorepo.
- All data (tables, zones, waiters, open accounts, order lines, menu, prices)
  is fixture data defined in `app.js`, held only in browser memory. Nothing
  is persisted, and there is no network call anywhere in this preview.
- All money values shown are 2-decimal display formatting for mockup
  purposes only. This is **not** TRIDENTPOS's authoritative financial engine
  (see ADR-012 — exact fixed-point Money in `bigint` scale-4, `roundDiv`
  half-away-from-zero). Do not treat the IVA/Total math here as a spec.

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

## What you can click

- **Zone tabs** (`Todos | Salón | Terraza | Barra | Privado`) filter the
  table grid.
- **Any table card** opens the account side panel on the right without
  navigating away from the floor — occupied tables show their full cuenta
  (partidas, modifiers, subtotal/IVA/total); available tables show a light
  "Abrir mesa" state.
- **Agregar productos** switches the main workspace into the product
  selector (categories + product grid + live ticket with quantity steppers).
  **Volver** or **Agregar a la cuenta** both return you to the Salón, the
  latter after merging the ticket into that table's cuenta in memory.
- **Enviar a cocina / Mover mesa / Dividir cuenta / Imprimir / Cobrar** are
  intentionally inert beyond a toast notification — these are the protected,
  governed behaviors (transfer, split, cancellation, proration) that must
  not be implemented ahead of an actual Work Package and Product Owner
  decision.
- Sidebar items other than **Salón** show a "module under construction"
  toast — they're placeholders for future modules, not implemented here.

## Fixture data summary

- 20 tables across 4 zones (Salón Principal, Terraza, Barra, Privado).
- 6 open accounts (4 `ocupada`, 1 `atención`, 1 `por cobrar`), 14 `disponible`.
- 28 menu items across 5 categories (Entradas, Tacos, Platos, Bebidas,
  Postres).

## Design language (v1, Light Mode)

- Cool, light neutral background; dark navy sidebar; white elevated cards;
  soft shadows and 12–20px radii instead of heavy borders.
- Single accent: teal/cyan (`#0ea5a4`), reserved for primary actions and
  active states.
- Table/account status is communicated with **both** color and a text
  label + icon (`Disponible` / `Ocupada` / `Atención` / `Por cobrar`) — never
  color alone.
- Touch targets: all primary buttons and table cards meet or exceed 44×44px.
- Verified responsive at 1440×900 (primary), 1280×800, and 1024×768 — the
  sidebar collapses to icon-only and the account/ticket panels narrow at
  the lower breakpoints.
- Dark Mode is intentionally out of scope for this first pass.

## Screenshots

See `screenshots/` in this directory for captured evidence of the five
required screens at 1440×900, taken from a real headless-Chrome render of
this exact preview.
