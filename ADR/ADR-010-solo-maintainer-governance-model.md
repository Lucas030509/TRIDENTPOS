# ADR-010: Solo Maintainer Governance Model

**Status:** `PROPOSED — READY FOR INDEPENDENT AGENT REVIEW`  
**Date:** `2026-09-03`  
**Author / Owners:** `01_Solution_Architect — GOVERNANCE CHANGE AUTHOR`  
**Related Documents:** `ADR-009`, `ACR-2026-003`, `SOLO_MAINTAINER_GOVERNANCE.md`, `IMPLEMENTATION_PLAN.md`, `HANDOFF_IMPLEMENTATION.md`  

---

## 1. Context

TRIDENTPOS has completed all planning and architecture phases under EAAF v1.2.0:
* Functional Architecture: `APPROVED / FROZEN`
* Solution Architecture: `APPROVED / FROZEN`
* Data Architecture: `APPROVED / FROZEN`
* Security Architecture: `APPROVED / FROZEN`
* Implementation Readiness: `APPROVED / FROZEN`
* Implementation Activation Bootstrap: `APPROVED / FROZEN` (`ADR-009`)

ADR-009 established the Two-Stage Implementation Activation Bootstrap Protocol. Stage A was configured on remote GitHub to enforce branch protection on `main` with `required_approving_review_count = 1`.

However, the real-world operational context of TRIDENTPOS is a **solo-maintainer project**:
* Exactly one human maintainer (`Lucas030509`) administers and develops the project.
* No secondary human collaborator exists in the repository.
* GitHub's platform mechanics strictly prohibit a pull request author from approving their own pull request (`GraphQL: Review Can not approve your own pull request`).

## 2. Problem

Under ADR-009, merging any pull request to `main` (including the Stage A evidence PR #1) requires an approved review from a GitHub identity distinct from `Lucas030509`. Because no other human collaborator exists, this creates an **impossible execution requirement**.

To circumvent this under literal ADR-009 rules, the maintainer would be forced to either:
1. Create a fake second GitHub account ("sockpuppet") to approve their own PRs, creating **false independence**; or
2. Use administrative privileges (`gh pr merge --admin`) to bypass branch protection on every merge; or
3. Abandon project implementation.

All three outcomes violate EAAF v1.2 core governance tenets.

## 3. Decision

Adopt an explicit **Solo Maintainer Governance Model (`ADR-010`)** that amends ADR-009 to reflect empirical reality honestly while maximizing automated and agentic safeguards.

### 3.1 Truth in Governance & Independence Classification
The project explicitly distinguishes:
* **Human / Organizational Independence:** **`NOT AVAILABLE`**. No second human maintainer exists. No artifact may claim a distinct human reviewed the code.
* **EAAF Agent Role Independence:** **`FULLY ENFORCED`**. Code implementation and review are segregated into distinct agent activations with clean context boundaries (`Builder Agent` $\ne$ `Specialist Reviewer Agent` $\ne$ `11_Code_Reviewer Agent`).

### 3.2 GitHub Protection Profile (Solo Mode)
While `active_human_maintainers = 1`, remote `main` branch protection is configured with:
1. **Pull Request Required:** `true`. Direct commits to `main` are strictly blocked.
2. **Admin Enforcement:** `enforce_admins = true`. The maintainer must follow the PR flow and cannot bypass rules.
3. **Force Push:** `false` (disabled).
4. **Branch Deletion:** `false` (disabled).
5. **Required Approving Reviews:** `0` (amended from `1` to eliminate the impossible human dependency).
6. **Status Checks (Stage A):** Omitted during `WP-001` and `WP-002`.
7. **Status Checks (Stage B):** Enforced immediately after `WP-002` (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`).

### 3.3 Segregated EAAF Agent Review Lifecycle
For every Work Package, the following sequential activations are mandatory:
1. **Builder Activation:** Implements feature on dedicated branch (`feature/wp-xxx`).
2. **Specialist Reviewer Activation:** Fresh session evaluating domain compliance (`01_Solution_Architect`, `03_Data_Architect`, etc.).
3. **11_Code_Reviewer Activation:** Fresh session evaluating code quality, edge cases, and security.
* Builder cannot review their own work in the same session.
* Markdown review evidence containing exact commit SHAs, Expected vs Actual results, and findings must be committed before merging.

### 3.4 Automated CI as the Primary Gate (Stage B)
Because human peer review is absent, Stage B automated CI status checks (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`) serve as the uncompromising machine gate for every PR starting with `WP-003`.

### 3.5 Solo Mode Exit Condition (Auto-Upgrade)
If at any point a second trusted human maintainer is added with write/admin permissions to the repository, branch protection must immediately be updated to:
```text
required_approving_review_count >= 1
```
thereby transitioning the repository into standard multi-maintainer mode.

## 4. Consequences

### Positive
* Eliminates the impossible human reviewer requirement without introducing false independence or sockpuppet accounts.
* Preserves 100% of machine protections on `main` (PR required, `enforce_admins: true`, no direct push, no force-push, no deletions).
* Formalizes EAAF multi-agent review segregation as the primary pre-merge review mechanism.
* Unblocks PR #1 and `WP-001` execution within a strictly governed, transparent framework.

### Negative / Trade-offs
* Human peer review is absent; development relies on automated tests, static analysis, and multi-agent adversarial reviews.
* Residual risk of solo blindspots is mitigated via strict automated CI in Stage B and formal Production Gate requirements.

## 5. Supersession & Compatibility

* **Amends:** Specifically supersedes the requirement in `ADR-009` (Section 5, Stage A) and `ACR-2026-002` that mandated `required_approving_review_count >= 1` on GitHub during solo maintainer operation.
* **Preserves:** All other clauses of `ADR-009`, `ACR-2026-002`, and `AMEND-GOV-IR-001` remain in full effect.

---

## 6. Status

# `PROPOSED — READY FOR INDEPENDENT AGENT REVIEW`
