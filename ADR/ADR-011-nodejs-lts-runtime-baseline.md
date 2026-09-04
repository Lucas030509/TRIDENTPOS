# ADR-011: Adopción de Node.js 24 LTS como Baseline de Runtime y Toolchain

## Metadata
* **ADR ID:** `ADR-011`
* **Title:** Adopción de Node.js 24 LTS como Baseline de Runtime y Toolchain del Monorepo
* **Status:** `PROPOSED — READY FOR ROLE-SEPARATED REVIEW` (NOT YET PRODUCT OWNER APPROVED)
* **Date:** `2026-09-04`
* **Author:** `01_Solution_Architect — ARCHITECTURE CHANGE AUTHOR`
* **Change Request:** `ACR-2026-004`
* **WP-001 Execution Status:** `TEMPORARILY BLOCKED PENDING ACR-2026-004 / ADR-011 APPROVAL`
* **Supersedes:** Node.js 20 LTS reference baseline in `IMPLEMENTATION_PLAN.md` (WP-001 / Sec 13.1)
* **Related ADRs:** `ADR-001` (Modular Monolith), `ADR-003` (Edge Host Runtime), `ADR-009` (Bootstrap Protocol), `ADR-010` (Solo Maintainer Model)

---

## 1. Contexto y Problemática

En la línea base de arquitectura congelada ([`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md) Sec. 3.1 y 13.1), se especificó:
> `Node.js 20 LTS (IMPLEMENTATION VERSION TO PIN)`

Una auditoría previa a la ejecución de `WP-001` (Monorepo Foundation) identificó el siguiente estado oficial upstream de Node.js:
* **Node.js 20:** Alcanzó formalmente el estado **End-of-Life (EOL) el 2026-03-24**. Ya no recibe parches de seguridad upstream ni correcciones de estabilidad críticas.
* **Node.js 24 (Codename *Krypton*):** A la fecha de este cambio arquitectónico se encuentra en fase **Active LTS**, con transición programada a **Maintenance LTS el 2026-10-20** y fecha programada de fin de vida upstream (**Scheduled Upstream EOL**) para el **2028-04-30** (fechas sujetas a ajustes del calendario de lanzamientos upstream de la OpenJS Foundation).

Iniciar la fase de implementación de un nuevo producto comercial en una versión de runtime upstream que ya se encuentra en EOL constituye una vulneración directa a los principios de seguridad de la cadena de suministro ([`SUPPLY_CHAIN_SECURITY.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/SUPPLY_CHAIN_SECURITY.md)), ya que expondría el software a vulnerabilidades no remediables (CVEs sin parche upstream) desde el primer commit de código.

---

## 2. Decisión de Arquitectura y Modelo de Versionado

Se decide adoptar **Node.js 24 LTS** como el baseline oficial de runtime y toolchain para el proyecto TRIDENTPOS:

### 2.1 Modelo de Versionado y Restricción de Runtime (Two-Tier Pinning)
1. **Restricción de Compatibilidad de Versión Mayor (Capa de Compatibilidad):**
   - El runtime de Node.js en el monorepo y Cloud Backend debe permanecer estrictamente en la línea mayor `24.x`.
   - La restricción en el `package.json` raíz se define como:
     ```json
     "engines": {
       "node": ">=24.0.0 <25.0.0"
     }
     ```
   - Esta cláusula prohíbe explícitamente la ejecución sobre Node 20 o versiones anteriores (EOL), así como la promoción no planificada a futuras versiones mayores (`>=25`) sin un Architecture Change Request formal.
2. **Fijación Exacta de Reproducibilidad (Capa de Reproducibilidad):**
   - La cláusula `engines` actúa como restricción de compatibilidad, pero **no constituye por sí misma el pin de reproducibilidad exacta**.
   - Durante la ejecución de `WP-001`, el ejecutor (`18_DevOps_Engineer`) deberá seleccionar y fijar la versión exacta de parche de Node 24 LTS disponible y soportada al momento de la implementación mediante el mecanismo estándar de runtime del repositorio (`.nvmrc`, `.node-version` o Volta).
   - Ningún parche específico (ej. `24.20.0`) se congela arbitrariamente a nivel de arquitectura; el parche exacto se determinará y registrará en la evidencia de `WP-001`.
   - Los archivos de implementación (`package.json`, `.nvmrc`, lockfiles) **NO se crean en este paso arquitectónico**.

### 2.2 Ámbito de Aplicación de Node.js 24 LTS
- Toolchain del monorepo (`npm workspaces`, `Turborepo`).
- Compilación y ejecución de herramientas compartidas de TypeScript (`tsc`, `eslint`, `prettier`).
- Entornos de desarrollo local para desarrolladores (Windows, macOS, Linux).
- Build y runtime del Cloud Backend modular (Express / Fastify) en entornos de contenedores/servicios cloud (Render).
- Scripts de CI/CD ejecutados en GitHub Actions (cuando se configuren en `WP-002`).

### 2.3 Invarianza de Paradigmas de Arquitectura
Esta decisión es estrictamente de mantenimiento de baseline de runtime upstream. **NO modifica**:
- El paradigma de monorepo con `npm workspaces` y `Turborepo`.
- TypeScript 5.4+ con tipado estricto.
- La arquitectura de Monolito Modular de 11 contextos acotados (`ADR-001`).
- La selección de bases de datos (PostgreSQL 16 en Supabase, SQLite con WAL en Edge).
- Los contratos de capacidad y sync offline-first (`ADR-002`, `ADR-006`).
- Las superficies de presentación (Next.js 14 / React, React Native / Expo).

