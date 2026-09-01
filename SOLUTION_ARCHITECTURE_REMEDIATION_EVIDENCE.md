# SOLUTION ARCHITECTURE REMEDIATION EVIDENCE

**Framework:** `EAAF v1.2.0`  
**Repository:** `https://github.com/Lucas030509/TRIDENTPOS.git`  
**Branch:** `architecture/solution-remediation`  
**Baseline Commit:** `7c686b5766098200febb6605db01f7645c6cdf32`  
**EAAF Commit:** `7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `01_Solution Architect (Remediation Author)`  
**Target Gate:** `SOLUTION_ARCHITECTURE_GATE`  
**Reviewer Authority:** `Independent Solution Architect`  
**Date:** 2026-09-01  

---

## A. Baseline Information

| Evidence Item | Value |
|---|---|
| **Project Repository** | `https://github.com/Lucas030509/TRIDENTPOS.git` |
| **Project Baseline Branch** | `main` |
| **Project Baseline Commit** | `7c686b5766098200febb6605db01f7645c6cdf32` |
| **Remediation Branch** | `architecture/solution-remediation` |
| **EAAF Repository** | `https://github.com/Lucas030509/EAAF-Framework` |
| **EAAF Version** | `1.2.0` |
| **EAAF Ref** | `codex/eaaf-v1.2-governance` |
| **EAAF Commit** | `7e036f43240b3dc28ccb996e350263598275b2cd` |

---

## B. Changed Files

