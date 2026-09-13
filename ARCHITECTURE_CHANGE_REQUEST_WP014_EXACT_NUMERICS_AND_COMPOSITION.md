# ARCHITECTURE CHANGE REQUEST: WP-014 / WP-017 EDGE EXACT NUMERICS & BUSINESS MODULE COMPOSITION ARCHITECTURE REMEDIATION

> [!NOTE]
> **ACR-2026-013 PROPOSED ARCHITECTURE CHANGE — PENDING INDEPENDENT REVIEWS AND PRODUCT OWNER APPROVAL**
> 
> This document constitutes a formal Architecture Change Request under EAAF v1.2.0. Authored by `01_Solution_Architect` to resolve the formal pre-flight blockers identified prior to WP-014 implementation (`WP-014 PRE-FLIGHT MONETARY REPRESENTATION CONFLICT` and `WP-014 PRE-FLIGHT PACKAGE COMPOSITION BLOCKER`) and establish the canonical composition model for WP-017 and future bounded contexts.

**ID:** `ACR-2026-013`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester / Primary Author:** `01_Solution_Architect — ARCHITECTURE CHANGE AUTHOR`  
**Governing Work Package:** `WP-014` (Dining Room, Tables & Orders Domain Engine with OCC) & `WP-017` (Inventory)  
**Date:** `2026-09-13`  
**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`  
**Base Commit:** `0c43c325b8ae90970c267b2356eb229f61deaa4c` (`M13`)  
**Classification:** `CORE ARCHITECTURAL HARMONIZATION & CROSS-CUTTING TOPOLOGY SPECIFICATION`  
**Referenced ADRs:** `ADR-001`, `ADR-002`, `ADR-004`, `ADR-006`, `ADR-012` (New), `ADR-013` (New)  

---

## 1. Executive Summary & Problem Statement

During the formal Pre-Flight evaluation of Work Package `WP-014: Dining Room, Tables & Orders Domain Engine with OCC`, the Builder (`16_Native_Edge_Developer`) halted execution upon identifying two critical architectural inconsistencies within the frozen baseline:

1. **`WP-014 PRE-FLIGHT MONETARY REPRESENTATION CONFLICT`:**
   A direct contradiction in the frozen Data Model (`DATA_MODEL.md`):
   - **General Conventions (Section 1, Line 21):** Expressly mandates `DECIMAL(12, 4)` in Cloud and `INTEGER` en centavos o `DECIMAL(12, 4)` en Edge, with an absolute prohibition against floating point: *"Prohibido punto flotante (`REAL` / `FLOAT`)."*
   - **SQLite Local Edge DDL (Section 3, Lines 840–875):** Defines all operational monetary columns in `cuentas`, `cuenta_items`, `cuenta_item_modificadores`, `turnos_caja` and `pagos` using the IEEE 754 floating-point type `REAL` (e.g., `subtotal REAL NOT NULL DEFAULT 0.0`, `unit_price_applied REAL NOT NULL`, `total REAL NOT NULL`).
   - **Data Dictionary (Section 1.2, Lines 118–119):** Specifies `DECIMAL(12,4)` and `DECIMAL(6,4)`.
   - Floating-point arithmetic on restaurant orders causes non-deterministic rounding errors, associative calculation drift, and failure to comply with fiscal precision regulations.

2. **`WP-014 PRE-FLIGHT PACKAGE COMPOSITION BLOCKER`:**
   A structural composition conflict in the monorepo:
   - Current monorepo policy (`scripts/check-graph.mjs`) strictly enforces `ALLOWED_INTERNAL_DEPENDENCIES = { '@trident/pos': ['@trident/core'], '@trident/edge': ['@trident/core'], ... }`.
   - Neither `@trident/pos -> @trident/edge` nor `@trident/edge -> @trident/pos` is permitted in runtime or test manifests.
   - However, `WP-014` requires TRIDENTPOS domain logic (`Mesa`, `Cuenta`, `CuentaItem`, OCC), atomic SQLite WAL transactions (`EdgeDatabaseService`), atomic Outbox event insertion (`EdgeOutboxPersistence`), and local REST endpoints (Fastify).
   - Placing domain logic in `@trident/edge` violates Bounded Context boundaries by turning the host runtime into a restaurant domain engine. Conversely, importing `@trident/edge` into `@trident/pos` violates graph policy and architectural layering.
   - Furthermore, future Work Packages such as `WP-017` (Inventory) lack a designated package in the monorepo and would face the identical roadblock when attempting to integrate with PostgreSQL persistence (`@trident/database`).

This Architecture Change Request formally resolves both blockers by establishing:
1. An unambiguous, exact fixed-point storage standard for Edge SQLite (`INTEGER` at scale 4, $1.0000 = 10,000$).
2. A clean, hexagonal 4-layer monorepo package topology that separates pure business domains, technical infrastructure adapters, and executable composition roots.

---

## 2. Invariant Governance Constraints

Pursuant to EAAF v1.2 governance directives:
1. **Neutrality on Protected Product Owner Decisions:** All nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly `PENDING PO DECISION`. This ACR does not implement, close, or favor any business policy.
2. **Zero Product Runtime Code Changes:** This architecture change candidate modifies only architectural and specification documents; it does NOT alter runtime application source code, does NOT alter `scripts/check-graph.mjs`, and does NOT implement `WP-014` or `WP-017`.
3. **Additive / Expand Migration Compatibility:** No destructive changes are made to existing databases. The affected tables do not yet exist in any deployed production environment.
4. **Preservation of Security, Multi-Tenancy & Durability:** Full Suite data authority (`Edge SQLite` for active floor operations, `Cloud PostgreSQL` for master catalogs), SQLite WAL mode with dual sync pragmas (`NORMAL`/`FULL` per `ADR-004`), and multi-tenant RLS boundaries remain entirely intact.

---

## 3. Decision 1: Edge Exact Fixed-Point Monetary Representation (`ADR-012`)

### 3.1 Canonical Physical Storage & Lifecycle Nullability
In all Edge SQLite tables, **every persisted monetary amount, unit price, modifier price, tax rate, discount, tip, and fractional quantity is stored as an exact signed 64-bit `INTEGER` with a fixed scale of 4 decimal places** (Scale Factor $S = 10^4 = 10,000$).

Column nullability remains governed by the domain lifecycle and data model of each individual field. Transactional balances, line items, and totals are `INTEGER NOT NULL`. Fields that are intentionally unpopulated prior to specific business lifecycle events (such as `turnos_caja.closing_declared_cash`, `calculated_cash_total`, and `cash_difference`) remain `INTEGER NULL` while the shift is open and are populated only upon shift close and reconciliation.

The use of `REAL`, `FLOAT`, or unscaled IEEE 754 floating-point numbers is **permanently prohibited** in all Edge schemas, queries, and network payloads.

### 3.2 Canonical Scale, Cloud Precision Taxonomy & Interoperable Range
- **Cloud Precision Taxonomy:**
  - Monetary amounts, prices, costs, and quantities: Cloud `DECIMAL(12,4)`.
  - Tax rates (`tax_rate_applied`): Cloud `DECIMAL(6,4)` (e.g. 16% IVA = `0.1600`).
  - Other ratios: Explicitly governed Cloud precision.
  - Edge SQLite represents all the above using scale-4 `INTEGER` ($S = 10,000$, where `$1.0000 = 10000`, and `0.1600 = 1600`).
- **Common Interoperable Range:**
  The interoperable range is bounded by the stricter Cloud PostgreSQL type `DECIMAL(12,4)` (12 total digits, 4 fractional, 8 integer), establishing the canonical valid range as:
  $$\mathbf{[-99,999,999.9999, +99,999,999.9999]}$$
  corresponding to Edge scale-4 integers in the range $\mathbf{[-999999999999, +999999999999]}$ ($\mathbf{[-999\_999\_999\_999\text{n}, +999\_999\_999\_999\text{n}]}$). Explicit boundary checks must validate values prior to persistence, arithmetic result acceptance, synchronization, and Cloud serialization. Values outside this range are rejected.
- **BigInt Domain Authority:**
  All authoritative domain calculations in TypeScript are executed exclusively using native `bigint`. JavaScript `number` is strictly prohibited for authoritative financial arithmetic.

### 3.3 Rounding, Arithmetic Sequence & SQLite Aggregates
- **Project Canonical Rounding Mode:**
  **Half Away From Zero** is established as the project's canonical rounding mode, executed via the sign-safe primitive:
  $$\text{roundDiv}(A, B) = \text{sign}(A \times B) \times \left\lfloor \frac{|A| + \lfloor |B| / 2 \rfloor}{|B|} \right\rfloor \quad (\text{with } B \neq 0)$$
  *Normative Test Vectors:*
  - `roundDiv(5000n, 10000n) = 1n`
  - `roundDiv(-5000n, 10000n) = -1n`
  - `roundDiv(14999n, 10000n) = 1n`
  - `roundDiv(-14999n, 10000n) = -1n`
  - `roundDiv(15000n, 10000n) = 2n`
  - `roundDiv(-15000n, 10000n) = -2n`
- **Authoritative Line Arithmetic:**
  $$\text{lineSubtotal} = \text{roundDiv}(\text{unitPriceScale4} \times \text{quantityScale4}, 10000\text{n})$$
  $$\text{netSubtotal} = \text{lineSubtotal} - \text{discountAmountScale4}$$
  $$\text{taxAmount} = \text{roundDiv}(\text{netSubtotal} \times \text{taxRateScale4}, 10000\text{n})$$
  $$\text{lineTotal} = \text{netSubtotal} + \text{taxAmount}$$
- **Account Total Invariant:** Account totals (`subtotal`, `tax_total`, `discounts_total`, `total_amount`) are computed exclusively as the exact integer sum of line item components:
  $$\text{cuentas.total\_amount} \equiv \sum \text{cuenta\_items.total}$$
- **SQLite Aggregate Semantics:**
  - *Permitted:* `MIN(integer)`, `MAX(integer)`, and `SUM(integer)` provided every input is an `INTEGER`, application/database bounds ensure no signed 64-bit overflow, and any overflow condition fails explicitly.
  - *Prohibited:* `AVG()` and `TOTAL()` are prohibited for authoritative monetary values because SQLite returns IEEE 754 floating point (`REAL`). Averages must be computed as `sumScale4 = SUM(col)`, `count = COUNT(col)`, and `averageScale4 = roundDiv(sumScale4, count)` using BigInt.

### 3.4 Transport & Synchronization Boundary (Float-Free String Standard)
- **External JSON Representation:** In all external Fastify LAN REST APIs, WebSocket events, and Cloud synchronization payloads, monetary and quantity values are formatted as **canonical fixed 4-decimal strings** (e.g. `"150.5000"`, `"0.0001"`, `"-0.0001"`, `"-150.5000"`). Ambiguous dual representation (`string OR number`) in external JSON is eliminated.
- **Conversion Algorithms (Zero Floating-Point):**
  - Scaled Integer $\to$ Decimal String: Integer division and modulo formatting (`whole.toString() + "." + fraction.toString().padStart(4, "0")`) with sign preservation.
  - Decimal String $\to$ Scaled BigInt: Strict lexical parsing against `/^-?\d+\.\d{4}$/`.
  - Prohibited: `Number()`, `parseFloat()`, `parseInt(decimal * 10000)`, `/ 10000.0`, `toFixed()`, `Math.round()`.
- **Platform Core Value Object:** Canonical `Money` value object specified in `@trident/core`, backed by `amountScale4: bigint`.

---

## 4. Decision 2: Bounded-Context Monorepo Package Topology (`ADR-013`)

### 4.1 Layered Architecture Model
The TRIDENTPOS codebase is organized into four distinct architectural layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Composition Roots (Assembly & Lifecycle Executables)          │
│ • @trident/pos-edge-runtime (Edge LAN Fastify Host & DB Wiring)        │
│ • @trident/cloud-server     (Cloud API Gateway & Modular Monolith Root)│
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
┌────────────────────────────────────┐   ┌───────────────────────────────┐
│ Layer 2: Business Domain Packages  │   │ Layer 3: Technical Infra      │
│ • @trident/pos                     │   │ • @trident/database (PG 16)   │
│ • @trident/inventory               │   │ • @trident/edge (SQLite Host) │
│ • @trident/procurement             │   │ • @trident/sync (WebSocket)   │
│ • @trident/finance                 │   │ • @trident/ui (Components)    │
│ • @trident/billing                 │   │                               │
│ • @trident/crm                     │   │                               │
│ • @trident/delivery                │   │                               │
│ • @trident/loyalty                 │   │                               │
│ • @trident/analytics               │   │                               │
│ • @trident/integrations            │   │                               │
└───────────────────┬────────────────┘   └───────────────┬───────────────┘
                    │                                    │
                    └────────────────┬───────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Platform Kernel & Bounded Context (@trident/core)             │
│ Shared capability contracts, Platform Core domain logic & entities     │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Structural Rules & Adjacency Policy
1. **Platform Core (Layer 1):**
   - `@trident/core` represents **both** the Platform Core bounded context and the stable public kernel/capability contract surface.
   - Owns domain logic for Organization, Branch, StationIdentity, User/RBAC, Module Entitlements, Master Product Catalog, Modifiers, Branch Overrides, Audit primitives, and Value Objects (`Money`).
   - Other business domains depend solely on the stable public contracts and export surface of `@trident/core`.
2. **Domain Package Invariants (Layer 2):**
   - Dedicated package per business bounded context (`@trident/pos`, `@trident/inventory`, `@trident/finance`, etc.).
   - `@trident/pos` owns: Dining Room, Tables, Accounts, Orders, Floor Comandas, KDS LAN, Cash Shifts (`turnos_caja`), Cash Movements, POS Payment Processing (`pagos`), Blind Cash Counts (Arqueos), Daily X Cuts, and Daily Z Cuts.
   - `@trident/finance` owns: Central Treasury, Accounts Payable (AP), Accounts Receivable (AR / Customer Credit), Operating Expenses, Tip Settlements, Agent Commissions, Bank Reconciliation, and Accounting Journal Interface.
   - **Allowed Runtime Dependencies:** `['@trident/core']` ONLY.
   - **Prohibitions:** A domain package MUST NOT depend on any other domain package. A domain package MUST NOT depend on any technical infrastructure package (`@trident/database`, `@trident/edge`).
3. **Infrastructure Package Invariants (Layer 3):**
   - Infrastructure packages encapsulate concrete storage drivers, host APIs, or transport mechanisms (`@trident/database`, `@trident/edge`, `@trident/sync`, `@trident/ui`).
   - **Allowed Runtime Dependencies:** `['@trident/core']` ONLY.
   - Infrastructure packages MUST NOT contain business domain rules.
4. **Composition Root Invariants (Layer 4):**
   - Composition packages contain zero domain logic. Their sole responsibility is process bootstrap, configuration, route mapping, dependency injection (wiring repository implementations to domain ports), and integration test execution.
   - `@trident/pos-edge-runtime`: Permitted to depend on `['@trident/core', '@trident/pos', '@trident/edge']`.
   - `@trident/cloud-server`: Permitted to depend on `['@trident/core', '@trident/database', ...approved domain packages]`.

---

## 5. Walkthrough of Blocked Work Packages

### 5.1 WP-014 Execution Path (TRIDENTPOS Floor Engine)
Under this ratified architecture:
1. `@trident/pos` implements:
   - Entities and Aggregates: `Mesa`, `Cuenta`, `CuentaItem`, `CuentaItemModificador`, `TurnoCaja`.
   - OCC Engine: CAS version increment, conflict detection, snapshot extraction.
   - Policy Contracts: `CancellationPolicy` and `BillSplitProrationStrategy` (parameterized, 0 default business behavior).
   - Ports: `IDiningRoomRepository`, `IAccountRepository`.
2. `@trident/edge` remains pure infrastructure:
   - Proves `EdgeDatabaseService` (SQLite WAL) and `EdgeOutboxPersistence` (atomic outbox transactions).
3. `@trident/pos-edge-runtime` provides the assembly:
   - Implements `SqliteDiningRoomRepository` and `SqliteAccountRepository` adapting `@trident/pos` ports to `EdgeDatabaseService`.
   - Hosts Fastify LAN server (`POST /cuentas`, `POST /ordenes/partidas`, `PUT /cuentas/:id/cerrar`).
   - Executes atomic domain + outbox mutations via `EdgeOutboxPersistence.executeWithOutbox()`.
   - Executes integration tests `WP014-T01` through `WP014-T14` against real SQLite WAL files without violating package boundaries.

### 5.2 WP-017 Execution Path (Inventory Catalog & Recipes)
Under this ratified architecture:
1. `@trident/inventory` will be created as a pure domain package depending solely on `@trident/core`.
2. Owns multi-warehouse entities, raw materials (Insumos), standard units of measure, and recursive recipe explosion logic with yield and waste calculations.
3. Defines `ModifierRecipeResolver` contract (parameterized per `OQ-SSOT-07`).
4. `@trident/database` houses PostgreSQL 16 migrations for canonical physical inventory tables: `warehouses`, `ingredients`, `recipes`, and `recipe_items` (with tenant-safe candidate keys and composite foreign references) and RLS default-deny policies. Queda prohibida la introducción de tablas duplicadas en español (`insumos`, `almacenes`, `recetas`, `subrecetas`).
5. `@trident/cloud-server` wires `@trident/database` repositories to `@trident/inventory` domain services.
6. Zero dependency on `@trident/pos`. Standalone operation guaranteed. Cross-context inventory depletion upon kitchen completion in `WP-018` is performed via the canonical durable event `OrdenProduccionConfirmadaEnKDS`.

---

## 6. Specification for `18_DevOps_Engineer` (Graph Checker Update)

The DevOps engineer will update `scripts/check-graph.mjs` to reflect the ratified package classification:

```javascript
export const ALLOWED_INTERNAL_DEPENDENCIES = {
  // Layer 1: Kernel
  '@trident/core': [],

  // Layer 2: Business Domains (Domain purity: Core only)
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

  // Layer 3: Technical Infrastructure (Infra purity: Core only)
  '@trident/database': ['@trident/core'],
  '@trident/edge': ['@trident/core'],
  '@trident/sync': ['@trident/core'],
  '@trident/ui': ['@trident/core'],

  // Layer 4: Composition Roots (Explicit wiring allowlists)
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

**Fail-Closed Invariant:** Any internal package discovered in the workspace that is not explicitly registered in `ALLOWED_INTERNAL_DEPENDENCIES` must be rejected immediately with an architectural violation error.

---

## 7. Traceability of Proposed Document Amendments

The following canonical architecture documents are amended with this change request (labeled `PROPOSED ARCHITECTURE CHANGE`):
1. **`DATA_MODEL.md`:**
   - Section 1 (Line 26): Normalized to define signed `INTEGER` (Fixed-Point Scale 4: factor $10^4 = 10,000$) as the mandatory physical storage for Edge SQLite, distinguishing Cloud `DECIMAL(12,4)` for amounts/quantities and `DECIMAL(6,4)` for tax rates, eliminating ambiguity and floating-point types.
   - Section 2.3: Normalized Cloud Inventory physical schema with tenant-safe candidate keys and composite foreign references for `warehouses`, `ingredients`, `recipes`, and `recipe_items`, an exclusivity constraint on recipe items, and default-deny RLS specifications.
   - Section 3 (Lines 805–918): Replaced all `REAL` monetary and quantity columns in Edge SQLite DDL with `INTEGER` (representing scale-4 fixed-point units) while preserving lifecycle-appropriate nullability (e.g. `turnos_caja.closing_declared_cash INTEGER NULL`).
2. **`DATA_DICTIONARY.md`:**
   - Section 1.2: Updated data types for `cuentas`, `cuenta_items`, `turnos_caja`, and `pagos` to reflect `INTEGER (Scale 4)` in Edge SQLite.
3. **`DATA_ARCHITECTURE.md`:**
   - Section 2.1: Documented the exact fixed-point storage standard, common interoperable range `[-99,999,999.9999, +99,999,999.9999]`, sign-safe Half Away From Zero rounding, and lexical string transport.
4. **`TECH_STACK_DECISIONS.md`:**
   - Documented the Edge exact numerics decision, BigInt authority, and layered monorepo composition model.
5. **`SOLUTION_ARCHITECTURE.md`:**
   - Documented the 4-layer monorepo package topology, Platform Core dual role, TRIDENTPOS/Finance boundaries, and composition root pattern.
6. **`IMPLEMENTATION_PLAN.md`:**
   - Updated `WP-014` and `WP-017` descriptions to reflect package placement, reciprocal parallelism, canonical physical table names (`warehouses`, `ingredients`, `recipes`, `recipe_items`), and composition roots.
