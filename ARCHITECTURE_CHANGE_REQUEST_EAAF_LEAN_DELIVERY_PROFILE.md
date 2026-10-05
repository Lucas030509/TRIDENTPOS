# ACR-2026-021 — EAAF LEAN DELIVERY PROFILE (TRIDENTPOS)

**Status:** PROPOSED — PENDING PRODUCT OWNER APPROVAL (single review round)  
**Date:** 2026-10-04  
**Scope:** Project-level delivery governance for TRIDENTPOS (no change to product architecture)  
**Governing Framework:** EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362 (unchanged)  
**Canonical Base:** 885855f4b4c51833135a9d384c673ed4bc0e406b  
**Risk Class:** RC3 — governance/control-plane change  
**Authority:** PRODUCT_OWNER_HUMAN — Simón Sánchez  
**Review:** ONE round. Reviewers in parallel: `01_Solution_Architect`, `08_Security_Architect`. Coordinator Quick Integrity only verifies identity/format.

---

## 1. Problem statement (measured on the repository, 2026-10-04)

| Metric | Value |
|---|---|
| Project start (first commit) | 2026-09-01 |
| Total commits (all refs) | 528 |
| Governance / evidence commits | 272 |
| `feat` / `fix` commits | 88 |
| Remote branches | 378 |
| Governance markdown lines vs. production TS/SQL lines | ~26.6k vs. ~27.7k |
| Last change merged to `main` | 2026-09-24 (10 days without integration) |
| WP-020 review rounds | 5 (R1–R5) |
| ACR-2026-020 review rounds | 5 (+ architecture-reopen exception) |
| WP-021 Security cycles | R4, R5, R6 — all HOLD; R7 authorized |
| User-facing POS screens | 0 (WP-026 not started) |
| Protected Product Owner questions | 9 / 9 OPEN |

Root causes:

1. `default_class = RC3` applies full RC3 ceremony to every change, including changes with no fiscal, financial, tenant, auth, sync or destructive-migration surface.
2. Reviews are sequential, one agent per session, relayed manually between tools; every review produces a separate sidecar commit.
3. Blocking findings are allowed on evidence the Builder environment cannot produce (native PostgreSQL concurrency, physical PITR), creating HOLD loops without new defects.
4. Already-canonical artifacts are re-reviewed (e.g. ACR-2026-020 R5 integration review on 2026-10-04 after canonical merge on 2026-09-24).
5. The roadmap builds all back-office bounded contexts before the first end-to-end usable POS flow.

## 2. Decision

TRIDENTPOS adopts the framework module `framework/LEAN_DELIVERY_PROFILE.md` (EAAF 1.4.0-proposed, additive to v1.3.0) and activates agent `19_Lean_Delivery_Orchestrator` as delivery coordinator. The project-level rules are summarized below; on conflict, the framework module governs. Until that module is merged into `Lucas030509/EAAF-Framework`, this ACR carries the rules for TRIDENTPOS. It does not change the pinned framework, the product architecture, any ADR, any data contract, or any non-negotiable EAAF security principle. It changes *how* compliance is demonstrated and *how many* cycles are spent proving it.

### 2.1 Non-negotiable (unchanged)

- Server-side authorization, tenant isolation (RLS / FORCE RLS), no secrets in code/logs/frontend.
- Idempotency for retryable critical writes; append-only ledgers; audit for critical actions.
- Protected `main`, PR required, CI required checks, secret/dependency/security scanning.
- Production Gate (`04_PRODUCTION_GATE`) before any staging or production enablement.
- Builder ≠ Reviewer independence for RC3/RC4.
- `DECISION REQUIRED` / `SECURITY BLOCK` stop conditions for real architecture or security breaks.

### 2.2 Risk classification by surface, not by project

| Class | Applies when the change touches | Required review |
|---|---|---|
| RC0–RC1 | Docs, formatting, tooling with no runtime effect | CI green only (fast track) |
| RC2 (new default) | UI, presentation, read-only queries, non-critical domain logic, tests | CI green + **one** combined review (`11_Code_Reviewer`) |
| RC3 | Money/finance, inventory ledger, sync/offline, auth/IAM, tenant boundaries, schema migrations | CI green + owning specialist **and** `11_Code_Reviewer` **in parallel, same round** |
| RC4 | Fiscal/CFDI, destructive migrations, cross-tenant, key material, external effects with legal consequence | Same as RC3 + `08_Security_Architect` in the same parallel round |

Forced RC3/RC4 signals defined by EAAF v1.3 continue to apply; this profile only stops RC3 from being the default for everything else.

### 2.3 CI is the primary evidence

