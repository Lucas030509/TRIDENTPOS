# ACR-2026-013 R1 — INDEPENDENT PLATFORM ARCHITECTURE REVIEW

**Document ID:** `EVIDENCE-ACR-2026-013-PLATFORM-ARCH-REVIEW`  
**Reviewer Role:** `10_DevOps_Platform_Architect` (Independent Specialist Reviewer)  
**Date:** `2026-09-13`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Review Target:** `ACR-2026-013 R1`  
**Frozen Subject SHA:** `004d22c265988254a5c4581113965d242cdcf2bc`  
**Review Branch:** `review/acr-2026-013-r1-platform-architecture`  
**Base Commit:** `004d22c265988254a5c4581113965d242cdcf2bc`  
**Conflict of Interest Declaration:** The reviewer (`10_DevOps_Platform_Architect`) is NOT the author of the ACR (`01_Solution_Architect`).

---

## 1. Executive Summary & Verdict

As authorized by the EAAF Coordinator under `COORDINATOR_PROMPT_ACR2026013_INDEPENDENT_REVIEWS.md`, an independent Platform Architecture review was conducted against Frozen Subject commit `004d22c265988254a5c4581113965d242cdcf2bc`.

The review evaluated:
1. Four-layer monorepo package topology and hexagonal layering (`ADR-013`).
2. Internal consistency, mathematical acyclicity, and fail-closed enforcement of the proposed `ALLOWED_INTERNAL_DEPENDENCIES` and `ALLOWED_TEST_INTERNAL_DEPENDENCIES` specifications for `scripts/check-graph.mjs`.
3. Complete resolution of the `@trident/pos` $\leftrightarrow$ `@trident/edge` cross-import conflict with zero domain-to-infrastructure leakage.
4. Scope boundary and assembly semantics of Application Composition Roots (`@trident/pos-edge-runtime` and `@trident/cloud-server`).
5. Bounded context ownership disambiguation between TRIDENTPOS (`MOD-POS`) and Finance (`MOD-FIN`).
6. Architectural integrity of the dual role of Platform Core (`@trident/core`) as both Bounded Context and Shared Kernel.
7. Reciprocal parallelism constraints and branch topology for `WP-014` and `WP-017` in `IMPLEMENTATION_PLAN.md`.
8. Status and blast radius of advisory `ARCH-ADV-013-01` (`WP-016` bounded context label in `IMPLEMENTATION_PLAN.md`).

### Official Verdict: **PASS WITH ADVISORIES**
- **Blocking Findings:** 0
- **Advisory Findings:** 1 (`ARCH-ADV-013-01`)

The platform architecture changes in `ACR-2026-013 R1` provide a robust, decoupled, and fail-closed monorepo dependency model that definitively resolves the `WP-014` composition blocker and establishes the canonical template for `WP-017` and subsequent bounded contexts.

---

## 2. Technical Evaluation by Criteria

### 2.1 Four-Layer Hexagonal Monorepo Topology (`ADR-013`)
The proposed architecture formalizes monorepo packages into four strictly ordered layers:
- **Layer 1 — Platform Kernel (`@trident/core`):** Shared kernel primitives, exported interfaces/contracts, shared value objects (such as `Money`, `ADR-012`), and Platform Core domain logic (Organizations, Branches, Stations, Users/RBAC, Module Entitlements, Master Product Catalog, Modifiers, Overrides, Audit, Cryptography). Dependences: zero internal packages (`[]`).
- **Layer 2 — Pure Business Domains (10 Bounded Contexts):** `@trident/pos`, `@trident/inventory`, `@trident/procurement`, `@trident/finance`, `@trident/billing`, `@trident/crm`, `@trident/delivery`, `@trident/loyalty`, `@trident/analytics`, `@trident/integrations`.
  - Invariant: Depend **exclusively on `@trident/core`**.
  - Invariant: No domain package imports another domain package (`@trident/pos` $\not\leftrightarrow$ `@trident/inventory`).
  - Invariant: No domain package imports technical infrastructure (`@trident/pos` $\not\to$ `@trident/edge`, `@trident/inventory` $\not\to$ `@trident/database`).
- **Layer 3 — Technical Infrastructure Adapters:** `@trident/database` (PostgreSQL/Supabase), `@trident/edge` (Electron host, SQLite WAL, Outbox, IPC, Bonjour), `@trident/sync` (WebSocket sync protocol), `@trident/ui` (reusable UI design system primitives).
  - Invariant: Depend solely on `@trident/core`. Contain zero business domain logic.
- **Layer 4 — Application Composition Roots:** `@trident/pos-edge-runtime` and `@trident/cloud-server`.
  - Invariant: Executable processes/assemblers only (`can_implement` for domain code = NO). Wire concrete infrastructure adapters to domain repository ports, manage process lifecycle, and expose HTTP/IPC transport.

