# SECURITY ARCHITECTURE — ERP RESTAURANTES / TRIDENTPOS

**Document ID:** `ARCH-SEC-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  
**Target Gate:** `SECURITY_GATE`  

---

## 1. Security Philosophy and Core Principles

La arquitectura de seguridad de **ERP RESTAURANTES / TRIDENTPOS** está diseñada bajo el principio de **Zero Trust Híbrido** y **Defensa en Profundidad**, considerando que el entorno físico de operación (restaurantes, cocinas y terminales de cobro) es intrínsecamente hostil y expuesto.

### Principios Fundamentales:
1. **DISCOVERY IS NOT TRUST:** La visibilidad o anuncio por mDNS en red local no confiere autorización ni autenticidad.
2. **AUTHENTICATION $\neq$ AUTHORIZATION:** La verificación de identidad es un paso previo; la autorización se ejecuta forzosamente en el boundary de confianza (`Trusted Boundary`) sobre el modelo de datos y capacidades.
3. **DEFAULT DENY MULTI-TENANCY:** Ninguna solicitud o consulta a base de datos se ejecuta sin un contexto explícito y validado de `organization_id`.
4. **TAMPER-EVIDENT AUDIT:** Los eventos críticos (cancelaciones, descuentos, aperturas de cajón, reconciliaciones y contingencias de folios) se registran de forma encadenada e inmutable.
5. **MINIMAL PCI SCOPE:** Prohibición estricta de almacenamiento de datos sensibles de tarjetas (PAN completo, CVV o tracks magnéticos); delegación a terminales dedicadas y tokens bancarios.

```mermaid
graph TD
    subgraph Untrusted_Internet["Zona No Confiable (Internet Pública)"]
        Agregadores["Agregadores (Uber/Rappi/Didi)"]
        BrowserAdmin["Navegadores Admin / Web"]
    end

    subgraph Cloud_Control_Plane["Boundary Seguro Cloud (Supabase / Render)"]
        WAF["Cloud WAF & Rate Limiter"]
        API_GW["Cloud API Gateway (JWT / RBAC)"]
        PG_DB["PostgreSQL 16 (RLS Default Deny)"]
        Vault["Secret Vault (Credenciales Cifradas)"]
    end

    subgraph Branch_LAN["Boundary Operativo de Sucursal (LAN Aislada)"]
        EdgeHost["Edge Server Host (Node/Electron)"]
        LocalSQLite["SQLite 3 WAL (SQLCipher / File ACL)"]
        CachedIAM["Cached Identity Store (Argon2id)"]
    end

    subgraph Floor_Stations["Terminales de Piso y Periféricos"]
        POSTerminal["Terminal POS (PIN Verifier)"]
        KDSDisplay["Pantalla KDS"]
        MobileWaiter["Comandero Móvil WiFi"]
        Printer["Impresora ESC/POS (Raw 9100)"]
    end

    Agregadores -->|Webhooks Firmados HMAC-SHA256| WAF
    BrowserAdmin -->|HTTPS TLS 1.3 + MFA| WAF
    WAF --> API_GW
    API_GW --> PG_DB
    API_GW -.-> Vault

    EdgeHost <==>|WSS TLS 1.3 Mutual Auth| API_GW
    EdgeHost --> LocalSQLite
    EdgeHost --> CachedIAM

    POSTerminal <==>|WSS TLS Local + Station Token| EdgeHost
    KDSDisplay <==>|WSS TLS Local| EdgeHost
    MobileWaiter <==>|WSS TLS Local + PIN Session| EdgeHost
    EdgeHost -->|LAN Raw TCP (No Web Exposure)| Printer
