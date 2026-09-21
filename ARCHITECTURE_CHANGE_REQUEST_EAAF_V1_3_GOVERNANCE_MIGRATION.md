# ACR-2026-019 — TRIDENTPOS EAAF v1.3 GOVERNANCE PIN MIGRATION

**Status:** PROPOSED / FROZEN CANDIDATE R1 — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-21  
**Scope:** Governance/control-plane only; no application runtime behavior  
**Canonical Base:** `26b606ad73acc37263a610dc9f0c979291b810a6`  
**Current Project Pin:** EAAF v1.2.0 @ `7e036f43240b3dc28ccb996e350263598275b2cd`  
**Target Framework:** EAAF v1.3.0 @ `167cea36c09c1031c763971ff790db2e0d0f7362`  
**Framework Branch:** `codex/eaaf-v1.2-governance`  
**Risk Class:** RC3 — HIGH (governance/control-plane migration)  
**Protected Product Owner Questions:** all existing OPEN questions remain OPEN  
**Application WPs:** no WP is completed, reopened, or approved by this ACR

---

## 1. Problem Statement

Canonical TRIDENTPOS `main` still declares EAAF v1.2.0 in `project-manifest.json`, while current WP-021 candidate evidence claims execution under EAAF v1.3.0.

That is a governance contradiction.

A work package cannot claim EAAF v1.3 controls, evidence semantics, Circuit Breakers, Human Decision Gates, or anti-false-PASS protections unless the governed project has formally adopted and pinned the exact EAAF v1.3 canonical commit.

Therefore:

**WP-021 may not advance to an EAAF v1.3 governed PASS while canonical TRIDENTPOS remains pinned to EAAF v1.2.0.**

This ACR defines the migration without changing product behavior, architecture semantics, fiscal policy, data ownership, or any protected Product Owner decision.

---

## 2. Target Canonical Framework

TRIDENTPOS SHALL adopt:

- Repository: `Lucas030509/EAAF-Framework`
- Version: `1.3.0`
- Branch/reference context: `codex/eaaf-v1.2-governance`
- Exact canonical commit: `167cea36c09c1031c763971ff790db2e0d0f7362`

The commit, not the mutable branch name, is authoritative.

No later framework SHA may be substituted without a separate governed migration.

---

## 3. EAAF v1.3 Controls Activated by Adoption

The migration activates the EAAF v1.3 governance model for subsequent governed work, including:

- Risk Classes RC0–RC4.
- Forced minimum risk classifications.
- Risk-Based Fast Track only where explicitly permitted.
- Execution budgets and Circuit Breakers.
- Stable blocker recurrence accounting.
- Human Decision Gates.
- Evidence Levels E0–E5.
- Evidence backends:
  - `GIT_SIDECAR`
  - `GITHUB_ATTESTATION`
  - `CI_ARTIFACT`
- Exact Frozen Subject binding.
- Machine-readable anti-false-PASS constraints.
- Declared Architecture vs Observed Architecture controls.
- Architecture Drift status.
- Governance Debt register.
- Production feedback → Candidate ACR flow.
- GitHub remains technical authority; external project-management systems are operational-only.

Builders continue to have zero self-approval authority.

---

## 4. Canonical Manifest Migration

The existing root `project-manifest.json` is a legacy extended EAAF v1.2 project-state document and does not conform to the EAAF v1.3 `schemas/project-manifest.schema.json`, whose root has `additionalProperties: false`.

The migration SHALL NOT silently delete historical project metadata.

### 4.1 Historical preservation

Before replacing the active manifest:

- copy the existing canonical `project-manifest.json` byte-for-byte to:
  - `project-manifest.v1.2-legacy.json`
- mark that file:
  - historical;
  - non-authoritative for future gate decisions;
  - preserved for traceability only.

No historical SHA, PR, evidence pointer, or WP status from the legacy manifest may be rewritten during migration.

### 4.2 New EAAF v1.3 active manifest

The new canonical `project-manifest.json` SHALL conform exactly to the pinned EAAF v1.3 schema and contain only schema-authorized properties.

