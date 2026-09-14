# ARCHITECTURE CHANGE REQUEST: PLATFORM CORE MASTER CATALOG PHYSICAL PREREQUISITE FOR WP-017

> [!NOTE]
> **ACR-2026-014 PROPOSED ARCHITECTURE CHANGE — PENDING INDEPENDENT REVIEWS AND PRODUCT OWNER APPROVAL**
>
> This document constitutes a formal Architecture Change Request under EAAF v1.2.0. Authored by `01_Solution_Architect` in coordination with `03_Data_Architect` to resolve the architectural prerequisite blocker identified during Coordinator inspection of `WP-017` candidate `S17-R1` (unauthorized creation of a partial `products` table within the Inventory migration) and establish the canonical Platform Core Master Catalog physical foundation.

**ID:** `ACR-2026-014`  
**Title:** Platform Core Master Catalog Physical Prerequisite for WP-017  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester / Primary Author:** `01_Solution_Architect` (in coordination with `03_Data_Architect`)  
**Governing Work Packages:** `WP-017` (Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine) and new prerequisite `WP-016B` (Platform Core Master Catalog Foundation)  
**Date:** `2026-09-13`  
**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW`  
**Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df` (`main`)  
**Classification:** `CORE DOMAIN ARCHITECTURAL RECTIFICATION & PREREQUISITE SEQUENCING`  
**Referenced ADRs:** `ADR-001`, `ADR-002`, `ADR-004`, `ADR-013`, `ADR-014`  

---

## A. Problem Statement

During Coordinator inspection of Work Package `WP-017: Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine` candidate `S17-R1` (`20398d68de7ecb8017df1731ee5fa5e1c7a66098`), execution was placed on **HOLD** due to a fundamental architectural and prerequisite ordering defect:

1. **Unauthorized Domain Ownership & Partial Table Creation:**  
   Candidate `S17-R1` attempted to resolve a missing database dependency by authoring a local `products` table inside the WP-017 database migration (`20260904230000_inventory_catalog_and_recipes.sql`). The resulting table was structurally incomplete (omitting canonical columns `category_id`, `product_type`, `tax_scheme_id`, and `deleted_at`).
2. **Domain Boundary Violation:**  
   Under the frozen SSOT (`MODULE_CATALOG.md`), `products` belongs to **Platform Core** (`MOD-CORE`), not **Inventory** (`MOD-INV`). Inventory consumes products; it does not define, own, or migrate master catalog tables.
3. **Missing Canonical Migration in Baseline:**  
   The current canonical baseline (`38062575ceed063c8f03af5a5c473d140dd264df`) contains no physical PostgreSQL migration creating `categories` or `products`. Because the canonical inventory data model requires `recipes` to reference `products` via composite foreign key (`FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)`), `WP-017` cannot be implemented cleanly without a physical prerequisite.
4. **Transaction Boundary Fragility (`QI-017-06`):**  
   In `S17-R1`, `PostgresCloudInventoryService` accepted a raw `pg.PoolClient` and invoked `setTenantContext()`, relying on transaction-local PostgreSQL configuration without enforcing an atomic `BEGIN ... COMMIT / ROLLBACK` boundary internally. This forced callers to manually manage transaction lifecycle.

This Architecture Change Request formally resolves these issues by specifying the minimum Platform Core Master Catalog physical prerequisite, defining its schema and RLS policies, updating the Implementation Plan with an additive work package, establishing transaction boundary rules for cloud services, and prescribing the clean restart strategy for WP-017.

---

## B. Current Canonical Baseline

- **Repository:** `Lucas030509/TRIDENTPOS`
- **Canonical Baseline Commit:** `38062575ceed063c8f03af5a5c473d140dd264df` (`main`)
- **Current Canonical Database Migrations (7 total):**
  1. `20260904160000_baseline_infrastructure.sql` (UUID extensions)
  2. `20260904170000_tenant_rls_foundation.sql` (`organizations`, `branches`, RLS helpers)
  3. `20260904180000_cloud_iam_auth.sql` (`users`, `roles`, `user_roles`, `user_branch_credentials`)
  4. `20260904190000_cloud_audit_trail.sql` (`stations`, `audit_log_events`, `security_telemetry_events`)
  5. `20260904200000_folio_leases.sql` (`folio_leases`)
  6. `20260904210000_transactional_outbox_idempotency.sql` (`ingested_idempotency_log`, `reordering_buffer_queue`)
  7. `20260904220000_sync_checkpoints_and_telemetry.sql` (`sync_checkpoints`, `sync_telemetry_events`)
