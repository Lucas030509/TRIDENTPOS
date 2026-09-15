# ACR-2026-015 — Canonical R2 Independent Data Architecture Review

**Reviewer Agent:** `03_Data_Architect`
**Reviewer Instance Independence Declaration:** This review was performed by a fresh agent instance with no prior authorship, synthesis, or review involvement in `ACR-2026-015` or any of its predecessor candidates (R1 subject `269ca1e`, R1 remediation `214b680`, or this R2 finalization `67970cf`). No content in this document was carried over from, or trusted from, the candidate's own self-description of its status. All findings below were independently re-derived from the actual repository content on the Frozen Subject commit.

**Frozen Subject SHA:** `67970cfdcf5971ae2a1f41386d0a253268705083`
**Canonical Baseline SHA:** `f655551085dea3cff887a411adec4026842aed07`
**Reviewer Branch:** `review/acr-2026-015-canonical-r2-data`

**Artifacts Inspected:**
- `IMPLEMENTATION_PLAN.md` — full `WP-014A` entry (lines 633-658) and full `WP-016C` entry (lines 741-775), plus the amendment banner (line 6), Bounded Context Coverage Matrix (line 1207), Builder/Reviewer Assignment Matrix (lines 1240, 1244), Dependency DAG excerpt (lines 1294, 1298), and Protected Decision Dependency Matrix (`OQ-SSOT-01/02/06`, `OQ-ARCH-01`, lines 1353-1360), all on the Frozen Subject.
- `DATA_MODEL.md` Sec. 3 (Edge SQLite schema) on canonical `main` — specifically the frozen `mesas`, `cuentas`, `turnos_caja`, and `pagos` `CREATE TABLE` DDL (lines 878-972).
- `DATA_AUTHORITY_MATRIX.md` on canonical `main` — full authority table, specifically the "Salones & Mesas", "Cuentas & Comandas Activas", and "Pagos & Transacciones de Cobro" rows (lines 32, 33, 36).
- `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3 on canonical `main` (lines 315-326) — `Contrato TRIDENTPOS ↔ Finance / Billing`, including the `CuentaPagada` event contract shape.
- `WP-012` and `WP-014` entries in `IMPLEMENTATION_PLAN.md` (lines 553-561, 604-632) for cross-reference of the `IngestedIdempotencyLog` composite-key pattern and the frozen `mesas`/`cuentas` baseline WP-014A extends.
- `git diff --stat f655551085dea3cff887a411adec4026842aed07 -- DATA_MODEL.md DATA_AUTHORITY_MATRIX.md` — confirmed empty (zero changes) on the Frozen Subject.
- `git diff --stat f655551085dea3cff887a411adec4026842aed07 HEAD` (full) — confirmed only `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md`, `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md`, and `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` changed; no protected/frozen data files touched.
- Commit history `269ca1e` → `214b680` → `67970cf` — confirmed via commit messages that R1/R2 remediations (`CA-QI-015-18` through `-30`) were governance-hygiene/DAG-integrity fixes only; both commits explicitly and verifiably state "WP-014A/WP-016C ... scope unchanged" and "No protected files touched (... DATA_MODEL.md ...)", consistent with the empty diff confirmed independently above.

---

## Expected vs Actual — 13-Point Check

**WP-014A**

1. **Additive/Expand-only, non-destructive to WP-014's frozen schema?**
   Expected: Extension must not redefine or destructively alter `WP-014`'s existing `mesas`/`cuentas` schema or contracts.
   Actual: `Migration Impact: Expand (extends existing mesas/cuentas; does not redefine WP-014's frozen historical schema or contracts)`; `Rollback: Void the additive migration (Expand-only; no destructive change to WP-014's existing schema or behavior)`; Data Objects described as "Additive extension... no new database." **MATCH — PASS.**

2. **OCC (`expectedVersion`) invariants preserved across new mutation types?**
   Expected: Every new mutation type introduced by this WP (waiter reassignment, guest-count change, request-check, transfer, split, cancel, release) must remain OCC-gated.
   Actual: Acceptance Criteria: "OCC (`expectedVersion`) remains enforced across all new table/account mutations, no lost updates"; Tests: "OCC race-condition tests for each new mutation type." Both `mesas` and `cuentas` retain their frozen `version INTEGER NOT NULL DEFAULT 1` columns (DATA_MODEL.md lines 884, 904), unmodified. **MATCH — PASS.**

3. **Real audit/event trail requirement?**
   Expected: Concrete audit trail obligation, not vague mention.
   Actual: Outputs include "operational event/audit trail"; Acceptance Criteria: "audit events are immutable"; Tests: "audit-event immutability test"; Evidence Required: "audit-event sample." This is concrete (immutability explicitly tested and evidenced), though — unlike `WP-016C`'s `SEC-COND-015-03` — it does not explicitly name the canonical `local_audit_trail` primitive as the required sink, leaving a minor ambiguity about whether a new/separate audit mechanism is permitted. **MATCH (with advisory) — PASS.**

4. **`DATA-COND-015-03` concrete enough to catch UI-only status leakage?**
   Expected: A criterion that can actually be checked at review time, not a restatement of the risk.
   Actual: `"DATA-COND-015-03 (mandatory...): specialist review must explicitly verify cuentas.status and confirm no preview-only visual state (e.g. EN_ATENCIÓN, POR_COBRAR) becomes a new authoritative Cuenta/Mesa status value without a separate approved architecture change."` This names the exact column (`cuentas.status`), gives concrete named examples of the specific risk pattern this candidate's own UI-preview branches (`design/ui-preview-pos-floor-v4-functional-salon` etc., observed in the repo's branch list) are known to introduce, and is reinforced by a matching Output constraint ("attention-signal projection ... does not become an authoritative `Mesa.status` or `Cuenta.status` value"). A reviewer can mechanically execute this: diff the `cuentas.status`/`mesas.status` enum's frozen value set (`ABIERTA, IMPRESA, PAGADA, ANULADA` / `DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA` per `DATA_MODEL.md`) against the WP-014A migration output and reject any addition not separately architecture-approved. This is more concrete than a bare risk restatement, though it would be stronger yet if it enumerated the exhaustive frozen value set directly instead of "e.g." examples (a status value with a different novel name would still need a human reviewer to notice it isn't in the frozen set). **MATCH (adequate, with room to tighten) — PASS.**

**WP-016C**

5. **`pagos` ownership consistent with `DATA_AUTHORITY_MATRIX.md`?**
   Expected: Declared owner must match the matrix's existing "Pagos & Transacciones de Cobro" row.
   Actual: Matrix row (line 36): `Authoritative Source: Edge SQLite | Writable Node: Edge Host Local | Reconciliation Authority: Edge TRIDENTPOS | Conflict Policy: Append-Only + Idempotency Key`. `WP-016C` declares `Bounded Context: TRIDENTPOS` and states `pagos` "was not previously a Data Object of any WP; this WP is its first owner," which is itself independently verified true (no other WP entry in `IMPLEMENTATION_PLAN.md` lists `pagos` as a Data Object; only the Bounded Context Coverage Matrix table lists it under TRIDENTPOS's aggregate table list, consistent with `WP-016C`'s claim). **MATCH — PASS.**

6. **Append-only + concretely specified idempotency mechanism, following `WP-012`'s pattern or a named reviewed equivalent?**
   Expected: A real migration (not a suggestion), explicitly tied to `WP-012`'s composite key or an equivalent that itself is reviewed.
   Actual: `DATA-COND-015-02 (mandatory)`: "Canonical payment idempotency implemented via an Expand migration adding a `client_op_id`/idempotency-key column to `pagos`, following the proven `WP-012` composite-key pattern, or an architecture-reviewed equivalent. Closes the pre-existing gap between `DATA_AUTHORITY_MATRIX.md`'s 'Append-Only + Idempotency Key' requirement and the frozen `pagos` DDL, which has no such column today." Independently verified: the frozen `pagos` DDL (`DATA_MODEL.md` lines 963-972) indeed has no idempotency/dedup column today — the gap claim is factually correct. `WP-012`'s actual pattern (line 561) is `(orgId, branchId, aggregateType, aggregateId, action, clientOpId)`, and `WP-016C`'s Dependencies line (755) cites the identical field set in snake_case. This is a real, named, mandatory Expand migration requirement, not a vague suggestion, and the "or an architecture-reviewed equivalent" branch does not weaken it — it still requires the equivalent to be independently reviewed, not merely asserted. **MATCH — PASS.**

7. **Money/`ADR-012` fixed-point representation preserved for all new payment fields?**
   Expected: No new payment field introduced outside `ADR-012` fixed-point discipline.
   Actual: Acceptance Criteria point 6: "exact `ADR-012` Money representation preserved throughout (already conformant in the frozen `pagos.amount`/`tip_amount` columns)." Independently verified against `DATA_MODEL.md`: `amount INTEGER NOT NULL -- Cents4 (ADR-012)` and `tip_amount INTEGER NOT NULL DEFAULT 0 -- Cents4 (ADR-012)` are already fixed-point. No new monetary column is introduced by this WP beyond the idempotency key (non-monetary) and audit linkage (non-monetary); "remaining balance" is a derived/computed value, not a new stored monetary column requiring its own migration. **MATCH — PASS.**

8. **Mixed/partial payment handling addressed?**
   Expected: Not left undefined.
   Actual: Outputs explicitly list "mixed/split tender; partial payment; remaining balance"; Tests include "mixed-tender reconciliation test." Cross-checked against `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3's `CuentaPagada` event shape, which already carries `formasPago[]` (plural, array) — consistent with mixed-tender support existing at the contract level prior to this WP. **MATCH — PASS.**

