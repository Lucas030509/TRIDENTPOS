# ARCHITECTURE CHANGE REQUEST: SALÓN PRODUCTIZATION, POS SETTLEMENT & FRONTEND EXECUTION DECOMPOSITION

> [!NOTE]
> **ACR-2026-015 CANDIDATE — PROPOSED / NOT CANONICAL / PENDING INDEPENDENT REVIEW**
>
> This document is a candidate Architecture Change Request under EAAF v1.2.0, authored by `01_Solution_Architect` acting as EAAF Coordinator delegate. It converts two Product Owner / Coordinator DRAFT artifacts
> (`ACR-2026-015_SALON_PRODUCTIZATION_DRAFT.md`, `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX_DRAFT.md`) into a governed candidate subject to independent review. **The author of this document is not authorized to approve it, is not the Product Owner, cannot declare final PASS, cannot close protected decisions, and cannot merge.** No canonical artifact is modified by this document.

**ID:** `ACR-2026-015`
**Title:** Salón Productization, POS Settlement & Frontend Execution Decomposition
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`
**Author (non-approving):** `01_Solution_Architect`
**Design Input Reviewed:** `06_UX_UI_Design_Architect` scope (visual/UX evidence only, not authored by this session)
**Date:** `2026-09-15`
**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW`
**Canonical Base:** `f655551085dea3cff887a411adec4026842aed07` (`main`, verified via `git fetch origin` + `git rev-parse origin/main` immediately before branching)
**Classification:** `ROADMAP DECOMPOSITION + DOMAIN CAPABILITY EXPANSION + PRESENTATION ARCHITECTURE FORMALIZATION`
**Input Drafts (non-canonical, supplied by Coordinator/PO):** `ACR-2026-015_SALON_PRODUCTIZATION_DRAFT.md`, `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX_DRAFT.md`
**Non-canonical Product Evidence Inspected:** `design/ui-preview-pos-floor-v4-functional-salon` @ `ab15b7dad62a14a78f606b64f7fc7d27613f343a`, specifically `docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md` and `docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` at that commit

---

## 0. How This Candidate Differs From the Input Drafts

The two input drafts are directionally sound and are adopted as the basis of this candidate, **with the following corrections made after independent verification against canonical documents.** Per Section 4 of the activation instructions, these discrepancies are documented rather than silently normalized:

1. **Identifier conflict between the two drafts.** `ACR-2026-015_SALON_PRODUCTIZATION_DRAFT.md` names the dining-operations extension `WP-014A`. `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX_DRAFT.md` names the same capability `WP-014B` throughout. These are not reconcilable as written — one document is wrong. **This candidate adopts `WP-014A`**, because (a) it is the identifier used consistently by the ACR draft itself, which is the instrument actually proposing the roadmap change, and (b) `WP-014A` is the identifier the Coordinator's own activation instructions (Sections 5 and 6) name explicitly. The Matrix's `WP-014B` is a drafting error and must be corrected wherever the Matrix is retained as supporting evidence.
2. **Frontend technology stack is not an open decision.** Both drafts frame `WP-026A` as needing to "pin" React/Electron and select Tailwind, implying these are undecided. They are not: `IMPLEMENTATION_PLAN.md`'s frozen `WP-026` entry (underlying baseline `v1.0 APPROVED / FROZEN — 2026-09-03`, unaffected by the pending `ACR-2026-013`/`ACR-2026-014` overlays, which touch only `WP-014`/`WP-016B`/`WP-017`) already lists `Electron 30+`, `React`, and `Tailwind CSS` as WP-026 dependencies. `ADR-003` separately freezes Electron/Node.js as the Edge Host runtime. **Correction:** `WP-026A`'s job is to formalize execution architecture (routing, state management, IPC boundary, design tokens, component library, OCC-409 UX, offline presentation strategy) *within* the already-frozen React/Electron/Tailwind stack — it does not select the stack. See Section I.
3. **A genuinely undocumented finding (not present in either draft) materially strengthens the case for `WP-016C`.** `DATA_MODEL.md` already contains a frozen `pagos` table (Sec. 3) that is **not** listed as a Data Object of any existing WP — not `WP-014`, not `WP-016`. `CAPABILITY_MAP.md` already defines `CAP-OPS-07 [Cobro y Split Payment]` with Owner = TRIDENTPOS, Consumer = TRIDENTPOS, Priority = P0 (Core). `DATA_AUTHORITY_MATRIX.md` already requires "Append-Only + Idempotency Key" integrity on the Pagos row, under owning context "Edge TRIDENTPOS," syncing Edge → Cloud (Finance) via Outbox. **The frozen `pagos` DDL has no idempotency key column at all** — a genuine pre-existing gap between `DATA_AUTHORITY_MATRIX.md`'s stated requirement and `DATA_MODEL.md`'s actual schema, independent of this ACR. See Sections G and J.
4. **The frozen `pagos.payment_method` enum is wider than either draft's `WP-016C` scope.** The column already enumerates `EFECTIVO, TARJETA, TRANSFERENCIA, RESTCARD, CXC`. Neither draft's `WP-016C` scope addresses `RESTCARD` (CRM/Loyalty, `WP-022`) or `CXC` (Cuentas por Cobrar, `OQ-SSOT-03`, Finance/CRM-owned per `OPEN_QUESTIONS.md`). This candidate makes that exclusion explicit rather than leaving it implicit. See Section G.5.
5. **All tender types, not only cash, are frozen to require an open shift.** `pagos.turno_caja_id` is `NOT NULL` for every row regardless of `payment_method`. The Matrix draft frames shift dependency as a cash-specific concern; it is not — card and transfer settlement are equally gated on `WP-016`'s shift lifecycle per the frozen schema. This strengthens, not weakens, the `WP-016C → WP-016` prerequisite.
6. **"Ownership advisory" claimed by the Matrix draft (Section 1: "requiere cierre previo de advisory arquitectónico de ownership") could not be located as a distinct pre-existing artifact.** No file matching that description exists in canonical docs. What does exist is `WP-016`'s own frozen `Bounded Context: TRIDENTPOS / Finance` tag (`IMPLEMENTATION_PLAN.md`), which is an internal ambiguity inside `WP-016` itself, not a separate gating document. This candidate's Section G performs the ownership analysis the Matrix draft was gesturing at, but does **not** claim a prior advisory document exists, and does **not** retroactively resolve `WP-016`'s own internal tag — that remains `WP-016`'s own pending starting condition, unchanged by this ACR.
7. **Reservations are not merely "insufficiently explicit" — they are entirely absent from canonical scope.** A full-text search of `PRODUCT_SCOPE.md`, `CAPABILITY_MAP.md`, `MODULE_CATALOG.md`, `DATA_MODEL.md`, and `IMPLEMENTATION_PLAN.md` for "reservaci*/reservation*" returns zero matches. The exclusion in Section K is therefore stated on stronger grounds than either draft claims.
8. **Documentation freshness lag, unrelated to this ACR, noted for transparency.** `IMPLEMENTATION_PLAN.md`'s own banner still reads "ACR-2026-013 / ACR-2026-014 — PENDING GOVERNANCE APPROVAL," and `ADR-012` still carries a "PROPOSED — PENDING GOVERNANCE APPROVAL" status banner, yet `git log` on canonical `main` shows both `WP-014` (through S14-R4-r2 independent review rounds) and `WP-016B` (through S16B-R2 independent review rounds) fully merged, with `WP-016B`'s merge commit (`f655551`) *being* the current canonical `main` tip. This candidate treats git-canonical merge state as authoritative for WP status (per Section C) and flags the stale banners as a separate Coordinator documentation-hygiene item — not something this ACR resolves or depends on.