- **Affected Implementation Candidate:** `WP-017 S17-R1` (`20398d68de7ecb8017df1731ee5fa5e1c7a66098`) on `feature/wp-017-inventory-recipes`.
- **Current Disposition:** `WP-017` is on **HOLD**. `S17-R1` is non-canonical and must NOT become the product baseline.

---

## C. Frozen Architecture Conflict

1. **`MODULE_CATALOG.md` (v1.3 APPROVED / FROZEN, Lines 66–86):**  
   Explicitly designates `MOD-01: Platform Core (Kernel Compartido y Catálogo Maestro)` as the exclusive owner of:
   > `Organization`, `Branch`, `StationIdentity`, `User`, `SecurityProfile`, `ModuleEntitlement`, `Producto`, `CategoriaProducto`, `Menu`, `GrupoModificador`, `Modificador`, `PrecioBase`, `BranchOverride`, `AuditLogEntry`.
   Inventory (`MOD-03: Inventory & Recetas`, Lines 116–135) owns:
   > `Almacen`, `Insumo`, `InsumoElaborado`, `PresentacionCompra`, `UnidadMedida`, `Receta`, `MovimientoAlmacen`, `KardexEntry`, `RegistroMerma`, `InventarioFisico`, `SaldoInventarioDiferido`.
2. **`DATA_MODEL.md` (v1.1, Sec. 2.1 & 2.3):**  
   - Section 2.1 specifies the canonical schema for `categories` and `products` under Bounded Context 1 (Platform Core).
   - Section 2.3 defines `recipes` under Bounded Context 3 (Inventory) with the relational invariant:
     ```sql
     CONSTRAINT fk_recipes_product FOREIGN KEY (organization_id, product_id)
     REFERENCES products(organization_id, id)
     ```
3. **`IMPLEMENTATION_PLAN.md` (v1.2, Line 691):**  
   `WP-017` lists its prerequisites as `Prerequisites: WP-004`. However, `WP-004` only scaffolds `organizations` and `branches`. No work package in Waves 0 through 4 was tasked with creating the physical `categories` and `products` tables. This represents a structural omission in the frozen implementation plan.

---

## D. Ownership Analysis

| Artifact / Table | Canonical Bounded Context Owner | Implementation Monorepo Package | Governance Disposition |
| :--- | :--- | :--- | :--- |
| `categories` | Platform Core (`MOD-CORE`) | `@trident/database` (DDL/RLS) | **Must be owned by Platform Core Prerequisite** |
| `products` | Platform Core (`MOD-CORE`) | `@trident/database` (DDL/RLS) | **Must be owned by Platform Core Prerequisite** |
| `modifier_groups` | Platform Core (`MOD-CORE`) | `@trident/database` (DDL/RLS) | Deferred (not required for WP-017 recipes) |
| `modifiers` | Platform Core (`MOD-CORE`) | `@trident/database` (DDL/RLS) | Deferred (not required for WP-017 recipes) |
| `branch_product_overrides` | Platform Core (`MOD-CORE`) | `@trident/database` (DDL/RLS) | Deferred (not required for WP-017 recipes) |
| `warehouses` | Inventory (`MOD-INV`) | `@trident/database` (DDL/RLS) / `@trident/inventory` | Owned by `WP-017` |
| `ingredients` | Inventory (`MOD-INV`) | `@trident/database` (DDL/RLS) / `@trident/inventory` | Owned by `WP-017` |
| `recipes` | Inventory (`MOD-INV`) | `@trident/database` (DDL/RLS) / `@trident/inventory` | Owned by `WP-017` |
| `recipe_items` | Inventory (`MOD-INV`) | `@trident/database` (DDL/RLS) / `@trident/inventory` | Owned by `WP-017` |

**Invariant:** Inventory (`@trident/inventory`) depends only on `@trident/core`. It must NEVER own, create, or modify Platform Core catalog tables.

---

## E. Current Physical Schema Gap

In candidate `S17-R1`, the builder generated `20260904230000_inventory_catalog_and_recipes.sql` containing:
```sql
-- NON-CANONICAL TABLE IN WP-017 S17-R1:
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_price DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ...
);
```
Deficiencies of this surrogate schema:
- Violates domain boundaries by mixing Core and Inventory DDL.
- Lacks `category_id UUID NOT NULL REFERENCES categories(...)`.
- Lacks `product_type VARCHAR(50) NOT NULL` (mandatory discriminator: `SIMPLE`, `COMPOSITE`, `PACKAGE`).
- Lacks `tax_scheme_id UUID NOT NULL`.
- Lacks `is_inventoriable BOOLEAN NOT NULL DEFAULT TRUE`.
- Lacks soft-deletion `deleted_at TIMESTAMPTZ NULL`.