Target governance configuration:

```json
{
  "project": "ERP RESTAURANTES / TRIDENTPOS",
  "eaaf_repository": "https://github.com/Lucas030509/EAAF-Framework",
  "eaaf_commit": "167cea36c09c1031c763971ff790db2e0d0f7362",
  "project_repository": "https://github.com/Lucas030509/TRIDENTPOS.git",
  "default_branch": "main",
  "preferred_evidence_backend": "GIT_SIDECAR",
  "allowed_evidence_backends": [
    "GIT_SIDECAR",
    "GITHUB_ATTESTATION",
    "CI_ARTIFACT"
  ],
  "risk_policy": {
    "default_class": "RC3",
    "fast_track_enabled": true
  },
  "execution_budget": {
    "max_builder_iterations": 3,
    "max_review_cycles": 3,
    "max_same_blocker_recurrence": 1,
    "max_same_cause_ci_failures": 2,
    "max_architecture_reopens": 1,
    "max_token_or_quota_units": null,
    "max_runtime_seconds": null
  },
  "generated_architecture": {
    "enabled": false,
    "drift_blocks_rc3_rc4": true
  }
}
```

### 4.3 Rationale for project defaults

- `default_class = RC3`: TRIDENTPOS is a multi-tenant ERP with persistent data, integrations, fiscal/financial functions, offline/sync behavior, and security boundaries. Explicitly lower classes remain possible only when evidence shows the change qualifies.
- `fast_track_enabled = true`: allows valid RC0/RC1 constrained changes, but may never bypass a forced RC3/RC4 signal.
- `GIT_SIDECAR` remains preferred because it matches the repository's established immutable review-evidence workflow.
- all three EAAF v1.3 immutable evidence backends are allowed.
- generated architecture remains disabled until a separate governed change configures an observed-architecture generator. No Architecture Drift PASS may be claimed from insufficient observation.

---

## 5. Current-State Authority After Migration

The EAAF v1.3 manifest is a governance configuration artifact, not a replacement for historical execution evidence.

Current implementation state SHALL continue to be established by:

1. canonical Git history;
2. canonical merge commits;
3. immutable review/gate evidence;
4. ACR current-state overlays where applicable;
5. exact-head CI/security evidence;
6. post-merge validation.

The legacy v1.2 manifest is historical evidence only.

No WP status may be inferred solely from the new minimal v1.3 manifest.

---

## 6. Governance Debt Register

EAAF v1.3 requires governed projects to maintain a Governance Debt register.

Migration implementation SHALL create:

`GOVERNANCE_DEBT.md`

The register may initially contain zero migrated items if an item cannot be supported directly from canonical repository evidence during the migration.

No unresolved blocker may be relabeled as Governance Debt merely to permit a PASS.

A blocker is eligible for Governance Debt only under the canonical EAAF v1.3 eligibility rules.

---

## 7. Open Questions and Human Decisions

This migration changes no product, fiscal, data, security, or operational decision.

Specifically:

- `OQ-ARCH-02` remains OPEN.
- no automatic fiscal scheduler is authorized.
- no PAC provider is selected.
- no PAC retry/reconciliation semantics are invented.
- no CFDI lifecycle rule is changed.
- no cancellation policy is selected.
- no protected OPEN question is closed.

No Human Decision Gate is satisfied merely by adopting EAAF v1.3.

---

## 8. Circuit Breaker Initialization

For work occurring after canonical migration:

- default execution budget is the manifest budget defined in §4.2;
- existing evidence from the current WP-021 review history must be carried forward when calculating recurrence;
- counters may not be reset merely because the framework version changed.

For WP-021 specifically, the previously identified crash/reconciliation blocker has recurred once after remediation.

Under:

`max_same_blocker_recurrence = 1`

the state is not OPEN merely because recurrence equals 1.

The breaker opens only when the configured limit is exceeded.

Therefore at the time of this ACR:

