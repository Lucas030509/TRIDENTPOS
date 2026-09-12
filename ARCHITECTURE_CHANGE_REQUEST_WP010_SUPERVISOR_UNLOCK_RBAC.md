# ARCHITECTURE CHANGE REQUEST: WP-010 CANONICAL RBAC CAPABILITY FOR EARLY STATION LOCKOUT UNLOCK

> [!NOTE]
> **ACR-2026-012 PENDING PRODUCT OWNER APPROVAL — PRE-PO STATUS**
> 
> This document constitutes a formal Architecture Change Request under EAAF v1.2.0. Its contents have been authored by `01_Solution_Architect` and reviewed with verdict `PASS` by `08_Security_Architect`. It is submitted for formal Product Owner approval prior to baseline merge.

**ID:** `ACR-2026-012`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester / Primary Author:** `01_Solution_Architect — WP-010 GOVERNANCE RESOLUTION AUTHOR`  
**Security Consultation / Reviewer:** `08_Security_Architect — INDEPENDENT SECURITY REVIEW`  
**Date:** `2026-09-12`  
**Status:** `READY FOR PRODUCT OWNER APPROVAL`  
**Base Commit:** `9d7c7dabeb1b696974f111cd0e1206d048179625` (`M9`)  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `ARCHITECTURE CLARIFICATION & CANONICAL RBAC CAPABILITY OVERLAY`  
**Triggering Work Package:** `WP-010` (Edge Offline IAM & Floor PIN Authentication Engine)  

---

## 1. Executive Summary & Clarification Drivers

During the Coordinator Quick Integrity review of implementation candidate `S10-R2` for Work Package `WP-010: Edge Offline IAM & Floor PIN Authentication Engine`, finding `QI-010-R2-01` was identified regarding the authorization mechanism for early local station lockout release (`STATION_LOCKED`).

The implementation authorized supervisor unlock by inspecting whether the authenticated user possessed role display names such as `ADMIN`, `ADMINISTRADOR`, `GERENTE`, `MANAGER`, or `SUPERVISOR`. This set introduced ungrounded bilingual role-name aliases (`ADMIN` and `MANAGER`) not formally ratified in the canonical repository Single Source of Truth (SSOT).

While candidate `S10-R3` surgically eliminated ungrounded aliases and restricted runtime evaluation strictly to canonical roles defined in `RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md` Section 7 (`ROLE-001`, `ROLE-002`, `Administrador`, `Gerente`, `Supervisor`), EAAF governance mandates that authorization should be **capability-based (permission-based)** rather than hardcoded to human-readable role display names. This ensures consistency with the configurable multi-tenant RBAC data model (`DATA_MODEL.md`) and the operational capability matrix (`SECURITY_CONTROL_MATRIX.md`).

This Architecture Change Request formalizes the canonical technical RBAC permission literal, default role mappings, data model semantics, and security boundaries required to authoritatively govern early local station lockout overrides.

---

## 2. Exact Unresolved Question

Pursuant to Coordinator directive `QI-010-R2-01`, this clarification resolves the specific technical question:

> **"What canonical RBAC capability authorizes early local STATION_LOCKED supervisor unlock?"**

