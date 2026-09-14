# ACR-2026-014 R2 — INDEPENDENT DATA ARCHITECTURE REVIEW

**Framework:** EAAF v1.2.0  
**Repository:** `Lucas030509/TRIDENTPOS`  
**Reviewer Role:** `03_Data_Architect` (Fresh Independent Instance)  
**Branch:** `review/acr-2026-014-r2-data`  
**Frozen Subject:** `a8d2801920f2d491f37efb44b55060d1b1eae9c2`  
**Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df`  
**Date:** 2026-09-13  
**Status:** COMPLETE  

---

## 1. Independence & Segregation of Duties Declaration

> [!IMPORTANT]
> **Formal Segregation Statement:**  
> This evaluation is performed by a **fresh, independent instance of `03_Data_Architect`**, entirely segregated from the earlier architecture instance that participated in the conception, drafting, or authoring of `ACR-2026-014` and `ADR-014`. No prior assumptions, authorial commitments, or shared state have been inherited. This review assesses the frozen subject `a8d2801920f2d491f37efb44b55060d1b1eae9c2` strictly against canonical data architecture principles, tenant safety, and the project's frozen specifications.

---

## 2. Review Scope & Methodology

The independent review evaluated the following artifacts at frozen commit `a8d2801920f2d491f37efb44b55060d1b1eae9c2`:
1. `ARCHITECTURE_CHANGE_REQUEST_PLATFORM_CORE_MASTER_CATALOG_WP017.md`
2. `ADR/ADR-014-platform-core-master-catalog-prerequisite-and-cloud-tenant-transaction-boundary.md`
3. `DATA_MODEL.md` (Sec. 2.1 relational definitions)
4. `IMPLEMENTATION_PLAN.md` (WP-016B and WP-017 specification blocks)

Evaluation criteria focused on:
- Domain boundary integrity and schema ownership between Platform Core (`MOD-CORE`) and Inventory (`MOD-INV`).
- Multi-tenant relational safety and composite candidate/foreign key design.
- Preservation of canonical fields and avoidance of premature cross-context physical constraints.
- Row-Level Security (RLS) policies and transaction-scoped tenant context isolation.

---

## 3. Data Architecture Verification Findings

### 3.1 Domain Ownership & Prohibition of Inventory-Owned Products
- **Verification:** Verified that `products` and `categories` are exclusively placed under Platform Core (`MOD-CORE`) data ownership.
- **Evaluation:** Having Inventory (`WP-017`) create a surrogate or partial `products` table was a serious violation of bounded contexts. `ACR-2026-014` correctly rejects candidate `S17-R1`, establishes `WP-016B` in Wave 4 under Platform Core, and mandates that `WP-017` consume the canonical `products` table via `fk_recipes_product (organization_id, product_id) REFERENCES products(organization_id, id)`.
- **Conclusion:** **COMPLIANT**. Single source of truth (SSOT) for catalog domain entities is restored.

### 3.2 Tenant-Safe Composite Relational Model
- **Verification:** Inspected relational constraints on `categories` and `products` in `DATA_MODEL.md`:
  - `categories`:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `organization_id UUID NOT NULL REFERENCES organizations(id)`
    - `CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)`
    - `CONSTRAINT uq_categories_org_code UNIQUE (organization_id, code)`
  - `products`:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `organization_id UUID NOT NULL REFERENCES organizations(id)`
    - `category_id UUID NOT NULL`
    - `CONSTRAINT uq_products_org_id UNIQUE (organization_id, id)`
    - `CONSTRAINT uq_products_org_code UNIQUE (organization_id, code)`
    - `CONSTRAINT fk_products_category FOREIGN KEY (organization_id, category_id) REFERENCES categories(organization_id, id) ON DELETE RESTRICT`
- **Evaluation:** In multi-tenant systems using PostgreSQL RLS, a foreign key referencing only `id` permits cross-tenant reference injection if a user crafts a payload with an existing `id` belonging to another organization. By defining candidate keys `(organization_id, id)` and enforcing the composite foreign key `(organization_id, category_id) REFERENCES categories(organization_id, id)`, cross-tenant foreign key traversal is impossible at the database engine level.
- **Conclusion:** **COMPLIANT**. The relational model guarantees strict tenant isolation by construction.

### 3.3 Deferral of Non-Prerequisite Catalog Entities
- **Verification:** Reviewed the decision to defer `modifier_groups`, `modifiers`, and `branch_product_overrides`.
- **Evaluation:** The immediate blocking dependency for `WP-017` is solely `products` (via `recipes.product_id`). Modifiers and branch overrides are consumed by Dining/POS and Menu management, not by the core recursive recipe explosion engine. Omitting them from `WP-016B` minimizes migration blast radius and keeps the prerequisite strictly surgical.
- **Conclusion:** **COMPLIANT**. Proper dependency minimization.

### 3.4 Handling of `tax_scheme_id` Without Premature Wave 6 Coupling
- **Verification:** Checked `tax_scheme_id UUID NOT NULL` in `DATA_MODEL.md` (Line 290).
- **Evaluation:** In `DATA_MODEL.md`, `tax_scheme_id` does not declare a physical FK constraint to `tax_schemes`. `tax_schemes` is owned by Billing / Finance (`MOD-06`/`MOD-05`), scheduled in Wave 6 (`WP-020`/`WP-021`). Attempting to add an inline physical constraint in Wave 4 would either pull Wave 6 forward or force an incomplete surrogate table. Preserving `tax_scheme_id UUID NOT NULL` with synthetic/seed UUIDs until Wave 6 is sound and conforms to frozen specification.
- **Conclusion:** **COMPLIANT**. Relational integrity is preserved without premature cross-context coupling.

### 3.5 Cloud Server Multi-Tenant Transaction Boundary (`QI-017-06`)
- **Verification:** Evaluated the architectural requirement for `withTenantTransaction(pool, orgId, callback)` in `@trident/cloud-server`.
- **Evaluation:** PostgreSQL's `set_config('app.current_organization_id', $1, true)` operates locally only within an active transaction block (`BEGIN ... COMMIT / ROLLBACK`). Executing `setTenantContext` on an un-transactioned pooled client reverts immediately or bleeds into subsequent statements. Requiring the transaction boundary at the service entrance prevents connection pool pollution and ensures RLS policies always evaluate against the verified organization context.
- **Conclusion:** **COMPLIANT**. Essential for multi-tenant data safety.

### 3.6 Protected Product Owner Decisions Preservation
- **Verification:** Checked all 9 Product Owner architectural questions (`OQ-ARCH-01` through `OQ-ARCH-09`).
- **Evaluation:** All 9 items remain explicitly recorded as `PENDING PO DECISION`. Neither `ACR-2026-014` nor `ADR-014` makes assumptions or resolves any PO question prematurely.
- **Conclusion:** **COMPLIANT**. Zero unauthorized scope expansion.

---

## 4. Verification Check Matrix

| Check ID | Verification Item | Status |
|---|---|---|
| **DAT-01** | Platform Core master catalog ownership (`categories`, `products`) | **PASS** |
| **DAT-02** | Inventory (`WP-017`) prohibited from owning/creating catalog tables | **PASS** |
| **DAT-03** | Composite candidate keys `(organization_id, id)` on catalog tables | **PASS** |
| **DAT-04** | Composite tenant-safe FK `fk_products_category` | **PASS** |
| **DAT-05** | Canonical fields preserved (`DATA_MODEL.md` Sec. 2.1) | **PASS** |
| **DAT-06** | `tax_scheme_id` preserved without premature Wave 6 FK | **PASS** |
| **DAT-07** | RLS default-deny policy specification (`current_app_org_id()`) | **PASS** |
| **DAT-08** | Cloud tenant transaction boundary (`withTenantTransaction`) | **PASS** |
| **DAT-09** | 9/9 protected PO questions preserved as `PENDING PO DECISION` | **PASS** |
| **DAT-10** | Zero production code / zero executed migrations in ACR | **PASS** |

---

## 5. Review Verdict

- **Blocking Findings:** `0`
- **Advisory Findings:** `0`
- **Overall Verdict:** **PASS**

The data architecture proposed in `ACR-2026-014` and formalized in `ADR-014`, `DATA_MODEL.md`, and `IMPLEMENTATION_PLAN.md` is robust, mathematically sound, enforces strict tenant isolation, and restores clean domain boundaries.
