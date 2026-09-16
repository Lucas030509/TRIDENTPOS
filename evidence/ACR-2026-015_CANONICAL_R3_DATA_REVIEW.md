# ACR-2026-015 — Canonical Amendment R3 — Independent Data Architecture Review

**Reviewer Agent:** `03_Data_Architect`
**Framework (pinned):** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`
**Frozen Subject SHA:** `38bf3449b2ebd5b03a86911996918ada343cd951`
**Canonical Baseline SHA:** `f655551085dea3cff887a411adec4026842aed07`
**Reviewer Branch:** `review/acr-2026-015-canonical-r3-data`
**Exact Parent (to be verified post-commit via `git log -1 --format="%H %P"`):** must equal `38bf3449b2ebd5b03a86911996918ada343cd951`

## Reviewer Instance Independence Declaration

This is a fresh `03_Data_Architect` instance with no prior involvement in authoring, synthesizing, or reviewing any earlier round (R1, R2, or R3) of `ACR-2026-015`. This review branch was created directly on top of the Frozen Subject commit `38bf3449b2ebd5b03a86911996918ada343cd951` (verified single parent, no merge). All findings below were independently re-derived from the actual file contents on this commit and on canonical `main` — no claim in the candidate's own self-description (`IMPLEMENTATION_PLAN.md` narrative text or `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md`) was trusted without direct verification against the underlying `DATA_MODEL.md` DDL, `DATA_AUTHORITY_MATRIX.md` rows, and raw `git diff` output. The historical R2 5-agent panel result (including its Data Architect PASS with 2 advisories) is treated strictly as historical evidence — it does not authorize R3, and every one of the 13 required checks plus the evidence-file cross-check was re-verified from scratch on this frozen commit.

## Artifacts Inspected

- `IMPLEMENTATION_PLAN.md` — full `WP-014A: Dining Operations Expansion` entry (lines 633–658) and full `WP-016C: POS Payment Orchestration & Account Settlement` entry (lines 741–775), on Frozen Subject `38bf344`.
- `DATA_MODEL.md` (canonical `main`, confirmed byte-identical on Frozen Subject via empty `git diff --stat`) — Sec. 3 "Edge SQLite Logical Schema" (line 757), specifically the `mesas` (line 878–887), `cuentas` (line 889–898), and `pagos` (line 963–972) DDL blocks, and the `local_audit_trail` DDL block (line 991–1002).
- `DATA_AUTHORITY_MATRIX.md` (canonical `main`, confirmed byte-identical on Frozen Subject via empty `git diff --stat`) — the "Salones & Mesas", "Cuentas & Comandas Activas", and "Pagos & Transacciones de Cobro" rows.
- `FUNCTIONAL_ARCHITECTURE.md` (canonical `main`, confirmed byte-identical via empty `git diff --stat`) — Sec. 6.3 "Contrato TRIDENTPOS ↔ Finance / Billing" (line 315), `CuentaPagada` event contract.
- `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` — full 11-condition mandatory table (lines 56–66) and the new "R2 Independent Canonical Amendment Reviews" / "R3 Remediation" sections (lines 91–116).
- `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` Sections AA/AB (governance-metadata correction, reviewed for absence of data-model substance change).

## R3 Delta Inspected

`git diff 67970cfdcf5971ae2a1f41386d0a253268705083 38bf3449b2ebd5b03a86911996918ada343cd951` touches exactly three files: `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md`, `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` (96 insertions, 29 deletions total; `DATA_MODEL.md` / `DATA_AUTHORITY_MATRIX.md` / `FUNCTIONAL_ARCHITECTURE.md` untouched by this diff, consistent with their empty diff vs. canonical `main`).

Data-relevant substance in `IMPLEMENTATION_PLAN.md`'s diff is exactly the two claimed clarifications:
1. `WP-014A` Acceptance Criteria: audit-event wording changed from generic "audit events are immutable" to explicitly "MUST reuse the canonical `local_audit_trail` sink (or an explicitly architecture-approved canonical successor/equivalent) — no parallel or new audit bounded context may be introduced."
2. `DATA-COND-015-03`: changed from illustrative "e.g. `EN_ATENCIÓN`, `POR_COBRAR`" wording to the complete, exact `cuentas.status` / `mesas.status` enumerations.

Three additional non-data hunks add "canonical Visual System `APPROVED`/`FROZEN`" to the `Prerequisites` fields of `WP-026B`, `WP-026C`, `WP-026D` (UI/visual-system gating, not a data-authority or schema change — confirmed out of scope for this review). The `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` and evidence-file diffs are governance-metadata corrections (Sections AA/AB decision-block contradiction fix) with no data-model substance altered. **Confirmed: no other data-model substance was changed by R3.**

## Expected vs Actual — 13 Checks + Evidence Cross-Check

**1. `mesas`/`cuentas` extension genuinely additive (Expand-only)?**
Expected: no destructive change to `WP-014`'s frozen schema. Actual: `WP-014A` Data Objects state "Additive extension of SQLite `mesas`, `cuentas` ... no new database"; `Migration Impact: Expand (extends existing mesas/cuentas; does not redefine WP-014's frozen historical schema or contracts)`; `Rollback: Void the additive migration (Expand-only; no destructive change to WP-014's existing schema or behavior)`. **PASS.**

**2. OCC (`expectedVersion`) invariants preserved across all new mutation types?**
Expected: explicit, testable OCC requirement. Actual: AC states "OCC (`expectedVersion`) remains enforced across all new table/account mutations, no lost updates"; Tests include "OCC race-condition tests for each new mutation type." **PASS.**

**3. R3-specific — audit sink named explicitly?**
Expected: AC must name `local_audit_trail` (or an approved successor) as the required sink, forbidding a parallel authority. Actual, verbatim: "audit events are immutable and MUST reuse the canonical `local_audit_trail` sink (or an explicitly architecture-approved canonical successor/equivalent) — no parallel or new audit bounded context may be introduced." `local_audit_trail` independently confirmed to exist as a frozen, canonical, append-only, tamper-evident-hash-chain table in `DATA_MODEL.md` Sec. 3 (also referenced by `SEC-VAL-06`). **PASS — R2 advisory #1 genuinely fixed with the exact named sink.**

**4. R3-specific, most important — `DATA-COND-015-03` complete enumeration, independently cross-checked against the actual frozen DDL:**
Actual frozen DDL comments (`DATA_MODEL.md` lines 882, 895):
- `mesas.status TEXT NOT NULL, -- DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA`
- `cuentas.status TEXT NOT NULL, -- ABIERTA, IMPRESA, PAGADA, ANULADA`

`DATA-COND-015-03`'s current text lists `cuentas.status: ABIERTA, IMPRESA, PAGADA, ANULADA` and `mesas.status: DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA` — **exact match, independently verified, not merely trusted from the plan's own citation.** The criterion is mechanically auditable (a reviewer diffs a migration's actual output against this exact list). It explicitly rejects "any new authoritative status value (including but not limited to preview/projection-only states such as `EN_ATENCIÓN`, `POR_COBRAR`, `RESERVADA`, or any other UI-only projection) unless a separate approved architecture change authorizes it." **PASS — R2 advisory #2 genuinely fixed with the exhaustive, verified enumeration.**

**5. `pagos` ownership consistent with `DATA_AUTHORITY_MATRIX.md`'s existing row?**
Matrix row "Pagos & Transacciones de Cobro": `Edge SQLite` / `Edge Host Local` (writable) / `Append-Only + Idempotency Key` / `Edge TRIDENTPOS` (reconciliation authority). `WP-016C` Data Objects: "Extends the existing frozen SQLite `pagos` table ... `pagos` was not previously a Data Object of any WP; this WP is its first owner." Consistent. **PASS.**

**6. Append-only + concrete idempotency mechanism, `WP-012` pattern or reviewed equivalent — unweakened from R2?**
`DATA-COND-015-02`: "Canonical payment idempotency implemented via an Expand migration adding a `client_op_id`/idempotency-key column to `pagos`, following the proven `WP-012` composite-key pattern... Closes the pre-existing gap between `DATA_AUTHORITY_MATRIX.md`'s 'Append-Only + Idempotency Key' requirement and the frozen `pagos` DDL, which has no such column today." Independently confirmed: the frozen `pagos` DDL (`DATA_MODEL.md` line 963–972) indeed has no `client_op_id` column today, and `WP-012`'s composite key `(organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id)` is confirmed present and used elsewhere (`outbox_queue`, `IngestedIdempotencyLog`). This text is byte-identical to the R2 subject (untouched by the R3 diff) — confirmed unweakened. **PASS.**

**7. Money/`ADR-012` fixed-point representation preserved?**
`pagos.amount INTEGER -- Cents4 (ADR-012)`, `pagos.tip_amount INTEGER -- Cents4 (ADR-012)` confirmed in frozen DDL. AC item 6: "exact `ADR-012` Money representation preserved throughout (already conformant in the frozen `pagos.amount`/`tip_amount` columns)." **PASS.**

**8. Mixed/partial payment, remaining balance addressed?**
Outputs: "mixed/split tender; partial payment; remaining balance; tip capture." **PASS.**

**9. `turno_caja_id` binding required across ALL tender types (unconditional `NOT NULL`)?**
Frozen DDL: `turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id)` — unconditional, no tender-type-specific carve-out. Tests explicitly include "`turno_caja_id NOT NULL` shift-gating test across all tender types (not only cash)." **PASS.**

**10. Atomicity of [pagos INSERT + cuentas transition + outbox event] as explicit testable criterion (`DATA-COND-015-01`)?**
"Atomic local settlement — the `pagos` INSERT, the `cuentas` payment/status/version transition, and the required outbox event occur under one governed local SQLite transaction boundary. No partial durable settlement state may be accepted silently." Concrete and testable. **PASS.**

**11. Concrete crash-recovery requirement (`SEC-COND-015-02`) — not merely "considered"?**
"A concrete crash-reconciliation protocol is defined for 'external authorization succeeded, local durable settlement not yet committed,' including replay/idempotency semantics — a statement that the risk was considered is not sufficient to pass this criterion." The requirement itself is concrete (mandates production of a concrete protocol at `WP-016C`'s own future build-time specialist review); the evidence file correctly and transparently defers the protocol's actual *content* to that future gate rather than silently dropping the requirement (`evidence/...EVIDENCE.md` line 112: "`INTENDED FUTURE ACCEPTANCE GATE, NOT A CANONICAL-AMENDMENT DEFECT`"). This is appropriate for a roadmap/ACR-level amendment, not an implementation. **PASS.**

**12. Compensating-entry-only rollback (no destructive mutation of settlement records)?**
"Reverse settlement via a compensating entry with mandatory audit record — the append-only `pagos` table is never destructively altered." **PASS.**

**13. `RESTCARD`/`CXC` genuinely excluded with named blocking dependency?**
"`RESTCARD` (depends on `WP-022`, not yet started) and `CXC` (depends on `OQ-SSOT-03`, Finance/CRM-owned, unresolved) — both already present in the frozen `pagos.payment_method` enum but rejected at the API boundary in this WP's first slice; neither may be added without a separate authorization." `WP-022` and `OQ-SSOT-03` independently confirmed to exist elsewhere in `IMPLEMENTATION_PLAN.md` as named, real entities. **PASS.**

**Evidence-file cross-check (`DATA-COND-015-03` table summary):**
`evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` line 61 summarizes `DATA-COND-015-03` as: "Specialist review must explicitly verify `cuentas.status` introduces no new authoritative value without approved architecture change." This summary (a) omits `mesas.status` entirely, and (b) does not reflect the R3 strengthening to a complete enumeration — it reads identically to how a summary of the pre-R3, illustrative-examples version would read. This is **narrower** than the actual, fuller Acceptance Criterion text in `IMPLEMENTATION_PLAN.md`, which binds both `cuentas.status` AND `mesas.status` to their complete frozen sets. This row was not touched by the R3 diff (confirmed: R3's diff to the evidence file only added new sections, it did not edit the pre-existing 11-condition table). **This is a genuine inconsistency between the tracking table and the actual binding criterion — flagged below as an advisory, not a blocker,** because (a) `IMPLEMENTATION_PLAN.md`'s Acceptance Criteria are explicitly labeled the binding text ("Acceptance Criteria (binding — ... none of the following six may be waived or downgraded to optional)" for `WP-016C`, and `DATA-COND-015-03` itself is embedded directly in `WP-014A`'s own Acceptance Criteria, not solely in the evidence file), and (b) it does not itself weaken, override, or contradict the operative DDL/schema constraint — a future specialist reviewing `WP-014A` reads the full AC text in `IMPLEMENTATION_PLAN.md`, not merely the evidence-file index row. It should still be corrected for reviewer-clarity in a future round.

## Findings

- Both R2 Data Architect advisories are genuinely, precisely remediated in R3: the audit sink is now explicitly and correctly named (`local_audit_trail`), and `DATA-COND-015-03` now carries the complete, independently-verified-against-DDL frozen enumeration for both `cuentas.status` and `mesas.status`, with an explicit non-exhaustive reject list plus mechanical auditability.
- No OCC, append-only, idempotency, atomicity, or money-representation invariant is broken, weakened, or newly introduced without authorization anywhere in the `WP-014A`/`WP-016C` data-relevant text.
- `pagos` ownership, `turno_caja_id` gating, `RESTCARD`/`CXC` exclusion, and compensating-entry-only rollback are all unweakened from what R2 established and are independently verified against the frozen DDL/matrix, not merely trusted from the plan's own citations.
- The R3 diff is confirmed to touch only the two claimed data clarifications (plus three unrelated Visual-System-prerequisite additions on `WP-026B`–`D`, and governance-metadata corrections in the ACR document/evidence file) — no other data-model substance was altered.
- `DATA_MODEL.md`, `DATA_AUTHORITY_MATRIX.md`, and `FUNCTIONAL_ARCHITECTURE.md` are confirmed byte-identical to canonical `main` (empty `git diff --stat`).
- One new, previously-unflagged issue found by this independent review: the evidence file's `DATA-COND-015-03` table-row summary is stale relative to the R3-strengthened Acceptance Criterion (omits `mesas.status`) — see cross-check above.

## Blockers

**0.**

## Advisories

**1.**
1. `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` line 61's summary of `DATA-COND-015-03` should be updated to name both `cuentas.status` and `mesas.status` and to reflect the R3 strengthening to the complete frozen enumeration, so the tracking table does not read as narrower than the actual binding Acceptance Criterion in `IMPLEMENTATION_PLAN.md`.

## Remaining Risks

- `SEC-COND-015-02`'s actual crash-reconciliation protocol content, `SEC-COND-015-01`'s concrete secure-storage selection, and `DATA-COND-015-02`'s concrete idempotency-column migration are all correctly deferred to `WP-016C`'s own future build-time specialist review (`03_Data_Architect` + `08_Security_Architect`) — this is appropriate at the roadmap-amendment stage but means real risk reduction has not yet occurred and is explicitly future-gated, not closed.
- Three protected Product Owner decisions (`OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`) and one architecture decision (`OQ-ARCH-01`, multi-cashier shift model) remain open and gate concrete business-rule implementation in `WP-014A`/`WP-016C`; this is by design (explicitly not closed by this ACR) and not a data-authority defect.
- The evidence-file advisory above, if left uncorrected across future rounds, risks a future specialist relying on the terser table row instead of the full `IMPLEMENTATION_PLAN.md` AC text and under-verifying `mesas.status`.

## Verdict

**DATA MODEL / ROADMAP AMENDMENT: PASS**

## Final Status

PASS WITH ADVISORIES (0 blockers, 1 advisory). Both R2 Data Architect advisories are confirmed genuinely and precisely remediated in R3, independently re-verified against the actual frozen DDL rather than trusted from the candidate's own citations. No data-authority contradiction (append-only, idempotency, OCC, or unauthorized new authoritative status value) was found. R3's delta is confirmed limited to the two claimed data clarifications plus unrelated, out-of-scope governance-metadata and Visual-System-prerequisite corrections.
