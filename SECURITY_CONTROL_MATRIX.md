# SECURITY CONTROL & AUTHORIZATION MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-SCM-001`  
**Version:** `1.2 REMEDIATED DRAFT (R2.1)`  
**Status:** `APPROVED / FROZEN — 2026-09-03`  
**Date:** 2026-09-02  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect — Remediation Author`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Matriz de Control de Acceso y Autorización por Capacidad (R2F-02)

| Capacidad Funcional | Autorización / Rol Requerido | Enforcement Point | Permitido Offline | Re-Autenticación Requerida | Evento de Auditoría Generado |
|---|---|---|---|---|---|
| **Apertura de Mesa / Comanda** | Rol operativo con permiso `comanda.iniciar` | Edge Host Local API | SÍ | NO (Sesión activa) | `MesaComandaIniciada` |
| **Envío de Comanda a Cocina (KDS)**| Rol operativo con permiso `comanda.enviar` | Edge Host Local API | SÍ | NO | `ComandaEnviadaKDS` |
| **Cancelación Pre-Cocina** | Rol operativo con permiso `item.cancelar_precocina` | Edge Host Local API | SÍ | NO | `ItemCanceladoPreCocina` |
| **Cancelación Post-Cocina (OQ-SSOT-01)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `CancelacionPostCocinaAuditada` |
| **Transferencia de Cuentas (OQ-SSOT-02)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `CuentaTransferidaAuditada` |
| **Cargos a Crédito / CxC (OQ-SSOT-03)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `CargoCxCAuditado` |
| **Cancelación Total Móvil (OQ-SSOT-04)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `CuentaAnuladaMovilAuditada` |
| **Sugerencia Reabastecimiento (OQ-SSOT-05)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `SugerenciaReabastecimientoAuditada`|
| **Prorrateo Split Cuenta (OQ-SSOT-06)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `CuentaDivididaAuditada` |
| **Recetas con Modificadores (OQ-SSOT-07)**| `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `ConsumoRecetaAuditado` |
| **Turnos Multi-Cajero (OQ-ARCH-01)** | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `TurnoCajaAuditado` |
| **Facturación Global (OQ-ARCH-02)** | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `PENDING PO DECISION` | `DEPENDS ON PO-APPROVED POLICY` | `FacturaGlobalAuditada` |
| **Aplicación de Descuento / Cortesía**| Rol con permiso `cuenta.descuento` | Edge Host Local API | SÍ | SÍ (Credencial autorizadora) | `DescuentoAplicado` |
| **Apertura de Cajón Manual** | Rol con permiso `caja.abrir_cajon` | Edge Host Local API | SÍ | SÍ (Credencial cajero) | `AperturaCajonManual` |
| **Cobro y Cierre de Cuenta** | Rol con permiso `caja.cobrar` | Edge Host Local API | SÍ | NO (Turno activo) | `CuentaPagadaYCerrada` |
| **Emisión de Corte X (Parcial)** | Rol con permiso `corte.emitir_x` | Edge Host Local API | SÍ | NO (Turno activo) | `CorteXEmitido` |
| **Emisión de Corte Z (Definitivo)**| Rol con permiso `corte.emitir_z` | Edge Host Local API | SÍ | SÍ (Credencial autorizadora) | `CorteZEmitido` (Inmutable) |
| **Ajuste Manual / Contingencia Folios**| Rol administrativo con permiso `folios.contingencia` | Edge Host Local API | SÍ | SÍ (Credencial + Motivo) | `ContingenciaFolioRegistrada` |
| **Modificación de Precios / Catálogo**| Rol corporativo con permiso `catalogo.administrar` | Cloud API Gateway | NO | SÍ (MFA Cloud) | `CatalogoPreciosModificado` |
| **Enrolamiento de Nueva Terminal** | Rol administrativo con permiso `dispositivos.enrolar` | Edge Host Local API | SÍ | SÍ (Pairing QR con Fingerprint Binding) | `TerminalEnrolada` |

---

## 2. Invariante Universal de Seguridad
> **ENFORCEMENT IN TRUSTED BOUNDARY:** Queda estrictamente prohibido confiar en la interfaz de usuario (UI) para la restricción de privilegios. Toda mutación valida la firma de sesión y los permisos en el backend antes de su ejecución transaccional. Para capacidades sujetas a decisiones pendientes del Product Owner, la arquitectura exige que *si se habilitan, su ejecución sea autenticada, autorizada bajo la política aprobada por el PO, y auditada*.

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-03
