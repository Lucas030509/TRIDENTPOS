# ARCHITECTURE CHANGE EVIDENCE REPORT: WP-014 / WP-017 EXACT NUMERICS & BUSINESS MODULE COMPOSITION

**Author Agent:** `01_Solution_Architect`  
**Role:** `ARCHITECTURE CHANGE AUTHOR`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Date:** 2026-09-13  
**Base Commit:** `0c43c325b8ae90970c267b2356eb229f61deaa4c` (`M13`)  
**Architecture Branch:** `architecture/wp-014-business-module-composition-money`  
**Original Candidate:** `f98e7e189a4dbba978fe88546d281d604892a48e`  
**R1 Candidate:** Direct child commit on top of `f98e7e189a4dbba978fe88546d281d604892a48e`  
**R1 Parent:** `f98e7e189a4dbba978fe88546d281d604892a48e`  
**Triggering Pre-Flight Blockers:**
1. `WP-014 PRE-FLIGHT MONETARY REPRESENTATION CONFLICT`
2. `WP-014 PRE-FLIGHT PACKAGE COMPOSITION BLOCKER`

---

## 1. Executive Summary

This report documents the architectural resolution for the two critical blockers identified by `16_Native_Edge_Developer` during the formal Pre-Flight evaluation of `WP-014`, as well as the surgical R1 quick-integrity remediation:
1. **Contradiction in Monetary Storage & Exact Numerics:** General conventions forbade floating point while Edge SQLite DDL defined monetary fields as IEEE 754 `REAL`. Resolved via `ADR-012` and `ACR-2026-013` by establishing exact signed 64-bit `INTEGER` (Fixed-Point Scale 4: factor $10^4 = 10,000$) as the sole canonical physical representation in Edge SQLite, with sign-safe Half Away From Zero rounding, BigInt domain authority, lexical string transport, and exact SQLite aggregate semantics.
2. **Monorepo Composition Conflict & Bounded-Context Topology:** Monorepo graph policies strictly prohibited cross-package imports between `@trident/pos` and `@trident/edge`, preventing the assembly of domain logic, SQLite persistence, transactional outbox, and local REST endpoints. Resolved via `ADR-013` and `ACR-2026-013` by formalizing a 4-layer hexagonal monorepo topology (Platform Kernel & Core Bounded Context, Pure Business Domains, Technical Infrastructure Adapters, and Application Composition Roots).

This architecture change provides complete structural authority for `WP-014` and unlocks `WP-017` (Inventory) and all remaining bounded contexts without compromising domain isolation.

---

## 2. Inventory of Changes

