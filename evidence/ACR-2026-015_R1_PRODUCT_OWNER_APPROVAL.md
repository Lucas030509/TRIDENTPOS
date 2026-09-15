# ACR-2026-015 R1 — PRODUCT OWNER APPROVAL EVIDENCE

> This document is evidence only. It records a human governance decision. It does not itself canonicalize, merge, or authorize the start of any Work Package.

## Governance Authority

Product Owner, acting under the repository's Solo Maintainer Governance Model. This evidence file transcribes and records the Product Owner's explicit approval statement; it does not reinterpret, expand, or infer beyond what was stated.

## Framework

EAAF v1.2.0 @ `7e036f43240b3dc28ccb996e350263598275b2cd`

## Frozen Subject

`2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` (verified resolvable via `git cat-file -t`, confirmed a valid commit at the time this evidence was authored)

Canonical parent chain: `2c90a43...` → `7117308...` (superseded R0, HOLD) → `f655551085dea3cff887a411adec4026842aed07` (canonical `main`, unmodified by this ACR lineage).

## Coordinator Synthesis Reference

`8fc490f3df1945c21f3a651767618d6cf133e1ad` (verified resolvable via `git cat-file -t`; verified via `git log -1 --format="%H %P"` that its parent is exactly the Frozen Subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`). This approval evidence **references** the synthesis by commit SHA for traceability; it is not branched from it, and the synthesis commit is not merged or cherry-picked into this branch — this branch is a direct sibling sidecar of the Frozen Subject, confirmed by `git log -1 --format="%H %P"` on this branch's own HEAD (see commit metadata for this file).

## Exact Product Owner Statement

Transcribed verbatim, unaltered, not reinterpreted or expanded:

> "APRUEBO ACR-2026-015 R1 COMO PRODUCT OWNER, incluyendo WP-014A, WP-016C, la descomposición WP-026A-D, el cambio del roadmap de 29 a 34 WPs, la exclusión de Reservaciones de este alcance y las 11 condiciones downstream de la síntesis.
>
> Las decisiones PO protegidas permanecen OPEN."

## Approved Change Set

Approval applies only to the items the Product Owner's statement names, against Frozen Subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` and its Coordinator Synthesis `8fc490f3df1945c21f3a651767618d6cf133e1ad`:

**A. `WP-014A` — Dining Operations Expansion** — APPROVED BY PO

**B. `WP-016C` — POS Payment Orchestration & Account Settlement** — APPROVED BY PO

**C. Decomposition of executable `WP-026` into:**
- `WP-026A` — Native POS App Shell & Design System Foundation
- `WP-026B` — Salón & Ordering UI
- `WP-026C` — KDS Station UI
- `WP-026D` — Caja & Payment UI

APPROVED BY PO

**D. Effective executable roadmap change: 29 → 34 Work Packages.** No existing WP renumbering. APPROVED BY PO

**E. Reservations excluded from this productization scope.** APPROVED BY PO (confirmed as an exclusion, not a deferred inclusion)

**F. The 11 mandatory downstream conditions from Coordinator Synthesis `8fc490f3df1945c21f3a651767618d6cf133e1ad`** — APPROVED BY PO (accepted as binding, not as advisory-only)

## Mandatory Downstream Conditions (Accepted, Binding)

| Condition | Binds |
|---|---|
| `FE-COND-015-01` | `FRONTEND_ARCHITECTURE.md` must explicitly define component-library technical architecture, primitive/component boundaries, variant/composition strategy, and design-token consumption mechanism — before `WP-026A` may start |
| `FE-COND-015-02` | `WP-026A` must consume, not invent, approved architecture for routing/state/session/IPC/caching/offline/error/component/token-consumption architecture |
| `FE-COND-015-03` | `WP-026B` must explicitly state NO BUSINESS RULE AUTHORITY IN UI |
| `DATA-COND-015-01` | `WP-016C` must require atomic local settlement (`pagos` INSERT + `cuentas` transition + outbox event) under one governed transaction boundary |
| `DATA-COND-015-02` | `WP-016C` must implement the canonical payment idempotency requirement (proven `WP-012` pattern or architecture-reviewed equivalent) |
| `DATA-COND-015-03` | `WP-014A` specialist review must explicitly verify `cuentas.status` introduces no new authoritative value without an approved architecture change |
| `UX-COND-015-01` | Post-canonicalization, `WP-026A`–`D` acceptance criteria must explicitly inherit approved visual NFRs (44×44 touch target, three named breakpoints, WCAG 2.2 AA, keyboard/focus, responsive reflow, reduced-motion) — no blanket accessibility PASS claim until reduced-motion and remaining checks actually pass |
| `UX-COND-015-02` | Salón, KDS, and Caja must consume one common visual/design-system governance |
| `SEC-COND-015-01` | Terminal credentials/secrets must use the `WP-009` secure-storage pattern or an approved equivalent; renderer storage, plaintext config, IPC-exposed payloads, and source-controlled credentials are explicitly forbidden |
| `SEC-COND-015-02` | `WP-016C` must define a concrete crash-recovery/reconciliation protocol, not merely note the risk |
| `SEC-COND-015-03` | Payment settlement must bind explicitly to operational audit evidence (actor/station/timestamp/account/reference/tender lines), reusing canonical audit primitives |

These 11 conditions are accepted by this approval as **binding** on the named downstream Work Packages and gates. They are not re-litigated, re-worded, or narrowed here — this evidence file only records their acceptance; the conditions' authoritative text remains `evidence/ACR-2026-015_R1_COORDINATOR_SYNTHESIS.md` Sections 5–8.

## Explicit Non-Approvals

This approval does **not** approve, resolve, or imply a default for any of the following. All five remain **OPEN**:

| ID | Subject | Status |
|---|---|---|
| `OQ-SSOT-01` | CancellationPolicy | OPEN |
| `OQ-SSOT-02` | TransferValidationRule | OPEN |
| `OQ-SSOT-06` | BillSplitProrationStrategy | OPEN |
| `OQ-SSOT-07` | ModifierRecipeResolver | OPEN |
| `OQ-ARCH-01` | Multi-cashier shift model | OPEN |

The Product Owner's own statement explicitly closes with "Las decisiones PO protegidas permanecen OPEN" — this section restates that boundary in the required per-ID form; it introduces no scope the statement itself did not already draw.

## Protected Decisions Status

**NO protected Product Owner decision is closed by this approval.** The approval is scoped exactly to the six items (A–F) the Product Owner's statement names. Nothing in this document marks `OQ-SSOT-01/02/06/07` or `OQ-ARCH-01` as resolved, decided, defaulted, or parameterized-to-a-concrete-value.

## `ARCH-ADV-013-01` Status

**OPEN.** Continues to block `WP-016` START (the `IMPLEMENTATION_PLAN.md` line-654 `Bounded Context: TRIDENTPOS / Finance` label must still be corrected to `TRIDENTPOS (Downstream Event Consumer: Finance)` before `WP-016` may start). This Product Owner approval of `ACR-2026-015` R1 does not depend on, wait for, or invalidate `ARCH-ADV-013-01`'s resolution — the two are independent, exactly as established in Coordinator Synthesis Section 10.

## Canonicalization Status

**NOT CANONICAL.** No canonical document (`IMPLEMENTATION_PLAN.md`, `MODULE_CATALOG.md`, `CAPABILITY_MAP.md`, `PRODUCT_SCOPE.md`, `PRODUCT_DECISIONS.md`, `OPEN_QUESTIONS.md`, any ADR) is modified by this approval evidence, by the ACR, by the Coordinator Synthesis, or by any of the five independent reviews. `main` is unmodified — confirmed via `git diff --stat` from canonical `main` (`f655551085dea3cff887a411adec4026842aed07`) through this branch's HEAD, which shows only governance/evidence files added, zero canonical files touched.

## Merge Status

**NOT AUTHORIZED.** No PR exists for this branch, this ACR, or any reviewer/synthesis sidecar branch in this lineage. This approval does not create one and does not authorize one.

## Next Gate

**ARCHITECTURE CHANGE GATE.** Product Owner approval of the architecture change is a precondition for that gate, not the gate itself. This evidence does not execute the Architecture Change Gate.

This approval explicitly does **not** authorize the start of `WP-014A`, `WP-016C`, `WP-026A`, `WP-026B`, `WP-026C`, or `WP-026D`; does not approve `FRONTEND_ARCHITECTURE.md` (which does not yet exist as an artifact); and does not canonicalize the Visual System (`docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md`, still absent from canonical `main` as of this writing). Each of those remains a separate, later gate with its own required authorization.

## Final Product Owner Verdict

```text
PRODUCT OWNER VERDICT:
APPROVED

APPROVAL SCOPE:
ACR-2026-015 R1 ARCHITECTURE CHANGE

NEXT GATE:
ARCHITECTURE CHANGE GATE

CANONICAL:
NO

MERGE:
NOT AUTHORIZED
```

---

*This evidence file records a Product Owner governance decision against Frozen Subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`. It does not modify the ACR, the Productization Matrix, the Coordinator Synthesis, any canonical architecture document, or `main`. It does not create a PR. It does not merge.*
