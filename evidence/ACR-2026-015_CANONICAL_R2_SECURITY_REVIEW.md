# ACR-2026-015 (Canonical R2) — Independent Security Architecture Review

**Reviewer Agent:** `08_Security_Architect`
**Frozen Subject SHA:** `67970cfdcf5971ae2a1f41386d0a253268705083`
**Canonical Baseline SHA:** `f655551085dea3cff887a411adec4026842aed07` (`main`)
**Reviewer Branch:** `review/acr-2026-015-canonical-r2-security`
**Exact Parent:** verified after commit via `git log -1 --format="%H %P"` — must equal `67970cfdcf5971ae2a1f41386d0a253268705083` exactly (recorded in the commit metadata of this review; see repository history for the literal value at time of push).

## Reviewer Instance Independence Declaration

This review is performed by a fresh instance with no prior involvement in authoring, remediating, synthesizing, or self-reviewing `ACR-2026-015`, its superseded R1 candidate, or this canonical-amendment candidate. No canonical document, the ACR text, the productization matrix, or any evidence file was modified by this review — only this single review file was added, and only on this reviewer branch. All findings below were independently re-derived by reading the Frozen Subject's actual tree content and by cross-checking cited precedents (`WP-007`, `WP-009`, `WP-012` evidence) as they exist on canonical `main`; the candidate's own self-description (`evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md`) was treated as a claim to verify, not as ground truth, and a prior sidecar R1 security review (commit `478055614f283d3f921ef8bf94ac42b93795fab1`) was consulted only as corroborating history, not as a substitute for independent verification against this Frozen Subject.

## Artifacts Inspected

