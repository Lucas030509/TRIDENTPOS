# ADR-006: Sincronización Asíncrona mediante Transactional Outbox e Ingesta Idempotente

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Sync Architecture / Resiliencia Cloud-Edge  

---

## Contexto y Planteamiento del Problema
La comunicación entre las sucursales y la nube sufre desconexiones recurrentes. Se requiere un mecanismo que garantice que ningún evento de venta o corte se pierda, que el orden causal de las transacciones se respete y que los reintentos de red no dupliquen cobros ni pólizas contables.

## Decisión
Se implementa el patrón **Transactional Outbox Local con Ingesta Idempotente en Cloud**:
1. **Escritura Atómica en Borde:** Toda mutación de estado en el Edge Host se persiste en SQLite junto con un registro en la tabla `OutboxQueue` en la misma transacción ACID.
2. **Claves de Idempotencia Lógicas:** Cada evento lleva una clave determinista que representa una operación lógica única:
   $$\text{idempotencyKey} = \text{orgId} : \text{branchId} : \text{aggregateType} : \text{aggregateId} : \text{action} : \text{clientOpId}$$
3. **Orden Causal por Agregado:** Se utiliza `aggregateSequenceNumber` o `streamOffset` monotónico para ordenar los eventos de cada cuenta o turno. Se prohíbe el uso de timestamps o UUIDv7 como única garantía de orden causal.
4. **Deduplicación en Cloud:** La base de datos central aplica una restricción de unicidad (`ON CONFLICT (idempotency_key) DO NOTHING`) en la tabla de ingesta.

## Consecuencias
### Positivas
- Cero pérdida de eventos de venta o caja durante períodos de desconexión prolongados.
- Tolerancia total a reintentos de red (At-Least-Once Delivery sin duplicación de efectos secundarios).

### Compromisos y Mitigaciones
- Acumulación de eventos en el Outbox durante caídas prolongadas de internet. *Mitigación:* Se implementa compactación periódica de eventos marcados como `SYNCED`.
