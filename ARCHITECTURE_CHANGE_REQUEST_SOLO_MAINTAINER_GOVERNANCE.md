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

### 4.2 Segregated EAAF Agent Review & Sidecar Evidence Architecture
GitHub branch protection enforces `required_approving_review_count = 0` on GitHub during Solo Mode because no second human exists. To prevent false PASS and uncontrolled branch mutation, review execution is governed by a strict SHA-binding and sidecar evidence model:

1. **Canonical Terminology:**
   * **`B` (Implementation Base SHA):** The immutable base commit on `main` from which the feature branch was branched.
   * **`S` (Implementation Subject SHA):** The final feature-branch HEAD commit after all implementation code, builder tests, builder execution logs, and builder documentation have been committed. `S` is frozen BEFORE reviewer activation begins.
   * **`ES` (Specialist Review Evidence SHA):** Evidence-only commit produced by the assigned Specialist Reviewer Agent referencing `S` on a sidecar review branch (`review/wp-XXX-specialist-rN`).
   * **`EC` (Code Review Evidence SHA):** Evidence-only commit produced by `11_Code_Reviewer` referencing `S` on a sidecar review branch (`review/wp-XXX-code-rN`).

2. **Builder Evidence vs. Reviewer Sidecar Evidence:**
   * Builder execution evidence (build, lint, automated test logs, rollback verification) is committed on the feature branch BEFORE `S` is frozen.
   * Reviewer PASS evidence (`ES`, `EC`) MUST NOT be committed to the implementation feature branch after `S`. Reviewer evidence is strictly **SIDECAR EVIDENCE**.

3. **Hard SHA-Binding Invariant:**
   ```text
   SPECIALIST_REVIEW.subject_sha = CODE_REVIEW.subject_sha = IMPLEMENTATION_PR.head_sha = S
   ```
   If `IMPLEMENTATION_PR.head_sha != S` at merge authorization time (for any reason, including code edits, documentation changes, evidence commits, rebase, or merge-from-main), all previous review verdicts are **INVALID** and full re-review is mandatory. Never allow $\text{PASS}(S) \rightarrow \text{MERGE}(S_2)$.

