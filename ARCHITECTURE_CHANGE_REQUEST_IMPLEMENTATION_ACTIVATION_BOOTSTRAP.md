# ARCHITECTURE CHANGE REQUEST: IMPLEMENTATION ACTIVATION BOOTSTRAP GOVERNANCE

**ID:** `ACR-2026-002`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md` (Step 1 — Open Change Request)  
**Requester:** `01_Solution_Architect — GOVERNANCE CHANGE AUTHOR`  
**Date:** `2026-09-03`  
**Status:** **`READY FOR INDEPENDENT REVIEW`**  
**Current Frozen Baseline:** `e4ad2042be37d29250745f4c9af5de5a901fa5bb` (Tag `implementation-readiness-v1.0-approved`)  
**Current Amendment Subject:** `18b8bc17b9d8066c6fd599bc8c095c860a878a61`  
**Change Type:** `BACKWARD COMPATIBLE GOVERNANCE / ACTIVATION PROCEDURE CHANGE`  
**Target Review Authority:** `Independent Solution Architect` / `Product Owner`  

---

## 1. Trigger & Problem Statement

### 1.1 Discovery of Bootstrap Deadlock
During pre-implementation repository audit following the Product Owner Implementation Readiness Freeze (`e4ad204`), a circular operational dependency was discovered in the repository activation rules:
* The frozen Implementation Readiness baseline (`IMPLEMENTATION_PLAN.md` Sec. 3.2 and `HANDOFF_IMPLEMENTATION.md` Sec. 1) mandated that prior to starting Wave 0 / `WP-001`, GitHub `main` branch protection must enforce mandatory passing CI status checks (build, lint, typecheck, unit tests, secret scan).
* However, empirical inspection via GitHub API (`GET /repos/Lucas030509/TRIDENTPOS/actions/workflows`) confirms that:
  - Directory `.github/workflows` does not exist in the repository.
  - Zero workflows exist in GitHub Actions (`{"total_count": 0, "workflows": []}`).
  - No commit status contexts (e.g. `build`, `lint`, `test`, `secrets`) have ever been reported.
* Under GitHub branch protection mechanics, configuring required status checks for contexts that have never been emitted blocks all pull requests indefinitely, creating an unmergeable repository state.
* Under the governed execution plan, `WP-001` (Monorepo Structure & Build Tooling) scaffolds the repository foundation, workspaces, and build scripts.
* `WP-002` (Automated CI/CD Pipelines & Security Scanning) creates `.github/workflows/ci.yml` and `.github/workflows/security-scan.yml`.
* `WP-002` has `WP-001` as a strict prerequisite.

This creates an operational **implementation activation bootstrap deadlock**:
```text
WP-001 requires CI status checks to pass before merge
   ↓
CI workflows and status contexts are authored by WP-002
   ↓
WP-002 strictly depends on WP-001
   ↓
[BOOTSTRAP DEADLOCK: Neither work package can be merged]
```

---

## 2. Alternatives Considered & Rejected

| Alternative | Technical Mechanism | Reason for Rejection |
|---|---|---|
| **Option A: Require Nonexistent Status Contexts** | Configure branch protection demanding `build`, `lint`, etc. prior to `WP-001`. | **Unmergeable Repository:** In GitHub, PRs cannot satisfy checks that do not run, permanently blocking development. |
| **Option B: Dummy Always-Green Workflows** | Create a temporary `.github/workflows/dummy.yml` that exits 0 unconditionally. | **Prohibited Anti-Pattern (False PASS):** Violates EAAF core integrity rules; fabricates an illusion of quality. |
| **Option C: Manual Fabricated Commit Statuses** | Post green status checks to the commit via GitHub REST API. | **Prohibited Anti-Pattern (Evidence Fraud):** Injects unverified status data bypassing actual build execution. |
| **Option D: Unprotected Admin Bypass** | Allow repository admin to bypass branch protection to merge `WP-001` and `WP-002`. | **Prohibited Anti-Pattern (Governance Violation):** Violates the principle of verifiable, auditable branch protection. |
| **Option E: Two-Stage Governed Bootstrap (Proposed)** | Enforce PRs + reviews + no force push in Stage A; require full CI checks in Stage B post-WP-002. | **SELECTED:** Bounded, auditable, maintains builder/reviewer independence, and automatically expires. |

---

## 3. Proposed Governance Change: Two-Stage Activation Protocol

Adopt **ADR-009: Two-Stage Implementation Activation Bootstrap Protocol**:
* **Stage A (Pre-WP-001 Bootstrap):**
  Enforce remote `main` branch protection with:
  1. Pull Request required before merging (direct commits prohibited).
  2. Minimum 1 approved review from designated reviewer prior to merge.
  3. Builder cannot approve their own pull request (`Builder != Reviewer`).
  4. Force pushes and branch deletions disabled.
  5. Status check contexts omitted strictly because zero CI contexts exist prior to `WP-002`.
  * *Compensating Controls for WP-001 and WP-002:* Isolated feature branches, dual independent review (`Specialist Reviewer` + `11_Code_Reviewer`), local `npm ci` and `npm run build` execution, dependency graph linting, and committed markdown execution evidence.
* **Stage B (Post-WP-002 Full Protection):**
  Immediately after `WP-002` merges and establishes GitHub Actions contexts, update `main` protection to require mandatory passing status checks (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`).
  Stage B is a hard precondition before `WP-003` or any subsequent domain work package can merge. Stage A expires automatically.

