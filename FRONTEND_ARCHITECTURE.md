# FRONTEND ARCHITECTURE — TRIDENTPOS NATIVE POS

**Document ID:** `ARCH-FE-001`
**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW` (Frontend Architecture Gate, prerequisite of `WP-026A`)
**Author role:** `05_Frontend_Architect`
**Date:** 2026-10-06
**Governing framework:** EAAF v1.3.0 + Lean Delivery Profile (ACR-2026-021)
**Frozen inputs (not re-decided here):** `ADR-003` (Electron edge host, context isolation, `nodeIntegration` disabled, sandbox), `ADR-005` (HTTP commands with OCC + `ws` push, 5 s heartbeat, full resync on reconnect), `ADR-012` (exact fixed-point money), `ACR-2026-015` (`FE-COND-015-01..03`, `UX-COND-015-01..02`), `WP-007` security controls, React + Electron 30+ + Tailwind CSS stack, `VISUAL_SYSTEM.md` (`ARCH-UX-001`).

This document defines every architectural choice `WP-026A..D` must implement (`FE-COND-015-01`). Builders consume it; they do not decide architecture (`FE-COND-015-02`). No business rule lives in the UI (`FE-COND-015-03`).

---

## 1. Context and topology

```text
┌──────────────────────── Edge host (Electron main, Node) ────────────────────────┐
│  security-profile · navigation-lock · offline IAM · enrollment · SQLite (WAL)    │
│  ApiGateway (NEW, main-process) ──HTTP──▶ pos-edge-runtime (Fastify, localhost)  │
│  EventRelay (NEW, main-process)  ◀──WS──  /kds/events, operational events         │
│          ▲  typed allowlisted IPC (contextBridge)                                │
└──────────┼──────────────────────────────────────────────────────────────────────┘
           │ window.trident.*   (no Node, no network, no tokens in renderer)
┌──────────┴──────────── Renderer (sandboxed, context-isolated) ──────────────────┐
│  @trident/pos-renderer: React app · router · TanStack Query · feature modules    │
│  @trident/ui: tokens, primitives, components                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Decision FE-01 — The renderer never talks to the network.** All HTTP commands/queries and WebSocket events go through the main process. The renderer only calls the typed `window.trident` bridge. Consequences: CSP `connect-src 'none'`; session tokens never reach renderer memory; CORS is irrelevant; one place enforces OCC headers, correlation IDs and timeouts.

## 2. Packages and build

| Package                          | Role                                                                                                               | Depends on                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `@trident/ui` (exists, scaffold) | Design tokens, primitives, shared components. No domain knowledge, no IPC.                                         | React, Tailwind, Radix UI primitives, `class-variance-authority`  |
| `@trident/pos-renderer` (NEW)    | React application: routing, session presentation, data layer, feature modules (`salon`, `kds`, `caja`, `shell`).  | `@trident/ui`, contract types and Zod schemas from `@trident/core`|
| `@trident/edge` (exists)         | Electron main + preload; gains `ApiGateway`, `EventRelay` and new allowlisted channels.                           | `@trident/core`                                                   |

- **Build:** Vite produces static assets for `pos-renderer`; Electron loads them from a custom privileged protocol (`app://pos/`) registered in main, never `http://` and never a dev server in production builds.
- **Graph rules (enforced by `scripts/check-graph.mjs`):** `ui` may import only `@trident/core`. `pos-renderer` may import only `@trident/ui` and `@trident/core`. `@trident/edge` imports only `@trident/core`. Domain implementation packages (`pos`, `inventory`, `finance`, `billing`, `pos-edge-runtime`) are never imported by renderer packages or `edge`.
- **New dependencies (non-foundational, exact pins, Trivy clean):** All dependencies are strictly pinned with exact versions (no `^` or `~`), vetted with 0 high/critical vulnerabilities via Trivy SCA and secret scan in CI: `react` (19.x), `react-dom` (19.x), `react-router` (7.x), `@tanstack/react-query` (5.x), `react-hook-form` (7.x), `zod` (3.x), `tailwindcss` (3.4.x / 4.x), Radix UI primitives, `class-variance-authority`, `vite`; dev: `vitest`, `@testing-library/react`, `@playwright/test` (Electron mode). These conform to EAAF web defaults.

## 3. Station modes and routing

**Decision FE-02 — One renderer window per station; the station mode comes from enrollment, not from the UI.** The main process exposes the enrolled terminal profile (`POS`, `KDS`, `CAJA`, or `POS+CAJA`) and its station/branch IDs.

