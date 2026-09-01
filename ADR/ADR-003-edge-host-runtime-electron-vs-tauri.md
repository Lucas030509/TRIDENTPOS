# ADR-003: Selección del Runtime del Edge Host en Sucursal (Electron/Node vs. Tauri/Rust)

**Status:** `ACCEPTED WITH VALIDATION REQUIRED`  
**Date:** 2026-09-01  
**Owners:** `01_Solution Architect`  
**Related documents:** `TECH_STACK_DECISIONS.md`, `DEPLOYMENT_TOPOLOGY.md`, `ARCHITECTURE_RISKS.md`  

---

## 1. Context
La terminal principal de la sucursal actúa simultáneamente como punto de venta (POS) y servidor de red local (Edge Host) para coordinar KDS, comanderos móviles, impresoras térmicas ESC/POS y cajones de dinero.

## 2. Problem
Se requería seleccionar el runtime de escritorio evaluando el compromiso entre velocidad de desarrollo, consumo de memoria y acceso a periféricos POS en el mercado latinoamericano.

## 3. Architectural Drivers
- Velocidad de salida al mercado y reutilización de modelos TypeScript.
- Compatibilidad amplia con impresoras térmicas, básculas y lectores seriales/USB.
- Capacidad de operar en hardware de bajo costo.

## 4. Options Considered
### Option A: Electron / Node.js (TypeScript) — *Baseline Seleccionado*
- *Pros:* Ecosistema npm maduro para drivers de hardware (`node-escpos`, `serialport`, `raw-socket`), unificación del lenguaje con el backend Cloud y alta velocidad de iteración.
- *Cons:* Mayor consumo de memoria RAM (*INDUSTRY ESTIMATE: ~150–300 MB — NOT PROJECT BENCHMARKED*).
- *Risks:* Posible degradación en terminales antiguas con <= 2 GB RAM.

### Option B: Tauri / Rust — *Alternativa de Optimización Futura*
- *Pros:* Consumo mínimo de memoria (*INDUSTRY ESTIMATE: ~30–60 MB — NOT PROJECT BENCHMARKED*) y binarios compactos.
- *Cons:* Menor disponibilidad de librerías nativas para periféricos POS locales y mayor tiempo de desarrollo.
- *Risks:* Curva de aprendizaje y duplicación de modelos entre Rust y TypeScript.

## 5. Decision
Se adopta **Electron / Node.js como Baseline de Arquitectura** para el Edge Host, estableciendo como directriz formal: `FINAL EDGE RUNTIME CERTIFICATION REQUIRES BENCHMARK ON TARGET POS HARDWARE.` Tauri / Rust se mantiene como alternativa de optimización si los benchmarks en hardware de baja gama demuestran saturación.

## 6. Rationale
La reutilización directa de validadores Zod, esquemas y tipos TypeScript entre Cloud y Edge reduce drásticamente el tiempo de desarrollo y los defectos de integración, mientras que el ecosistema npm resuelve la integración física con hardware POS de forma inmediata.

## 7. Consequences
### Positive
- Desarrollo unificado en TypeScript en toda la suite.
- Integración inmediata con periféricos comerciales.
### Negative
- Mayor consumo de recursos que una solución nativa en Rust/C++.
### Operational
- Empaquetado multiplataforma estándar (Windows, Linux, macOS).

## 8. Failure Modes
- Bloqueo del hilo principal de Electron por operaciones de impresión sincrónicas. Mitigación: El Edge Server ejecuta el servicio de hardware y WebSockets en un proceso Worker independiente desacoplado del renderer.

## 9. Security Considerations
- Context isolation activado en Electron; desactivación de `nodeIntegration` en ventanas de UI.

## 10. Observability Requirements
- Telemetría de consumo de memoria y CPU reportada periódicamente a Sentry.

## 11. Validation / Evidence Required
- Ejecución de pruebas de estrés (*load & longevity test*) en hardware POS objetivo representativo.

## 12. Revisit Triggers
- Pruebas de benchmark que demuestren saturación sostenida de memoria (>80%) en hardware POS de 2 GB RAM.

## 13. Traceability
- Atiende: REM-08.
- SSOT: `TECH_STACK_DECISIONS.md v1.3`.
