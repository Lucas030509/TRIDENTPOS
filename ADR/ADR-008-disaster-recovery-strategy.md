# ADR-008: Estrategia de Disaster Recovery, Continuidad Segura de Folios y Fencing

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SYNC_AND_OFFLINE_ARCHITECTURE.md`, `ARCHITECTURE_RISKS.md`, `DEPLOYMENT_TOPOLOGY.md`  

---

## 1. Context
En caso de destrucción física, robo o daño irreparable del hardware del Edge Host en una sucursal mientras operaba offline, se debe garantizar la rápida reanudación del servicio evitando colisiones de folios emitidos localmente y bloqueando cualquier intento de sincronización de nodos obsoletos.

## 2. Problem
La reasignación ingenua del "siguiente número conocido en la nube" provoca colisiones numéricas de facturas y tickets si el nodo siniestrado emitió folios en modo offline que nunca llegaron a sincronizarse. Asimismo, la reaparición no controlada de un nodo reemplazado (zombie host) puede corromper el estado en la nube.

## 3. Architectural Drivers
- Cero colisión de números de folio o corte fiscal tras pérdida de hardware.
- Fencing criptográfico inmediato contra equipos obsoletos o reemplazados.
- Recuperación del servicio en menos de 30 minutos (*RTO TARGET: < 30 min — REQUIRES DR VALIDATION*).

## 4. Options Considered
### Option A: Consulta Sincrónica de Folios en Nube
- *Pros:* Evita colisiones centralizando la numeración.
- *Cons:* Impide la emisión de tickets y cobro en modo offline.
- *Risks:* Inaceptable para un restaurante en operación continua.

### Option B: Preasignación de Rangos de Folios con Épocas (`epochId`) y Fencing Tokens — *Seleccionada*
- *Pros:* Operación offline garantizada dentro de un bloque preasignado (`ALLOCATED_POTENTIALLY_CONSUMED`). Ante siniestro, el rango no sincronizado se marca `ABANDONED_CONTINGENCY_RANGE`, se incrementa la época (`epochId`), se otorga un nuevo rango limpio al reemplazo y se cerca (*fence*) al nodo antiguo.
- *Cons:* Posible generación de huecos numéricos controlados en caso de catástrofe que se concilian mediante auditoría física.
- *Risks:* Muy bajo; matemáticamente riguroso y auditable.

## 5. Decision
Se adopta el protocolo de **Lease de Rangos de Folios con Generación de Época (`epochId`) y Fencing Tokens**:
1. Cloud preasigna bloques de folios con `epochId` y `leaseId`.
2. Ante destrucción de nodo, Cloud incrementa la época a `epochId + 1`, marca el rango previo como `ABANDONED_CONTINGENCY_RANGE` y asigna un nuevo bloque no superpuesto al nodo de reemplazo.
3. Los folios del rango abandonado se concilian contablemente mediante el Protocolo de Reconciliación Manual y Auditoría Física (vouchers bancarios, arqueo de efectivo y `TurnoDeAjustePorContingencia`).
4. Si el nodo antiguo reaparece, Cloud lo rechaza con `403 LEASE_REVOKED` forzándolo a entrar en modo solo-lectura protegido.

## 6. Rationale
Elimina de raíz el riesgo de colisiones numéricas y previene la corrupción por reaparición de hardware obsoleto, permitiendo la operación offline segura.

## 7. Consequences
### Positive
- Reanudación segura de operaciones sin riesgo de duplicar folios fiscales.
- Protección total contra sincronizaciones tardías de equipos reemplazados.
### Negative
- Requiere un procedimiento contable formal para justificar folios abandonados en auditorías fiscales.
### Operational
- Asistente guiado de recuperación de sucursal en el panel administrativo central.

## 8. Failure Modes
- Reemplazo sucesivo de múltiples nodos sin reconciliación. Mitigación: Límite de 3 épocas no reconciliadas antes de exigir autorización de Dirección de Auditoría.

## 9. Security Considerations
- Validación estricta del `fencingToken` en el handshake de sincronización.

## 10. Observability Requirements
- Alertas de alta prioridad en Sentry ante cualquier intento de sincronización con lease revocado.

## 11. Validation / Evidence Required
- `DISASTER RECOVERY DRILL & BENCHMARK VALIDATION REQUIRED` ejecutando el ciclo completo de destrucción, reemplazo y fencing.

## 12. Revisit Triggers
- Cambios en las normativas fiscales que prohíban explícitamente huecos numéricos justificados por contingencia.

## 13. Traceability
- Atiende: REM-01, REM-06.
- SSOT: `SYNC_AND_OFFLINE_ARCHITECTURE.md v1.3`.
