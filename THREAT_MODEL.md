# THREAT MODEL SPECIFICATION (STRIDE) — ERP RESTAURANTES

**Document ID:** `ARCH-THR-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Metodología y Alcance

El modelo de amenazas implementa el marco **STRIDE** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) evaluando los 14 Trust Boundaries y activos del sistema.

---

## 2. Matriz Exhaustiva de Amenazas STRIDE

| Threat ID | Categoría STRIDE | Activo Afectado | Trust Boundary | Vector de Ataque | Impacto Potencial | Control Existente / Diseñado | Control Requerido en Implementación | Riesgo Residual |
|---|---|---|---|---|---|---|---|---|
| **THR-01** | Spoofing | CachedUsers (PIN) | TB-5 (Edge ↔ POS) | Fuerza bruta de PIN de mesero o gerente en terminal desatendida. | Acceso no autorizado a funciones de comanda o cobro. | Argon2id salted hash + Rate limiting progresivo. | Bloqueo temporal de estación tras 5 fallos con alerta auditada. | Bajo |
| **THR-02** | Spoofing | Edge Server Identity | TB-4 / TB-5 (mDNS) | Servidor falso en LAN anunciando servicio mDNS para interceptar credenciales. | Man-in-the-Middle y robo de sesiones locales. | Discovery is not Trust: Certificado TLS local verificado con Fingerprint de enrolamiento. | Validación estricta de Certificate Pinning en comanderos móviles. | Bajo |
| **THR-03** | Spoofing | Conectores Delivery | TB-10 (Integrations) | Inyección de webhooks falsificados de pedidos de Uber/Rappi. | Ingesta de pedidos no pagados en cocina. | Verificación de firma criptográfica HMAC-SHA256 en cabeceras. | Timestamp replay window de 5 minutos y deduplicación por eventId. | Muy Bajo |
| **THR-04** | Tampering | SQLite Database | TB-9 (Edge ↔ File) | Empleado con acceso físico modifica el archivo `.db` para alterar montos de venta o inventario. | Fraude financiero y desvío de efectivo. | Permisos de SO restringidos + Hash chaining en auditoría local. | Cifrado en reposo SQLCipher con llave protegida en OS Keyring. | Bajo |
| **THR-05** | Tampering | Folio Leases / Outbox | TB-4 (Cloud ↔ Edge) | Manipulación de contadores de tickets en nodo Edge comprometido. | Colisión de folios fiscales o duplicidad de ventas. | Protocolo de Lease con épocas, fencing tokens y high-water mark en Cloud. | Rechazo atómico con `403 LEASE_REVOKED` ante token inválido. | Muy Bajo |
| **THR-06** | Repudiation | Cancelaciones y Cortes | TB-5 / TB-7 | Cajero o mesero niega haber cancelado platillos o aplicado descuentos manuales. | Pérdida de trazabilidad y encubrimiento de faltantes de caja. | Bitácora `local_audit_trail` inmutable con firma de actor y estación. | Hash Chaining secuencial y sincronización obligatoria a Cloud. | Muy Bajo |
| **THR-07** | Info Disclosure | Datos Multi-Tenant | TB-3 (Cloud ↔ PG) | Consulta analítica o endpoint sin filtro que expone datos de otra empresa. | Violación grave de privacidad y confidencialidad comercial. | Row-Level Security (RLS) en PostgreSQL + Claves foráneas compuestas. | Inyección de `app.current_organization_id` en conexión pooling. | Muy Bajo |
| **THR-08** | Info Disclosure | Credenciales Fiscales | TB-10 (Cloud Vault) | Exfiltración de llaves privadas CSD o contraseñas de timbrado PAC. | Emisión de facturas fiscales apócrifas a nombre del restaurante. | Cifrado AES-256-GCM en reposo + Acceso exclusivo de worker de timbrado. | Prohibición estricta de logs de credenciales y rotación auditada. | Muy Bajo |
| **THR-09** | DoS | Red Local / KDS | TB-6 / TB-8 (LAN) | Inundación masiva de tramas TCP/WebSocket en la red de cocina. | Parálisis del despacho de comandas en hora pico. | Segmentación de VLAN operativa + Rate limiting en WebSocket Server local. | Buffer local de reconexión y aislamiento físico de red de invitados. | Bajo |
| **THR-10** | DoS | Cloud Sync API | TB-1 (Internet ↔ Cloud)| Ataque distribuido de denegación de servicio contra el Gateway de sincronización. | Imposibilidad de actualizar catálogos o sincronizar cortes Z. | Cloud WAF + Rate limiting por IP/Tenant + Capacidad Offline 100% en Edge. | Operación local garantizada de forma autónoma sin dependencia WAN. | Bajo |
| **THR-11** | Elevation of Priv | Permisos RBAC | TB-5 (POS ↔ Edge) | Mesero ejecuta comando de supervisor modificando el payload JSON de la petición. | Cancelación no autorizada de comandas o apertura de cajón. | Enforcement de permisos en el backend del Edge Host (no en UI). | Token de autorización de gerente efímero con vigencia de 60 segundos. | Muy Bajo |
| **THR-12** | Elevation of Priv | Electron Runtime | TB-5 (Electron Host) | Inyección de script malicioso que ejecuta comandos de sistema operativo. | Compromiso total del servidor de sucursal. | `contextIsolation = true`, `nodeIntegration = false`, CSP estricta. | IPC bridge con lista blanca estricta de métodos autorizados. | Muy Bajo |

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
