# ADR-011: Adopción de Node.js 24 LTS como Baseline de Runtime y Toolchain

## Metadata
* **ADR ID:** `ADR-011`
* **Title:** Adopción de Node.js 24 LTS como Baseline de Runtime y Toolchain del Monorepo
* **Status:** `PROPOSED` (Awaiting Role-Separated Review & Product Owner Approval)
* **Date:** `2026-09-04`
* **Author:** `01_Solution_Architect — ARCHITECTURE CHANGE AUTHOR`
* **Change Request:** `ACR-2026-004`
* **Supersedes:** Node.js 20 LTS reference baseline in `IMPLEMENTATION_PLAN.md` (WP-001 / Sec 13.1)
* **Related ADRs:** `ADR-001` (Modular Monolith), `ADR-003` (Edge Host Runtime), `ADR-009` (Bootstrap Protocol), `ADR-010` (Solo Maintainer Model)

---

## 1. Contexto y Problemática

En la línea base de arquitectura congelada (`IMPLEMENTATION_PLAN.md` Sec. 3.1 y 13.1), se especificó:
> `Node.js 20 LTS (IMPLEMENTATION VERSION TO PIN)`

Una auditoría previa a la ejecución de `WP-001` (Monorepo Foundation) identificó que, de acuerdo con el calendario oficial de soporte upstream de la OpenJS Foundation / Node.js Release Working Group:
* **Node.js 20:** Alcanzó formalmente el estado **End-of-Life (EOL)** en 2026. Ya no recibe parches de seguridad upstream ni correcciones de estabilidad críticas.
* **Node.js 24:** Es la versión actual con soporte **Active / Maintenance Long Term Support (LTS)**, con un horizonte de mantenimiento oficial proyectado hasta **abril de 2028**.

Iniciar la fase de implementación de un nuevo producto comercial en una versión de runtime upstream que ya se encuentra en EOL constituye una vulneración directa a los principios de seguridad de la cadena de suministro (`SUPPLY_CHAIN_SECURITY.md`), ya que expondría el software a vulnerabilidades no remediables (CVEs sin parche upstream) desde el primer commit de código.

---

## 2. Decisión de Arquitectura

Se decide adoptar **Node.js 24 LTS** como el baseline oficial y mantenido de runtime y toolchain para el proyecto TRIDENTPOS:

1. **Ámbito de Aplicación de Node.js 24 LTS:**
   - Toolchain del monorepo (`npm workspaces`, `Turborepo`).
   - Compilación y ejecución de herramientas compartidas de TypeScript (`tsc`, `eslint`, `prettier`).
   - Entornos de desarrollo local para desarrolladores (Windows, macOS, Linux).
   - Build y runtime del Cloud Backend modular (Express / Fastify) en entornos de contenedores/servicios cloud (Render).
   - Scripts de CI/CD ejecutados en GitHub Actions (cuando se configuren en `WP-002`).

2. **Invarianza de Paradigmas de Arquitectura:**
   Esta decisión es estrictamente de mantenimiento de baseline de runtime upstream. **NO modifica**:
   - El paradigma de monorepo con `npm workspaces` y `Turborepo`.
   - TypeScript 5.4+ con tipado estricto.
   - La arquitectura de Monolito Modular de 11 contextos acotados (`ADR-001`).
   - La selección de bases de datos (PostgreSQL 16 en Supabase, SQLite con WAL en Edge).
   - Los contratos de capacidad y sync offline-first (`ADR-002`, `ADR-006`).
   - Las superficies de presentación (Next.js 14 / React, React Native / Expo).

3. **Política de Prohibición de Upstream EOL:**
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

| Herramienta / Componente | Estatus con Node 24 LTS | Clasificación | Mitigación / Compensación |
|---|---|---|---|
| **npm workspaces** | Nativo (incluido con Node 24) | Compatible | Estándar de la plataforma. |
| **Turborepo** | Compatible con Node 24 | Compatible | Caché y paralelización validadas en Wave 0. |
| **TypeScript 5.4+** | Totalmente compatible | Compatible | Soporte completo para ESM y CJS en Node 24. |
| **ESLint / Prettier** | Compatible con Node 24 | Compatible | Configuración estándar en monorepo. |
| **Fastify / Express** | Compatible con Node 24 LTS | Compatible | Soporte oficial LTS. |
| **Next.js 14 Tooling** | Compatible con Node 24 LTS | Compatible | Build tooling verificado. |
| **`better-sqlite3`** | Binarios nativos precompilados / N-API | **`VALIDATION REQUIRED`** | Validación obligatoria durante compilación en `WP-008`. |
| **`serialport` / Hardware POS** | Módulos nativos N-API para periféricos | **`VALIDATION REQUIRED`** | Validación técnica obligatoria en `WP-015` sobre hardware POS target (`SEC-VAL-08`). |
| **Electron Build Ecosystem** | `@electron/rebuild` / `electron-builder` | **`VALIDATION REQUIRED`** | Validación de empaquetado nativo en `WP-007` y `WP-028`. |

*Nota:* Ningún componente marcado como **`VALIDATION REQUIRED`** se asume como PASS de forma anticipada. Cada uno debe presentar evidencia empírica de compilación y ejecución durante su respectivo Work Package.

---

## 5. Consecuencias y Efectos

### Positivas:
* **Seguridad de la Cadena de Suministro:** Se eliminan riesgos de CVEs sin parche en el runtime principal desde el inicio del proyecto.
* **Horizonte de Mantenimiento Extendido:** Cobertura de parches de seguridad y estabilidad asegurada hasta abril de 2028.
* **Modernidad del Toolchain:** Mejoras de rendimiento en V8, soporte optimizado de ES Modules y APIs web nativas en Node (`fetch`, `FormData`, crypto nativo).

### Negativas / Deuda Técnica Gobernada:
* Requiere validar que las dependencias nativas de hardware POS compilen limpiamente contra N-API en los entornos de destino. Esta deuda queda formalmente registrada y mapeada a `WP-007`, `WP-008` y `WP-015`.

---

## 6. Estatus de Gobierno

* **Clasificación:** `SURGICAL ARCHITECTURE / IMPLEMENTATION BASELINE MAINTENANCE`
* **Veredicto del Autor:** `READY FOR ROLE-SEPARATED REVIEW`
* **Revisores Mandatorios Requeridos:**
  - `10_DevOps_Platform_Architect` (Revisión de plataforma y build toolchain).
  - `08_Security_Architect` (Revisión de seguridad de cadena de suministro y superficie de ataque).
* **Aprobación Final:** `Product Owner` (Freeze del baseline de implementación).