This ad-hoc table is strictly rejected and must never reach canonical status.

---

## F. Minimum Platform Core Catalog Prerequisite

To maintain strict minimality while adhering to the frozen SSOT, the prerequisite physical schema consists of exactly two (2) Platform Core tables:

1. **`categories`** (Direct prerequisite for `products.category_id`):
   - Category hierarchy root with tenant isolation.
2. **`products`** (Direct prerequisite for `recipes.product_id`):
   - Master product definition strictly conforming to frozen `DATA_MODEL.md`.

Other Platform Core catalog structures (`modifier_groups`, `modifiers`, `branch_product_overrides`) are intentionally excluded from this prerequisite slice because:
- `recipes` has zero foreign key dependencies on modifiers or branch overrides.
- Excluding them minimizes migration risk and keeps the prerequisite surgical.

---

## G. Data Model / RLS Requirements

The prerequisite migration must implement the exact DDL specified below:

```sql
-- ============================================================================
-- PLATFORM CORE MASTER CATALOG FOUNDATION: CATEGORIES & PRODUCTS
-- ============================================================================

-- 1. Catálogo Maestro: Categorías
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_categories_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;

CREATE POLICY categories_tenant_isolation ON categories
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

CREATE INDEX idx_categories_org_sort ON categories (organization_id, sort_order);

-- 2. Catálogo Maestro: Productos
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    category_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    product_type VARCHAR(50) NOT NULL, -- SIMPLE, COMPOSITE, PACKAGE
    base_price DECIMAL(12, 4) NOT NULL,
    tax_scheme_id UUID NOT NULL,
    is_inventoriable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_products_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_products_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_products_category FOREIGN KEY (organization_id, category_id)
        REFERENCES categories(organization_id, id) ON DELETE RESTRICT
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

CREATE POLICY products_tenant_isolation ON products
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

CREATE INDEX idx_products_org_category ON products (organization_id, category_id);
CREATE INDEX idx_products_org_active ON products (organization_id, is_active);
```

### Analysis of Foreign Keys and Dependencies:

1. **`categories` Dependency:**  
   `products.category_id` references `categories(organization_id, id)`. Both tables are created in the same atomic migration. Referential integrity is strictly tenant-safe via composite key `(organization_id, id)`.
2. **`tax_scheme_id` Dependency:**  
   - In `DATA_MODEL.md` (Line 290), `tax_scheme_id UUID NOT NULL` is declared without an inline foreign key constraint to `tax_schemes`.
   - `tax_schemes` belongs to Billing / Finance (`MOD-06` / `MOD-05`), scheduled in Wave 6 (`WP-020` / `WP-021`).
   - Architectural determination: `tax_scheme_id` is retained as `UUID NOT NULL` (preserving frozen field nullability and types). It does **NOT** introduce a premature physical dependency on Wave 6 Billing tables. When seeding or creating products during tests, a syntactically valid UUID is provided. When Billing is implemented in Wave 6, a formal FK constraint can be added via Expand migration if governed.

---

## H. Dependency / Migration Ordering

The physical migration sequence must be strictly monotonic:

```text
20260904220000_sync_checkpoints_and_telemetry.sql  (Baseline Canonical)
                         ↓
20260904223000_platform_core_master_catalog.sql    (NEW PREREQUISITE: WP-016B)
  - creates categories with (organization_id, id)
  - creates products with fk_products_category
  - enables & forces RLS on both tables
                         ↓
20260904230000_inventory_catalog_and_recipes.sql    (WP-017 Clean Restart)
  - creates warehouses
  - creates ingredients
  - creates recipes with fk_recipes_product -> products(organization_id, id)
  - creates recipe_items
  - enables & forces RLS on all 4 inventory tables
```

Retroactive insertion or file renaming is strictly forbidden.

---

## I. WP-017 Impact

1. **Immediate State:** Candidate `S17-R1` on branch `feature/wp-017-inventory-recipes` remains on **HOLD**.
2. **Post-Prerequisite Strategy:** Once the Platform Core prerequisite (`WP-016B`) is implemented, reviewed, approved, and merged into `main`:
   - A new clean branch `feature/wp-017-inventory-recipes-r2` will be created from the updated canonical baseline.
   - The WP-017 migration will contain **only** the 4 Inventory tables (`warehouses`, `ingredients`, `recipes`, `recipe_items`).
   - `recipes` will bind its `fk_recipes_product` constraint to the pre-existing canonical `products` table.
   - `PostgresCloudInventoryService` will consume the pre-existing `products` table for recipe product validations.

