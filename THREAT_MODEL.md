# THREAT MODEL SPECIFICATION (STRIDE) — ERP RESTAURANTES

**Document ID:** `ARCH-THR-001`  
**Version:** `1.3 REMEDIATED DRAFT (R2.2)`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-03  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect — Remediation Author`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Metodología y Alcance

El modelo de amenazas implementa el marco **STRIDE** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) evaluando los 14 Trust Boundaries y activos del sistema bajo supuestos de defensa en profundidad.

---

## 2. Matriz Exhaustiva de Amenazas STRIDE

| Threat ID | Categoría STRIDE | Activo Afectado | Trust Boundary | Vector de Ataque | Impacto Potencial | Control Existente / Diseñado | Control Requerido en Implementación | Disposición Arquitectónica y Estado de Validación |
|---|---|---|---|---|---|---|---|---|
| **THR-01** | Spoofing | CachedUsers (PIN) | TB-5 (Edge ↔ POS) | Fuerza bruta de PIN de empleado en terminal desatendida. | Acceso no autorizado a funciones operativas. | Argon2id salted hash + Rate limiting progresivo. | Bloqueo temporal de estación tras 5 fallos con alerta auditada. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-02** | Spoofing | Edge Server Identity | TB-4 / TB-5 (mDNS) | Rogue Edge en LAN anuncia servicio mDNS e intenta interceptar OTP o actuar como relay. | Man-in-the-Middle y suplantación de Edge Host. | Payload de emparejamiento vincula `edgePublicKeyFingerprint` con verificación previa a la revelación del secreto (R2F-01). | Rechazo inmediato de conexión si fingerprint TLS no coincide. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-03** | Spoofing | Conectores Delivery | TB-10 (Integrations) | Inyección de webhooks falsificados de pedidos de agregadores externos. | Ingesta de pedidos no pagados en cocina. | Verificación de firma criptográfica según contrato del proveedor. | Ventana de repetición y deduplicación por eventId (`PROVIDER CONTRACT`). | ARCHITECTURALLY RESOLVED — `PROVIDER VALIDATION REQUIRED` |
| **THR-04** | Tampering | SQLite Database | TB-9 (Edge ↔ File) | Empleado con acceso físico modifica el archivo `.db` para alterar montos o inventario. | Fraude financiero y desvío de efectivo. | Permisos de SO restringidos + Hash chaining local + Anclajes Cloud periódicos. | Cifrado en reposo SQLCipher con llave protegida en OS Keyring. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-05** | Tampering | Folio Leases / Outbox | TB-4 (Cloud ↔ Edge) | Manipulación de contadores de tickets en nodo Edge desfasado. | Colisión de folios fiscales o duplicidad de ventas. | Protocolo de Lease con épocas, fencing tokens y high-water mark en Cloud. | Rechazo atómico con `403 LEASE_REVOKED` ante token inválido. | ARCHITECTURALLY RESOLVED — `IMPLEMENTATION VALIDATION REQUIRED` |
| **THR-06** | Repudiation | Cancelaciones y Cortes | TB-5 / TB-7 | Operador niega haber realizado operaciones sensibles. | Pérdida de trazabilidad y encubrimiento de faltantes. | Bitácora `local_audit_trail` con firma de actor, estación y hash chaining. | Sincronización obligatoria a Cloud con ACK firmado. | ARCHITECTURALLY RESOLVED — `IMPLEMENTATION VALIDATION REQUIRED` |
| **THR-07** | Info Disclosure | Datos Multi-Tenant | TB-3 (Cloud ↔ PG) | Consulta analítica o endpoint sin filtro que expone datos de otra empresa. | Violación grave de privacidad y confidencialidad comercial. | Row-Level Security (RLS) en PostgreSQL + Claves foráneas compuestas. | Inyección de `app.current_organization_id` en conexión pooling. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-08** | Info Disclosure | Credenciales Fiscales | TB-10 (Cloud Vault) | Exfiltración de llaves privadas CSD o contraseñas de timbrado PAC. | Emisión de facturas fiscales apócrifas a nombre del restaurante. | Envelope Encryption (AES-256-GCM) + Acceso exclusivo de worker de timbrado. | Prohibición estricta de logs de credenciales y rotación auditada. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-09** | DoS | Red Local / KDS | TB-6 / TB-8 (LAN) | Inundación masiva de tramas TCP/WebSocket en la red de cocina. | Parálisis del despacho de comandas en hora pico. | Segmentación de VLAN operativa + Rate limiting en WebSocket Server local. | Buffer local de reconexión y aislamiento físico de red de invitados. | ARCHITECTURALLY RESOLVED — `HARDWARE VALIDATION REQUIRED` |
| **THR-10** | DoS | Cloud Sync API | TB-1 (Internet ↔ Cloud)| Ataque distribuido de denegación de servicio contra el Gateway de sincronización. | Imposibilidad de actualizar catálogos o sincronizar cortes Z. | Cloud WAF + Rate limiting por IP/Tenant + Offline-capable branch workflows explicitly designated by the frozen Solution Architecture can continue using Edge-local authority during WAN loss, subject to topology, cached data, entitlements, folio leases and applicable offline-policy constraints. | Failure-mode and offline-continuity behavior requires implementation and QA validation on representative branch conditions. | ARCHITECTURALLY RESOLVED — `IMPLEMENTATION / FAILURE-MODE VALIDATION REQUIRED` |
| **THR-11** | Elevation of Priv | Permisos Operativos | TB-5 (POS ↔ Edge) | Operador ejecuta comando no autorizado modificando el payload de la petición. | Cancelación no autorizada o apertura de cajón. | Enforcement de permisos en el backend del Edge Host (no en UI). | Token de autorización efímero con vigencia de 60 segundos (`SECURITY POLICY DEFAULT`). | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-12** | Elevation of Priv | Electron Runtime | TB-5 (Electron Host) | Inyección de script malicioso que ejecuta comandos de sistema operativo. | Compromiso total del servidor de sucursal. | `contextIsolation = true`, `nodeIntegration = false`, CSP estricta. | IPC bridge con lista blanca estricta de métodos autorizados. | ARCHITECTURALLY RESOLVED — `PENETRATION VALIDATION REQUIRED` |
| **THR-13** | Tampering | Reloj del Sistema Local| TB-5 / TB-9 (Edge OS)| Manipulación del reloj de la estación para extender la validez de credenciales.| Evasión de ventanas de expiración y alteración de auditoría. | Monotonic timers (`process.hrtime`) + Detección de desfase vs `lastKnownCloudTime`. | Alerta automática de desincronización y bloqueo de emisión de tokens. | ARCHITECTURALLY RESOLVED — `IMPLEMENTATION VALIDATION REQUIRED` |

---

## 3. Delimitación de Continuidad Operativa Offline (R2F-05)

> **ALCANCE LIMITADO DE CAPACIDAD OFFLINE:**  
> La capacidad offline hace referencia exclusivamente a los flujos de trabajo de sucursal explícitamente designados como autoritativos en Edge / con soporte offline en la Solution Architecture congelada. No implica ni garantiza que todas las capacidades del ERP, administración Cloud, integraciones con agregadores, analíticas corporativas, procesos fiscales, administración de catálogos o capacidades no resueltas del Product Owner estén disponibles offline.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
