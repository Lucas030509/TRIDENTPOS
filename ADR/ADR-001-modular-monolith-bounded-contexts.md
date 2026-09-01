# ADR-001: Adopción del Patrón Monolito Modular con Bounded Contexts Fuertes

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `FUNCTIONAL_ARCHITECTURE.md`, `MODULE_CATALOG.md`, `SOLUTION_ARCHITECTURE.md`  

---

## 1. Context
`ERP RESTAURANTES` está compuesto por 11 módulos funcionales (Platform Core, TRIDENTPOS, Inventory, Procurement, Finance, Billing, CRM, Delivery, Loyalty, Analytics, Integrations). Se requería decidir el estilo arquitectónico del backend en la nube para maximizar la velocidad de desarrollo, garantizar el desacoplamiento de dominio y evitar la sobrecarga operacional y de red asociada a una infraestructura de microservicios distribuida prematura.

## 2. Problem
La adopción prematura de microservicios distribuidos genera alta complejidad de red, latencia inter-servicio, costos de infraestructura elevados y dificultad para coordinar transacciones distribuidas. Por otro lado, un monolito tradicional no estructurado tiende a degradarse en un acoplamiento incontrolado (*Big Ball of Mud*).

## 3. Architectural Drivers
- `MODULAR BY DESIGN — INTEGRATED BY CONTRACT`.
- Capacidad de ejecutar la suite completa o módulos individuales sin dependencias runtime obligatorias.
- Simplicidad operativa para el despliegue en Render / Supabase.

## 4. Options Considered
### Option A: Microservicios Distribuidos
- *Pros:* Aislamiento físico de despliegue y escalamiento independiente por módulo.
- *Cons:* Sobrecarga de red, latencia HTTP/gRPC entre módulos, transacciones distribuidas complejas (Sagas/2PC) y costos operacionales elevados.
- *Risks:* Complejidad desproporcionada para la etapa inicial del producto.

### Option B: Monolito Modular (Modular Monolith) — *Seleccionada*
- *Pros:* Despliegue atómico simple en Render, invocación in-process de ultra-baja latencia entre módulos, consistencia transaccional y límites de dominio fuertemente encapsulados.
- *Cons:* Requiere disciplina estricta de código para evitar importaciones directas entre paquetes.
- *Risks:* Riesgo de acoplamiento si no se aplican reglas de linting arquitectónico automatizadas en CI/CD.

## 5. Decision
Se adopta el patrón **Modular Monolith (Monolito Modular)** para el backend del Cloud Control Plane. Cada uno de los 11 módulos se estructura como un paquete aislado con su propio modelo de dominio, servicios de aplicación y API pública (Comandos, Consultas y Eventos).

## 6. Rationale
El monolito modular proporciona el balance óptimo entre velocidad de desarrollo, costos operativos mínimos y preservación estricta de los límites de dominio, permitiendo extraer cualquier módulo a un servicio independiente en el futuro si la volumetría lo demanda.

## 7. Consequences
### Positive
- Despliegue simplificado como un único artefacto backend en Render.
- Eliminación de la sobrecarga de red en comunicaciones sincrónicas internas.
### Negative
- Requiere herramientas de análisis estático para garantizar el cumplimiento de contratos de paquete.
### Operational
- Monitoreo unificado en Sentry y despliegues atómicos sin coordinación de múltiples pipelines.

## 8. Failure Modes
- Si un desarrollador realiza una importación directa de una entidad privada de otro módulo, se genera acoplamiento oculto. Mitigación: Reglas de ESLint / Dependency Cruiser en el pipeline de CI/CD.

## 9. Security Considerations
- Aislamiento estricto de permisos mediante RBAC y contexto de tenant inyectado en cada invocación.

## 10. Observability Requirements
- Trazas de ejecución con OpenTelemetry / Sentry correlacionadas con `tenantId` y `traceId`.

## 11. Validation / Evidence Required
- Verificación en pipeline de CI/CD de cero violaciones de límites de paquetes modulares.

## 12. Revisit Triggers
- Saturación de CPU o I/O en un módulo específico (ej. Analytics o Integrations) que justifique su extracción a un microservicio independiente.

## 13. Traceability
- Atiende: Requerimiento de modularidad y bajo costo operativo.
- SSOT: `FUNCTIONAL_ARCHITECTURE.md v1.2`.
