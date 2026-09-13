# TECH STACK DECISIONS & RUNTIME EVALUATION — ERP RESTAURANTES

> [!NOTE]
> **ACR-2026-013 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**
> 
> Proposed amendment under `ACR-2026-013`: Ratification of Edge SQLite exact fixed-point signed integer storage (`INTEGER` scale 4, `ADR-012`) and the 4-layer monorepo package composition model (`ADR-013`). Pending formal review and Product Owner approval.

**Document ID:** `ARCH-STK-001`  
**Version:** `1.4 PROPOSED OVERLAY — ACR-2026-013` (Underlying baseline: `v1.3 APPROVED / FROZEN — 2026-09-01`)  
**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`  
**Date:** 2026-09-13  
**Baseline:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Supersedes:** `TECH_STACK_DECISIONS.md v1.1`  

---

## 1. Stack Tecnológico de Referencia

| Capa / Componente | Tecnología Seleccionada | Justificación Arquitectónica |
|---|---|---|
| **Cloud Web Presentation** | Next.js / React (TypeScript) en Vercel | Renderizado híbrido SSR/SSG para portal administrativo y optimización global de assets estáticos. |
| **Cloud Backend & Sync** | Node.js (Node 24 LTS, ADR-011) / TypeScript (Express / Fastify) en Render | Ejecución del Monolito Modular con tipado estricto compartido y soporte para workers en segundo plano. |
| **Base de Datos Central** | PostgreSQL multi-tenant en Supabase | Integridad transaccional ACID, soporte de Row-Level Security (RLS) y notificaciones `LISTEN / NOTIFY` para el outbox. |
| **Edge Host Runtime** | Electron / Node.js (TypeScript) — *Baseline Actual* | Ecosistema probado para drivers de periféricos (ESC/POS, serial, básculas), reutilización 100% de tipos TypeScript con Cloud. Runtime embebido gobernado por Electron (`ADR-011`). |
| **Base de Datos en Borde** | SQLite 3 (Modo WAL) con enteros fixed-point escala 4 (`ADR-012`) | Motor embebido de cero administración con transacciones ACID, lecturas concurrentes sin bloqueo y aritmética exacta libre de punto flotante. |
| **Arquitectura de Monorepo** | Monolito Modular en 4 Capas con Raíces de Composición (`ADR-013`) | Separación estricta entre Kernel (`@trident/core`), Dominios de negocio puros, Adaptadores de Infraestructura técnica y Raíces de Composición ejecutables. |
| **Comunicaciones LAN** | HTTP REST (Comandos) + WebSockets `ws` (Push) | Mínima sobrecarga de red y actualización en tiempo real de pantallas KDS y comanderos. |
| **Monitoreo & Telemetría** | Sentry Cloud + Buffer Local Offline | Trazabilidad de excepciones, detección de degradación en sincronización y monitoreo de periféricos. |

*Nota de Gobernanza de Runtime (ADR-011 / ACR-2026-004):* El toolchain del monorepo y el Cloud Backend adoptan formalmente Node.js 24 LTS como baseline activo, prohibiendo el uso de versiones upstream EOL. El runtime embebido en el Edge Host se gobierna por la versión de Electron seleccionada.

---

## 2. Comparativa Cualitativa y Técnica de Runtimes en Borde (REM-08)

Se evaluó la selección del runtime para el Edge Server en sucursal entre **Electron / Node.js** (Baseline Seleccionado) y **Tauri / Rust** (Alternativa de Optimización):

| Dimensión de Evaluación | Electron / Node.js (Baseline Actual) | Tauri / Rust (Alternativa de Optimización) |
|---|---|---|
| **Consumo de Memoria RAM** | *Estimación de industria:* ~150–300 MB (*INDUSTRY ESTIMATE — NOT PROJECT BENCHMARKED*). | *Estimación de industria:* ~30–60 MB (*INDUSTRY ESTIMATE — NOT PROJECT BENCHMARKED*). |
| **Tamaño de Instalador** | *Estimación de industria:* ~80–120 MB (*INDUSTRY ESTIMATE — NOT PROJECT BENCHMARKED*). | *Estimación de industria:* ~10–20 MB (*INDUSTRY ESTIMATE — NOT PROJECT BENCHMARKED*). |
| **Acceso a Periféricos POS** | Librerías npm maduras y probadas para ESC/POS (`node-escpos`, `serialport`, `raw-socket`), básculas y cajones RJ11. | Requiere bindings FFI en Rust o reimplementación de protocolos de comunicación serial para modelos de hardware específicos. |
| **Reutilización de Código** | Reutilización directa del 100% de esquemas Zod, tipos de dominio TypeScript y validadores entre Cloud y Edge. | Requiere mantener modelos de datos duales en Rust (Edge) y TypeScript (Cloud/Frontend). |
| **Velocidad de Iteración** | Muy alta. El equipo unifica el stack completo en TypeScript. | Moderada / Baja. Curva de aprendizaje y gestión de memoria estricta en Rust. |
| **Mantenibilidad & Upgrades** | Actualizaciones automáticas con `electron-updater` estándar. | Actualizaciones ligeras mediante Tauri updater nativo. |
| **Soporte Multiplataforma** | Soporte robusto en Windows 10/11, Ubuntu/Debian Linux y macOS. | Soporte multiplataforma dependiente del WebView del sistema operativo (WebView2 en Windows, WebKitGTK en Linux). |

### Decisión y Directiva de Certificación (REM-08)
1. Se ratifica **Electron / Node.js como Baseline de Arquitectura** para maximizar la velocidad de entrega y garantizar compatibilidad inmediata con el ecosistema de hardware POS de Latinoamérica.
2. **Clasificación de Métricas:** Las cifras de consumo de memoria y tamaño de binario corresponden a estimaciones estándar de la industria y no a mediciones empíricas del proyecto.
3. **Directiva Obligatoria:** `FINAL EDGE RUNTIME CERTIFICATION REQUIRES BENCHMARK ON TARGET POS HARDWARE.` En caso de que pruebas de carga en terminales de muy bajos recursos (<= 2 GB RAM) evidencien saturación, se activará la migración del módulo Edge Host a Tauri/Rust.

---

## 3. Durabilidad del Almacenamiento Local (SQLite 3 WAL) (REM-07)

- **Configuración:** `PRAGMA journal_mode = WAL;` con `PRAGMA synchronous = NORMAL;` para operaciones operativas y `PRAGMA synchronous = FULL;` para cierres de turno y Cortes Z.
- **Representación Numérica (`ADR-012`):** Todos los campos monetarios, impuestos y cantidades se almacenan como `INTEGER` con escala fija 4 ($10^4 = 10,000$). Punto flotante (`REAL` / `FLOAT`) estrictamente prohibido.
- **Dependencia de Hardware:** Requiere almacenamiento de estado sólido (SSD/eMMC) y respaldo eléctrico (UPS) en la sucursal para evitar pérdida de escrituras en caché volátil ante cortes de energía.
- **Certificación Requerida:** `REQUIRES HARDWARE POWER-LOSS VALIDATION.`

---

## 4. Topología de Monorepo y Modelo de Composición (`ADR-013`)

- **Estructura en 4 Capas:**
  1. *Capa 1 (Kernel):* `@trident/core` (contratos, capabilities, Value Objects como `Money`).
  2. *Capa 2 (Dominios de Negocio):* `@trident/pos`, `@trident/inventory`, etc. Dependen únicamente de `@trident/core`. Jamás se importan entre sí ni importan infraestructura técnica.
  3. *Capa 3 (Infraestructura Técnica):* `@trident/database`, `@trident/edge`, `@trident/sync`, `@trident/ui`. Dependen de `@trident/core`.
  4. *Capa 4 (Raíces de Composición):* `@trident/pos-edge-runtime` (Fastify LAN + ensamblado SQLite/outbox en Edge), `@trident/cloud-server` (Cloud API Gateway + Modular Monolith root).
- **Invariante de Aislamiento:** Dominios puros e independientes de la tecnología de persistencia; raíces de composición asépticas sin lógica de negocio propia.

---

DOCUMENT STATUS:
- Canonical Baseline v1.3: APPROVED / FROZEN — 2026-09-01
- ADR-011 Proposed Amendment: PROPOSED — PENDING ROLE-SEPARATED REVIEW & PRODUCT OWNER APPROVAL
- ACR-2026-013 (ADR-012, ADR-013) Proposed Amendment: PROPOSED — PENDING GOVERNANCE APPROVAL