---

## J. cloud-server Transaction Boundary Correction (`QI-017-06`)

### Finding:
In `S17-R1`, `PostgresCloudInventoryService` accepted a raw `pg.PoolClient` and invoked:
```typescript
await setTenantContext(client, organizationId);
```
`setTenantContext()` executes `SELECT set_config('app.current_organization_id', $1, true)`. The third argument (`is_local = true`) scopes the setting strictly to the current database transaction. If the caller does not execute `BEGIN`, PostgreSQL treats the statement as a single statement transaction, and the tenant context is immediately discarded on the next statement, causing subsequent RLS queries to fail or execute without tenant context.

### Required Architecture Correction:
The service composition layer in `@trident/cloud-server` must guarantee that all multi-tenant PostgreSQL operations execute within a verified atomic transaction boundary.

Canonical helper `withTenantTransaction(pool, organizationId, callback)` already exists in `@trident/database` (`packages/database/src/tenant.ts`):
```typescript
export async function withTenantTransaction<T>(
  pool: pg.Pool,
  organizationId: string,
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');
    await setTenantContext(client, organizationId);
    const result = await callback(client);
    await client.query('COMMIT;');
    return result;
  } catch (error) {
    await client.query('ROLLBACK;');
    throw error;
  } finally {
    client.release();
  }
}
```

### Architectural Rule:
1. Public methods on cloud domain services (e.g. `PostgresCloudInventoryService`) must accept `pool: pg.Pool` or execute within an internal `withTenantTransaction` wrapper.
2. In the alternative, if a caller-managed transaction is required for multi-service cross-context operations, the service must accept a verified `TenantTransactionContext` token proving that `BEGIN` and `setTenantContext` have already been executed on the client.
3. External API callers and Fastify route handlers must never be responsible for remembering to issue `BEGIN` / `COMMIT` / `ROLLBACK`.

---

## K. Implementation Plan Change

To preserve complete traceability without renumbering existing work packages, we introduce an additive work package:

### New Work Package: `WP-016B`
- **Work Package ID:** `WP-016B`
- **Title:** `Platform Core Master Catalog Foundation (Categories & Products)`
- **Wave:** Wave 4 (closing Platform Core Cloud DDL before Wave 5)
- **Bounded Context:** Platform Core (`MOD-CORE`)
- **Builder Agent:** `17_Database_Engineer` (with `13_Backend_Developer`)
- **Specialist Reviewer:** `03_Data_Architect`
- **Code Reviewer:** `11_Code_Reviewer`
- **Prerequisites:** `WP-004` (Organization & Branch RLS Foundation)
- **Data Objects:** PostgreSQL tables `categories`, `products`
- **Outputs:**
  - SQL migration `20260904223000_platform_core_master_catalog.sql`
  - Integration tests verifying composite unique keys, tenant-safe FKs, RLS isolation (`FORCE ROW LEVEL SECURITY`), and cross-tenant reference rejection
- **Acceptance Criteria:**
  - `categories` and `products` tables exist with complete canonical fields.
  - Foreign key `fk_products_category` enforces `ON DELETE RESTRICT`.
  - Default-deny RLS active on both tables.
  - Zero cross-tenant data leakage.

### Modification to `WP-017`:
- **Prerequisites:** Updated from `WP-004` to `WP-004, WP-016B`.
- **Scope Boundary:** Explicitly states that `WP-017` does NOT create or mutate `categories` or `products`.

---

## L. Backward Compatibility

- **Database:** Purely additive (`Expand` phase under Expand-Transition-Contract). Tables `categories` and `products` are new; existing tables and migrations are untouched.
- **Monorepo Packages:** No breaking changes to existing package manifests or dependency graphs.
- **Edge Runtimes:** No impact on existing Edge nodes.

---

## M. Rollback / Forward-Fix Strategy

Adheres strictly to `DATA_MIGRATION_STRATEGY.md`:
- **Non-Production Testing:** Migration runner supports down-step `DROP TABLE products CASCADE; DROP TABLE categories CASCADE;`
- **Production:** Follows Expand-Transition-Contract. If deployment fails, application reverts to previous version; expanded tables remain inert without affecting production traffic.

---

## N. Security Impact