| File Path | Previous Version | New Version | REM Topics Addressed |
|---|---|---|---|
| `ARCHITECTURE_CHANGE_REQUEST.md` | *New* | v1.0 | REM-01 a REM-13 |
| `SYSTEM_CONTEXT.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-03, REM-06, REM-09, REM-12, REM-13 |
| `SOLUTION_ARCHITECTURE.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-02, REM-05, REM-06, REM-09, REM-13 |
| `DEPLOYMENT_TOPOLOGY.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-06, REM-08, REM-13 |
| `SYNC_AND_OFFLINE_ARCHITECTURE.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-01, REM-04, REM-06, REM-07, REM-09, REM-10, REM-13 |
| `TECH_STACK_DECISIONS.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-06, REM-07, REM-08, REM-13 |
| `ARCHITECTURE_RISKS.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-01 a REM-13 (15 Escenarios de Riesgo) |
| `FUNCTIONAL_ARCHITECTURE.md` | v1.2 | v1.3 NORMALIZED / REMEDIATED | REM-11, REM-12, REM-13 |
| `MODULE_CATALOG.md` | v1.2 | v1.3 NORMALIZED / REMEDIATED | REM-12, REM-13 |
| `CAPABILITY_MAP.md` | v1.2 | v1.3 NORMALIZED / REMEDIATED | REM-12, REM-13 |
| `PRODUCT_DECISIONS.md` | v1.2 | v1.3 NORMALIZED / REMEDIATED | REM-06, REM-13 |
| `PRODUCT_SCOPE.md` | v1.2 | v1.3 NORMALIZED / REMEDIATED | REM-06, REM-13 |
| `OPEN_QUESTIONS.md` | v1.1 | v1.3 NORMALIZED / REMEDIATED | REM-13 (9 Decisiones Protegidas Preservadas) |
| `PROJECT_BLUEPRINT.md` | v1.0 | v1.3 NORMALIZED / REMEDIATED | REM-06, REM-13 |
| `ADR/ADR-001-modular-monolith-bounded-contexts.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-06, REM-13 |
| `ADR/ADR-002-cloud-branch-data-authority-by-topology.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-03, REM-13 |
| `ADR/ADR-003-edge-host-runtime-electron-vs-tauri.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-08, REM-13 |
| `ADR/ADR-004-embedded-database-sqlite-durability.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-07, REM-13 |
| `ADR/ADR-005-local-lan-communication-protocol.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-05, REM-08, REM-13 |
| `ADR/ADR-006-outbox-and-idempotent-sync.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-04, REM-13 |
| `ADR/ADR-007-durable-cloud-integration-events.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-05, REM-11, REM-13 |
| `ADR/ADR-008-disaster-recovery-strategy.md` | v1.0 | v1.2 ACCEPTED WITH VALIDATION REQUIRED | REM-01, REM-06, REM-13 |

---

## C. Remediation Compliance Matrix (REM-01 a REM-13)

| REM ID | Remediation Requirement | Status | Evidence Document / Section | Summary of Remediation Applied |
|---|---|---|---|---|
| **REM-01** | Safe Folio Continuity after Total Edge Loss | **RESOLVED** | `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec. 1), `ADR-008`, `ARCHITECTURE_RISKS.md` (RSK-01, RSK-02) | Protocolo de Lease de Folios con Épocas (`epochId`), reserva en Cloud como `ALLOCATED_POTENTIALLY_CONSUMED`, marcado de `ABANDONED_CONTINGENCY_RANGE` ante desastre, asignación limpia sin superposición a nodos de reemplazo y fencing de nodos antiguos con `403 LEASE_REVOKED`. |
| **REM-02** | Optimistic Concurrency Control (OCC) | **RESOLVED** | `SOLUTION_ARCHITECTURE.md` (Sec. 2), `ARCHITECTURE_RISKS.md` (RSK-03) | Preservado y formalizado OCC con `expectedVersion` sobre `Cuenta`, `Mesa` y `TurnoCaja`, conditional update SQL y retorno de `409 Conflict` para fusión informada. |
| **REM-03** | Data Authority by Topology | **RESOLVED** | `SYSTEM_CONTEXT.md` (Sec. 3), `ADR-002`, `ARCHITECTURE_RISKS.md` (RSK-04) | Matriz exhaustiva de autoridad de datos en las 4 topologías (Full Suite, TRIDENTPOS Standalone, Backoffice Standalone, Híbrido) cubriendo todos los agregados sin dual-ownership implícito. |
| **REM-04** | Idempotency, Causality & ACK Semantics | **RESOLVED** | `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec. 2), `ADR-006`, `ARCHITECTURE_RISKS.md` (RSK-05, RSK-06) | Reglas estrictas de generación y no regeneración de `clientOpId`, orden causal mediante `aggregateSequenceNumber`, `ReorderingBufferQueue` para gaps, estados de ACK tipados (`RECEIVED` → `DURABLY_STORED` → `APPLIED` → `DUPLICATE_ACCEPTED`) y aislamiento en DLQ tras 5 reintentos. |
| **REM-05** | Durable Integration Events | **RESOLVED** | `SOLUTION_ARCHITECTURE.md` (Sec. 3), `ADR-007`, `ARCHITECTURE_RISKS.md` (RSK-07) | Separación formal de eventos en memoria vs. eventos durables persistidos atómicamente en `CloudIntegrationOutbox` (PostgreSQL) para `CorteZGenerado`, `RecepcionCompraRegistrada` y `OrdenProduccionConfirmadaEnKDS`. |
| **REM-06** | Remove False Absolutes | **RESOLVED** | Todos los documentos del Set de Solución | Sustitución sistemática de afirmaciones infladas ("100%", "cero pérdida", "ininterrumpido", "RPO=0") por términos calibrados: `DESIGN OBJECTIVE`, `TARGET (REQUIRES VALIDATION)`, `ESTIMATE`, `HARDWARE BENCHMARK REQUIRED`. |
| **REM-07** | SQLite Durability & Storage | **RESOLVED** | `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec. 3), `TECH_STACK_DECISIONS.md` (Sec. 3), `ADR-004`, `ARCHITECTURE_RISKS.md` (RSK-08, RSK-09, RSK-10) | Configuración `WAL` + `NORMAL`/`FULL`, dependencias de SSD/UPS, checkpointing pasivo/manual, umbrales de espacio en disco (<15% alerta, <5% read-only), detección de corrupción con `PRAGMA integrity_check` y etiqueta `REQUIRES HARDWARE POWER-LOSS VALIDATION`. |
| **REM-08** | Edge Runtime Evaluation | **RESOLVED** | `TECH_STACK_DECISIONS.md` (Sec. 2), `ADR-003`, `ADR-005`, `ARCHITECTURE_RISKS.md` (RSK-11) | Comparativa cualitativa de Electron/Node vs Tauri/Rust; métricas de recursos etiquetadas como `INDUSTRY ESTIMATE — NOT PROJECT BENCHMARKED`; directiva obligatoria `FINAL EDGE RUNTIME CERTIFICATION REQUIRES BENCHMARK ON TARGET POS HARDWARE`. |
| **REM-09** | Offline IAM Architecture | **RESOLVED** | `SYSTEM_CONTEXT.md` (Sec. 4), `SOLUTION_ARCHITECTURE.md` (Sec. 4), `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec. 5), `ARCHITECTURE_RISKS.md` (RSK-12) | Hashes salteados de PIN (Argon2id) en caché local, snapshot de RBAC con `snapshotVersion`, `issuedAt`, `expiresAt`, ventana máxima offline de 72h, políticas de revocación y auditoría local inmutable. |
| **REM-10** | Cloud → Branch Downstream Sync | **RESOLVED** | `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec. 4), `ARCHITECTURE_RISKS.md` (RSK-13) | Sincronización descendente con deltas versionados, aplicación atómica y **Snapshot Económico Inmutable Obligatorio** (los precios congelados de cuentas abiertas no son alterados retroactivamente por cambios de catálogo). |
| **REM-11** | Event Name Governance | **RESOLVED** | `ARCHITECTURE_CHANGE_REQUEST.md` (Sec. 2), `FUNCTIONAL_ARCHITECTURE.md` (Sec. 6.4), `ADR-007` | Normalización formal de `RecepcionCompraRegistrada` (depreca `RecepcionCompraAplicada`) y `TurnoCajaCerrado` (depreca `TurnoCerrado`) con tabla formal de depreciación y compatibilidad. |
| **REM-12** | Delivery vs. Integrations Ownership | **RESOLVED** | `SYSTEM_CONTEXT.md` (Sec. 5), `FUNCTIONAL_ARCHITECTURE.md` (Sec. 3, 6.5), `MODULE_CATALOG.md` (MOD-08, MOD-11), `ARCHITECTURE_RISKS.md` (RSK-14) | `Integrations Hub` asume 100% de conectores de plataformas externas (Uber/Rappi/Didi/Deliverect); `Delivery` asume 100% de logística de flota propia. Eliminado `ExternalPlatformOrder` de Delivery. |
| **REM-13** | Document Version Governance | **RESOLVED** | Todos los 14 documentos del Set de Solución y SSOT | Unificación de encabezados, pies de página, Document IDs, versiones `1.3 NORMALIZED / REMEDIATED` y estatus `READY FOR INDEPENDENT REVIEW`. |

