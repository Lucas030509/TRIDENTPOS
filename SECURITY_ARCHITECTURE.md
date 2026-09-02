# SECURITY ARCHITECTURE — ERP RESTAURANTES / TRIDENTPOS

**Document ID:** `ARCH-SEC-001`  
**Version:** `1.1 REMEDIATED DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  
**Target Gate:** `SECURITY_GATE`  

---

## 1. Security Philosophy and Core Principles

La arquitectura de seguridad de **ERP RESTAURANTES / TRIDENTPOS** está diseñada bajo el principio de **Zero Trust Híbrido** y **Defensa en Profundidad**:

### Principios Fundamentales:
1. **DISCOVERY IS NOT TRUST:** La visibilidad o anuncio por mDNS en red local no confiere autorización ni autenticidad. El emparejamiento y la confianza inicial requieren un protocolo de enrolamiento criptográfico autenticado.
2. **AUTHENTICATION $\neq$ AUTHORIZATION:** La verificación de identidad es un paso previo; la autorización se ejecuta forzosamente en el boundary de confianza (`Trusted Boundary`) sobre el modelo de datos y capacidades en el backend.
3. **DEFAULT DENY MULTI-TENANCY:** Ninguna solicitud o consulta a base de datos se ejecuta sin un contexto explícito y validado de `organization_id`.
4. **TAMPER-EVIDENT DESIGN:** Los eventos críticos (cancelaciones, descuentos, aperturas de cajón, reconciliaciones y contingencias de folios) se registran de forma encadenada e inmutable, complementados con puntos de anclaje remoto en Cloud. *Nota de diseño: El sistema es Tamper-Evident, no 'Tamper-Proof'. Un compromiso total del Edge Host antes de un anclaje externo representa un riesgo residual documentado.*
5. **MINIMAL PCI SCOPE:** Objetivo de mantener los procesos de la aplicación fuera del flujo de datos de tarjetas (PAN completo, CVV o tracks magnéticos); delegación a terminales bancarias dedicadas y tokens de autorización.

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

    Agregadores -->|Webhooks Firmados (Provider Contract)| WAF
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
- **Secretos del Sistema:** Credenciales OAuth de agregadores, Llaves privadas CSD/PAC para CFDI, Tokens de Fencing, Llaves simétricas de cifrado local.
- **Integridad Operativa:** Leases de folios, `epochId`, `fencingToken`, Outbox transaccional, logs de idempotencia, bitácora de auditoría.
- **Privacidad (PII):** Datos de clientes (nombre, teléfono, email, RFC), saldos de monedero RestCard.

### 2.2 Catálogo de 14 Trust Boundaries
1. **Internet ↔ Cloud Control Plane:** Filtrado WAF, terminación TLS 1.3, rate limiting por IP/Tenant (`SECURITY POLICY DEFAULT`).
2. **Browser Admin ↔ Cloud API:** Autenticación Supabase Auth JWT, cookies seguras `SameSite=Strict`, `HttpOnly`, MFA obligatorio para roles ejecutivos.
3. **Cloud API ↔ PostgreSQL:** Conexión pooling con `SET LOCAL app.current_organization_id`, políticas RLS estrictas (Default Deny).
4. **Cloud ↔ Edge Host (WAN):** WebSocket seguro bidireccional (`WSS`) con TLS 1.3, autenticación de estación Edge mediante token firmado y `branch_id` criptográfico.
5. **Edge Host ↔ POS Terminal (LAN):** TLS local con certificado verificado mediante protocolo de enrolamiento seguro y validación de `station_id` enrolado.
6. **Edge Host ↔ KDS Display (LAN):** Subscripción WSS restringida a lectura/mutación exclusiva de estados de cocina.
7. **Edge Host ↔ Comandero Móvil (WiFi):** Sesión efímera de mesero vinculada a dispositivo físico autorizado, rechazo por inactividad.
8. **Edge Host ↔ Periféricos ESC/POS:** Comunicación directa TCP 9100 o USB; puerto restringido a la IP del Edge, sin exposición web ni cross-LAN.
9. **Edge Process ↔ Archivo SQLite:** Permisos de sistema operativo restrictivos (`chmod 600` / Windows ACLs), cifrado en reposo con SQLCipher y llave en OS Keyring.
10. **Integrations Hub ↔ Agregadores Externos:** Validación de firma criptográfica según contrato del proveedor (`PROVIDER CONTRACT — REQUIRES INTEGRATION VALIDATION`), secretos aislados en Vault.
11. **Cloud ↔ Almacenamiento de Respaldos (S3):** Cifrado SSE-KMS, políticas de inmutabilidad (Object Lock / WORM) y retención gobernada.
12. **Pipeline CI/CD ↔ Artefactos de Release:** Firma digital de instaladores Electron y metadatos de actualización (Code Signing Ed25519/RSA).
13. **Operador de Soporte / Superadmin ↔ Recursos Tenant:** Acceso Just-In-Time (JIT) con elevación temporal aprobada y bitácora de auditoría.
14. **LAN Operativa Restaurante ↔ Wi-Fi Comensales / Huéspedes:** Separación física o VLAN aislada (VLAN Operativa POS vs. VLAN Invitados).

---

## 3. Protocolo de Confianza Inicial y Enrolamiento de Terminales (SR-03)

El principio **Discovery is not Trust** establece que mDNS es únicamente un protocolo de localización de red. El establecimiento de confianza inicial entre una nueva terminal y el Edge Server sigue el siguiente protocolo:

```mermaid
sequenceDiagram
    autonumber
    participant Station as Nueva Terminal / Comandero
    participant Admin as Gerente de Sucursal (Físico)
    participant Edge as Edge Server Host (Local)
    participant Cloud as Cloud Control Plane

    Admin->>Edge: Solicitar Generación de Token de Enrolamiento (One-Time Pairing)
    Edge->>Edge: Genera Pairing Secret (OTP 8 dígitos / QR) con expiración de 10 min
    Edge-->>Admin: Muestra QR / Código en pantalla física del Edge Host
    
    Station->>Station: Descubre candidatos Edge vía mDNS en LAN
    Station->>Admin: Solicita ingreso de Pairing Code / Escaneo de QR
    Admin->>Station: Ingresa código OTP / Escanea QR
    
    Station->>Edge: Handshake de Enrolamiento (Pairing Code + Station Identity Request)
    Edge->>Edge: Valida OTP no expirado y emite Certificado/Fingerprint local + Station Token
    Edge-->>Station: Retorna Certificado Local + Station Token firmado
    Station->>Station: Almacena Fingerprint en almacenamiento seguro local (Pinning)
    Edge->>Edge: Registra evento de auditoría `TerminalEnrolada`
    Edge-->>Cloud: Sincroniza nuevo `station_id` autorizado en próximo Outbox sync
