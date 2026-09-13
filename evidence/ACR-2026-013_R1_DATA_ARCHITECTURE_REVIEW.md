# ACR-2026-013 R1 — INDEPENDENT DATA ARCHITECTURE REVIEW

**Document ID:** `EVIDENCE-ACR-2026-013-DATA-ARCH-REVIEW`  
**Reviewer Role:** `03_Data_Architect` (Independent Specialist Reviewer)  
**Date:** `2026-09-13`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Review Target:** `ACR-2026-013 R1`  
**Frozen Subject SHA:** `004d22c265988254a5c4581113965d242cdcf2bc`  
**Review Branch:** `review/acr-2026-013-r1-data-architecture`  
**Base Commit:** `004d22c265988254a5c4581113965d242cdcf2bc`  
**Conflict of Interest Declaration:** The reviewer (`03_Data_Architect`) is NOT the author of the ACR (`01_Solution_Architect`).

---

## 1. Executive Summary & Verdict

As authorized by the EAAF Coordinator under `COORDINATOR_PROMPT_ACR2026013_INDEPENDENT_REVIEWS.md`, an independent Data Architecture audit was conducted against the Frozen Subject commit `004d22c265988254a5c4581113965d242cdcf2bc`.

The audit evaluated:
1. Exact fixed-point numerical representation in Edge SQLite (`ADR-012`).
2. Mathematical correctness and symmetry of the sign-safe `roundDiv` primitive and arithmetic sequence.
3. Common interoperable numerical range between Cloud PostgreSQL and Edge SQLite.
4. Correctness of SQLite aggregate semantics (`MIN`, `MAX`, `SUM` vs prohibition of `AVG` and `TOTAL`).
5. BigInt authority in TypeScript domain modeling and float-free string serialization.
6. Lifecycle nullability preservation for shift closure attributes.
7. Tenant-safe relational integrity and Row-Level Security (RLS) specification for `WP-017` Cloud Inventory tables.
8. Canonical physical table naming and elimination of redundant schema entities.

### Official Verdict: **PASS**
- **Blockers:** 0
- **Advisories:** 0

The data architecture changes in `ACR-2026-013 R1` provide an exact, mathematically sound, tenant-safe, and zero-float foundation for `WP-014`, `WP-017`, and subsequent Work Packages.

---

## 2. Technical Evaluation by Criteria

### 2.1 Edge Fixed-Point Representation & Cloud Precision Taxonomy (`ADR-012`)
- **Edge SQLite Storage:** Persisted as signed 64-bit `INTEGER` with a scale factor of $10^4 = 10,000$ (diezmilésimas).
- **Cloud PostgreSQL Storage:**
  - Monetary amounts, unit prices, modifier prices, costs, and quantities: `DECIMAL(12,4)`.
  - Tax rates (`tax_rate_applied`): `DECIMAL(6,4)`.
  - Ratios: Explicitly governed precision.
- **Floating Point Prohibition:** The prohibition of `REAL`, `FLOAT`, and IEEE 754 representation in Edge SQLite is completely enforced across DDL, documentation, and serialization rules.
- **Verification:** Evaluated against `DATA_MODEL.md` (Sec. 1 line 26, Sec. 3 lines 805–920), `DATA_ARCHITECTURE.md` (Sec. 2.1), and `ADR-012`. All definitions agree on scale 4 integer representation.

### 2.2 Sign-Safe Rounding Math & Normative Test Vectors (`roundDiv`)
- **Formula:**
  $$\text{roundDiv}(A, B) = \text{sign}(A \times B) \times \left\lfloor \frac{|A| + \lfloor |B| / 2 \rfloor}{|B|} \right\rfloor \quad (\text{with } B \neq 0)$$
