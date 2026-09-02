# SECURITY CONTROL & AUTHORIZATION MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-SCM-001`  
**Version:** `1.1 REMEDIATED DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Matriz de Control de Acceso y Autorización por Capacidad

| Capacidad Funcional | Autorización / Rol Requerido | Enforcement Point | Permitido Offline | Re-Autenticación Requerida | Evento de Auditoría Generado |
|---|---|---|---|---|---|
| **Apertura de Mesa / Comanda** | Rol operativo con permiso `comanda.iniciar` | Edge Host Local API | SÍ | NO (Sesión activa) | `MesaComandaIniciada` |
| **Envío de Comanda a Cocina (KDS)**| Rol operativo con permiso `comanda.enviar` | Edge Host Local API | SÍ | NO | `ComandaEnviadaKDS` |
| **Cancelación Pre-Cocina** | Rol operativo con permiso `item.cancelar_precocina` | Edge Host Local API | SÍ | NO | `ItemCanceladoPreCocina` |
| **Cancelación Post-Cocina (OQ-SSOT-01)**| `PENDING PO DECISION — autenticado y autorizado según política aprobada por PO (POST_KITCHEN_CANCELLATION_POLICY)` | Edge Host Local API | SÍ | Según política PO configurada | `CancelacionPostCocinaAutorizada` |
| **Transferencia de Cuentas (OQ-SSOT-02)**| `PENDING PO DECISION — autenticado según política aprobada por PO (ACCOUNT_TRANSFER_POLICY)` | Edge Host Local API | SÍ | Según política PO configurada | `CuentaTransferida` |
| **Cargos a Crédito / CxC (OQ-SSOT-03)**| `PENDING PO DECISION — validación de límite según política configurada por PO` | Edge Host Local API | SÍ | NO (Turno activo) | `CargoCxCRegistrado` |
| **Cancelación Total Móvil (OQ-SSOT-04)**| `PENDING PO DECISION — autorizado según política aprobada por PO (MOBILE_VOID_POLICY)` | Edge Host Local API | SÍ | Según política PO configurada | `CuentaAnulada` |
| **Sugerencia Reabastecimiento (OQ-SSOT-05)**| `PENDING PO DECISION — cálculo según política configurada por PO (REPLENISHMENT_POLICY)` | Cloud API Gateway | NO | NO | `SugerenciaCompraGenerada` |
| **Prorrateo Split Cuenta (OQ-SSOT-06)**| `PENDING PO DECISION — cálculo según política aprobada por PO (ACCOUNT_SPLIT_POLICY)` | Edge Host Local API | SÍ | NO | `CuentaDividida` |
| **Recetas con Modificadores (OQ-SSOT-07)**| `PENDING PO DECISION — descuento según modelo de escandallo configurado por PO` | Edge / Cloud | SÍ | NO | `ConsumoInsumosRegistrado` |
| **Turnos Multi-Cajero (OQ-ARCH-01)** | `PENDING PO DECISION — sesión según modelo de cajero/estación aprobado por PO` | Edge Host Local API | SÍ | NO | `TurnoCajaIniciado` |
| **Facturación Global Automática (OQ-ARCH-02)**| `PENDING PO DECISION — ejecución según disparador aprobado por PO (GLOBAL_INVOICING_POLICY)` | Cloud API Gateway | NO | SÍ (Servicio / Admin) | `FacturaGlobalEmitida` |
| **Aplicación de Descuento / Cortesía**| Rol con permiso `cuenta.descuento` | Edge Host Local API | SÍ | SÍ (Credencial autorizadora) | `DescuentoAplicado` |
| **Apertura de Cajón Manual** | Rol con permiso `caja.abrir_cajon` | Edge Host Local API | SÍ | SÍ (Credencial cajero) | `AperturaCajonManual` |
| **Cobro y Cierre de Cuenta** | Rol con permiso `caja.cobrar` | Edge Host Local API | SÍ | NO (Turno activo) | `CuentaPagadaYCerrada` |
| **Emisión de Corte X (Parcial)** | Rol con permiso `corte.emitir_x` | Edge Host Local API | SÍ | NO (Turno activo) | `CorteXEmitido` |
| **Emisión de Corte Z (Definitivo)**| Rol con permiso `corte.emitir_z` | Edge Host Local API | SÍ | SÍ (Credencial autorizadora) | `CorteZEmitido` (Inmutable) |
| **Ajuste Manual / Contingencia Folios**| Rol administrativo local con permiso `folios.contingencia` | Edge Host Local API | SÍ | SÍ (Credencial + Motivo) | `ContingenciaFolioRegistrada` |
| **Modificación de Precios / Catálogo**| Rol corporativo con permiso `catalogo.administrar` | Cloud API Gateway | NO | SÍ (MFA Cloud) | `CatalogoPreciosModificado` |
| **Enrolamiento de Nueva Terminal** | Rol administrativo local con permiso `dispositivos.enrolar` | Edge Host Local API | SÍ | SÍ (Pairing OTP físico) | `TerminalEnrolada` |

---

## 2. Invariante de Autorización en Borde
> **ENFORCEMENT IN TRUSTED BOUNDARY:** Queda estrictamente prohibido confiar en la interfaz de usuario (UI) para la restricción de privilegios. Toda mutación enviada mediante HTTP o WebSocket al Edge Host o Cloud API valida la firma de sesión y la matriz de permisos en el backend antes de su ejecución transaccional.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
