# ADR-003: Selección del Runtime del Edge Host en Sucursal (Electron/Node vs. Tauri/Rust)

**Estado:** APROBADA  
**Fecha:** 2026-08-31  
**Autor:** `01_Solution Architect`  
**Alcance:** Branch Operational Plane / Edge Host Architecture  

---

## Contexto y Planteamiento del Problema
La estación principal de la sucursal debe actuar simultáneamente como terminal de cobro (POS) y servidor de red local (Edge Host) para despachar APIs, WebSockets y controlar impresoras térmicas ESC/POS, cajones de dinero y básculas. Se requiere seleccionar el runtime de escritorio evaluando el compromiso entre velocidad de desarrollo, consumo de memoria y acceso a periféricos.

## Alternativas Evaluadas
1. **Alternativa A: Electron / Node.js (Baseline Seleccionado):**
   - *Ventajas:* Ecosistema npm maduro para drivers de hardware (serialport, node-escpos, raw-socket), unificación del lenguaje (TypeScript) con el backend Cloud, y alta velocidad de iteración.
   - *Desventajas:* Mayor consumo de memoria RAM (~150-300 MB) debido al runtime V8 y Chromium embebido.
2. **Alternativa B: Tauri / Rust (Alternativa de Alto Rendimiento):**
   - *Ventajas:* Consumo mínimo de memoria (~30-60 MB) y tamaño de binario reducido (< 20 MB).
   - *Desventajas:* Mayor complejidad de desarrollo, curva de aprendizaje en Rust y menor disponibilidad de librerías listas para periféricos de punto de venta específicos de Latinoamérica.

## Decisión
Se adopta **Electron / Node.js como Baseline de Arquitectura** para el Edge Host, con las siguientes directrices:
1. Se estructura el código del host desacoplando la lógica de servicios del renderer de UI para permitir ejecución en modo headless o con ventana de caja.
2. Se mantiene **Tauri / Rust como alternativa de optimización futura** en caso de que los benchmarks en hardware de ultra-baja gama (<= 2 GB RAM) muestren saturación de memoria en pruebas de carga.

## Consecuencias
### Positivas
- Máxima reutilización de tipos, validadores de esquemas y modelos de dominio TypeScript entre Cloud y Edge.
- Rápida integración con el 99% de impresoras térmicas y básculas mediante paquetes estándar probados.

### Compromisos y Mitigaciones
- Mayor huella de memoria en la máquina host. *Mitigación:* Se establece como baseline provisional que el equipo Edge Server cuente con al menos 4 GB de RAM (recomendado 8-16 GB).