- **Mathematical Evaluation of the 6 Normative Test Vectors:**
  1. $A = 5000, B = 10000 \implies +1 \times \lfloor (5000 + 5000)/10000 \rfloor = 1$. (PASS)
  2. $A = -5000, B = 10000 \implies -1 \times \lfloor (5000 + 5000)/10000 \rfloor = -1$. (PASS)
  3. $A = 14999, B = 10000 \implies +1 \times \lfloor (14999 + 5000)/10000 \rfloor = 1$. (PASS)
  4. $A = -14999, B = 10000 \implies -1 \times \lfloor (14999 + 5000)/10000 \rfloor = -1$. (PASS)
  5. $A = 15000, B = 10000 \implies +1 \times \lfloor (15000 + 5000)/10000 \rfloor = 2$. (PASS)
  6. $A = -15000, B = 10000 \implies -1 \times \lfloor (15000 + 5000)/10000 \rfloor = -2$. (PASS)
- **Symmetry:** Commercial rounding Half Away From Zero is strictly sign-symmetric around zero.
- **Sequence:**
  - `lineSubtotal = roundDiv(unitPriceScale4 * quantityScale4, 10000n)`
  - `netSubtotal = lineSubtotal - discountAmountScale4`
  - `taxAmount = roundDiv(netSubtotal * taxRateScale4, 10000n)`
  - `lineTotal = netSubtotal + taxAmount`
  - `cuentas.total_amount` is defined strictly as $\sum \text{cuenta\_items.total}$, guaranteeing that sum of parts equals account total without rounding drift.

### 2.3 Common Interoperable Numeric Range
- Cloud `DECIMAL(12,4)` allows up to 12 decimal digits with 4 fractional places, meaning 8 integer digits: max value is $+99,999,999.9999$ and min value is $-99,999,999.9999$.
- Converted to scale-4 integer ($S = 10,000$):
  $$99,999,999.9999 \times 10000 = 999,999,999,999 \quad (10^{12} - 1)$$
- The common interoperable range is $[-999999999999, +999999999999]$ ($[-999\_999\_999\_999\text{n}, +999\_999\_999\_999\text{n}]$).
- While SQLite `INTEGER` supports signed 64-bit values up to $\approx 9.22 \times 10^{18}$, restricting validation to $[-10^{12}+1, 10^{12}-1]$ guarantees that any value persisted at the Edge can be stored in Cloud PostgreSQL `DECIMAL(12,4)` without numeric overflow or truncation during synchronization.

### 2.4 SQLite Aggregate Semantics
- **Allowed:** `MIN(integer)`, `MAX(integer)`, and `SUM(integer)` when constrained by bounds checks to prevent signed 64-bit overflow.
- **Prohibited:** `AVG()` and `TOTAL()` are correctly prohibited because in SQLite, `AVG()` and `TOTAL()` unconditionally return floating-point numbers (`REAL`), which would reintroduce IEEE 754 floating point into financial aggregates.
- **Replacement:** The specification requires computing averages via exact integer sum and count using `roundDiv(sumScale4, count)`. This is mathematically rigorous.

### 2.5 BigInt Domain Authority & Lexical String Transport
- In the TypeScript domain, all monetary calculations are specified to use `bigint`.
- Scaling multiplication creates scale-8 intermediates (e.g. $10^4 \times 10^4 = 10^8$). BigInt provides arbitrary-precision integer arithmetic, eliminating JavaScript `Number.MAX_SAFE_INTEGER` ($9 \times 10^{15}$) overflow hazards during intermediate products.
- Transport is unified to canonical fixed 4-decimal strings (`"150.5000"`).
- Serialization from `bigint` uses exact integer arithmetic (`whole.toString() + "." + fraction.toString().padStart(4, "0")`) with sign handling.
- Deserialization to `bigint` uses strict regex parsing (`/^-?\d+\.\d{4}$/`). All floating point methods (`Number()`, `parseFloat()`, `/ 10000.0`, `toFixed()`) are explicitly prohibited.