### 2.1 New Architectural Decision Records (ADRs)
- `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md`: Exact fixed-point numerical representation in Edge SQLite (`INTEGER`, scale 4, sign-safe half-away-from-zero rounding via `roundDiv`, common interoperable range `[-99,999,999.9999, +99,999,999.9999]`, float-free lexical string conversion, BigInt domain authority, Cloud precision taxonomy).
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md`: Hexagonal 4-layer monorepo package topology, Platform Core dual role, TRIDENTPOS vs Finance ownership clarification, composition roots (`@trident/pos-edge-runtime`, `@trident/cloud-server`), and domain isolation invariants.

### 2.2 Formal Architecture Change Request (ACR)
- `ARCHITECTURE_CHANGE_REQUEST_WP014_EXACT_NUMERICS_AND_COMPOSITION.md`: Formal `ACR-2026-013` specification.

### 2.3 Proposed Amendments to Frozen Architectural Documents
All amendments are explicitly labeled `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`:
- `DATA_MODEL.md`: Section 1 (Line 26) amended to specify signed `INTEGER` (scale 4) for Edge while preserving Cloud `DECIMAL(12,4)` and `DECIMAL(6,4)`; Section 2.3 amended to define tenant-safe composite keys, FKs, exclusivity check, and default-deny RLS for Cloud inventory tables (`warehouses`, `ingredients`, `recipes`, `recipe_items`); Section 3 (Lines 805–918) amended to replace all `REAL` monetary and quantity columns with `INTEGER` (scale 4) while preserving lifecycle nullability (e.g. `turnos_caja.closing_declared_cash INTEGER NULL`).
- `DATA_DICTIONARY.md`: Section 1.2 updated to record `INTEGER (Scale 4)` for `cuenta_items.unit_price_applied`, `tax_rate_applied`, and `turnos_caja.closing_declared_cash`.
- `DATA_ARCHITECTURE.md`: Section 2.1 added to define exact fixed-point storage, common numeric range, sign-safe rounding, zero floating-point policy, and lexical string transport.
- `TECH_STACK_DECISIONS.md`: Table in Section 1 updated to document exact fixed-point SQLite and 4-layer monorepo topology; Section 4 added.
- `SOLUTION_ARCHITECTURE.md`: Section 6 added to define the 4-layer monorepo package topology, Platform Core dual role, and composition roots.
- `IMPLEMENTATION_PLAN.md`: `WP-014` and `WP-017` entries updated to specify package placement, reciprocal parallelism, canonical physical table names, and composition root integration.

### 2.4 Product Implementation Code & Scripts
- **Product runtime code changed:** **NO** (Zero lines of application source code modified).
- **Package manifests / lockfile changed:** **NO**.
- **Graph checker script changed:** **NO** (Rules specified for future DevOps remediation).
- **Migrations executed:** **NO** (Zero database migrations created or applied).

---

## 3. Monetary Architecture Decision (`ADR-012`)

### 3.1 Physical Representation & Lifecycle Nullability
- **Edge SQLite:** Signed 64-bit `INTEGER`.
- **Cloud PostgreSQL:** `DECIMAL(12,4)` for amounts/quantities; `DECIMAL(6,4)` for tax rates.
- **Punto Flotante:** Estrictamente prohibido (`REAL / FLOAT PROHIBITED`).
- **Nulabilidad:** Gobernada por el ciclo de vida de cada campo individual (los precios y subtotales son NOT NULL; los campos de cierre como `turnos_caja.closing_declared_cash` son NULL mientras el turno esté abierto).

### 3.2 Scales, Factors & Common Interoperable Range
- **Escala Canónica:** Escala fija de 4 decimales ($S = 10,000$, ej. `$150.5000` = `1505000`, 16% IVA = `1600`, `0.2500` kg = `2500`).
- **Rango Común Interoperable:** Gobernado por el tipo Cloud más restrictivo `DECIMAL(12,4)` a $[-99,999,999.9999, +99,999,999.9999]$ (en Edge escala 4: $[-999999999999, +999999999999]$).
- **Autoridad de BigInt:** Dominio TypeScript opera exclusivamente con `bigint` para prevenir pérdida de precisión en productos intermedios a escala 8.

### 3.3 Rounding, Arithmetic Sequence & SQLite Aggregates
1. **Primitiva Genérica de Redondeo Sign-Safe (`roundDiv`):**
   $$\text{roundDiv}(A, B) = \text{sign}(A \times B) \times \left\lfloor \frac{|A| + \lfloor |B| / 2 \rfloor}{|B|} \right\rfloor \quad (\text{con } B \neq 0)$$
   Modo oficial: **Half Away From Zero** (Project Canonical Rounding Mode).
2. **Cálculo de Partida:**
   $$\text{lineSubtotal} = \text{roundDiv}(\text{unitPriceScale4} \times \text{quantityScale4}, 10000\text{n})$$
   $$\text{netSubtotal} = \text{lineSubtotal} - \text{discountAmountScale4}$$
   $$\text{taxAmount} = \text{roundDiv}(\text{netSubtotal} \times \text{taxRateScale4}, 10000\text{n})$$
   $$\text{lineTotal} = \text{netSubtotal} + \text{taxAmount}$$
3. **Totales del Agregado de Cuenta:** Suma entera exacta de las partidas componentes:
   $$\text{cuentas.total\_amount} \equiv \sum \text{cuenta\_items.total}$$
4. **Semántica de Agregaciones SQLite:**
   - *Permitidas:* `MIN(integer)`, `MAX(integer)`, `SUM(integer)` con chequeo de desbordamiento.
   - *Prohibidas:* `AVG()` y `TOTAL()` por retornar números de punto flotante (`REAL`).

### 3.4 Conversión Libre de Punto Flotante y Value Object
- **Transporte Externo:** Cadenas decimales fijas canónicas de 4 decimales (`"150.5000"`) en APIs REST, WebSockets y sincronización Cloud.
- **Conversión Léxica:** BigInt a String vía división y residuo entero con pad de 4 ceros; String a BigInt vía parsing léxico validado contra expresión regular. Prohibido `Number()`, `parseFloat()`, `/ 10000.0`, `toFixed()`.
- **Value Object `Money`:** Especificado para `@trident/core`, inmutable, respaldado por `amountScale4: bigint`.

---

## 4. Package Topology & Composition Model (`ADR-013`)

### 4.1 Matriz de Responsabilidad de Paquetes
| Capa | Paquete | Bounded Context | ¿Lógica de Dominio? | Dependencias Runtime Permitidas | Persistencia / Rol |
|---|---|---|---|---|---|
| **Capa 1: Kernel** | `@trident/core` | Platform Core | **SÍ** | `[]` | Dominio Platform Core (Org, Branch, Station, Users/RBAC, Entitlements, Master Catalog, Modifiers, Overrides, Audit) + Interfaces y Value Objects (`Money`). |
| **Capa 2: Dominios** | `@trident/pos` | TRIDENTPOS | **SÍ** | `['@trident/core']` | Salones, Mesas, Cuentas, Partidas, Modificadores, Comandas, KDS LAN, Turnos de Caja (`turnos_caja`), Movimientos de Efectivo, Cobro POS (`pagos`), Arqueos, Cortes X/Z. |
| **Capa 2: Dominios** | `@trident/inventory` | Inventory | **SÍ** | `['@trident/core']` | Insumos, multialmacén, motor de explosión de recetas/subrecetas, kárdex. |
| **Capa 2: Dominios** | `@trident/procurement`| Procurement | **SÍ** | `['@trident/core']` | Proveedores, compras, recepciones físicas. |
| **Capa 2: Dominios** | `@trident/finance` | Finance | **SÍ** | `['@trident/core']` | Finanzas corporativas: Tesorería central, CxP, CxC, Gastos, Liquidación de Propinas, Comisiones, Conciliación Bancaria, Interfaz Contable. |
| **Capa 2: Dominios** | `@trident/billing` | Billing | **SÍ** | `['@trident/core']` | Facturación fiscal electrónica, folios, leases. |
| **Capa 2: Dominios** | `@trident/crm` | CRM | **SÍ** | `['@trident/core']` | Clientes, cuentas corrientes, límites de crédito. |
| **Capa 2: Dominios** | `@trident/delivery` | Delivery | **SÍ** | `['@trident/core']` | Logística propia, asignación de choferes. |
| **Capa 2: Dominios** | `@trident/loyalty` | Loyalty | **SÍ** | `['@trident/core']` | Puntos, monederos RestCard. |
| **Capa 2: Dominios** | `@trident/analytics`| Analytics | **SÍ** | `['@trident/core']` | KPI gerenciales, rentabilidad. |
| **Capa 2: Dominios** | `@trident/integrations`| Integrations| **SÍ** | `['@trident/core']` | Adaptadores de hardware POS, APIs de terceros. |
| **Capa 3: Infra** | `@trident/database` | Platform Core | NO | `['@trident/core']` | Conexión Supabase PostgreSQL 16, migraciones Cloud, RLS. |
| **Capa 3: Infra** | `@trident/edge` | Platform Core | NO | `['@trident/core']` | Host Electron, SQLite WAL (`EdgeDatabaseService`), `EdgeOutboxPersistence`. |
| **Capa 3: Infra** | `@trident/sync` | Platform Core | NO | `['@trident/core']` | Protocolo WebSocket sync bidireccional. |
| **Capa 3: Infra** | `@trident/ui` | Platform Core | NO | `['@trident/core']` | Componentes visuales UI. |
| **Capa 4: Composición**| `@trident/pos-edge-runtime`| TRIDENTPOS (Assembly)| **NO** | `['@trident/core', '@trident/pos', '@trident/edge']` | Fastify local LAN REST API, inyección SQLite, pruebas OCC e integración real. |
| **Capa 4: Composición**| `@trident/cloud-server` | Platform Core (Assembly)| **NO** | `['@trident/core', '@trident/database', ...dominios cloud]` | API Gateway Cloud, inyección PostgreSQL, despacho de eventos. |

---

## 5. Walkthrough de Composición

### 5.1 Demostración para WP-014 (Dining Room, Tables & Orders Domain Engine with OCC)
- **Dominio:** `@trident/pos` implementa la lógica pura de mesas, cuentas, comanda, turnos de caja, pagos, OCC compare-and-swap y políticas neutrales (`CancellationPolicy`, `BillSplitProrationStrategy`). Depende únicamente de `@trident/core`.
- **Infraestructura:** `@trident/edge` provee `EdgeDatabaseService` (SQLite WAL) y `EdgeOutboxPersistence`.
- **Raíz de Composición:** `@trident/pos-edge-runtime` ensambla `@trident/pos` con `@trident/edge`:
  - Implementa los adaptadores de persistencia de salón sobre SQLite WAL.
  - Expone rutas Fastify LAN (`POST /cuentas`, `POST /ordenes/partidas`, `PUT /cuentas/:id/cerrar`).
  - Ejecuta transacciones atómicas `executeWithOutbox()`.
  - Aloja y ejecuta las pruebas de integración reales `WP014-T01` a `WP014-T14` (incluyendo la prueba de colisión OCC concurrente y el benchmark de latencia).
- **Validación de Frontera:** Cero importaciones entre `@trident/pos` y `@trident/edge`. El grafo se mantiene 100% acíclico y conforme a políticas de arquitectura.

### 5.2 Demostración para WP-017 (Inventory Catalog, Multi-Warehouse & Recipe Explosion)
- **Dominio:** `@trident/inventory` implementa catálogo de insumos, multialmacén, motor de explosión de recetas y costeo ponderado. Depende únicamente de `@trident/core`. Cero dependencia hacia `@trident/pos`.
- **Infraestructura:** `@trident/database` provee las migraciones y pools de PostgreSQL 16 para las tablas físicas canónicas: `warehouses`, `ingredients`, `recipes` y `recipe_items` (con candidate keys `(organization_id, id)` y RLS default-deny).
- **Raíz de Composición:** `@trident/cloud-server` inyecta los repositorios de PostgreSQL en `@trident/inventory` y expone las APIs al portal Backoffice.
- **Validación de Frontera:** Inventario opera de forma 100% autónoma. Cuando KDS en `WP-018` requiera descontar insumos, se comunicará mediante el evento durable canónico `OrdenProduccionConfirmadaEnKDS` o contratos de capability en `@trident/core`, jamás mediante importación directa en tiempo de ejecución.

---

## 6. Especificación de Reglas de Grafo para `18_DevOps_Engineer`

La actualización de `scripts/check-graph.mjs` implementará:

```javascript
export const ALLOWED_INTERNAL_DEPENDENCIES = {
  // Layer 1: Kernel
  '@trident/core': [],

  // Layer 2: Business Domains (Core only)
  '@trident/pos': ['@trident/core'],
  '@trident/inventory': ['@trident/core'],
  '@trident/procurement': ['@trident/core'],
  '@trident/finance': ['@trident/core'],
  '@trident/billing': ['@trident/core'],
  '@trident/crm': ['@trident/core'],
  '@trident/delivery': ['@trident/core'],
  '@trident/loyalty': ['@trident/core'],
  '@trident/analytics': ['@trident/core'],
  '@trident/integrations': ['@trident/core'],

  // Layer 3: Technical Infrastructure (Core only)
  '@trident/database': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
  '@trident/sync': ['@trident/core'],
  '@trident/ui': ['@trident/core'],

  // Layer 4: Composition Roots (Assembly allowlists)
  '@trident/pos-edge-runtime': ['@trident/core', '@trident/pos', '@trident/edge'],
  '@trident/cloud-server': [
    '@trident/core',
    '@trident/database',
    '@trident/pos',
    '@trident/inventory',
    '@trident/procurement',
    '@trident/finance',
    '@trident/billing',
    '@trident/crm',
    '@trident/delivery',
    '@trident/loyalty',
    '@trident/analytics',
    '@trident/integrations',
    '@trident/sync',
  ],
};