**Decision FE-03 — Router:** React Router v7 in data mode with a **hash history** (assets served from `app://`). Route tree:

```text
/                      → redirect by station mode
/login                 → PIN login (offline IAM)
/salon                 → floor grid (WP-026B)
/salon/mesa/:mesaId    → account drawer for a table (WP-026B)
/kds/:estacionId       → station board (WP-026C)
/caja                  → cash home: active shift, drawer status (WP-026D)
/caja/cobro/:cuentaId  → payment flow (WP-026D)
/caja/turno            → open/close shift, blind count, cuts X/Z (WP-026D)
/sistema               → terminal diagnostics (health, versions, connectivity)
```

- Every route except `/login` and `/sistema` is wrapped in `RequireSession`.
- Routes not allowed for the station mode render `NotAvailableHere` (not a 404).
- Deep links are never accepted from outside the app (navigation-lock remains authoritative).

## 4. Session boundary

**Decision FE-04 — Sessions live in main.** PIN login calls `window.trident.session.login({ userCode, pin })`; main runs offline IAM (WP-010), keeps the session token in memory, and returns only a **session view**: `{ userId, displayName, roles[], permissions[], branchId, stationId, expiresAt }`.

- Lockout, PIN rules and supervisor unlock remain server-side (WP-010); the renderer only renders the outcome codes.
- **Inactivity:** main enforces an idle timeout (configurable per terminal) and emits `session.expired`; the renderer drops all cached queries and routes to `/login`.
- **Step-up authorization** (DEC-010, 012, 013): when the server answers `AUTHORIZATION_REQUIRED` with a `requiredPermission`, the renderer opens `SupervisorPinDialog` and resends the **same command** through `window.trident.session.authorize({ commandRef, pin })`. The supervisor's token never reaches the renderer; main attaches it to that one command.
- `permissions[]` is used **only** to hide or disable actions (UX). Every command is authorized server-side; a denied command shows a human message without exposing permission IDs.

## 5. API / IPC boundary

**Decision FE-05 — Typed command/query channels, no generic proxy.**

- Each server capability gets its own allowlisted channel (`trident:q:<query>` / `trident:c:<command>`), added to `EDGE_IPC_CHANNELS`, with a Zod schema validated **in preload (shape) and again in main (authoritative)** before forwarding to Fastify.
- There is **no** channel that accepts an arbitrary URL, method or path.
- Main attaches: session token, `x-correlation-id`, `If-Match`/`expectedVersion` from the command payload, and a 5 s timeout (10 s for payment/terminal commands).
- The bridge exposes namespaced functions only, e.g. `window.trident.salon.openAccount(...)`, `window.trident.kds.markReady(...)`. `ipcRenderer` and `invoke` are never exposed.

**Result envelope (all channels):**

```ts
type Result<T> =
  | { ok: true; data: T; version?: number }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; retryable: boolean; conflict?: ConflictInfo };
    };
```