### 2.6 Lifecycle Nullability Preservation
- The audit verified that `turnos_caja.closing_declared_cash`, `calculated_cash_total`, and `cash_difference` in `DATA_MODEL.md` (lines 901–903) remain `INTEGER NULL`.
- In `DATA_MODEL.md` (Sec. 1 line 26), `DATA_ARCHITECTURE.md` (Sec. 2.1), and `ADR-012` (Sec. 4.1), the blanket "all columns are NOT NULL" assertion was replaced with a lifecycle-governed nullability rule. Open shifts correctly allow null closing cash counts until the shift is reconciled and closed.

### 2.7 Tenant-Safe Inventory Schema for WP-017
The schema for Bounded Context 3 (Inventory) in `DATA_MODEL.md` (lines 395–475) was reviewed against multi-tenant relational isolation requirements:
1. `warehouses`:
   - Contains `organization_id UUID NOT NULL` and `branch_id UUID NOT NULL`.
   - Candidate key: `CONSTRAINT uq_warehouses_org_id UNIQUE (organization_id, id)`.
   - Tenant-scoped composite foreign key: `CONSTRAINT fk_warehouses_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`.
2. `ingredients`:
   - Contains `organization_id UUID NOT NULL`.
   - Candidate key: `CONSTRAINT uq_ingredients_org_id UNIQUE (organization_id, id)`.
3. `recipes`:
   - Contains `organization_id UUID NOT NULL` and `product_id UUID NULL`.
   - Candidate key: `CONSTRAINT uq_recipes_org_id UNIQUE (organization_id, id)`.
   - Tenant-scoped foreign key: `CONSTRAINT fk_recipes_product FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)` (supported by `uq_products_org_id` on `products`).
4. `recipe_items`:
   - Contains `organization_id UUID NOT NULL`, `recipe_id UUID NOT NULL`, `ingredient_id UUID NULL`, `sub_recipe_id UUID NULL`.
   - Candidate key: `CONSTRAINT uq_recipe_items_org_id UNIQUE (organization_id, id)`.
   - Composite foreign keys:
     - `CONSTRAINT fk_recipe_items_recipe FOREIGN KEY (organization_id, recipe_id) REFERENCES recipes(organization_id, id)`
     - `CONSTRAINT fk_recipe_items_ingredient FOREIGN KEY (organization_id, ingredient_id) REFERENCES ingredients(organization_id, id)`
     - `CONSTRAINT fk_recipe_items_sub_recipe FOREIGN KEY (organization_id, sub_recipe_id) REFERENCES recipes(organization_id, id)`
   - Mutually exclusive item constraint:
     `CONSTRAINT chk_recipe_items_exclusive_source CHECK ((ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL))`
5. Row-Level Security:
   - Explicitly specifies `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with `CREATE POLICY ... FOR ALL USING (organization_id = current_app_org_id())` on `warehouses`, `ingredients`, `recipes`, and `recipe_items`.

### 2.8 Physical Table Naming Consistency
- The audit confirmed that the canonical physical table names in `DATA_MODEL.md` are: `warehouses`, `ingredients`, `recipes`, `recipe_items`.
- Spanish domain concept names (*Insumos*, *Almacenes*, *Recetas*, *Subrecetas*, *Unidades de Medida*) are strictly documented as domain conceptual terminology and do not pollute the physical PostgreSQL DDL with duplicate tables.

---

## 3. Finding Matrix

| ID | Severity | Category | Description | Disposition |
|---|---|---|---|---|
| None | N/A | N/A | Zero blocking or advisory findings identified in Data Architecture review. | PASS |

---

## 4. Final Sign-off

The Data Architecture proposed under `ACR-2026-013 R1` is verified to be deterministic, zero-float, tenant-safe, and fully compliant with EAAF v1.2.0 requirements.

**Reviewer:** `03_Data_Architect`  
**Verdict:** **PASS** (0 blockers, 0 advisories)  
**Status:** Signed and frozen for Coordinator synthesis.
