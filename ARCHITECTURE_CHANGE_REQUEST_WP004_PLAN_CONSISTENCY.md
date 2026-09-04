# ARCHITECTURE CHANGE REQUEST: WP-004 IMPLEMENTATION PLAN CONSISTENCY CORRECTION

**ID:** `ACR-2026-005`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `01_Solution_Architect — IMPLEMENTATION PLAN REMEDIATION AUTHOR`  
**Date:** `2026-09-04`  
**Status:** `READY FOR ROLE-SEPARATED BASELINE REVIEW`  
**Base Commit:** `f72989154aefe0b6f5ee1fbf3641811effdd23a6`  
**Classification:** `IMPLEMENTATION READINESS BASELINE CORRECTION`  

---

## 1. Problem Statement

During the initial activation of `17_Database_Engineer` (Builder) for Work Package `WP-004: Organization & Branch Multi-Tenant RLS Foundation`, a blocking contradiction was identified between the frozen Data Architecture and the frozen Implementation Plan.

Specifically, the narrative metadata for `WP-004` in `IMPLEMENTATION_PLAN.md` listed `organization_memberships` under Data Objects, yet:
1. The table `organization_memberships` does not exist in the authoritative frozen `DATA_MODEL.md` or `DATA_DICTIONARY.md`.
2. The Outputs section of `WP-004` in the same `IMPLEMENTATION_PLAN.md` only specified creating `organizations`, `branches`, `current_app_org_id()`, and composite keys.
3. User tenancy and membership/role primitives (`users`, `roles`, `user_roles`) are explicitly assigned to `WP-005: Cloud IAM & Administrative Authentication`.

In strict adherence to EAAF v1.2.0 and Builder stop conditions, the Builder halted execution without writing code or inventing schema. This Change Request formalizes the removal of the undefined `organization_memberships` reference from `IMPLEMENTATION_PLAN.md` to restore baseline consistency.

---

## 2. Frozen Sources Inspected

