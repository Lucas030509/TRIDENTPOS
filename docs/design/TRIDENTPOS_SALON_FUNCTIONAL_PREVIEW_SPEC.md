# TRIDENTPOS — Salón Functional Preview Spec (V4)

**Source:** Product Owner Salón Functional Mockup — *TRIDENTPOS | Mockup
funcional - Gestión de Salón*, Septiembre 2026 (PDF supplied by the
Product Owner).

**Scope of this document:** classifies every function requested in that
PDF (and in the V4 work order built on top of it) against the actual
state of canonical TRIDENTPOS architecture, so the V4 preview
(`design/ui-preview/pos-floor/`) never silently invents business rules or
contradicts approved decisions.

**This preview is not a production implementation.** It runs entirely on
`PREVIEW_FIXTURE_DATA` / `PREVIEW_SESSION_STATE` / `PREVIEW_EVENT_LOG` /
`PREVIEW_POLICY_STUBS` in browser memory. Nothing here should be read as
resolving open architecture questions.

---

## 1. Pre-flight findings (what canonical architecture actually says)

Read before writing any code, per governance:

- **`OPEN_QUESTIONS.md`** (`ARCH-OQ-001 v1.3`, status `APPROVED / FROZEN`,
  2026-09-01): confirms **OQ-SSOT-01** (cancellation policy post-kitchen),
  **OQ-SSOT-02** (transfer/move validation + PIN), **OQ-SSOT-06** (split
  proration of discounts/tips), and **OQ-SSOT-07** (modifier recipe
  consolidation) are all still `OPEN / PENDIENTE DE DEFINICIÓN`. None are
  closed by this preview.
- **`PRODUCT_DECISIONS.md`** (`ARCH-DEC-001 v1.3`, `APPROVED / FROZEN`):
  `DEC-006` — a sale Folio is assigned **only** when the precuenta is
  printed (not at table-open or order-capture time). `DEC-004` — inventory
  consumption is triggered by `OrdenProduccionConfirmadaEnKDS`, not by
  "sending to kitchen" alone. Neither is re-implemented here; both are
  referenced as PREVIEW-only flavor text where relevant.
- **`MODULE_CATALOG.md`**: `TRIDENTPOS` owns `AreaVenta`, `Mesa`, `Cuenta`,
  `ProductoEnCuenta`, `OrdenProduccion`, `TurnoCaja`, `PagoCuenta`,
  `CorteX`/`CorteZ`. Commands: `AbrirMesa()`, `CapturarComanda()`,
  `EnviarCocina()`, `ConfirmarKdsOrden()`, `ImprimirPrecuenta()`,
  `PagarCuenta()`, `DividirCuenta()`.
- **Actual WP-014 implementation** (`packages/pos/src/dining-service.ts`,
  `packages/pos-edge-runtime/src/dining-sqlite-repository.ts`) implements
  a **narrower** canonical state machine than the PDF's operational
  vocabulary:
  - `Mesa.status`: `DISPONIBLE` | `OCUPADA` (that's it — no canonical
    `EN_ATENCION`, `POR_COBRAR`, or `RESERVADA` table status exists yet).
  - `Cuenta.status`: `ABIERTA` | `IMPRESA` | a closed status (paid/closed).
  - `CuentaItem.status`: `ORDENADO` | `CANCELADO`.
  - No canonical `TurnoCaja`/`PagoCuenta`/`CorteX`/`CorteZ` UI exists in
    this repository yet (Caja/cobro is cataloged but not built).

