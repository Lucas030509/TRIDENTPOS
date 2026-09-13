# ARCHITECTURE CHANGE EVIDENCE REPORT: WP-014 / WP-017 EXACT NUMERICS & BUSINESS MODULE COMPOSITION

**Author Agent:** `01_Solution_Architect`  
**Role:** `ARCHITECTURE CHANGE AUTHOR`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Date:** 2026-09-13  
**Base Commit:** `0c43c325b8ae90970c267b2356eb229f61deaa4c` (`M13`)  
**Architecture Branch:** `architecture/wp-014-business-module-composition-money`  
**Candidate Commit SHA:** `06fdae11d1bee7ad1dfc174ddf330db77339121f` (Initial), `AMENDED AT FINAL CANDIDATE FREEZE`  
**Triggering Pre-Flight Blockers:**
1. `WP-014 PRE-FLIGHT MONETARY REPRESENTATION CONFLICT`
2. `WP-014 PRE-FLIGHT PACKAGE COMPOSITION BLOCKER`

---

## 1. Executive Summary

This report documents the architectural resolution for the two critical blockers identified by `16_Native_Edge_Developer` during the formal Pre-Flight evaluation of `WP-014`:
1. **Contradiction in Monetary Storage:** General conventions forbade floating point while Edge SQLite DDL defined monetary fields as IEEE 754 `REAL`. Resolved via `ADR-012` and `ACR-2026-013` by establishing exact signed 64-bit `INTEGER` (Fixed-Point Scale 4: factor $10^4 = 10,000$) as the sole canonical physical representation in Edge SQLite.
2. **Monorepo Composition Conflict:** Monorepo graph policies strictly prohibited cross-package imports between `@trident/pos` and `@trident/edge`, preventing the assembly of domain logic, SQLite persistence, transactional outbox, and local REST endpoints. Resolved via `ADR-013` and `ACR-2026-013` by formalizing a 4-layer hexagonal monorepo topology (Platform Kernel, Pure Business Domains, Technical Infrastructure Adapters, and Application Composition Roots).

This architecture change provides complete structural authority for `WP-014` and unlocks `WP-017` (Inventory) and all remaining bounded contexts without compromising domain isolation.

---

## 2. Inventory of Changes

### 2.1 New Architectural Decision Records (ADRs)
- `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md`: Exact fixed-point numerical representation in Edge SQLite (`INTEGER`, scale 4, commercial half-away-from-zero rounding, deterministic mapping to Cloud `DECIMAL(12,4)`).
- `ADR/ADR-013-bounded-context-package-topology-and-composition-model.md`: Hexagonal 4-layer monorepo package topology, composition roots (`@trident/pos-edge-runtime`, `@trident/cloud-server`), and domain isolation invariants.

### 2.2 Formal Architecture Change Request (ACR)
- `ARCHITECTURE_CHANGE_REQUEST_WP014_EXACT_NUMERICS_AND_COMPOSITION.md`: Formal `ACR-2026-013` specification.

### 2.3 Proposed Amendments to Frozen Architectural Documents
All amendments are explicitly labeled `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`:
- `DATA_MODEL.md`: Section 1 (Line 26) amended to specify `INTEGER` (scale 4) for Edge; Section 3 (Lines 805–918) amended to replace all `REAL` monetary and quantity columns with `INTEGER NOT NULL` (scale 4).
- `DATA_DICTIONARY.md`: Section 1.2 updated to record `INTEGER (Scale 4)` for `cuenta_items.unit_price_applied`, `tax_rate_applied`, and `turnos_caja.closing_declared_cash`.
- `DATA_ARCHITECTURE.md`: Section 2.1 added to define exact fixed-point storage, zero floating-point policy, and conversion boundary.
- `TECH_STACK_DECISIONS.md`: Table in Section 1 updated to document exact fixed-point SQLite and 4-layer monorepo topology; Section 4 added.
- `SOLUTION_ARCHITECTURE.md`: Section 6 added to define the 4-layer monorepo package topology and composition roots.
- `IMPLEMENTATION_PLAN.md`: `WP-014` and `WP-017` entries updated to specify package placement, dependencies, and composition root integration.

### 2.4 Product Implementation Code & Scripts
- **Product runtime code changed:** **NO** (Zero lines of application source code modified).
- **Package manifests / lockfile changed:** **NO**.
- **Graph checker script changed:** **NO** (Rules specified for future DevOps remediation).
- **Migrations executed:** **NO** (Zero database migrations created or applied).

---

## 3. Monetary Architecture Decision (`ADR-012`)

### 3.1 Physical Representation
- **Edge SQLite:** Signed 64-bit `INTEGER NOT NULL`.
- **Cloud PostgreSQL:** `DECIMAL(12,4)`.
- **Punto Flotante:** Estrictamente prohibido (`REAL / FLOAT PROHIBITED`).

