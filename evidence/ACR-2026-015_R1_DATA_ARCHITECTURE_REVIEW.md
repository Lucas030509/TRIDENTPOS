# ACR-2026-015 (R1) — INDEPENDENT DATA ARCHITECTURE REVIEW

**Reviewer Agent:** `03_Data_Architect`
**Frozen Subject SHA:** `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`
**Reviewer Branch:** `review/acr-2026-015-r1-data`
**Exact Parent (verified via `git log -1 --format="%H %P"`):** `7117308df6db9e0a1f9fcb87aa365da541549695`
**Parent Chain to Canonical `main`:** `git merge-base 2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9 f655551085dea3cff887a411adec4026842aed07` = `f655551085dea3cff887a411adec4026842aed07` (confirmed — the frozen subject's ancestry resolves exactly to the canonical `main` tip named in the ACR)
**Diff vs. `main` (`git diff --stat f655551085dea3cff887a411adec4026842aed07 2c90a43c...`):** exactly 2 files changed, both additions — `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` and `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md`. No canonical file was touched by the frozen subject.

---

## Conflict of Interest Declaration

I did not author `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md`, `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md`, or any of the superseded candidate (`7117308df6db9e0a1f9fcb87aa365da541549695`). I have no prior involvement in this ACR, its drafts, or its Coordinator Quick Integrity pass. This review was performed as a fresh, independent sidecar instance against the frozen subject SHA only, re-deriving every cited claim from the underlying frozen documents rather than accepting the ACR's or Matrix's citations at face value.

---

## Sources Inspected

- `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` (full document, frozen subject)
- `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` (full document, frozen subject)
- `DATA_MODEL.md` — Sec. 3 DDL, specifically `mesas`, `cuentas`, `cuenta_items`, `cuenta_item_modificadores`, `turnos_caja`, `pagos`, `outbox_queue` (lines 878–988)
- `DATA_AUTHORITY_MATRIX.md` — full authority table (Sec. 1), specifically the "Salones & Mesas," "Cuentas & Comandas Activas," "Turnos de Caja & Arqueos," and "Pagos & Transacciones de Cobro" rows
- `DATA_DICTIONARY.md` — `pagos.payment_method` entry, `accounts_receivable.balance_due` entry
- `CAPABILITY_MAP.md` — `CAP-OPS-07 [Cobro y Split Payment]` entry and ownership table
- `IMPLEMENTATION_PLAN.md` — `WP-014`, `WP-015`, `WP-016`, `WP-016B` full entries (Data Objects, PO Dependency, ADRs lines)
- `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md` (full document)
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md` — Sec. 4.1–4.3 (package responsibility/dependency matrix, isolation invariants)
- `evidence/WP-012_BUILDER_EVIDENCE.md` — idempotency schema and composite-key derivation sections (Sec. 4.1, 5.1)
- `evidence/WP-014_BUILDER_EVIDENCE.md` — grepped for idempotency/outbox terms (none found, confirming no prior idempotency mechanism was retrofitted onto `pagos`-adjacent tables)
- `FUNCTIONAL_ARCHITECTURE.md` — Sec. 6.3 ("Contrato TRIDENTPOS ↔ Finance / Billing")
- `OPEN_QUESTIONS.md` — `OQ-SSOT-03`, `OQ-ARCH-01` entries and detail sections
- `PRODUCT_DECISIONS.md` — `DEC-006` entry and detail section
- `git log`, `git diff --stat`, `git merge-base` against the frozen subject and canonical `main` tip, to independently verify commit ancestry and file-scope claims

---

## Findings

### F1. "Orphaned `pagos` table" claim — CONFIRMED TRUE
Independently verified: `DATA_MODEL.md` Sec. 3 (line 963) contains a frozen `CREATE TABLE pagos` with columns `id, cuenta_id, turno_caja_id, payment_method, amount, tip_amount, reference_auth_code, created_at`. `IMPLEMENTATION_PLAN.md`'s `WP-014` Data Objects line (line 603) lists only `mesas, cuentas, cuenta_items, cuenta_item_modificadores` (+ Cloud read replica `local_products`). `WP-016`'s Data Objects line (line 657) lists only `turnos_caja, movimientos_caja, cortes_caja, arqueos_ciegos`. Neither WP claims `pagos`. The ACR's central claim is accurate, not merely asserted.

### F2. Idempotency-key gap — CONFIRMED TRUE, and correctly scoped (not a generic outbox concern)
The frozen `pagos` DDL has no idempotency/dedup column of any kind. `DATA_AUTHORITY_MATRIX.md` line 36 states, verbatim, integrity requirement "Append-Only + Idempotency Key" for the "Pagos & Transacciones de Cobro" row, owning context "Edge TRIDENTPOS," sync "Edge → Cloud (Outbox)." Critically, I checked whether this is redundant with the existing `outbox_queue`/`ingested_idempotency_log` sync-dedup machinery (which would make the gap non-substantive) — it is not: the Data Authority Matrix's "Política de Conflicto" column assigns `Salones & Mesas` and `Cuentas & Comandas Activas` the policy **"OCC (`expectedVersion` on Edge)"**, while `Pagos` alone is assigned **"Append-Only + Idempotency Key."** This is a deliberate, table-specific distinction: OCC versioning is meaningless for an insert-only ledger, so duplicate-insert prevention for `pagos` must come from a row-level idempotency key, which is absent. This is a genuine, correctly-identified, pre-existing schema gap — not an overstatement.

### F3. Proposed remediation reuses proven pattern, not new machinery — SOUND
`evidence/WP-012_BUILDER_EVIDENCE.md` Sec. 4.1/5.1 confirms a canonical composite idempotency-key pattern already exists and is tested: `ingested_idempotency_log` with `UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id)`, plus a local Edge `outbox_queue` table (`DATA_MODEL.md` line 975) already carrying `client_op_id` and a `UNIQUE idempotency_key`. The ACR's G.3 proposal to extend `pagos` with a `client_op_id`/idempotency-key column "following the same composite-key pattern already proven in WP-012" is an accurate re-derivation, not an invented mechanism.

### F4. `turno_caja_id NOT NULL` claim — CONFIRMED TRUE, unconditional
Verified directly in the DDL: `turno_caja_id TEXT NOT NULL REFERENCES turnos_caja(id)`. There is no `CHECK` constraint conditioning nullability on `payment_method`; the column is `NOT NULL` for every row regardless of tender type. The ACR's claim that all tender types (not only cash) are gated on an open shift is accurate.

### F5. `RESTCARD`/`CXC` enum members — CONFIRMED TRUE; exclusion is data-architecturally sound
`pagos.payment_method` is declared `TEXT NOT NULL` with comment `-- EFECTIVO, TARJETA, TRANSFERENCIA, RESTCARD, CXC`, matching `DATA_DICTIONARY.md` line 128 exactly. No `CHECK` constraint enforces this enum at the DDL level, so excluding `RESTCARD`/`CXC` from `WP-016C`'s first slice (rejected at the API boundary) requires no schema change and creates no future migration risk when they are eventually implemented. Cross-checked `OPEN_QUESTIONS.md`: `OQ-SSOT-03` (Cuentas por Cobrar / credit-limit mechanism) is confirmed open, owned by "Finance / CRM" — a genuine unresolved cross-context dependency, correctly grounding the `CXC` exclusion. `RESTCARD`'s dependency on `WP-022` (not yet started) is also verifiable (no `WP-022` builder evidence exists). The exclusion is architecturally sound: it avoids half-implementing a payment branch whose authorization contract with another bounded context is not yet defined.

### F6. `ADR-012` Money compliance — NO VIOLATION, already conformant
`pagos.amount` and `pagos.tip_amount` are already declared `INTEGER ... -- Cents4 (ADR-012)`, consistent with ADR-012 Sec. 4.1/4.2's mandatory fixed-point scale-4 integer representation. The ACR does not propose any authoritative monetary column that deviates from this; its own E.4 invariant restates the requirement correctly. Note (transparency, not a finding against the ACR): `ADR-012`'s own status banner still reads "PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL," which the ACR itself flags in Section 0 item 8 as a stale-banner documentation-hygiene issue distinct from this ACR's scope — independently confirmed accurate.

### F7. Package placement (`ADR-013` §4.2) — CONFIRMED TRUE
`ADR-013` Sec. 4.2's dependency-responsibility matrix for `@trident/pos` (Capa 2, runtime deps `['@trident/core']` only) literally reads: "...Turnos de Caja (`turnos_caja`), Movimientos de Efectivo, **Cobro POS (`pagos`)**, Arqueos de Turno, Cortes X y Cortes Z..." — verified verbatim. The `@trident/finance` package row separately states parenthetically that "los turnos de caja operativos, arqueos de piso y cobros POS pertenecen exclusivamente a TRIDENTPOS," reinforcing rather than contradicting the placement. The ACR's claim that `WP-016C`/`WP-014A` package placement is already resolved by frozen architecture (not deferred) is accurate.

### F8. Ownership contract (`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.3) — CONFIRMED TRUE
Sec. 6.3 verified verbatim: "Ownership de Caja: TRIDENTPOS genera internamente los turnos de caja, el arqueo a ciegas, el cobro de cuentas..."; `CuentaPagada(...)` is listed as a domain event emitted by TRIDENTPOS; Finance/Billing/Loyalty are listed as conditional ("si está presente") consumers. `CAP-OPS-07` is independently confirmed in `CAPABILITY_MAP.md` with Owner = Consumer = TRIDENTPOS, Priority P0. The ACR's G.1 conclusion that `WP-016C`'s ownership is an implementation of an already-frozen contract, not a new ownership decision, is correctly re-derived.

