# DATA ARCHITECTURE RISKS & MITIGATION MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-DRSK-001`  
**Version:** `1.0 APPROVED / FROZEN`  
**Status:** `APPROVED / FROZEN — 2026-09-01`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect`  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Matriz de Riesgos Específicos de Data Architecture

| ID | Riesgo / Escenario de Falla | Severidad | Probabilidad | Impacto | Estrategia de Mitigación de Datos | Método de Validación Requerido | Riesgo Residual |
|---|---|---|---|---|---|---|---|
| **DAT-01** | **Fuga de Datos Cross-Tenant en Consultas Analíticas** | Crítica | Baja | Alto | RLS obligatorio a nivel PostgreSQL en todas las tablas + Claves foráneas compuestas que incluyen `organization_id`. | Pruebas automatizadas de inyección multi-tenant en CI/CD. | **Muy Bajo** |
| **DAT-02** | **Divergencia de Estado en Sincronización Asíncrona WAN** | Alta | Media | Medio | Monotonic `aggregateSequenceNumber` por agregado + `ReorderingBufferQueue` en Cloud. | Pruebas de inyección de paquetes de red fuera de orden. | **Bajo** |
| **DAT-03** | **Duplicación de Efectos Financieros por Reintentos de Red** | Crítica | Media | Alto | Deduplicación determinista en Cloud mediante `idempotencyKey` + `clientOpId` inmutable con retención de 90 días. | Pruebas de retransmisión masiva de payloads outbox idénticos. | **Muy Bajo** |
| **DAT-04** | **Corrupción de SQLite por Apagón Durante Escritura en Borde** | Alta | Media | Alto | `PRAGMA journal_mode = WAL`, `synchronous = FULL` en cierres de caja y respaldo obligatorio mediante UPS. | `REQUIRES HARDWARE POWER-LOSS VALIDATION` en dispositivos POS objetivo. | **Medio** (Depende de hardware y UPS) |
| **DAT-05** | **Fallo en Migración DDL Local de SQLite** | Alta | Baja | Alto | Backup consistente obligatorio antes de migrar (`VACUUM INTO`) + Transacción atómica única con rollback automático. | Pruebas de migración con inyección de errores sintácticos. | **Bajo** |
| **DAT-06** | **Alteración Retroactiva de Precios en Cuentas Abiertas** | Alta | Media | Medio | Preservación de Snapshot Económico inmutable en `cuenta_items` al ordenar. | Prueba de actualización de catálogo en Cloud con mesa abierta en Edge. | **Cero** (Inmutabilidad de modelo) |
| **DAT-07** | **Incompatibilidad de Esquemas Cloud vs. Edge Antiguo** | Media | Media | Medio | Protocolo de negociación WSS (`protocolVersion`, `minimumSupportedVersion`) y rechazo `426 Upgrade Required`. | Pruebas de conexión de clientes con esquemas desfasados. | **Bajo** |
| **DAT-08** | **Imposibilidad de Restauración de Backups en Desastre** | Alta | Baja | Alto | Procedimiento de restauración formalizado y catalogado en 8 escenarios de contingencia. | `RESTORE VALIDATION REQUIRED` en simulacro formal. | **Bajo** |

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