- same blocker recurrence: 1;
- allowed recurrence: 1;
- Circuit Breaker: `NORMAL`, at the limit;
- another semantic recurrence of the same blocker would exceed the limit and require opening the breaker.

This accounting must be preserved into WP-021 R3 governance.

---

## 9. Migration Implementation Scope

Authorized implementation after this ACR is approved:

1. preserve current `project-manifest.json` as `project-manifest.v1.2-legacy.json`;
2. replace `project-manifest.json` with the schema-valid EAAF v1.3 manifest from §4.2;
3. add `GOVERNANCE_DEBT.md`;
4. add migration evidence documenting exact source and target framework SHAs;
5. validate the new manifest against:
   - `Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362/schemas/project-manifest.schema.json`;
6. prove no application runtime files changed;
7. run repository-required CI/security checks;
8. perform post-merge validation.

Forbidden in the migration implementation:

- application code changes;
- database migrations;
- package dependency changes;
- fiscal behavior changes;
- WP-021 implementation changes;
- protected Open Question changes.

---

## 10. Required Independent Gates

Because this changes the engineering governance/control plane, minimum gates are:

1. Coordinator Quick Integrity on the exact frozen subject.
2. Independent Solution Architecture / Governance review.
3. Independent Code/Repository consistency review.
4. Security review focused on evidence backend and anti-bypass implications.
5. Coordinator synthesis.
6. Product Owner approval of the exact frozen subject.
7. PR Gate.
8. Required CI/security checks on exact PR head.
9. Explicit merge authorization.
10. Merge.
11. Post-merge exact-head validation.
12. Declaration `DONE / CANONICAL`.

No Builder may implement the manifest migration before the semantic ACR is canonical.

---

## 11. Required Evidence

The migration implementation must prove at minimum:

1. source canonical base = `26b606ad73acc37263a610dc9f0c979291b810a6`;
2. target EAAF commit exists and reports version `1.3.0`;
3. active manifest contains exact target `eaaf_commit`;
4. active manifest validates against the exact pinned v1.3 schema;
5. legacy manifest is preserved byte-for-byte;
6. Governance Debt register exists;
7. existing protected Open Questions are unchanged;
8. no runtime/application code changed;
9. no database migration changed;
10. no package/dependency graph changed;
11. exact-head CI/security succeeds;
12. post-merge validation confirms `main` contains the exact adopted pin.

Evidence level for the schema claim must be at least E2/E3 equivalent executable validation, not a prose claim.

---

## 12. WP-021 Effect

Until this ACR is approved, implemented, merged, and post-merge validated:

**WP-021 EAAF v1.3 GOVERNANCE CLAIM = HOLD**

The existing WP-021 R2 implementation branch remains an implementation artifact and may not be promoted on the basis of an uncanonical framework pin.

After this migration becomes canonical:

- WP-021 remains HOLD for its separate PAC reconciliation/fiscal-safety blockers;
- no R2 PASS is created retroactively;
- the next WP-021 remediation must use the migrated v1.3 governance controls and preserved Circuit Breaker counters.

---

## 13. Follow-On Governance

After ACR-2026-019 is `DONE / CANONICAL`, create a separate governed change:

**ACR-2026-020 — WP-021 PAC Reconciliation & Fiscal Success Contract**

That ACR shall define provider-neutral semantics for:

- ambiguous PAC outcomes;
- authoritative reconciliation before redispatch;
- provider idempotency capability declaration;
- fail-closed behavior when the provider contract cannot prove safe replay;
- minimum authoritative evidence for a `STAMPED` result;
- CSD completeness fail-closed behavior;
- durable operation lifecycle and restart recovery;
- duplicate-stamp prevention;
- required tests/evidence;
- preservation of `OQ-ARCH-02`.

ACR-2026-020 must not select or invent a concrete PAC provider.

---

## 14. Governance Effect

This ACR migrates the engineering governance authority only.

It does not change business semantics.

Until canonical:

**EAAF v1.3 ADOPTION = NOT CANONICAL**

and:

**WP-021 REMAINS HOLD**