### 2.4 Política de Prohibición de Upstream EOL
Queda formalmente prohibido iniciar o mantener código de producción sobre una versión mayor de Node.js en estado EOL, salvo que exista una excepción formal aprobada por el Product Owner y el Security Architect respaldada por un contrato comercial de soporte extendido documentado. No aplica dicha excepción en este proyecto.

---

## 3. Distinción Crítica con el Runtime del Edge Host (Electron)

Es fundamental **NO CONFLATAR** el runtime de sistema/build de Node.js con el runtime de Node.js embebido en Electron:
* **Node.js 24 LTS** gobierna el sistema operativo anfitrión, la compilación del monorepo, el empaquetado y el Cloud Backend.
* **Electron** (`ADR-003`) contiene y distribuye su propio binario de Node.js internamente, el cual está estrictamente acoplado a la versión mayor de Electron (por ejemplo, Electron 30+ integra su propia versión soportada de Chromium y Node.js).
* La selección de la versión específica de Electron se mantiene como dependencia de implementación gobernada por `ADR-003` y `SECURITY_ARCHITECTURE.md` Sec. 8 (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
* Los módulos nativos de C/C++ (`serialport`, `better-sqlite3`, drivers de impresión ESC/POS) se compilan contra los encabezados de Electron para el Edge Host, y contra Node.js 24 LTS para el tooling/backend.

---

## 4. Análisis de Compatibilidad del Ecosistema

Para evitar declaraciones falsas de compatibilidad en ausencia de código compilado en el repositorio, todos los componentes se clasifican con rigor técnico:

| Herramienta / Componente | Estatus Upstream con Node 24 LTS | Clasificación en TRIDENTPOS | Mitigación / Evidencia Obligatoria |
|---|---|---|---|
| **npm workspaces** | Nativo de plataforma en Node 24 | **`SUPPORTED BY PLATFORM — VALIDATION REQUIRED`** | Evidencia empírica de instalación limpia con `npm ci` requerida en `WP-001`. |
| **Turborepo** | Soporte oficial upstream en Node 24 | **`EXPECTED COMPATIBLE — VALIDATION REQUIRED`** | Evidencia de pipeline de build y caché requerida en `WP-001`. |
| **TypeScript 5.4+** | Soporte completo para ESM/CJS en Node 24 | **`EXPECTED COMPATIBLE — VALIDATION REQUIRED`** | Evidencia de compilación estricta (`tsc --noEmit`) requerida en `WP-001`. |
| **ESLint / Prettier** | Compatible con motores Node 24 | **`EXPECTED COMPATIBLE — VALIDATION REQUIRED`** | Verificación de reglas y linting sin advertencias requerida en `WP-001`. |
| **Fastify / Express** | Soporte oficial para Node 24 LTS | **`EXPECTED COMPATIBLE — VALIDATION REQUIRED`** | Verificación en Cloud Backend requerida en Wave 1 (`WP-004`/`WP-005`). |
| **Next.js 14 Tooling** | Soporte oficial para Node 24 LTS | **`EXPECTED COMPATIBLE — VALIDATION REQUIRED`** | Verificación de build tooling requerida en Wave 8 (`WP-024`). |
| **`better-sqlite3`** | Módulo nativo compilado (N-API) | **`VALIDATION REQUIRED`** | Validación obligatoria de compilación nativa en `WP-008`. |
| **`serialport` / Hardware POS** | Módulos nativos C++ para periféricos | **`VALIDATION REQUIRED`** | Validación técnica obligatoria en `WP-015` sobre hardware POS target (`SEC-VAL-08`). |
| **Electron Build Ecosystem** | `@electron/rebuild` / `electron-builder` | **`VALIDATION REQUIRED`** | Validación de empaquetado nativo en `WP-007` y `WP-028`. |

*Regla de Honestidad Técnica:* Ningún componente con dependencias de compilación se declara como "PASS" de compatibilidad anticipadamente. Toda compatibilidad debe ser demostrada mediante evidencia empírica de ejecución en el Work Package correspondiente.

---

## 5. Consecuencias y Efectos

### Positivas:
* **Seguridad de la Cadena de Suministro:** Se eliminan riesgos de CVEs sin parche en el runtime principal desde el inicio del proyecto.
* **Horizonte de Mantenimiento Upstream:** Soporte activo y de mantenimiento programado por la OpenJS Foundation hasta el 2028-04-30.
* **Modernidad del Toolchain:** Mejoras de rendimiento en V8, soporte optimizado de ES Modules y APIs web nativas en Node (`fetch`, `FormData`, crypto nativo).

### Negativas / Deuda Técnica Gobernada:
* Requiere validar empíricamente que las dependencias nativas de hardware POS compilen limpiamente contra N-API en los entornos de destino. Esta deuda técnica queda formalmente registrada y mapeada a `WP-007`, `WP-008`, `WP-015` y `WP-028`.

---

## 6. Estatus de Gobierno

* **Clasificación:** `SURGICAL ARCHITECTURE / IMPLEMENTATION BASELINE MAINTENANCE`
* **Veredicto del Autor:** `READY FOR ROLE-SEPARATED REVIEW`
* **Estatus de Aprobación de la Enmienda:** `NOT YET PRODUCT OWNER APPROVED`
* **Estatus de Ejecución de WP-001:** `TEMPORARILY BLOCKED PENDING ACR-2026-004 / ADR-011 APPROVAL`
* **Revisores Mandatorios Requeridos:**
  - `10_DevOps_Platform_Architect` (Revisión de plataforma, build toolchain y compatibilidad monorepo).
  - `08_Security_Architect` (Revisión de seguridad de cadena de suministro y superficie de ataque del runtime).
* **Aprobación Final:** `Product Owner` (Freeze del baseline de implementación).
