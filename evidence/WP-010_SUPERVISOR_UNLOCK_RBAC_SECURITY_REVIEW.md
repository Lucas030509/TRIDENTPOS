# INDEPENDENT SECURITY REVIEW: WP-010 CANONICAL RBAC CAPABILITY FOR EARLY STATION LOCKOUT UNLOCK

**Review Subject:** Architecture Change Request `ACR-2026-012` (`ARCHITECTURE_CHANGE_REQUEST_WP010_SUPERVISOR_UNLOCK_RBAC.md`)  
**Solution Architect Subject Commit:** `34cee0dd493377fd4f6bd1a88de9f31f82a49aeb`  
**Governance Lineage:** `M9: 9d7c7dabeb1b696974f111cd0e1206d048179625` → `34cee0dd493377fd4f6bd1a88de9f31f82a49aeb`  
**Reviewer:** `08_Security_Architect`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Date:** `2026-09-12`  
**Review Status / Verdict:** **`PASS`** (No Blocking Security Findings)  

---

## 1. Review Mandate & Context

Pursuant to EAAF v1.2.0 governance and Coordinator directive `QI-010-R2-01`, this independent security review evaluates the technical authorization contract and canonical overlays proposed in `ACR-2026-012` by `01_Solution_Architect`.

The purpose of this review is to verify that:
1. The defined authorization mechanism eliminates role display-name string matching and prevents ungrounded role-name alias broadening.
2. The permission literal `estacion.desbloquear` aligns with the established security taxonomy and preserves the Principle of Least Privilege.
3. Multi-tenant boundaries, local branch boundaries, and offline security invariants are fully preserved.
4. Fail-closed semantics, audit guarantees, and anti-brute-force rate limiting remain uncompromisingly enforced.
5. Zero expansion or unilateral resolution of the nine (9) protected Product Owner questions occurs.

---

## 2. Item-by-Item Security Evaluation

### 2.1 Principle of Least Privilege
- **Evaluation:** Prior to `ACR-2026-012`, early station unlock relied on qualitative or display-name matching across broad roles (e.g. `Administrador`, `Gerente`), implicitly coupling unlock authority to general management powers.
- **Finding:** `ACR-2026-012` defines the exact technical permission literal `estacion.desbloquear`. By isolating lockout release into an explicit, atomized capability, enterprise tenants can grant this operational override without granting full system administration (`ROLE-001`) or financial cut powers.
- **Disposition:** **PASS**.

### 2.2 Strict Prohibition of Role-Name Alias Broadening
- **Evaluation:** Initial implementation candidates accepted `ADMIN`, `ADMINISTRADOR`, `GERENTE`, `MANAGER`, and `SUPERVISOR`. English translations `ADMIN` and `MANAGER` had no standing in canonical repository authority (`RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md` v1.1 NORMALIZED on M9).
- **Finding:** `ACR-2026-012` strictly rejects display-name alias matching. The authorization authority is derived solely from the canonical permission `estacion.desbloquear` (with explicit transitional fallback restricted to canonical role codes `ROLE-001` and `ROLE-002`). Unmapped role codes `ADMIN`, `MANAGER`, `admin`, or `manager` strictly fail closed with `INSUFFICIENT_PERMISSIONS`.
- **Disposition:** **PASS**.

### 2.3 Custom-Role Behavior
- **Evaluation:** Multi-tenant enterprise deployments need the ability to define custom roles (e.g., `AUDITOR_TURNO`, `JEFE_SEGURIDAD_PISO`) without code modifications.
- **Finding:** Because `DATA_MODEL.md` defines `roles.permissions JSONB` in Cloud PostgreSQL and propagates this array into SQLite WAL `cached_users.roles_json`, custom organizational roles receive `estacion.desbloquear` seamlessly via corporate RBAC administration.
- **Disposition:** **PASS**.

### 2.4 Tenant Isolation Boundary
- **Evaluation:** Cross-tenant security must prevent an authorized supervisor in Tenant A from releasing a locked station belonging to Tenant B.
- **Finding:** `ACR-2026-012` and the governing implementation require `supervisor.organization_id === station.organization_id`. A supervisor presenting valid credentials for Tenant B at a Tenant A station immediately fails closed with `AUTHENTICATION_FAILED`, and the station remains locked.
- **Disposition:** **PASS**.

### 2.5 Branch Isolation Boundary
- **Evaluation:** A station locked in Branch 1 must not be unlocked by unapproved credentials from outside that branch's authorized personnel.
- **Finding:** The Edge Host maintains local offline cache (`cached_users`) populated strictly with credentials provisioned for that specific branch. A user not cached locally cannot authorize unlock.
- **Disposition:** **PASS**.

