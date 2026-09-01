# ADR-008: Estrategia de Disaster Recovery y Resiliencia ante Pérdida Total del Edge Host

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Branch Operational Plane / Resiliencia Operativa  

---

## Contexto y Planteamiento del Problema
En caso de destrucción física, robo o daño irreparable del hardware del Edge Host en una sucursal, se debe disponer de un protocolo formal para reanudar el servicio rápidamente (RTO) y conciliar la posible pérdida de transacciones locales que aún no se hubieran sincronizado con la nube (RPO).

## Decisión
Se establece una estrategia de Disaster Recovery con separación explícita entre datos ya sincronizados y datos locales pendientes de sincronización:
1. **Recuperación de Datos Sincronizados (RTO < 30 min):**
   - El aprovisionamiento de un nuevo equipo Edge Host descarga automáticamente desde la nube: catálogos maestros, branch overrides, usuarios, roles, PINs de acceso, foliación histórica y último número de Corte Z confirmado.
2. **Tratamiento de Datos Locales No Sincronizados (RPO = Período de desconexión previo al siniestro):**
   - Si el siniestro ocurrió tras una caída de internet y el hardware local fue destruido antes de sincronizar, dichos eventos no pueden recuperarse digitalmente del disco.
   - **Protocolo de Reconciliación Manual y Auditoría Física:**
     1. Asignación inmediata por la nube del siguiente rango consecutivo seguro de folios y Cortes Z para evitar colisiones numéricas.
     2. Cotejo de comprobantes bancarios físicos y reportes de terminales PinPAD.
     3. Conteo y arqueo físico del efectivo existente en el cajón de dinero.
     4. Registro formal de un `TurnoDeAjustePorContingencia` en el nuevo nodo para balancear tesorería e inventarios en el ERP.
3. **Respaldo Local Automatizado:** Cada noche, tras emitirse el Corte Z, el nodo local genera una copia comprimida de la base de datos SQLite en un directorio secundario o almacenamiento USB protegido en la sucursal.

## Consecuencias
### Positivas
- Reanudación del servicio en menos de 30 minutos sin requerir personal de ingeniería en sitio.
- Protocolo claro y trazable para auditores fiscales y contables ante contingencias de pérdida de equipo.

### Compromisos y Mitigaciones
- Necesidad de que los gerentes de sucursal conozcan el procedimiento de arqueo de contingencia. *Mitigación:* Se incluirá un asistente guiado de recuperación paso a paso en la interfaz de usuario de TRIDENTPOS.
