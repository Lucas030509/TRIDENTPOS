# ARCHITECTURE RISKS & MITIGATION MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-RSK-001`  
**Version:** `1.3 NORMALIZED / REMEDIATED`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Baseline:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Supersedes:** `ARCHITECTURE_RISKS.md v1.1`  

---

## 1. Matriz Exhaustiva de Riesgos Arquitectónicos

| ID | Riesgo / Escenario de Falla | Severidad | Probabilidad | Impacto | Estrategia de Mitigación Arquitectónica | Método de Validación Requerido | Riesgo Residual |
|---|---|---|---|---|---|---|---|
| **RSK-01** | **Pérdida Total de Folios no Sincronizados (REM-01)** | Crítica | Baja | Alto (Colisión fiscal o desbalance contable) | Protocolo de Lease de Folios con Épocas (`epochId`). El rango perdido se marca `ABANDONED_CONTINGENCY_RANGE` y se asigna un rango nuevo no superpuesto al nodo de reemplazo. | Simulación de destrucción de nodo offline y aprovisionamiento de reemplazo. | **Bajo** (Requiere arqueo físico manual) |
| **RSK-02** | **Reaparición de Nodo Antiguo / Zombie Host (REM-01)** | Alta | Baja | Alto (Publicación de datos obsoletos o divergentes) | Fencing Criptográfico por `epochId` y `fencingToken`. Cloud rechaza con `403 LEASE_REVOKED` y fuerza al nodo antiguo a entrar en modo solo-lectura protegido. | Prueba de reconexión tardía de nodo obsoleto con lease revocado. | **Muy Bajo** |
| **RSK-03** | **Mutaciones Concurrentes en Piso de Salón (REM-02)** | Media | Alta | Medio (Sobreescritura de pedidos entre meseros) | Control de Concurrencia Optimista (OCC) con `expectedVersion` y respuesta `409 Conflict` para recarga informada en terminal móvil. | Pruebas de carga concurrente automatizadas con envío simultáneo de comandas. | **Muy Bajo** |
| **RSK-04** | **Ambigüedad de Autoridad de Datos por Topología (REM-03)** | Alta | Media | Alto (Inconsistencia entre ERP corporativo y POS) | Matriz formal de autoridad sin co-propiedad implícita. Enlace con ERPs externos mediante pólizas de interfaz en `Integrations Hub`. | Pruebas de integración contractual entre TRIDENTPOS y ERP externo. | **Bajo** |
| **RSK-05** | **Gaps y Desorden de Secuencias en Sincronización (REM-04)** | Alta | Media | Medio (Procesamiento fuera de orden de estados de comanda) | Uso de `aggregateSequenceNumber` monotónico por agregado con `ReorderingBufferQueue` en Cloud. No se aplican eventos hasta cerrar la brecha. | Prueba de inyección de paquetes de red fuera de orden y con pérdida simulada. | **Bajo** |
| **RSK-06** | **Saturación por Eventos Venenosos y DLQ (REM-04)** | Media | Baja | Medio (Bloqueo de procesamiento de sucursal) | Límite de 5 reintentos con backoff exponencial, aislamiento inmediato en `CloudIntegrationDLQ` y alertas a soporte técnico. | Pruebas de inyección de eventos malformados con validación de schema. | **Bajo** |
| **RSK-07** | **Pérdida de Eventos Inter-Módulo Críticos en Cloud (REM-05)** | Crítica | Baja | Alto (Corte Z no procesado en contabilidad o compra no reflejada en almacén) | Persistencia obligatoria en `CloudIntegrationOutbox` (PostgreSQL) dentro de la misma transacción ACID que la mutación principal. | Pruebas de reinicio intempestivo del backend durante despacho de eventos. | **Muy Bajo** |
| **RSK-08** | **Corte de Energía y Caché Volátil de SSD en Edge (REM-07)** | Alta | Media | Alto (Pérdida de transacciones locales pendientes en SQLite) | `PRAGMA synchronous = FULL` para cierres de turno y Cortes Z; requerimiento obligatorio de respaldo eléctrico con UPS en sucursal. | `REQUIRES HARDWARE POWER-LOSS VALIDATION` en dispositivos POS objetivo. | **Medio** (Depende de hardware y UPS) |
| **RSK-09** | **Crecimiento de WAL y Saturación de Disco Local (REM-07)** | Alta | Media | Alto (Bloqueo de escrituras en base de datos local) | Checkpointing pasivo cada 1000 páginas y manual al cierre de turno; alerta a <15% de disco libre y modo de solo-lectura preventivo a <5%. | Pruebas de estrés continuo de generación de comandas y monitoreo de WAL. | **Bajo** |
| **RSK-10** | **Corrupción Física de Base de Datos Local (REM-07)** | Alta | Baja | Alto (Inoperabilidad de la terminal de cobro) | `PRAGMA integrity_check` diario, respaldo nocturno comprimido y restauración guiada desde snapshot local + replay desde Cloud. | Prueba de inyección de corrupción de bytes en SQLite y procedimiento de restore. | **Bajo** |
| **RSK-11** | **Saturación de Memoria del Runtime en Borde (REM-08)** | Media | Media | Medio (Lentitud en terminales POS con <= 2GB RAM) | Baseline en Electron/Node con alternativa de migración a Tauri/Rust si los benchmarks en hardware de gama baja muestran contención. | `BENCHMARK ON TARGET POS HARDWARE REQUIRED` previo a despliegue masivo. | **Medio** (Controlado por especificación) |
| **RSK-12** | **Acceso Offline Prolongado de Usuarios Revocados (REM-09)** | Media | Baja | Medio (Operación no autorizada de empleado despedido durante caída de internet) | Hashes salteados de PIN en caché local con expiración a las 72 horas y auditoría obligatoria de operaciones privilegiadas. | Prueba de revocación de usuario en Cloud y validación de expiración en Edge. | **Bajo** |
| **RSK-13** | **Alteración Retroactiva de Precios en Cuentas Abiertas (REM-10)** | Alta | Media | Medio (Cobro incorrecto o disputa con comensal por cambio de menú a mitad del servicio) | Snapshot económico inmutable (*frozen economic snapshot*) almacenado en la comanda al momento de la orden. | Prueba de actualización de catálogo en Cloud con mesa abierta en Edge. | **Cero** (Inmutabilidad contractual) |
| **RSK-14** | **Acoplamiento de Delivery con Agregadores Externos (REM-12)** | Media | Baja | Bajo (Complejidad innecesaria en módulo de flota propia) | `Integrations Hub` asume 100% de la responsabilidad de conectores externos (Uber/Rappi/Didi); `Delivery` gestiona exclusivamente choferes propios. | Auditoría de dependencias de código entre Delivery e Integrations. | **Muy Bajo** |
| **RSK-15** | **Objetivos de RTO/RPO No Validados en la Práctica (REM-06)** | Media | Media | Medio (Tiempo de recuperación superior al estimado durante una crisis) | Clasificación de RTO/RPO como objetivos de diseño sujetos a certificación empírica obligatoria. | `DISASTER RECOVERY DRILL & BENCHMARK VALIDATION REQUIRED`. | **Bajo** |

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
