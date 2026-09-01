# ADR-002: Definición de Autoridad de Datos Cloud / Branch por Topología

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `SYSTEM_CONTEXT.md`, `SYNC_AND_OFFLINE_ARCHITECTURE.md`, `CAPABILITY_MAP.md`  

---

## 1. Context
`ERP RESTAURANTES` soporta cuatro topologías de despliegue: Full Suite, TRIDENTPOS Standalone, Backoffice Standalone y Ecosistema Híbrido con ERPs externos. Se requería eliminar ambigüedades sobre qué nodo posee la autoridad primaria de escritura y cuál actúa como réplica.

## 2. Problem
La falta de definición explícita de autoridad de datos ocasiona conflictos de sincronización bidireccional, inconsistencias en inventarios/finanzas y colisiones de estado entre Cloud y sucursales.

## 3. Architectural Drivers
- Cero ambigüedad en el origen de datos.
- Operación ininterrumpida de piso y caja en sucursal ante pérdida de internet.
- Integración limpia con ERPs corporativos existentes (SAP, Odoo, Dynamics).

## 4. Options Considered
### Option A: Dual Master con Resolución en Caliente (CRDTs / Master-Master)
- *Pros:* Flexibilidad teórica de escritura concurrente en Cloud y Edge.
- *Cons:* Complejidad extrema de resolución de conflictos, riesgo de inconsistencia contable y fiscal.
- *Risks:* Imposibilidad de garantizar cuadratura contable estricta en arqueos de caja.

### Option B: Autoridad Segregada por Topología y Dominio — *Seleccionada*
- *Pros:* Asignación determinista de autoridad de escritura primaria por agregado; reglas de arbitraje claras.
- *Cons:* Requiere parametrización en los adaptadores según la topología activa.
- *Risks:* Muy bajo; elimina la contención de datos en caliente.

## 5. Decision
Se establece la matriz de autoridad de datos explícita por topología:
1. **Full Suite:** Cloud es SoR de Catálogos, Precios, Usuarios y Finanzas; Branch Edge Host es Primary Write Authority de Mesas, Cuentas, KDS, Turnos de Caja y Cortes X/Z.
2. **TRIDENTPOS Standalone:** Local Edge Host posee el 100% de la autoridad de datos.
3. **Backoffice Standalone:** Cloud es SoR de Catálogos, Recetas, Compras y Finanzas; POS Externo es autoridad de tickets.
4. **Híbrido Corporativo:** Branch Edge opera piso/caja; ERP Externo es autoridad contable corporativa (SoR).

## 6. Rationale
La segregación de autoridad garantiza la autonomía operacional de los restaurantes mientras preserva el gobierno corporativo de precios y políticas fiscales.

## 7. Consequences
### Positive
- Claridad contractual absoluta y eliminación de algoritmos complejos de resolución de conflictos.
### Negative
- Requiere mapeos específicos en `Integrations Hub` para sincronizar con ERPs de terceros.
### Operational
- Procedimientos de soporte técnico simplificados y trazabilidad de origen de cada registro.

## 8. Failure Modes
- Intento de mutación de catálogo directamente en Edge en topología Full Suite. Mitigación: La UI de Edge bloquea edición de catálogo maestro y solo permite branch overrides locales autorizados.

## 9. Security Considerations
- Validación de firmas criptográficas en los deltas emitidos por Cloud hacia los nodos locales.

## 10. Observability Requirements
- Telemetría de versiones de catálogos activos por sucursal en el panel de control central.

## 11. Validation / Evidence Required
- Pruebas automatizadas de ingesta de transacciones en las 4 topologías de despliegue.

## 12. Revisit Triggers
- Adición de un nuevo módulo que requiera co-propiedad distribuida de datos.

## 13. Traceability
- Atiende: REM-03.
- SSOT: `SYSTEM_CONTEXT.md v1.3`, `SYNC_AND_OFFLINE_ARCHITECTURE.md v1.3`.