None of the above corrections change the drafts' bottom-line recommendation. They make the case for it more precise and, in the case of `WP-016C`, considerably stronger than originally argued.

---

## A. Problem Statement

The Salón V4 functional UI preview (non-canonical, `ab15b7d`) demonstrates a coherent operational model for dining-room management, order capture, kitchen dispatch, attention signaling, account settlement, and floor operations. Comparing that product evidence against the canonical roadmap surfaces three concrete gaps:

1. `WP-014` (canonical, DONE) intentionally excludes a set of dining-room operations the preview demonstrates as required (waiter reassignment, guest-count changes, check-request/precuenta lifecycle, transfer, merge, split, cancellation UX, floor-plan persistence, operational history/attention projection). No WP currently owns productizing them.
2. No canonical WP owns POS payment/settlement orchestration (card, cash, transfer, mixed tender, partial payment, idempotent settlement). `WP-016` owns cash shift/drawer/X-Z only. This gap is corroborated independently of the preview by an already-frozen but unowned `pagos` schema (Section G).
3. `WP-026`, the sole executable WP for POS/KDS presentation, bundles Salón ordering UI, KDS station UI, and Caja/payment UI into one work package with divergent prerequisites, reviewers, and failure domains, which is disproportionate for governed independent review.

---

## B. Canonical Baseline

**Repository:** `Lucas030509/TRIDENTPOS`
**Canonical `main` (verified this session via `git fetch origin && git rev-parse origin/main`):** `f655551085dea3cff887a411adec4026842aed07`

Verified against git history, `evidence/`, and frozen docs (not assumed from the drafts):

| WP | Status | Evidence |
|---|---|---|
| `WP-001`–`WP-013` | DONE / CANONICAL | `evidence/WP-0NN_BUILDER_EVIDENCE*.md` present for each; merge commits present on `main` history |
| `WP-014` | DONE / CANONICAL | `evidence/WP-014_BUILDER_EVIDENCE.md`, `evidence/WP-014_ARCHITECTURE_CHANGE_EVIDENCE.md`; merged via PR #40 (`76a387f`), S14-R4 independent code + data-architecture reviews (incl. r2) present |
| `WP-015`, `WP-016`, `WP-017`, `WP-026` | PENDING | No builder evidence file exists for any of the four; `WP-017` has an in-progress feature branch (`feature/wp-017-inventory-recipes`) but no merge; `WP-026` has no branch activity at all |
| `WP-016B` | DONE / CANONICAL | `evidence/WP-016B_BUILDER_EVIDENCE.md`; merge commit `f655551` **is** the current canonical `main` tip |

This confirms pre-flight premises A–F of the activation instructions exactly as stated, with `WP-017`'s "technically unblocked, pending clean restart" status (premise E) consistent with its dangling non-merged feature branch.

This ACR does not alter the status of any existing DONE/CANONICAL work package.

---

## C. Trigger / Product Evidence

Non-canonical evidence considered, per governance instruction, as requirements/product input only — not architecture authority:

- Branch `design/ui-preview-pos-floor-v4-functional-salon` @ `ab15b7dad62a14a78f606b64f7fc7d27613f343a`
- `docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md` at that commit (present; explicitly classifies preview behavior against canonical architecture and states it does not resolve protected decisions)
- `docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` at that commit (present; see Section K — this path **does not exist on canonical `main` at all**)