```

### Invariantes del Enrolamiento:
1. **Unicidad y Expiración:** El secreto de emparejamiento es de un solo uso con vigencia máxima de 10 minutos (`SECURITY POLICY DEFAULT`).
2. **Re-enrolamiento y Des-enrolamiento:** Una estación revocada o robada se inhabilita en Cloud (`is_authorized = false`), provocando su rechazo local inmediato tras la siguiente sincronización.
3. **Resistencia a Rogue Edge:** Un Edge no autorizado en la LAN no puede emparejarse sin la confirmación física del código OTP en la consola del Edge legítimo.

---

## 4. Threat Modeling (STRIDE Methodology)

Formalizado en [`THREAT_MODEL.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/THREAT_MODEL.md):
- **Spoofing:** Falsificación de PIN, terminales no autorizadas en LAN, Edge falso en mDNS, webhooks falsos de delivery.
- **Tampering:** Modificación no autorizada de SQLite, alteración de precios, manipulación de Outbox o folios, manipulación del reloj del sistema operativo.
- **Repudiation:** Negación de cancelaciones post-cocina, descuentos o faltantes de caja.
- **Information Disclosure:** Fuga cross-tenant, extracción de base de datos SQLite en hardware robado, exposición de secretos en logs.
- **Denial of Service:** Inundación de mensajes WSS en LAN, saturación de KDS con comandas falsas, bloqueo malicioso por fuerza bruta intencional.
- **Elevation of Privilege:** Bypass de RBAC, bypass de RLS, compromiso de Electron vía IPC.

---

## 5. Identity, Authentication and Session Security

### 5.1 Identidad Administrativa en Cloud
- Proveedor de identidad federada con emisión de tokens JWT de corta duración (15 minutos — `SECURITY POLICY DEFAULT`) y Refresh Tokens rotativos con detección de reuso (7 días — `SECURITY POLICY DEFAULT`).
- MFA obligatorio para roles administrativos en operaciones de configuración global.

### 5.2 Offline IAM en Edge (Piso de Venta)
- **Almacenamiento de PIN:** Hashes salteados con **Argon2id** (Baseline: $m=64\text{ MB}, t=3, p=4$ — `SECURITY BASELINE — REQUIRES TARGET HARDWARE BENCHMARK`).
- **Protección contra Fuerza Bruta:** Demoras progresivas exponenciales (demoras de 2s en intento 3, 5s en intento 4) y bloqueo temporal de estación de 5 minutos tras 5 fallos consecutivos (`SECURITY POLICY DEFAULT`) con alerta auditada.
- **Ventana de Validez Offline:** Máximo de 72 horas para credenciales cacheadas (`SECURITY POLICY DEFAULT`). Tras 72 horas sin conexión a Cloud, se bloquea la apertura de nuevos turnos administrativos requiriendo validación en línea.