### F9. Crash-recovery treatment — appropriately scoped for a roadmap-decomposition ACR, not a design gap
Section G.7/M require a defined recovery path for "authorization succeeded, crash before local durable persistence" as a first-class, non-deferrable acceptance criterion for `WP-016C`'s own specialist review — but this ACR (correctly, given its stated classification as roadmap decomposition, not detailed technical design) does not itself specify the recovery mechanism. This is consistent with how this repository has historically handled comparable risk (e.g., `WP-016`'s Corte Z durability was tracked as `Security Debt: DAT-04`, not resolved at ACR level). This is not a gap "deferred to be addressed later but unaddressed even conceptually" — the concrete failure mode (terminal-authorized, not-yet-persisted) is named explicitly, and the requirement is escalated to `03_Data_Architect` + `08_Security_Architect` review rather than left to UI (`WP-026D`). Not blocking.

### F10. Outbox/offline reuse (Section L) — SOUND
`DATA_AUTHORITY_MATRIX.md` confirms sync direction "Edge → Cloud (Outbox)" for the Pagos row, matching the existing `WP-012` Transactional Outbox pattern already used by `Salones & Mesas`, `Cuentas & Comandas Activas`, and `Turnos de Caja & Arqueos`. Reusing this mechanism for `WP-016C`/`WP-014A` rather than inventing new sync machinery is the architecturally conservative and correct choice.

