# SECURITY RISKS AND FINDINGS MATRIX — ERP RESTAURANTES

**Document ID:** `ARCH-SRSK-001`  
**Version:** `1.2 REMEDIATED DRAFT (R2.1)`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-02  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect — Remediation Author`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Matriz de Hallazgos y Riesgos de Seguridad

| ID | Hallazgo / Amenaza | Severidad | Disposición Arquitectónica | Estado de Validación | Mitigación Arquitectónica de Seguridad | Riesgo Residual Esperado |
|---|---|---|---|---|---|---|
| **SEC-01** | **Fuga de Datos Multi-Tenant en Consultas Analíticas** | CRÍTICA | `ARCHITECTURALLY RESOLVED` | `PENETRATION VALIDATION REQUIRED` | RLS mandatorio en PostgreSQL + Claves foráneas compuestas con `organization_id` + Default Deny. | Se espera reducción significativa tras verificación de aislamiento en CI/CD. |
| **SEC-02** | **Fuerza Bruta de PIN en Terminales POS Desatendidas** | ALTA | `ARCHITECTURALLY RESOLVED` | `PENETRATION VALIDATION REQUIRED` | Argon2id salted hashes + Demoras progresivas exponenciales + Bloqueo temporal tras 5 fallos con alerta auditada. | Se espera reducción efectiva; severidad residual empírica sujeta a pruebas de fuerza bruta. |
| **SEC-03** | **Suplantación de Identidad de Edge Server vía mDNS** | ALTA | `ARCHITECTURALLY RESOLVED` | `PENETRATION VALIDATION REQUIRED` | Protocolo de enrolamiento con QR vinculando `edgePublicKeyFingerprint` previo al envío del secreto (*Discovery is not Trust*). | Mitigado por diseño criptográfico; requiere validación en pruebas de penetración LAN. |
| **SEC-04** | **Reaparición de Host Zombie Reemplazado** | ALTA | `ARCHITECTURALLY RESOLVED` | `IMPLEMENTATION VALIDATION REQUIRED`| Protocolo de Lease con épocas estrictamente monotónicas (`ep_n+1`) y tokens de fencing; rechazo inmediato con `403 LEASE_REVOKED`. | Mitigado por diseño de protocolo; requiere validación de simulación de contingencia. |
| **SEC-05** | **Exfiltración de Credenciales Fiscales CSD o Agregadores** | CRÍTICA | `ARCHITECTURALLY RESOLVED` | `PENETRATION VALIDATION REQUIRED` | Envelope Encryption (AES-256-GCM) con llaves gestionadas en Secret Vault / KMS corporativo; cero secretos en Git. | Mitigado por diseño; requiere verificación de escaneo de secretos y logs. |
| **SEC-06** | **Manipulación de Bitácora de Auditoría Local en Borde** | ALTA | `ARCHITECTURALLY RESOLVED` | `IMPLEMENTATION VALIDATION REQUIRED`| Encadenamiento criptográfico (Hash Chaining SHA-256) en `local_audit_trail` + Puntos de control periódicos en Cloud. | La reescritura total previa al anclaje en Cloud constituye un riesgo residual documentado pendiente de aceptación formal por autoridad autorizada. |
| **SEC-07** | **Inyección de Código Malicioso en Electron (IPC)** | ALTA | `ARCHITECTURALLY RESOLVED` | `PENETRATION VALIDATION REQUIRED` | `contextIsolation = true`, `nodeIntegration = false`, CSP estricta y lista blanca de métodos IPC tipados. | Mitigado por diseño; requiere análisis estático SAST en release. |
| **SEC-08** | **Impacto de Rendimiento de Argon2id en POS de Gama Baja**| MEDIA | `ARCHITECTURAL GAP` | `HARDWARE BENCHMARK REQUIRED` | Parámetros estándar ajustables según hardware ($m=64\text{ MB}$ base, $m=32\text{ MB}$ contingencia). | Riesgo operativo medio hasta completar benchmark en hardware POS real ($\le 2\text{ GB}$ RAM). |

---

## 2. Declaración de Estado de Hallazgos Críticos y Altos
En cumplimiento estricto de las reglas de normalización EAAF v1.2:
- **Hallazgos Críticos (`SEC-01`, `SEC-05`):** `ARCHITECTURALLY RESOLVED` (Sujetos a `VALIDATION REQUIRED`).
- **Hallazgos Altos (`SEC-02`, `SEC-03`, `SEC-04`, `SEC-06`, `SEC-07`):** `ARCHITECTURALLY RESOLVED` (Sujetos a `VALIDATION REQUIRED`).
- **Bloqueos de Diseño Arquitectónico Pendientes:** `0` (Cero).

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