export const ALLOWED_TEST_INTERNAL_DEPENDENCIES = {
  ...ALLOWED_INTERNAL_DEPENDENCIES,
  '@trident/sync': ['@trident/core', '@trident/edge'],
};
```

**Comportamiento Fail-Closed:** Todo paquete interno no listado explícitamente disparará `ARCHITECTURAL_BOUNDARY_VIOLATION`.

---

## 7. Protected Product Owner Decisions Status

All nine (9) protected Product Owner decisions remain strictly:
$$\mathbf{PENDING\ PO\ DECISION}$$

- `OQ-SSOT-01`: PENDING PO DECISION (Generic `CancellationPolicy` parameterized; zero default business rule).
- `OQ-SSOT-02`: PENDING PO DECISION (Generic `TransferValidationRule` parameterized; zero default boolean).
- `OQ-SSOT-03`: PENDING PO DECISION.
- `OQ-SSOT-04`: PENDING PO DECISION.
- `OQ-SSOT-05`: PENDING PO DECISION.
- `OQ-SSOT-06`: PENDING PO DECISION (Generic `BillSplitProrationStrategy` parameterized; zero default algorithm).
- `OQ-SSOT-07`: PENDING PO DECISION (Generic `ModifierRecipeResolver` parameterized; zero default algorithm).
- `OQ-ARCH-01`: PENDING PO DECISION.
- `OQ-ARCH-02`: PENDING PO DECISION.

---

## 8. Verification & Pre-Commit Sanity

Execution of existing repository gates on `architecture/wp-014-business-module-composition-money`:
- `npm run format:check`: PASS.
- `npm run lint`: PASS (0 errors).
- `npm run typecheck`: PASS (0 errors).
- `npm run graph:check`: PASS (0 cycles, 0 boundary violations).
- `npm test`: PASS (497/497 tests pass, 0 fail, 0 skip).
- Working tree contains solely architectural and documentation deliverables.

---

## 9. R1 Quick Integrity Remediation Closure Evidence

| Blocker / Requirement | Status | Closure Evidence |
|---|---|---|
| **R1-01 Float-Free Conversion** | **CLOSED** | Replaced all `/ 10000.0`, `toFixed()`, `parseFloat()` with exact integer modulo/division BigInt-to-string formatting (`whole.toString() + "." + fraction.toString().padStart(4, "0")`) and lexical regex parsing (`/^-?\d+\.\d{4}$/`). External JSON transport unified to canonical fixed 4-decimal strings (`"150.5000"`). |
| **R1-02 Sign-Safe Rounding** | **CLOSED** | Established `roundDiv(A, B) = sign(A*B) * floor((abs(A) + floor(abs(B)/2)) / abs(B))` as Project Canonical Rounding Mode with 6 normative test vectors (`roundDiv(5000, 10000) = 1`, `roundDiv(-5000, 10000) = -1`, etc.). All arithmetic formulas rewritten to use `roundDiv`. |
| **R1-03 SQLite Aggregate Semantics** | **CLOSED** | Clarified that `MIN`, `MAX`, `SUM` on `INTEGER` are allowed with 64-bit overflow checks; `AVG()` and `TOTAL()` are strictly prohibited for authoritative monetary calculation. Averages must be computed via integer sum and count using `roundDiv`. |
| **R1-04 Common Numeric Range** | **CLOSED** | Canonical interoperable range established from Cloud `DECIMAL(12,4)`: `[-99,999,999.9999, +99,999,999.9999]`, corresponding to Edge scale-4 integer range `[-999999999999, +999999999999]`. Boundary checks required before persistence, arithmetic acceptance, and synchronization. |
| **R1-05 BigInt Authority** | **CLOSED** | Authoritative domain arithmetic in TypeScript unified exclusively to `bigint`. Use of JavaScript `number` for financial arithmetic strictly prohibited. |
| **R1-06 Nullability** | **CLOSED** | Eliminated global "INTEGER NOT NULL" blanket rule. Storage is `INTEGER` scale 4, but nullability is governed by field lifecycle (e.g. `turnos_caja.closing_declared_cash` remains `INTEGER NULL` while open). |
| **R1-07 Cloud Precision Taxonomy** | **CLOSED** | Harmonized Cloud types: amounts/quantities are `DECIMAL(12,4)`, tax rates are `DECIMAL(6,4)`, both mapped to Edge `INTEGER` scale 4. |
| **R1-08 Bounded Context Ownership** | **CLOSED** | TRIDENTPOS formally owns Salones, Mesas, Cuentas, Comandas, KDS, Turnos de Caja, Arqueos, Cobro POS, Cortes X/Z. Finance owns Central Treasury, CxP, CxC, Expenses, Bank Reconciliation, Accounting Interface. |
| **R1-09 Platform Core Ownership** | **CLOSED** | `@trident/core` confirmed to represent both Platform Core bounded context (owning domain logic for Org, Branch, Station, Users, Entitlements, Master Catalog, Modifiers, Overrides, Audit) and shared kernel/capability surface. |
| **R1-10 WP-017 Physical Names** | **CLOSED** | Physical PostgreSQL tables standardized to `warehouses`, `ingredients`, `recipes`, `recipe_items` (with unit of measure on ingredients), distinguished from conceptual domain names. Duplicate Spanish tables prohibited. |
| **R1-11 Reciprocal Parallelism** | **CLOSED** | Normalized `IMPLEMENTATION_PLAN.md` for both `WP-014` and `WP-017`: `Parallelizable: YES — with WP-017/WP-014 only after ACR-2026-013 and graph-enforcement remediation are canonical on main.` |
| **R1-12 Tenant-Safe Inventory Model** | **CLOSED** | `DATA_MODEL.md` normalized with `uq_warehouses_org_id`, `uq_ingredients_org_id`, `uq_recipes_org_id`, `uq_recipe_items_org_id`, composite foreign keys with `organization_id`, and `chk_recipe_items_exclusive_source`. |
| **Inventory RLS Specification** | **CLOSED** | Explicit `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and default-deny policies using `current_app_org_id()` specified for `warehouses`, `ingredients`, `recipes`, `recipe_items`. |
| **Canonical KDS Event Name** | **CLOSED** | Replaced `OrderCompletedEvent` with frozen canonical event `OrdenProduccionConfirmadaEnKDS`. |
| **Terminology Cleanup** | **CLOSED** | Replaced all instances of `micro-unit` / `micro-units` with `unidades fixed-point escala 4` / `diezmilésimas`. |
| **Protected PO Decisions** | **PRESERVED** | 9/9 decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`. |
