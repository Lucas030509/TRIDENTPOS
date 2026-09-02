# DATA PROTECTION AND PRIVACY SPECIFICATION — ERP RESTAURANTES

**Document ID:** `ARCH-PRV-001`  
**Version:** `1.1 REMEDIATED DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Alcance de Seguridad en Pagos y Límite de Datos Bancarios (SR-08)

> **ARCHITECTURAL SECURITY OBJECTIVE:**
> Los procesos de la aplicación TRIDENTPOS DEBEN permanecer fuera del flujo de datos de tarjetas (`Cardholder Data Path`) siempre que la integración con la terminal de pago lo soporte.
> 
> Queda estrictamente prohibido que TRIDENTPOS persista:
> - Primary Account Number (PAN) completo en texto plano.
> - Código de Seguridad (CVV / CVC / CID).
> - Datos de banda magnética (Track 1 / Track 2).
> - PIN de tarjeta bancaria.
> 
> El sistema interactúa exclusivamente con PIN Pads / SmartPOS mediante pasarelas autorizadas, recibiendo únicamente:
> - Token o referencia de autorización bancaria (`reference_auth_code`).
> - Últimos 4 dígitos de la tarjeta (`card_last4`).
> - Nombre del titular e institución emisora (si es devuelto por la pasarela).
> 
> *El alcance final de cumplimiento PCI-DSS depende de la integración específica de cada terminal/pasarela y requiere validación formal de cumplimiento.*

---

## 2. Matriz de Datos Personales (PII) y Tratamiento de Privacidad (SR-07)

| Categoría de PII | Propósito de Negocio | Origen del Dato | Control de Acceso | Retención Clasificada | Mecanismo de Anonimización / Supresión |
|---|---|---|---|---|---|
| **Nombre de Cliente** | Facturación, Reservas y CRM | Captura en POS / Web | Restringido por Tenant (RLS) | `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED` | Enmascaramiento de nombre en solicitudes de derecho de supresión. |
| **Teléfono Móvil** | Notificaciones de Delivery y WhatsApp | Captura en Comanda / Web | Operador de Despacho y CRM | `PROVISIONAL RETENTION — LEGAL/PRIVACY VALIDATION REQUIRED` | Hasheo o eliminación física del registro de contacto. |
| **Email y RFC / Tax ID** | Emisión de CFDI / Facturas | Captura en Portal Fiscal | Administrador y Facturación | `PROVISIONAL FISCAL RANGE (5–10 AÑOS) — LEGAL VALIDATION REQUIRED` | Preservación de factura inmutable; disociación en catálogo CRM. |
| **Dirección de Entrega** | Logística de Flota Propia | Captura en Pedido Delivery | Repartidor asignado y Despacho | `BUSINESS POLICY DEFAULT (30 DÍAS) — PO VALIDATION REQUIRED` | Purga de coordenadas y texto de dirección tras cierre contable. |

---

## 3. Política de Redacción en Logs y Telemetría

Para evitar la fuga accidental de credenciales o PII en herramientas de observabilidad (Sentry, logs del sistema operativo):
- **Campos Censurados Automáticamente:** `password`, `pin`, `pin_hash`, `token`, `secret`, `authorization`, `credit_card`, `cvv`, `private_key`.
- **Enmascaramiento de PII:** Correos electrónicos se registran como `u***@domain.com` y números telefónicos como `******1234`.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
