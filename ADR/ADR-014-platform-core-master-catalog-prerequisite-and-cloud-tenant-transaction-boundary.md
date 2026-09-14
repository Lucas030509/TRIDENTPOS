# ADR-014: Platform Core Master Catalog Physical Prerequisite for Inventory & Cloud Tenant Transaction Boundary

**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW`  
**Date:** 2026-09-13  
**Owners:** `01_Solution_Architect` (in coordination with `03_Data_Architect`)  
**Related Documents:** `MODULE_CATALOG.md`, `DATA_MODEL.md`, `IMPLEMENTATION_PLAN.md`, `ADR-001`, `ADR-002`, `ADR-013`, `ACR-2026-014`  
**Classification:** `STRUCTURAL ARCHITECTURAL & DATA GOVERNANCE DECISION`  

---

## 1. Context

Under the EAAF architectural baseline (`MODULE_CATALOG.md` v1.3), TRIDENTPOS defines eleven (11) Bounded Contexts. **Platform Core (`MOD-CORE`)** owns core platform infrastructure, multi-tenancy, security, and the unified **Master Product Catalog**:
$$\text{Platform Core} \ni \{\text{categories}, \text{products}, \text{modifier\_groups}, \text{modifiers}, \text{branch\_product\_overrides}\}$$

**Inventory (`MOD-INV`)** is a distinct Bounded Context controlling insumos, warehouses, recipes, and kárdex:
$$\text{Inventory} \ni \{\text{warehouses}, \text{ingredients}, \text{recipes}, \text{recipe\_items}\}$$

In `DATA_MODEL.md` (Sec. 2.3), the relational model mandates that every recipe belongs to an organization and maps to a Master Product via composite foreign key:
```sql
CONSTRAINT fk_recipes_product FOREIGN KEY (organization_id, product_id)
REFERENCES products(organization_id, id)
```

During the execution of Work Package `WP-017: Inventory Catalog, Multi-Warehouse & Recipe Explosion Engine` (Candidate `S17-R1`), execution was halted because the canonical database baseline (`38062575...`) lacked the physical PostgreSQL tables for the Master Product Catalog. In response, `S17-R1` created a local, partial `products` table inside the Inventory migration (`20260904230000_inventory_catalog_and_recipes.sql`).

Furthermore, Coordinator inspection `QI-017-06` identified that `PostgresCloudInventoryService` in `@trident/cloud-server` accepted a raw `pg.PoolClient` and executed `setTenantContext()` without establishing an atomic database transaction (`BEGIN ... COMMIT / ROLLBACK`), creating a vulnerability where external callers must manually manage transactions or risk losing transaction-local tenant context across statements on pooled connections.

---

## 2. Problem Statement

1. **Domain Boundary Violation:** Having `WP-017` create a partial `products` table in the Inventory migration violates Bounded Context boundaries and creates schema drift against the frozen `DATA_MODEL.md`.
2. **Missing Physical Prerequisite in Implementation Plan:** `IMPLEMENTATION_PLAN.md` scheduled `WP-004` (Organizations/Branches), `WP-005` (IAM), and `WP-006` (Audit/Stations) in Wave 1, but omitted a physical work package to author the Platform Core Master Catalog DDL before Wave 5 (`WP-017`).
3. **Transaction Boundary Omission (`QI-017-06`):** Cloud application services consuming multi-tenant PostgreSQL cannot rely on external callers remembering to invoke `BEGIN` before `setTenantContext()`. PostgreSQL parameterized `set_config('app.current_organization_id', $1, true)` requires an active transaction; otherwise, the setting is scoped only to that single statement and reverts immediately.

---

## 3. Decision

### 3.1 Strict Domain Ownership & Prohibition of Inventory-Owned Products
- `products` and `categories` are strictly owned by **Platform Core (`MOD-CORE`)**.
- Inventory (`MOD-INV` / `WP-017`) is strictly prohibited from creating, owning, or migrating `products` or `categories`.
- Candidate `S17-R1`'s surrogate `products` table is rejected. `WP-017` is placed on `HOLD` and will restart cleanly from a new canonical baseline (`feature/wp-017-inventory-recipes-r2`) once the physical prerequisite is merged.

### 3.2 Minimum Platform Core Catalog Prerequisite Slice
The physical prerequisite before `WP-017` is scoped strictly to the minimal relational slice required by `recipes`:
1. **`categories` Table:**
   - Primary key: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - Tenant scoping: `organization_id UUID NOT NULL REFERENCES organizations(id)`
   - Relational candidate key: `CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)`
   - Code uniqueness: `CONSTRAINT uq_categories_org_code UNIQUE (organization_id, code)`
   - Row-Level Security: `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `USING (organization_id = current_app_org_id()) WITH CHECK (organization_id = current_app_org_id())`
