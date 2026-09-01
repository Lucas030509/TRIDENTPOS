# ADR-002: Definición de Autoridad de Datos Cloud / Branch por Topología

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Data Governance / Modelos de Despliegue  

---

## Contexto y Planteamiento del Problema
`ERP RESTAURANTES` soporta cuatro topologías de despliegue: Full Suite, TRIDENTPOS Standalone, Backoffice Standalone y Ecosistema Híbrido con ERPs externos. Para evitar ambigüedades sobre qué nodo tiene el derecho primario de escritura y cuál actúa como réplica o consumidor, se requiere definir la autoridad de datos formal para cada topología.

## Decisión
Se establece la matriz de autoridad de datos explícita por topología:
1. **Topología Full Suite:**
   - **Cloud Control Plane es SoR:** Organizaciones, Sucursales, Cuentas de Usuario, RBAC, Catálogo Maestro de Productos, Menús, Modificadores, Precios Base y Esquemas Fiscales.
   - **Branch Edge Host es Primary Write Authority:** Mesas, Cuentas de Comedor/Mostrador, Comandas activas, Estados de preparación en KDS, Transacciones de Pago, Turnos de Caja y emisión de Cortes X y Z.
2. **Topología TRIDENTPOS Standalone:**
   - **Branch Edge Host es 100% Autoridad:** Posee la autoridad de escritura total sobre el catálogo local embebido, usuarios locales, mesas, comandas, KDS, caja y archivo histórico de Cortes X/Z.
3. **Topología Backoffice Standalone:**
   - **Cloud Control Plane es SoR:** Catálogo maestro, recetas, almacenes, órdenes de compra y finanzas.
   - **POS Externo:** Es la autoridad primaria sobre el stream de tickets y ventas.
4. **Topología Híbrido Corporativo:**
   - **Branch Edge Host:** Autoridad de operaciones de piso y caja.
   - **ERP Externo (SAP / Odoo):** Autoridad maestra contable y del catálogo de cuentas corporativo.

## Consecuencias
### Positivas
- Claridad contractual absoluta: no hay ambigüedad sobre quién resuelve y valida una transacción en cada escenario de negocio.
- Elimina la necesidad de algoritmos complejos de resolución de conflictos bidireccionales en caliente.

### Compromisos y Mitigaciones
- Requiere parametrizar las reglas de validación en los adaptadores según la topología activa de la organización.
