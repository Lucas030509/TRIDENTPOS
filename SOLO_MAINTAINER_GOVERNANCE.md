# SOLO MAINTAINER GOVERNANCE SPECIFICATION

**Document ID:** `SPEC-GOV-SOLO-001`  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Project:** `ERP RESTAURANTES / TRIDENTPOS`  
**Repository:** [TRIDENTPOS](https://github.com/Lucas030509/TRIDENTPOS.git)  
**Author:** `01_Solution_Architect — GOVERNANCE CHANGE AUTHOR`  
**Governing ADR:** `ADR/ADR-010-solo-maintainer-governance-model.md`  
**Associated ACR:** `ACR-2026-003`  
**Date:** `2026-09-03`  

---

## 1. Canonical Governance Disclosure

```text
================================================================================
                    PROJECT OPERATING MODE: SOLO MAINTAINER
================================================================================
Distinct Human Reviewer:           NOT AVAILABLE (Single Maintainer: Lucas030509)
GitHub Human Approval Count:       0 WHILE SOLO MODE ACTIVE
GitHub Branch Protection on main:  ENFORCED (PR Required, Admin Enforced, No Force Push)
EAAF Specialist Agent Review:      MANDATORY FOR ALL CODE WORK PACKAGES
EAAF Code Reviewer Agent Review:   MANDATORY FOR ALL CODE WORK PACKAGES
Automated CI Status Checks:        MANDATORY FROM STAGE B (WP-003 onwards)
================================================================================
```

> [!CAUTION]
> Under EAAF v1.2.0 truth-in-governance standards, no document or agent may claim that an "independent human review" occurred. All reviews performed during this phase are strictly **Independent EAAF Agent Reviews**.

---

## 2. GitHub Repository Protection Contract (Solo Mode)

For the duration of Solo Maintainer mode, remote `main` branch protection is enforced as follows:

| Control | Setting | Purpose |
|---|---|---|
| **Pull Request Required** | `true` | Prohibits direct, uninspected commits to `main`. Every change must have a tracked PR. |
| **Enforce Admins** | `true` | Ensures repository owner/admin cannot bypass PR workflow or push directly. |
| **Force Pushes** | `false` | Prevents history rewrites or destructive fast-forwards. |
| **Branch Deletions** | `false` | Protects `main` from accidental or intentional deletion. |
| **Required Approving Reviews** | `0` | Eliminates the impossible human reviewer requirement on single-maintainer repos. |
| **Required Status Checks (Stage A)** | `null` | Omitted during `WP-001` and `WP-002` while CI is authored. |
| **Required Status Checks (Stage B)** | `ENFORCED` | Mandatory passing checks: `build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, `sca-scan`. |

---

## 3. EAAF Multi-Agent Review Architecture in Solo Mode

To compensate for the absence of a secondary human reviewer, EAAF enforces strict agent segregation across every code-producing Work Package:

```text
┌───────────────────────────┐
│     BUILDER ACTIVATION    │
│  - 18_DevOps_Engineer /   │
│    13_Backend_Developer   │
│  - Implements on branch   │
└─────────────┬─────────────┘
              │ Commits to feature branch
              ▼
┌───────────────────────────┐
│ SPECIALIST REVIEW AGENT   │
│  - Fresh context / agent  │
│  - Architectural audit    │
│  - Produces evidence doc  │
└─────────────┬─────────────┘
              │ Passes architectural check
              ▼
┌───────────────────────────┐
│ 11_CODE_REVIEWER AGENT    │
│  - Fresh context / agent  │
│  - Security & QA audit    │
│  - Produces review verdict│
└─────────────┬─────────────┘
              │ Passes code review
              ▼
┌───────────────────────────┐
│     GOVERNED PR MERGE     │
│  - Fast-forward / merge   │
│  - No admin bypass used   │
└───────────────────────────┘
```

### Mandatory Execution Invariants:
1. **Fresh Context:** Reviewer agents must operate in dedicated, fresh activations with independent prompt contexts.
2. **Immutable Subject SHA:** Reviews must inspect a specific, pinned git commit SHA. Modifying files during review invalidates the review.
3. **Structured Verdict & Evidence:** Reviews must contain actual command outputs, test execution logs, findings, and an explicit Expected vs Actual matrix resulting in an unambiguous verdict (`PASS`, `PARTIAL`, or `FAIL`).
4. **Agent Evidence vs. GitHub Human Approval:** Every code-producing WP must obtain PASS evidence from BOTH the assigned Specialist Reviewer Agent and `11_Code_Reviewer` Agent before merge. These are internal EAAF verification artifacts, NOT GitHub human approvals (`required_approving_review_count = 0` on GitHub during Solo Mode).

---

## 4. High-Risk Change Policy

Critical domains and their canonical Work Package mappings (aligned with `IMPLEMENTATION_PLAN.md`) include:

| Domain / Work Package | Classification | Mandatory Specialist Reviewer Agent |
|---|---|---|
| **WP-004:** Organization & Branch Multi-Tenant RLS Foundation | Security / Data critical | `08_Security_Architect` + `03_Data_Architect` |
| **WP-005:** Cloud IAM & Administrative Authentication | Security critical | `08_Security_Architect` |
| **WP-006:** Tamper-Evident Security Logging & Cloud Audit Trail | Security / Audit trail | `08_Security_Architect` |
| **WP-007:** Electron Security Hardening / IPC Boundary | Security / Edge IPC | `08_Security_Architect` |
| **WP-008:** SQLite WAL & Durability Manager | Data integrity / Durability | `03_Data_Architect` |
| **WP-009:** Edge Enrollment & Trust Bootstrap Protocol | Security / Bootstrap crypto | `08_Security_Architect` |
| **WP-010:** Offline IAM & Floor PIN Authentication | Security / Offline auth | `08_Security_Architect` |
| **WP-011:** Folio Lease Allocation & Fencing Protocol | Fiscal / Data integrity | `03_Data_Architect` (plus security validation obligations where applicable) |
| **WP-020:** Finance / AP / AR / Cash Reconciliation | Financial integrity | `01_Solution_Architect` |
| **WP-021:** Fiscal Invoicing Engine / PAC / CFDI / CSD Private Key | Fiscal crypto / Key security | `08_Security_Architect` |
| **WP-023:** Delivery Aggregator Webhooks / Cryptographic Verification | Security / Webhook verification | `08_Security_Architect` |

### Database & Schema Migrations
Any Work Package producing database/schema migrations is strictly governed by `DATA_MIGRATION_STRATEGY.md`:
* `WP-003` provides the foundation and migration engine.
* Subsequent schema-producing Work Packages inherit the `Expand -> Transition -> Contract` protocol.
* Production destructive down-migrations remain strictly prohibited across all Work Packages.
* Data Architect (`03_Data_Architect`) specialist review is applied according to canonical Work Package assignment and schema/data migration impact.

### Compensating Controls for High-Risk Work Packages:
1. **Owning Architect Review:** Mandatory specialist review from the canonically assigned Specialist Reviewer Agent (`01_Solution_Architect`, `08_Security_Architect`, or `03_Data_Architect`) as mapped above. If a future change to `WP-020` independently introduces database schema/migration impact, `03_Data_Architect` review additionally applies according to migration governance without replacing the canonical reviewer.
2. **Automated Validation Evidence:** 100% PASS of the required automated tenant-isolation/security-invariant test suite applicable to the Work Package. Universal line coverage metrics remain governed by `IMPLEMENTATION_PLAN.md` (no uncalibrated universal 100% line coverage target is introduced).
3. **External Authority Recording:** If an architectural decision exceeds internal project authority (e.g., `SEC-VAL-11` Legal/Privacy retention policies or external PAC/SAT certifications), it must be recorded as `EXTERNAL AUTHORITY REQUIRED BEFORE PRODUCTION`, not falsely claimed as approved.

---

## 5. Development vs. Production Authorization Distinction

Solo Maintainer mode authorizes:
* Development, integration, automated testing, and staging under the 28 Work Packages.

Solo Maintainer mode **DOES NOT** automatically authorize:
* Final Production Deployment (`WP-028` / Wave 9).
* The Production Readiness Gate will independently assess whether final production release requires external human security sign-off, third-party penetration testing, or organizational risk acceptance.

---

## 6. Solo Mode Exit Condition (Auto-Upgrade)

Solo Maintainer mode remains active only while exactly one human maintainer exists. Merely adding an unverified or secondary GitHub account does NOT constitute human review capability.

```text
IF: active_trusted_human_maintainers >= 2
THEN:
  1. Verify the second maintainer is:
     - A distinct, real human (not a duplicate/sockpuppet account)
     - Trusted and active
     - Possessing Write/Maintain/Admin repository permissions
  2. Update GitHub branch protection on main: required_approving_review_count >= 1
  3. Transition repository from Solo Maintainer Mode to Multi-Maintainer Mode
  4. Re-enable mandatory human peer review on all pull requests
```

---

## 7. Status & Handoff

* **Status:** `READY FOR INDEPENDENT AGENT REVIEW`
* **Governing Change Request:** `ACR-2026-003`
* **Governing Decision:** `ADR-010`
