# HANDOFF — TO IMPLEMENTATION READINESS PHASE

**From Authority:** `PRODUCT OWNER`  
**To Phase:** `IMPLEMENTATION READINESS`  
**Authoring Lead:** `01_Solution_Architect`  
**Independent Gate Reviewer:** `Independent Solution Architect`  
**Target Gate:** `gates/IMPLEMENTATION_READINESS_GATE.md`  
**Project:** `ERP RESTAURANTES / TRIDENTPOS`  
**Framework Pin:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Date:** `2026-09-03`  

---

## 1. Frozen Architecture Inputs (Prerequisite Baselines)

All 4 architectural foundational phases are officially **`APPROVED / FROZEN`**:
1. **Functional Architecture (SSOT):** `FUNCTIONAL_ARCHITECTURE.md` (v1.2 APPROVED)
2. **Solution Architecture:** Tag `solution-architecture-v1.3-approved` (`e35205906055a8425ab875d05789652b3c3497b7`)
3. **Data Architecture:** Tag `data-architecture-v1.0-approved` (`9d076c1a8f674b2411991b20fa4faa83b85f708a`)
4. **Security Architecture:** Tag `security-architecture-v1.0-approved`

---

## 2. Inviolable Architectural Constraints for Implementation Planning

Implementation planning must **NOT** reinterpret or alter any frozen architecture decisions:
- **11 Bounded Contexts:** Modular Monolith architecture in Cloud + Edge runtime.
- **4 Data Topologies:** Full Suite, Standalone POS, Backoffice Standalone, Corporate Hybrid.
- **Data Authority Matrix:** Cloud is SoR for master catalogs; Branch Edge is Primary Write Authority for floor orders, KDS, cash and X/Z cuts.
- **Folio Leases:** Cloud-allocated disjoint ranges with strict monotonicity (`epochId`) and fencing tokens.
- **Concurrency & Messaging:** OCC with `expectedVersion` and Transactional Outbox.
- **Zero Trust Security:**
  - Mandatory backend authorization in trusted boundary.
  - Multi-tenant isolation via PostgreSQL RLS with `SET LOCAL app.current_organization_id = :orgId;` (Default Deny).
  - Physical QR/OTP trust bootstrap with `edgePublicKeyFingerprint` binding.
  - Minimal PCI scope (zero PAN/CVV storage).
  - Two-layer tamper-evident audit.
  - Signed Electron auto-updates.

---

## 3. Protected Product Owner Decisions (9 Open Questions)

The implementation plan must strictly treat the 9 decisions as `PENDING PO DECISION`:
- Work packages covering these capabilities must be architecturally isolated and parameterized to support the eventual PO decision without blocking core implementation.
1. `OQ-SSOT-01` (Cancelación Post-Cocina)
2. `OQ-SSOT-02` (PIN Transferencia Cuenta)
3. `OQ-SSOT-03` (Límite Crédito CxC)
4. `OQ-SSOT-04` (Cancelación Total Móvil)
5. `OQ-SSOT-05` (Algoritmo Abastecimiento)
6. `OQ-SSOT-06` (Prorrateo Split Cuenta)
7. `OQ-SSOT-07` (Recetas Modificadores)
8. `OQ-ARCH-01` (Turnos Multi-Cajero)
9. `OQ-ARCH-02` (Facturación Global)

---

## 4. Downstream Security Validation Debt to Incorporate

The Implementation Plan must explicitly assign test packages and evidence requirements for the 11 cataloged validation debts:
1. Multi-Tenant Isolation (RLS bypass / tenant breakout penetration tests)
2. Offline IAM (PIN brute force and lockout tests)
3. Trust Bootstrap (mDNS spoofing and certificate mismatch tests)
4. Lease Fencing (Zombie node reactivation tests)
5. Secrets & Vault (Secret scanning and log redaction verification)
6. Tamper-Evident Audit (SQLite alteration and Cloud checkpoint verification)
7. Electron Security (SAST and IPC allowlist verification)
8. Hardware Benchmark (SEC-08: Argon2id benchmark on $\le 2\text{ GB}$ RAM hardware)
9. Failure-Mode Validation (R2F-05: Offline continuity under simulated WAN outage)
10. Provider Contracts (Delivery webhook signature and timestamp verification)
11. Legal/Privacy (Provisional retention policies formal review)

---

## 5. Required Implementation Readiness Deliverables

The author (`01_Solution_Architect`) must generate:
1. **`IMPLEMENTATION_PLAN.md`:** Atomic work packages mapping back to frozen artifacts with assigned builder agents, independent reviewers, prerequisites, test criteria, rollback strategies, and dependencies.
2. **`IMPLEMENTATION_READINESS_EVIDENCE.md`:** Self-check against `gates/IMPLEMENTATION_READINESS_GATE.md`.
3. **`HANDOFF_IMPLEMENTATION.md`:** Handoff to builders once the gate is passed.

---

STATUS: READY FOR IMPLEMENTATION READINESS PLANNING