9. **Atomicity of [pagos INSERT + cuentas transition + outbox event] as an explicit, testable `DATA-COND-015-01`?**
   Expected: Not narrative prose — a testable boundary requirement.
   Actual: `"DATA-COND-015-01: Atomic local settlement — the pagos INSERT, the cuentas payment/status/version transition, and the required outbox event occur under one governed local SQLite transaction boundary. No partial durable settlement state may be accepted silently."` This names all three specific state changes and the specific transaction mechanism (single local SQLite transaction), and is backed by a named test ("crash-then-recover simulation between terminal authorization and local persistence"). **MATCH — PASS.**

10. **`turno_caja_id` shift binding required across all tender types, not just cash?**
    Expected: Structural requirement, not conditional/cash-only.
    Actual: Independently verified against the frozen `pagos` DDL: `turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id)` is a single unconditional `NOT NULL` column applying to every row regardless of `payment_method` — it is structurally impossible to insert a payment of any tender type without a shift. `WP-016C`'s own Tests line makes this explicit: "`turno_caja_id NOT NULL` shift-gating test across all tender types (not only cash)." **MATCH — PASS.**

11. **Concrete crash/recovery requirement for "external auth succeeded, local commit didn't happen," not hand-waved?**
    Expected: More than "considered."
    Actual: `SEC-COND-015-02 (mandatory)`: "A concrete crash-reconciliation protocol is defined for 'external authorization succeeded, local durable settlement not yet committed,' including replay/idempotency semantics — a statement that the risk was considered is not sufficient to pass this criterion." The plan-level entry appropriately defers the concrete protocol's design to this WP's own mandatory specialist review gate (`03_Data_Architect` + `08_Security_Architect`) rather than inventing an unreviewed protocol at the roadmap-amendment stage — but it makes that gate explicitly non-waivable and explicitly rules out a "considered" fig-leaf, and the Security Debt line tracks it as an open item requiring resolution before this WP can pass its own review, not a silently dropped concern. This is the correct altitude for a roadmap amendment: it does not itself claim the problem is solved, but it forecloses the specific failure mode (declaring the risk merely "considered") that would make it hand-waved. **MATCH — PASS.**

