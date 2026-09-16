# ACR-2026-015 — CANONICALIZATION EVIDENCE

> This is durable **merged** governance evidence for the `ACR-2026-015` canonical amendment. It references the full governance lineage by exact commit SHA. **Canonicalization is COMPLETE.** PR `#43` merged this amendment into canonical `main` at merge commit `456f75e854d62012af899cd2a467446375e5d65f`; post-merge CI (`PASS` — run `35118372527`) and post-merge Security Scan (`PASS` — run `35118372536`) both passed against that exact merge commit; an independent Post-Merge Validation sidecar (`PASS`, evidence commit `0242f5db5f368ef9b4110b40c0fb227af880f188`) confirmed the merge topology, scope, and roadmap result. *(Corrected by `ACR-2026-015` Canonical Amendment R2 — CA-QI-015-28: the prior wording "durable, merged governance evidence" falsely asserted a current-state merged status this candidate did not yet have at that time. That correction is preserved as history; the statement is now true as current-state fact, post-merge — GOV-HYGIENE-015-POST-01.)*

## Governance Lineage (Exact SHAs)

| Stage | Commit / Branch |
|---|---|
| Canonical Baseline | `f655551085dea3cff887a411adec4026842aed07` (`main`) |
| Frozen ACR Subject (R1) | `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` (`architecture/acr-2026-015-salon-productization`) |
| Superseded Subject (HOLD, do not review) | `7117308df6db9e0a1f9fcb87aa365da541549695` |
| Solution Architecture Review | `4903c26a96f2506a920c0e29159d89ec0bb11fd6` (`review/acr-2026-015-r1-solution`) |
| Data Architecture Review | `a40b7cf0d8ba15d3cbf2e1544a0cfc23f919577a` (`review/acr-2026-015-r1-data`) |
| Frontend Architecture Review | `0bdecfb9b8662e641c8f63ac0e22855f5168746e` (`review/acr-2026-015-r1-frontend`) |
| UX/UI Design Architecture Review | `1860dde7ee1c01a18bc8245fb8887aa24fe0caf4` (`review/acr-2026-015-r1-ux-ui`) |
| Security Architecture Review | `478055614f283d3f921ef8bf94ac42b93795fab1` (`review/acr-2026-015-r1-security`) |
| Coordinator Synthesis | `8fc490f3df1945c21f3a651767618d6cf133e1ad` (`review/acr-2026-015-r1-coordinator-synthesis`) |
| Product Owner Approval | `3808c25285018888d5f31113cab64cdca4192c31` (`review/acr-2026-015-r1-product-owner-approval`) |
| Architecture Change Gate | `5ccce65262c8e98b82fc6ae08466da4b9de288f8` (`review/acr-2026-015-r1-architecture-change-gate`) |

