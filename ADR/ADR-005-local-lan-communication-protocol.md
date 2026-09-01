# ADR-005: Protocolo de Comunicación en Red Local (LAN) para TRIDENTPOS

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Branch Operational Plane / Protocolos de Red Local  

---

## Contexto y Planteamiento del Problema
En un restaurante concurrido, decenas de eventos de comanda, modificaciones y cambios de estado en KDS ocurren simultáneamente por minuto. Si las terminales de cocina y comanderos móviles utilizan polling HTTP continuo sobre la red WiFi, la red local se satura y se generan retrasos en la preparación de platillos.

## Decisión
Se adopta una arquitectura de comunicación en red local basada en **HTTP REST para Comandos Transaccionales** y **WebSocket Server nativo (`ws`) para Transmisión Push Bidireccional**:
1. **Comandos de Negocio:** Peticiones como `AbrirMesa()`, `PagarCuenta()`, `AbrirTurno()` se envían vía llamadas HTTP POST locales con payload tipado y Control de Concurrencia Optimista (`expectedVersion`).
2. **Distribución en Tiempo Real (Push):** El Edge Server mantiene conexiones WebSocket abiertas con todas las pantallas KDS y comanderos móviles. Al registrarse una comanda o cambio de estado, se emite un broadcast inmediato a los clientes suscritos.
3. **Heartbeat y Reconexión Local:** Los clientes móviles y KDS envían un ping de heartbeat cada 5 segundos; ante desconexión de WiFi, el cliente reintenta la conexión automáticamente y solicita el estado completo de la mesa o pantalla.

## Consecuencias
### Positivas
- Latencia mínima (< 5 ms en LAN Ethernet/WiFi 5GHz) en la actualización de comandas en KDS.
- Eliminación del tráfico residual y reducción drástica del consumo de batería en tablets de meseros.

### Compromisos y Mitigaciones
- Sensibilidad a la calidad de la señal WiFi en áreas alejadas del comedor. *Mitigación:* Se recomienda como baseline un Access Point empresarial dedicado con SSID exclusivo para el sistema.
