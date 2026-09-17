# ADR-005: Protocolo de Comunicación en Red Local (LAN) para TRIDENTPOS

> [!NOTE]
> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `d17633ab26606baf67029609f9db6d993b5c9909`)
>
> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Reaffirms the physical LAN 20-client saturation benchmark requirement (`< 5 ms` target latency) and formalizes performance validation debt `PERF-VAL-015-01`, owned for empirical hardware discharge by `WP-028` (Hardware Benchmarking & Release Packaging). Software loopback tests in `WP-015` qualify as software-only evidence and do not discharge physical LAN validation. Product Owner approval and post-merge validation are complete; `PERF-VAL-015-01` remains OPEN until discharged by `WP-028`.

**Status:** `ACCEPTED WITH VALIDATION REQUIRED` (Validation Debt `PERF-VAL-015-01` tracked for discharge in `WP-028`)
**Date:** 2026-09-01
**Owners:** `01_Solution Architect`
**Related documents:** `SOLUTION_ARCHITECTURE.md`, `DEPLOYMENT_TOPOLOGY.md`, `IMPLEMENTATION_PLAN.md` (`WP-015`, `WP-028`)

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
- Pruebas de latencia y saturación con 20 clientes WebSocket conectados concurrentemente en red local física dedicada (Wi-Fi/Ethernet).
- **Formal Validation Debt (`PERF-VAL-015-01`):** Tracking formal de deuda no relacionada a seguridad originada en `WP-015` y delegada para descargo empírico obligatorio en `WP-028` (Hardware Benchmarking & Release Packaging).
- **Criterios de Descargo en `WP-028`:**
  1. Topología física de LAN documentada.
  2. Inventario de hardware/dispositivos bajo prueba.
  3. Condiciones reales de red Wi-Fi y Ethernet.
  4. 20 clientes WebSocket conectados y recibiendo eventos KDS concurrentemente.
  5. Metodología rigurosa de muestreo de latencia.
  6. Distribución de latencias (p50, p95, max) frente al objetivo canónico `< 5 ms`.
  7. Comportamiento ante saturación y reconexión masiva.
  8. Veredicto PASS/FAIL formal emitido en `EVIDENCE_PERF_VAL_015_01_KDS_LAN_BENCHMARK.md`.

## 12. Revisit Triggers
- Degradación de rendimiento o desconexiones recurrentes de WebSockets en redes locales no optimizadas.

## 13. Traceability
- Atiende: REM-05, REM-08.
- Validation Debt: `PERF-VAL-015-01` (descargo en `WP-028`).
- SSOT: `SOLUTION_ARCHITECTURE.md v1.3`.
