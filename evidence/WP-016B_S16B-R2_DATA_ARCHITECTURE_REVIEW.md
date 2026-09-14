# WP-016B — S16B-R2 Independent Data Architecture Review

## Reviewer Identity

`03_Data_Architect (fresh independent instance)`

**Independence statement:** This review was performed by a fresh independent instance of 03_Data_Architect, segregated from any instance involved in ACR-2026-014 authoring/review or WP-016B implementation. This instance has no memory of any prior conversation, session, or work on this project. It was invoked cold, with no context beyond the task brief for this review round, and performed all verification below from scratch against the live repository, live PostgreSQL database, and the actual test-runner output.

## Governance Facts Verified

- Canonical baseline (confirmed via `git cat-file` / `git log`): `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`
- **Frozen Subject reviewed (exact SHA):** `a185216dd4c1bfa6ea13c6cd28253570e03ef1f7`
- **Review branch:** `review/wp-016b-s16b-r2-data-architecture`, created directly from `a185216dd4c1bfa6ea13c6cd28253570e03ef1f7` (`git rev-parse HEAD` confirmed equal to the frozen subject SHA immediately after branch creation, before any other changes).
- Lineage independently confirmed via `git log --format='%H %P'`:
  - `a185216dd4c1bfa6ea13c6cd28253570e03ef1f7` → parent `1b7ecdcd1dfda581356d5988f1dff105909b987a`
  - `1b7ecdcd1dfda581356d5988f1dff105909b987a` → parent `8b6310d9579d5189f8933dcef683647f3311fe29`
  - `8b6310d9579d5189f8933dcef683647f3311fe29` → parent `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`
  - This matches the expected chain exactly: `d102f529` (canonical baseline, merge of ACR-2026-014) → `8b6310d9` (implementation) → `1b7ecdcd` (evidence correction R1) → `a185216d` (evidence correction R2, current frozen subject).
- The prior review round against `1b7ecdcd1dfda581356d5988f1dff105909b987a` was NOT consulted, reused, or referenced as governing in this review. This review examined the current frozen subject `a185216d` fully and independently.

## Scope Inspected

**Files read directly:**
- `packages/database/migrations/20260904223000_platform_core_master_catalog.sql` (full file, 89 lines)
- `packages/database/src/index.test.ts` — the `describe('TRIDENTPOS WP-016B Platform Core Master Catalog Foundation (Categories & Products) Suite', ...)` block, lines 4404–5102 (last describe block in the file, read in full, every `it(...)` test)
- `evidence/WP-016B_BUILDER_EVIDENCE.md` (read for claims, not trusted; each factual claim cross-checked below)
- Full diff `d102f529...a185216d` for `packages/database/src/index.test.ts` and `packages/database/src/outbox.test.ts` (all hunks, to confirm no undisclosed scope creep)

**Commands run:**
- `git fetch origin`, `git cat-file -t`, `git log --oneline`, `git log --format='%H %P'`, `git merge-base` style ancestry checks (via direct parent walk)
- `git checkout -b review/wp-016b-s16b-r2-data-architecture a185216dd4c1bfa6ea13c6cd28253570e03ef1f7`
- `npm ci`
- `npm run build --workspace=@trident/core` (built first, per instructions)
- `npm run build --workspace=@trident/database`
- `DATABASE_URL=... npm run db:migrate` (live PostgreSQL 16, `tridentpos_test`)
- `psql \d categories`, `psql \d products`
- Live queries against `pg_policies`, `pg_class.relrowsecurity`/`relforcerowsecurity`, `pg_constraint`, `information_schema.columns`
- A raw psql transaction manually inserting a Tenant A product referencing a Tenant B category (not from the test file — hand-written by this reviewer) to independently confirm the composite FK rejection
- `DATABASE_URL=... ALLOW_DESTRUCTIVE_DOWN=true npm run db:migrate:down`, then `psql \dt` to confirm both tables gone
- Re-applied `npm run db:migrate` to restore schema, then `DATABASE_URL=... npm run --workspace=@trident/database test`, run twice back-to-back to check for state leakage

**Live database used:** `postgresql://postgres:postgres@localhost:5432/tridentpos_test`, PostgreSQL 16.14 (Homebrew, aarch64-apple-darwin). Confirmed via `SELECT version();`.

## Verification Against Checklist

### Schema — categories (VERIFIED against live `\d categories` output)

