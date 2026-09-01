# ADR-007: Manejo de Eventos Durables de Integración Inter-Módulo en Cloud

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Cloud Control Plane / Messaging & Event Sourcing  

---

## Contexto y Planteamiento del Problema
Dentro del Monolito Modular en la nube, ciertos eventos emitidos por un módulo tienen efectos críticos en otros módulos que no pueden perderse si el proceso se reinicia o falla a mitad de la ejecución (ej. un `CorteZGenerado` emitido por TRIDENTPOS debe alimentar a `Finance`, o una `RecepcionCompraRegistrada` de Procurement debe impactar `Inventory` y `Finance`). Se requería decidir el mecanismo de persistencia para estos eventos inter-módulo sin introducir prematuramente brokers complejos de mensajería externa.

## Decisión
Se implementa una estrategia dual de eventos en el Cloud Control Plane:
1. **In-Process Domain Events:** Se ejecutan en memoria dentro del mismo ciclo de vida de la petición para validaciones inmediatas y sincronización de estado intra-módulo.
2. **Durable Cloud Integration Events (Database Outbox):**
   - Todo evento inter-módulo crítico se guarda en la tabla `CloudIntegrationOutbox` en PostgreSQL dentro de la misma transacción de la base de datos central.
   - Un worker interno en Render despacha los eventos pendientes a los módulos suscriptores (`Inventory`, `Finance`, `Billing`) garantizando entrega confiable y reintentos automáticos.
   - Los eventos fallidos tras N intentos se mueven a una tabla de **Dead Letter Queue (DLQ)** para análisis y reprocesamiento asistido.
3. **Descarte de Broker Externo Prematuro:** No se introduce Kafka, RabbitMQ ni AWS SQS en esta fase; el outbox en PostgreSQL gestionado con Supabase/Render cubre la volumetría proyectada con máxima simplicidad y consistencia ACID.

## Consecuencias
### Positivas
- Cero pérdida de efectos secundarios inter-módulo ante reinicios del backend.
- Cero costos operativos de mantenimiento de clusters de mensajería dedicados.

### Compromisos y Mitigaciones
- Carga adicional de consultas periódicas sobre la tabla outbox en PostgreSQL. *Mitigación:* Se implementa `LISTEN / NOTIFY` nativo de PostgreSQL para despertar al worker inmediatamente al insertar un nuevo evento, evitando polling continuo.