2. **`products` Table:**
   - Fully preserves the canonical frozen fields from `DATA_MODEL.md` Sec. 2.1:
     - `id`, `organization_id`, `category_id`, `code`, `name`, `description`, `product_type`, `base_price`, `tax_scheme_id`, `is_inventoriable`, `is_active`, `created_at`, `updated_at`, `deleted_at`.
   - Relational candidate key: `CONSTRAINT uq_products_org_id UNIQUE (organization_id, id)`.
   - Code uniqueness: `CONSTRAINT uq_products_org_code UNIQUE (organization_id, code)`.
   - Category foreign key: Composite tenant-safe reference:
     ```sql
     CONSTRAINT fk_products_category
       FOREIGN KEY (organization_id, category_id)
       REFERENCES categories(organization_id, id)
       ON DELETE RESTRICT
     ```
   - Row-Level Security: `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `USING (organization_id = current_app_org_id()) WITH CHECK (organization_id = current_app_org_id())`.

### 3.3 Deferral of Non-Prerequisite Platform Core Catalog Objects
- `modifier_groups`, `modifiers`, and `branch_product_overrides` belong to Platform Core / TRIDENTPOS, but `recipes` has zero foreign key dependencies on them.
- To minimize prerequisite blast radius and adhere to surgical change principles, these objects are deferred to their respective operational work packages.

### 3.4 Preservation of `tax_scheme_id UUID NOT NULL` Without Premature Billing Dependency
- In `DATA_MODEL.md` (Line 290), `tax_scheme_id UUID NOT NULL` does not declare an inline foreign key constraint to `tax_schemes`.
- `tax_schemes` belongs to Billing / Finance (`MOD-06` / `MOD-05`), scheduled in Wave 6 (`WP-020` / `WP-021`).
- To prevent pulling forward a Wave 6 billing dependency into Wave 4/5, `tax_scheme_id UUID NOT NULL` is preserved without a physical database foreign key at this stage. Valid UUIDs are supplied in tests and seeding. A formal foreign key constraint may be evaluated when Billing is implemented in Wave 6.

### 3.5 Implementation Plan Insertion: `WP-016B`
- An additive work package is inserted into `IMPLEMENTATION_PLAN.md`:
  - **ID:** `WP-016B`
  - **Title:** `Platform Core Master Catalog Foundation (Categories & Products)`
  - **Wave:** Wave 4 (closing Platform Core Cloud DDL prerequisites)
  - **Bounded Context:** Platform Core (`MOD-CORE`)
  - **Builder Agent:** `17_Database_Engineer` (with `13_Backend_Developer`)
  - **Specialist Reviewer:** `03_Data_Architect` (fresh instance segregated from candidate authoring)
  - **Code Reviewer:** `11_Code_Reviewer`
  - **Prerequisites:** `WP-004`
  - **Outputs:** Migration `20260904223000_platform_core_master_catalog.sql` and automated RLS/isolation test suite.
- `WP-017` prerequisites are updated:
  - From: `Prerequisites: WP-004`
  - To: `Prerequisites: WP-004, WP-016B`
  - Explicit boundary added: `WP-017 MUST NOT create, own, or mutate categories or products.`

### 3.6 Cloud Server Tenant Transaction Boundary (`QI-017-06`)
- In `@trident/cloud-server`, domain service methods (e.g. `PostgresCloudInventoryService`) must never accept a naked `pg.PoolClient` with manual `setTenantContext()` requirements.
- Services must accept `pool: pg.Pool` and wrap operations inside the canonical helper:
  ```typescript
  withTenantTransaction(pool, organizationId, async (client) => {
    // Multi-tenant PostgreSQL operations
  });
  ```
  which guarantees the strict lifecycle:
  $$\text{BEGIN} \longrightarrow \text{setTenantContext} \longrightarrow \text{Operation(s)} \longrightarrow \text{COMMIT}$$
  $$\text{Error} \longrightarrow \text{ROLLBACK}$$
- Alternatively, if multi-service cross-context transactions are orchestrated by the composition layer, the service must receive a verified `TenantTransactionContext` token proving that `BEGIN` and `setTenantContext()` were executed.

---

## 4. Consequences & Tradeoffs

### Positive:
1. **Architectural Integrity:** Domain ownership boundaries between Platform Core and Inventory are preserved.
2. **Schema Correctness:** The canonical `products` table adheres to the complete frozen `DATA_MODEL.md` rather than a truncated surrogate.
3. **Tenant Safety:** Composite keys `(organization_id, id)` and composite foreign keys prevent cross-tenant associations between products and categories, and between recipes and products.
4. **Connection Pool Safety:** Mandatory `withTenantTransaction` prevents connection leak and tenant context bleeding in pooled PostgreSQL connections.
5. **Traceability:** Zero work packages are renumbered; `WP-016B` is strictly additive.

### Tradeoffs / Compensations:
1. **Sequential Execution:** `WP-017` must remain on `HOLD` until `WP-016B` is fully reviewed, approved, merged, and canonical on `main`.
2. **`tax_scheme_id` Integrity:** Without an enforced foreign key to `tax_schemes`, relational validation of tax schemes is enforced at application boundary until Wave 6.

---

## 5. Migration & Rollback Strategy

- **Migration Strategy:** Expand phase under Expand-Transition-Contract (`DATA_MIGRATION_STRATEGY.md`). Additive tables `categories` and `products` do not disrupt active traffic.
- **Rollback (Non-Production):** Down-migration drops `products` then `categories`.
- **Rollback (Production):** Application code rollback; expanded tables remain inert without impacting production.
