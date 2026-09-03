# ARCHITECTURE CHANGE REQUEST: SOLO MAINTAINER GOVERNANCE MODEL

**ID:** `ACR-2026-003`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md` (Step 1 — Open Change Request)  
**Requester:** `01_Solution_Architect — GOVERNANCE CHANGE AUTHOR`  
**Date:** `2026-09-03`  
**Status:** **`READY FOR INDEPENDENT AGENT REVIEW`**  
**Approved Frozen Baseline:** `c092aca5b47b65d0a0cbb787b60bae0b1db882d4` (Tag `implementation-activation-bootstrap-v1.0-approved`)  
**Change Type:** `GOVERNANCE ADAPTATION / SOLO MAINTAINER OPERATING PROFILE`  
**Governing ADR:** `ADR/ADR-010-solo-maintainer-governance-model.md`  

---

## 1. Context & Operational Trigger

### 1.1 Empirical Repository Reality
The TRIDENTPOS project is developed, maintained, and operated by a **single human maintainer**:
* Active GitHub Maintainers: **`1`** (`Lucas030509`).
* Secondary Human Collaborators: **`0`** (None).
* Organization / Enterprise Review Teams: **`0`** (None).

### 1.2 The Impossible Human Reviewer Invariant
Under the approved Implementation Activation Bootstrap Protocol (`ACR-2026-002`, `ADR-009`, `AMEND-GOV-IR-001`), Stage A branch protection was successfully configured on remote GitHub:
* Pull requests required before merging to `main`.
* `enforce_admins = true` active.
* Force pushes and deletions disabled.
* `required_approving_review_count = 1`.

However, GitHub enforces a platform-level constraint:
> **A pull request author cannot approve their own pull request.** (`GraphQL: Review Can not approve your own pull request`).

Because `Lucas030509` is the sole human developer and administrator, requiring a GitHub approving review creates an **impossible execution requirement** on a solo-maintainer repository. No pull request (including the Stage A evidence PR #1) can ever be merged through the normal protected-branch flow without either:
1. Fabricating a fake "second user" account controlled by the same person; or
2. Using administrative bypass to force-merge around protection; or
3. Halting development permanently.

---

## 2. Fundamental Governance Principle: Honesty in Independence

EAAF v1.2 strictly prohibits false PASS and false compliance. This change formally establishes the boundary between human organizational independence and agent role independence:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   HUMAN / ORGANIZATIONAL INDEPENDENCE                  │
│                     STATUS: NOT AVAILABLE (SOLO MAINTAINER)            │
│  - Exactly one human maintainer exists (Lucas030509).                  │
│  - No distinct human peer review exists.                               │
│  - No second person can approve GitHub pull requests.                  │
└────────────────────────────────────────────────────────────────────────┘
                                    ≠
┌────────────────────────────────────────────────────────────────────────┐
│                    EAAF ROLE / AGENT INDEPENDENCE                      │
│                         STATUS: FULLY ACTIVE                           │
│  - Distinct agent activations with segregated roles and contexts.     │
│  - Builder Agent ≠ Specialist Reviewer Agent ≠ Code Reviewer Agent.   │
│  - Immutable commit SHAs reviewed adversarially before merge.          │
│  - Explicit evidence artifacts with raw command outputs.               │
└────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> No artifact, log, or evidence document in this project may ever claim that an "independent human review" or "independent organizational review" occurred unless a real distinct human has performed it.

---

## 3. Rejected Alternatives

* **Alternative A: Create a second GitHub account controlled by the same person (Sockpuppet)**
  - *Verdict:* **`REJECTED`**.
  - *Rationale:* Violates EAAF integrity principles. A second account operated by the same individual creates the illusion of peer review without providing genuine human oversight. False independence is unacceptable.
* **Alternative B: Temporarily disable branch protection on `main`**
  - *Verdict:* **`REJECTED`**.
  - *Rationale:* Disabling branch protection removes safeguards against accidental direct pushes, history rewrites, and deletion of `main`.
* **Alternative C: Fabricate approval statuses or use admin bypass**
  - *Verdict:* **`REJECTED`**.
  - *Rationale:* Using `gh pr merge --admin` or forging check statuses destroys the audit trail and normalizes administrative privilege abuse.
* **Alternative D: Maintain `required_approving_review_count = 1` indefinitely**
  - *Verdict:* **`REJECTED`**.
  - *Rationale:* Creates a permanent deadlock. Implementation can never start.
* **Alternative E: Adopt an Explicit Solo Maintainer Governance Profile (`ADR-010`)**
  - *Verdict:* **`PROPOSED`**.
  - *Rationale:* Transparently configures GitHub to enforce all possible machine controls (PR required, `enforce_admins: true`, no direct push, no force-push, no deletions, automated status checks in Stage B) while setting GitHub human approvals to `0` and shifting peer review obligations to segregated EAAF agent reviews.

---

## 4. Proposed Solo Maintainer Operating Model

### 4.1 GitHub Branch Protection Mechanics (Solo Mode)
For as long as `active_human_maintainers = 1`:
1. **Target Branch:** `main`.
2. **Pull Request Required:** `true` (direct uncontrolled commits to `main` remain strictly prohibited).
3. **Admin Enforcement:** `enforce_admins = true` (the owner cannot bypass PR workflow).
4. **Force Push:** `false` (force pushes prohibited).
5. **Branch Deletion:** `false` (deletion prohibited).
6. **Required GitHub Approvals:** `0` (eliminates the impossible human reviewer requirement).
7. **Stage A Status Checks:** Omitted (until `WP-002` authors workflows).
8. **Stage B Status Checks:** Enforced immediately post-`WP-002` (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`).

