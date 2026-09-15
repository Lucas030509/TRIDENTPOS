# ACR-2026-015 (R1) — Independent UX/UI Design-Architecture Review

**Reviewer Agent:** `06_UX_UI_Design_Architect`
**Frozen Subject SHA:** `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`
**Reviewer Branch:** `review/acr-2026-015-r1-ux-ui`
**Exact Parent (of Frozen Subject SHA):** `7117308df6db9e0a1f9fcb87aa365da541549695` (the R0/superseded candidate, placed on HOLD by the Coordinator; canonical `main` at that point was `f655551085dea3cff887a411adec4026842aed07`, confirmed as the merge-commit tip of `WP-016B`)

## Conflict-of-Interest Declaration

This reviewer did not author `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md`, `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md`, or either non-canonical draft that preceded them. This reviewer did not author the V4 UI preview (`design/ui-preview-pos-floor-v4-functional-salon` @ `ab15b7dad62a14a78f606b64f7fc7d27613f343a`) or its accompanying spec documents. No prior review pass by this reviewer identity exists on this ACR lineage. This is a fresh, independent sidecar review as required by ACR Section V.1/V.2 and Section W.

## Sources Inspected (Directly, Not Taken on Faith)

- `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` @ `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` (full text, both pages)
- `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` @ same SHA (full text)
- `git show ab15b7dad62a14a78f606b64f7fc7d27613f343a:docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md` (full text, 163 lines)
- `git show ab15b7dad62a14a78f606b64f7fc7d27613f343a:docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` (full text, 421 lines)
- `git show f655551085dea3cff887a411adec4026842aed07:docs/design` — confirmed **fails** ("path 'docs/design' does not exist"), independently verifying Section R's claim
- `DATA_MODEL.md` — frozen `mesas` DDL (line 878), `cuentas` DDL, `pagos` DDL (line 963), `outbox_queue` DDL, at the frozen subject
- `OPEN_QUESTIONS.md` — status banner and entries for `OQ-SSOT-01/02/03/06/07`, `OQ-ARCH-01`
- `PRODUCT_DECISIONS.md` — confirmed only `DEC-006` present among the protected identifiers, status `APROBADA`
- `CAPABILITY_MAP.md` — `CAP-OPS-07` entry and its ownership/priority row
- `DATA_AUTHORITY_MATRIX.md` — "Pagos & Transacciones de Cobro" row
- `FUNCTIONAL_ARCHITECTURE.md` Section 6.3
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md` Section 4.2
- `SOLUTION_ARCHITECTURE.md` Section 3 (to verify the ACR's "stale citation" claim)
- `IMPLEMENTATION_PLAN.md` — `WP-026` entry (line 959), header count (`grep -cE '^#### \`WP-0[0-9]{2}\`'` = 28), `WP-016B` entry
- `PRODUCT_SCOPE.md`, `CAPABILITY_MAP.md`, `MODULE_CATALOG.md`, `DATA_MODEL.md`, `IMPLEMENTATION_PLAN.md` — case-insensitive grep for `reservaci|reservation`
- `git show 09f034b3749148ba1fb4a812b01e9f7dc365eb45:evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md` — verbatim text of `ARCH-ADV-013-01` (Section 2.8)
- `git diff --stat f655551085dea3cff887a411adec4026842aed07..2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` — confirmed only the two evidence documents were added, zero canonical files touched

## Findings

### F1 — Preview correctly treated as product/design evidence, never architecture authority (PASS)
Sections A, C, R, and the Quick Integrity self-check (`QI-015-10`) consistently frame the V4 preview as non-canonical input. The preview spec itself (`TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md`) is unusually disciplined: it independently classifies every PDF-derived feature against canonical architecture, explicitly labels non-canonical states as `PREVIEW_ONLY`/`PREVIEW_*` fixtures, and states at line 15-16 "Nothing here should be read as resolving open architecture questions." No location in the ACR lets a preview *behavior* silently become an architectural decision — every place the preview is cited, it is cited as "requirements/product input only" (Section C) with the underlying canonical gap independently re-derived from frozen documents (schema, capability map, functional architecture), not from the preview. Verified independently.

### F2 — Visual State as Projection (Section E.3) is accurate, with one precision gap in the underlying evidence (ADVISORY)
Independently read the frozen `mesas` DDL (`DATA_MODEL.md` line 878-886): `status TEXT NOT NULL, -- DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA`. None of `EN_ATENCIÓN`, `POR_COBRAR`, `PREPARANDO`, `LISTO`, `SERVIDO`, or `RESERVADA` appear as literals — the ACR's specific claim in Section E.3 ("no such enum literals appear in the frozen `mesas` DDL") is **verified true**. The projection model (account-drawer/attention/status-projection, `computeVisualState()` in the preview, Section 4 of the functional preview spec) correctly keeps these as a read-model/event projection, not new authoritative `Mesa.status` values.
However: the non-canonical preview spec's own supporting claim ("`Mesa.status`: `DISPONIBLE` | `OCUPADA` (that's it — no canonical ... status exists yet)") **understates** the actual frozen enum, which has two additional literals (`EN_CUENTA`, `BLOQUEADA`) neither draft nor the ACR mentions or reconciles. This does not weaken the ACR's specific invariant (none of the preview-projected states collide with the actual four canonical literals either), but it is a precision gap in evidence-gathering the ACR did not catch despite an otherwise unusually rigorous verification discipline elsewhere in the same document. Non-blocking.

### F3 — Visual-system canonicalization dependency (Section R) — verified accurate
`git show f655551085dea3cff887a411adec4026842aed07:docs/design` independently confirmed to fail with "path 'docs/design' does not exist in 'f655551...'" — the path is entirely absent from canonical `main`, exactly as Section R states (and more precisely than either input draft, which described it only as "not yet canonical").

### F4 — `WP-026B` (Salón & Ordering UI) scope — coherent, correctly defers policy (PASS)
Scope (Section I, `WP-026B`) lists "transfer/split/cancel UI hooks" rather than transfer/split/cancel logic. Section H.3 explicitly binds `WP-014A` (`WP-026B`'s backend dependency) against closing `OQ-SSOT-01/02/06`, and the matrix (`docs/governance/...MATRIX.md` rows for "Mover mesa", "Dividir cuenta", "Cancelar cuenta/items") marks all three `BLOCKED SEMANTICS` pending PO decision. `WP-026B` consumes canonical contracts (`WP-014`/`WP-014A`) and does not itself define transfer/split/cancel business rules — it is UI-only, consistent with the ACR's own atomicity rule (Section I.2: "zero business/domain rule ownership inside any of the four").

### F5 — `WP-026C` (KDS Station UI) scope — coherent, explicit anti-invention clause present (PASS)
Section I states plainly: "KDS states sourced from canonical events/contracts only ... No independent KDS state machine may be invented in the renderer." This is an explicit, testable constraint, not merely implied. Prerequisites (`WP-026A`, `WP-015`) are correctly the app shell and the actual KDS backend, not `WP-014A` (dining ops) or `WP-016C` (payment), which would be a scope leak. Correctly scoped.

### F6 — `WP-026D` (Caja & Payment UI) scope — coherent, authoritative-logic exclusion is explicit (PASS)
Section I states: "No authoritative payment logic may reside only in frontend state." Prerequisites are `WP-026A`, `WP-016`, `WP-016C` — the actual shift and settlement backends. Reviewer pairing (`01_Solution_Architect` + `08_Security_Architect`, Section V.2) matches its actual risk surface (payment/terminal UI). Consistent with Section G.7's crash-recovery note that "Crash between external card-terminal authorization and local durable persistence must have a defined recovery path; cannot be solved in UI (`WP-026D`)" — correctly assigns that concern to `WP-016C`'s own specialist review, not to the UI WP.

### F7 — Action/state projection model is internally consistent across `WP-026B`/`C`/`D` (PASS)
The pattern is uniform: each of the three UI WPs sources its state exclusively from its corresponding canonical backend WP (`WP-014`/`WP-014A` for B, `WP-015` for C, `WP-016`/`WP-016C` for D), and Section I.2 states none of the four presentation WPs "define" contracts, only "consume" them. The `EN_ATENCIÓN`/`POR_COBRAR` projection model in E.3 is referenced consistently in the matrix's "Atención operacional" and "Solicitar cuenta / Por cobrar" rows, both routed to `WP-014A` (backend) / `WP-026B` (frontend) with the same "read-model projection, not `Mesa.status`" framing. No internal contradiction found between Section E.3, Section I, and the matrix document.

### F8 — Touch-target, responsiveness, and accessibility obligations are cited but NOT carried forward as binding acceptance criteria (ADVISORY — the most significant finding of this review)
The non-canonical `TRIDENTPOS_VISUAL_REFERENCE_SPEC.md` contains detailed, concrete NFR commitments: a 44×44px minimum touch target (`--touch-target-min`, Sections 8, 17), three named responsive breakpoints (1440×900, 1280×800, 1024×768, Section 16), and a WCAG 2.2 AA accessibility target with an explicit, honest gap disclosure (reduced-motion support does not exist yet, Section 18 — "AA is not declared as a blanket PASS"). The ACR references this document only structurally (Section R: canonicalization as a hard gate before `WP-026A`-`D` implementation) and once, in passing, inside `WP-026A`'s implementation-scope prose ("responsive primitives, accessibility primitives," Section I, `WP-026A` paragraph). Nowhere does the ACR:
- Restate the 44×44px touch-target minimum, the three responsive breakpoints, or the WCAG 2.2 AA target as an explicit obligation binding `WP-026B`/`WP-026C`/`WP-026D` specifically (as opposed to only `WP-026A`'s "primitives");
- Carry forward the visual spec's own disclosed gap (no `prefers-reduced-motion` support) as a tracked follow-up item anywhere in Section W (Acceptance Criteria, 12 items — none reference touch/responsive/accessibility) or Section AA (PO Approval Block, 9 checkboxes — none reference it either).
Given that Section R correctly treats visual-system canonicalization as a hard prerequisite gate, it is a real gap that the *substantive* NFR content of that same spec (not just its existence as a canonicalized artifact) is not explicitly re-asserted as a requirement for the implementation WPs. Absent an explicit binding, there is a real risk this content is dropped between "the visual spec is canonicalized" and "`WP-026B`/`C`/`D` actually get built," since only `WP-026A` (app shell/primitives) mentions it at all. This should be corrected before Product Owner approval, but does not rise to a FAIL: nothing in the ACR *removes* or *contradicts* these obligations, and canonicalizing the source document (Section R) does technically make them available to future reviewers/builders — the gap is one of an insufficiently explicit acceptance-criteria binding, not a suppression.

### F9 — Reservations correctly excluded, with one minor grep-precision caveat (PASS, non-blocking caveat)
Independently ran `grep -ni "reservaci|reservation"` across `PRODUCT_SCOPE.md`, `CAPABILITY_MAP.md`, `MODULE_CATALOG.md`, `DATA_MODEL.md`, `IMPLEMENTATION_PLAN.md`. One raw substring hit occurs: `DATA_MODEL.md:908: -- Items en Cuenta (Preservación de Snapshot Económico Inmutable) (REM-10)` — this is a false positive (the Spanish word "Preservación" contains "reservaci" as a substring; it means "preservation of an immutable economic snapshot," unrelated to table/dining reservations). The ACR's substantive claim ("zero matches," Section 0.7, Section P) is correct in *meaning* (no table/dining reservation capability exists anywhere in canonical scope) but a literal "zero matches" is not what a raw grep returns. This is a documentation-precision nit, not a substantive error — re-reading the one hit confirms it is unrelated to the Reservations capability, and Reservations are genuinely excluded (Section H.2 explicit non-scope, Section O, Section P, and the matrix's row 27 "Reservaciones ... OUT OF CURRENT ARCHITECTURE"). No evidence anywhere in this ACR that Reservations are being productized under a different name.

### F10 — No business rule is silently blessed through the UX/UI lens (PASS)
`WP-026B`'s UX/UI specialist reviewer assignment (`06_UX_UI_Design_Architect` + `01_Solution_Architect`, Section V.2) is scoped to "UX consistency + architecture boundary," not to the underlying cancellation/transfer/split-proration policies, which the ACR repeatedly and explicitly keeps open (Section N, Section H.3, Section H.5, matrix rows marked `BLOCKED SEMANTICS`). The ACR does not ask a UX/UI reviewer to approve or imply a default for `OQ-SSOT-01/02/06/07` or `OQ-ARCH-01`; Section E.5 and Section W item 5 make this an explicit acceptance gate re-verified independently against `PRODUCT_DECISIONS.md` (only `DEC-006` present) and `OPEN_QUESTIONS.md` (all five still listed `OPEN`). This reviewer independently re-confirms all five identifiers remain open and does not evaluate their eventual resolution, per the reviewer's own scope boundary.

### F11 — `WP-026` → `WP-026A`-`D` decomposition preserves single-system UX intent, not "two apps" (PASS, with a note)
Section I.2 states the four are independently testable and may parallelize once their own prerequisites are canonical, "they must not be artificially serialized behind each other" — this addresses execution independence without fragmenting the *product* experience: all four consume the same `FRONTEND_ARCHITECTURE.md` gate and the same canonicalized visual system (Section I.1), which is the mechanism that keeps Salón/KDS/Caja as one coherent visual/interaction system rather than three divergent ones. This is architecturally sound. Note: this coherence guarantee depends entirely on F8 being corrected (i.e., on the shared visual/NFR obligations actually being bound to all three UI WPs, not just referenced once under `WP-026A`) — if F8 is left uncorrected, the "one system, not two apps" guarantee is weaker than the ACR's stated intent, because nothing textually forces `WP-026B`/`C`/`D` to inherit the same touch/responsive/accessibility bar `WP-026A` is asked to establish.

### F12 — Every spot-checked factual claim in the ACR against frozen canonical documents was accurate
Independently re-verified and confirmed exact/verbatim: `pagos` DDL (no idempotency key column, `turno_caja_id NOT NULL`, `payment_method` enum including `RESTCARD`/`CXC`); `ADR-013` §4.2 `@trident/pos` responsibility line (verbatim match to Sections G.6/H.6's quoted text); `FUNCTIONAL_ARCHITECTURE.md` §6.3 (verbatim match to Section G.1's quoted text); `CAPABILITY_MAP.md` `CAP-OPS-07` (Owner/Consumer TRIDENTPOS, P0); `DATA_AUTHORITY_MATRIX.md` Pagos row ("Append-Only + Idempotency Key"); `SOLUTION_ARCHITECTURE.md` Section 3 (confirmed unrelated to frontend architecture, exactly as the "stale citation" flag states); `WP-026` dependency line (`Electron 30+`, `React`, `Tailwind CSS`, confirmed already frozen); the exact 28-header + `WP-016B` = 29 count (`grep -cE` independently reproduced); `ARCH-ADV-013-01`'s exact quoted remediation text (verbatim match against `evidence/ACR-2026-013_R1_PLATFORM_ARCHITECTURE_REVIEW.md` at the cited commit); `git diff --stat` confirming zero canonical files were touched by this candidate. No fabricated or misrepresented canonical claim was found anywhere in the document.

## Blocking Findings Count

**0**

## Advisories Count

**3** (F2 — preview-spec `Mesa.status` precision gap; F8 — touch-target/responsive/accessibility obligations not bound as explicit acceptance criteria for `WP-026B`/`C`/`D`; F9 — grep-precision nit on the Reservations "zero matches" claim)

## Verdict

**PASS WITH ADVISORIES**

None of the FAIL triggers are present: the preview is not treated as architecture authority anywhere (F1); Reservations are genuinely excluded, not productized (F9); no business rule is silently blessed through the UX/UI lens (F10); and the subject SHA matches exactly `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9` (confirmed via `git log -1 --format="%H %P"`). The document is unusually rigorous in independently re-deriving its claims from frozen canonical sources rather than trusting the input drafts, and every spot-checked claim held up. The advisories are real but narrow: the visual system's own concrete NFR commitments (44×44px touch targets, three responsive breakpoints, WCAG 2.2 AA target with its disclosed reduced-motion gap) should be explicitly bound as acceptance criteria for `WP-026B`, `WP-026C`, and `WP-026D` — not just gestured at once under `WP-026A` — before Product Owner approval, to make good on the ACR's own stated "one coherent system, not two apps" intent (F11).

## Final Status

`PASS WITH ADVISORIES` — ready to proceed to Product Owner Approval (Section AA) subject to the Coordinator/PO tracking the three advisories above (F2, F8, F9) as remediation items for the next revision or for explicit acceptance-criteria addition prior to `WP-026B`/`C`/`D` implementation start. No blocking finding requires a new frozen subject SHA.
