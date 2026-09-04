# WP-005 IMPLEMENTATION PLAN REMEDIATION AUTHOR EVIDENCE

**Author:** `01_Solution_Architect — WP-005 IMPLEMENTATION PLAN CONSISTENCY REMEDIATION AUTHOR`  
**Date:** `2026-09-04`  
**Mode:** `SOLO_MAINTAINER`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Canonical Base:** `8cb4644f93f73a8e6fc28a2aa36841bc612c97d4`  
**Architecture Change Request:** `ACR-2026-006` (`ARCHITECTURE_CHANGE_REQUEST_WP005_IAM_CONSISTENCY.md`)  
**Feature/Governance Branch:** `governance/wp-005-plan-consistency-remediation`  

---

## 1. Context & Purpose

Prior to activating `13_Backend_Developer` (Builder) for `WP-005: Cloud IAM & Administrative Authentication`, this pre-implementation consistency gate was executed to eliminate all ambiguities and contradictions across the frozen architectural baselines (`IMPLEMENTATION_PLAN.md`, `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `IAM_SECURITY_MODEL.md`, and `SECURITY_ARCHITECTURE.md`).

This transaction executes purely architectural and plan remediation. Zero application code or database migrations are created.

---

## 2. Files Changed in Author Subject

1. `ARCHITECTURE_CHANGE_REQUEST_WP005_IAM_CONSISTENCY.md` (New governance artifact: `ACR-2026-006`)
2. `IMPLEMENTATION_PLAN.md` (Updated `WP-005` specification, lines 248–272)
3. `DATA_MODEL.md` (Updated Section 2.1 with composite keys, Supabase subject binding, and composite tenant foreign keys)
4. `DATA_DICTIONARY.md` (Updated Section 1.1 with IAM entities, composite keys, and data classifications)
5. `evidence/WP-005_PLAN_REMEDIATION_AUTHOR_EVIDENCE.md` (This author evidence artifact)

---

## 3. Detailed Remediation Decisions

| Contradiction / Requirement | Prior Inconsistent State | Remediated SSOT State |
|---|---|---|
| **Contradiction A: RBAC Model** | Plan listed `permissions` and `role_permissions` tables. | Governed strictly by `roles.permissions JSONB`. No relational permission tables exist or shall be created. |
| **Contradiction B: `user_branch_credentials`** | Ownership unassigned in WP-005; risk of orphan table. | WP-005 owns Cloud DDL, migrations, RLS, and PIN hash provisioning. WP-010 exclusively owns Edge offline runtime verification, lockout, and benchmarks. |
| **Contradiction C: References** | Plan cited `IAM_SECURITY_MODEL.md Sec. 2` & `SECURITY_ARCHITECTURE.md Sec. 3` (Edge/PIN/QR enrollment). | Corrected to `IAM_SECURITY_MODEL.md Sec. 1, 4` and `SECURITY_ARCHITECTURE.md Sec. 1, 2.2, 5.1, 6` (Cloud IAM, JWT lifecycle, RLS multi-tenant boundary). |
| **Contradiction D: Cryptography** | Plan allowed `Argon2id / bcrypt`. | `bcrypt` is strictly prohibited and eliminated. `Argon2id` (RFC 9106 baseline: $m=64\text{ MB}, t=3, p=4$) retained for Cloud PIN hash generation. |
| **Contradiction E: Identity Binding** | No explicit binding between `jwt.sub` and `users.id`. | Option A formalized: `users.id` IS the canonical Supabase Auth subject UUID (`jwt.sub`). Single source of identity; zero unverified lookups. |
| **Tenant Claim Trust Model** | Client-selected tenant context vulnerable to elevation. | Strict verification sequence: cryptographically verify JWT (`iss`, `aud`, `exp`, `sub`), query database for `users.id = jwt.sub`, enforce `is_active = TRUE`, cross-check `users.organization_id == requested_org_id`, reject mismatch with HTTP 403. Database RBAC is sole authority. |
| **Tenant-Safe Relational Integrity** | Simple foreign keys risked cross-tenant row references. | Added `uq_users_org_id`, `uq_roles_org_id`, `uq_user_branch_cred_org_id` and composite foreign keys on `user_roles` and `user_branch_credentials` referencing `(organization_id, id)`. |
| **Row Level Security (RLS)** | Incomplete RLS specifications for WP-005. | All 4 tables (`users`, `roles`, `user_roles`, `user_branch_credentials`) require `ENABLE + FORCE ROW LEVEL SECURITY` with `current_app_org_id()` default-deny policies. |

---

## 4. Preservation of Authoritative Baselines

| Baseline / Invariant | Status | Verification Detail |
|---|---|---|
| **Product Owner Protected Decisions** | **PRESERVED** | `OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02` remain 100% neutral and `PENDING PO DECISION`. |
| **WP-004 Baseline** | **PRESERVED** | `organizations` and `branches` schema, `current_app_org_id()`, and RLS tests remain intact. |
| **Implementation Scope** | **PRESERVED** | No downstream packages (`WP-006` through `WP-011`) pulled forward. |
| **Application Code** | **NONE** | Zero application, server, or UI code written. |
| **Database Migrations** | **NONE** | Zero implementation SQL migrations created. Canonical WP-004 state remains untouched. |

---

## 5. Author Conclusion & Hand-Off

All SSOT contradictions and plan ambiguities for `WP-005` have been remediated. The data model and implementation plan are in perfect alignment.

**Author Verdict:**  
`READY FOR ROLE-SEPARATED BASELINE REVIEW`