### 4.2 Segregated EAAF Agent Review Obligations
Every code-producing Work Package retains three separate activations:
1. **Builder Activation:** Generates the implementation on a feature branch (`18_DevOps_Engineer`, `13_Backend_Developer`, etc.).
2. **Specialist Reviewer Activation:** Fresh context evaluating domain architecture (`01_Solution_Architect`, `03_Data_Architect`, `10_DevOps_Platform_Architect`, `04_Security_Architect`).
3. **Code Reviewer Activation:** Fresh context evaluating code quality and security (`11_Code_Reviewer`).
* Builder cannot self-review inside the same activation.
* All reviews must inspect an immutable commit SHA and produce markdown evidence.

### 4.3 High-Risk Change Compensating Policy
Changes involving authentication, cryptography, tenant isolation, fiscal logic, destructive migrations, or secret management require:
* Specialist EAAF agent review + `11_Code_Reviewer` review.
* 100% passing automated test and lint evidence.
* If external organizational certification is required prior to Production release, it must be recorded as `EXTERNAL AUTHORITY REQUIRED BEFORE PRODUCTION`, not faked during development.

### 4.4 Solo Mode Exit Condition (Auto-Upgrade)
* **Trigger:** If the number of active, trusted human maintainers with write/admin permissions increases to $\ge 2$.
* **Action:** GitHub branch protection must immediately be updated to `required_approving_review_count >= 1`, restoring human pull request review as an enforceable repository control.

---

## 5. Scope Invariants & Integrity Assurances

* **Zero Architecture Drift:** Functional, Solution, Data, and Security baselines remain 100% frozen.
* **Zero Work Package Changes:** The 28 Work Packages (`WP-001` to `WP-028`) retain their exact scopes, acceptance criteria, test obligations, and DAG dependencies.
* **Zero PO Question Closure:** All 9 Product Owner decisions remain strictly `PENDING PO DECISION`.
* **Zero Validation Debt Waivers:** All validation debts (`SEC-VAL-01..11`, `DAT-04`, `DAT-08`, etc.) remain hard obligations.

---

## 6. Supersession & Traceability

* **Superseded Clause:** Amends the specific clause of `ADR-009` / `AMEND-GOV-IR-001` that required a distinct GitHub approving reviewer during solo maintainer operation.
* **Preserved Controls:** All other Stage A safeguards (PR required, no direct push, no force-push, no deletions, admin enforcement) and all Stage B status checks remain fully intact.
* **Traceability:**
  - `ACR-2026-001`: Historical schema change request (unmodified).
  - `ACR-2026-002`: Bootstrap governance change request (approved/frozen).
  - `ACR-2026-003`: This Change Request (Solo Maintainer Governance Model).
  - `ADR-010`: Governing Architectural Decision Record.
  - `SOLO_MAINTAINER_GOVERNANCE.md`: Operating profile specification.

---

## 7. Author Status & Recommendation

The author submits this Change Request for independent agent review by `Independent Solution Architect` and `10_DevOps_Platform_Architect`.

Status:

# `READY FOR INDEPENDENT AGENT REVIEW`
