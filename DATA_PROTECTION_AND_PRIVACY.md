# DATA PROTECTION AND PRIVACY SPECIFICATION — ERP RESTAURANTES

**Document ID:** `ARCH-PRV-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Protección de Datos de Tarjetas y Alcance PCI-DSS (Minimal Scope)

Para minimizar el alcance normativo PCI-DSS y eliminar el riesgo de exfiltración masiva de datos bancarios:
1. **Datos Prohibidos:** Queda estrictamente prohibido procesar, transmitir o almacenar en cualquier nodo del sistema:
   - Primary Account Number (PAN) completo en texto plano.
   - Código de Seguridad (CVV / CVC / CID).
   - Datos de banda magnética (Track 1 / Track 2).
   - PIN de tarjeta bancaria.
2. **Modelo de Cobro Integrado:** Las terminales de cobro bancario (PIN Pads / SmartPOS) operan de forma desacoplada; el sistema únicamente recibe y almacena:
   - Token de autorización bancaria (`reference_auth_code`).
   - Últimos 4 dígitos de la tarjeta (`card_last4`).
   - Nombre del titular (si lo retorna la pasarela) e institución emisora.

---

## 2. Matriz de Datos Personales (PII) y Tratamiento de Privacidad

| Categoría de PII | Propósito de Negocio | Origen del Dato | Control de Acceso | Retención Sugerida | Mecanismo de Anonimización |
|---|---|---|---|---|---|
| **Nombre de Cliente** | Facturación, Reservas y CRM | Captura en POS / Web | Restringido por Tenant (RLS) | `LEGAL/PRIVACY VALIDATION REQUIRED` | Enmascaramiento de nombre en solicitudes de derecho de supresión. |
| **Teléfono Móvil** | Notificaciones de Delivery y WhatsApp | Captura en Comanda / Web | Operador de Despacho y CRM | `LEGAL/PRIVACY VALIDATION REQUIRED` | Hasheo o eliminación física del registro de contacto. |
| **Email y RFC / Tax ID** | Emisión de CFDI / Facturas | Captura en Portal Fiscal | Administrador y Facturación | `5 a 10 años (Obligación Fiscal)` | Preservación de factura inmutable; disociación en catálogo CRM. |
| **Dirección de Entrega** | Logística de Flota Propia | Captura en Pedido Delivery | Repartidor asignado y Despacho | `30 días post-entrega (Operativo)` | Purga de coordenadas y texto de dirección tras cierre contable. |

---

## 3. Política de Redacción en Logs y Telemetría

Para evitar la fuga accidental de credenciales o PII en herramientas de observabilidad (Sentry, logs del sistema operativo):
- **Campos Censurados Automáticamente:** `password`, `pin`, `pin_hash`, `token`, `secret`, `authorization`, `credit_card`, `cvv`, `private_key`.
- **Enmascaramiento de PII:** Correos electrónicos se registran como `u***@domain.com` y números telefónicos como `******1234`.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