- **Tenant Isolation:** Both `categories` and `products` enforce `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Policy:** `current_app_org_id()` default-deny ensures that unauthenticated connections or connections without active tenant context receive zero rows.
- **Relational Fencing:** Composite foreign keys `(organization_id, category_id)` prevent tenant A from associating a product with a category owned by tenant B.
- **Connection Pool Hygiene:** Parameterized transaction-local `set_config('app.current_organization_id', $1, true)` ensures zero tenant context bleeding across pooled connections.

---

## O. Protected Product Owner Questions

This architecture change strictly maintains the frozen state of all nine (9) protected Product Owner open questions:

1. `OQ-SSOT-01` (Item Cancellation Semantics): **PENDING PO DECISION**
2. `OQ-SSOT-02` (Table Transfer Rules): **PENDING PO DECISION**
3. `OQ-SSOT-03` (Station Offline Duration Bounds): **PENDING PO DECISION**
4. `OQ-SSOT-04` (Station Re-enrollment Approvals): **PENDING PO DECISION**
5. `OQ-SSOT-05` (PIN Brute-Force Lockout Durations): **PENDING PO DECISION**
6. `OQ-SSOT-06` (Bill Split Proration Strategy): **PENDING PO DECISION**
7. `OQ-SSOT-07` (Modifier Recipe Inventory Explosion): **PENDING PO DECISION**
8. `OQ-ARCH-01` (Cash Drawer Ledger Strategy): **PENDING PO DECISION**
9. `OQ-ARCH-02` (WAN Synchronization Partition Resolution): **PENDING PO DECISION**

**Protected State:** `9/9 PENDING PO DECISION`. No default business assumptions are made.

---

## P. Proposed Reviewers

Under EAAF v1.2 governance, because this change request was authored by `01_Solution_Architect` in coordination with `03_Data_Architect`, neither authoring participant may review their own submission. The proposed independent reviewers are:
- **Security Architecture Reviewer:** `08_Security_Architect`
- **DevOps Platform Architecture Reviewer:** `10_DevOps_Platform_Architect`
- **Mandatory Code Reviewer:** `11_Code_Reviewer`
- **Data Architecture Specialist Reviewer:** A fresh, independent instance of `03_Data_Architect` that did NOT participate in candidate authoring, with complete operational segregation recorded in the review sidecar.

---

## Q. Acceptance Criteria for Future Prerequisite (`WP-016B`)

1. Canonical `products` schema exists matching `DATA_MODEL.md` Sec. 2.1 byte-for-byte in data semantics.
2. Canonical `categories` dependency exists with composite candidate key `(organization_id, id)`.
3. Foreign key `fk_products_category` uses composite `(organization_id, category_id)` and enforces `ON DELETE RESTRICT`.
4. `products` preserves `tax_scheme_id UUID NOT NULL` and `product_type VARCHAR(50) NOT NULL`.
5. No Inventory ownership of products (DDL and migrations reside strictly in `@trident/database`).
6. `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` applied to both tables.
7. Tenant policy enforces `organization_id = current_app_org_id()`.
8. Cross-tenant insertions and references fail closed.
9. `recipes` in `WP-017` can reference `products(organization_id, id)` via composite FK.
10. `cloud-server` provides transaction-enforcing boundary (`withTenantTransaction`) for multi-tenant queries.
11. No circular dependency or forbidden imports introduced into package graph.

---

## R. Evidence Requirements

Upon implementation of `WP-016B`, the following verifiable evidence artifacts are required:
1. Clean migration run logs (`db:migrate`) demonstrating successful forward application.
2. Automated integration test logs verifying:
   - RLS tenant isolation on `categories` and `products`.
   - Rejection of cross-tenant foreign key references.
   - Non-production down-migration clean rollback.
   - Integrity of `tax_scheme_id` and `category_id` NOT NULL constraints.
3. Monorepo graph verification (`npm run graph:check`) passing 44/44.
4. Builder evidence document `evidence/WP-016B_BUILDER_EVIDENCE.md`.

---

## S. Decision / Approval Status

- **Disposition:** `PROPOSED — PENDING INDEPENDENT REVIEW`
- **Review Authorization:** Pending Coordinator Quick Integrity Verification.
- **Product Owner Approval:**
  ```text
  Product Owner Approval:
  REQUIRED AFTER INDEPENDENT REVIEWS
  ```
  *(Rationale: ACR-2026-014 updates canonical implementation sequencing and inserts additive work package WP-016B into the frozen Implementation Plan. While it does NOT resolve any protected business-semantic questions—preserving 9/9 PENDING PO DECISION—formal Product Owner approval of the implementation plan sequence change is required prior to canonical merge).*
- **Implementation Status:** Execution blocked until formal governance review and merge to canonical `main`.