---

## 4. Affected Frozen Artifacts & Scope Invariants

### 4.1 Affected Frozen Artifacts
1. `IMPLEMENTATION_PLAN.md`: Section 3.2 annotated with reference to `AMEND-GOV-IR-001` / `ACR-2026-002`.
2. `HANDOFF_IMPLEMENTATION.md`: Section 1 updated to integrate Stage A and Stage B requirements.
3. `project-manifest.json`: Lifecycle metadata updated to reflect governance amendment review.
4. Supporting new artifacts: `IMPLEMENTATION_ACTIVATION_BOOTSTRAP_AMENDMENT.md` and `ADR/ADR-009-implementation-activation-bootstrap-protocol.md`.

### 4.2 Strict Scope Invariants
* **Zero Architecture Drift:** Functional, Solution, Data, and Security Architecture baselines remain 100% frozen.
* **Zero Work Package Alteration:** Exactly 28 Work Packages (`WP-001` to `WP-028`) with unchanged functional scopes, test obligations, and DAG dependencies.
* **Zero PO Decision Impact:** All 9 Product Owner decisions remain strictly `PENDING PO DECISION`.
* **Zero Validation Debt Waivers:** All 11 Security Validation Debts (`SEC-VAL-01..11`) and Data Debts remain mandatory downstream obligations.

---

## 5. Compatibility Assessment & Step 5 Disposition

### 5.1 Compatibility Classification
**`BACKWARD COMPATIBLE GOVERNANCE / ACTIVATION PROCEDURE CHANGE`**  
The amendment resolves an execution ordering deadlock without altering any software design, data authority, security control, or business requirement.

### 5.2 EAAF Step 5 Disposition (SSOT / Migration Guidance)
Conforming to Step 5 of `workflows/ARCHITECTURE_CHANGE.md`:
* **SSOT Functional Guidance:** **`NOT APPLICABLE`** — No change to functional capabilities, user stories, or restaurant business logic.
* **Data Migration Guidance:** **`NOT APPLICABLE`** — No database schema, entity, or migration semantic change.
* **Implementation Governance & Handoff Guidance:** **`APPLICABLE`** — Formally incorporated into `IMPLEMENTATION_PLAN.md` Section 3.2 and `HANDOFF_IMPLEMENTATION.md` Section 1.

---

## 6. Risk Assessment & Rollback Strategy

* **Residual Risk:** During Stage A (`WP-001` and `WP-002`), code compilation and security scans rely on local command execution by the builder verified by dual independent reviewers rather than remote GitHub Actions runners.
* **Mitigation:** Strict dual review (`18_DevOps_Engineer` builder $\ne$ `01_Solution_Architect` / `10_DevOps_Platform_Architect` reviewer $\ne$ `11_Code_Reviewer`), raw command output logs in verification evidence, and automatic expiration of Stage A at `WP-002`.
* **Rollback / Reversal:** If GitHub configuration cannot enforce Stage A, implementation activation halts immediately (`IMPLEMENTATION ACTIVATION BLOCKED`). If `WP-002` fails to establish workflow contexts, `WP-003` cannot start.

---

## 7. Traceability Matrix

* **Governance Change Request:** `ACR-2026-002`
* **Governing ADR:** `ADR/ADR-009-implementation-activation-bootstrap-protocol.md`
* **Evidence Artifact:** `IMPLEMENTATION_ACTIVATION_BOOTSTRAP_AMENDMENT.md`
* **Affected Work Packages:** `WP-001`, `WP-002`, `WP-003`
* **Predecessor Baseline:** `e4ad2042be37d29250745f4c9af5de5a901fa5bb`
* **Predecessor Historical ACR:** `ACR-2026-001` (Unmodified, retained in `ARCHITECTURE_CHANGE_REQUEST.md`)
* **Associated Risk:** `IR-RSK-01`

---

## 8. Author Status & Recommendation

The author submits this Change Request for independent governance evaluation.

Status:

# `READY FOR INDEPENDENT REVIEW`
