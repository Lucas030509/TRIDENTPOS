# TECH STACK DECISIONS & RUNTIME EVALUATION — ERP RESTAURANTES

**Document ID:** `ARCH-STK-001`  
**Version:** `1.3 NORMALIZED / REMEDIATED`  
**Status:** `APPROVED / FROZEN`  
**Date:** 2026-09-01  
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
| **Base de Datos en Borde** | SQLite 3 (Modo WAL) | Motor embebido de cero administración con transacciones ACID y lecturas concurrentes sin bloqueo. |
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
- **Dependencia de Hardware:** Requiere almacenamiento de estado sólido (SSD/eMMC) y respaldo eléctrico (UPS) en la sucursal para evitar pérdida de escrituras en caché volátil ante cortes de energía.
- **Certificación Requerida:** `REQUIRES HARDWARE POWER-LOSS VALIDATION.`

---

DOCUMENT STATUS: APPROVED / FROZEN — 2026-09-01