### F11. `WP-014A` persistence / no silent new authoritative enum — CONFIRMED TRUE for `mesas`; `cuentas` not explicitly checked by the ACR
Independently verified the frozen `mesas` DDL: `status TEXT NOT NULL, -- DISPONIBLE, OCUPADA, EN_CUENTA, BLOQUEADA`. None of the preview's visual states (`EN_ATENCIÓN`, `POR_COBRAR`, `PREPARANDO`, `LISTO`, `SERVIDO`, `RESERVADA`) appear as literals. The ACR's E.3 claim is accurate for `Mesa.status`. **Advisory (not blocking):** the ACR's E.3/Section J analysis is framed only around `Mesa.status`; it does not perform the equivalent check against `cuentas.status` (`ABIERTA, IMPRESA, PAGADA, ANULADA`), even though `WP-014A`'s own scope (H.1: precuenta lifecycle, check-request) operates primarily on `cuentas`, not `mesas`. Independently checking this myself: the existing four-value `cuentas.status` enum already appears sufficient for H.1's scope (`IMPRESA` already covers the precuenta-printed/check-requested transition referenced qualitatively as "Pendiente por Pagar" in `PRODUCT_DECISIONS.md` `DEC-006`'s prose) — so this is a real but narrow gap in the ACR's stated verification, not evidence of an actual undisclosed enum expansion. Should be an explicit acceptance-criterion check at `WP-014A` specialist review, not assumed.

### F12. `DEC-006` (folio-at-precuenta) — CONFIRMED TRUE
`PRODUCT_DECISIONS.md` confirms `DEC-006` status `APROBADA`, text matching the ACR's H.4 citation. `cuentas.folio_number` is `NULL`-able with DDL comment "Asignado al imprimir precuenta o cobrar," consistent with this decision.

### F13. Migration impact classification — SOUND, arguably conservative in the ACR's favor
Independently checked for any existing migration file creating `pagos` (searched all `*.sql` under migration directories) — none exists. `pagos` is a frozen DDL specification only, never yet materialized by any merged migration. This means adding an idempotency column is not merely a safe "Expand" against a live table with production rows (the higher-risk case Expand normally guards against) — it is lower-risk still, since the table has not been created in any deployed migration yet. "Expand" is therefore a correct, non-understated classification.

### F14. Account settlement atomicity — not explicitly named as an acceptance criterion (Advisory)
The ACR's G.2 scope lists "Settlement completion and account-close coordination with WP-014/WP-014A" and H.7 requires "no lost updates" via OCC, but neither G nor H explicitly states that the `pagos` INSERT and the `cuentas` status/version transition must occur within a single local SQLite transaction. Given `cuentas` already uses OCC (`expectedVersion`) per `WP-014`'s established pattern, this follows naturally and is not architecturally contradicted by anything in the frozen documents — but it is not spelled out as an explicit acceptance criterion the way idempotency and crash-recovery are (Section W item 12 names idempotency, auditability, Money integrity, and crash-recovery, but not settlement atomicity by name). Advisory: `WP-016C`'s specialist review should require this explicitly.