12. **Any accidental destructive-mutation path for settlement records?**
    Expected: Append-only invariant must hold everywhere, including rollback.
    Actual: `Rollback: Reverse settlement via a compensating entry with mandatory audit record — the append-only pagos table is never destructively altered.` `Migration Impact: Expand (extends the existing frozen pagos table only).` No other WP entry in `IMPLEMENTATION_PLAN.md` references `ALTER`/`DROP`/destructive operations against `pagos` (verified by full-text grep across the file). **MATCH — PASS, no violation found.**

13. **`RESTCARD`/`CXC` genuinely excluded with stated reason, not silently included?**
    Expected: Explicit exclusion tied to a named unresolved dependency.
    Actual: `"Explicit First-Slice Exclusions: RESTCARD (depends on WP-022, not yet started) and CXC (depends on OQ-SSOT-03, Finance/CRM-owned, unresolved) — both already present in the frozen pagos.payment_method enum but rejected at the API boundary in this WP's first slice; neither may be added without a separate authorization."` Independently verified: the frozen `pagos.payment_method` comment (`DATA_MODEL.md` line 967) does list `RESTCARD, CXC` in the enum comment, confirming the "already present in the frozen enum" claim is accurate, and `WP-016C`'s own Outputs line (757) lists only `EFECTIVO, TARJETA, TRANSFERENCIA` as in-scope tender capture — consistent with the stated exclusion. **MATCH — PASS.**