---

## D. Current Roadmap Gap

See Section A. Restated as a roadmap-shape problem: the current 29-WP effective executable catalog (`WP-001`–`WP-028` minus `WP-016B`'s renumbering non-event... i.e. 28 original + 1 additive `WP-016B` = 29, verified in Section H) has no atomic unit for (1) dining-operations extension beyond `WP-014`'s intentionally narrow baseline, (2) payment/settlement orchestration, and (3) independently reviewable presentation slices. All three gaps are structural, not merely a matter of sequencing.

---

## E. Architecture Invariants Preserved (Unchanged by This ACR)

### E.1 Modular Monolith
`MODULAR BY DESIGN — INTEGRATED BY CONTRACT` (`FUNCTIONAL_ARCHITECTURE.md` Sec. 2). No new business bounded context may runtime-depend directly on another business bounded context. This ACR proposes zero new runtime dependencies (Section F).

### E.2 Package Topology (`ADR-013`)
Business-domain packages depend only on Platform Core / shared contracts (`@trident/core`). Composition roots wire capabilities together. `WP-014A` and `WP-016C` are proposed as extensions inside the existing `@trident/pos` domain-package boundary, not new packages, pending final package-placement confirmation by `01_Solution_Architect`/`03_Data_Architect` at implementation time.

### E.3 Visual State as Projection
`EN_ATENCIÓN`, `POR_COBRAR`, `PREPARANDO`, `LISTO`, `SERVIDO`, and `RESERVADA` (preview) must not become new authoritative values of `Mesa.status`. `DATA_MODEL.md`'s `mesas` table does not currently carry these as a status enum member set (verified: no such enum literals appear in the frozen `mesas` DDL), so no canonical schema change is silently implied by the preview. The correct model remains a read-model/event projection, as both drafts state. This ACR affirms that invariant; it does not decide the exact projection mechanism (that is `WP-014A`/`WP-026B` implementation detail, not an architecture decision this ACR needs to make).

### E.4 Money Authority (`ADR-012`)
All authoritative monetary calculation remains fixed-point scale-4 integer arithmetic per `ADR-012`. The V4 preview's client-side floating-point arithmetic is explicitly non-authoritative and is not reused.

### E.5 Protected Decisions
No proposed WP in this ACR may select a hidden default for `OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`, `OQ-SSOT-07`, or `OQ-ARCH-01`. Verified independently: none of these five identifiers appear in `PRODUCT_DECISIONS.md` (which lists only decided items, e.g. `DEC-006`, status `APROBADA`). All five remain listed as open in `OPEN_QUESTIONS.md` with no resolution recorded. Premise I of the activation instructions is confirmed true.

---

## F. Ownership Analysis

| Concern | Bounded Context | Grounding |
|---|---|---|
| Dining operations (table/account lifecycle extension) | TRIDENTPOS | Extends `WP-014`'s existing `@trident/pos` ownership; no new context |
| Payment/settlement orchestration | TRIDENTPOS (operational act), Finance (downstream consumer only) | `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 (already frozen — see Section G) |
| KDS transport/printer | TRIDENTPOS (unchanged, `WP-015`) | Existing frozen ownership |
| Frontend/presentation | TRIDENTPOS / Native Edge (unchanged, `WP-026` umbrella) | Existing frozen `Bounded Context: TRIDENTPOS / Native Edge` tag on `WP-026` |
| Inventory depletion from KDS production | Inventory (unchanged) | Existing `WP-018`, out of scope here |
| Reservations | Undefined / excluded | Section K |

No new business bounded context is introduced. No runtime dependency of TRIDENTPOS on Finance is introduced (Section G).

---

## G. Proposed Work Package: `WP-016C` — POS Payment Orchestration & Account Settlement

**Type:** New additive capability
**Bounded Context:** TRIDENTPOS, with event-contract outputs toward Finance/Billing/Loyalty (conditional subscribers)
**Primary Builder:** `16_Native_Edge_Developer` (Edge-local orchestration); `13_Backend_Developer` support only if a cloud-side adapter/contract surface is required
**Specialist Reviewers:** `03_Data_Architect` + `08_Security_Architect` (mandatory given payment adapter/credential/idempotency surface)
**Mandatory Code Reviewer:** `11_Code_Reviewer`
**Prerequisites:** `WP-014` (canonical), `WP-016` (for shift/drawer-gated settlement — see G.4)
**Risk:** High
**Migration Impact:** Expand (extend frozen `pagos` schema; see G.3)

### G.1 Why this is not a new ownership decision

`FUNCTIONAL_ARCHITECTURE.md` Section 6.3 ("Contrato TRIDENTPOS ↔ Finance / Billing") is **already frozen** and already states the exact invariant this ACR proposes to operationalize:

> "**Ownership de Caja:** TRIDENTPOS genera internamente ... el cobro de cuentas ... Corte X ... Corte Z." Domain event `CuentaPagada(...)` is emitted **by** TRIDENTPOS; Finance/Billing/Loyalty consume it conditionally ("si está presente"), for reconciliation, fiscal enablement, and loyalty accrual respectively.

This is corroborated at the capability and data-authority level:

- `CAPABILITY_MAP.md`: `CAP-OPS-07 [Cobro y Split Payment]` — Owner **TRIDENTPOS**, Consumer **TRIDENTPOS**, Priority **P0 (Core)**.
- `DATA_AUTHORITY_MATRIX.md`: row "Pagos & Transacciones de Cobro" — Write authority Edge SQLite / Edge Host Local; owning context **Edge TRIDENTPOS**; sync Edge → Cloud (Finance) via Outbox; required integrity **"Append-Only + Idempotency Key."**

**Conclusion:** `WP-016C`'s ownership rule ("TRIDENTPOS owns operational settlement; Finance consumes durable events; no runtime dependency TRIDENTPOS → Finance") is not a new architectural decision — it is the implementation of an already-approved functional contract and an already-assigned capability/data-authority ownership. `WP-016C` closes an *implementation* gap, not an *ownership* gap.

### G.2 Scope

- `PagoCuenta`/settlement handling extending the existing (frozen, unowned) `pagos` table
- Tender lines: `EFECTIVO`, `TARJETA`, `TRANSFERENCIA` (see G.5 for explicit exclusions)
- Mixed/split tender, partial payment, remaining balance, tip capture
- Payment reference/authorization metadata (`reference_auth_code`, already a column)
- Idempotency key for payment submission (schema addition — see G.3)
- Settlement completion and account-close coordination with `WP-014`/`WP-014A`
- Abstract card-terminal adapter contract (no concrete provider selected by this ACR)
- Emission of `CuentaPagada` per the already-frozen Section 6.3 contract shape

### G.3 Data integrity requirement — concrete, pre-existing gap

The frozen `pagos` DDL (`DATA_MODEL.md` Sec. 3) has **no idempotency-key column**, despite `DATA_AUTHORITY_MATRIX.md` mandating "Append-Only + Idempotency Key" for this exact table. `WP-016C` must close this gap — most naturally by extending `pagos` with a `client_op_id`/idempotency-key column following the same composite-key pattern already proven in `WP-012`'s `IngestedIdempotencyLog` (`(orgId, branchId, aggregateType, aggregateId, action, clientOpId)`), rather than inventing a new idempotency mechanism. This is an **Expand** migration on an existing table, not new architecture.

`pagos.turno_caja_id` is `NOT NULL` for **every** row regardless of `payment_method` — cash, card, and transfer settlement are all gated on an open `WP-016` shift, not only cash. `WP-016C`'s dependency on `WP-016` is therefore unconditional, not cash-tender-specific.

### G.4 `OQ-ARCH-01` interaction

`WP-016C` must not decide whether multiple cashiers may share one drawer/shift. It consumes whatever shift-assignment capability `WP-016` ultimately implements once `OQ-ARCH-01` is resolved by the Product Owner.

### G.5 Explicit scope exclusion (correction to both input drafts)

The frozen `pagos.payment_method` enum already includes `RESTCARD` and `CXC`, neither of which either input draft's `WP-016C` scope addresses. This candidate makes the exclusion explicit: **`RESTCARD` (CRM/Loyalty prepaid-balance redemption, depends on `WP-022`) and `CXC` (Cuentas por Cobrar / credit-limit validation, `OQ-SSOT-03`, Finance/CRM-owned) are OUT OF SCOPE for `WP-016C`'s first slice.** `WP-016C` should either leave those enum branches unimplemented (rejected at the API boundary with a clear "not yet supported" response) or explicitly stub them behind a feature flag — but must not silently half-implement them.

### G.6 Crash-recovery / idempotency risks (unchanged from drafts, now schema-grounded)

- No duplicate tender line on retry (addressed by G.3's idempotency-key addition)
- Crash between external card-terminal authorization and local durable persistence must have a defined recovery path; cannot be solved in UI (`WP-026D`)
- Cash-shift integrity must reconcile against `WP-016`'s `turnos_caja` (already an FK constraint in the frozen schema)
- No offline card-terminal behavior may be assumed until a terminal/provider adapter contract is selected — this ACR does not select one

---

## H. Proposed Work Package: `WP-014A` — Dining Operations Expansion

**Type:** Additive sibling extension to canonical `WP-014`
**Bounded Context:** TRIDENTPOS
**Primary Builder:** `16_Native_Edge_Developer`
**Specialist Reviewer:** `01_Solution_Architect` or `03_Data_Architect` per final implementation footprint
**Mandatory Code Reviewer:** `11_Code_Reviewer`
**Prerequisite:** `WP-014` (canonical)
**Risk:** Medium
**Migration Impact:** Expand only where persistence is required

### H.1 Scope

Change waiter; change guest count; request check; precuenta lifecycle; table transfer command surface; split-account command surface; cancellation command surface; table release rules; operational event/audit trail; Salón read model; attention-signal projection; floor-plan coordinate persistence (if approved as TRIDENTPOS-owned configuration); table-merge semantics (pending further specification — see H.4).

### H.2 Explicit non-scope

Payment tender orchestration (`WP-016C`); KDS transport (`WP-015`); Inventory depletion; Reservations; Finance ledger posting; fiscal stamping; UI component implementation (`WP-026B`).

### H.3 Protected decision bindings

`WP-014A` may not close `CancellationPolicy` (`OQ-SSOT-01`), `TransferValidationRule` (`OQ-SSOT-02`), or `BillSplitProrationStrategy` (`OQ-SSOT-06`). `WP-014` already created parameterization hooks for exactly these three interfaces (`IMPLEMENTATION_PLAN.md` WP-014 "PO Dependency" line, verified). `WP-014A` extends usage of those existing hooks; it does not redefine them.

### H.4 DEC-006 interaction

`DEC-006` ("Asignación de Folio de Venta Únicamente al Emitir Precuenta Impresa") is `APROBADA` (verified in `PRODUCT_DECISIONS.md`). `WP-014A`'s precuenta/check-request lifecycle must assign the sales folio only at printed-precuenta time, per this already-approved decision — not at check-request time, not at table-open time.

### H.5 Table-merge — flagged as needing further specification, not approved as-is

Both drafts list "unir mesas" (merge tables) inside `WP-014A`/`WP-014B`'s scope. Merge-table semantics (single combined account vs. linked accounts, folio implications, split-back behavior) are not addressed by any frozen document. This candidate keeps merge in `WP-014A`'s scope as the Matrix draft proposes, but flags it explicitly: **implementation of merge-table semantics must not proceed past a parameterized/neutral hook until the Product Owner or `01_Solution_Architect` provides an explicit semantic model** — the same treatment already applied to `CancellationPolicy`/`TransferValidationRule`/`BillSplitProrationStrategy`.

### H.6 Acceptance direction

OCC remains enforced across all new table/account mutations; no lost updates; audit events are immutable; attention-signal projection never overwrites underlying domain state; precuenta/check-request transitions preserve `DEC-006`; transfer/split/cancel behavior implements zero implicit business-rule defaults.

---

## I. Proposed Frontend Decomposition

`WP-026` becomes a non-executable umbrella/milestone label for traceability. It is replaced, for execution purposes, by four atomic WPs.

### `WP-026A` — Frontend Architecture, App Shell & Design System
**Builder:** `16_Native_Edge_Developer`, design input from `06_UX_UI_Design_Architect`
**Specialist Reviewer:** `01_Solution_Architect`
**Prerequisites:** `WP-007` (canonical); does **not** require full domain completion of `WP-014A`/`WP-015`/`WP-016`/`WP-016C` — only their contract shapes for integration-boundary design.

Scope, **within the already-frozen React + Electron 30+ + Tailwind CSS stack** (`IMPLEMENTATION_PLAN.md` WP-026 dependencies, frozen baseline v1.0; correction from Section 0.2 — this WP does not select the stack): renderer architecture, routing/navigation, App Shell, state management, query/cache model, IPC/local-REST boundary, offline presentation strategy, OCC-409 conflict UX, error handling, auth/session integration, permission presentation, design tokens, component library, accessibility, touch-target policy, responsive breakpoints.

**Governing-document caveat (pre-existing, not created by this ACR):** `WP-026`'s own "Frozen Requirements" citation of `SOLUTION_ARCHITECTURE.md` Sec. 3 is stale — that section is "Manejo de Eventos en Cloud: In-Process vs. Durable Integration Outbox," unrelated to frontend architecture. No frozen document currently elaborates renderer routing/state-management/component architecture in detail. `WP-026A` is therefore a **necessary architecture-formalization WP, not merely a code-producing WP** — it must produce a governed `FRONTEND_ARCHITECTURE.md` (or equivalent) before `WP-026B/C/D` can be independently reviewed against a stable target. This is flagged as a Coordinator citation-hygiene item on the existing `WP-026` entry, separate from and not blocking this ACR.

This WP consumes `docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` only after that spec is formally canonicalized (Section K).

### `WP-026B` — Salón & Ordering UI
**Prerequisites:** `WP-026A`, `WP-014` (canonical), productive portions of `WP-014A`
**Specialist Reviewers:** `06_UX_UI_Design_Architect` + `01_Solution_Architect` (independent, per EAAF review model)

Table grid, area filtering, floor-plan operational view, account drawer, open-table, add-product, modifiers presentation, send-order invocation, waiter/guest operations, precuenta/check-request, transfer/split/cancel UI hooks, local search over Edge-local entities, operational event/history presentation, event-driven notifications, permission-aware actions, OCC conflict UX. The V4 prototype is reference evidence only; its browser-memory `PREVIEW_*` state must not survive into this WP's implementation.

### `WP-026C` — KDS Station UI
**Prerequisites:** `WP-026A`, `WP-015`

Station ticket board, KDS states sourced from canonical events/contracts only, timers, priorities, preparation/ready/served actions, printer status, reconnect behavior. No independent KDS state machine may be invented in the renderer.

### `WP-026D` — Caja & Payment UI
**Prerequisites:** `WP-026A`, `WP-016`, `WP-016C`
**Specialist Reviewers:** `01_Solution_Architect` + `08_Security_Architect` (terminal/payment security surface)

Payment modal, card/cash/transfer entry, mixed/partial payment, balance remaining, tip, cash received/change, terminal trigger/status, settlement confirmation, account close, table release, active shift/drawer status, recovery/error UX. No authoritative payment logic may reside only in frontend state.

### I.1 Atomicity / independence check (per activation instructions Section 8)

Each of the four has: one clear responsibility; prerequisites drawn only from already-frozen or newly-proposed WPs (no circular dependency); an independently testable acceptance surface (UI-only, consuming canonical contracts); a rollback strategy (sideload previous Electron installer / disable route); a distinct reviewer pairing reflecting its actual risk surface (design for B, security for D); zero business/domain rule ownership inside any of the four (all four consume contracts, none define them). `WP-026B`, `WP-026C`, `WP-026D` may execute in parallel once each one's own prerequisites are canonical; they must not be artificially serialized behind each other.

---

## J. Data Implications

- `pagos`: Expand migration to add an idempotency/dedup key (Section G.3). No other existing table's shape changes.
- `mesas`/`cuentas`: no new authoritative status enum values (Section E.3); any new columns needed for waiter-change/guest-count/transfer/merge/split history are `WP-014A`'s Expand-only migration responsibility, deferred to implementation.
- No new PostgreSQL RLS surface is proposed by this ACR (all proposed WPs are Edge-local except `WP-016C`'s optional cloud adapter contract, which emits events rather than owning new Cloud tables).

## K. Security Implications

- `WP-016C` introduces the first Edge-local payment-adapter/credential surface not previously scoped; mandatory `08_Security_Architect` review (already reflected in Section G's reviewer assignment).
- No new IAM/RBAC model is introduced; all four presentation WPs and `WP-014A`/`WP-016C` must consume canonical IAM (`WP-005`/`WP-010`) — neither draft proposes inventing new RBAC, confirmed by re-reading both drafts' explicit "MUST USE CANONICAL IAM" line in the Matrix.
- `ADR-003`'s Electron context-isolation / `nodeIntegration`-disabled posture is unaffected; `WP-026A` must not weaken it.

## L. Offline Implications

`WP-016C`'s settlement events sync Edge → Cloud via the existing `WP-012` Transactional Outbox (`DATA_AUTHORITY_MATRIX.md`'s stated sync direction for Pagos), not a new sync mechanism. `WP-014A`'s operational history/audit trail should follow the same pattern. No new offline architecture is proposed; both extend `WP-012`/`WP-013`'s existing frozen mechanism.

## M. Payment Crash-Recovery Implications

See Section G.6. Restated as an explicit acceptance gate: `WP-016C` cannot pass independent review without a defined answer to "process crashes after external card-terminal authorization but before local durable persistence" — this is a data/security architecture decision, not a UI concern, and belongs in `WP-016C`'s own specialist review (`03_Data_Architect` + `08_Security_Architect`), not deferred to `WP-026D`.

---

## N. Protected Product Owner Decisions (Not Closed by This ACR)

| ID | Subject | Status after this ACR |
|---|---|---|
| `OQ-SSOT-01` | CancellationPolicy | OPEN — hook reused, not resolved |
| `OQ-SSOT-02` | TransferValidationRule | OPEN — hook reused, not resolved |
| `OQ-SSOT-06` | BillSplitProrationStrategy | OPEN — hook reused, not resolved |
| `OQ-SSOT-07` | ModifierRecipeResolver | OPEN — untouched by this ACR (no proposed WP claims it) |
| `OQ-ARCH-01` | Multi-cashier shift model | OPEN — `WP-016C` consumes whatever `WP-016` ultimately implements |

Additionally not touched: `OQ-SSOT-03` (Cuentas por Cobrar, Finance/CRM) and `OQ-SSOT-04`/`OQ-SSOT-05` (Comandero Móvil / Procurement) — out of this ACR's scope entirely.

---

## O. Explicit Non-Scope

- Reservations (Section P)
- Global cross-context search beyond Edge-local table/account/order lookup (customer search requires `WP-022`; administrative product search may belong in `WP-024`)
- `RESTCARD` and `CXC` tender types in `WP-016C`'s first slice (Section G.5)
- Any concrete card-terminal/payment-provider selection
- Any concrete multi-cashier shift model (`OQ-ARCH-01` remains `WP-016`'s decision)
- Rewriting or renumbering any existing canonical WP
- Any modification to `IMPLEMENTATION_PLAN.md`, `MODULE_CATALOG.md`, `CAPABILITY_MAP.md`, `PRODUCT_SCOPE.md`, `PRODUCT_DECISIONS.md`, `OPEN_QUESTIONS.md`, any ADR, or `main` (this document proposes; it does not enact)

## P. Reservations Disposition

**Confirmed absent from canonical scope**, not merely "insufficiently explicit" (Section 0.7): zero occurrences of "reservaci*/reservation*" across `PRODUCT_SCOPE.md`, `CAPABILITY_MAP.md`, `MODULE_CATALOG.md`, `DATA_MODEL.md`, `IMPLEMENTATION_PLAN.md`. `RESERVATIONS = EXCLUDED / FUTURE ACR`. The preview's reservation UX evidence is preserved as-is on its non-canonical branch; nothing in this ACR asks for its deletion.

## Q. Frontend Architecture Impact

See Section I. Net effect: no new technology selection; a formalization gap is identified and assigned to `WP-026A` (which must also correct the stale `SOLUTION_ARCHITECTURE.md` Sec. 3 citation on the existing `WP-026` entry, as a documentation-hygiene note the Coordinator should action independent of this ACR's approval).

## R. Visual System Governance Dependency

`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` **does not exist on canonical `main` at all** — verified via `git show f655551:docs/design`, which fails with "path exists on disk, but not in 'f655551'" (it exists only on the non-canonical `ab15b7d` preview commit). This is a stronger finding than either draft states (they describe it as "not yet canonical"; it is, more precisely, entirely absent from `main`). **Visual-system canonicalization is a hard prerequisite for `WP-026A`/`WP-026B`/`WP-026C`/`WP-026D` to consume it — not a soft recommendation.**

---

## S. Implementation Plan Impact — Exact Count (Verified, Not Assumed)

Verified directly against `IMPLEMENTATION_PLAN.md` headers (`grep -n "^#### `WP-0"`):

- `WP-001` through `WP-028` = 28 originally-numbered executable WPs (confirmed: exactly 28 `####` headers matching that pattern, `WP-001`…`WP-028`)
- `WP-016B` = 1 additive canonical WP (confirmed merged, confirmed listed with its own header between `WP-016` and `WP-017`)
- **Current effective executable total = 29** — confirmed exact, matches premise/draft claim.

Proposed change:

- Add `WP-014A`, `WP-016C` → +2
- Replace executable `WP-026` (1) with `WP-026A`, `WP-026B`, `WP-026C`, `WP-026D` (4) → net +3 (`WP-026` itself survives as a non-executable umbrella label, per Section I)
- **Net change: +5**
- **Proposed effective executable total: 34** — verified exact via `29 + 2 + 3 = 34`.

No existing numeric WP is renumbered. No identifier conflict exists: `WP-014A`, `WP-016C`, `WP-026A`, `WP-026B`, `WP-026C`, `WP-026D` do not appear anywhere else in the repository (verified via repo-wide `grep`, zero matches prior to this document). `ACR-2026-015` itself does not conflict with any existing ACR number (`ACR-2026-001`…`ACR-2026-014` are the only ones in use; `ACR-2026-010` is a pre-existing gap, unrelated to this ACR).

---

## T. Dependency DAG Amendment

```text
WP-014 (DONE)
   |
   +--> WP-014A  Dining Operations Expansion
   |
   +--> WP-015   KDS Backend/Dispatcher (unchanged)
   |
   +--> WP-016   Cash / Shift / X-Z (unchanged)
            |
            +--> WP-016C  POS Payment Orchestration & Account Settlement

WP-007 (DONE) ---------------+
                              |
                              v
                    WP-026A  Frontend Architecture, App Shell & Design System
                              |
           +------------------+------------------+
           |                  |                  |
           v                  v                  v
      WP-026B            WP-026C            WP-026D
      Salón & Ordering   KDS Station UI     Caja & Payment UI
        ^                    ^                   ^
        |                    |                   |
  WP-014 / WP-014A        WP-015          WP-016 / WP-016C

WP-026B + WP-026C + WP-026D
              |
              v
           WP-027  Cross-Context E2E (lifecycle updated, Section U)
```

`WP-026B`/`WP-026C`/`WP-026D` may run in parallel once their own prerequisites are canonical; none may be serialized behind an unrelated sibling.

---

## U. `WP-027` Impact

`WP-027`'s full-lifecycle E2E scenario (`IMPLEMENTATION_PLAN.md` WP-027 Outputs) should be extended to explicitly include, once `WP-014A`/`WP-016C` exist: `Open Table → Add Products → Send to Kitchen → KDS Production → Inventory Depletion → Request Check / Precuenta → Payment Settlement (WP-016C) → Account Close → Cash/Shift Reconciliation → Billing/Fiscal (conditional) → Cloud Sync → Finance downstream posting (conditional, per Sec. 6.3)`. Any unresolved PO policy (`OQ-SSOT-01/02/06/07`, `OQ-ARCH-01`) must be parameterized in the test fixture, never defaulted.

---

## V. Reviewer Matrix

| WP | Specialist Reviewer(s) | Code Reviewer | Rationale |
|---|---|---|---|
| `WP-014A` | `01_Solution_Architect` or `03_Data_Architect` | `11_Code_Reviewer` | Domain/persistence extension of existing `WP-014` |
| `WP-016C` | `03_Data_Architect` + `08_Security_Architect` | `11_Code_Reviewer` | Payment adapter, idempotency, credentials |
| `WP-026A` | `01_Solution_Architect` | `11_Code_Reviewer` | Cross-cutting architecture/App Shell |
| `WP-026B` | `06_UX_UI_Design_Architect` + `01_Solution_Architect` | `11_Code_Reviewer` | UX consistency + architecture boundary |
| `WP-026C` | `01_Solution_Architect` | `11_Code_Reviewer` | Contract-consumption boundary only |
| `WP-026D` | `01_Solution_Architect` + `08_Security_Architect` | `11_Code_Reviewer` | Payment/terminal UI security surface |

**No reviewer above may be the same individual/session that authored this ACR candidate.** `01_Solution_Architect` reviewer instances for `WP-014A`/`WP-026A`/`WP-026B`/`WP-026C`/`WP-026D` must be fresh, independent sidecar sessions, per Section W.

---

## W. Acceptance Criteria for This ACR

This candidate may proceed to Product Owner approval only after independent reviewers verify:

1. No bounded-context runtime dependency violation (verified in this candidate: none proposed; `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 already governs the TRIDENTPOS→Finance event boundary — see Section G.1).
2. `WP-014A` is additive and does not mutate `WP-014`'s frozen, merged definition.
3. `WP-016C`'s necessity and ownership are independently re-derived from `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3, `CAPABILITY_MAP.md` `CAP-OPS-07`, and `DATA_AUTHORITY_MATRIX.md`'s Pagos row — not merely accepted because the draft asserted it.
4. `WP-026A`–`D` boundaries are atomic and independently reviewable (Section I.1).
5. No protected PO decision is implicitly selected (Section N).
6. Reservations remain excluded (Section P).
7. Prerequisites and parallelization rules are internally consistent (Section T).
8. `WP-027` E2E coverage is updated per Section U.
9. Implementation Plan count (34) and DAG are exact (Section S) — independently re-verifiable via the same `grep` commands used here.
10. Visual/product evidence (V4 preview) is treated as requirements input, not architecture authority (Section C, R).
11. `WP-026A` preserves Electron renderer isolation (`ADR-003` context-isolation posture) and does not weaken `WP-007`'s security controls.
12. `WP-016C`'s design includes idempotency (Section G.3), auditability, Money integrity (`ADR-012`), and crash-recovery obligations (Section M) as first-class acceptance criteria, not deferred items.

---

## X. Rollback / Rejection Behavior

If rejected: canonical `main` is unchanged (already true — no canonical file was touched by this branch); `WP-026` remains the sole governed presentation WP; V4 remains preview evidence only; no proposed identifier (`WP-014A`, `WP-016C`, `WP-026A-D`) becomes authoritative; no PO question is closed; no branch implementing this draft may be merged solely because it exists.

If partially approved: only explicitly approved portions may enter `IMPLEMENTATION_PLAN.md`; rejected portions stay outside canonical docs; any mutation of this ACR's implementation subject requires a new frozen subject SHA and full re-review — no reviewer PASS survives mutation of the subject it reviewed.

---

## Y. Governance Lifecycle

```text
DRAFT (Coordinator/PO inputs)
→ Candidate authored (this document) — non-approving
→ Coordinator Quick Integrity (Section Z)
→ Candidate Subject SHA frozen
→ Independent Solution Review (fresh 01_Solution_Architect instance)
→ Independent Data Review (fresh 03_Data_Architect instance)
→ Independent Security Review (fresh 08_Security_Architect instance)
→ Independent UX/UI Review (fresh 06_UX_UI_Design_Architect instance)
→ Remediation if needed → new frozen subject if mutated
→ Product Owner Approval
→ Architecture Change Gate PASS
→ Merge Authorization
→ PR + CI checks
→ MERGE
→ CANONICAL
```

## Z. Coordinator Quick Integrity — Self-Check (Non-Binding; Coordinator Performs the Authoritative Pass)

As author, I am not authorized to declare this Quick Integrity binding — the activation instructions require the Coordinator to perform it. What follows is the evidence trail so the Coordinator's pass is fast to execute, not a self-issued PASS.

| Check | Finding |
|---|---|
| `QI-015-01` False canonical claims | None found. All proposed WPs marked `PROPOSED`/non-canonical throughout. |
| `QI-015-02` Incorrect WP status claims | None found after verifying `WP-001`–`WP-016B` evidence files individually (Section B). |
| `QI-015-03` Incorrect WP count | Recomputed independently: 29 → 34, exact (Section S). |
| `QI-015-04` Hidden PO decision closure | None found; all five protected IDs remain absent from `PRODUCT_DECISIONS.md` (Section E.5). |
| `QI-015-05` Domain ownership violation | None found; `WP-016C` ownership re-derived from already-frozen Sec. 6.3, not invented (Section G.1). |
| `QI-015-06` Runtime dependency violation | None found; no TRIDENTPOS→Finance runtime call proposed, only event emission (Section G.1). |
| `QI-015-07` Payment idempotency omission | Addressed explicitly and grounded in a real pre-existing schema gap (Section G.3) — this is a genuine finding, not merely a checklist item. |
| `QI-015-08` Frontend architecture assumption unsupported | Corrected: React/Electron/Tailwind ARE frozen (WP-026 dependency line); what is unsupported is the *renderer-internal* architecture, correctly scoped to `WP-026A` (Section I). |
| `QI-015-09` Reservations silently added to scope | None found; explicitly excluded, on stronger grounds than the drafts state (Section P). |
| `QI-015-10` Preview treated as architecture authority | None found; preview cited only as product/requirements evidence throughout (Sections C, R). |
| `QI-015-11` Invalid reviewer self-approval | N/A at this stage (no review has occurred); Section V explicitly prohibits it going forward. |
| `QI-015-12` Existing WP-016 advisory ignored | No such distinct advisory document could be located; treated transparently as WP-016's own internal `TRIDENTPOS/Finance` tag ambiguity, not fabricated as a resolved prior artifact (Section 0.6). |

**No item above resolves to FAIL.** Recommended Coordinator disposition: **PASS**, proceed to independent review. If the Coordinator disagrees with the `QI-015-12` treatment (i.e., a genuine prior advisory document exists elsewhere and was missed), that alone should gate to `HOLD` pending its production — it does not otherwise block this candidate.

---

## AA. Product Owner Approval Block

**Decision:** `PENDING` — not decided by this document.

- [ ] `WP-014A — Dining Operations Expansion` (including the merge-table caveat, Section H.5)
- [ ] `WP-016C — POS Payment Orchestration & Account Settlement` (including the RESTCARD/CXC exclusion, Section G.5)
- [ ] `WP-026` decomposition into `WP-026A`–`WP-026D`
- [ ] Reservations excluded from current Salón productization
- [ ] Effective executable roadmap change 29 → 34
- [ ] `WP-027` lifecycle update (Section U)
- [ ] Visual-system canonicalization as a hard prerequisite for `WP-026A`–`D` (Section R)

Protected functional questions (`OQ-SSOT-01/02/06/07`, `OQ-ARCH-01`) are not approved through this block and remain separate PO decisions.

---

## AB. Current Draft Verdict

```text
ACR-2026-015
SALÓN PRODUCTIZATION, POS SETTLEMENT & FRONTEND EXECUTION DECOMPOSITION

Status:
PROPOSED — PENDING INDEPENDENT REVIEW

Canonical main mutated:
NO

Implementation Plan / Module Catalog / Capability Map / Product Scope /
Product Decisions / Open Questions / ADRs mutated:
NO

Protected PO decisions closed:
NO

Ready for:
INDEPENDENT ARCHITECTURE REVIEW (01_Solution_Architect, 03_Data_Architect,
08_Security_Architect, 06_UX_UI_Design_Architect — fresh sidecar instances)
```