```
id               | uuid      | not null | gen_random_uuid()
organization_id  | uuid      | not null |
code             | varchar(50)  | not null |
name             | varchar(100) | not null |
sort_order       | integer   | not null | 0
is_active        | boolean   | not null | true
```
- `uq_categories_org_code` UNIQUE (organization_id, code) — confirmed present in `\d` output and in `pg_constraint`.
- `uq_categories_org_id` UNIQUE (organization_id, id) — confirmed present.
- All required fields/constraints match the checklist exactly.

### Schema — products (VERIFIED against live `\d products` output)

```
id               | uuid                     | not null | gen_random_uuid()
organization_id  | uuid                     | not null |
category_id      | uuid                     | not null |
code             | varchar(50)              | not null |
name             | varchar(255)             | not null |
description      | text                     |          |
product_type     | varchar(50)              | not null |
base_price       | numeric(12,4)            | not null |
tax_scheme_id    | uuid                     | not null |
is_inventoriable | boolean                  | not null | true
is_active        | boolean                  | not null | true
created_at       | timestamptz              | not null | now()
updated_at       | timestamptz              | not null | now()
deleted_at       | timestamptz              |          |
```
- `uq_products_org_code`, `uq_products_org_id` — both confirmed present via `pg_constraint`.
- All required fields present with correct types and nullability.

### Tenant-safe relationship (VERIFIED both by reading SQL and live PostgreSQL rejection)

Migration SQL (lines 54–57 of the migration file), read verbatim:
```sql
CONSTRAINT fk_products_category
    FOREIGN KEY (organization_id, category_id)
    REFERENCES categories (organization_id, id)
    ON DELETE RESTRICT
```
This matches the required text exactly.

**Live confirmation (not just trusting the test):** This reviewer wrote and executed an independent psql transaction (not copied from the test file) that inserted two reviewer-owned organizations, a category under "Tenant B" (reviewer-created), and then attempted to insert a product with `organization_id` = reviewer "Tenant A" and `category_id` pointing to reviewer "Tenant B"'s category. PostgreSQL itself rejected it:
```
ERROR:  insert or update on table "products" violates foreign key constraint "fk_products_category"
DETAIL:  Key (organization_id, category_id)=(99999999-...-991, 88888888-...-882) is not present in table "categories".
```
This independently confirms the composite FK enforces tenant-safety at the database level, not merely at the application/test level.

### Billing boundary (VERIFIED live)