---

## Findings

- All 13 checks independently verified as **MATCH**. No contradiction found between `WP-014A`/`WP-016C` and the frozen `DATA_MODEL.md`/`DATA_AUTHORITY_MATRIX.md`/`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3.
- `DATA_MODEL.md` and `DATA_AUTHORITY_MATRIX.md` are confirmed byte-identical to canonical baseline `f655551` on this Frozen Subject (empty `git diff --stat`).
- Both WPs correctly self-classify as `Expand`-only migrations against genuinely frozen tables, with no destructive path identified in either the acceptance criteria or the rollback plan.
- The idempotency requirement (`DATA-COND-015-02`) correctly identifies and closes a real, pre-existing gap between `DATA_AUTHORITY_MATRIX.md`'s frozen "Append-Only + Idempotency Key" requirement and the actual frozen `pagos` DDL (which has no such column) — this is a substantive, correctly-scoped data-authority remediation, not cosmetic.
- The atomicity (`DATA-COND-015-01`) and crash-recovery (`SEC-COND-015-02`) conditions are both explicitly marked non-waivable/non-downgradable by the Coordinator Synthesis language ("none of the following six may be waived or downgraded to optional"), which is the correct governance posture for OCC/atomicity-adjacent invariants.
- Prior R1→R2 remediation commits (`214b680`, `67970cf`) independently confirmed via commit-message content and diff stat to have touched only governance/DAG-hygiene material, not the data-model substance of `WP-014A`/`WP-016C` reviewed here.

## Blockers

**0.**

## Advisories

**2:**
1. `WP-014A`'s audit-trail requirement ("audit events are immutable," Acceptance Criteria) does not explicitly name `local_audit_trail` as the required sink, unlike `WP-016C`'s `SEC-COND-015-03` which does. Recommend `WP-014A`'s acceptance criteria be tightened at build time to explicitly bind to `local_audit_trail` (or an explicitly named, separately justified equivalent) to remove ambiguity about whether a second, parallel audit mechanism is permitted.
2. `DATA-COND-015-03` uses "e.g." illustrative examples (`EN_ATENCIÓN`, `POR_COBRAR`) rather than enumerating the exhaustive frozen `cuentas.status`/`mesas.status` value sets to diff against. Recommend the specialist review executing this criterion explicitly enumerate and diff against the full frozen enum (`ABIERTA, IMPRESA, PAGADA, ANULADA` for `cuentas.status`; `DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA` for `mesas.status`) rather than relying on named examples, to close the residual risk of a novel-named UI-only state slipping through unnoticed.

## Remaining Risks

- The concrete crash-reconciliation protocol (`SEC-COND-015-02`) and the terminal-credential storage mechanism (`SEC-COND-015-01`) are correctly gated as mandatory but are, by design, not yet specified at this roadmap-amendment stage — they remain open design risk until `WP-016C`'s own specialist review produces and verifies them. This is appropriately tracked as open Security Debt in the plan, not a data-model defect, but it is a real residual risk carried forward.
- `OQ-ARCH-01` (multi-cashier shift model) remains an open Product Owner decision that `WP-016C` consumes without resolving; any change to the eventual shift-assignment model could still interact with `turno_caja_id` binding semantics, though the current structural `NOT NULL` requirement is decision-independent and safe regardless of outcome.
- Table-merge semantics in `WP-014A` are explicitly scoped to a "neutral, parameterized hook" only — this is correctly conservative, but the eventual concrete merge/account-grouping model (when authorized) will need its own future data-authority review since it was not evaluated here.

## Verdict

**DATA MODEL / ROADMAP AMENDMENT: PASS**

## Final Status

PASS — 0 blockers, 2 advisories. No data-authority contradiction, no broken append-only invariant, no missing idempotency mechanism against `DATA_AUTHORITY_MATRIX.md`'s requirement, and no OCC-invariant violation were found in `WP-014A` or `WP-016C` as specified on the Frozen Subject. `DATA_MODEL.md` and `DATA_AUTHORITY_MATRIX.md` are independently confirmed unmodified by this candidate. The two advisories above are recommended tightenings for the WPs' own future specialist-review execution and do not block canonicalization of this roadmap amendment.