```

---

## 2. Assets and Trust Boundaries

### 2.1 Clasificación de Activos de Seguridad
- **Críticos de Negocio / Financieros:** Cuentas, Pagos, Turnos de Caja, Cortes X/Z, Pólizas de Interfaz Contable, Facturación Fiscal.
- **Identidad y Acceso:** Credenciales de usuario, Hashes de PIN (Argon2id), Roles RBAC, Tokens de sesión JWT, Claves de enrolamiento de terminales.
- **Secretos del Sistema:** Credenciales OAuth de agregadores (Uber/Rappi/Didi), Llaves privadas CSD/PAC para CFDI, Tokens de Fencing, Llaves simétricas de cifrado local.
- **Integridad Operativa:** Leases de folios, `epochId`, `fencingToken`, Outbox transaccional, logs de idempotencia, bitácora de auditoría.
- **Privacidad (PII):** Datos de clientes (nombre, teléfono, email, RFC), saldos de monedero RestCard.

### 2.2 Catálogo de 14 Trust Boundaries
1. **Internet ↔ Cloud Control Plane:** Filtrado WAF, terminación TLS 1.3, rate limiting por IP/Tenant.
2. **Browser Admin ↔ Cloud API:** Autenticación Supabase Auth JWT, cookies seguras `SameSite=Strict`, `HttpOnly`, MFA obligatorio para roles ejecutivos.
3. **Cloud API ↔ PostgreSQL:** Conexión pooling con `SET LOCAL app.current_organization_id`, políticas RLS estrictas.
4. **Cloud ↔ Edge Host (WAN):** WebSocket seguro bidireccional (`WSS`) con TLS 1.3, autenticación de estación Edge mediante token firmado y `branch_id` criptográfico.
5. **Edge Host ↔ POS Terminal (LAN):** TLS local con certificado autofirmado/CA local de sucursal y validación de `station_id` enrolado.
6. **Edge Host ↔ KDS Display (LAN):** Subscripción WSS restringida a lectura/mutación exclusiva de estados de cocina.
7. **Edge Host ↔ Comandero Móvil (WiFi):** Sesión efímera de mesero vinculada a dispositivo físico autorizado, rechazo por inactividad.
8. **Edge Host ↔ Periféricos ESC/POS:** Comunicación directa TCP 9100 o USB; puerto restringido a la IP del Edge, sin exposición web ni cross-LAN.
9. **Edge Process ↔ Archivo SQLite:** Permisos de sistema operativo restrictivos (`chmod 600` / Windows ACLs), cifrado en reposo con llave derivada en TPM/OS Keyring (`SECURITY BASELINE`).
10. **Integrations Hub ↔ Agregadores Externos:** Validación de firma HMAC-SHA256 en webhooks entrantes, secretos aislados por Tenant en Vault.
11. **Cloud ↔ Almacenamiento de Respaldos (S3):** Cifrado SSE-KMS, políticas de inmutabilidad (Object Lock / WORM) y retención gobernada.
12. **Pipeline CI/CD ↔ Artefactos de Release:** Firma digital de instaladores Electron y metadatos de actualización (Ed25519).
13. **Operador de Soporte / Superadmin ↔ Recursos Tenant:** Acceso Just-In-Time (JIT) con elevación temporal aprobada y bitácora de auditoría inviolable.
14. **LAN Operativa Restaurante ↔ Wi-Fi Comensales / Huéspedes:** Separación física o VLAN aislada (VLAN Operativa POS vs. VLAN Invitados).

---

## 3. Threat Modeling (STRIDE Methodology)

El análisis formal de amenazas abarca las 6 categorías STRIDE en [`THREAT_MODEL.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/THREAT_MODEL.md):
- **Spoofing:** Falsificación de PIN, terminales no autorizadas intentando unirse a la LAN, Edge falso suplantando mDNS, webhooks falsos de delivery.
- **Tampering:** Modificación no autorizada de SQLite, alteración de precios en tránsito local, manipulación de la cola Outbox o folios locales.
- **Repudiation:** Negación de cancelaciones post-cocina, descuentos o faltantes en arqueos de caja.
- **Information Disclosure:** Fuga cross-tenant en consultas analíticas, extracción de base de datos SQLite en terminal robada, exposición de secretos en logs.
- **Denial of Service:** Inundación de mensajes WSS en LAN, saturación de KDS con comandas falsas, agotamiento de conexiones en Cloud.
- **Elevation of Privilege:** Mesero ejecutando funciones de corte de caja, bypass de RLS mediante roles de servicio mal configurados, compromiso de Electron via IPC.

---

## 4. Identity, Authentication and Session Security

### 4.1 Identidad Administrativa en Cloud
- Proveedor de identidad federada con emisión de tokens JWT de corta duración (15 minutos) y Refresh Tokens rotativos con detección de reuso.
- Re-autenticación obligatoria con MFA para operaciones financieras críticas (cambios de precios de catálogo, exportaciones masivas, asignación de roles).

### 4.2 Offline IAM en Edge (Piso de Venta)
- **Almacenamiento de PIN:** Hashes salteados con **Argon2id** (Baseline: $m=64\text{ MB}, t=3, p=4$ — `SECURITY BASELINE — REQUIRES TARGET HARDWARE BENCHMARK`).
- **Protección contra Fuerza Bruta:** Bloqueo progresivo exponencial tras 3 intentos fallidos (demoras de 2s, 5s, 30s) y bloqueo temporal de estación tras 5 fallos consecutivos con alerta auditada al gerente.
- **Ventana de Validez Offline:** Máximo de 72 horas para credenciales cacheadas (`expiresAt`). Tras 72 horas sin conexión a Cloud, se bloquea la apertura de nuevos turnos administrativos requiriendo validación en línea.

