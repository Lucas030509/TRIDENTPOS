# ADR-006: Sincronización Asíncrona mediante Transactional Outbox e Ingesta Idempotente

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SYNC_AND_OFFLINE_ARCHITECTURE.md`, `ARCHITECTURE_RISKS.md`  

---

## 1. Context
La comunicación WAN entre los restaurantes y la nube experimenta caídas e intermitencias frecuentes. Se requiere garantizar la entrega confiable de transacciones sin duplicación de cobros ni pólizas contables.

## 2. Problem
La retransmisión no coordinada de peticiones HTTP genera duplicados en la base de datos central (*At-Least-Once Delivery* sin idempotencia). Adicionalmente, eventos recibidos fuera de orden causan inconsistencias de estado.

## 3. Architectural Drivers
- Entrega confiable de eventos de venta, caja y cocina sin duplicados.
- Preservación del orden causal de las operaciones de cada cuenta o turno.
- Aislamiento de eventos malformados o venenosos.

## 4. Options Considered
### Option A: Sincronización Directa API REST sin Outbox
- *Pros:* Simple.
- *Cons:* Pérdida de eventos ante fallas de red durante la llamada y duplicación por reintentos ciegos.
- *Risks:* Inconsistencia grave en cierres de caja.

### Option B: Transactional Outbox Local + Ingesta Idempotente con Secuenciación Causal — *Seleccionada*
- *Pros:* Persistencia atómica de la mutación y el evento outbox en SQLite; deduplicación determinista en Cloud mediante `idempotencyKey` y preservación de orden mediante `aggregateSequenceNumber`.
- *Cons:* Requiere gestión de buffers de reordenamiento y cola de eventos fallidos (DLQ).
- *Risks:* Muy bajo; estándar de la industria para sistemas distribuidos offline-first.

## 5. Decision
Se adopta el patrón **Transactional Outbox Local con Ingesta Idempotente en Cloud**:
1. Toda mutación local se guarda en SQLite junto con un registro en `OutboxQueue` en la misma transacción ACID.
2. Clave de idempotencia lógica determinista: `org:branch:aggregateType:aggregateId:action:clientOpId`.
3. `clientOpId` generado por el dispositivo en la acción inicial y reutilizado en todos los reintentos.
4. Orden causal mediante `aggregateSequenceNumber` monotónico por agregado (no por timestamps).
5. Estados de confirmación estructurados: `RECEIVED` -> `DURABLY_STORED` -> `APPLIED` -> `DUPLICATE_ACCEPTED`.
6. Límite de 5 reintentos con backoff exponencial; eventos venenosos transferidos a `CloudIntegrationDLQ`.

## 6. Rationale
Garantiza que ninguna transacción se pierda y que los reintentos de red sean perfectamente idempotentes y consistentes.

## 7. Consequences
### Positive
- Tolerancia total a interrupciones de conectividad.
- Cero duplicación de efectos secundarios en la base de datos central.
### Negative
- Requiere almacenamiento de log de idempotencia en Cloud durante 90 días.
### Operational
- Monitoreo del backlog del outbox en Edge y de la DLQ en Cloud.

## 8. Failure Modes
- Evento malformado bloquea la cola outbox. Mitigación: Tras 5 fallos se aísla en DLQ y se continúa procesando la cola.

## 9. Security Considerations
- Validación de firmas y tokens de autenticación de sucursal en cada payload de sincronización.

## 10. Observability Requirements
- Métricas de latencia de sincronización y alertas automáticas si el backlog outbox supera 100 eventos pendientes.

## 11. Validation / Evidence Required
- Pruebas de desconexión prolongada, inyección de duplicados y eventos fuera de orden.

## 12. Revisit Triggers
- Retrasos sistemáticos en la ingesta en Cloud durante picos masivos de cierre de sucursales.

## 13. Traceability
- Atiende: REM-04.
- SSOT: `SYNC_AND_OFFLINE_ARCHITECTURE.md v1.3`.
