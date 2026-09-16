# ARCHITECTURE CHANGE REQUEST: SALÓN PRODUCTIZATION, POS SETTLEMENT & FRONTEND EXECUTION DECOMPOSITION

> [!NOTE]
> **ACR-2026-015 — MERGED / CANONICAL ON MAIN** (PR `#43`, canonical merge commit `456f75e854d62012af899cd2a467446375e5d65f`)
>
> *(Current-state banner corrected post-merge — GOV-HYGIENE-015-POST-01. Historical preparation note, preserved: architecture substance below was unchanged from the frozen, reviewed, and approved R1 subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` through candidate preparation.)* This document was independently reviewed by five specialist reviewers (`01_Solution_Architect`, `03_Data_Architect`, `05_Frontend_Architect`, `06_UX_UI_Design_Architect`, `08_Security_Architect` — 5/5 PASS WITH ADVISORIES, 0 blockers), synthesized by the Coordinator (`8fc490f3df1945c21f3a651767618d6cf133e1ad:evidence/ACR-2026-015_R1_COORDINATOR_SYNTHESIS.md`, sidecar commit), approved by the Product Owner (`3808c25285018888d5f31113cab64cdca4192c31:evidence/ACR-2026-015_R1_PRODUCT_OWNER_APPROVAL.md`, sidecar commit), and passed the Architecture Change Gate (`5ccce65262c8e98b82fc6ae08466da4b9de288f8:evidence/ACR-2026-015_R1_ARCHITECTURE_CHANGE_GATE.md`, sidecar commit). None of these three sidecar files is present in this document's tree; the only `ACR-2026-015` evidence file carried here is `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md`. Canonicalization occurred when the R3 candidate (`38bf3449b2ebd5b03a86911996918ada343cd951`) was independently reviewed and merged via PR `#43`. See `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` for full governance provenance.
>
> The prior candidate subject `7117308df6db9e0a1f9fcb87aa365da541549695` was placed on HOLD by the Coordinator after independent Quick Integrity review and remains superseded — see Section 0-R1 for exactly what changed and why.

**ID:** `ACR-2026-015`
**Title:** Salón Productization, POS Settlement & Frontend Execution Decomposition
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`
**Author (non-approving):** `01_Solution_Architect`
**Design Input Reviewed:** `06_UX_UI_Design_Architect` scope (visual/UX evidence only, not authored by this session)
**Date:** `2026-09-15`
**Status:** `MERGED / CANONICAL ON MAIN` (merged R3 subject: `38bf3449b2ebd5b03a86911996918ada343cd951`; canonical merge: `456f75e854d62012af899cd2a467446375e5d65f`; PR `#43`) *(current-state corrected post-merge — GOV-HYGIENE-015-POST-01; historical R1 frozen reviewed subject was `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`)*
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
6. **"Ownership advisory" claimed by the Matrix draft (Section 1: "requiere cierre previo de advisory arquitectónico de ownership").** ~~Could not be located as a distinct pre-existing artifact in the superseded candidate (`7117308`).~~ **R1 correction:** it exists — see Section 0-R1 item 3 and Section N.1. It is `ARCH-ADV-013-01`, a non-blocking advisory against `ACR-2026-013 R1` that specifically gates `WP-016` START (not this ACR's review). The item is retained here only to preserve the correction trail; do not treat this paragraph as current — Section N.1 is authoritative.
7. **Reservations are not merely "insufficiently explicit" — they are entirely absent from canonical scope.** A full-text search of `PRODUCT_SCOPE.md`, `CAPABILITY_MAP.md`, `MODULE_CATALOG.md`, `DATA_MODEL.md`, and `IMPLEMENTATION_PLAN.md` for "reservaci*/reservation*" returns zero matches. The exclusion in Section K is therefore stated on stronger grounds than either draft claims.
8. **Documentation freshness lag, unrelated to this ACR, noted for transparency — updated in R2.** The pre-R1 candidate/baseline `IMPLEMENTATION_PLAN.md` contained stale "ACR-2026-013 / ACR-2026-014 — PENDING GOVERNANCE APPROVAL" banners, even though `git log` on canonical `main` showed both merges long since landed (`WP-014` through S14-R4-r2 independent review rounds; `WP-016B` through S16B-R2 independent review rounds, with `WP-016B`'s merge commit `f655551` *being* the current canonical `main` tip). Canonical Amendment R1 corrected those two banners in `IMPLEMENTATION_PLAN.md` to `ACR-2026-013 MERGED / CANONICAL ON MAIN` and `ACR-2026-014 MERGED / CANONICAL ON MAIN` respectively, citing the exact merge commit SHAs. `IMPLEMENTATION_PLAN.md` no longer marks either as pending. `ADR-012` may still carry historical stale status metadata of its own and remains outside this surgical candidate's file set unless separately authorized — this candidate does not touch `ADR-012`.

None of the above corrections change the drafts' bottom-line recommendation. They make the case for it more precise and, in the case of `WP-016C`, considerably stronger than originally argued.

---

## 0-R1. Coordinator Quick Integrity Remediation (R1)

Superseded candidate subject: `7117308df6db9e0a1f9fcb87aa365da541549695`. That SHA was placed on HOLD by the Coordinator and **must not be reviewed**. This document is the R1 remediation. Three findings from the Coordinator's independent Quick Integrity pass are adopted below, each re-verified against local repository evidence before being accepted (consistent with this document's own standard of not normalizing an input claim without checking it):

1. **Frontend architecture authorship vs. implementation were conflated (`QI-015-08`).** The superseded candidate made `16_Native_Edge_Developer` (a builder role) responsible for producing `FRONTEND_ARCHITECTURE.md`. That is architecture-by-implementation. Corrected in Section I: architecture authorship is separated from `WP-026A`'s implementation scope, a dedicated `FRONTEND_ARCHITECTURE.md` gate is inserted before `WP-026A` can start, and `WP-026A` is retitled to make its implementation-only nature explicit.
   - **Verification caveat, stated transparently:** the Coordinator names `05_Frontend_Architect` as the pinned EAAF authority for this artifact. A repository-wide search of every ACR, ADR, ACR evidence file, and builder-evidence file in this project's history — independently re-verified this round via canonical `main` git history and `evidence/` builder-evidence files: 13 prior ACR identifiers (`ACR-2026-001`–`009`, `011`–`014`) and 15 completed Work Packages (`WP-001`–`WP-014`, `WP-016B`) — finds **zero prior uses of `05_Frontend_Architect`** *(corrected by `ACR-2026-015` Canonical Amendment R1 — CA-QI-015-24/-26: the prior candidate's "14 prior ACRs, 28+ completed WPs" figure was not factually supportable against verified git/evidence history and is replaced here with the verified count)* — every existing frontend/presentation WP (`WP-024` Backoffice, `WP-025` Mobile, `WP-026` Native POS) instead assigns `01_Solution_Architect` as Specialist Reviewer, with `15_Web_Frontend_Developer`/`14_Mobile_Developer`/`16_Native_Edge_Developer` as builders. The EAAF framework itself is pinned externally (`7e036f43240b3dc28ccb996e350263598275b2cd`) and is not vendored into this repository, so its full role roster cannot be independently confirmed from local files. **This candidate adopts the role name as instructed by the Coordinator** (the substantive separation of concerns — an architect authors, a builder implements, neither self-reviews — is sound regardless of the exact label, and matches this project's existing EAAF pattern), but flags plainly that the specific identifier `05_Frontend_Architect` is unverified against local repository precedent. If the Coordinator's authority for this label traces only to the external framework pin, that should be confirmed explicitly before independent review proceeds; it does not change the substance of the remediation.
2. **Visual System, Frontend Architecture, and Implementation were not distinguished (`QI-015-08`, related).** Corrected in Sections I and R: visual-system canonicalization hard-blocks *implementation* of the Design System / UI work packages, but does not block `05_Frontend_Architect` from authoring routing/state/session/API-boundary/caching/offline/error architecture, which has no visual dependency.
3. **`ARCH-ADV-013-01` was stated as "could not be located" (`QI-015-12`) — this was wrong, and is corrected here.** Independently re-verified this round: the advisory exists at `evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md` (commit `09f034b3749148ba1fb4a812b01e9f7dc365eb45`, branch `review/acr-2026-013-r1-platform-architecture`, reviewer `10_DevOps_Platform_Architect`). Its exact text (Section 2.8, line 132–134): *"Prior to launching `WP-016`, the line in `IMPLEMENTATION_PLAN.md` must be updated to: `Bounded Context: TRIDENTPOS (Downstream Event Consumer: Finance)`"*, classified **`NON-BLOCKING ADVISORY` (for `ACR-2026-013 R1`'s own approval)** — i.e. it did not block that ACR, but it does gate `WP-016` START specifically. The prior candidate's `QI-015-12` finding ("no such document exists") is retracted and corrected in Section Z. See Section N.1.
4. **Package placement for `WP-014A`/`WP-016C` was deferred to implementation time.** This was avoidable: `ADR-013` Section 4.2's dependency matrix already explicitly lists **"Cobro POS (`pagos`)"** and **"Turnos de Caja (`turnos_caja`), Movimientos de Efectivo, Arqueos de Turno, Cortes X y Cortes Z"** as `@trident/pos` domain responsibilities — meaning both `WP-014A` and `WP-016C`'s package placement is already resolved by frozen architecture, not an open builder decision. Corrected in Sections G and H.

All findings preserved from the superseded candidate (`WP-014A` normalization, the `WP-016C` roadmap-gap grounding, the `pagos` idempotency gap, `CAP-OPS-07` ownership, the TRIDENTPOS→Finance event boundary, the `RESTCARD`/`CXC` first-slice exclusion, the Reservations exclusion, the exact 29→34 count, visual-state-as-projection, and the open status of all five protected PO questions) remain unchanged below.

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

### G.6 Package placement (resolved by frozen architecture, not deferred)

`ADR-013` Section 4.2's dependency-responsibility matrix already assigns `WP-016C`'s domain surface explicitly:

- **`@trident/pos`** (Capa 2, Business Domain, runtime deps `['@trident/core']` only): its frozen responsibility line already reads *"...Turnos de Caja (`turnos_caja`), Movimientos de Efectivo, **Cobro POS (`pagos`)**, Arqueos de Turno, Cortes X y Cortes Z... Puertos de repositorio y contratos de políticas."* `WP-016C`'s settlement domain logic (tender lines, idempotency check, settlement state machine, `CuentaPagada` emission) belongs here, alongside `WP-014A`'s dining-operations logic and `WP-016`'s existing shift logic — all three are the same bounded context and the same package.
- **`@trident/edge`** (Capa 3, Infra, allowed runtime deps `['@trident/core']` only — cannot depend on `@trident/pos`): owns generic technical primitives only — the physical card-terminal socket/driver I/O, following the same pattern already used for `WP-015`'s ESC/POS printer service. It must not contain settlement business rules.
- **`@trident/pos-edge-runtime`** (Capa 4, Composition Root, allowed deps `['@trident/core', '@trident/pos', '@trident/edge']`, explicitly "no posee lógica de negocio propia"): wires the `@trident/pos` settlement aggregate to the `@trident/edge` terminal adapter and to Fastify/IPC transport. This is where the abstract card-terminal adapter contract (G.2) is concretely wired, not where it is defined.

This placement requires no new package and no new implementation-time decision. If, during `WP-016C` implementation, a concrete requirement emerges that does not fit this matrix (e.g., a terminal SDK that cannot be cleanly isolated behind `@trident/edge`), that is an **`ARCHITECTURE DECISION REQUIRED`** event to be raised back to `01_Solution_Architect`/`03_Data_Architect` before the builder proceeds — it is not something the builder resolves unilaterally.

### G.7 Crash-recovery / idempotency risks (unchanged from drafts, now schema-grounded)

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

### H.6 Package placement (resolved by frozen architecture, not deferred)

`ADR-013` Section 4.2 already assigns `@trident/pos` (Capa 2, Business Domain) the responsibility "Salones, Mesas, Cuentas, Partidas (`cuenta_items`), Modificadores, Comandas de Piso... Puertos de repositorio y contratos de políticas (`CancellationPolicy`, `BillSplitProrationStrategy`)" — this already covers `WP-014A`'s full scope. No new package is required and no implementation-time package-placement decision is deferred to the builder. Any table/column additions `WP-014A` needs remain inside the existing `@trident/pos` domain package and its Edge SQLite persistence adapter in `@trident/pos-edge-runtime`, following exactly `WP-014`'s own established composition (ADR-013 Section 5.1).

### H.7 Acceptance direction

OCC remains enforced across all new table/account mutations; no lost updates; audit events are immutable; attention-signal projection never overwrites underlying domain state; precuenta/check-request transitions preserve `DEC-006`; transfer/split/cancel behavior implements zero implicit business-rule defaults.

---

## I. Proposed Frontend Decomposition

`WP-026` becomes a non-executable umbrella/milestone label for traceability. It is replaced, for execution purposes, by four atomic WPs — **but only after a Frontend Architecture Gate precedes the first of them.** This is an R1 correction (Section 0-R1 item 1): the superseded candidate made `16_Native_Edge_Developer` — a builder role, explicitly `BUILDER ONLY` and prohibited from architecture-by-implementation — responsible for authoring `FRONTEND_ARCHITECTURE.md`. That conflated architecture authorship with implementation and is corrected below.

### I.0 Required sequence — architecture precedes implementation

```text
ACR-2026-015 canonical
        ↓
05_Frontend_Architect authors FRONTEND_ARCHITECTURE.md candidate
   (routing, state management, session boundaries, API/IPC boundaries,
    client contract strategy, caching, offline presentation architecture,
    error architecture — all WITHIN the already-frozen React + Electron 30+
    + Tailwind CSS stack; see Section 0.2 — this step does not select
    the stack, it specifies how the stack is used)
        ↓
independent architecture review
   (fresh reviewer instance — NOT the same 05_Frontend_Architect
    session that authored the candidate; see Section V)
        ↓
FRONTEND ARCHITECTURE GATE (APPROVED / FROZEN)
        ↓
WP-026A implementation (16_Native_Edge_Developer, builder only,
   consumes the frozen FRONTEND_ARCHITECTURE.md — does not define it)
```

`FRONTEND_ARCHITECTURE.md` is a **governance artifact / architecture prerequisite gate, not an executable Work Package.** It does not appear in the WP count (Section S) — this preserves the exact 29 → 34 accounting the superseded candidate already established; only `WP-014A`, `WP-016C`, `WP-026A`, `WP-026B`, `WP-026C`, `WP-026D` are counted as executable WPs.

**Verification caveat (repeated from Section 0-R1 for visibility):** `05_Frontend_Architect` has no precedent anywhere in this repository's verified history (13 prior ACR identifiers, 15 completed Work Packages — see Section 0-R1) — every existing frontend/presentation WP (`WP-024`, `WP-025`, `WP-026`) used `01_Solution_Architect` as Specialist Reviewer instead. This candidate adopts the role name as instructed by the Coordinator, who may be drawing on the externally-pinned EAAF framework roster (not vendored in this repo and therefore not independently checkable here), while flagging that the label itself is unverified locally. If `05_Frontend_Architect` does not in fact exist in the pinned framework, the substantive requirement still stands: whichever role is used to author `FRONTEND_ARCHITECTURE.md`, it must not be `16_Native_Edge_Developer` or any other pure-builder role, and it must not review its own output.

### `WP-026A` — Native POS App Shell & Design System Foundation (implementation-only)
**Builder:** `16_Native_Edge_Developer` — builder only; does not author architecture
**Specialist Reviewer:** `01_Solution_Architect` (verifies implementation conforms to the already-frozen `FRONTEND_ARCHITECTURE.md`; does not re-litigate architecture decisions at this stage)
**Prerequisites:** `WP-007` (canonical); **`FRONTEND_ARCHITECTURE.md` APPROVED/FROZEN (Section I.0)** — this is a new, harder prerequisite than the superseded candidate stated. Does not require full domain completion of `WP-014A`/`WP-015`/`WP-016`/`WP-016C` — only their contract shapes.

Implementation scope, entirely within the already-frozen React + Electron 30+ + Tailwind CSS stack (Section 0.2) and entirely consuming decisions already made in the frozen `FRONTEND_ARCHITECTURE.md` rather than making them here: Electron renderer App Shell, routing implementation, approved state-management implementation, approved IPC/local-REST client implementation, auth/session presentation, OCC-409 UX infrastructure, error boundaries, shared component foundation, design tokens, responsive primitives, accessibility primitives. **All architectural choices must already exist in `FRONTEND_ARCHITECTURE.md` before this WP starts; none may be decided inside it.**

**Governing-document caveat (pre-existing, not created by this ACR):** `WP-026`'s own "Frozen Requirements" citation of `SOLUTION_ARCHITECTURE.md` Sec. 3 is stale — that section is "Manejo de Eventos en Cloud: In-Process vs. Durable Integration Outbox," unrelated to frontend architecture. This is exactly why the Frontend Architecture Gate above is necessary rather than optional: no frozen document currently elaborates renderer routing/state-management/component architecture in detail, and `WP-026A` cannot be the place that decision gets made, per the role-boundary correction in Section I.0. Flagged as a Coordinator citation-hygiene item on the existing `WP-026` entry, separate from and not blocking this ACR.

`WP-026A` (and, downstream, `WP-026B`/`WP-026C`/`WP-026D`) consume `docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` only after that spec is formally canonicalized (Section K, Section R). The Frontend Architecture Gate itself does **not** wait on visual-system canonicalization — see Section I.1.

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

### I.1 Visual System, Frontend Architecture, and Implementation are three distinct things (R1 correction)

The superseded candidate's Section R treated visual-system canonicalization as a blanket prerequisite for the entire frontend decomposition. That conflates three things that gate at different points:

| Layer | Gated by visual-system canonicalization? | Owner |
|---|---|---|
| **Frontend Architecture** — routing, state management, session boundaries, API/IPC boundaries, client contract strategy, caching, offline presentation architecture, error architecture | **NO** — none of these decisions depend on which visual language is chosen | `05_Frontend_Architect` (Section I.0) |
| **Visual System** — design tokens, component visual language, `TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` canonicalization | N/A — this *is* the thing being gated | `06_UX_UI_Design_Architect` |
| **Production Frontend Implementation** (`WP-026A`–`D`) — actually building screens | **YES, hard gate** — cannot render a canonical visual language that doesn't exist yet | `16_Native_Edge_Developer` et al., builders |

Required ordering: `05_Frontend_Architect` may author and gate `FRONTEND_ARCHITECTURE.md` in parallel with, and without waiting on, visual-system canonicalization. `WP-026A` implementation may not start until **both** `FRONTEND_ARCHITECTURE.md` is APPROVED/FROZEN **and** the visual system is canonicalized (Section R). This lets architecture work proceed without being artificially blocked by a design-governance task that has no bearing on it, while still hard-blocking implementation on both gates.

### I.2 Atomicity / independence check (per activation instructions Section 8)

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

See Section G.7. Restated as an explicit acceptance gate: `WP-016C` cannot pass independent review without a defined answer to "process crashes after external card-terminal authorization but before local durable persistence" — this is a data/security architecture decision, not a UI concern, and belongs in `WP-016C`'s own specialist review (`03_Data_Architect` + `08_Security_Architect`), not deferred to `WP-026D`.

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

### N.1 `ARCH-ADV-013-01` (R1 correction — this advisory exists and is preserved OPEN)

The superseded candidate (`7117308`) stated no distinct prior "WP-016 ownership advisory" could be located. That was incorrect and is corrected here after re-verification:

- **Advisory:** `ARCH-ADV-013-01`
- **Source:** `evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md`, Section 2.8, independently verified at commit `09f034b3749148ba1fb4a812b01e9f7dc365eb45` on branch `review/acr-2026-013-r1-platform-architecture` (reviewer: `10_DevOps_Platform_Architect`)
- **Exact finding:** `IMPLEMENTATION_PLAN.md` line 649 labels `WP-016`'s Bounded Context as `TRIDENTPOS / Finance`. The review established that all of `WP-016`'s physical tables (`turnos_caja`, `movimientos_caja`, `cortes_caja`, `arqueos_ciegos`) belong strictly to TRIDENTPOS (`MOD-POS`); Finance is only an asynchronous event subscriber to `CorteZGenerado`. The slash notation is a legacy label describing downstream consumption, not shared ownership.
- **Required remediation (per the advisory itself, quoted exactly):** *"Prior to launching `WP-016`, the line in `IMPLEMENTATION_PLAN.md` must be updated to: `Bounded Context: TRIDENTPOS (Downstream Event Consumer: Finance)`."*
- **Classification in its own source review:** `NON-BLOCKING ADVISORY` — this means it did not block `ACR-2026-013 R1`'s own approval. It is a distinct question from whether it blocks `WP-016` START, which the advisory's own remediation text answers: yes, prior to launch.

**This ACR's disposition:** `ARCH-ADV-013-01` = **OPEN ADVISORY**. It **BLOCKS `WP-016` START** (the `IMPLEMENTATION_PLAN.md` line-649 label must be corrected first, per its own remediation text) and it **DOES NOT BLOCK `ACR-2026-015` REVIEW** (this ACR proposes `WP-016C` as a sibling that inherits whatever bounded-context label `WP-016` carries at the time `WP-016C` actually starts; `WP-016C`'s own ownership analysis in Section G.1 is independently grounded in `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 and does not depend on `WP-016`'s label being corrected first). **This ACR does not close `ARCH-ADV-013-01`** — that requires the Coordinator/PO to authorize the actual `IMPLEMENTATION_PLAN.md` edit, which is outside this ACR's file scope (Section 0-R1, "no canonical architecture docs" constraint).

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

See Section I. Net effect: no new technology selection; a formalization gap is identified — but, per the R1 correction, that gap is closed by a dedicated `05_Frontend_Architect`-authored `FRONTEND_ARCHITECTURE.md` gate **before** `WP-026A` starts, not by `WP-026A` itself. `WP-026A` also carries a note to flag (not fix) the stale `SOLUTION_ARCHITECTURE.md` Sec. 3 citation on the existing `WP-026` entry, as a documentation-hygiene item the Coordinator should action independent of this ACR's approval.

## R. Visual System Governance Dependency

`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` **does not exist on canonical `main` at all** — verified via `git show f655551:docs/design`, which fails with "path exists on disk, but not in 'f655551'" (it exists only on the non-canonical `ab15b7d` preview commit). This is a stronger finding than either draft states (they describe it as "not yet canonical"; it is, more precisely, entirely absent from `main`).

**R1 correction to scope of this dependency (Section I.1):** visual-system canonicalization is a **hard prerequisite for implementation** — `WP-026A`/`WP-026B`/`WP-026C`/`WP-026D` may not build screens against it until it is canonical. It is **not** a prerequisite for `05_Frontend_Architect` to author or gate `FRONTEND_ARCHITECTURE.md` (routing, state, session, API/IPC boundaries, caching, offline presentation architecture, error architecture) — none of those decisions require a visual language to already exist. The two gates (Frontend Architecture, Visual System) may proceed in parallel; both must be satisfied before `WP-026A` implementation starts.

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

### V.1 Reviewers of this ACR candidate itself

Because this ACR changes frontend execution architecture (the `WP-026` decomposition and the new Frontend Architecture Gate in Section I), its own independent review panel must include a frontend-architecture perspective, not only the per-WP reviewers below:

- `01_Solution_Architect` — architecture boundaries, DAG, dependency correctness
- `03_Data_Architect` — settlement persistence, `pagos` idempotency gap, Money/data invariants
- `05_Frontend_Architect` — **added in R1**; validates that the Frontend Architecture Gate (Section I.0), the architecture/implementation role boundary, and the visual-system/frontend-architecture distinction (Section I.1) are correctly specified (subject to the verification caveat in Section I.0 — see also Section 0-R1 item 1)
- `06_UX_UI_Design_Architect` — frontend decomposition consistency with approved UX/Visual System
- `08_Security_Architect` — payment adapter boundaries, `WP-016C` crash/retry security concerns

Fresh sidecar instances only. None may be the same session that authored this document.

### V.2 Reviewers of downstream implementation WPs

| WP | Specialist Reviewer(s) | Code Reviewer | Rationale |
|---|---|---|---|
| `WP-014A` | `01_Solution_Architect` or `03_Data_Architect` | `11_Code_Reviewer` | Domain/persistence extension of existing `WP-014` |
| `WP-016C` | `03_Data_Architect` + `08_Security_Architect` | `11_Code_Reviewer` | Payment adapter, idempotency, credentials |
| `FRONTEND_ARCHITECTURE.md` (gate, not a WP) | Independent `05_Frontend_Architect` review, fresh instance | N/A (no code yet) | Architecture-only artifact; author must not review own output (Section I.0) |
| `WP-026A` | `01_Solution_Architect` | `11_Code_Reviewer` | Verifies implementation conforms to the already-frozen `FRONTEND_ARCHITECTURE.md`; does not re-decide architecture |
| `WP-026B` | `06_UX_UI_Design_Architect` + `01_Solution_Architect` | `11_Code_Reviewer` | UX consistency + architecture boundary |
| `WP-026C` | `01_Solution_Architect` | `11_Code_Reviewer` | Contract-consumption boundary only |
| `WP-026D` | `01_Solution_Architect` + `08_Security_Architect` | `11_Code_Reviewer` | Payment/terminal UI security surface |

**No reviewer above may be the same individual/session that authored this ACR candidate.** `01_Solution_Architect` reviewer instances for `WP-014A`/`WP-026A`/`WP-026B`/`WP-026C`/`WP-026D` must be fresh, independent sidecar sessions, per Section W. **The `05_Frontend_Architect` instance that authors `FRONTEND_ARCHITECTURE.md` must not be the same instance that reviews it** — this is the specific self-approval failure mode Section 6 of the activation instructions (and `QI-015-11`) exists to prevent, and it applies to the architecture gate exactly as it applies to this ACR.

---

## W. Acceptance Criteria for This ACR

This candidate may proceed to Product Owner approval only after independent reviewers verify:

1. No bounded-context runtime dependency violation (verified in this candidate: none proposed; `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 already governs the TRIDENTPOS→Finance event boundary — see Section G.1).
2. `WP-014A` is additive and does not mutate `WP-014`'s frozen, merged definition.
3. `WP-016C`'s necessity and ownership are independently re-derived from `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3, `CAPABILITY_MAP.md` `CAP-OPS-07`, and `DATA_AUTHORITY_MATRIX.md`'s Pagos row — not merely accepted because the draft asserted it.
4. `WP-026A`–`D` boundaries are atomic and independently reviewable (Section I.2).
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
→ Coordinator Quick Integrity (Section Z)          [R1: remediated 7117308 → this subject]
→ Candidate Subject SHA frozen
→ Independent Solution Review (fresh 01_Solution_Architect instance)
→ Independent Data Review (fresh 03_Data_Architect instance)
→ Independent Frontend Architecture Review (fresh 05_Frontend_Architect instance) [R1: added]
→ Independent Security Review (fresh 08_Security_Architect instance)
→ Independent UX/UI Review (fresh 06_UX_UI_Design_Architect instance)
→ Remediation if needed → new frozen subject if mutated
→ Product Owner Approval (this ACR: scope, WP count, exclusions — Section AA)
→ Architecture Change Gate PASS
   ├── (parallel, WP-016C/WP-014A/WP-026B-D specific, not required for this ACR's own PASS)
   │   05_Frontend_Architect authors FRONTEND_ARCHITECTURE.md
   │   → independent architecture review (different instance)
   │   → FRONTEND ARCHITECTURE GATE (APPROVED/FROZEN) — Section I.0
   │   └── required before WP-026A implementation START, not before this ACR's approval
   └── (parallel) Visual System canonicalization — Section R
       └── required before WP-026A-D implementation START, not before this ACR's approval
→ Merge Authorization (this ACR document only)
→ PR + CI checks
→ MERGE
→ CANONICAL
```

## Z. Coordinator Quick Integrity — Self-Check (Non-Binding; Coordinator Performs the Authoritative Pass)

As author, I am not authorized to declare this Quick Integrity binding — the activation instructions require the Coordinator to perform it. What follows is the evidence trail so the Coordinator's pass is fast to execute, not a self-issued PASS. **This table supersedes the Quick Integrity table in candidate `7117308`; two rows changed (`QI-015-08`, `QI-015-12`) per the Coordinator's R1 findings, re-verified rather than merely accepted — see Section 0-R1.**

| Check | Finding |
|---|---|
| `QI-015-01` False canonical claims | None found. All proposed WPs marked `PROPOSED`/non-canonical throughout. |
| `QI-015-02` Incorrect WP status claims | None found after verifying `WP-001`–`WP-016B` evidence files individually (Section B). |
| `QI-015-03` Incorrect WP count | Recomputed independently: 29 → 34, exact (Section S) — unaffected by R1 (`FRONTEND_ARCHITECTURE.md` is a gate, not a WP; Section I.0). |
| `QI-015-04` Hidden PO decision closure | None found; all five protected IDs remain absent from `PRODUCT_DECISIONS.md` (Section E.5). |
| `QI-015-05` Domain ownership violation | None found; `WP-016C` ownership re-derived from already-frozen Sec. 6.3, not invented (Section G.1); package placement now explicit per `ADR-013` §4.2, not deferred (Sections G.6, H.6). |
| `QI-015-06` Runtime dependency violation | None found; no TRIDENTPOS→Finance runtime call proposed, only event emission (Section G.1). |
| `QI-015-07` Payment idempotency omission | Addressed explicitly and grounded in a real pre-existing schema gap (Section G.3). |
| `QI-015-08` Frontend architecture assumption unsupported | **CORRECTED IN R1 — now PASS.** Superseded candidate conflated two distinct issues: (a) React/Electron/Tailwind ARE frozen (WP-026 dependency line) — this was already correctly stated; but (b) it assigned `FRONTEND_ARCHITECTURE.md` authorship to `16_Native_Edge_Developer`, a builder role, which is architecture-by-implementation and was wrong. Fixed: authorship moved to `05_Frontend_Architect` (subject to the verification caveat in Section I.0), `WP-026A` retitled and scoped as implementation-only, a Frontend Architecture Gate inserted before it, and the Visual-System/Frontend-Architecture/Implementation distinction made explicit (Section I.1). |
| `QI-015-09` Reservations silently added to scope | None found; explicitly excluded, on stronger grounds than the drafts state (Section P). |
| `QI-015-10` Preview treated as architecture authority | None found; preview cited only as product/requirements evidence throughout (Sections C, R). |
| `QI-015-11` Invalid reviewer self-approval | N/A at this stage (no review has occurred); Section V explicitly prohibits it going forward, including for the new `FRONTEND_ARCHITECTURE.md` gate (its `05_Frontend_Architect` author must not also review it). |
| `QI-015-12` Existing WP-016 advisory ignored | **CORRECTED IN R1 — now PASS.** The superseded candidate's "no such document exists" finding was itself wrong. The advisory is `ARCH-ADV-013-01` (`evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md`, commit `09f034b3749148ba1fb4a812b01e9f7dc365eb45`, independently re-verified this round), correctly identified, preserved OPEN, and correctly gates `WP-016` START without gating this ACR's own review (Section N.1). |

**No item above resolves to FAIL.** Recommended Coordinator disposition: **PASS**, proceed to independent review, subject to one open verification item this candidate cannot resolve locally: whether `05_Frontend_Architect` is in fact a role defined in the pinned EAAF framework (`7e036f43240b3dc28ccb996e350263598275b2cd`), since it has no precedent in this repository's own history (Section I.0). This does not gate `QI-015-08` to FAIL — the substantive role-boundary fix is sound regardless of the exact label — but the Coordinator is better positioned than this candidate to confirm the label against the framework directly.

---

## AA. Product Owner Approval Block

**Decision:** `APPROVED BY PRODUCT OWNER`. *(Corrected by `ACR-2026-015` Canonical Amendment R3 — CA-QI-015-31/`GOV-BLK-015-R2-01`: this section previously and incorrectly read `Decision: PENDING` with all checkboxes unchecked, contradicting the document's own top banner and the canonical amendment's actual governance status. The Product Owner approval is real and already recorded as durable evidence; this section previously failed to reflect it.)*

**Approval Evidence:** `3808c25285018888d5f31113cab64cdca4192c31:evidence/ACR-2026-015_R1_PRODUCT_OWNER_APPROVAL.md` (sidecar commit, not present in this candidate's tree).

- [x] `WP-014A — Dining Operations Expansion` (including the merge-table caveat, Section H.5)
- [x] `WP-016C — POS Payment Orchestration & Account Settlement` (including the RESTCARD/CXC exclusion, Section G.5)
- [x] `WP-026` decomposition into `WP-026A`–`WP-026D`
- [x] Reservations excluded from current Salón productization
- [x] Effective executable roadmap change 29 → 34
- [x] `WP-027` lifecycle update (Section U)
- [x] Visual-system canonicalization as a hard prerequisite for `WP-026A`–`D` implementation, but not for `05_Frontend_Architect`'s architecture work (Section R, I.1) — **added/clarified in R1**
- [x] Frontend Architecture Gate (`FRONTEND_ARCHITECTURE.md`, authored by `05_Frontend_Architect`, independently reviewed) required before `WP-026A` implementation START (Section I.0) — **added in R1**
- [x] 11 mandatory downstream conditions (`FE`/`DATA`/`UX`/`SEC-COND-015-0x`), binding, carried forward as Acceptance Criteria on their named WP entries

**Explicitly NOT approved / NOT closed by this approval** — all remain separate, OPEN Product Owner decisions:
- `OQ-SSOT-01`
- `OQ-SSOT-02`
- `OQ-SSOT-06`
- `OQ-SSOT-07`
- `OQ-ARCH-01`

**`ARCH-ADV-013-01`:** `CLOSED BY CANONICAL MERGE` (unchanged by this approval block itself, which predates the merge; current disposition corrected post-merge — GOV-HYGIENE-015-POST-01; the required `WP-016` `Bounded Context` correction is present on canonical `main` as of merge `456f75e854d62012af899cd2a467446375e5d65f`; see Section N.1 and Section AB).

Protected functional questions (`OQ-SSOT-01/02/06/07`, `OQ-ARCH-01`) are not approved through this block and remain separate PO decisions.

---

## AB. Current Draft Verdict

*(Corrected by `ACR-2026-015` Canonical Amendment R3 — CA-QI-015-32/`GOV-BLK-015-R2-01`: this section previously described a pre-review draft state ("PROPOSED — PENDING INDEPENDENT REVIEW", "Ready for: INDEPENDENT ARCHITECTURE REVIEW"), which contradicted the document's own top banner and the canonical amendment candidate's actual then-current lifecycle state. That R3 correction is preserved as history below. The lifecycle block itself has since been updated a second time, post-merge — GOV-HYGIENE-015-POST-01 — to reflect that R3 was independently reviewed, gated, and actually merged.)*

```text
ACR-2026-015
CURRENT LIFECYCLE STATUS: MERGED / CANONICAL ON MAIN

Product Owner:
APPROVED

Architecture Change Gate:
PASS

R3 Independent Specialist Reviews:
PASSED
5 / 5 PASS WITH ADVISORIES
0 blockers

Coordinator Synthesis:
PASS

Code Review Gate:
PASS

PR Gate:
PASS

PR:
#43

PR State:
MERGED

Merge Authorized:
YES

Merge Executed:
YES

Merge SHA:
456f75e854d62012af899cd2a467446375e5d65f

Post-Merge CI:
PASS — Run 35118372527

Post-Merge Security:
PASS — Run 35118372536

Independent Post-Merge Validation:
PASS

Post-Merge Validation Sidecar:
0242f5db5f368ef9b4110b40c0fb227af880f188

Final Lifecycle Status:
DONE / CANONICAL

Superseded subjects (historical, DO NOT REVIEW):
7117308df6db9e0a1f9fcb87aa365da541549695 (pre-R1)
269ca1eddd8b2fecd124b3b337e7d88c4018f254 (canonical-amendment, pre-R1-remediation)
214b68054daf60c78a28434fd42106f0fab1dae3 (canonical-amendment R1)
67970cfdcf5971ae2a1f41386d0a253268705083 (canonical-amendment R2)
38bf3449b2ebd5b03a86911996918ada343cd951 (canonical-amendment R3 — merged Frozen Subject, superseded by the merge commit above as the tip of history, preserved here as the exact PR #43 head)

Canonical main mutated:
YES — by the merge above (456f75e854d62012af899cd2a467446375e5d65f)

Implementation Plan mutated:
YES, as part of this canonical merge (see `IMPLEMENTATION_PLAN.md`
current ACR-2026-015 status). Module Catalog / Capability Map /
Product Scope / Product Decisions / Open Questions / ADRs: NOT
mutated by this merge.

Protected PO decisions closed:
NO — all five (`OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`, `OQ-SSOT-07`,
`OQ-ARCH-01`) remain OPEN, unchanged by this merge.

ARCH-ADV-013-01:
CLOSED BY CANONICAL MERGE
```