---

## D. Protected Product Owner Decisions Status

Las 9 decisiones de negocio se mantienen estrictamente como **`PENDING PO DECISION`**:
1. **OQ-SSOT-01:** Política y permisos de cancelación de productos post-cocina.
2. **OQ-SSOT-02:** Requerimiento de credencial/PIN de mesero receptor para transferencias en comandero.
3. **OQ-SSOT-03:** Política y límites de crédito para cuentas por cobrar (CxC).
4. **OQ-SSOT-04:** Cancelación total de cuentas impresas desde comandero móvil.
5. **OQ-SSOT-05:** Criterios de sugerencia automática vs. manual en compras (`Configurable replenishment policy — PENDING PO DECISION`).
6. **OQ-SSOT-06:** Reglas de prorrateo financiero de descuentos y propinas al dividir cuentas.
7. **OQ-SSOT-07:** Consolidación y prioridad de recetas en compuestos con modificadores.
8. **OQ-ARCH-01:** Modelo de turnos multi-cajero en terminales compartidas.
9. **OQ-ARCH-02:** Facturación global automática para folios no reclamados.

---

## E. Remaining Architectural Risks Summary

- **Blockers:** `0` (Cero bloqueadores arquitectónicos).
- **High Risks:** `1` (Riesgo de corte eléctrico en SSDs de bajo costo sin UPS — Mitigado mediante requerimiento de UPS obligatorio y pruebas de power-loss testing).
- **Medium Risks:** `3` (Consumo de RAM en hardware POS de gama baja; sincronización tardía de deltas en sucursales con WAN degradada; validación empírica de RTO/RPO en simulacros).
- **Low / Very Low Risks:** `11` (Concurrencia OCC, fencing de nodos zombie, eventos en DLQ, orden causal, etc. completamente mitigados).

---

## F. Gate Readiness Verdict

### `READY FOR INDEPENDENT GATE RE-REVIEW`