- `IMPLEMENTATION_PLAN.md` @ Frozen Subject — full `WP-016C` entry (lines 741–776); full `WP-026` umbrella reclassification, Frontend Architecture Gate, and `WP-026A`–`WP-026D` entries (lines 1028–1142); DAG section (lines 1298–1336); `SEC-VAL-07` row (line 1377)
- `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` @ Frozen Subject — Sections G (full), M, I, K, N
- `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` @ Frozen Subject (candidate's own governance-lineage claim, verified below, not trusted as-is)
- `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md` @ Frozen Subject (spot-checked against diff-stat claim of "byte-identical except metadata")
- `evidence/WP-007_BUILDER_EVIDENCE.md` @ canonical `main` (unmodified by candidate — Electron hardening baseline: `contextIsolation`, `nodeIntegration`, `sandbox`, IPC `contextBridge` allowlist, negative fail-closed tests `WP007-T03`–`T05`)
- `evidence/WP-009_BUILDER_EVIDENCE_R5.md` @ canonical `main` (unmodified by candidate — `StationPinStore`/`ElectronSafeStorageBackend` secure-storage pattern, OS Keychain/DPAPI/Secret Service, fail-closed injection rejection, Gates B/I `PASS`)
- `evidence/WP-012_BUILDER_EVIDENCE.md` @ canonical `main` (unmodified by candidate — `IngestedIdempotencyLog` composite-key pattern `(organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id)`, tests `WP012-T05`/`T07` `PASS`)
- Sidecar commit `478055614f283d3f921ef8bf94ac42b93795fab1:evidence/ACR-2026-015_R1_SECURITY_ARCHITECTURE_REVIEW.md` (prior independent R1 security review, consulted for corroborating history only)
- `git diff --stat` between Canonical Baseline and Frozen Subject (confirms exact file set touched); targeted diffs confirming `PRODUCT_DECISIONS.md`, `OPEN_QUESTIONS.md`, `MODULE_CATALOG.md`, `CAPABILITY_MAP.md`, `PRODUCT_SCOPE.md`, and all three cited `WP-007`/`WP-009`/`WP-012` evidence files are byte-identical to canonical `main` (empty diff)

**Confirmed file set touched by this candidate (relative to canonical baseline):** `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md`, `docs/governance/TRIDENTPOS_SALON_PRODUCTIZATION_MATRIX.md`, `evidence/ACR-2026-015_CANONICALIZATION_EVIDENCE.md` — 4 files, 1053 insertions / 39 deletions. No evidence file for `WP-007`/`WP-009`/`WP-012` was touched; the secure-storage and Electron-hardening precedents this candidate cites are confirmed unmodified and accurately quoted.

## Expected vs Actual — 10 Independent Checks

### WP-016C

**1. Is payment idempotency a concrete, binding requirement modeled on `WP-012`'s proven pattern?**
Expected: a named, testable acceptance criterion, not narrative.
Actual: `DATA-COND-015-02` (line 761) — "Canonical payment idempotency implemented via an Expand migration adding a `client_op_id`/idempotency-key column to `pagos`, following the proven `WP-012` composite-key pattern, or an architecture-reviewed equivalent." Independently confirmed the `WP-012` pattern is real (`evidence/WP-012_BUILDER_EVIDENCE.md`, composite tuple, `uq_idempotency_log_client_op`, `PASS` tests). **Match — PASS.**

**2. Is double-settlement explicitly protected against as a testable requirement?**
Expected: explicit anti-duplication language plus a corresponding test.
Actual: Acceptance Criterion item 6 (line 765) — "No duplicate tender line on retry; no double account settlement" — plus `Tests` (line 766): "Idempotent retry simulation (duplicate submission of an identical tender, exactly one settlement executes)." **Match — PASS.**

**3. Is there a hard requirement that terminal credentials/secrets use an OS-level fail-closed secure store, labeled as an acceptance criterion?**
Expected: a named criterion (e.g. `SEC-COND-015-01`) binding to the `WP-009` pattern or an approved equivalent.
Actual: `SEC-COND-015-01` (line 762) — "Any card-terminal credential / API secret uses the `WP-009` secure-storage pattern (`StationPinStore` / `ElectronSafeStorageBackend`, OS Keychain / DPAPI / Secret Service, fail-closed) or an independently approved equivalent OS-level fail-closed secure store." Independently confirmed `StationPinStore`/`ElectronSafeStorageBackend` is a real, `PASS`-gated mechanism in `evidence/WP-009_BUILDER_EVIDENCE_R5.md` (Gates B, I). **Match — PASS.**

**4. Does that requirement forbid all five: renderer `localStorage`, renderer-accessible secrets, plaintext config, IPC-exposed credential payloads, source-controlled credentials?**
Expected: all five prohibitions present, not a subset.
Actual: same sentence (line 762) continues — "Explicitly forbidden: renderer `localStorage`; renderer-accessible secrets; plaintext config; IPC-exposed credential payloads; source-controlled credentials." All five present verbatim. **Match — PASS.**

**5. Is a concrete crash-reconciliation protocol required (not a mere "risk was considered" statement)?**
Expected: the acceptance criterion itself must forbid the weak disposition and demand concrete replay/idempotency semantics.
Actual: `SEC-COND-015-02` (line 763) — "A concrete crash-reconciliation protocol is defined for 'external authorization succeeded, local durable settlement not yet committed,' including replay/idempotency semantics — a statement that the risk was considered is not sufficient to pass this criterion." Corroborated by `ARCHITECTURE_CHANGE_REQUEST_SALON_PRODUCTIZATION.md` Section M, which states `WP-016C` "cannot pass independent review without a defined answer" to this exact scenario, and by the WP's own `Tests` line ("crash-then-recover simulation between terminal authorization and local persistence") and `Evidence Required` line ("crash-recovery test log"). The actual protocol content (e.g., replay-safe confirm/commit keyed by `client_op_id`, reconciliation against terminal batch report) is correctly deferred to `WP-016C`'s own mandatory build-time specialist review (`03_Data_Architect` + `08_Security_Architect`) — appropriate at roadmap-plan granularity, since no concrete terminal/provider is yet selected, but the criterion is structurally binding, not discretionary, and explicitly disallows a narrative-only disposition. **Match — PASS**, with an advisory (see below) that the criterion's satisfaction still depends on that future gate actually being exercised rigorously.

**6. Is settlement explicitly bound to a named canonical audit primitive, not left implicit?**
Expected: a named primitive (e.g. `local_audit_trail`) with the specific fields required.
Actual: `SEC-COND-015-03` (line 764) — "Settlement is explicitly bound to operational audit evidence (actor, station, timestamp, account, payment reference, tender lines), reusing `local_audit_trail` or an equivalent canonical audit primitive rather than leaving the linkage implicit." Independently confirmed `local_audit_trail` is a real, pre-existing canonical primitive (`DATA_MODEL.md` line 991 DDL; used in `WP-006`, `WP-008`, `SEC-06`/`THR-06` risk and threat model entries), not invented for this ACR. **Match — PASS.**

### WP-026A–D

**7. Is the Electron context-isolation / `nodeIntegration`-disabled posture explicitly preserved?**
Expected: explicit non-weakening language plus a regression test.
Actual: `WP-026A` Acceptance Criteria (line 1058) — "Preserves `ADR-003`'s Electron context-isolation / `nodeIntegration`-disabled posture without weakening it or `WP-007`'s security controls." `Tests` (line 1059) includes a "context-isolation regression test." **Match — PASS.**

**8. Does anything in `WP-026A`–`D` risk a new IPC surface bypassing the `WP-007` allowlist?**
Expected: no independently-invented IPC surface; explicit binding to the existing allowlisted bridge.
Actual: `WP-026A`'s `APIs / Contracts` (line 1050) reads "Local IPC Bridge (`window.electronAPI`), consumed per the approved Frontend Architecture, not redesigned here." No sub-WP defines a new IPC mechanism; all consume whatever `FRONTEND_ARCHITECTURE.md` defines under the existing frozen stack. **No bypass risk identified — PASS.**

**9. Are IPC/API boundaries an architectural prerequisite (Frontend Architecture Gate), consumed not invented by `WP-026A`?**
Expected: the gate document, not the WP, owns this decision; the WP's acceptance criteria enforce non-invention.
Actual: The Frontend Architecture Gate (lines 1037–1043) requires `FRONTEND_ARCHITECTURE.md` to "explicitly define... API/IPC boundaries" before `WP-026A` START (`FE-COND-015-01`). `WP-026A`'s own Acceptance Criteria (`FE-COND-015-02`, line 1058) states "every architectural choice implemented (routing, state, session, IPC/API...) already exists in the approved `FRONTEND_ARCHITECTURE.md`; none is decided inside this WP," and its Specialist Reviewer role is explicitly framed as verifying conformance, "does not re-decide architecture at this stage" (line 1052). **Match — PASS.**

**10. Does `WP-026D` disclaim authoritative settlement logic, deferring to `WP-016C`'s domain layer?**
Expected: explicit non-authority language naming `@trident/pos`.
Actual: `WP-026D` Acceptance Criteria (line 1133) — "No authoritative payment logic may reside only in frontend state — all settlement logic lives in `WP-016C` (`@trident/pos`); this WP only presents it." Also: "Crash-recovery UX must reflect, not re-implement, `WP-016C`'s `SEC-COND-015-02` reconciliation protocol." **Match — PASS.**

## Findings

All ten checks independently verified as **matched** against the Frozen Subject's actual text — not merely asserted by the candidate's own evidence file, which I treated as a claim requiring re-derivation. Corroborating history: a prior sidecar R1 security review (`478055614f2...`) found the same substance at an earlier candidate stage and raised four advisories (terminal-credential-storage gap, crash-recovery-protocol rigor, audit-binding explicitness, `05_Frontend_Architect` role precedent). This canonical-R2 candidate has since converted three of those four R1 advisories (A-1 secure storage, A-2 crash-recovery concreteness, A-3 audit binding) into binding, named acceptance criteria (`SEC-COND-015-01`/`-02`/`-03`) directly on `WP-016C`'s `IMPLEMENTATION_PLAN.md` entry — a genuine strengthening, not a restatement. No unresolved HIGH-severity security design omission was found: the payment-adapter credential surface has a defined, named, fail-closed secure-storage requirement (check 3/4); the crash-recovery scenario is not left unaddressed — it is a binding, tested, evidenced acceptance criterion (check 5).

## Blockers

**0**

## Advisories

**2**

1. **A-1 (carried forward, non-blocking).** `SEC-COND-015-02`'s concrete crash-reconciliation protocol content (the actual replay/confirm-commit mechanics) is correctly deferred to `WP-016C`'s own build-time specialist review rather than specified at roadmap-plan granularity — appropriate given no card-terminal provider is yet selected. This defers real satisfaction of the criterion to a future gate; that future `03_Data_Architect` + `08_Security_Architect` review must reject any implementation that merely documents the risk without a concrete, tested replay-safe mechanism, exactly as the criterion's own text requires. Recommend this review file's finding on check 5 be cited at that future gate as the standard the implementation must meet.
2. **A-2 (carried forward from R1, non-blocking, governance not control).** `05_Frontend_Architect`, the role gating `FRONTEND_ARCHITECTURE.md` (and therefore IPC/API boundary decisions relevant to `WP-007`'s posture), has no prior precedent in this repository's 14+ prior ACRs; the candidate is transparent about this rather than concealing it. Recommend the reviewer-identity/role chain be confirmed against the pinned EAAF framework before that gate is exercised, though this does not itself weaken any existing control.

## Remaining Risks

- `SEC-COND-015-01`/`-02`/`-03` are binding acceptance criteria on a not-yet-built `WP-016C`; their real security value depends entirely on `WP-016C`'s own future mandatory specialist review (`03_Data_Architect` + `08_Security_Architect`) actually enforcing them at build time rather than accepting a diluted implementation. This review's role is limited to confirming the roadmap-level requirement is binding and complete, which it is.
- `OQ-ARCH-01` (multi-cashier shift model) remains an explicitly open, unresolved Product Owner decision that both `WP-016C` and `WP-026D` correctly consume without deciding — confirmed still OPEN in `PRODUCT_DECISIONS.md`/`OPEN_QUESTIONS.md` (both unmodified by this candidate).
- No concrete card-terminal provider/adapter is yet selected; several requirements (offline terminal behavior, exact reconciliation query mechanics) are necessarily abstract until one is chosen. This is disclosed by the candidate (Explicit First-Slice Exclusions, Section O) rather than hidden.

## Verdict

**PASS**

## Final Status

`ACR-2026-015` canonical-amendment candidate (Frozen Subject `67970cfdcf5971ae2a1f41386d0a253268705083`) is independently approved from a security-architecture perspective for `WP-016C` (POS Payment Orchestration & Account Settlement) and the `WP-026A`–`WP-026D` decomposition. All ten independently-verified checks matched the candidate's actual text on inspection, with no unresolved HIGH-severity security design omission found. Zero blockers; two non-blocking advisories carried forward for enforcement at each named WP's own future build-time specialist review. This review does not itself authorize any Work Package to start, close any protected Product Owner decision, merge this candidate, or modify any canonical document.