`ErrorCode` is a closed union shared via `@trident/core` type exports (e.g. `CONFLICT_VERSION`, `AUTHORIZATION_REQUIRED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `EDGE_UNAVAILABLE`, `TIMEOUT`, `INTERNAL`). Raw stack traces and server internals never cross the bridge.

## 6. Client contract strategy

**Decision FE-08 — Acyclic Edge API contracts defined natively in `@trident/core`.**

- Request/response DTOs, events, and validation schemas are defined natively in `@trident/core/src/contracts/edge-api/` (e.g. `dining-contracts.ts`), with **zero dependencies** on domain runtime packages (`pos`, `pos-edge-runtime`, etc.).
- Both `@trident/pos-renderer` and `@trident/pos-edge-runtime` import these contracts directly from `@trident/core`.
- Neither `@trident/core` re-exports domain packages, nor does `@trident/edge` depend on `@trident/pos-edge-runtime`. This ensures 100% acyclic compliance with ADR-013 §4.2/6 and satisfies `scripts/check-graph.mjs`.
- Each contract provides both TypeScript interfaces and runtime Zod schemas. Preload and main validate payloads at the boundary; the renderer validates events before caching.
- Event payloads carry `eventContractVersion` (ACR-2026-020 rule). Unknown major versions are dropped with a diagnostic and trigger a full refetch of the affected projection.

## 7. Data layer, state and caching

**Decision FE-06 — Server state lives in TanStack Query; there is no global client store for domain data.**

| Kind of state                                                | Owner                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Projections from the edge (tables, accounts, tickets, shift) | TanStack Query cache, keyed by `[domain, entity, id, branchId]` |
| Session view                                                 | `SessionProvider` (React context) fed by main                   |
| Station profile, connectivity                                | `StationProvider` (React context) fed by main                   |
| Ephemeral UI (open drawer, selected tab, form drafts)        | Component state / React Hook Form                               |

- **No optimistic updates** for any state transition with money, inventory, folio, status or authorization. The UI shows a pending state and applies the server result. Optimistic updates are allowed only for purely local UI (e.g. collapsing a panel).
- **Invalidation:** `EventRelay` forwards domain events on `trident:events`; a single `EventInvalidator` maps event types to query keys and invalidates or patches them (patching only when the event carries the full new projection and version).
- **staleTime:** operational projections 0–5 s; catalogs 5 min; station profile until restart.
- **Reconnect (ADR-005):** on `connectivity.restored`, invalidate every operational query (full resync).
- **Session termination and operator switch (ADV-01):** On logout, lock, or operator switch, the TanStack Query cache is purged immediately (`queryClient.clear()`), active in-flight requests are canceled via `AbortController`, and transient form drafts are reset to prevent cross-operator information leakage.

## 8. Offline and connectivity presentation

Three independent signals, all supplied by main, shown in the shell status bar:

| Signal  | Meaning                                            | UI behavior                                                                                                 |
| ------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `edge`  | renderer ↔ main ↔ local Fastify reachable          | If down: blocking overlay "Terminal sin conexión con el servidor local", reads disabled, retry with backoff |
| `lan`   | station ↔ edge host over LAN (for remote stations) | If down: banner; mutations disabled; last data shown with a "desactualizado" marker                         |
| `cloud` | edge ↔ cloud sync (WP-013)                         | Informational badge only; floor operation continues                                                         |

The renderer never queues mutations for later replay; durability and outbox semantics belong to the edge (WP-012/013).

## 9. Error architecture

- **Route error boundaries** per feature module; a **root fatal boundary** offers "Reintentar" and "Reiniciar terminal" and reports through `window.trident.diagnostics.report` (sanitized, no payloads).
- **OCC conflict UX (`CONFLICT_VERSION`, HTTP 409):** never auto-retry the same command. Refetch the projection, show what changed (`ConflictNotice`), and let the user re-apply the action on the fresh version. Shared component: `useConflictAwareMutation`.
- **Authorization:** `AUTHORIZATION_REQUIRED` → step-up dialog (§4); `FORBIDDEN` → message with no internal IDs.
- **Validation:** field-level messages via React Hook Form + Zod (client schema mirrors server schema; the server stays authoritative).
- **Timeouts / edge unavailable:** retryable banner; payment and terminal commands show a reconciliation state and defer to `WP-016C`'s `SEC-COND-015-02` protocol (the UI reflects it, it does not re-implement it).

## 10. Component architecture

**Decision FE-07 — Three layers, one direction of dependency:**

1. **Tokens** (`@trident/ui/tokens`): CSS custom properties generated from `VISUAL_SYSTEM.md`.
2. **Primitives** (`@trident/ui/primitives`): accessible building blocks on Radix UI (Button, IconButton, Input, NumericKeypad, PinPad, Dialog, Sheet/Drawer, Tabs, Toast, Badge, Tooltip, Select, Switch, Skeleton, ScrollArea, VisuallyHidden). No domain words.
3. **Components** (`@trident/ui/components`): domain-agnostic composites (StatusBar, ConnectivityIndicator, SupervisorPinDialog, ConflictNotice, MoneyText, Timer, EmptyState, ErrorState, ConfirmDialog).

Feature modules in `pos-renderer` (`salon`, `kds`, `caja`) compose these and may not define new visual primitives; anything reusable moves down into `@trident/ui` (`UX-COND-015-02`: one visual language).

- **Variants:** `class-variance-authority` with variants restricted to `intent` (primary, secondary, neutral, danger), `size` (md = 48 px matching `--target-md` default in `VISUAL_SYSTEM.md` §5, lg = 56 px for primary actions, xl = 72 px for KDS bump/caja keypad; with 44 px `--target-min` as absolute floor) and `tone` (solid, soft, outline). No ad-hoc Tailwind colors in feature code; lint rule forbids raw palette classes outside `@trident/ui`.
- **Composition:** slot-based components (`asChild` pattern) over prop explosion.
- **Money (ADV-02):** All monetary figures in contracts and presentation are strictly scale-4 `BigInt` (ADR-012, DEC-013). The UI never performs floating-point arithmetic or uses ambiguous minor units. Display strings are formatted exclusively via `@trident/core` monetary helpers (e.g. `formatMoney(amount4)`).

## 11. Design-token consumption mechanism (`FE-COND-015-01`)

- Source of truth: `VISUAL_SYSTEM.md` token tables → `packages/ui/src/tokens/tokens.json`.
- A build script emits `tokens.css` (`:root` light, `[data-theme="dark"]` dark) and a Tailwind preset that maps theme keys to `var(--…)`.
- `pos-renderer` uses the preset; theme is chosen per station mode (KDS defaults to dark; POS/Caja follow terminal setting) and toggled by setting `data-theme` on `<html>`.
- A unit test fails if any token referenced by the preset is missing from `tokens.json`.

## 12. Accessibility, input and performance

- Touch-first: minimum target 44×44 px (KDS/caja primary actions 56–72 px); no hover-only affordances; long-press never required.
- Keyboard: full focus order, visible focus ring token, `Enter`/`Esc` semantics in dialogs; barcode/keypad input supported in caja.
- WCAG 2.2 AA target; `prefers-reduced-motion` disables non-essential animation; no information conveyed by color alone (KDS states pair color with icon and label).
- Breakpoints from `VISUAL_SYSTEM.md`: 1024×768, 1280×800, 1440×900.
- Performance budget: input-to-feedback ≤ 100 ms on target hardware; KDS lists virtualized above 50 tickets; renderer heap kept within `RSK-11` (total app ≤ 2 GB RAM); one window per station.

## 13. Security posture (inherited, not weakened)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; navigation-lock and window-open denial unchanged.
- CSP: `default-src 'self' app:; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'`.
- No `eval`, no remote fonts or scripts; fonts bundled.
- Logs from the renderer are sanitized by main (no tokens, PINs, PII).
- Context-isolation regression test from WP-007 stays mandatory in CI.

## 14. Testing strategy

| Level          | Tooling                        | Scope                                                                                                         |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Unit           | Vitest + Testing Library       | primitives, hooks (`useConflictAwareMutation`, `EventInvalidator`), token presence                            |
| Contract       | Vitest                         | Zod schemas vs. contract fixtures from `pos-edge-runtime`                                                     |
| IPC            | existing Electron test harness | each new channel: allowlist, schema rejection, no generic proxy                                               |
| E2E            | Playwright (Electron)          | per WP acceptance: login, route guard by station mode, OCC conflict flow, reconnect resync, three breakpoints |
| Non-functional | scripted                       | touch latency, memory snapshot (`RSK-11`), axe-core accessibility scan incl. reduced motion                   |

## 15. Work Package mapping

| WP      | Implements from this document                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP-026A | §2 packages/build, §3 router + station modes, §4 session, §5 bridge + gateway + relay (generic mechanism + diagnostics/session channels), §7 data layer, §8 indicators, §9 boundaries + conflict hook, §10–11 primitives/components/tokens, §13, §14 harness |
| WP-026B | salon channels/schemas and feature module on §5–10                                                                                                                                                                                                           |
| WP-026C | kds channels/schemas and feature module; event-sourced state only (no renderer state machine)                                                                                                                                                                |
| WP-026D | caja channels/schemas and feature module; reflects WP-016C reconciliation                                                                                                                                                                                    |

## 16. Open items (do not block WP-026A)

- Exact channel list per feature is defined in each feature WP against its backend contract (`WP-014A`, `WP-015`, `WP-016/016C`).
- Printer status presentation depends on the existing ESC/POS client contract (WP-015).

## Formal status

```
DOCUMENT=FRONTEND_ARCHITECTURE.md
STATUS=APPROVED — FROZEN
REQUIRED_FOR=WP-026A START (APPROVED/FROZEN)
REVIEW=05_Frontend_Architect (APPROVED — BLK-01 resolved via Decision FE-08, ADV-01..04 closed) + 08_Security_Architect (§4, §5, §13 APPROVED)
ARCHITECTURE_STACK_CHANGE=NO (React + Electron + Tailwind unchanged)
NEW_FOUNDATIONAL_TECHNOLOGY=NO
```