The following authoritative architectural baselines were inspected:
- `DATA_MODEL.md` (Document ID `ARCH-MDL-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `DATA_DICTIONARY.md` (Document ID `ARCH-DIC-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `DATA_ARCHITECTURE.md` (Document ID `ARCH-DAT-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`)
- `SECURITY_ARCHITECTURE.md` (Document ID `ARCH-SEC-001`, Version `1.2 APPROVED / FROZEN — 2026-09-03`)
- `DATA_PROTECTION_AND_PRIVACY.md` (Document ID `ARCH-PRV-001`, Version `1.0 APPROVED / FROZEN — 2026-09-03`)
- `IAM_SECURITY_MODEL.md` (Document ID `ARCH-IAM-001`, Version `1.2 APPROVED / FROZEN — 2026-09-03`)
- `IMPLEMENTATION_PLAN.md` (Document ID `ARCH-PLN-001`, Version `1.0 APPROVED / FROZEN — 2026-09-03`)
- `HANDOFF_IMPLEMENTATION.md` (Version `1.0 APPROVED BASELINE — 2026-09-03`)
- `project-manifest.json`

---

## 3. Exact Contradiction

- In `IMPLEMENTATION_PLAN.md` line 226, `WP-004` states:
  `* **Data Objects:** organizations, branches, organization_memberships`
- However, in `IMPLEMENTATION_PLAN.md` line 234, the explicit deliverables state:
  `* **Outputs:** SQL migration creating organizations, branches, and foundational RLS helper function current_app_org_id(); composite unique keys (organization_id, id).`
- In `DATA_MODEL.md` Section 2.1 (*Bounded Context 1: Platform Core*), the defined tables are:
  - `organizations`
  - `branches`
  - `users`
  - `user_branch_credentials`
  - `roles`
  - `user_roles`
  - `stations`
- Neither `DATA_MODEL.md` nor `DATA_DICTIONARY.md` contains any definition (DDL, attributes, constraints, or types) for `organization_memberships`.
- In `IMPLEMENTATION_PLAN.md` line 251, `WP-005` governs:
  `* **Data Objects:** users, roles, permissions, role_permissions, user_roles`

---

## 4. Root Cause

During the drafting of `IMPLEMENTATION_PLAN.md` Wave 1 descriptions, the token `organization_memberships` was colloquially included in the summary bullet of `WP-004` without a corresponding table existing in `DATA_MODEL.md`. The detailed Outputs section correctly identified only `organizations` and `branches`, while user membership was modeled directly via `users.organization_id` and `user_roles` under `WP-005`. This editorial inconsistency persisted into the frozen plan.

---

## 5. Why Data Model Remains Authoritative

Under EAAF v1.2.0 Section 5 and Repository Governance rules:
1. `DATA_MODEL.md` and `DATA_DICTIONARY.md` are the frozen Single Source of Truth (SSOT) for all database schemas, table structures, and relational integrity.
2. An implementation planning artifact (`IMPLEMENTATION_PLAN.md`) cannot implicitly invent database tables, columns, foreign keys, or business attributes that do not exist in the frozen data architecture.
3. Therefore, `DATA_MODEL.md` prevails, and the planning artifact must be corrected to match.

---

## 6. Why `organization_memberships` Must NOT Be Invented

Inventing an `organization_memberships` table at the builder layer would introduce:
1. **Uncontrolled Schema Drift:** Creating an ad-hoc table without formal data modeling, classification, or data dictionary review.
2. **Relational Redundancy:** In the frozen data model, tenant membership is already established by `users.organization_id` (scoping a user to an organization) and `user_roles` (assigning a user to specific roles and branches within that organization). Creating a third intermediate table would break relational invariants.
3. **Premature IAM Coupling:** User entities belong to `WP-005: Cloud IAM & Administrative Authentication`. Adding user-membership tables into `WP-004` violates the bounded context and wave sequencing rules.

---

## 7. Corrected WP-004 Scope

The corrected scope for `WP-004` is:
- **Data Objects:** `organizations`, `branches`
- **Helper Function:** `current_app_org_id()`
- **Security Primitives:**
  - `ENABLE ROW LEVEL SECURITY` on `organizations` and `branches`
  - `FORCE ROW LEVEL SECURITY` on `organizations` and `branches`
  - Default-deny tenant isolation policies
  - Transaction-scoped tenant context (`SET LOCAL app.current_organization_id`)
- **Relational Integrity:** Composite tenant-aware constraints (e.g. `(organization_id, id)` on `branches`).

---

## 8. WP-005 Boundary Preservation

`WP-005: Cloud IAM & Administrative Authentication` retains complete and exclusive ownership of:
- `users`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles`
- JWT verification middleware and RBAC evaluation services.

No IAM primitives are pulled into `WP-004`.

---

## 9. Security Impact

- **Tenant Isolation Uncompromised:** Removing `organization_memberships` does not weaken multi-tenant isolation. Both `organizations` and `branches` remain strictly protected by RLS and `FORCE ROW LEVEL SECURITY`.
- **Default Deny Maintained:** Queries without tenant context or with mismatched context evaluate to zero rows.
- **SEC-VAL-01 Preserved:** Negative penetration test requirements (cross-tenant read/write prevention, session leakage prevention, NOBYPASSRLS verification) remain 100% active and mandatory.

---

## 10. Data Impact

- Zero changes to `DATA_MODEL.md`.
- Zero changes to `DATA_DICTIONARY.md`.
- Zero changes to `DATA_ARCHITECTURE.md`.
- Schema definitions remain 100% stable and intact.

---

## 11. Product Owner Impact

- **PO Protected Decisions Affected:** **NONE** (All 9 questions `OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02` remain neutral and pending).
- No business rules, domain features, or restaurant workflows are altered.

---

## 12. Migration Impact

- **Database Migration Rollback Required:** **NONE**.
- No database migrations exist yet for `WP-004`. Canonical WP-003 baseline is unaffected.

---

## 13. Existing Code Impact

- **Existing WP-004 Implementation:** **NONE**.
- Builder execution paused cleanly prior to generating migrations, schemas, or application code.

---

## 14. Rollback Plan

If this amendment is rejected, `IMPLEMENTATION_PLAN.md` can be reverted to commit `f72989154aefe0b6f5ee1fbf3641811effdd23a6`.

---

## 15. Required Independent Reviews

This Change Request requires dual role-separated EAAF agent reviews:
1. `03_Data_Architect` — Data Architecture Conformance Review
2. `08_Security_Architect` — Security Conformance Review

Upon approval by both specialists, this change is eligible for promotion to `main`.
