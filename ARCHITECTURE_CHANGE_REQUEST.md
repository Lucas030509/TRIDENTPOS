# ARCHITECTURE CHANGE REQUEST (ACR-001)

**ID:** `ACR-2026-001`  
**Framework:** `EAAF v1.2.0`  
**Requester:** `01_Solution Architect (Remediation Author)`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Target Gate:** `SOLUTION_ARCHITECTURE_GATE`  
**Affected Artifacts:**
- `SYSTEM_CONTEXT.md`
- `SOLUTION_ARCHITECTURE.md`
- `DEPLOYMENT_TOPOLOGY.md`
- `SYNC_AND_OFFLINE_ARCHITECTURE.md`
- `TECH_STACK_DECISIONS.md`
- `ARCHITECTURE_RISKS.md`
- `FUNCTIONAL_ARCHITECTURE.md`
- `MODULE_CATALOG.md`
- `CAPABILITY_MAP.md`
- `PRODUCT_DECISIONS.md`
- `PRODUCT_SCOPE.md`
- `PROJECT_BLUEPRINT.md`
- `ADR/` (`ADR-001` a `ADR-008`)

---

## 1. Requested Changes Summary (REM-01 to REM-13)

| REM ID | Topic | Nature of Architectural Change |
|---|---|---|
| **REM-01** | Safe Folio Continuity | Implementación del protocolo de **Lease Preasignado de Folios con Generación de Época (`epochId`) y Fencing Tokens** para evitar colisiones de folios tras pérdida total del Edge Host y aislar nodos antiguos. |
| **REM-02** | Optimistic Concurrency | Formalización del Control de Concurrencia Optimista (OCC) con `expectedVersion` y `409 Conflict` en `Cuenta`, `Mesa` y `TurnoCaja`. |
| **REM-03** | Data Authority by Topology | Definición de matriz exhaustiva de autoridad de datos en las 4 topologías sin dual-ownership ambiguo. |
| **REM-04** | Idempotency & Causality | Especificación del ciclo de vida de `clientOpId`, buffer de reordenamiento de secuencias causales, estados estructurados de ACK y política de DLQ para eventos venenosos. |
| **REM-05** | Durable Integration Events | Persistencia obligatoria de eventos inter-módulo críticos en `CloudIntegrationOutbox` (PostgreSQL). |
| **REM-06** | False Absolutes Removal | Sustitución de afirmaciones absolutas por etiquetas de ingeniería: `DESIGN OBJECTIVE`, `TARGET (REQUIRES VALIDATION)`, `ESTIMATE`. |
| **REM-07** | SQLite Durability & Storage | Formalización de trade-offs `WAL` + `NORMAL`/`FULL`, dependencias de hardware SSD/UPS, checkpointing y detección de corrupción. |
| **REM-08** | Edge Runtime Certification | Comparativa cualitativa de `Electron/Node` vs `Tauri/Rust` clasificando métricas de recursos como estimaciones de industria sujetas a benchmark. |
| **REM-09** | Offline IAM Architecture | Modelo completo de autenticación y autorización local en modo offline con snapshots de RBAC, hashes salteados de PIN y expiración por tiempo máximo. |
| **REM-10** | Downstream Sync & Economic Snapshots | Mecanismo de sincronización descendente Cloud→Edge y preservación de snapshots económicos inmutables en cuentas abiertas. |
| **REM-11** | Event Naming Governance | Normalización canónica de `RecepcionCompraRegistrada` y `TurnoCajaCerrado` con tabla formal de alias y depreciación. |
| **REM-12** | Delivery vs Integrations | Asignación exclusiva de conectores externos a `Integrations` y logística de flota propia a `Delivery`. |
| **REM-13** | Version & Header Governance | Unificación de encabezados, pies de página, versiones y metadatos de gobernanza en todo el set documental. |

---

## 2. Event Naming Governance Matrix (REM-11)

| Legacy Name | Canonical Name | Domain / Context | Status | Compatibility & Mapping |
|---|---|---|---|---|
| `RecepcionCompraAplicada` | `RecepcionCompraRegistrada` | Procurement / Inventory | **DEPRECATED** | Alias aceptado en capa de ingesta con advertencia de telemetría; procesado internamente como `RecepcionCompraRegistrada`. |
| `TurnoCerrado` | `TurnoCajaCerrado` | TRIDENTPOS / Finance | **DEPRECATED** | Alias aceptado en capa de ingesta con advertencia de telemetría; procesado internamente como `TurnoCajaCerrado`. |

---

## 3. Protected Product Owner Decisions Status

Las siguientes 9 decisiones se mantienen estrictamente como **`PENDING PO DECISION`**:
1. **OQ-SSOT-01:** Política y permisos de cancelación de productos post-cocina.
2. **OQ-SSOT-02:** Requerimiento de credencial/PIN para transferencias de cuentas en comandero.
3. **OQ-SSOT-03:** Límite y validación de crédito en cuentas por cobrar (CxC).
4. **OQ-SSOT-04:** Cancelación total de cuentas impresas desde comandero móvil.
5. **OQ-SSOT-05:** Criterios de sugerencia automática vs. manual en compras (`Configurable replenishment policy — PENDING PO DECISION`).
6. **OQ-SSOT-06:** Reglas de prorrateo financiero de descuentos y propinas al dividir cuentas.
7. **OQ-SSOT-07:** Consolidación y prioridad de recetas compuestas con modificadores.
8. **OQ-ARCH-01:** Modelo de turnos multi-cajero en terminales compartidas.
9. **OQ-ARCH-02:** Facturación global automática para tickets no reclamados.

---

## 4. Impact and Risk Assessment

- **Impacto Arquitectónico:** Alto (mejora sustancial en la robustez ante desastres, seguridad offline e integridad transaccional).
- **Compatibilidad:** 100% compatible con los límites de dominio de la Functional Architecture v1.2.
- **Riesgo Residual:** Clasificado y documentado formalmente en `ARCHITECTURE_RISKS.md`.

---

## 5. Traceability and Sign-off

- **Remediation Author:** `01_Solution Architect`
- **Target Gate:** `gates/SOLUTION_ARCHITECTURE_GATE.md`
- **Reviewer Authority:** `Independent Solution Architect` (EAAF Agent 01 - Revisión Independiente)