**Consequence:** most of the PDF's richer operational vocabulary — `EN
ATENCIÓN`, `POR COBRAR`, `RESERVADA`, `PEDIDO`/`PREPARACIÓN`/`SERVIDO` as
distinct states, the full payment/split/discount/cancellation/move/merge
UX — has **no canonical backend counterpart in this codebase today**. V4
implements all of it as an explicit **preview-only projection layer**
(section 5 below), never as a claim that this is how the real domain
behaves.

---

## 2. Classification matrix

| # | Feature (PDF §) | Preview implementation | Canonical status | Protected decision | Future owner / module | Notes |
|---|---|---|---|---|---|---|
| 1 | Table grid, card-is-primary-action | Full interactive fixture grid | CANONICAL_SUPPORTED (concept only — `Mesa.status` exists; full card UX is presentation) | — | TRIDENTPOS / Salón | Matches WP-014 `DISPONIBLE`/`OCUPADA` at the core |
| 2 | Open table (guests/waiter/customer) | Modal → `PREVIEW_SESSION_STATE` table session | CANONICAL_SUPPORTED (maps to `AbrirMesa()`) | — | TRIDENTPOS | Fixture-only; no `AbrirMesa()` call |
| 3 | Occupied → account drawer | Direct navigation, no confirm | CANONICAL_SUPPORTED | — | TRIDENTPOS | Matches `Cuenta.status = ABIERTA` |
| 4 | Add products / ticket | Reused V2/V3 POS selector | CANONICAL_SUPPORTED (maps to `CapturarComanda()`) | — | TRIDENTPOS | Preview arithmetic only (not ADR-012 Money) |
| 5 | Enviar a cocina | Fixture order `ORD-XXXX`, status label | PREVIEW_ONLY | — | TRIDENTPOS / KDS | Real trigger is `ConfirmarKdsOrden()` → `OrdenProduccionConfirmadaEnKDS` (DEC-004); not implemented here |
| 6 | Preparación / Listo / Servido demo | Dev-only stage simulator | PREVIEW_ONLY | — | KDS (future module) | No canonical KDS states exist yet |
| 7 | EN ATENCIÓN | Overlay flag over `OCUPADA`/`POR_COBRAR`, not a stored status | PREVIEW_ONLY | — | TRIDENTPOS | No canonical `Mesa` status for this; modeled per architectural rule (§5) as a projection, not a stored field |
| 8 | POR COBRAR | Derived visual state, not a `Mesa.status` value | PREVIEW_ONLY | — | TRIDENTPOS | Canonical `Mesa` has no such status; approximated from `Cuenta.status = IMPRESA` / a `checkRequested` fixture flag |
| 9 | RESERVADA | Fixture reservation object | PREVIEW_ONLY | — | Reservations (future module) | No canonical reservation aggregate exists in `MODULE_CATALOG.md` |
| 10 | Cobrar / payment modal (card/cash/transfer/split) | Full fixture payment flow | PREVIEW_ONLY | — | TRIDENTPOS / Caja (P0, not yet built) | `PagarCuenta()` is cataloged but has no implementation or UI in this repo yet |
| 11 | Confirmar cierre → Disponible | Fixture close + release | CANONICAL_SUPPORTED (shape only) | — | TRIDENTPOS | Real close path also involves `TurnoCaja`/Folio (DEC-006), not modeled |
| 12 | Refund note | Static informational message only | N/A (explicitly out of scope) | — | Finance | Per work order §46 — no workflow implemented |
| 13 | Cambiar mesero | Fixture reassignment + event log | CANONICAL_SUPPORTED (concept) | — | TRIDENTPOS | No canonical audit trail wired; preview event log only |
| 14 | Cambiar personas | Fixture guest count edit | CANONICAL_SUPPORTED (concept) | — | TRIDENTPOS | — |
| 15 | Mover mesa | Fixture transfer UX + one mocked invalid destination | PREVIEW_ONLY interaction over a | **PROTECTED: OQ-SSOT-02** | TRIDENTPOS | Labeled `PREVIEW_TRANSFER_VALIDATION_RESULT`; no PIN/authorization rule implemented or implied |
| 16 | Unir mesas | Fixture selection UX, "Cuenta principal" / "Grupo visual" | PREVIEW_ONLY | — | TRIDENTPOS | Labeled `PREVIEW_TABLE_MERGE`; no canonical merge-accounting semantics exist |
| 17 | Dividir mesa / cuenta | Fixture item-assignment UX across buckets | PREVIEW_ONLY interaction over a | **PROTECTED: OQ-SSOT-06** | TRIDENTPOS / Finance | Labeled `PREVIEW_SPLIT_RESULT`; proration of discounts/tips is explicitly NOT computed |
| 18 | Imprimir precuenta | Print-styled preview document | PREVIEW_ONLY (concept maps to `ImprimirPrecuenta()`) | — | TRIDENTPOS | Does **not** assign a real Folio (DEC-006 not reimplemented); labeled `PRECUENTA` |
| 19 | Ver historial (event log) | Full fixture audit trail per table/account | PREVIEW_ONLY | — | TRIDENTPOS | `PREVIEW_EVENT_LOG`, browser-memory only |
| 20 | Aplicar descuento | Fixture % / amount + reason + permission gate | PREVIEW_ONLY | — | TRIDENTPOS / Finance | Labeled `PREVIEW_DISCOUNT_AUTH_POLICY`; no canonical threshold/authorization rule |
| 21 | Cancelar cuenta | Fixture reason + authorization gate | PREVIEW_ONLY interaction over a | **PROTECTED: OQ-SSOT-01** | TRIDENTPOS / Inventory | Labeled `PREVIEW_CANCELLATION_POLICY`; post-kitchen cancellation policy explicitly not decided |
| 22 | Liberar mesa | Fixture balance check + admin-exception path | PREVIEW_ONLY | — | TRIDENTPOS | `CAN_FORCE_RELEASE` is a preview fixture capability, not real RBAC |
| 23 | Modifier selector (Taco Rib Eye demo) | Unchanged from V2/V3 | PROTECTED_DECISION | **PROTECTED: OQ-SSOT-07** | Inventory (recipe engine) | Untouched in V4 |
| 24 | Dashboard / Inicio KPIs | Now navigable, fixture-only | PREVIEW_ONLY | — | Reportes / BI (future module) | Explicitly `PREVIEW_FIXTURE_DATA`, no analytics engine |
| 25 | Pedidos, Cocina (KDS), Inventario, Clientes, Reportes, Configuración nav items | Visually complete "Módulo pendiente de implementación" placeholder | NOT_IMPLEMENTED | — | Their respective cataloged modules | No fake functionality; states the module's future purpose from `MODULE_CATALOG.md` |
| 26 | Selector de sucursal (dropdown, 3 branches) | Fixture branch switch, simulated reload, unsaved-context confirm | PREVIEW_ONLY | — | Platform Core (multi-branch) | No real multi-tenant context switching |
| 27 | Global search (Cmd/Ctrl+K) | Full fixture search across mesas/cuentas/pedidos/clientes | PREVIEW_ONLY | — | TRIDENTPOS | Indexes only in-memory fixture records |
| 28 | Notification center | Full fixture alert panel, individual mark-as-read | PREVIEW_ONLY | — | TRIDENTPOS | Alerts generated by the fixture rule engine described in §7 below |
| 29 | User menu + roles (Gerente/Cajero/Mesero) | Fixture role switch gating sensitive actions | PREVIEW_ONLY | — | Platform Core (RBAC) | Not canonical RBAC — `PREVIEW_POLICY_STUBS` only |
| 30 | Area filters (Todas/Salón/Terraza/Barra/Privado) | Fully functional fixture filter | CANONICAL_SUPPORTED (concept) | — | TRIDENTPOS | Matches `AreaVenta` concept |
| 31 | KPI status filters + combination with area | Fully functional | PREVIEW_ONLY (statuses beyond Disponible/Ocupada are preview-only, see row 7-9) | — | TRIDENTPOS | — |
| 32 | Floor plan view + drag configuration mode | Fixture coordinate layout, session-only drag | PREVIEW_ONLY | — | TRIDENTPOS / Configuración | No persistence; explicitly not the real "Diseño del salón" editor |
| 33 | "+ Nueva mesa" vs "+ Abrir cuenta" | `+ Abrir cuenta` used as primary CTA; physical table creation is not exposed as an operator action | PREVIEW_ONLY UX decision, matches PDF recommendation | — | Configuración → Diseño del salón | Direct product recommendation from the source PDF, adopted as-is |

---

## 3. Protected Product Owner decisions — explicit non-resolution statement

The following remain **exactly as open as they were before V4**. Nothing
in this preview closes them, narrows their option set, or should be read
as an implied recommendation beyond what `OPEN_QUESTIONS.md` already
documents:

- **OQ-SSOT-01** (`CancellationPolicy`) — Cancel Account UI shows a
  reason field and a permission gate, labeled `PREVIEW_CANCELLATION_POLICY`.
  It does not decide Option A/B/C from `OPEN_QUESTIONS.md`.
- **OQ-SSOT-02** (`TransferValidationRule`) — Move Table UI shows a
  destination picker and one disabled/invalid example, labeled
  `PREVIEW_TRANSFER_VALIDATION_RESULT`. It does not decide whether a
  receiving-waiter PIN or manager authorization is required.
- **OQ-SSOT-06** (`BillSplitProrationStrategy`) — Split Bill UI lets the
  operator assign items to buckets and shows a `PREVIEW_SPLIT_RESULT`
  per-bucket subtotal. It does **not** prorate discounts or tips — that
  arithmetic is exactly the open question and is deliberately absent.
- **OQ-SSOT-07** (`ModifierRecipeResolver`) — unchanged from V2/V3; the
  modifier modal remains a UX demonstration limited to one product family.

---

## 4. Architectural rule enforced in this preview (mandatory, work order §54)

`table.visualState` is **never** stored as a field. The preview computes
it on every render from underlying fixture fields, mirroring how the real
domain would project a read-model from several aggregates:

```js
VisualTableState = project(
  TableSession,   // guests, waiter, customer, openedAt
  Account,        // status: ABIERTA | IMPRESA | PAGADA | CANCELADA, checkRequested
  Order,          // kdsStatus (preview-only: ENVIADO | PREPARACION | LISTO | SERVIDO)
  Reservation,    // hora, cliente, personas, toleranceExceeded
  AttentionOverlay // cause | null — always an overlay, never a replacement status
)
```

See `computeVisualState()` in `app.js` for the implementation. Attention
is always additive: resolving it returns the table to whatever the
underlying projection already says (`ocupada` or `por_cobrar`), it never
needs its own "previous state" field.

## 5. Fixture rule engine (§47 alert automation)

Alerts are generated by small, explicit fixture rules (not a real
scheduler): a demo panel lets the Product Owner *trigger* the same
conditions a real system would eventually detect automatically (time
threshold, KDS delay, customer call, kitchen rejection, product
unavailable, low stock). Triggering one appends a `PREVIEW_EVENT_LOG`
entry, sets the table's `attention` overlay (when table-scoped), and adds
a notification-center entry. This is explicitly a manual simulator, not
an automation engine.

## 6. What this document is not

This is not an architecture decision record, not a substitute for
`OPEN_QUESTIONS.md` / `PRODUCT_DECISIONS.md`, and not a commitment to any
specific canonical implementation of Caja, Reservations, or KDS. It exists
solely to keep the V4 interactive preview honest about what it is
demonstrating versus what has actually been decided or built.
