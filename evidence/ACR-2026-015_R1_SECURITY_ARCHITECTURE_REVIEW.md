# ACR-2026-015 (R1) — Independent Security Architecture Review

**Reviewer Agent:** `08_Security_Architect`
**Frozen Subject SHA:** `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`
**Reviewer Branch:** `review/acr-2026-015-r1-security`
**Exact Parent (verified via `git log -1 --format="%H %P"` on the frozen subject):** `7117308df6db9e0a1f9fcb87aa365da541549695`
**Canonical `main` traced to (verified via `git merge-base`):** `f655551085dea3cff887a411adec4026842aed07`

## Conflict of Interest Declaration

The reviewer did not author `ACR-2026-015` (R1 or the superseded `7117308` candidate), did not author `TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md`, and holds no prior session state on this ACR. This is a fresh, independent sidecar review performed against the frozen subject commit only. No canonical document, the ACR, or the Matrix was modified by this review.

## Sources Inspected (Independently Read, Not Assumed From the ACR's Own Claims)

- `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` @ frozen subject — full document (Sections 0 through AB), with emphasis on Sections G, K, M, N per review scope
- `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` @ frozen subject — full document
- `ADR/ADR-003-edge-host-runtime-electron-vs-tauri.md` — Electron runtime, Section 9 (Security Considerations)
- `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md` (Money authority context)
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md` — Section 4.2 dependency-responsibility matrix, package graph rules (lines 30–32, 113, 124, 127, 131–133)
- `DATA_MODEL.md` — `pagos` DDL (lines 962–972), `mesas` DDL (lines 878–886), `outbox_queue` DDL (lines 975–988), `local_audit_trail` DDL (lines 990–1002)
- `DATA_AUTHORITY_MATRIX.md` — "Pagos & Transacciones de Cobro" row (line 36) and header (line 20)
- `CAPABILITY_MAP.md` — `CAP-OPS-07` (lines 82, 139)
- `FUNCTIONAL_ARCHITECTURE.md` — Section 6.3 "Contrato TRIDENTPOS ↔ Finance / Billing" (lines 315–326), including the `CuentaPagada` event field shape
- `OPEN_QUESTIONS.md` — `OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-06`, `OQ-SSOT-07`, `OQ-ARCH-01` (lines 28–35, 48ff, 139ff)
- `PRODUCT_DECISIONS.md` — confirmed absence of the five protected IDs; `DEC-006` status `APROBADA` (lines 21, 81)
- `evidence/WP-007_BUILDER_EVIDENCE.md` — Electron hardening baseline (contextIsolation/nodeIntegration/sandbox proofs, contextBridge allowlist, `IpcDispatchGuard`, fail-closed negative tests)
- `evidence/WP-009_BUILDER_EVIDENCE_R5.md` — Edge secure-storage pattern (`StationPinStore`, `ElectronSafeStorageBackend`, OS Keychain/DPAPI/Secret Service, fail-closed Linux keyring allowlist)
- `evidence/WP-012_BUILDER_EVIDENCE.md` — `IngestedIdempotencyLog` composite-key pattern (lines 85–95, 141, 246, 270, test table)

## Findings

### F-1 (Verified, no issue). Payment adapter package boundary is correctly scoped per `ADR-013`.
The ACR (G.6) states settlement business logic (tender lines, idempotency check, state machine, `CuentaPagada` emission) belongs in `@trident/pos`, while the physical card-terminal socket/driver I/O belongs in `@trident/edge` as a generic technical primitive with no settlement business rules, wired together only at `@trident/pos-edge-runtime`. Independently confirmed against `ADR-013` §4.2: line 113 explicitly lists "Cobro POS (`pagos`)" as `@trident/pos` domain responsibility; line 124 defines `@trident/edge` as infra-only (Electron runtime, IPC security, SQLite, outbox, Bonjour, local crypto) with no business-logic mandate; the package graph (`ALLOWED_INTERNAL_DEPENDENCIES`) forbids `@trident/pos → @trident/edge` and vice versa. The claimed placement is accurate, not asserted-and-unverified, and correctly prevents a payment-terminal-adapter-as-business-logic anti-pattern. **No issue.**

### F-2 (Verified, no issue). The `pagos` idempotency gap is real, and the remediation direction is concrete, not vague.
Independently read the frozen `pagos` DDL (`DATA_MODEL.md` lines 963–972): columns are `id, cuenta_id, turno_caja_id, payment_method, amount, tip_amount, reference_auth_code, created_at` — confirmed **no idempotency-key column of any kind**. Independently read `DATA_AUTHORITY_MATRIX.md` line 36: the Pagos row explicitly requires "Append-Only + Idempotency Key" integrity. This is a genuine, pre-existing, previously-unowned schema gap, exactly as the ACR states — it is not manufactured by this ACR to justify `WP-016C`. The ACR's proposed remediation (G.3) — extend `pagos` with a `client_op_id`/idempotency-key column following `WP-012`'s `IngestedIdempotencyLog` composite-key pattern — was checked against `evidence/WP-012_BUILDER_EVIDENCE.md`: the exact composite tuple `(orgId, branchId, aggregateType, aggregateId, action, clientOpId)` is a real, already-implemented, already-tested pattern in this codebase (lines 85–95, 270; `uq_idempotency_log_client_op` constraint). This is a sufficiently specific architecture-level direction — it names the mechanism, the precedent, and the migration type (Expand). Implementation-level detail (exact column/constraint naming, retry-window semantics) is correctly left to `WP-016C` build time. **This satisfies the review brief's bar: double-settlement/idempotency is not "genuinely absent as a concern" — it is named, schema-grounded, and given a sound concrete direction. Not a blocker.**

### F-3 (Verified, no issue). Crash-after-authorization/before-persistence is named and assigned to a specific future review gate, not silently dropped.
Sections G.7 and M name the exact scenario in the review brief ("process crashes after external card-terminal authorization but before local durable persistence") and state explicitly that `WP-016C` "cannot pass independent review without a defined answer" to it, that this is "a data/security architecture decision, not a UI concern," and binds it to `WP-016C`'s own mandatory specialist reviewer pairing (`03_Data_Architect` + `08_Security_Architect`, Section G/V.2) rather than deferring it to `WP-026D` (payment UI). This matches the review brief's own stated acceptable disposition at ACR/roadmap stage: a named risk assigned to a specific future review gate, not a risk left unaddressed. **Not a blocker**, though see Advisory A-2 below for a concrete recommendation to strengthen this at implementation time.

### F-4 (Verified, no issue). `reference_auth_code` is treated consistently with its actual sensitivity.
`reference_auth_code` is confirmed present in the frozen `pagos` DDL as `TEXT NULL` (line 970), inside an append-only table. The ACR (G.2) correctly treats it as payment-authorization metadata requiring integrity (append-only, immutable once written) rather than as a secret requiring encryption-at-rest — this is architecturally correct for a processor-issued authorization/reference code, which is not itself a credential. No issue found.

### F-5 (Verified, no issue). No silent default on protected decisions or authorization boundaries.
Independently confirmed against `OPEN_QUESTIONS.md` (lines 28–35, 48ff) and `PRODUCT_DECISIONS.md` (only `DEC-006` present, `APROBADA`) that all five protected IDs (`OQ-SSOT-01` CancellationPolicy, `OQ-SSOT-02` TransferValidationRule, `OQ-SSOT-06` BillSplitProrationStrategy, `OQ-SSOT-07` ModifierRecipeResolver, `OQ-ARCH-01` multi-cashier shift model) remain open and undecided in canonical documents. The ACR (Section N, H.3, G.4) correctly keeps all five open — it reuses `WP-014`'s existing parameterization hooks rather than resolving them, and explicitly states `WP-016C` "must not decide whether multiple cashiers may share one drawer/shift" (G.4). The supporting Matrix likewise flags "Aplicar descuento" as needing an authorization policy not yet defined, rather than defaulting it. No protected authorization-relevant decision is silently closed.

### F-6 (Verified, no issue). `ADR-003` context-isolation/`nodeIntegration` posture is preserved, not redecided.
`ADR-003` Section 9 mandates "Context isolation activado en Electron; desactivación de `nodeIntegration`." Independently confirmed against `evidence/WP-007_BUILDER_EVIDENCE.md` that this is not merely a paper policy: production `BrowserWindow` preferences are verified at runtime (`contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true`), IPC is restricted to an explicit `contextBridge` allowlist (`window.tridentBridge` with only `ping`/`getSystemMetadata`/`getHealthStatus`, generic `send`/`invoke` confirmed absent), and negative tests fail closed on any regression (`WP007-T03`–`T05`). The ACR (Section K, W.11) states this posture is "unaffected" and that `WP-026A` "must not weaken it," and structurally reinforces this by making `WP-026A` implementation-only — consuming a frozen `FRONTEND_ARCHITECTURE.md` rather than deciding IPC/isolation architecture itself, with `01_Solution_Architect` reviewing conformance rather than re-litigating the decision (Section I.0, `WP-026A` entry). No new IPC surface is defined by this ACR itself; any new surface introduced later is hard-gated behind the existing WP-007 baseline by construction of the required sequence in Section I.0. This is an appropriate roadmap-level treatment — the ACR neither weakens nor silently re-opens the isolation posture.

### F-7 (Verified, no issue). Offline card-terminal behavior is correctly not assumed.
G.7's last bullet and Section O explicitly state no offline card-terminal behavior may be assumed until a terminal/provider adapter is selected, and that this ACR does not select one. Confirmed no contrary claim exists elsewhere in the document.

### F-8 (Verified, no issue). No weakening of `WP-016` shift-gating is proposed; the ACR's own correction (Section 0 item 5) strengthens it.
Independently confirmed `pagos.turno_caja_id` is `NOT NULL` with no conditional logic in the DDL (line 966) — the ACR's claim that all tender types (not just cash) are gated on an open shift is accurate, and this is used correctly to strengthen (not weaken) the `WP-016C → WP-016` prerequisite (G.3).

### A-1 (Advisory — gap, not a blocker). Terminal credential/secret storage location is unaddressed by the ACR.
The ACR names "payment adapter/credential surface" repeatedly (Section G reviewer rationale, K, V.2) as a reason `08_Security_Architect` review is mandatory, but the document never states where terminal credentials/API keys would be stored, nor references any existing secure-storage mechanism. This matters because the codebase already has a directly-applicable, governed precedent: `evidence/WP-009_BUILDER_EVIDENCE_R5.md` documents `StationPinStore`/`ElectronSafeStorageBackend`, an Electron `safeStorage`-backed secret store using native OS Keychain/DPAPI/Secret Service with fail-closed semantics (including a strict Linux keyring allowlist rejecting `basic_text`). The ACR does not point `WP-016C` at this pattern, and is silent on prohibiting renderer-accessible or plain-config storage of terminal credentials. Per the review brief's own guidance, this is a gap to flag rather than a blocker at this roadmap-level ACR, since no concrete provider/adapter is selected yet and credential handling is inherently provider-specific. **Recommendation:** `WP-016C`'s implementation-time `08_Security_Architect` review should mandate reuse of the WP-009 `safeStorage`/OS-keyring pattern (or an equivalent fail-closed OS-level secure store) for any terminal credential, and should explicitly prohibit persisting such credentials in renderer-reachable state, `@trident/pos-edge-runtime` plain config, or any IPC-exposed object.

### A-2 (Advisory — strengthening, not a blocker). Crash-recovery disposition should require a concrete protocol, not just a checkbox, at `WP-016C` review time.
F-3 above confirms the crash-after-authorization scenario is correctly named and gated to a specific review pairing. To ensure this gate is substantive rather than perfunctory, the implementation-time `03_Data_Architect` + `08_Security_Architect` review of `WP-016C` should require a concrete reconciliation protocol as an acceptance criterion — e.g., an idempotent replay-safe confirm/commit step keyed by the new idempotency column, plus reconciliation against the terminal's own batch/settlement report using `reference_auth_code` — before code review sign-off, not merely confirmation that the topic was discussed.

### A-3 (Advisory — minor). Audit binding for settlement events is not made explicit.
The ACR names "auditability" as a first-class `WP-016C` acceptance criterion (W.12) but does not state how `pagos`/`CuentaPagada` settlement rows are cross-referenced to actor/station/timestamp/reference for audit purposes. Independently verified this is achievable with existing frozen mechanisms without new architecture: `local_audit_trail` (actor_id, station_id, action, aggregate_id, created_at, reason) and the already-frozen `CuentaPagada` event shape (`estacionId`, `meseroId`, `formasPago[]`, `montos`) both already carry the needed fields. **Recommendation:** `WP-016C` implementation should explicitly bind settlement to `local_audit_trail` (or equivalent) rather than leaving the linkage implicit.

### A-4 (Advisory — governance, not directly a security-control issue). `05_Frontend_Architect` role has no repository precedent.
The ACR self-discloses (Sections 0-R1 item 1, I.0) that `05_Frontend_Architect` — the role assigned to author and gate `FRONTEND_ARCHITECTURE.md`, which governs IPC/API boundary decisions relevant to the WP-007 security posture — has zero precedent across 14 prior ACRs and 28+ completed WPs, where `01_Solution_Architect` was always used instead. The ACR is transparent about this rather than hiding it, and correctly states the substantive architect/builder role-separation is sound regardless of the exact label. Flagged here because the Frontend Architecture Gate is the mechanism through which future IPC-surface decisions get made, and its reviewer-identity chain should be confirmed against the pinned EAAF framework before that gate is exercised.

## Blocking Findings Count

**0**

## Advisories Count

**4**

## Verdict

**PASS WITH ADVISORIES**

## Final Status

`ACR-2026-015` (R1, subject `2c90a43c5dcfe0b01a80f60bf4c0ca529c1d13d9`) is approved from a security-architecture perspective to proceed toward Product Owner approval and downstream independent review, subject to the four non-blocking advisories above being carried forward into `WP-016C`'s (and, for A-4, the Frontend Architecture Gate's) own implementation-time specialist review. No unresolved HIGH-severity security design issue was found to be silently absent: the double-settlement/idempotency risk is independently verified as a real, pre-existing schema gap and is given a concrete, precedent-grounded remediation direction (F-2); the crash-after-authorization risk is named and explicitly bound to a specific mandatory future review gate rather than dropped (F-3); the Electron context-isolation/`nodeIntegration` posture is independently confirmed intact and structurally protected against being redecided inside `WP-026A` (F-6); and no protected authorization-relevant decision is silently defaulted (F-5). This review does not itself authorize any Work Package, close any protected Product Owner decision, or modify any canonical document.