4. **Pre-Merge Authorization Checklist:** Merge is authorized only when:
   * PR head SHA equals reviewed subject `S`;
   * Both `ES` and `EC` exist remotely, reference `S`, and award `PASS`;
   * No subsequent commit exists on the implementation feature branch;
   * All automated checks applicable to the Work Package and current repository stage are PASS:
     - **Stage A (`WP-001` and `WP-002`):** Required remote Stage B status contexts are not applicable / do not yet exist. Merge authorization relies on mandatory local execution evidence (`npm ci` where applicable, build, lint / graph validation where applicable, WP-specific tests), Specialist Reviewer Agent PASS, `11_Code_Reviewer` Agent PASS, hard SHA-binding (`SPECIALIST_REVIEW.subject_sha = CODE_REVIEW.subject_sha = IMPLEMENTATION_PR.head_sha = S`; `ES` and `EC` are separate immutable sidecar evidence commits referencing `S`), and zero blocking findings (testing is NOT waived);
     - **Stage B (`WP-003` through `WP-028`):** All six required remote CI status contexts MUST PASS (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`) with zero waivers;
   * Open blocking findings = 0;
   * Governed merge record logs `S`, `ES`, `EC`, and merge commit `M`.

### 4.3 High-Risk Change Compensating Policy
Work Packages involving critical domains are mapped canonically per `IMPLEMENTATION_PLAN.md`:
* Multi-tenant RLS & tenant isolation (`WP-004`): `08_Security_Architect` + `03_Data_Architect`.
* Cloud IAM & admin authentication (`WP-005`): `08_Security_Architect`.
* Security logging & cloud audit trail (`WP-006`): `08_Security_Architect`.
* Electron hardening & IPC security (`WP-007`): `08_Security_Architect`.
* SQLite durability & WAL manager (`WP-008`): `03_Data_Architect`.
* Edge enrollment & trust bootstrap (`WP-009`): `08_Security_Architect`.
* Offline IAM & floor PIN auth (`WP-010`): `08_Security_Architect`.
* Folio lease allocation & fencing protocol (`WP-011`): `03_Data_Architect` (plus security validation obligations).
* Finance & cash reconciliation (`WP-020`): `01_Solution_Architect` (canonical reviewer per `IMPLEMENTATION_PLAN.md`; Data Architect review additionally applies if schema/migration impact is independently introduced).
* Fiscal invoicing engine / PAC / CFDI / CSD private keys (`WP-021`): `08_Security_Architect`.
* Delivery aggregator webhooks / provider verification (`WP-023`): `08_Security_Architect`.
* Schema/Data migrations: Any WP introducing database schema changes is governed by `DATA_MIGRATION_STRATEGY.md`. `WP-003` establishes the migration engine foundation; subsequent schema changes follow Expand-Transition-Contract. Production destructive down-migrations remain prohibited.
* Test Evidence Standard: 100% PASS of the required automated tenant-isolation/security-invariant test suite applicable to the Work Package (line coverage metrics remain governed by `IMPLEMENTATION_PLAN.md`).
* External Authority: If external organizational or regulatory sign-off is needed (e.g. `SEC-VAL-11` legal retention, PAC certification), it must be recorded as `EXTERNAL AUTHORITY REQUIRED BEFORE PRODUCTION`, not fabricated during development.

### 4.4 Solo Mode Exit Condition (Auto-Upgrade)
* **Trigger:** If active, trusted human maintainers with write/admin permissions increase to $\ge 2$.
* **Requirement:** The second maintainer must be a distinct, real human (not a duplicate or sockpuppet account), trusted, active, and Write/Maintain/Admin capable.
* **Action:** GitHub branch protection must immediately be updated to `required_approving_review_count >= 1`, restoring human pull request review as an enforceable repository control.

---

## 5. EAAF Architecture Change Step 5 Downstream Disposition

In accordance with `workflows/ARCHITECTURE_CHANGE.md` Step 5 (*Update Downstream Baseline Artifacts*), the downstream baseline impact of ACR-2026-003 is formally recorded as:

* **Functional SSOT:** `NOT APPLICABLE`  
  *Reason:* No business capability, restaurant functional rule, or domain workflow is altered by this governance model change.
* **Data Migration Guidance:** `NOT APPLICABLE TO THIS GOVERNANCE CHANGE`  
  *Reason:* No database schema, entity contract, or data migration is introduced by ACR-2026-003 itself.
* **Implementation Governance / Handoff:** `APPLICABLE`  
  *Governed Artifacts:*
  - `SOLO_MAINTAINER_GOVERNANCE.md` (`SPEC-GOV-SOLO-001` — Created)
  - `HANDOFF_IMPLEMENTATION.md` (Updated)
  - `IMPLEMENTATION_PLAN.md` (Updated)

---

## 6. Scope Invariants & Integrity Assurances

* **Zero Architecture Drift:** Functional, Solution, Data, and Security baselines remain 100% frozen.
* **Zero Work Package Changes:** The 28 Work Packages (`WP-001` to `WP-028`) retain their exact scopes, acceptance criteria, test obligations, and DAG dependencies.
* **Zero PO Question Closure:** All 9 Product Owner decisions remain strictly `PENDING PO DECISION`.
* **Zero Validation Debt Waivers:** All validation debts (`SEC-VAL-01..11`, `DAT-04`, `DAT-08`, etc.) remain hard obligations.

---

## 7. Supersession & Traceability

* **Superseded Clause:** Amends the specific clause of `ADR-009` / `AMEND-GOV-IR-001` that required a distinct GitHub approving reviewer during solo maintainer operation.
* **Preserved Controls:** All other Stage A safeguards (PR required, no direct push, no force-push, no deletions, admin enforcement) and all Stage B status checks remain fully intact.
* **Traceability:**
  - `ACR-2026-001`: Historical schema change request (unmodified).
  - `ACR-2026-002`: Bootstrap governance change request (approved/frozen).
  - `ACR-2026-003`: This Change Request (Solo Maintainer Governance Model).
  - `ADR-010`: Governing Architectural Decision Record.
  - `SOLO_MAINTAINER_GOVERNANCE.md`: Operating profile specification.

---

## 8. Author Status & Recommendation

The author submits this Change Request for independent agent review by `Independent Solution Architect` and `10_DevOps_Platform_Architect`.

Status:

# `READY FOR INDEPENDENT AGENT REVIEW`