---

## 5. Authorization and Multi-Tenant Isolation

### 5.1 Matriz de Enforcement en Trusted Boundary
Todas las capacidades operativas (`CAP-OPS`, `CAP-SCM`, `CAP-FIN`) validan permisos en el servidor (Edge Host o Cloud API), nunca exclusivamente en el cliente frontend:
- **Cancelaciones Post-Cocina:** Requieren rol `SUPERVISOR` / `GERENTE` y token de autorización firmado (manteniendo neutralidad sobre `OQ-SSOT-01`).
- **Transferencia de Cuentas:** Registro obligatorio de `actor_id` y `station_id` emisor.
- **Corte Z:** Exclusivo de rol `CAJERO_PRINCIPAL` o `GERENTE` con sesión activa.

### 5.2 Aislamiento Multi-Tenant (Default Deny)
- **PostgreSQL RLS:** Políticas en todas las tablas que aplican `WHERE organization_id = current_setting('app.current_organization_id')::uuid`.
- **Connection Pooling:** Inyección obligatoria de variable de sesión en el middleware antes de cualquier consulta: `SET LOCAL app.current_organization_id = :orgId;`.

---

## 6. Secrets, Cryptography and Key Management

Detallado en [`SECRETS_AND_KEY_MANAGEMENT.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/SECRETS_AND_KEY_MANAGEMENT.md):
- **Cifrado Local Edge:** Base de datos SQLite protegida mediante SQLCipher con llave de 256 bits derivada localmente mediante OS Keyring (Windows DPAPI / Linux Keyring) ligada al hardware del dispositivo.
- **Secretos de Agregadores y PACs:** Cifrado en reposo con Envelope Encryption (llaves AES-256-GCM gestionadas en Cloud Vault). Prohibido almacenamiento en archivos de configuración o repositorios Git.
- **Fencing Tokens:** Tokens criptográficos de 256 bits generados en Cloud al asignar leases de folios; validados en cada sincronización para cerco inmediato de terminales zombie.

---

## 7. Transport, LAN and Peripheral Security

- **mDNS y Descubrimiento:** El anuncio mDNS es únicamente para resolución de IP local. El cliente solicita autenticación al Edge Host mediante certificado TLS local con Fingerprint verificado durante el enrolamiento de la estación (`Device Enrollment`).
- **Impresoras y Periféricos ESC/POS:** Acceso exclusivo desde el proceso del Edge Host. Reglas de firewall local bloquean el tráfico directo desde terminales móviles o comensales hacia los puertos de impresión (Raw TCP 9100).

---

## 8. Electron / Node.js Runtime Hardening

En estricto cumplimiento de los estándares de seguridad para Electron:
- `contextIsolation = true` y `nodeIntegration = false` en todas las ventanas.
- Preload scripts mínimos con puente IPC tipado y lista blanca estricta de canales autorizados.
- Content Security Policy (CSP) restrictiva: `default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;`.
- Actualizaciones de software firmadas digitalmente con verificación de firma RSA/Ed25519 antes de la instalación.

---

## 9. Security Logging, Redaction and Tamper-Evidence

- **Redacción Obligatoria:** Prohibición absoluta de registrar en logs: PINs en texto plano, contraseñas, tokens JWT completos, secretos de webhooks, llaves privadas CSD y datos de tarjetas.
- **Diseño Tamper-Evident:** La bitácora local `local_audit_trail` implementa **Hash Chaining** criptográfico ($H_n = \text{SHA256}(H_{n-1} \parallel \text{EventData}_n)$) para evidenciar cualquier intento de alteración o borrado local antes de su replicación a Cloud.

---

## 10. Supply Chain and Release Security

- **Dependencias:** Lockfiles obligatorios (`package-lock.json`), escaneo automatizado de vulnerabilidades en CI/CD y generación de SBOM (Software Bill of Materials).
- **Protección de Ramas:** Revisiones obligatorias por pares, checks de seguridad SAST automáticos y bloqueo de commits directos en ramas principales.

---

## 11. Incident Response Playbooks

10 procedimientos de respuesta a incidentes formalizados en [`SECURITY_INCIDENT_RESPONSE.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/SECURITY_INCIDENT_RESPONSE.md):
1. Cuenta de empleado comprometida.
2. Credencial de gerente filtrada.
3. Robo físico de servidor Edge Host.
4. Sospecha de fuga de datos multi-tenant.
5. Fuga de secreto de integración (Uber/Rappi).
6. Compromiso de llave fiscal CSD / PAC.
7. Ataque de repetición de webhooks externos.
8. Acceso cross-tenant accidental.
9. Dependencia npm comprometida.
10. Ransomware o corrupción en sucursal.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
