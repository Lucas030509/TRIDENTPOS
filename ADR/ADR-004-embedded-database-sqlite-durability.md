# ADR-004: Base de Datos Embebida en Borde (SQLite 3 WAL) y Estrategia de Durabilidad

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SYNC_AND_OFFLINE_ARCHITECTURE.md`, `TECH_STACK_DECISIONS.md`, `ARCHITECTURE_RISKS.md`  

---

## 1. Context
El Edge Host de la sucursal requiere un motor de base de datos local que opere sin internet, tenga latencia mínima, requiera cero mantenimiento administrativo por parte de los cajeros y resista posibles cortes de energía eléctrica en el restaurante.

## 2. Problem
Bases de datos cliente-servidor (PostgreSQL/MySQL local) requieren administración de servicios, puertos de red adicionales y consumen excesiva memoria en terminales de bajo costo. Se requería definir la configuración óptima de durabilidad y resiliencia para una base de datos embebida.

## 3. Architectural Drivers
- Cero administración y latencia de acceso en memoria/disco local.
- Concurrencia de lectura para múltiples pantallas KDS y comanderos.
- Resiliencia ante fallos eléctricos.

## 4. Options Considered
### Option A: PostgreSQL / MySQL Embebido Local
- *Pros:* Mismo motor que en la nube.
- *Cons:* Alto consumo de recursos (150–500 MB RAM), requiere demonios de sistema y afinación manual.
- *Risks:* Corrupción de instancias locales ante apagones no controlados.

### Option B: SQLite 3 con Journaling WAL y Sincronización Dual — *Seleccionada*
- *Pros:* Cero administración, mínimo consumo de memoria (<50 MB), lecturas concurrentes sin bloqueo en modo WAL y transacciones ACID.
- *Cons:* Un solo escritor simultáneo a nivel de base de datos.
- *Risks:* Dependencia del hardware de disco (SSD) y caché volátil ante cortes súbitos de energía (`REQUIRES HARDWARE POWER-LOSS VALIDATION`).

## 5. Decision
Se adopta **SQLite 3 embebido con modo WAL (`PRAGMA journal_mode = WAL;`)**:
1. `PRAGMA synchronous = NORMAL;` para operaciones operativas de piso de alta frecuencia.
2. `PRAGMA synchronous = FULL;` forzando fsync a disco para cierres de turno de caja y Cortes Z.
3. Se requiere que el hardware host cuente con respaldo eléctrico (UPS).
4. Se establece la obligación de ejecutar pruebas automatizadas de power-loss testing en hardware representativo antes del despliegue masivo.

## 6. Rationale
La combinación de WAL y sincronización dual ofrece el máximo rendimiento en la toma de comandas mientras blinda legal y financieramente los cierres de caja y cortes fiscales.

## 7. Consequences
### Positive
- Latencia sub-milisegundo en consultas de KDS y comandero.
- Cero mantenimiento de base de datos en sucursal.
### Negative
- Escrituras serializadas mediante cola de transacciones interna.
### Operational
- Rutina de respaldo nocturno automatizado y verificación diaria de integridad (`PRAGMA integrity_check`).

## 8. Failure Modes
- Corrupción de archivo WAL por corte eléctrico en SSDs sin condensadores de protección (*Power Loss Protection*). Mitigación: Uso de UPS obligatorio y recuperación desde snapshot diario + replay de deltas Cloud.

## 9. Security Considerations
- Cifrado a nivel de archivo SQLite (SQLCipher) para proteger la base de datos ante robo físico de la terminal.

## 10. Observability Requirements
- Monitoreo del tamaño del archivo WAL y alertas preventivas al superar 50 MB antes de checkpoint.

## 11. Validation / Evidence Required
- `HARDWARE POWER-LOSS VALIDATION` ejecutando cortes de energía repetidos durante escrituras concurrentes.

## 12. Revisit Triggers
- Corrupción recurrente de datos en pruebas de campo en un modelo específico de hardware.

## 13. Traceability
- Atiende: REM-07.
- SSOT: `SYNC_AND_OFFLINE_ARCHITECTURE.md v1.3`.
