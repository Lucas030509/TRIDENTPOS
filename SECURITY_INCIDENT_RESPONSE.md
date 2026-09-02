# SECURITY INCIDENT RESPONSE PLAYBOOKS — ERP RESTAURANTES

**Document ID:** `ARCH-IRP-001`  
**Version:** `1.0 DRAFT`  
**Status:** `READY FOR INDEPENDENT REVIEW`  
**Date:** 2026-09-01  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Author Agent:** `08_Security_Architect`  
**Approved Baseline Commit:** `9d076c1a8f674b2411991b20fa4faa83b85f708a` (Tag `data-architecture-v1.0-approved`)  

---

## 1. Catálogo de 10 Playbooks de Respuesta a Incidentes de Seguridad

| ID Incidente | Escenario de Compromiso | Detección | Contención Inmediata | Erradicación y Rotación | Recuperación y Lecciones |
|---|---|---|---|---|---|
| **IRP-01** | **Cuenta de Empleado / PIN Comprometido** | Anomalía en comanda o reporte de empleado | Revocación de credencial en Cloud (`is_revoked = true`) | Incremento de `credential_version` y empuje de delta a Edge | Reasignación de nuevo PIN salteado en sucursal |
| **IRP-02** | **Credencial de Gerente / Supervisor Filtrada** | Múltiples autorizaciones en sucursales distintas | Cierre forzoso de sesiones activas en Cloud y Edge | Invalidation inmediata de tokens de supervisor y rotación de PIN | Auditoría forense de cancelaciones y descuentos en las últimas 24h |
| **IRP-03** | **Robo Físico de Servidor Edge Host en Sucursal** | Pérdida de comunicación o reporte de siniestro | Cloud revoca el Lease activo (`status = REVOKED`) | Incremento inmediato de época (`ep_n+1`), nuevo fencing token | Aprovisionamiento de nuevo hardware con rango de folios limpio (`TurnoDeAjustePorContingencia`) |
| **IRP-04** | **Sospecha de Fuga de Datos Multi-Tenant** | Alerta en logs RLS o reporte de usuario | Bloqueo temporal del endpoint afectado en WAF | Corrección inmediata de política RLS o consulta SQL | Notificación a clientes afectados conforme a normativa de privacidad |
| **IRP-05** | **Fuga de Secreto de Integración (Uber/Rappi)** | Alerta de escaneo de secretos o tráfico anómalo | Inhabilitación temporal del conector en Cloud | Generación de nuevo secreto en el portal del agregador y actualización en Vault | Reanudación de ingesta y descarte de pedidos no conciliados |
| **IRP-06** | **Compromiso de Certificado CSD / Llave Fiscal** | Facturación no reconocida ante el SAT | Notificación al PAC y revocación formal del CSD en SAT | Carga de nuevo certificado CSD tramitado por el contribuyente | Re-auditoría de folios fiscales y reconciliación contable |
| **IRP-07** | **Ataque Masivo de Webhooks Falsificados** | Picos de firmas HMAC inválidas en WAF | Bloqueo automático de IP origen en Cloud WAF | Verificación de rotación de llave de webhook de agregadores | Limpieza de colas de reintento |
| **IRP-08** | **Acceso Cross-Tenant por Error de Configuración**| Detección en trazas de Sentry | Aislamiento inmediato de conexión pooling afectada | Forzado de `SET LOCAL` estricto en middleware de base de datos | Verificación de aislamiento en backups |
| **IRP-09** | **Compromiso de Dependencia en Build (Supply Chain)** | Alerta en escáner SCA de CI/CD | Retiro inmediato del release del canal de distribución | Rollback a versión segura previa y actualización de lockfile | Despliegue de parche firmado obligatorio |
| **IRP-10** | **Ransomware o Corrupción Local en Sucursal** | Bloqueo de arranque de Edge Host | Aislamiento de la red LAN de la sucursal | Formateo del hardware o sustitución física | Bootstrap completo desde Cloud bajo nueva época (`ep_n+1`) |

---

DOCUMENT STATUS: READY FOR INDEPENDENT REVIEW