### 2.6 Offline Cache & Synchronization Semantics
- **Evaluation:** Station lockout occurs on floor terminals when internet connectivity may be absent. Authorization must not require synchronous Cloud WAN round-trips.
- **Finding:** `estacion.desbloquear` is cached locally within SQLite `cached_users.roles_json`. The Edge runtime performs local evaluation against verified Argon2id PIN hashes, ensuring complete floor operational autonomy.
- **Disposition:** **PASS**.

### 2.7 Fail-Closed Semantics
- **Evaluation:** Any ambiguity, malformed payload, missing permission, or cryptographic failure must fail closed.
- **Finding:** If the user record is missing, revoked (`is_revoked === 1`), expired (`expiresAt <= now`), has invalid Argon2id PIN, lacks `estacion.desbloquear`, or belongs to a different tenant, the unlock request is rejected, the station remains in `STATION_LOCKED`, and consecutive failure counters are not cleared.
- **Disposition:** **PASS**.

### 2.8 Credential Revocation & Expiration Implications
- **Evaluation:** A supervisor whose credentials have expired or been revoked must not be capable of unlocking a terminal.
- **Finding:** `OfflineIamService.supervisorUnlockStation` enforces `supervisor.isRevoked === 0` and `expiresAt > now` (validated against monotonically governed `trustedEffectiveTime`) prior to evaluating permissions.
- **Disposition:** **PASS**.

### 2.9 Brute-Force Rate Limiting on Supervisor Unlock
- **Evaluation:** An attacker could attempt to brute-force the 4-digit supervisor PIN on the lockout unlock endpoint.
- **Finding:** Failed supervisor unlock attempts record failures via `LockoutManager.recordFailure`, extending lockout duration, enforcing rate limiting on the unlock endpoint, and triggering high-severity audit logging without acting as an oracle.
- **Disposition:** **PASS**.

### 2.10 Atomic Audit Commitment
- **Evaluation:** A malicious actor or hardware crash could attempt to reset the lockout state without recording an audit trail.
- **Finding:** `ACR-2026-012` affirms `DATA-INV-WP009-01` atomic transaction guarantees: lockout counter reset and tamper-evident audit record insertion (`SupervisorStationUnlocked`) are executed within a single SQLite WAL transaction (`BEGIN IMMEDIATE ... COMMIT`). If audit logging fails, the transaction rolls back completely and the station remains locked.
- **Disposition:** **PASS**.

### 2.11 Preservation of Protected Product Owner Decisions
- **Evaluation:** The nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) must remain strictly untouched.
- **Finding:** `ACR-2026-012` strictly confines its scope to the technical RBAC permission literal `estacion.desbloquear` for station lockout unlock. All nine PO decisions remain `PENDING PO DECISION` with zero modification or resolution.
- **Disposition:** **PASS**.

---

## 3. Verification Checklist

| Criterion | Verified | Notes |
|---|---|---|
| Least Privilege enforced | **YES** | Discrete capability `estacion.desbloquear` isolated from general admin. |
| Role-name alias broadening eliminated | **YES** | `ADMIN` and `MANAGER` strictly removed; display-name matching prohibited. |
| Custom-role support enabled | **YES** | Supported through `roles.permissions JSONB` and `cached_users.roles_json`. |
| Strict multi-tenant isolation | **YES** | `supervisor.organization_id === station.organization_id` strictly verified. |
| Branch boundary preserved | **YES** | Local SQLite `cached_users` cache boundary enforced. |
| Offline floor autonomy preserved | **YES** | Capability evaluated locally without Cloud dependencies. |
| Fail-closed on any defect | **YES** | Missing permission, wrong PIN, expired creds all preserve lockout. |
| Monotonic time / expiry enforced | **YES** | `trustedEffectiveTime` enforces `expiresAt` and detects clock rollback. |
| Anti-brute-force rate limiting on unlock | **YES** | Supervisor unlock failures record against station lockout. |
| Atomic audit transaction rollback | **YES** | Lockout reset + `SupervisorStationUnlocked` committed in single SQLite TX. |
| 9 Protected PO decisions untouched | **YES** | All 9 remain `PENDING PO DECISION`. |

---

## 4. Final Security Review Verdict

`08_Security_Architect` issues a formal verdict of:

$$\mathbf{PASS}$$

The proposed Architecture Change Request `ACR-2026-012` is sound, robust, and completely aligned with the EAAF v1.2.0 security architecture. It is recommended for immediate Product Owner approval.
