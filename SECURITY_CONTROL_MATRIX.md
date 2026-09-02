# SECURITY CONTROL & AUTHORIZATION MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-SCM-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Matriz de Control de Acceso y Autorización por Capacidad

| Capacidad Funcional | Rol Requerido | Enforcement Point | Permitido Offline | Re-Autenticación Requerida | Evento de Auditoría Generado |
|---|---|---|---|---|---|
| **Apertura de Mesa / Comanda** | Mesero, Cajero, Capitán | Edge Host Local API | SÍ | NO (Sesión activa) | `MesaComandaIniciada` |
| **Envío de Comanda a Cocina (KDS)**| Mesero, Capitán | Edge Host Local API | SÍ | NO | `ComandaEnviadaKDS` |
| **Cancelación Pre-Cocina** | Mesero, Cajero, Capitán | Edge Host Local API | SÍ | NO | `ItemCanceladoPreCocina` |
| **Cancelación Post-Cocina** | Supervisor, Gerente | Edge Host Local API | SÍ | SÍ (PIN Gerente / Supervisor) | `CancelacionPostCocinaAutorizada` |
| **Aplicación de Descuento / Cortesía**| Supervisor, Gerente | Edge Host Local API | SÍ | SÍ (PIN Supervisor) | `DescuentoAplicado` |
| **Apertura de Cajón Manual** | Cajero, Gerente | Edge Host Local API | SÍ | SÍ (PIN Cajero / Gerente) | `AperturaCajonManual` |
| **Cobro y Cierre de Cuenta** | Cajero | Edge Host Local API | SÍ | NO (Turno activo) | `CuentaPagadaYCerrada` |
| **Emisión de Corte X (Parcial)** | Cajero, Supervisor | Edge Host Local API | SÍ | NO (Turno activo) | `CorteXEmitido` |
| **Emisión de Corte Z (Definitivo)**| Cajero Principal, Gerente | Edge Host Local API | SÍ | SÍ (PIN Gerente) | `CorteZEmitido` (Inmutable) |
| **Ajuste Manual / Contingencia Folios**| Gerente de Sucursal | Edge Host Local API | SÍ | SÍ (PIN Gerente + Motivo) | `ContingenciaFolioRegistrada` |
| **Modificación de Precios / Catálogo**| Administrador Corporativo | Cloud API Gateway | NO | SÍ (MFA Cloud) | `CatalogoPreciosModificado` |
| **Asignación de Roles y Permisos** | Administrador Corporativo | Cloud API Gateway | NO | SÍ (MFA Cloud) | `RolesUsuarioModificados` |
| **Configuración Conectores Delivery**| Administrador Corporativo | Cloud API Gateway | NO | SÍ (MFA Cloud) | `ConectorIntegracionActualizado`|
| **Enrolamiento de Nueva Terminal** | Gerente de Sucursal | Edge Host Local API | SÍ | SÍ (Credencial Gerencial) | `TerminalEnrolada` |
| **Reapertura de Turno / Reconciliación**| Administrador Corporativo | Cloud API Gateway | NO | SÍ (MFA Cloud + Ticket) | `ReconciliacionManualEjecutada` |

---

## 2. Invariante de Autorización en Borde
> **ENFORCEMENT IN TRUSTED BOUNDARY:** Queda estrictamente prohibido confiar en la interfaz de usuario (UI) para la restricción de privilegios. Toda mutación enviada mediante HTTP o WebSocket al Edge Host o Cloud API valida la firma de sesión y la matriz de permisos en el backend antes de su ejecución transaccional.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
