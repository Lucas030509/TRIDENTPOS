# ADR-007: Manejo de Eventos Durables de Integración Inter-Módulo en Cloud

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SOLUTION_ARCHITECTURE.md`, `MODULE_CATALOG.md`  

---

## 1. Context
En el Monolito Modular en Cloud, eventos emitidos por un módulo tienen efectos críticos en otros módulos (ej. `CorteZGenerado` en TRIDENTPOS alimenta a `Finance`, `RecepcionCompraRegistrada` en Procurement alimenta a `Inventory` y `Finance`).

## 2. Problem
Si estos eventos inter-módulo se ejecutan exclusivamente en memoria de forma sincrónica o asincrónica volátil, una caída o reinicio del backend durante el procesamiento causa pérdida permanente de registros contables o de inventario.

## 3. Architectural Drivers
- Entrega durable de eventos críticos inter-módulo.
- Simplicidad operativa sin introducción de brokers de mensajería externos prematuros (Kafka/RabbitMQ).
- Consistencia transaccional ACID.

## 4. Options Considered
### Option A: Event Broker Externo (Kafka / RabbitMQ / AWS SQS)
- *Pros:* Desacoplamiento de mensajería y alta capacidad de throughput.
- *Cons:* Sobrecarga operacional, costos adicionales de infraestructura y complejidad de despliegue.
- *Risks:* Complejidad innecesaria para la volumetría de la fase inicial.

### Option B: Transactional Outbox en PostgreSQL (`CloudIntegrationOutbox`) — *Seleccionada*
- *Pros:* Persistencia en la misma transacción ACID de PostgreSQL, cero pérdida de eventos, bajo costo y simplicidad total en Render/Supabase.
- *Cons:* Carga adicional en PostgreSQL.
- *Risks:* Muy bajo; optimizado mediante `LISTEN / NOTIFY` para despertar a los workers sin polling continuo.

## 5. Decision
Se adopta el patrón **Transactional Outbox en PostgreSQL (`CloudIntegrationOutbox`)** para la comunicación inter-módulo crítica en Cloud:
1. Eventos en memoria (*In-Process Domain Events*) reservados para validaciones y lógica dentro del mismo ciclo HTTP.
2. Eventos inter-módulo durables persistidos atómicamente en `CloudIntegrationOutbox`.
3. Worker interno que despacha los eventos pendientes a los módulos suscriptores con reintentos y soporte de DLQ.

## 6. Rationale
Proporciona durabilidad absoluta para transacciones contables e inventarios sin añadir costos ni complejidad de brokers externos.

## 7. Consequences
### Positive
- Cero pérdida de efectos secundarios inter-módulo ante reinicios del backend.
- Modelo de despliegue monolítico simple y económico.
### Negative
- Requiere mantenimiento de la tabla de outbox central.
### Operational
- Monitoreo de la tabla de outbox y alertas de eventos en DLQ.

## 8. Failure Modes
- Excepción no controlada en el manejador del módulo suscriptores. Mitigación: Reintento con backoff exponencial y aislamiento en DLQ tras 5 intentos fallidos.

## 9. Security Considerations
- Trazabilidad y no repudio mediante registro del `userId` y `tenantId` en el payload del evento outbox.

## 10. Observability Requirements
- Telemetría en Sentry de eventos encolados, procesados y fallidos.

## 11. Validation / Evidence Required
- Pruebas automatizadas de reinicio de proceso durante la emisión de `CorteZGenerado` y `RecepcionCompraRegistrada`.

## 12. Revisit Triggers
- Volumetría que supere 5,000 eventos por segundo en la base de datos central.

## 13. Traceability
- Atiende: REM-05, REM-11.
- SSOT: `SOLUTION_ARCHITECTURE.md v1.3`.
