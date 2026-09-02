# DATA BACKUP, RESTORE & DISASTER RECOVERY SPECIFICATION — ERP RESTAURANTES

**Document ID:** `ARCH-BCK-001`  
**Version:** `1.0 APPROVED / FROZEN`  
**Status:** `APPROVED / FROZEN — 2026-09-01`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `03_Data_Architect`  
**Approved Solution Baseline:** `e35205906055a8425ab875d05789652b3c3497b7` (Tag `solution-architecture-v1.3-approved`)  

---

## 1. Arquitectura de Respaldos

### 1.1 Cloud Control Plane (PostgreSQL en Supabase)
- **Continuo:** WAL archiving con Point-in-Time Recovery (PITR) con retención de 30 días.
- **Diario:** Snapshot completo físico automatizado a las 03:00 UTC.
- **Semanal:** Volcado lógico (`pg_dump`) cifrado por Tenant exportado a almacenamiento frío S3.

### 1.2 Branch Operational Plane (SQLite 3 WAL en Edge)
- **Modo Consistente:** Generación mediante `VACUUM INTO` para garantizar snapshots no corruptos sin detener lectores concurrentes.
- **Periodicidad:**
  - Respaldo diario automático programado al cierre de operaciones.
  - Respaldo mandatorio previo a la ejecución de migraciones DDL locales.

---

## 2. Catálogo de 8 Escenarios de Recuperación y Restauración

| Escenario de Falla | Authoritative Source | Restore Source | Procedimiento de Recuperación | Criterio de Reconciliación |
|---|---|---|---|---|
| **1. Caída Total de Cloud PostgreSQL** | Supabase PITR | Último WAL / Snapshot | Restauración gestionada de instancia y verificación de integridad RLS. | Re-drenado de outbox local desde sucursales. |
| **2. Corrupción de Tenant Aislado** | Snapshot Lógico S3 | Snapshot Tenant específico | Restauración selectiva de registros del tenant mediante `organization_id`. | Verificación de claves foráneas y auditoría. |
| **3. Corrupción Física de SQLite en Edge** | Snapshot Local / Cloud | Último backup local + Cloud | Restauración de archivo SQLite local y solicitud de deltas de catálogo a Cloud. | Re-sincronización de outbox pendiente. |
| **4. Pérdida Total de Hardware de Edge** | Cloud PostgreSQL (SoR) | Cloud Bootstrap API | Aprovisionamiento de nuevo hardware, incremento de época (`ep_2`), marcado de folios de `ep_1` como `ABANDONED_CONTINGENCY_RANGE`. | **Protocolo de Reconciliación Manual y Auditoría Física** (`TurnoDeAjustePorContingencia`). |
| **5. Borrado Accidental de Datos en Borde** | Cloud PostgreSQL | Cloud Read Replica | Re-descarga atómica del catálogo maestro y configuración de sucursal. | N/A (Cloud es SoR). |
| **6. Divergencia de Sincronización WAN** | Cloud Ingestion Log | Cloud Buffer Queue | Detección de gap de secuencia (`aggregateSequenceNumber`), solicitud de reenvío al Edge. | Cierre de brecha antes de aplicar cambios en base principal. |
| **7. Eventos Venenosos en DLQ** | Cloud Integration DLQ | Tabla `cloud_integration_dlq`| Inspección técnica de payload, corrección de schema y re-despacho auditado por Admin. | Cero re-ejecución duplicada (`idempotencyKey`). |
| **8. Reaparición de Zombie Host Reemplazado** | Cloud Lease Registry | Fencing Token en Cloud | Rechazo inmediato con `403 LEASE_REVOKED`, bloqueo en solo-lectura para análisis forense. | Cero contaminación de datos en Cloud. |

---

## 3. Procedimiento de Validación de Restauración (Testable Restore Validation)

Para certificar la arquitectura ante el `DATA_ARCHITECTURE_GATE`, se definen las pruebas obligatorias downstream (`RESTORE VALIDATION REQUIRED`):

### 3.1 Prueba Automatizada de Contingencia de Hardware (Disaster Recovery Simulation)
1. **Precondición:** Sucursal operando offline emitiendo 50 comandas y 10 tickets bajo lease `ep_1` (rango 1001–1500).
2. **Inyección de Falla:** Destrucción simulada de la base de datos local (borrado de archivo `.db` y WAL).
3. **Procedimiento:**
   - Registro de nodo de reemplazo en Cloud.
   - Cloud incrementa época a `ep_2` y asigna rango 1501–2000.
   - Nuevo nodo arranca, descarga configuración y emite folio 1501.
   - Nodo antiguo reaparece e intenta sincronizar folios 1001–1010.
4. **Criterio de Éxito (PASS):**
   - Cloud responde `403 LEASE_REVOKED` al nodo antiguo.
   - Folios 1001–1500 permanecen en `ABANDONED_CONTINGENCY_RANGE`.
   - Nuevo nodo opera desde 1501 sin colisiones numéricas.

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