All eight sidecar commits above are direct children of the Frozen ACR Subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`; none descends from another. This candidate branch (`architecture/acr-2026-015-canonical-amendment`) is a direct child of canonical `main` (`f655551085dea3cff887a411adec4026842aed07`) — it does not descend from, cherry-pick, or merge any sidecar branch. The approved architecture substance of `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` and `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` originates from Frozen Subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`. The canonical-amendment candidate preserves that approved architecture substance while applying Coordinator-authorized governance/hygiene corrections and current-state metadata corrections across its remediation rounds (R1, R2, R3) — SHA-qualification of sidecar evidence references, correction of factual ACR/WP history counts, correction of stale ACR-2026-013/ACR-2026-014 current-state metadata, and (R3) correction of contradictory current-state governance verdicts in the ACR's own Sections AA/AB. No approved architecture decision or protected Product Owner decision was changed by any of these corrections. `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` specifically remains byte-identical to the Frozen Subject's tree except for its initial metadata-only status-line update (untouched by R1, R2, and R3). *(Corrected by `ACR-2026-015` Canonical Amendment R2 — CA-QI-015-29: the prior "copied verbatim... metadata-only" wording no longer accurately described `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` after R1's hygiene corrections.)*

**The only `ACR-2026-015` evidence file actually carried into this candidate's tree is this file, `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md`.** Every other `ACR-2026-015` evidence reference in this candidate (Coordinator Synthesis, Product Owner Approval, Architecture Change Gate) is a sidecar commit that exists only on its own review branch and is cited here and elsewhere by exact `<sha>:<path>` reference — never copied, cherry-picked, or merged into this tree.

## Review Results Summary

| Review | Verdict | Blockers | Advisories |
|---|---|---|---|
| Solution | PASS WITH ADVISORIES | 0 | 4 |
| Data | PASS WITH ADVISORIES | 0 | 3 |
| Frontend | PASS WITH ADVISORIES | 0 | 5 |
| UX/UI | PASS WITH ADVISORIES | 0 | 3 |
| Security | PASS WITH ADVISORIES | 0 | 4 |
| **Total** | **5/5 PASS WITH ADVISORIES** | **0** | **19** |

Explicit determinations: `WP-016C` = DATA-SOUND; `WP-014A` persistence proposal = DATA-SOUND; no unresolved HIGH-severity security design issue found silently absent; frontend architecture/implementation separation confirmed as a genuine structural fix (`QI-015-08` resolved); preview treated only as product evidence throughout, no business rule silently blessed via UX review.

## Coordinator Synthesis

Verdict: `PASS WITH MANDATORY DOWNSTREAM CONDITIONS`. All 19 raw advisories classified (3 Closed by Coordinator Verification, 1 Mandatory Before WP Start, 9 Mandatory Acceptance Criteria, 5 Documentation/Hygiene, 1 Future Governance Improvement). Full classification and per-advisory citation: `8fc490f3df1945c21f3a651767618d6cf133e1ad:evidence/ACR-2026-015_R1_COORDINATOR_SYNTHESIS.md` (sidecar commit; not present in this candidate's tree — see Governance Lineage table above).

## Product Owner Approval

Approved: `WP-014A`; `WP-016C`; the `WP-026` → `WP-026A`–`D` decomposition; the roadmap change 29 → 34; the Reservations exclusion; all 11 mandatory downstream conditions (binding). Explicitly preserved OPEN: `OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`, `OQ-SSOT-07`, `OQ-ARCH-01`. Full text: `3808c25285018888d5f31113cab64cdca4192c31:evidence/ACR-2026-015_R1_PRODUCT_OWNER_APPROVAL.md` (sidecar commit; not present in this candidate's tree — see Governance Lineage table above).

## Architecture Change Gate

Verdict: `PASS`. Authorization: prepare canonical amendment candidate only — not canonical, not merged, no WP start authorized. Full evidence: `5ccce65262c8e98b82fc6ae08466da4b9de288f8:evidence/ACR-2026-015_R1_ARCHITECTURE_CHANGE_GATE.md` (sidecar commit; not present in this candidate's tree — see Governance Lineage table above).

## The 11 Mandatory Downstream Conditions (Binding, Carried Into `IMPLEMENTATION_PLAN.md`)

Each condition below is now bound as an explicit Acceptance Criterion on its named WP entry in `IMPLEMENTATION_PLAN.md` (this candidate branch), not left as a free-floating advisory:

| Condition | Bound to | Requirement |
|---|---|---|
| `FE-COND-015-01` | Frontend Architecture Gate (pre-`WP-026A`) | `FRONTEND_ARCHITECTURE.md` must define component-library technical architecture, primitive/component boundaries, variant/composition strategy, and design-token consumption mechanism |
| `FE-COND-015-02` | `WP-026A` | Must consume, not invent, approved architecture for routing/state/session/IPC/caching/offline/error/component/token-consumption architecture |
| `FE-COND-015-03` | `WP-026B` | Must explicitly state NO BUSINESS RULE AUTHORITY IN UI |
| `DATA-COND-015-01` | `WP-016C` | Atomic local settlement (`pagos` INSERT + `cuentas` transition + outbox event) under one governed transaction boundary |
| `DATA-COND-015-02` | `WP-016C` | Canonical payment idempotency via the proven `WP-012` pattern or an architecture-reviewed equivalent |
| `DATA-COND-015-03` | `WP-014A` | Specialist review must explicitly verify `cuentas.status` introduces no new authoritative value without approved architecture change |
| `UX-COND-015-01` | `WP-026A`–`D` | Post-canonicalization inheritance of 44×44 touch target, three named breakpoints, WCAG 2.2 AA, keyboard/focus, responsive reflow, reduced-motion — no blanket accessibility PASS claim until reduced-motion and remaining checks actually pass |
| `UX-COND-015-02` | `WP-026A`–`D` | Salón, KDS, and Caja consume one common visual/design-system governance |
| `SEC-COND-015-01` | `WP-016C` | Terminal credentials/secrets use the `WP-009` secure-storage pattern or approved equivalent; renderer storage, plaintext config, IPC-exposed payloads, source-controlled credentials explicitly forbidden |
| `SEC-COND-015-02` | `WP-016C` | Concrete crash-recovery/reconciliation protocol required, not merely a statement the risk was considered |
| `SEC-COND-015-03` | `WP-016C` | Payment settlement explicitly bound to operational audit evidence, reusing canonical audit primitives |

None of these 11 conditions is downgraded to optional anywhere in this candidate. They travel with their named WP entries and must be verified at each WP's own specialist review before that WP may pass.

## `ARCH-ADV-013-01` Disposition

**Status: `CLOSED BY CANONICAL MERGE.`** *(Current disposition corrected post-merge — GOV-HYGIENE-015-POST-01; previously read "REMEDIATED BY CANONICAL AMENDMENT CANDIDATE — NOT CLOSED YET", which was correct prior to merge and is preserved as history below.)*

The prior-authority verification for this correction: `evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md` (commit `09f034b3749148ba1fb4a812b01e9f7dc365eb45`, branch `review/acr-2026-013-r1-platform-architecture`, reviewer `10_DevOps_Platform_Architect`), Section 2.8, which explicitly required: *"Prior to launching `WP-016`, the line in `IMPLEMENTATION_PLAN.md` must be updated to: `Bounded Context: TRIDENTPOS (Downstream Event Consumer: Finance)`."* This candidate branch applied exactly that correction to `WP-016`'s entry in `IMPLEMENTATION_PLAN.md`.

This was **remediation on the candidate branch**, and `ARCH-ADV-013-01` is now formally closed: the candidate became canonical through PR `#43`'s independent review and approval, merging at `456f75e854d62012af899cd2a467446375e5d65f` — not by virtue of this evidence file existing. `WP-016`'s `Bounded Context: TRIDENTPOS (Downstream Event Consumer: Finance)` correction is present and canonical on `main` as of that merge, so `WP-016` START is no longer blocked by this advisory.

## Protected Product Owner Decisions — Confirmed Untouched

`PRODUCT_DECISIONS.md` and `OPEN_QUESTIONS.md` are not modified by this candidate (verified via `git diff --stat` against canonical `main`). All five protected identifiers remain OPEN:

| ID | Subject |
|---|---|
| `OQ-SSOT-01` | CancellationPolicy |
| `OQ-SSOT-02` | TransferValidationRule |
| `OQ-SSOT-06` | BillSplitProrationStrategy |
| `OQ-SSOT-07` | ModifierRecipeResolver |
| `OQ-ARCH-01` | Multi-cashier shift model |

## R2 Independent Canonical Amendment Reviews (Historical Evidence)

Five fresh, independent sibling review branches were created directly from R2 Frozen Subject `67970cfdcf5971ae2a1f41386d0a253268705083` (none descends from another; each verified via `git log -1 --format="%H %P"` to have exactly one commit with that exact single parent):

| Review | Branch | Commit | Verdict | Blockers | Advisories |
|---|---|---|---|---|---|
| Solution | `review/acr-2026-015-canonical-r2-solution` | `f1a13c4ac93777cd5c1d6e3f6f920d139f0b5d72` | PASS | 0 | 1 |
| Data | `review/acr-2026-015-canonical-r2-data` | `20479477d7199175b64b79050b5ae809d3d79cdd` | PASS | 0 | 2 |
| Frontend | `review/acr-2026-015-canonical-r2-frontend` | `813b389d2be065a88ed99a8ee521b76116c3f654` | PASS | 0 | 2 |
| UX/UI | `review/acr-2026-015-canonical-r2-ux-ui` | `3e8067cdbc8b4f2f61328721e02762a196386e99` | PASS | 0 | 2 |
| Security | `review/acr-2026-015-canonical-r2-security` | `ead9b0f6ca77fa708ae5b615e86e9ed74ba141e5` | PASS | 0 | 2 |

**5/5 PASS, 0 blockers, 9 advisories total.** The Coordinator did not accept advancement to PR on this basis alone: independent re-inspection of the R2 subject found a governance-integrity defect (`GOV-BLK-015-R2-01`, ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md Sections AA/AB carrying contradictory current-state verdicts vs. the document's own top banner) plus three of the nine advisories above warranted a direct fix rather than deferral. Canonical Amendment R3 remediates these; see below. **Because the Frozen Subject changes with R3, all five R2 review PASSes above become historical evidence only — they do not authorize R3.** R3 requires its own fresh, full independent review panel.

## R3 Remediation (Governance Metadata Only — No Architecture Substance Change)

R3 fixes, on the same candidate branch, on top of R2 subject `67970cfdcf5971ae2a1f41386d0a253268705083`:

- **`GOV-BLK-015-R2-01`:** `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` Section AA ("Product Owner Approval Block") previously read `Decision: PENDING` with every checkbox unchecked, and Section AB ("Current Draft Verdict") previously described a pre-review draft state ("PROPOSED — PENDING INDEPENDENT REVIEW"). Both directly contradicted the document's own top banner ("PRODUCT OWNER APPROVED / ARCHITECTURE CHANGE GATE PASSED") and the canonical amendment's actual governance history (R1 sidecar review, Product Owner approval, and Architecture Change Gate all already passed before this candidate existed). Both sections now state the actual current lifecycle state, with the real Product Owner approval evidence SHA cited and every checkbox reflecting what was actually approved. No protected PO decision was newly closed by this correction — `OQ-SSOT-01/02/06/07` and `OQ-ARCH-01` remain explicitly listed as NOT approved in the corrected Section AA.
- **Visual System prerequisite explicitness (from the R2 UX/UI review advisory):** `WP-026B`/`WP-026C`/`WP-026D`'s Prerequisites fields in `IMPLEMENTATION_PLAN.md` now explicitly list "canonical Visual System `APPROVED`/`FROZEN`" — this hard gate already existed in each WP's Frozen Requirements/Inputs/Acceptance Criteria but was not repeated in the machine/human-readable Prerequisites field. The Visual System itself remains NOT CANONICAL; this candidate does not create or approve it.
- **`WP-014A` audit sink (from the R2 Data review advisory):** `WP-014A`'s Acceptance Criteria now explicitly requires reuse of the canonical `local_audit_trail` sink (or an explicitly architecture-approved canonical successor/equivalent) for its audit events, closing the ambiguity about whether a second, parallel audit mechanism was permitted.
- **`DATA-COND-015-03` mechanical auditability (from the R2 Data review advisory):** strengthened from illustrative "e.g." examples to the complete, exact frozen `cuentas.status`/`mesas.status` enumerations (`DATA_MODEL.md` Sec. 3), so a reviewer can mechanically diff a migration's output against the exhaustive list rather than relying on named examples to catch a novel-named UI-only state.
- **Non-mutating advisories accepted/closed without candidate changes:** the `05_Frontend_Architect` role-precedent note (`CLOSED BY COORDINATOR VERIFICATION` — role confirmed to exist in the pinned EAAF framework at `agents/architecture/05_Frontend_Architect.md`, SHA `7e036f43240b3dc28ccb996e350263598275b2cd`); the sidecar-evidence-auditability note (`ACCEPTED GOVERNANCE PATTERN` — the candidate already uses exact `SHA:path` references); and `WP-016C`'s `SEC-COND-015-02` concrete crash-reconciliation protocol content (`INTENDED FUTURE ACCEPTANCE GATE, NOT A CANONICAL-AMENDMENT DEFECT` — correctly deferred to that WP's own future build-time specialist review).

No approved architecture substance was altered by R3. `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` was evaluated for contradiction and found to require no change — it remains untouched by R1, R2, and R3.

## Roadmap Count

Current canonical effective executable total: **29**. Candidate effective executable total: **34** (verified directly: `WP-001`–`WP-028` + `WP-016B` + `WP-014A` + `WP-016C` + `WP-026A`–`WP-026D` = 35 total `####`-level WP headers, of which exactly one — `WP-026` itself — is reclassified `NON-EXECUTABLE UMBRELLA / MILESTONE` and excluded from the executable count: 35 − 1 = 34). No existing WP is renumbered; `WP-026`'s identifier is preserved, only its title and classification changed.

## File Set of This Candidate (Complete)

| File | Change |
|---|---|
| `IMPLEMENTATION_PLAN.md` | Modified: new `WP-014A`, `WP-016C`, `WP-026A`–`D` entries; `WP-026` reclassified to umbrella; `WP-016`'s `Bounded Context` label corrected; `WP-027` prerequisites/lifecycle updated; new governance banner and Version/Status metadata |
| `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` | Added: approved architecture substance originates verbatim from frozen subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`; subsequently carries R1/R2/R3 Coordinator-authorized governance/hygiene corrections (SHA-qualified sidecar references, corrected ACR/WP history counts, corrected ACR-2026-013/014 current-state cross-references, R3 correction of Sections AA/AB contradictory current-state verdicts) — no architecture substance altered |
| `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` | Added (copied verbatim from frozen subject, metadata-only status update; untouched by R1/R2/R3) |
| `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` | Added (this file) |

**Not modified, evaluated and found unnecessary:** `MODULE_CATALOG.md` (`MOD-POS`'s existing purpose text already covers `WP-014A`/`WP-016C` responsibilities verbatim — `PagoCuenta` is already a listed aggregate); `CAPABILITY_MAP.md` (`CAP-OPS-01`, `CAP-OPS-05`, `CAP-OPS-06`, `CAP-OPS-07` already cover every atomic capability introduced; no duplication created); `PRODUCT_SCOPE.md` (Reservations is already absent from both its in-scope and out-of-scope lists; restating an absence was explicitly out of scope for this candidate).

**Not modified, protected:** `PRODUCT_DECISIONS.md`, `OPEN_QUESTIONS.md`.

**Not created by this candidate:** `FRONTEND_ARCHITECTURE.md` (a separate, later artifact authored by `05_Frontend_Architect` under its own independent review — recorded here only as a required governance gate in `IMPLEMENTATION_PLAN.md`); canonicalization of `docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` (remains non-canonical; verified absent from canonical `main` at the time of this candidate).

---

*This evidence file is carried by the canonical-amendment candidate branch `architecture/acr-2026-015-canonical-amendment`. It becomes merged governance evidence only if this candidate passes independent review, PR Gate, required checks, merge authorization, merge, and post-merge validation. It does not itself canonicalize anything, authorize any Work Package to start, close any protected decision, or modify `main`.*
