# ADR-004: Base de Datos Embebida en Borde (SQLite 3) y Estrategia de Durabilidad

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Branch Operational Plane / Almacenamiento Local  

---

## Contexto y Planteamiento del Problema
El Edge Host de la sucursal requiere un motor de base de datos local que opere sin internet, tenga latencia mínima, requiera cero mantenimiento administrativo por parte de los cajeros y resista posibles cortes de energía eléctrica en el restaurante.

## Decisión
Se selecciona **SQLite 3 embebido con modo WAL (Write-Ahead Logging)** como motor de base de datos local del Edge Host:
1. **Configuración de Rendimiento Operativo:** Se establece `PRAGMA journal_mode = WAL` y `PRAGMA synchronous = NORMAL` para las transacciones operativas frecuentes de comanda y cambio de estado en mesas.
2. **Configuración de Alta Durabilidad Financiera:** Se fuerza `PRAGMA synchronous = FULL` (o fsync explícito) para las transacciones financieras críticas: Cierre de Turno de Caja y emisión de Cortes X y Z.
3. **Requisito de Pruebas de Pérdida de Energía:** Es obligatorio realizar pruebas automatizadas de power-loss testing en hardware representativo antes del despliegue masivo para medir la resiliencia del controlador de disco ante apagones súbitos.

## Consecuencias
### Positivas
- Cero mantenimiento de base de datos (no requiere servicios del SO, sockets de red adicionales ni afinación manual).
- Lecturas concurrentes sin bloqueo sobre las pantallas KDS y comanderos móviles mientras el cajero realiza operaciones de cobro.
- Muy bajo consumo de memoria (< 50 MB) e integración in-process con Node.js.

### Compromisos y Mitigaciones
- Límite de un único escritor concurrente a nivel de base de datos. *Mitigación:* Se utiliza una cola transaccional en memoria y Control de Concurrencia Optimista (OCC) para serializar escrituras en milisegundos sin contención perceptible.
