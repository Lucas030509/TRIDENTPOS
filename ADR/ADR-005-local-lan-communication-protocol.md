# ADR-005: Protocolo de Comunicación en Red Local (LAN) para TRIDENTPOS

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SOLUTION_ARCHITECTURE.md`, `DEPLOYMENT_TOPOLOGY.md`  

---

## 1. Context
En el restaurante operan múltiples dispositivos en red local (terminal de cobro, pantallas KDS en cocina/barra, comanderos móviles e impresoras térmicas).

## 2. Problem
El polling continuo mediante HTTP satura el ancho de banda de la red WiFi, incrementa el consumo de batería en tablets y genera retrasos en la visualización de órdenes en cocina.

## 3. Architectural Drivers
- Actualización en tiempo real de pantallas KDS.
- Consumo mínimo de batería en dispositivos móviles.
- Resiliencia ante desconexiones transitorias de WiFi.

## 4. Options Considered
### Option A: HTTP Polling Periódico (Pull)
- *Pros:* Simple de implementar.
- *Cons:* Tráfico innecesario, latencia de visualización (1–3s) y consumo de batería excesivo.
- *Risks:* Congestión de la red local en horas pico.

### Option B: HTTP REST (Comandos) + WebSockets `ws` (Push) — *Seleccionada*
- *Pros:* Entrega instantánea de comandas a KDS (*LATENCY TARGET: < 5 ms en LAN dedicada — REQUIRES BENCHMARK*), canal persistente y mínimo overhead.
- *Cons:* Requiere gestión de reconexión y heartbeats en clientes.
- *Risks:* Sensibilidad a la cobertura WiFi en zonas muertas del restaurante.

## 5. Decision
Se adopta una arquitectura híbrida en red local:
1. **Comandos de Negocio:** Peticiones HTTP POST locales con payload tipado y Control de Concurrencia Optimista (`expectedVersion`).
2. **Distribución Push:** Servidor WebSocket nativo (`ws`) en el Edge Host para emisión inmediata de eventos a pantallas KDS y comanderos.
3. **Heartbeat y Reconexión:** Heartbeats cada 5 segundos con re-sincronización de estado completa ante reconexión.

## 6. Rationale
La combinación de HTTP para mutaciones y WebSockets para notificaciones push garantiza la consistencia transaccional con la menor latencia de interfaz posible.

## 7. Consequences
### Positive
- Notificaciones instantáneas de pedidos en cocina.
- Eliminación del tráfico residual en la red WiFi.
### Negative
- Requiere lógica de reconexión en los clientes móviles.
### Operational
- Requiere asignación de IP estática o mDNS para el Edge Host en la red local.

## 8. Failure Modes
- Desconexión temporal de un comandero móvil por falta de señal. Mitigación: El cliente almacena las acciones pendientes localmente y solicita el estado consolidado de la mesa al reconectar.

## 9. Security Considerations
- Autenticación mediante token de estación/dispositivo firmado localmente en el handshake de WebSocket.

## 10. Observability Requirements
- Registro de conexiones y desconexiones de clientes WebSocket en el log del Edge Server.

## 11. Validation / Evidence Required
- Pruebas de latencia y saturación con 20 clientes WebSocket conectados concurrentemente en red local.

## 12. Revisit Triggers
- Degradación de rendimiento o desconexiones recurrentes de WebSockets en redes locales no optimizadas.

## 13. Traceability
- Atiende: REM-05, REM-08.
- SSOT: `SOLUTION_ARCHITECTURE.md v1.3`.