### Invariant Constraints:
1. **Zero Business Behavior Changes:** Product business rules and floor operational flows already approved in `RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md` and `IAM_SECURITY_MODEL.md` remain completely unchanged.
2. **Neutrality on Protected PO Decisions:** All nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`. This ACR does not resolve, alter, or interpret any of them.
3. **No Unapproved Builder Grandfathering:** No unproven aliases or bypass mechanisms are legitimized.
4. **Offline Floor Resilience:** The authorization capability must be verifiable fully offline at the Edge Host without requiring Cloud WAN connectivity.

---

## 3. Existing Frozen Authorities Inspected

The following authoritative architectural baselines were inspected:
- `RESTAURANT_SOFTWARE_RECONSTRUCTION_SPEC.md` (v1.1 NORMALIZED on Canonical `M9: 9d7c7dabeb1b696974f111cd0e1206d048179625`):
  - **Section 7 ("ROLES Y USUARIOS"):** Defines `ROLE-001 — Administrador` (complete system configuration, mandatory role) and `ROLE-002 — Gerente / Supervisor` (authorization of security events: discounts, cancellations, reaperturas, lockouts).
  - **Section 8 ("MATRIZ DE PERMISOS"):** Establishes sensitive operation matrix by security profile (`Administrador`, `Gerente`).
- `IAM_SECURITY_MODEL.md` (Document ID `ARCH-IAM-001`, Version `1.2 APPROVED OVERLAY — G9`):
  - **Section 3 ("Mitigación de Fuerza Bruta y Bloqueo de Estaciones"):** Enforces 5-minute `STATION_LOCKED` after 5 consecutive PIN failures and establishes: *"El desbloqueo anticipado requiere la autorización de un usuario con privilegios de supervisión local."*
- `DATA_MODEL.md` (Document ID `ARCH-MDL-001`, Version `1.0 APPROVED / FROZEN — 2026-09-01`):
  - **Section 2.1 (Cloud `roles` Table):** Defines `roles.code VARCHAR(50)`, `roles.name VARCHAR(100)`, and `roles.permissions JSONB NOT NULL DEFAULT '[]'`.
  - **Section 3.1 (Edge `cached_users` Table):** Defines `cached_users.roles_json TEXT NOT NULL` ("JSON array de roles y permisos").
- `SECURITY_CONTROL_MATRIX.md` (Document ID `ARCH-SCM-001`, Version `1.2 APPROVED OVERLAY — G9`):
  - **Section 1:** Authoritative capability-to-permission mapping using Spanish lowercase dot-notation (`comanda.iniciar`, `comanda.enviar`, `item.cancelar_precocina`, `cuenta.descuento`, `caja.abrir_cajon`, `caja.cobrar`, `corte.emitir_x`, `corte.emitir_z`, `folios.contingencia`, `catalogo.administrar`, `dispositivos.enrolar`).
- `CAPABILITY_MAP.md` (Document ID `ARCH-CAP-001`, Version `1.3 NORMALIZED / REMEDIATED`):
  - **Section 2.1:** `CAP-PLT-02` (Dual Identity & Access Management), `CAP-PLT-04` (Structured Event Audit), `CAP-PLT-05` (Cross-Cutting Device Primitives).
- `SECURITY_ARCHITECTURE.md` (Document ID `ARCH-SEC-001`, Version `1.2 APPROVED OVERLAY — G9`):
  - Establishes zero trust on client/UI, server-side enforcement at trusted boundaries, and least-privilege authorization.
- `IMPLEMENTATION_PLAN.md` (Document ID `ARCH-PLN-001`, Version `1.0 APPROVED / FROZEN — 2026-09-03`):
  - `WP-005` owns Cloud schema and provisioning of `roles.permissions JSONB`; `WP-010` owns Edge Offline IAM runtime PIN verification and lockout manager.

---

## 4. Security Rationale & Threat Analysis

### 4.1 Vulnerabilities of Display-Name Authorization:
1. **Role-Name Alias Broadening & Confusion:** Hardcoding string matches on arbitrary display names (such as English translations `ADMIN` or `MANAGER` alongside Spanish `Administrador` or `Gerente`) creates authorization ambiguities, opens potential privilege escalation vectors, and violates the principle that authorization stems from governed capabilities.
2. **Inflexibility in Multi-Tenant Environments:** In a SaaS hospitality platform, corporate enterprise tenants frequently define custom organizational roles (e.g., `AUDITOR_NOCTURNO`, `JEFE_PISO`, `SUPERVISOR_FRANQUICIA`). Hardcoded role-name checks prevent custom roles from exercising necessary supervisory overrides without altering application source code.
3. **Least Privilege Violation:** Binding overrides to monolithic roles grants all supervisory powers implicitly rather than allowing fine-grained delegation of specific security actions.

### 4.2 Architectural Guarantees of Permission-Based Authorization:
1. **Explicit Capability Grant:** A user may release a station lockout if and only if their effective identity profile contains the explicit canonical capability literal.
2. **Configurable Corporate RBAC:** Enterprise administrators assign the capability to standard or custom roles in Cloud PostgreSQL (`roles.permissions JSONB`), which synchronizes downstream into Edge SQLite (`cached_users.roles_json`).
3. **Strict Boundary Enforcement:** Even with the permission granted, the supervisor must belong to the same organization (`organization_id`), have valid unexpired cached credentials (`expiresAt > now`), and provide their valid 4-digit PIN verified via local Argon2id.

---

## 5. Selected Technical Authorization Contract

### 5.1 Canonical Permission Literal
The authoritative canonical permission literal established by this Architecture Change Request is:

$$\mathbf{estacion.desbloquear}$$

### 5.2 Taxonomy & Syntax Alignment
The token `estacion.desbloquear` strictly conforms to the repository's established authorization taxonomy:
- **Language:** Spanish lowercase.
- **Structure:** `<dominio_o_recurso>.<verbo_infinitivo>`
- **Direct Precedents in `SECURITY_CONTROL_MATRIX.md`:**
  - `dispositivos.enrolar` (Device enrollment)
  - `catalogo.administrar` (Catalog administration)
  - `cuenta.descuento` (Discount application)
  - `caja.cobrar` (Payment settlement)
  - `caja.abrir_cajon` (Manual cash drawer open)
  - `item.cancelar_precocina` (Pre-kitchen item cancellation)
  - `comanda.iniciar` (Order opening)
  - `corte.emitir_z` (Definitive Z cut)

### 5.3 Specification of the Capability

| Attribute | Specification |
|---|---|
| **Permission Literal** | `estacion.desbloquear` |
| **Semantic Meaning** | Grants authority to perform an early manual override of a temporary station lockout (`STATION_LOCKED`) triggered by consecutive failed PIN attempts. |
| **Enforcement Point** | Edge Host Local API (`POST /api/v1/auth/station-unlock` / `supervisorUnlockStation`) |
| **Offline Evaluation** | **SÍ** — Evaluated entirely locally at the Edge host using cached credentials in SQLite WAL (`cached_users.roles_json`). |
| **Tenant Boundary** | **Strict Isolation** — Supervisor `cached_users.organization_id` must match `station.organization_id`. Cross-tenant attempts fail closed with `AUTHENTICATION_FAILED`. |
| **Branch Boundary** | **Strict Isolation** — Supervisor must be enrolled and present in the local branch's `cached_users` cache. Cross-branch un-cached users fail closed. |
| **Default Functional Role Mapping** | - `ROLE-001 — Administrador`: **GRANTED (Default)**<br>- `ROLE-002 — Gerente / Supervisor`: **GRANTED (Default)**<br>- `ROLE-003` through `ROLE-008`: **DENIED (Default)** |
| **Custom Role Support** | **SÍ** — Any tenant-defined custom role possessing `"estacion.desbloquear"` in its `roles.permissions JSONB` is authorized upon sync to Edge. |
| **Denial Semantics** | Fails closed with typed error `INSUFFICIENT_PERMISSIONS`. Lockout state (`isLocked: true`), remaining duration, and consecutive failure counters remain fully active and unchanged. |
| **Audit Requirement** | Generates tamper-evident forensic audit event `SupervisorStationUnlocked` committed atomically inside the same SQLite transaction as the lockout reset. |

### 5.4 Representation in Cache & Sync
In Cloud PostgreSQL:
```sql
-- roles table
roles.permissions = '["estacion.desbloquear", ...]'::jsonb;
```

In Edge SQLite:
```sql
-- cached_users table
cached_users.roles_json = '["ROLE-002", "estacion.desbloquear"]';
```
`roles_json` represents a serialized JSON array containing both assigned role codes (e.g., `ROLE-001`, `ROLE-002`) and resolved canonical permission strings (e.g., `estacion.desbloquear`, `comanda.iniciar`).

### 5.5 Runtime Evaluation Rule (Transitional & Long-Term)
To ensure robust zero-downtime operation across initial database seed states and synchronized production profiles, the Edge runtime evaluates:
```typescript
const hasSupervisorAuthority =
  roles.some((r) => r.trim().toLowerCase() === 'estacion.desbloquear') ||
  roles.some((r) => {
    const norm = r.trim().toUpperCase();
    return norm === 'ROLE-001' || norm === 'ROLE-002';
  });
