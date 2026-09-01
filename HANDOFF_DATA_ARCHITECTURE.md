# HANDOFF — TO DATA ARCHITECTURE (EAAF AGENT 03)

**From:** `Product Owner & Solution Architect`  
**To agent:** `03_Data_Architect`  
**Repository:** `https://github.com/Lucas030509/TRIDENTPOS.git`  
**Branch:** `main`  
**Approved Architecture Baseline SHA:** `9c0961c2c466375f9a219da06c988335b77d2733`  
**Gate Evidence SHA:** `eefd3d8bdd7c68812ecfe23e56939ade163c1257`  
**EAAF Governance Pin:** `https://github.com/Lucas030509/EAAF-Framework @ 7e036f43240b3dc28ccb996e350263598275b2cd` (v1.2.0)  
**Target Gate:** `gates/DATA_ARCHITECTURE_GATE.md`  
**Scope:** `Diseño y especificación de Data Architecture (Esquemas PostgreSQL Cloud, Esquemas SQLite Edge, Mapeo de Replicación, Estrategia de Migraciones y Diccionario de Datos)`  

---

## 1. Authoritative Inputs
- `PROJECT_BLUEPRINT.md` (v1.3 APPROVED / FROZEN)
- `project-manifest.json`
- `PRODUCT_OWNER_ARCHITECTURE_APPROVAL.md`
- `SOLUTION_ARCHITECTURE_GATE_EVIDENCE.md`
- `FUNCTIONAL_ARCHITECTURE.md` (v1.3 APPROVED / FROZEN)
- `SYSTEM_CONTEXT.md` (v1.3 APPROVED / FROZEN)
- `SOLUTION_ARCHITECTURE.md` (v1.3 APPROVED / FROZEN)
- `DEPLOYMENT_TOPOLOGY.md` (v1.3 APPROVED / FROZEN)
- `SYNC_AND_OFFLINE_ARCHITECTURE.md` (v1.3 APPROVED / FROZEN)
- `TECH_STACK_DECISIONS.md` (v1.3 APPROVED / FROZEN)
- `ARCHITECTURE_RISKS.md` (v1.3 APPROVED / FROZEN)
- `ADR/` (`ADR-001` a `ADR-008` APPROVED / FROZEN)

---

## 2. Mandatory Architectural Constraints for Data Architecture
Data Architecture **MUST NOT** modify or violate the following frozen solution decisions:
1. **Bounded Contexts:** Preservar los 11 módulos del Monolito Modular sin introducir dependencias circulares ni acoplamiento físico directo de tablas entre módulos.
2. **Data Authority Matrix:** Respetar la autoridad definida en `SYSTEM_CONTEXT.md` y `ADR-002` para las 4 topologías.
3. **Folio Continuity Protocol:** Implementar estrictamente las tablas de Lease de Folios con `epochId`, `leaseId`, `fencingToken` y rango `ABANDONED_CONTINGENCY_RANGE` en Cloud y Edge (`ADR-008`, `SYNC_AND_OFFLINE_ARCHITECTURE.md`).
4. **Optimistic Concurrency Control (OCC):** Incluir columna `version` (entero monotónico) en las tablas `cuentas`, `mesas` y `turnos_caja` (`ADR-006`, `SOLUTION_ARCHITECTURE.md`).
5. **Transactional Outbox:** Diseñar las tablas `CloudIntegrationOutbox` / `CloudIntegrationDLQ` en PostgreSQL y `OutboxQueue` / `IngestedIdempotencyLog` en SQLite (`ADR-006`, `ADR-007`).
6. **SQLite Storage Engine:** Esquemas de borde optimizados para SQLite 3 en modo `WAL` con `PRAGMA synchronous = NORMAL / FULL` (`ADR-004`).
7. **Offline IAM Storage:** Tabla local `CachedUsers` con hashes salteados de PIN (Argon2id) y campos `snapshotVersion`, `issuedAt`, `expiresAt` (`ADR-004`, `SOLUTION_ARCHITECTURE.md`).
8. **Delivery vs Integrations Ownership:** `Integrations Hub` almacena credenciales y mapeos de plataformas externas; `Delivery` almacena exclusivamente zonas, tarifas y liquidaciones de flota propia (`FUNCTIONAL_ARCHITECTURE.md`).
9. **Canonical Event Names:** `RecepcionCompraRegistrada`, `TurnoCajaCerrado`, `CorteZGenerado`, `OrdenProduccionConfirmadaEnKDS`.

---

## 3. Protected Product Owner Decisions
Las siguientes 9 decisiones continúan abiertas como **`PENDING PO DECISION`** y los modelos de datos deben mantenerse neutrales:
- OQ-SSOT-01 a OQ-SSOT-07
- OQ-ARCH-01 a OQ-ARCH-02

---

## 4. Residual Risks for Downstream Validation
- **RSK-08:** Power-loss validation en hardware POS + SQLite WAL.
- **RSK-11:** Benchmark de footprint en terminales POS de baja gama.
- **RSK-15:** Simulacros de recuperación ante desastres (DR drills).

---

## 5. Next Steps
1. Activación de `03_Data_Architect`.
2. Elaboración de artefactos de Data Architecture conformes a `templates/DATA_ARCHITECTURE_TEMPLATE.md` y `standards/DATA_STANDARDS.md`.
3. Evaluación independiente ante `DATA_ARCHITECTURE_GATE`.

---

STATUS: READY FOR DATA ARCHITECTURE PHASE
