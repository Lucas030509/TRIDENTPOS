# ADR-009: Two-Stage Implementation Activation Bootstrap Protocol

**Status:** `PROPOSED — READY FOR INDEPENDENT REVIEW`  
**Date:** `2026-09-03`  
**Author / Owners:** `01_Solution_Architect — GOVERNANCE CHANGE AUTHOR`  
**Related Documents:** `IMPLEMENTATION_PLAN.md`, `HANDOFF_IMPLEMENTATION.md`, `IMPLEMENTATION_ACTIVATION_BOOTSTRAP_AMENDMENT.md`, `ARCHITECTURE_CHANGE_REQUEST_IMPLEMENTATION_ACTIVATION_BOOTSTRAP.md`  

---

## 1. Context
The approved and frozen Implementation Readiness baseline (`e4ad2042be37d29250745f4c9af5de5a901fa5bb`, Tag `implementation-readiness-v1.0-approved`) established that prior to starting Wave 0 / `WP-001`, GitHub `main` branch protection must enforce mandatory passing CI status checks (build, lint, typecheck, unit tests, secret scan).

An empirical audit of the remote GitHub repository (`Lucas030509/TRIDENTPOS`) confirms:
* The repository currently contains zero GitHub Actions workflows (`GET /repos/.../actions/workflows` returns `total_count: 0`).
* No `.github/workflows` directory exists on `main`.
* No commit status contexts have ever been reported.

## 2. Problem
In GitHub, requiring status check contexts that do not exist prevents pull requests from ever satisfying merge requirements. Under the approved implementation plan:
* `WP-001` (Monorepo Structure & Build Tooling) scaffolds the repository workspaces and build configs.
* `WP-002` (Automated CI/CD Pipelines & Security Scanning) authors `.github/workflows/ci.yml` and `.github/workflows/security-scan.yml`.
* `WP-002` depends strictly on `WP-001`.

Strict literal enforcement creates an operational **circular bootstrap deadlock**: `WP-001` cannot merge without passing CI status checks, but CI status checks cannot exist until `WP-002` merges.

## 3. Architectural Drivers
1. **Zero False PASS:** Under EAAF v1.2 integrity rules, the project strictly rejects dummy always-green workflows or forged commit statuses.
2. **Protected Main:** Direct commits and unreviewed merges to `main` must remain impossible.
3. **Builder Independence:** The builder must never be permitted to approve their own pull request.
4. **Reproducible Local Evidence:** Build and dependency correctness must be proven with raw command output logs during bootstrap.
5. **Mandatory Remote CI:** Downstream domain work packages must be protected by automated remote CI runners.
6. **Bounded Scope & Automatic Expiration:** The bootstrap exception must apply only to `WP-001` and `WP-002`, expiring permanently once `WP-002` establishes real workflow contexts.

## 4. Options Considered

### Option A: Require Nonexistent Status Contexts
* *Mechanism:* Configure branch protection demanding `build`, `lint`, etc. prior to `WP-001`.
* *Consequence:* Pull requests cannot pass non-existent checks, permanently deadlocking repository activation.
* *Disposition:* **Rejected**.

### Option B: Create Dummy Always-Green Workflow
* *Mechanism:* Add a placeholder `.github/workflows/dummy.yml` that exits 0 unconditionally to satisfy branch protection.
* *Consequence:* Creates an illusion of automated validation while masking build breakages; violates EAAF anti-false-PASS mandates.
* *Disposition:* **Rejected**.

### Option C: Admin Bypass / Unprotected Bootstrap
* *Mechanism:* Permit repository administrators to push directly or merge without branch protection.
* *Consequence:* Violates auditable governance and peer review segregation.
* *Disposition:* **Rejected**.

### Option D: Two-Stage Governed Bootstrap (Proposed)
* *Mechanism:* Enforce PRs, reviews, builder-reviewer segregation, and no force-pushes in Stage A without status check contexts; enforce full CI status checks in Stage B immediately post-`WP-002`.
* *Consequence:* Legally bounded, auditable, maintains builder/reviewer independence, and automatically expires.
* *Disposition:* **Selected for Independent Review**.

## 5. Decision
Adopt the **Two-Stage Implementation Activation Bootstrap Protocol**:

### Stage A — Pre-WP-001 Repository Protection
Stage A remote `main` branch protection must be enabled and independently verified on remote **before `WP-001` implementation begins** (no builder may begin `WP-001`, write implementation code, execute WP changes, or open formal handoff execution until Stage A is verified on remote). Repository administration must enable remote branch protection on `main` enforcing:
1. Pull Request required before merge (direct commits to `main` prohibited).
2. Minimum 1 approved review from designated reviewer prior to merge.
3. Builder cannot approve their own pull request (`Builder != Reviewer`).
4. Force pushes (`git push --force`) disabled.
5. Branch deletion disabled.
6. Automated status check contexts omitted strictly because zero CI contexts exist prior to `WP-002`.