### 3.2 Scales & Factors
| Concepto | Escala ($10^N$) | Factor de Multiplicación | Ejemplo Decimal | Ejemplo SQLite `INTEGER` |
|---|---|---|---|---|
| **Importes Monetarios** (subtotal, total, propinas, descuentos) | 4 | $10,000$ | `$150.5000` | `1505000` |
| **Precios Unitarios** (`unit_price_applied`) | 4 | $10,000$ | `$45.0000` | `450000` |
| **Precios de Modificadores** (`modifier_price_applied`) | 4 | $10,000$ | `$8.5000` | `85000` |
| **Tasas de Impuesto** (`tax_rate_applied`, IVA 16%) | 4 | $10,000$ | `0.1600` (16%) | `1600` |
| **Cantidades Fraccionarias** (`quantity`, 1 unidad) | 4 | $10,000$ | `1.0000` | `10000` |
| **Cantidades Fraccionarias** (`quantity`, 250 g) | 4 | $10,000` | `0.2500` kg | `2500` |

### 3.3 Rounding & Arithmetic Sequence
1. **Cálculo de Partida:**
   $$\text{subtotal} = \left\lfloor \frac{\text{unit\_price} \times \text{quantity} + 5000}{10000} \right\rfloor$$
   $$\text{net\_subtotal} = \text{subtotal} - \text{discount}$$
   $$\text{tax\_amount} = \left\lfloor \frac{\text{net\_subtotal} \times \text{tax\_rate} + 5000}{10000} \right\rfloor$$
   $$\text{total} = \text{net\_subtotal} + \text{tax\_amount}$$
2. **Modo de Redondeo:** *Half Away From Zero* comercial, computado exactamente con división entera: `(valor + 5000n) / 10000n`.
3. **Totales del Agregado de Cuenta:** Suma entera exacta de las partidas componentes:
   $$\text{cuentas.total\_amount} \equiv \sum \text{cuenta\_items.total}$$

### 3.4 Conversión y Value Object
- **Conversión Edge $\leftrightarrow$ Cloud:** Cadenas decimales fijas `(cents4 / 10000).toFixed(4)` en DTOs y payloads de sincronización.
- **Value Object `Money`:** Especificado para `@trident/core`, inmutable, respaldado por `bigint` a escala 4.

---

## 4. Package Topology & Composition Model (`ADR-013`)

### 4.1 Matriz de Responsabilidad de Paquetes
| Capa | Paquete | Bounded Context | ¿Lógica de Dominio? | Dependencias Runtime Permitidas | Persistencia / Rol |
|---|---|---|---|---|---|
| **Capa 1: Kernel** | `@trident/core` | Platform Core | NO | `[]` | Interfaces base, Value Objects (`Money`), criptografía, JWT, RBAC. |
| **Capa 2: Dominios** | `@trident/pos` | TRIDENTPOS | **SÍ** | `['@trident/core']` | Agregados `Mesa`, `Cuenta`, `Partida`, motor OCC, políticas neutrales. |
| **Capa 2: Dominios** | `@trident/inventory` | Inventory | **SÍ** | `['@trident/core']` | Insumos, multialmacén, motor de explosión de recetas, kárdex. |
| **Capa 2: Dominios** | `@trident/procurement`| Procurement | **SÍ** | `['@trident/core']` | Proveedores, compras, recepciones físicas. |
| **Capa 2: Dominios** | `@trident/finance` | Finance | **SÍ** | `['@trident/core']` | Tesorería, turnos de caja, cierres, arqueos, CxP/CxC. |
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
- **Dominio:** `@trident/pos` implementa la lógica pura de mesas, cuentas, comanda, OCC compare-and-swap y políticas neutrales (`CancellationPolicy`, `BillSplitProrationStrategy`). Depende únicamente de `@trident/core`.
- **Infraestructura:** `@trident/edge` provee `EdgeDatabaseService` (SQLite WAL) y `EdgeOutboxPersistence`.
- **Raíz de Composición:** `@trident/pos-edge-runtime` ensambla `@trident/pos` con `@trident/edge`:
  - Implementa los adaptadores de persistencia de salón sobre SQLite WAL.
  - Expone rutas Fastify LAN (`POST /cuentas`, `POST /ordenes/partidas`, `PUT /cuentas/:id/cerrar`).
  - Ejecuta transacciones atómicas `executeWithOutbox()`.
  - Aloja y ejecuta las pruebas de integración reales `WP014-T01` a `WP014-T14` (incluyendo la prueba de colisión OCC concurrente y el benchmark de latencia).
- **Validación de Frontera:** Cero importaciones entre `@trident/pos` y `@trident/edge`. El grafo se mantiene 100% acíclico y conforme a políticas de arquitectura.

### 5.2 Demostración para WP-017 (Inventory Catalog, Multi-Warehouse & Recipe Explosion)
- **Dominio:** `@trident/inventory` implementa catálogo de insumos, multialmacén, motor de explosión de recetas y costeo ponderado. Depende únicamente de `@trident/core`. Cero dependencia hacia `@trident/pos`.
- **Infraestructura:** `@trident/database` provee las migraciones y pools de PostgreSQL 16.
- **Raíz de Composición:** `@trident/cloud-server` inyecta los repositorios de PostgreSQL en `@trident/inventory` y expone las APIs al portal Backoffice.
- **Validación de Frontera:** Inventario opera de forma 100% autónoma. Cuando KDS en `WP-018` requiera descontar insumos, se comunicará mediante eventos durables de integración (`OrderCompletedEvent`) o contratos de capability en `@trident/core`, jamás mediante importación directa en tiempo de ejecución.

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