- Required CI checks (build, lint, typecheck, unit/integration tests, graph enforcement, security scan, migration dry-run) constitute Builder execution evidence. A green CI run on the PR head SHA replaces hand-written Builder evidence documents.
- SHA binding is provided by the PR head SHA and the CI run ID. Reviewer verdicts are recorded as **PR reviews/comments** on that SHA (allowed backend `GITHUB_ATTESTATION` / `CI_ARTIFACT`); separate `evidence/*` sidecar branches become optional, not mandatory.
- One evidence summary per Work Package (`evidence/WP-XXX_SUMMARY.md`), written once at merge.

### 2.4 Blocking rule: "no reproducible defect, no block"

A reviewer may issue BLOCK/HOLD only for:

1. a reproduced defect (failing test, adversarial script or concrete exploit path), or
2. a violated non-negotiable invariant (§2.1) demonstrable from code, or
3. a missing test for an explicit acceptance criterion of the WP.

Evidence that cannot be produced in the Builder environment (e.g. physical PITR, native multi-node concurrency, real PAC behavior) is recorded as `NOT EXECUTED` and routed to **Governance Debt with a blocking target at the Production Gate**, not as a merge blocker — provided the capability ships disabled (feature flag OFF) or is not reachable in production.

### 2.5 Review budget

- Maximum **2** review rounds per WP (`max_review_cycles = 2`).
- After round 2, any remaining non-reproduced finding becomes Governance Debt or an Advisory; a reproduced defect gets one targeted fix verified by the **same** reviewer only on the diff.
- A canonical (merged) artifact is not re-reviewed unless a regression is demonstrated.
- Historical accounting reconstruction (missing past fingerprints/ledgers) is closed as `ACCEPTED_UNVERIFIABLE`; counters restart cleanly under this profile from the canonical base above.

### 2.6 ACR discipline

An ACR is required only when changing an approved decision (ADR, data contract, public API, tenant/auth model). Implementation detail, hardening and test coverage do not require an ACR. ACRs get one review round with all reviewers in parallel.

### 2.7 Roadmap re-sequencing

1. Close WP-021 under the bounded R7 disposition (separate evidence record) and merge with fiscal stamping kill switch **OFF**.
2. **WP-026A → 026B → 026C → 026D** (Native POS UI: shell, salón/orden, KDS, caja/cobro) over the existing canonical backend — first end-to-end usable flow.
3. WP-016 (cash/shifts) as required by 026D.
4. WP-022 (CRM), WP-023 (Delivery), WP-024 (Backoffice), WP-025 (Comandero) after the first usable flow, in that order unless the Product Owner reprioritizes.
5. WP-027/028 (E2E, chaos, packaging) **must** close all Governance Debt whose blocking target is the Production Gate.

### 2.8 Product Owner decisions

The 9 protected open questions (OQ-SSOT-01..07, OQ-ARCH-01..02) are resolved in a single dedicated Product Owner session before WP-026B starts; each gets one decision record. Agents shall not reopen them.

## 3. Manifest change

Only schema-authorized values change:

```json
"risk_policy": { "default_class": "RC2", "fast_track_enabled": true },
"execution_budget": { "max_review_cycles": 2 }
```

All other manifest values remain as canonical. If the pinned v1.3 schema rejects `RC2` as `default_class`, `RC3` is retained and §2.2 governs classification per change.

## 4. Success metrics (reviewed after 14 days)

| Metric | Target |
|---|---|
| Lead time RC2 WP (branch → merge) | ≤ 3 days |
| Lead time RC3/RC4 WP | ≤ 7 days |
| Review rounds per WP | ≤ 2 |
| `feat`/`fix` share of commits | ≥ 60 % |
| Escaped defects found after merge in RC3/RC4 areas | 0 critical |

If any critical escaped defect appears in RC3/RC4 areas, the Product Owner may revert this profile for that bounded context with a one-line decision record.

## 5. Consequences

- Positive: fewer cycles, parallel reviews, CI-based evidence, earliest usable product.
- Negative: some production-grade evidence (native PITR, real PAC) moves from merge time to the Production Gate. Mitigated by feature flags OFF and the Production Gate remaining unchanged.
- Neutral: framework, ADRs and architecture untouched.

## 6. Formal status

```
ACR_ID=ACR-2026-021
FRAMEWORK_CHANGE=NO
ARCHITECTURE_CHANGE=NO
MANIFEST_CHANGE=risk_policy.default_class=RC2; execution_budget.max_review_cycles=2
PRODUCTION_GATE_CHANGE=NO
REVIEW_ROUNDS_FOR_THIS_ACR=1 (parallel: 01, 08)
PRODUCT_OWNER_APPROVAL=PENDING
```