### Stage A Temporary Compensating Controls (WP-001 & WP-002)
* Dedicated feature branches (`feature/wp-001-*`, `feature/wp-002-*`).
* Dual independent review: Primary Specialist Reviewer (`01_Solution_Architect` / `10_DevOps_Platform_Architect`) + Mandatory Code Reviewer (`11_Code_Reviewer`).
* Mandatory local execution of `npm ci` and `npm run build` with clean outputs.
* Dependency graph linting proving zero circular workspace packages.
* Full command outputs committed in verification evidence markdown files.

### Stage B — Post-WP-002 Full Protection
`WP-002` delivers `.github/workflows/ci.yml` and `.github/workflows/security-scan.yml`.
Immediately upon `WP-002` merge:
1. GitHub Actions executes and establishes official status contexts: `build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`.
2. Remote `main` branch protection must be updated to require all status checks before `WP-003` or any subsequent domain work package can merge.
3. **Stage A terminates automatically.** No subsequent work package may use the bootstrap exception.

## 6. Consequences

### Positive
* Resolves the circular activation deadlock cleanly without violating EAAF governance.
* Preserves builder/reviewer independence and prevents unreviewed code merges.
* Establishes a concrete, verifiable milestone for activating full CI protection.

### Negative
* During `WP-001` and `WP-002`, build compilation and linting rely on local execution verified by human reviewers rather than remote GitHub Actions runners.

### Operational
* Requires a two-step repository administration workflow: configure basic protection at Stage A, and update with required status contexts at Stage B.

### Governance
* Requires an explicit audit checkpoint following `WP-002` before opening `WP-003`.

## 7. Failure Modes & Mitigations

| Failure Mode | Impact | Mitigation |
|---|---|---|
| **Stage A Never Upgraded to Stage B** | Downstream WPs merge without automated CI checks. | `WP-003` has a hard prerequisite check verifying remote Stage B protection before merging. |
| **WP-003 Attempted Before Stage B** | Domain code bypasses CI. | Specialist Reviewer and Code Reviewer must block `WP-003` PR until Stage B verification is recorded. |
| **CI Contexts Renamed in WP-002** | Branch protection demands old context names. | Stage B requires verifying the exact emitted context names in GitHub Actions run logs before saving protection rules. |
| **Workflow Disabled or Broken in WP-002** | CI fails to publish contexts. | `WP-002` cannot be marked DONE until workflows execute successfully on its PR. |
| **Admin Bypass Invoked** | Direct commits violate review rules. | Repository audit log verification; commits without PRs fail gate audit. |
| **Branch Rules Not Supported on Account** | Protection cannot be enabled remotely. | Hard stop: `IMPLEMENTATION ACTIVATION BLOCKED — REPOSITORY GOVERNANCE CAPABILITY MISSING`. |

## 8. Security & Supply Chain Considerations
Stage A is not equivalent to full CI protection. It represents a strictly bounded bootstrap state. Compensating controls (mandatory dual review, local `npm ci` with committed lockfiles, SHA verification) mitigate supply chain tampering during `WP-001` and `WP-002`. Full SCA scanning (Trivy) and secret scanning (TruffleHog/Gitleaks) become mandatory in Stage B.

## 9. Observability & Evidence
1. Stage A Evidence: GitHub API query output confirming branch protection enabled without status checks (`evidence/STAGE_A_PROTECTION_EVIDENCE.json`).
2. Stage B Evidence: GitHub API query output confirming required status checks active on `main` (`evidence/STAGE_B_PROTECTION_EVIDENCE.json`).

## 10. SSOT / Migration Guidance Disposition (EAAF Step 5)
* **Functional SSOT Guidance:** **`NOT APPLICABLE`** — No alterations to business rules, capabilities, or module scopes.
* **Data Migration Guidance:** **`NOT APPLICABLE`** — No schema or data authority alterations.
* **Implementation Governance Guidance:** **`APPLICABLE`** — Formally incorporated into `IMPLEMENTATION_PLAN.md` Section 3.2 and `HANDOFF_IMPLEMENTATION.md` Section 1.

## 11. Revisit Triggers
* GitHub Actions contexts become available following `WP-002` merge.
* Repository changes to an Enterprise ruleset architecture.
* Alternative CI runners (e.g. self-hosted) are introduced.

## 12. Traceability
* **Change Request:** `ACR-2026-002`
* **Evidence Document:** `IMPLEMENTATION_ACTIVATION_BOOTSTRAP_AMENDMENT.md`
* **Work Packages:** `WP-001`, `WP-002`, `WP-003`
* **Risk Register:** `IR-RSK-01`
