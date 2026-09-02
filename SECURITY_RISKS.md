# SECURITY RISKS AND FINDINGS MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-SRSK-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Matriz de Hallazgos y Riesgos de Seguridad

| ID | Hallazgo / Amenaza | Severidad | Estado | Mitigación Arquitectónica de Seguridad | Validación Requerida en Pruebas | Riesgo Residual |
|---|---|---|---|---|---|---|
| **SEC-01** | **Fuga de Datos Multi-Tenant en Consultas Analíticas** | CRÍTICA | RESOLVED (By Design) | RLS mandatorio en todas las tablas de PostgreSQL + Claves foráneas compuestas con `organization_id` + Default Deny. | Pruebas de inyección multi-tenant automatizadas en CI/CD. | Muy Bajo |
| **SEC-02** | **Fuerza Bruta de PIN en Terminales POS Desatendidas** | ALTA | RESOLVED (By Design) | Argon2id salted hashes + Demoras progresivas exponenciales + Bloqueo temporal tras 5 fallos con alerta auditada. | Pruebas de simulación de fuerza bruta en Edge Host. | Muy Bajo |
| **SEC-03** | **Suplantación de Identidad de Edge Server vía mDNS** | ALTA | RESOLVED (By Design) | Principio *Discovery is not Trust*: Certificados TLS locales verificados con huella digital fija durante el enrolamiento de terminales. | Pruebas de penetración LAN con falso servidor mDNS. | Bajo |
| **SEC-04** | **Reaparición de Host Zombie Reemplazado** | ALTA | RESOLVED (By Design) | Protocolo de Lease con épocas estrictamente monotónicas (`ep_n+1`) y tokens de fencing; rechazo inmediato con `403 LEASE_REVOKED`. | Simulación de desastre con reactivación de nodo antiguo. | Muy Bajo |
| **SEC-05** | **Exfiltración de Credenciales Fiscales CSD o Agregadores** | CRÍTICA | RESOLVED (By Design) | Envelope Encryption (AES-256-GCM) con llaves gestionadas en Secret Vault / KMS corporativo; cero secretos en Git. | Auditoría de escaneo de secretos en repositorios y logs. | Muy Bajo |
| **SEC-06** | **Manipulación de Bitácora de Auditoría Local en Borde** | ALTA | RESOLVED (By Design) | Encadenamiento criptográfico (Hash Chaining SHA-256) en `local_audit_trail` para evidenciar cualquier manipulación física. | Prueba de alteración de registros SQLite y verificación de rotura. | Bajo |
| **SEC-07** | **Inyección de Código Malicioso en Electron (IPC)** | ALTA | RESOLVED (By Design) | `contextIsolation = true`, `nodeIntegration = false`, CSP estricta y lista blanca de métodos IPC tipados. | Análisis estático SAST y auditoría de configuración Electron. | Muy Bajo |
| **SEC-08** | **Impacto de Rendimiento de Argon2id en POS de Gama Baja**| MEDIA | PENDING BENCHMARK | Parámetros estándar ajustables según hardware ($m=64\text{ MB}$ base, $m=32\text{ MB}$ contingencia). | Benchmark de consumo de memoria y CPU en hardware POS real ($\le 2\text{ GB}$ RAM). | Medio (`VALIDATION REQUIRED`) |

---

## 2. Declaración de Estado de Hallazgos Críticos y Altos
En cumplimiento de las reglas EAAF v1.2:
- **Hallazgos Críticos (SEC-01, SEC-05):** `RESOLVED (By Design)`.
- **Hallazgos Altos (SEC-02, SEC-03, SEC-04, SEC-06, SEC-07):** `RESOLVED (By Design)`.
- **Bloqueos Críticos/Altos Pendientes:** `0` (Cero).

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