---

## 6. Authorization, Policy Points and Multi-Tenant Isolation

### 6.1 Policy Invariant para Operaciones Protegidas (SR-01)
> **POLÍTICA DE AUTORIZACIÓN NEUTRAL:** Para operaciones sensibles sujetas a decisiones pendientes del Product Owner (como la cancelación post-cocina `OQ-SSOT-01`), la arquitectura de seguridad establece el invariante:
> *Toda cancelación post-cocina DEBE ser autenticada, autorizada bajo la política configurada aprobada por el Product Owner (`POST_KITCHEN_CANCELLATION_POLICY`), justificada con código de motivo y auditada de forma inmutable.*
> La arquitectura de seguridad no selecciona roles específicos (Gerente, Supervisor, etc.) mientras la decisión de negocio permanezca como `PENDING PO DECISION`.

### 6.2 Aislamiento Multi-Tenant (Default Deny)
- **PostgreSQL RLS:** Políticas en todas las tablas que aplican `WHERE organization_id = current_setting('app.current_organization_id')::uuid`.
- **Connection Pooling:** Inyección obligatoria de variable de sesión en el middleware antes de cualquier consulta: `SET LOCAL app.current_organization_id = :orgId;`.

---

## 7. Secrets, Cryptography and Key Management

- **Envelope Encryption:** Llaves DEK (AES-256-GCM) cifradas por Root KEK en Secret Vault / KMS corporativo. Cero secretos en repositorios Git (`SECURITY REQUIREMENT`).
- **Fencing Tokens:** Tokens criptográficos de 256 bits generados al asignar leases de folios; validados en cada sincronización para cerco inmediato (`403 LEASE_REVOKED`) de terminales desfasadas.
- **Cifrado Local:** Base de datos SQLite protegida mediante SQLCipher con llave de 256 bits derivada del OS Keyring (Windows DPAPI / Linux Keyring) ligada al dispositivo.

---

## 8. Peripheral and Payment Security Boundary (SR-08)

- **Objetivo de Seguridad en Pagos:** Los procesos de la aplicación TRIDENTPOS se mantendrán fuera del flujo de datos de tarjetas (`Cardholder Data Path`) siempre que la integración con la terminal bancaria lo soporte. Queda prohibido persistir PAN completo, CVV o datos de banda magnética. El alcance final de cumplimiento PCI depende de la integración técnica con la pasarela/PIN Pad y requiere validación formal de cumplimiento.
- **Impresoras ESC/POS:** Acceso exclusivo desde el proceso del Edge Host. Firewall local bloquea el tráfico directo desde terminales móviles o comensales hacia los puertos de impresión (TCP 9100).

---

## 9. Electron Runtime Security Baseline

- `contextIsolation = true` y `nodeIntegration = false` en todas las ventanas.
- Preload scripts mínimos con puente IPC tipado y lista blanca estricta de canales autorizados.
- Content Security Policy (CSP) restrictiva: `default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;`.
- Actualizaciones de software firmadas digitalmente (Code Signing Ed25519/RSA) con verificación de firma y hash SHA-512 previa a la instalación.

---

## 10. Layered Tamper-Evident Audit & Clock Protection (SR-04, SR-12)

- **Auditoría Local:** Encadenamiento criptográfico (Hash Chaining SHA-256) en `local_audit_trail` para detectar alteraciones accidentales, borrados parciales o desórdenes cronológicos.
- **Anclaje Externo (Cloud Checkpoint):** Puntos de control periódicos y confirmaciones de sincronización (`Cloud Sync ACK`) firmadas para detectar reescrituras globales de la base de datos local.
- **Riesgo Residual Documentado:** Un atacante con acceso total de escritura a SQLite antes de un anclaje externo podría potencialmente reescribir la historia no anclada; este riesgo se mitiga mediante anclajes frecuentes al cierre de cada transacción y turno.
- **Protección de Manipulación del Reloj (Clock Rollback):** Los temporizadores de sesión local y expiración de tokens utilizan contadores monotónicos del proceso (`process.hrtime()` / monotonic clocks). La detección de retrasos significativos en el reloj del sistema operativo dispara una alerta de auditoría y no extiende la vigencia de credenciales offline.

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