- `tax_scheme_id UUID NOT NULL` — confirmed via `\d products` and `information_schema.columns` (`is_nullable = NO`, `data_type = uuid`).
- No default value: `SELECT column_default FROM information_schema.columns WHERE table_name='products' AND column_name='tax_scheme_id';` returned an empty/NULL value. Confirmed.
- No FK to any Billing table: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='products'::regclass AND contype='f';` returned exactly two FKs — `fk_products_category` (to `categories`) and `products_organization_id_fkey` (to `organizations`). No FK on `tax_scheme_id` exists at all.
- No `tax_schemes` table anywhere in the schema: confirmed via `information_schema.tables` query returning 0 rows for `tax_schemes`, `warehouses`, `ingredients`, `recipes`, `recipe_items`, `modifier_groups`, `modifiers`.

### RLS (VERIFIED live, in the running database)

- `pg_class.relrowsecurity` and `relforcerowsecurity` for both `categories` and `products`: both `t` (true). Confirmed via direct query.
- `pg_policies` shows exactly one policy per table, `tenant_isolation_policy`, `PERMISSIVE`, `cmd = ALL`, `qual = (organization_id = current_app_org_id())`, `with_check` identical — a default-deny pattern (no tenant context ⇒ `current_app_org_id()` returns NULL ⇒ no row satisfies the predicate).
- `current_app_org_id()` confirmed to be the pre-existing function (`\df current_app_org_id` shows a single function, `uuid` return type, no arguments) — the migration does not define or redefine this function; it only references it. Consistent with WP-004's established pattern.

### Tests (read in full, all 30 `it(...)` blocks; independently counted `it(` occurrences = 30, matching WP016B-T01 through WP016B-T30 exactly)

- **T01** — asserts the migration ledger includes WP-003 baseline, WP-004 RLS, and WP-016B IDs after `migrateUp`.
- **T02** — asserts `categories` column types/nullability match the canonical model and that `uq_categories_org_code`/`uq_categories_org_id` exist in `pg_constraint`.
- **T03** — asserts `products` column types/nullability, and specifically that `tax_scheme_id` is `NOT NULL` with `column_default IS NULL`; also asserts `uq_products_org_code`, `uq_products_org_id`, `fk_products_category` all exist.
- **T04/T05** — assert `relrowsecurity` and `relforcerowsecurity` are both true for `categories`/`products` respectively.
- **T06** — asserts that with no tenant context set (`SET ROLE` only, no `current_app_org_id()` session variable), SELECT on both tables returns zero rows (default-deny).
- **T07/T08** — assert Tenant A sees exactly its 2 categories and not Tenant B's; Tenant B sees exactly its 1 category.
- **T09/T10** — same pattern for products (1 row each, tenant-scoped).
- **T11/T12** — assert that under Tenant A's context, an INSERT of a category/product with `organization_id` set to Tenant B is rejected with a `row-level security policy` error (the `WITH CHECK` clause blocking cross-tenant writes).
- **T13/T14** — assert an UPDATE targeting a Tenant B row while in Tenant A's context affects 0 rows (RLS `USING` clause silently filters the target out).
- **T15/T16** — assert a DELETE targeting a Tenant B row while in Tenant A's context affects 0 rows, and that the row still exists afterward (verified via a follow-up SELECT as the pool/superuser).
- **T17** — asserts that inserting a product with Tenant A's `organization_id` but Tenant B's `category_id` is rejected specifically with `violates foreign key constraint "fk_products_category"` — the composite tenant-safe FK working as designed. This reviewer independently reproduced this exact failure mode live (see above).
- **T18** — asserts a same-tenant product→category reference (Tenant A product referencing Tenant A's second category) succeeds and is retrievable.
- **T19** — asserts that deleting a category still referenced by a product fails with the `fk_products_category` FK violation (`ON DELETE RESTRICT` behavior), and that the category remains intact afterward.
- **T20/T21** — assert duplicate `code` within the same tenant is rejected by `uq_categories_org_code`/`uq_products_org_code` respectively.
- **T22** — asserts the same `code` value is permitted across two different tenants (proves the uniqueness is correctly scoped to `organization_id`, not global).
- **T23** — asserts omitting `tax_scheme_id` on INSERT fails with a NOT NULL violation.
- **T24** — asserts omitting `category_id` on INSERT fails with a NOT NULL violation.
- **T25** — asserts `tax_schemes` does not exist in `information_schema.tables`.
- **T26** — asserts `warehouses`, `ingredients`, `recipes`, `recipe_items`, `modifier_groups`, `modifiers` do not exist.
- **T27** — drops all relevant tables/extensions/functions and re-runs `migrateUp` from zero, asserting the baseline + WP-004 + WP-016B migrations all apply cleanly and their checksums match; re-seeds data and re-grants the test role afterward.
- **T28** — runs `migrateDown` with `allowDestructiveDown: true`, asserts it reports reverting the WP-016B migration, that `categories`/`products` no longer appear in `information_schema.tables`, and that the `_migrations` ledger now contains only the baseline and WP-004 IDs.
- **T29** — re-runs `migrateUp` (restoring WP-016B), re-grants privileges, re-seeds data, and asserts Tenant A again sees exactly 2 categories under RLS — proving the up→down→up round trip fully restores both schema and tenant isolation.
- **T30** — asserts the migration's checksum stored in `_migrations` still matches a freshly computed checksum of the on-disk migration file (drift/tamper detection).

All of the above were independently re-run by this reviewer against the live database (not merely read) — see the "Tests — Run Results" section below.

### Out-of-scope confirmation

- The migration file's only two `CREATE TABLE` statements are `categories` and `products` (verified by reading the full 89-line file).
- Live `information_schema.tables` query for `tax_schemes`, `warehouses`, `ingredients`, `recipes`, `recipe_items`, `modifier_groups`, `modifiers` returned 0 rows.
- Reviewed the full diff of `packages/database/src/index.test.ts` and `packages/database/src/outbox.test.ts` between the canonical baseline and the frozen subject (`git diff d102f529...a185216d`). Every hunk outside the new WP-016B `describe` block is a mechanical addition of `products, categories` to a pre-existing `DROP TABLE IF EXISTS ...` schema-reset list in the WP-003/004/005/006/011 suites (plus removing a duplicate `closePool(pool)` call from WP-011's `after()` since WP-016B, being appended after it, now owns that call). No other test logic, assertions, or production code were touched. This matches the builder's own stated rationale and is confirmed correct: since `categories`/`products` FK to `organizations` non-cascadingly for table drops, omitting them from these lists would otherwise leave orphaned tables after a full reset in earlier suites.
- Total changed files from canonical baseline to frozen subject: exactly 4 — `evidence/WP-016B_BUILDER_EVIDENCE.md`, the new migration file, `packages/database/src/index.test.ts`, `packages/database/src/outbox.test.ts`. Confirmed via `git diff --stat`. No Inventory, Billing, POS, or cloud-server files were touched.

## Build Results

- `npm ci`: completed successfully (242 packages added, 0 vulnerabilities).
- `npm run build --workspace=@trident/core`: PASS (`tsc -b`, no errors). Built first per instructions, avoiding the `ERR_MODULE_NOT_FOUND` issue a prior reviewer flagged.
- `npm run build --workspace=@trident/database`: PASS (`tsc -b`, no errors).

## Live Database Verification Results

- `npm run db:migrate` against `tridentpos_test`: on first run the schema was already up to date (categories/products pre-existed from an earlier setup step); this reviewer additionally exercised a full down→up cycle explicitly (see below) to independently prove both directions work, not just relying on pre-existing state.
- `\d categories`, `\d products`: both match the checklist exactly (see schema sections above).
- `pg_policies`, `pg_class.relrowsecurity/relforcerowsecurity`: both tables confirmed `t`/`t`, one `tenant_isolation_policy` each, as described above.
- Manual cross-tenant composite FK insert (Tenant A org_id + Tenant B category_id): rejected live by PostgreSQL with `violates foreign key constraint "fk_products_category"`. Confirmed independently, not copied from test code.
- `ALLOW_DESTRUCTIVE_DOWN=true npm run db:migrate:down`: reported `Successfully reverted migration: 20260904223000_platform_core_master_catalog`. Follow-up `\dt` confirmed `categories` and `products` no longer appear (18 tables remaining, down from 20).
- Migration was then re-applied (`npm run db:migrate`) to restore state prior to running the full test suite.

## Test Suite — Run Results

`DATABASE_URL=... npm run --workspace=@trident/database test` run twice, back-to-back, against the live database:

- Run 1: `tests 260 / pass 260 / fail 0 / cancelled 0 / skipped 0`. All 30 `WP016B-T01`...`WP016B-T30` lines present with `✔`.
- Run 2: `tests 260 / pass 260 / fail 0 / cancelled 0 / skipped 0`. Again all 30 WP016B lines `✔`, confirming no state leakage between runs.
- Independent static count of `it(` occurrences inside the WP-016B `describe` block (lines 4404–5102): **30**, exactly matching the runner's `✔ WP016B-T01` through `✔ WP016B-T30` output. No discrepancy found.

This reviewer did not merely trust the builder's evidence claim of "260/260" — it was independently reproduced twice.

## Builder Evidence Cross-Check

The builder's evidence document (`evidence/WP-016B_BUILDER_EVIDENCE.md`) was read and its material claims checked against the real artifacts:
- Changed-files list (4 files) — confirmed exactly via `git diff --stat`.
- Schema field-by-field claims for `categories`/`products` — confirmed exactly against live `\d` output and `information_schema.columns`.
- `tax_scheme_id UUID NOT NULL`, no default, no FK — confirmed exactly.
- RLS enable/force + policy pattern — confirmed exactly.
- `outbox.test.ts`/`index.test.ts` modification rationale (DROP TABLE list hygiene) — confirmed exactly by reading the actual diff hunks; the explanation is accurate and the changes are indeed limited to that mechanical pattern.
- "30 tests total" claim — confirmed exactly by independent count and by live re-run.
- Out-of-scope claims (`tax_schemes`, Inventory tables absent) — confirmed exactly.

No factual claim in the builder's evidence document that falls within this reviewer's Data Architecture scope was found to be false. (This review does not re-verify lint/typecheck/graph:check/root `npm test` electron-environment claims, as those are outside the Data Architecture review's checklist scope; the database-specific claims were all independently confirmed.)

## Blockers (material defects)

None.

## Advisories (non-blocking observations)

1. The migration's `-- Down` section drops both RLS policies and tables in an order that is safe for a destructive/non-production rollback, but as with any `ON DELETE RESTRICT` composite-FK design, a future Work Package that needs to bulk-delete categories with existing products will need an explicit product-reassignment or cascade-delete workflow at the application layer — this is a known, intentional design tradeoff (data integrity over convenience) and is correctly reflected in the ACR-2026-014 baseline; no action needed now, but worth keeping in mind for WP-017 (Inventory) which will build on top of `products`.
2. `products.description` is `TEXT NULL` with no length constraint or content validation at the database layer; this is standard practice for free-text fields and is not a defect, but any future search/filter feature over descriptions should plan indexing (e.g., trigram/GIN) separately since none exists yet — expected, since this WP is schema foundation only.

Neither advisory affects correctness, tenant isolation, or the Billing/Inventory scope boundary, and neither blocks this review's PASS verdict.

## Final Verdict

**PASS WITH ADVISORIES**