**Assessment:** The layering adheres strictly to Ports & Adapters (Hexagonal Architecture) and Clean Architecture principles. The layer flow is strictly unidirectional ($4 \to 2$, $4 \to 3$, $2 \to 1$, $3 \to 1$).

### 2.2 Internal Consistency & Fail-Closed Graph Enforcement
The specification for `scripts/check-graph.mjs` in Section 6 of `ARCHITECTURE_CHANGE_REQUEST_WP014_EXACT_NUMERICS_AND_COMPOSITION.md` and `ADR-013` was audited:
1. **Adjacency Matrix Validation:**
   - Every package in Layer 1 allows `[]`.
   - Every package in Layer 2 allows `['@trident/core']`.
   - Every package in Layer 3 allows `['@trident/core']` (with test-only exception `@trident/sync` allowing `@trident/edge` for integration testing).
   - Layer 4 packages declare explicit allowlists:
     - `@trident/pos-edge-runtime`: `['@trident/core', '@trident/pos', '@trident/edge']`.
     - `@trident/cloud-server`: `['@trident/core', '@trident/database', ...DOMAIN_PACKAGES, '@trident/sync']`.
2. **Acyclicity:** The graph is a Directed Acyclic Graph (DAG) with topological depth 3. No cycles exist in either runtime or test configurations.
3. **Fail-Closed Semantics:** Any package discovered in `packages/*` or `apps/*` not explicitly defined in `ALLOWED_INTERNAL_DEPENDENCIES` triggers immediate build failure (`ARCHITECTURAL_BOUNDARY_VIOLATION`).

**Assessment:** The dependency matrix is mathematically sound, fail-closed, and leaves no ambiguous paths.

### 2.3 Elimination of Domain $\leftrightarrow$ Infrastructure Coupling (`@trident/pos` vs `@trident/edge`)
The original pre-flight blocker for `WP-014` was the inability to link `@trident/pos` (domain) with `@trident/edge` (SQLite/Outbox persistence).
- Under `ADR-013`, `@trident/pos` defines domain repository ports (`DiningRoomRepositoryPort`, `AccountRepositoryPort`) and depends exclusively on `@trident/core`.
- `@trident/edge` exposes infrastructure services (`EdgeDatabaseService`, `EdgeOutboxPersistence`) and depends exclusively on `@trident/core`.
- The new composition package `@trident/pos-edge-runtime` imports both and implements `SqliteDiningRoomRepository` and `SqliteAccountRepository` on top of `EdgeDatabaseService`.
- There are **zero cross-imports** between `@trident/pos` and `@trident/edge`.

**Assessment:** Confirmed. The circularity hazard and layer-skipping dilemma are completely eliminated.

### 2.4 Composition Roots Scoping (`can_implement` Domain Code = NO)
Section 4.3 of `ADR-013` and Section 4 of `ACR-2026-013` explicitly mandate:
- Composition roots contain **no domain models, no business invariants, and no business validation rules**.
- Their sole remit is:
  1. Bootstrapping Fastify or Cloud HTTP/WebSocket daemons.
  2. Instantiating adapters and injecting them into domain command/query handlers.
  3. Translating external DTOs into domain value objects and commands.
  4. Hosting end-to-end integration and concurrency test suites against concrete persistence engines (e.g. SQLite WAL).

**Assessment:** Confirmed. The boundary prevents composition roots from becoming "fat monoliths" or domain bypass paths.

### 2.5 TRIDENTPOS vs Finance Bounded Context Ownership
The frozen diff was cross-checked across all amended documents (`ADR-013`, `SOLUTION_ARCHITECTURE.md`, `ACR-2026-013`, `IMPLEMENTATION_PLAN.md`):
- **TRIDENTPOS (`@trident/pos`):** Unambiguously owns all operational restaurant and floor cash management:
  - Salones, Mesas, Cuentas, Comandas, KDS LAN.
  - Turnos de Caja (`turnos_caja`), Apertura con fondo inicial.
  - Movimientos de Efectivo (entradas/salidas de caja chica en turno).
  - Cobro POS (`pagos`, split payments, propinas operativas).
  - Arqueo Ciego de Turno.
  - Emisión de Cortes X (parcial) y Cortes Z (cierre fiscal diario de sucursal).
- **Finance (`@trident/finance`):** Unambiguously owns corporate treasury and central accounting:
  - Cuentas por Pagar (CxP), Cuentas por Cobrar (CxC / crédito a clientes).
  - Gastos corporativos, liquidación contable de propinas, comisiones de agentes.
  - Conciliación bancaria contra extractos.
  - Interfaz contable / pólizas diarias generadas a partir de eventos consumidos (`CorteZGenerado`, `TurnoCajaCerrado`).

