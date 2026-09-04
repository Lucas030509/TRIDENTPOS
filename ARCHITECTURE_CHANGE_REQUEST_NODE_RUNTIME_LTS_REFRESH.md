# ARCHITECTURE CHANGE REQUEST: NODE.JS LTS RUNTIME REFRESH (ACR-2026-004)

**Document ID:** `ACR-2026-004`  
**Title:** Node.js LTS Runtime Baseline Refresh Before WP-001  
**Change Classification:** `SURGICAL ARCHITECTURE / IMPLEMENTATION BASELINE MAINTENANCE`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Repository:** [TRIDENTPOS](https://github.com/Lucas030509/TRIDENTPOS.git)  
**Date:** `2026-09-04`  
**Author Authority:** `01_Solution_Architect — ARCHITECTURE CHANGE AUTHOR`  
**Governing ADR:** [`ADR/ADR-011-nodejs-lts-runtime-baseline.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/ADR/ADR-011-nodejs-lts-runtime-baseline.md)  
**Canonical Pre-Change Main SHA:** `287a223e387771c10b891672469ed964ecdc0568`  

---

## 1. Justificación y Análisis de Causa Raíz

Durante la auditoría técnica previa al inicio de `WP-001` (Monorepo Structure & Build Tooling), se identificó una inconsistencia de ciclo de vida en la línea base congelada de dependencias:
* En [`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md) (WP-001, WP-007 y Sec. 13.1), se fijó la dependencia técnica como `Node.js 20 LTS`.
* De acuerdo con el calendario oficial de soporte upstream de la OpenJS Foundation, **Node.js 20 alcanzó su fecha de fin de vida (End-of-Life / EOL) en 2026**.
* El mantenimiento activo upstream de parches de seguridad para Node.js 20 ha cesado, lo que implica que cualquier vulnerabilidad crítica futura no recibirá parche upstream.
* **Node.js 24 LTS** es la versión Long Term Support mantenida actualmente, con soporte oficial garantizado hasta **abril de 2028**.

Iniciar la implementación de un producto nuevo sobre un runtime EOL viola los principios de seguridad de la cadena de suministro (`SUPPLY_CHAIN_SECURITY.md`). Por tanto, se propone esta actualización quirúrgica antes de crear el primer artefacto de código (`package.json` / `WP-001`).

---

## 2. Alcance y Límites del Cambio Propuesto

### Lo que se ACTUALIZA:
1. El runtime y toolchain de Node.js se actualiza de **Node.js 20 LTS** a **Node.js 24 LTS** para:
   - Toolchain del monorepo (`npm workspaces`, `Turborepo`).
   - Herramientas compartidas de TypeScript (`tsc`, `eslint`, `prettier`).
   - Entornos locales de desarrollo y build de los desarrolladores.
   - Build y runtime del Cloud Backend en Render.

### Lo que permanece ESTRICTAMENTE INALTERADO:
1. **Paradigma de Arquitectura:** Monolito Modular con 11 contextos acotados (`ADR-001`).
2. **Frameworks de Aplicación:** Fastify / Express para backend, Next.js 14 / React para Backoffice Web, React Native / Expo para Móvil.
3. **Persistencia:** PostgreSQL 16 en Supabase, SQLite en Edge (`ADR-004`).
4. **Edge Host:** Electron con TypeScript (`ADR-003`), manteniendo la distinción explícita de runtime embebido.
5. **Work Packages & DAG:** Los 28 paquetes de trabajo y sus relaciones de precedencia permanecen exactamente iguales.
6. **Políticas de Cadena de Suministro:** `npm ci`, `package-lock.json` versionado, SCA scanning, escaneo de secretos y SBOM permanecen obligatorios.
7. **Stage A:** Permanece verificado y activo en `main` (`287a223e...`).

---

## 3. Matriz de Control y Evaluación (NODE-LTS-01 a NODE-LTS-12)

| Control ID | Dimensión Evaluada | Estado Anterior (Línea Base) | Estado Propuesto (ACR-2026-004) | Veredicto / Impacto |
|---|---|---|---|---|
| **`NODE-LTS-01`** | Runtime Planificado Actual | Node.js 20 LTS | Node.js 24 LTS | **ACTUALIZADO** |
| **`NODE-LTS-02`** | Estatus Upstream | End-of-Life (EOL) | Active / Maintenance LTS (hasta abril 2028) | **REMEDIADO** |
| **`NODE-LTS-03`** | Parches de Seguridad Upstream | No disponibles (EOL) | Disponibles y mantenidos por OpenJS Foundation | **SEGURO** |
| **`NODE-LTS-04`** | Alternativa LTS Mantenida | Ninguna (Node 20 obsoleto) | Node.js 24 LTS adoptado como estándar | **CONFORME** |
| **`NODE-LTS-05`** | Paradigma de Arquitectura | Monolito Modular / TypeScript | Exactamente el mismo paradigma | **INALTERADO** |
| **`NODE-LTS-06`** | Distinción con Electron | No claramente diferenciado | Distinción explícita: Electron gobierna su Node embebido | **CLARIFICADO** |
| **`NODE-LTS-07`** | Deuda de Addons Nativos | No auditada en Node 24 | Módulos nativos (`better-sqlite3`, `serialport`) catalogados como `VALIDATION REQUIRED` | **GOBERNADO** |
| **`NODE-LTS-08`** | Controles de Cadena de Suministro | `npm ci`, lockfile, SCA | Totalmente preservados sin waivers | **INALTERADO** |
| **`NODE-LTS-09`** | DAG de Work Packages | 28 WPs en 10 waves | Exactamente los mismos 28 WPs y dependencias | **INALTERADO** |
| **`NODE-LTS-10`** | Decisiones PO Pendientes | 9 preguntas abiertas pendientes | Las 9 preguntas permanecen estrictamente PENDING | **PRESERVADO** |
| **`NODE-LTS-11`** | Deuda de Validación Técnica | `SEC-VAL-01..11`, etc. | Totalmente preservadas sin waivers | **PRESERVADO** |
| **`NODE-LTS-12`** | Estado de Stage A | Verificado y promovido en `main` | Permanece inalterado y activo (`287a223e...`) | **PRESERVADO** |

---

## 4. Auditoría y Clasificación de Referencias de Runtime en el Repositorio

Se realizó un escaneo exhaustivo de todas las menciones a runtimes de Node en el repositorio gobernado:

| Archivo Encontrado | Línea | Referencia Encontrada | Clasificación Semántica | Disposición en ACR-2026-004 |
|---|---|---|---|---|
| [`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md) | 152 | `Node.js 20 LTS (IMPLEMENTATION VERSION TO PIN)` (WP-001) | **A: Governing Current Baseline** | Actualizar a `Node.js 24 LTS` |
| [`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md) | 312 | `Dependencies: Electron 30+, Node.js 20 LTS` (WP-007) | **A: Governing Current Baseline** | Actualizar aclarando que Electron rige su runtime embebido y Node 24 rige el host/toolchain |
| [`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md) | 1072 | `Node.js 20 LTS: IMPLEMENTATION VERSION TO PIN` (Sec 13.1) | **A: Governing Current Baseline** | Actualizar a `Node.js 24 LTS` |
| [`TECH_STACK_DECISIONS.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/TECH_STACK_DECISIONS.md) | 17, 19, 28, 30, 41 | Menciones genéricas a `Node.js / TypeScript` | **A: Governing Context** | Añadir nota de clarificación de política LTS |
| [`ADR/ADR-003-edge-host-runtime-electron-vs-tauri.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/ADR/ADR-003-edge-host-runtime-electron-vs-tauri.md) | 1, 22, 33, 51 | `Electron / Node.js` genérico | **B: Historical Decision Baseline** | No requiere edición; preservado como contexto histórico |
| [`evidence/STAGE_A_PROTECTION_EVIDENCE.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/evidence/STAGE_A_PROTECTION_EVIDENCE.md) | 36 | Menciones a comandos locales `npm ci` | **B: Historical Evidence** | Intacto; no se reescribe evidencia histórica |

---

## 5. Análisis de Compatibilidad Técnica y Deuda de Validación

De acuerdo con el análisis de compatibilidad:
1. **Tooling Central (Compatible):** `npm workspaces`, `Turborepo`, `TypeScript 5.4+`, `ESLint`, `Prettier`, `Fastify` y `Next.js 14` soportan Node.js 24 LTS plenamente.
2. **Addons Nativos (VALIDATION REQUIRED):**
   - `better-sqlite3`: Requiere compilación contra Node.js 24 en desarrollo y contra los headers de Electron para el Edge. Se clasifica como **`VALIDATION REQUIRED`** en `WP-008`.
   - `serialport` y drivers de hardware POS: Módulos C++ para básculas e impresoras. Se clasifica como **`VALIDATION REQUIRED`** en `WP-015`.
   - Ecosistema de build de Electron (`@electron/rebuild`): Requiere validación de empaquetado nativo multiplataforma en `WP-007` y `WP-028`.
3. **Regla de Honestidad Técnica:** Ningún elemento con dependencias nativas se declara como compatible sin evidencia empírica de build en su respectivo Work Package.

---

## 6. Distinción Crítica: Runtime del Monorepo vs. Runtime Embebido de Electron

Este ACR establece formalmente la separación de capas de runtime:
* **Capa 1 (Sistema, Toolchain y Backend Cloud):** Gobernado universalmente por **Node.js 24 LTS**.
* **Capa 2 (Edge Host Electron):** Gobernado por la versión seleccionada y soportada de Electron (`ADR-003`). Electron empaqueta internamente su propio Node.js.
* No se permite ninguna versión de Electron cuyo runtime embebido o dependencias se encuentren fuera de soporte.
* La compatibilidad de hardware local del POS debe certificarse empíricamente en el hardware target antes de considerar completado el hardening en `WP-028`.

---

## 7. Plan de Transición e Impacto en WP-001

* **Estado de WP-001:** `WP-001` (Monorepo Structure & Build Tooling) continúa siendo el primer paquete de trabajo a ejecutar.
* **Bloqueo Preventivo:** `WP-001` **NO DEBE COMENZAR** hasta que este ACR (`ACR-2026-004`) y su respectivo `ADR-011` hayan recibido revisión de especialistas y la aprobación formal del Product Owner.
* **Acción Post-Aprobación en WP-001:** Al implementarse `WP-001`, el ejecutor (`18_DevOps_Engineer`) deberá fijar la versión exacta de Node.js 24 LTS en `package.json` (`engines.node = ">=24.0.0"`) y mediante el estándar de versionado del monorepo (`.nvmrc` o similar).

---

## 8. Preservación de Invariantes de Gobernanza

Este cambio:
1. **NO reabre Stage A:** Stage A permanece verificado y promovido en `main` (`287a223e387771c10b891672469ed964ecdc0568`).
2. **NO modifica branch protection:** La configuración de Classic Branch Protection (0 approvals, admins enforced) permanece intacta.
3. **NO cierra ninguna de las 9 preguntas abiertas del Product Owner** (`OQ-SSOT-01..07`, `OQ-ARCH-01..02`).
4. **NO condona ni modifica la deuda técnica de validación congelada** (`SEC-VAL-01..11`, `DAT-04`, `DAT-08`, `RSK-08`, `RSK-11`, `RSK-15`).
5. **NO altera el DAG de 28 Work Packages.**

---

## 9. Veredicto del Autor y Siguientes Pasos

El Solution Architect autor concluye que la remediación es técnicamente sólida, segura y necesaria para evitar el inicio de la implementación sobre un runtime EOL.

```text
NODE RUNTIME LTS REFRESH:
READY FOR ROLE-SEPARATED REVIEW
```

**Revisores de Especialidad Recomendados:**
* `10_DevOps_Platform_Architect` (Revisión de arquitectura de build, monorepo y compatibilidad de toolchain).
* `08_Security_Architect` (Revisión de seguridad de cadena de suministro y superficie de ataque del runtime).