### F15. Auditability — adequately addressed
`WP-016C`'s scope (G.2) and acceptance direction (H.7, applied by extension) require immutable audit events and reuse of the existing `WP-012`-pattern outbox/audit mechanism rather than a new one (Section L; also cross-referenced correctly against `local_audit_trail`, distinct from `edge_security_audit`, in the frozen `DATA_MODEL.md`). No gap found.

### F16. Reservations exclusion, WP count (29→34), and protected-decision non-closure — spot-checked, consistent
`IMPLEMENTATION_PLAN.md` confirmed to contain exactly `WP-001`–`WP-028` plus `WP-016B` as `####`-level headers (29 total), consistent with the ACR's Section S count. `PRODUCT_DECISIONS.md` confirmed to list only decided items (`DEC-004`–`DEC-009` in the range checked) with none of `OQ-SSOT-01/02/06/07`/`OQ-ARCH-01` appearing as closed decisions. No reservation-related capability found in `CAPABILITY_MAP.md` or `DATA_MODEL.md`. These are secondary to the data-architecture mandate of this review but were checked as part of overall document-integrity spot verification and found accurate.

---

## Blocking Findings Count: 0

## Advisories Count: 3
(F11 — `cuentas.status` enum sufficiency not explicitly re-verified by the ACR itself, though independently confirmed sufficient by this review; F14 — settlement atomicity not named as an explicit acceptance criterion; F9's crash-recovery mechanism, while appropriately scoped for this document's governance level, should be tracked as a hard, non-waivable gate at `WP-016C`'s specialist review rather than something a builder could interpret as optional.)

---

## Verdict: PASS WITH ADVISORIES

## Final Status
The ACR's data/schema claims were independently re-derived from the frozen `DATA_MODEL.md`, `DATA_AUTHORITY_MATRIX.md`, `DATA_DICTIONARY.md`, `CAPABILITY_MAP.md`, `IMPLEMENTATION_PLAN.md`, `ADR-012`, `ADR-013`, `FUNCTIONAL_ARCHITECTURE.md`, `OPEN_QUESTIONS.md`, `PRODUCT_DECISIONS.md`, and `evidence/WP-012_BUILDER_EVIDENCE.md` — not accepted from the ACR's own citations. Every load-bearing data claim checked (orphaned `pagos` table, missing idempotency key, unconditional `turno_caja_id NOT NULL`, `RESTCARD`/`CXC` enum membership, `ADR-012` compliance, `ADR-013` package placement, `mesas` status enum, outbox reuse) was confirmed accurate against the actual frozen artifacts. No false claim, no overstated finding, and no silently-implied schema change were found. Three non-blocking advisories are raised to sharpen `WP-016C`/`WP-014A`'s eventual specialist review, none of which represent a missing constraint, an `ADR-012` conflict, or an unaddressed (even conceptually) idempotency gap.

## Determination

- **`WP-016C` (POS Payment Orchestration & Account Settlement): DATA-SOUND.** The idempotency-key gap is real, correctly scoped, and closed by a concrete, previously-proven pattern (Expand migration, reusing `WP-012`'s composite-key idempotency design and the existing Outbox for Edge→Cloud sync). Money integrity (`ADR-012`), append-only integrity, package placement (`ADR-013` §4.2), and ownership (`FUNCTIONAL_ARCHITECTURE.md` §6.3, `CAP-OPS-07`) are all independently re-derivable from already-frozen documents, not invented. `RESTCARD`/`CXC` exclusion is data-architecturally sound and migration-safe. Crash-recovery and settlement-atomicity are correctly identified as mandatory acceptance criteria for the implementing WP (advisory: make atomicity explicit by name).
- **`WP-014A` (Dining Operations Expansion) persistence proposal: DATA-SOUND.** No new authoritative `Mesa.status` enum value is implied (independently confirmed against the frozen DDL); the visual-state-as-projection invariant is correctly preserved. Advisory: the ACR's own verification of "no new authoritative status enum" should explicitly extend to `cuentas.status` at specialist-review time, not only `mesas.status` — independently confirmed sufficient here, but not verified by the ACR's own text.

---

*Prepared by `03_Data_Architect` as an independent review of frozen subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`. This document does not approve, merge, or modify any canonical artifact.*
