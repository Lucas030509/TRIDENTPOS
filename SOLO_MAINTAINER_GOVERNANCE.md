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
3. **No Narrative PASS:** Reviews must contain actual command outputs, test execution logs, and an explicit Expected vs Actual matrix.

---

## 4. High-Risk Change Policy

For Work Packages involving critical domains:
* Authentication & Authorization (`WP-006`)
* Tenant Isolation & RLS (`WP-004`)
* Payment & Fiscal Logic (`WP-009`)
* Offline Cryptographic Sync (`WP-008`, `WP-011`)
* Destructive Data Migrations (`WP-003`, `WP-005`)
* Secrets & Key Management

The following enhanced compensating controls are binding:
1. **Owning Architect Review:** Mandatory specialist review from `04_Security_Architect` or `03_Data_Architect`.
2. **Automated Validation Evidence:** 100% test coverage on tenant isolation and security invariants.
3. **External Authority Recording:** If an architectural decision exceeds internal project authority, it must be recorded as `EXTERNAL AUTHORITY REQUIRED BEFORE PRODUCTION`, not falsely claimed as approved.

---

## 5. Development vs. Production Authorization Distinction

Solo Maintainer mode authorizes:
* Development, integration, automated testing, and staging under the 28 Work Packages.

Solo Maintainer mode **DOES NOT** automatically authorize:
* Final Production Deployment (`WP-028` / Wave 9).
* The Production Readiness Gate will independently assess whether final production release requires external human security sign-off, third-party penetration testing, or organizational risk acceptance.

---

## 6. Solo Mode Exit Condition (Auto-Upgrade)

When the repository gains a second trusted human maintainer:
```text
IF: active_human_maintainers >= 2
THEN:
  1. Update GitHub branch protection: required_approving_review_count = 1
  2. Transition repository from Solo Maintainer Mode to Multi-Maintainer Mode
  3. Re-enable mandatory human peer review on all pull requests
```

---

## 7. Status & Handoff

* **Status:** `READY FOR INDEPENDENT AGENT REVIEW`
* **Governing Change Request:** `ACR-2026-003`
* **Governing Decision:** `ADR-010`
