# ADR-001: Adopción del Patrón Monolito Modular con Bounded Contexts Fuertes

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Cloud Control Plane / Backend Architecture  

---

## Contexto y Planteamiento del Problema
`ERP RESTAURANTES` está compuesto por 11 módulos funcionales (Platform Core, TRIDENTPOS, Inventory, Procurement, Finance, Billing, CRM, Delivery, Loyalty, Analytics, Integrations). Se requería decidir el estilo arquitectónico del backend en la nube para maximizar la velocidad de desarrollo, garantizar el desacoplamiento de dominio y evitar la sobrecarga operacional y de red asociada a una infraestructura de microservicios distribuida prematura.

## Decisión
Se adopta el patrón **Modular Monolith (Monolito Modular)** para el backend del Cloud Control Plane:
1. Cada uno de los 11 módulos se estructura como un paquete de código aislado con su propio modelo de dominio, servicios de aplicación y API pública (Comandos, Consultas y Eventos).
2. Queda estrictamente prohibida la invocación directa a estructuras internas o consultas a tablas privadas de otro módulo sin pasar por su contrato funcional público.
3. La comunicación sincrónica interna se realiza a través de interfaces fuertemente tipadas en memoria; la comunicación asincrónica inter-módulo que no puede perderse utiliza persistencia durable (Transactional Outbox en PostgreSQL).

## Consecuencias
### Positivas
- Despliegue atómico simplificado en Render como un único servicio backend, reduciendo costos de infraestructura y complejidad de monitoreo.
- Consistencia transaccional simplificada y eliminación de la latencia de llamadas HTTP/gRPC entre módulos.
- Preservación de la independencia funcional: los límites de dominio limpios permiten extraer cualquier módulo a un microservicio autónomo en el futuro si su volumen de tráfico lo exige.

### Compromisos y Mitigaciones
- Riesgo de acoplamiento accidental por importaciones directas entre módulos. *Mitigación:* Se implementarán reglas de linting arquitectónico en el pipeline de CI/CD para rechazar violaciones de encapsulamiento.