**Assessment:** Confirmed. The separation of operational POS cash handling (TRIDENTPOS) from corporate financial accounting (Finance) is rigorously defined across all core architecture documents.

### 2.6 Platform Core Dual Role Integrity
`@trident/core` fulfills two roles:
1. **Shared Kernel:** Core contracts, interfaces, common error types, and cross-cutting Value Objects (`Money`).
2. **Platform Core Bounded Context:** Multi-tenancy (Organization, Branch, Station), User Identity/RBAC, Module Entitlements, Master Product Catalog, Modifiers, Branch Overrides, and Cryptographic/Audit primitives.

**Verification:** The dual role does not permit business domains to bypass contracts. Business domains interact with Platform Core concepts exclusively through exported types and capability interfaces. Platform Core itself has zero internal dependencies (`[]`), preventing any backchannel coupling.

### 2.7 Reciprocal Parallelism for WP-014 and WP-017
In `IMPLEMENTATION_PLAN.md`:
- `WP-014` (line 618):
  `* **Parallelizable:** YES — with WP-017 only after ACR-2026-013 and graph-enforcement remediation are canonical on main. Independent sibling branches from the same current canonical main baseline.`
- `WP-017` (line 704):
  `* **Parallelizable:** YES — with WP-014 only after ACR-2026-013 and graph-enforcement remediation are canonical on main. Independent sibling branches from the same current canonical main baseline.`

**Assessment:** Both work packages declare exact reciprocal parallelism. The gating condition is explicitly and strictly conditioned upon `ACR-2026-013` and the subsequent graph-enforcement remediation becoming canonical on `main`.

### 2.8 Reconfirmation of Advisory ARCH-ADV-013-01
- **Observation:** In `IMPLEMENTATION_PLAN.md` line 649 (`WP-016`), the metadata field reads:
  `* **Bounded Context:** TRIDENTPOS / Finance`
- **Analysis:**
  - `WP-016` covers Cash Management, Shifts & Arqueo Ciego (Cortes X & Z).
  - As established in `ADR-013` Section 4.2 and `MODULE_CATALOG.md` Section 2, all physical tables (`turnos_caja`, `movimientos_caja`, `cortes_caja`, `arqueos_ciegos`) and operational aggregates belong strictly to the TRIDENTPOS bounded context (`MOD-POS`).
  - Finance is an asynchronous event subscriber to the resulting `CorteZGenerado` event.
  - The slash notation `TRIDENTPOS / Finance` in `WP-016` is a legacy label describing operational downstream consumption, not shared package ownership.
- **Impact on Current Work:**
  - Does this affect `WP-014`? **NO.** `WP-014` pertains to Dining Room, Tables & Orders Domain Engine (`@trident/pos`).
  - Does this affect `WP-017`? **NO.** `WP-017` pertains to Inventory Catalog & Recipes (`@trident/inventory`).
  - Does this affect `scripts/check-graph.mjs`? **NO.** `scripts/check-graph.mjs` governs package dependencies, not work package headers.
- **Remediation Requirement:** Prior to launching `WP-016`, the line in `IMPLEMENTATION_PLAN.md` must be updated to:
  `* **Bounded Context:** TRIDENTPOS (Downstream Event Consumer: Finance)`
- **Classification:** **NON-BLOCKING ADVISORY** (`ARCH-ADV-013-01`).

---

## 3. Finding Matrix

| ID | Severity | Category | Description | Disposition |
|---|---|---|---|---|
| `ARCH-ADV-013-01` | ADVISORY | Documentation Consistency | `IMPLEMENTATION_PLAN.md` line 649 labels `WP-016` bounded context as `TRIDENTPOS / Finance`. To prevent ambiguity before `WP-016` execution, update label to `TRIDENTPOS` with explicit downstream consumption note for Finance. Does not block `WP-014` or `WP-017`. | RECONFIRMED NON-BLOCKING |

---

## 4. Final Sign-off

The Platform Architecture proposed under `ACR-2026-013 R1` (Frozen Subject `004d22c265988254a5c4581113965d242cdcf2bc`) is structurally sound, enforces clean hexagonal boundaries, guarantees fail-closed graph enforcement, and provides clear execution tracks for both `WP-014` and `WP-017`.

**Reviewer:** `10_DevOps_Platform_Architect`  
**Verdict:** **PASS WITH ADVISORIES** (0 blockers, 1 advisory: `ARCH-ADV-013-01`)  
**Status:** Signed and frozen for Coordinator synthesis.