```
- **Authorized:** Explicit permission `estacion.desbloquear` OR canonical functional codes `ROLE-001` (Administrador) / `ROLE-002` (Gerente/Supervisor) from SSOT Section 7.
- **Strictly Prohibited:** Invented bilingual aliases (such as `ADMIN`, `MANAGER`, `admin`, `manager`) or non-supervisory role names (`ROLE-003`, `ROLE-004`, `Cajero`, `Mesero`, `STAFF`, etc.) without `estacion.desbloquear`. Any attempt using ungrounded aliases fails closed with `INSUFFICIENT_PERMISSIONS`.

---

## 6. Backward Compatibility & System Impacts

### 6.1 Backward Compatibility
- **Full Compatibility:** Canonical seed scripts and initial role configurations for `ROLE-001` and `ROLE-002` include `estacion.desbloquear`. Existing test suites and seed data remain valid.

### 6.2 Data Model Impact
- **Zero Schema Migrations:** No column additions, DDL alterations, or index changes are required in either Cloud PostgreSQL (`public.roles`) or Edge SQLite (`cached_users`). The existing JSON/JSONB array structures natively support the new capability string.

### 6.3 IAM Security Model Impact
- Formalizes Section 3 of `IAM_SECURITY_MODEL.md`: Replaces the qualitative phrase *"un usuario con privilegios de supervisión local"* with the precise technical requirement: *"un usuario con el permiso canónico `estacion.desbloquear` (asignado por defecto a ROLE-001 Administrador y ROLE-002 Gerente/Supervisor)."*

### 6.4 Implementation Impact (WP-010)
- In `packages/edge/src/iam/offline-iam-service.ts`: `supervisorUnlockStation` authorizes requests by checking for `estacion.desbloquear` (with canonical fallback to `ROLE-001` / `ROLE-002`), rejecting invented aliases `ADMIN` and `MANAGER`.

### 6.5 Test Obligations
- `WP010-T30` is mandated to test:
  1. User with permission `estacion.desbloquear` successfully unlocks station.
  2. User with canonical `ROLE-001` or `ROLE-002` successfully unlocks station.
  3. User with ungrounded role codes `ADMIN` or `MANAGER` without `estacion.desbloquear` fails closed with `INSUFFICIENT_PERMISSIONS`.
  4. Operational roles (`ROLE-003`, `ROLE-004`, `Cajero`, `Mesero`, etc.) without `estacion.desbloquear` fail closed with `INSUFFICIENT_PERMISSIONS`.
  5. Cross-tenant supervisor attempts fail closed (`AUTHENTICATION_FAILED`).

### 6.6 Migration & Rollback Impact
- **Migration:** No manual database migration required.
- **Rollback:** Reverting this ACR restores the transitional role check without schema corruption or state inconsistency.

### 6.7 Open Security Validation Debt Impact
- Permits full closure of `SEC-VAL-02` (Offline IAM brute-force and lockout validation) once implemented and verified in WP-010 successor candidate `S10-R4`.
- `SEC-VAL-08` (Argon2id benchmark on $\le 2\text{ GB}$ hardware) remains unchanged as `OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED`.
- `SEC-VAL-03` (Target hardware LAN mDNS/TLS validation) remains unchanged as `OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED` (deferred to WP-028).

### 6.8 Protected Product Owner Decisions
All nine (9) protected PO questions remain strictly **`PENDING PO DECISION`**:
- `OQ-SSOT-01`: Post-kitchen cancellation policy (`PENDING PO DECISION`)
- `OQ-SSOT-02`: Waiter transfer password requirement (`PENDING PO DECISION`)
- `OQ-SSOT-03`: Accounts receivable credit limit validation (`PENDING PO DECISION`)
- `OQ-SSOT-04`: Mobile total account cancellation flow (`PENDING PO DECISION`)
- `OQ-SSOT-05`: Automatic purchase suggestion criteria (`PENDING PO DECISION`)
- `OQ-SSOT-06`: Bill split discount & tip proration rules (`PENDING PO DECISION`)
- `OQ-SSOT-07`: Recipe modifier priority & consolidation (`PENDING PO DECISION`)
- `OQ-ARCH-01`: Multi-cashier shift model (`PENDING PO DECISION`)
- `OQ-ARCH-02`: Unbilled folios monthly closing treatment (`PENDING PO DECISION`)

---

## 7. Approval & Governance Status

- **Primary Author:** `01_Solution_Architect`
- **Security Review:** `08_Security_Architect` — Verdict: `PASS` (Documented in `evidence/WP-010_SUPERVISOR_UNLOCK_RBAC_SECURITY_REVIEW.md`)
- **Product Owner Status:** `READY FOR PRODUCT OWNER APPROVAL`
- **Governing Invariant:** Implementation remains frozen on candidate `S10-R3` (PR #32 open and unmerged) until Product Owner approves this ACR and merges it into canonical main.
