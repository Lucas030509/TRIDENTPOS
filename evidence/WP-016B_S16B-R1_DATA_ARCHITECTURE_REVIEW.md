# WP-016B Independent Data Architecture Review — S16B-R1

## Reviewer Identity

`03_Data_Architect (fresh independent instance)`

**Independence declaration:** This evaluation was performed by a fresh independent instance of `03_Data_Architect`, segregated from any instance involved in the authoring of ACR-2026-014 or the implementation of WP-016B. This instance was cold-started for this review with no memory of any prior conversation, session, or work on this project. All findings below were derived directly from the frozen source, the live PostgreSQL 16 database, and command output produced during this review session — not from restating the Builder's own evidence document.

## Governance / Scope

- Canonical baseline: `d102f5296c9175c485aeb1a4bf7b5af3a93173b5` — verified to exist via `git cat-file -t`.
- Frozen Subject reviewed (exact SHA): `1b7ecdcd1dfda581356d5988f1dff105909b987a` — verified to exist and confirmed as the exact `HEAD` of the review branch via `git log -1 --format='%H'`.
- Review branch: `review/wp-016b-s16b-r1-data-architecture`, created via `git checkout -b review/wp-016b-s16b-r1-data-architecture 1b7ecdcd1dfda581356d5988f1dff105909b987a`.
- Lineage independently confirmed via `git log --format='%H %P'`:
  - `1b7ecdcd1dfda581356d5988f1dff105909b987a` parent → `8b6310d9579d5189f8933dcef683647f3311fe29`
  - `8b6310d9579d5189f8933dcef683647f3311fe29` parent → `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`
  - This exactly matches the expected lineage: baseline → implementation → evidence correction. No discrepancy found.
- `git diff --stat d102f529… 1b7ecdcd…` confirms exactly 4 changed files across the whole WP-016B change set: `evidence/WP-016B_BUILDER_EVIDENCE.md` (new), `packages/database/migrations/20260904223000_platform_core_master_catalog.sql` (new, 88 lines), `packages/database/src/index.test.ts` (+725/-12), `packages/database/src/outbox.test.ts` (+2). This matches the Builder's own "Changed Files" claim exactly.

## Scope Inspected

Files read in full:
- `packages/database/migrations/20260904223000_platform_core_master_catalog.sql` (real SQL, 89 lines, entire file)
- `packages/database/migrations/20260904170000_tenant_rls_foundation.sql` (baseline RLS migration, to diff `current_app_org_id()` against)
- `packages/database/src/index.test.ts` lines 4404–5102 (the entire `describe('TRIDENTPOS WP-016B …')` block, every `it(...)`, in full — this is the last describe block in the file, confirmed by file length `wc -l` = 5102)
- `evidence/WP-016B_BUILDER_EVIDENCE.md` (Builder's own claims, used only as a cross-check target, not as a source of truth)
- Full `git diff` of `packages/database/src/outbox.test.ts` and every non-appended hunk of `packages/database/src/index.test.ts` between baseline and Frozen Subject, to confirm the only pre-existing-suite changes are additive `DROP TABLE` reset-list entries (`products`, `categories`) plus relocation of a single `closePool(pool)` call from WP-011's `after()` to WP-016B's `after()` (since WP-016B is now the last suite in the file). No pre-existing test assertions were altered.

Commands run:
- `git fetch origin`, `git cat-file -t <sha>` x2, `git log --oneline`, `git log --format='%H %P'`, `git diff --stat`, `git diff -- outbox.test.ts`
- `npm ci` (242 packages, 0 vulnerabilities)
- `npm run build --workspace=@trident/database` (tsc -b, clean)
- `npm run build --workspace=@trident/core` (required dependency; `@trident/database`'s tests import `@trident/core` at runtime and fail with `ERR_MODULE_NOT_FOUND` if it is not built — noted as an advisory below)
- `DATABASE_URL=… npm run db:migrate` (root script → `@trident/database` `migrate` → `node dist/cli.js up`)
- `psql … -c "\d categories"`, `psql … -c "\d products"`, `psql … -c "\dt"`
- Direct SQL queries against `pg_class.relrowsecurity`/`relforcerowsecurity`, `pg_policies`, `pg_constraint`, `information_schema.columns`, `information_schema.tables`
- A hand-written, independent (non-test-suite) transaction directly against the live database attempting a cross-tenant composite-FK insert, rolled back
- `DATABASE_URL=… ALLOW_DESTRUCTIVE_DOWN=true npm run db:migrate:down`, followed by `\dt` to confirm both tables gone
- `DATABASE_URL=… npm run db:migrate` again (re-apply, to restore state for the test suite)
- `DATABASE_URL=… npm run --workspace=@trident/database test` — run **three times consecutively**
- `git status` before and after all of the above, to confirm no stray tracked-file changes

## Checklist Verification

### Schema — categories (verified live via `\d categories`)

```
     Column      |          Type          | Collation | Nullable |      Default      
-----------------+------------------------+-----------+----------+-------------------
 id              | uuid                   |           | not null | gen_random_uuid()
 organization_id | uuid                   |           | not null | 
 code            | character varying(50)  |           | not null | 
 name            | character varying(100) |           | not null | 
 sort_order      | integer                |           | not null | 0
 is_active       | boolean                |           | not null | true
Indexes:
    "categories_pkey" PRIMARY KEY, btree (id)
    "uq_categories_org_code" UNIQUE CONSTRAINT, btree (organization_id, code)
    "uq_categories_org_id" UNIQUE CONSTRAINT, btree (organization_id, id)
```

All required fields, types, nullability, defaults, and both unique constraints (`uq_categories_org_code`, `uq_categories_org_id`) confirmed present exactly as specified. **PASS.**

### Schema — products (verified live via `\d products`)

```
      Column      |           Type           | Collation | Nullable |      Default      
------------------+--------------------------+-----------+----------+-------------------
 id               | uuid                     |           | not null | gen_random_uuid()
 organization_id  | uuid                     |           | not null | 
 category_id      | uuid                     |           | not null | 
 code             | character varying(50)    |           | not null | 
 name             | character varying(255)   |           | not null | 
 description      | text                     |           |          | 
 product_type     | character varying(50)    |           | not null | 
 base_price       | numeric(12,4)            |           | not null | 
 tax_scheme_id    | uuid                     |           | not null | 
 is_inventoriable | boolean                  |           | not null | true
 is_active        | boolean                  |           | not null | true
 created_at       | timestamp with time zone |           | not null | now()
 updated_at       | timestamp with time zone |           | not null | now()
 deleted_at       | timestamp with time zone |           |          | 
```

All required fields present with correct types/nullability. **PASS.**

### Tenant-safe relationship

Real SQL (migration lines 54–57):
```sql
CONSTRAINT fk_products_category
    FOREIGN KEY (organization_id, category_id)
    REFERENCES categories (organization_id, id)
    ON DELETE RESTRICT
```
Exact match to required text.

Live `\d products` confirms: `"fk_products_category" FOREIGN KEY (organization_id, category_id) REFERENCES categories(organization_id, id) ON DELETE RESTRICT`.

**Independently reproduced live** (outside the test harness, in a raw `psql` transaction, not merely reading the test): inserted two fresh organizations and one category per organization, then attempted `INSERT INTO products (organization_id, category_id, …) VALUES ('<org A>', '<org B's category>', …)`. Result:
```
ERROR:  insert or update on table "products" violates foreign key constraint "fk_products_category"
DETAIL:  Key (organization_id, category_id)=(9111…, 9444…) is not present in table "categories".
```
This confirms cross-tenant rejection happens at the PostgreSQL relational level via the composite FK — not merely in application code. Transaction was rolled back, leaving no residue.

Test `WP016B-T17` (line 4841) performs the equivalent assertion via `assert.rejects(..., /violates foreign key constraint "fk_products_category"/i)` — it checks the **exact constraint name** in the error message, not a looser pattern. **PASS.**

### Billing boundary

- `tax_scheme_id` column: `information_schema.columns.column_default` queried live → `NULL` (empty). `is_nullable = 'NO'`. Confirmed via direct SQL, not just via test output.
- `pg_constraint` on `products` with `contype='f'` returns exactly two foreign keys: `products_organization_id_fkey → organizations` and `fk_products_category → categories`. No FK to any Billing/tax table exists.
- `information_schema.tables` queried for `table_name = 'tax_schemes'` → 0 rows. No such table exists anywhere in the live schema after migration.

This is a deliberate, correctly-preserved architectural boundary: WP-016B does not create a premature Billing dependency. **PASS.**

### RLS

Live query against `pg_class`:
```
  relname   | relrowsecurity | relforcerowsecurity 
------------+----------------+---------------------
 categories | t              | t
 products   | t              | t
```

Live query against `pg_policies`:
```
 tablename  |       policyname        | permissive |  roles   | cmd |                   qual                   |                with_check                
------------+-------------------------+------------+----------+-----+------------------------------------------+------------------------------------------
 categories | tenant_isolation_policy | PERMISSIVE | {public} | ALL | (organization_id = current_app_org_id()) | (organization_id = current_app_org_id())
 products   | tenant_isolation_policy | PERMISSIVE | {public} | ALL | (organization_id = current_app_org_id()) | (organization_id = current_app_org_id())
```

Both tables have `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a default-deny `tenant_isolation_policy` (a `NULL` result from `current_app_org_id()` when no tenant context is set can never equal a non-null `organization_id`, so with no context set, zero rows are visible — this default-deny behavior was also independently confirmed via test `WP016B-T06`, which the review read in full).

Diffed `20260904223000_platform_core_master_catalog.sql` against baseline `20260904170000_tenant_rls_foundation.sql`: WP-016B's migration does not touch `current_app_org_id()` at all — it only references the function by name in its own `CREATE POLICY` statements. The function definition itself (lines 37–57 of the baseline migration) is untouched by WP-016B. **Confirmed: `current_app_org_id()` was NOT modified. PASS.**

### Tests — actual assertions read and evaluated

Test file line count: 5102. The `describe('TRIDENTPOS WP-016B Platform Core Master Catalog Foundation (Categories & Products) Suite', …)` block spans lines 4404–5102 (the entire remainder of the file, confirming it is the last suite). `grep -c "  it('WP016B-T"` returns exactly **30**, matching `WP016B-T01`…`WP016B-T30` with no gaps or duplicates. The three consecutive live test runs performed during this review report `✔` for every one of these 30 tests each time, cross-checking the static count against real runner output.

Per-test assessment of what is actually asserted (not just test names):

- **T01** — asserts all three migrations (baseline, WP-004, WP-016B) appear in `getMigrationStatus(...).applied`. Sound existence check.
- **T02/T03** — query `information_schema.columns` and `pg_constraint` directly; assert column data types, nullability, and that `uq_categories_org_code`/`uq_categories_org_id` (T02) and `uq_products_org_code`/`uq_products_org_id`/`fk_products_category` (T03) constraint names exist in `pg_constraint`. T03 additionally asserts `tax_scheme_id`'s `column_default IS NULL`. These are real schema introspection checks against a live-migrated database, not string matching against the SQL file.
- **T04/T05** — query `pg_class.relrowsecurity`/`relforcerowsecurity` directly for both tables. Matches this review's independent query.
- **T06** — default-deny: connects as the least-privileged `trident_test_app` role with **no** `app.current_organization_id` set, asserts zero rows returned from both tables. Sound: checks row *count*, not just "no error."
- **T07–T10** — SELECT isolation for both tenants, both tables. Each asserts **exact row count** (e.g., Tenant A sees 2 categories) **and** specific row identities (`cats.rows.every(r => [categoryAId, categoryA2Id].includes(r.id))`, or the specific single expected id) — not merely a non-empty/empty check. T07 additionally re-queries for the *other* tenant's specific row by ID and asserts zero rows. This is a materially sound isolation check (count + identity), matching the reviewer's brief.
- **T11/T12** — INSERT rejection: Tenant A session attempts to INSERT a row with `organization_id = tenantBId`. Asserts rejection matching `/row-level security policy/`. This is the RLS `WITH CHECK` clause firing (not the FK), which is correct — a same-tenant-but-wrong-org insert is blocked at the policy layer before FK evaluation is even relevant here since category_id in T12 is a *real* Tenant B category (so if RLS were absent, the composite FK would actually succeed — this test specifically isolates the RLS mechanism, not the FK mechanism, which is a good design choice by the Builder since T17 separately isolates the FK mechanism).
- **T13/T14** — UPDATE rejection: attempts UPDATE on the other tenant's row while impersonating Tenant A; asserts `rowCount === 0` (not merely "no error thrown" — UPDATE against a row invisible under RLS silently affects 0 rows rather than raising, so checking `rowCount` is the *correct* assertion here, not a weaker substitute).
- **T15/T16** — DELETE rejection: same `rowCount === 0` pattern under Tenant A impersonation, **plus** an out-of-band verification querying via the superuser pool connection (bypassing RLS as the pool owner) to confirm the target row still physically exists afterward. This is a stronger check than rowCount alone — it independently confirms no data loss occurred.
- **T17** — cross-tenant composite FK: asserts rejection matching `/violates foreign key constraint "fk_products_category"/i` — checks the **exact constraint name**, not a generic "insert or update" pattern. This review independently reproduced the identical failure live outside the test harness (see Tenant-safe relationship section above).
- **T18** — same-tenant FK success: inserts a product referencing a category belonging to the *same* tenant but a *different* category than the seeded one (`categoryA2Id`), confirms the row exists via SELECT, then cleans up via DELETE. Sound positive-path check paired with T17's negative-path check.
- **T19** — ON DELETE RESTRICT: attempts to DELETE a category that is referenced by an existing product; asserts rejection matching the exact constraint name `fk_products_category`, then re-confirms the category still exists. Correct: `ON DELETE RESTRICT` (not `NO ACTION` default-deferred, not `CASCADE`) is the specific behavior being verified, and the assertion is anchored to the specific constraint.
- **T20/T21** — unique `org_code` constraints: attempt duplicate `(organization_id, code)` on both tables; asserts rejection matching the **exact constraint name** (`uq_categories_org_code` / `uq_products_org_code`), not a generic "duplicate key" pattern.
- **T22** — confirms the *same* code is permitted across *different* tenants (positive control proving the uniqueness is correctly scoped to `(organization_id, code)` and not a bare `UNIQUE(code)`).
- **T23/T24** — NOT NULL enforcement on `tax_scheme_id` and `category_id` respectively; both assert rejection matching the specific `null value in column "<column>"` message.
- **T25/T26** — confirm `tax_schemes` and Inventory-domain tables (`warehouses`, `ingredients`, `recipes`, `recipe_items`, `modifier_groups`, `modifiers`) do not exist in `information_schema.tables`. Direct schema-boundary checks, not assumptions.
- **T27** — migration up: fully drops and recreates the schema from zero, then calls `migrateUp`, asserting `alreadyUpToDate === false` and all three migration ids appear in `.applied`, plus `getMigrationStatus(...)` reports 3 applied migrations all with `checksumMatches === true`.
- **T28** — migration down: calls `migrateDown` with `allowDestructiveDown: true`, asserts the reverted migration id, queries `information_schema.tables` to confirm **both** `categories` and `products` are gone in a single step, and checks the `_migrations` ledger now contains exactly `[baselineId, wp004Id]` (i.e., WP-016B's row was removed, not merely the tables). This review independently reproduced the same outcome live via `npm run db:migrate:down` + `\dt`.
- **T29** — up→down→up round trip: re-applies via `migrateUp`, re-grants privileges, re-seeds data, and — critically — re-verifies that tenant isolation (RLS) still functions correctly *after* the round trip (Tenant A sees exactly its 2 categories again), not merely that the tables exist again.
- **T30** — checksum stability: reads the persisted `checksum` from `_migrations` for the WP-016B row and asserts it equals `computeChecksum()` of the *current on-disk* migration file content. This guards against silent post-freeze edits to the migration file.

One clarification not spelled out in the Builder's evidence: there is no dedicated *behavioral* test that attempts to violate `uq_categories_org_id` / `uq_products_org_id` by insertion (as opposed to `uq_..._org_code`, which T20/T21 do exercise behaviorally). This is architecturally sound rather than a gap: `id` is already the table's `PRIMARY KEY`, so any attempt to duplicate `(organization_id, id)` would already collide on the PK first, making an independent behavioral test of `uq_..._org_id`'s uniqueness redundant. T02/T03 do confirm the constraint's *existence* in `pg_constraint`, which is what actually matters here — these constraints exist to support the composite FK (`REFERENCES categories(organization_id, id)`), not to add an independent business-uniqueness rule. Recorded as an advisory below for completeness, not a blocker.

### Rollback

Migration file (verified again, real SQL, lines 78–88):
```sql
-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON products;
ALTER TABLE IF EXISTS products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON categories;
ALTER TABLE IF EXISTS categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
```
Confirms: RLS policies are dropped/disabled for `products` before `categories`, and `products` (the dependent table, via the composite FK) is dropped before `categories` (the referenced table) — dependency-safe order. This review independently executed `ALLOW_DESTRUCTIVE_DOWN=true npm run db:migrate:down` against the live database and confirmed via `\dt` that both tables were gone afterward, then re-applied `npm run db:migrate` to restore state for further testing. **PASS.**

## Live Test Execution Summary

Ran `DATABASE_URL=… npm run --workspace=@trident/database test` **three times consecutively** after `npm ci`, building both `@trident/database` and its runtime dependency `@trident/core`, and applying the migration. All three runs:

```
ℹ tests 260
ℹ suites 8
ℹ pass 260
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 30 `WP016B-T01`…`WP016B-T30` lines printed `✔` in every run, matching the static `it(` count of 30 found via `grep`. No state leakage observed across the three runs (identical pass/fail counts and no flaky failures). `git status` was clean before and after every command in this review — no tracked files were modified by running builds, migrations, or tests.

## Blockers

None.

## Advisories

1. **Undocumented build-order dependency for a from-scratch reviewer.** Running `npm run build --workspace=@trident/database` alone (as the review instructions literally specify) is insufficient to run the test suite: `dist/iam.js` imports `@trident/core`, and if `@trident/core` has not also been built, `node --test` fails immediately with `ERR_MODULE_NOT_FOUND` for every test file, including the two files (`index.test.ts`, `outbox.test.ts`) that could not otherwise execute at all. This is not a defect introduced by WP-016B (the same dependency exists for the pre-existing WP-003/004/005/006/011/012/013 suites in the same file), but it is worth flagging so future reviewers or CI configurations build the full dependency graph (e.g. `turbo run build` or explicit `--workspace=@trident/core` first) rather than only the target package.
2. **No dedicated behavioral test for `uq_categories_org_id` / `uq_products_org_id` uniqueness violation.** As discussed above under Tests, this is not a material gap — the primary key already makes such a violation unreachable in practice — but a reviewer scanning only test names might expect a T20/T21-style behavioral test for these constraints specifically. Existence is verified schematically (T02/T03); no code change is needed, this is purely a documentation/clarity note for future reviewers.
3. **`tax_scheme_id UUID NOT NULL` with no FK is a live "PO-pending" data-integrity gap by design.** Nothing currently prevents an arbitrary UUID (not corresponding to any real entity, since no `tax_schemes` table exists yet) from being stored in `tax_scheme_id`. This is explicitly called out as a deliberate, governance-approved boundary in the migration header comment and ACR-2026-014, and is correctly not touched by WP-016B — flagged here only so the eventual Billing work package that introduces `tax_schemes` remembers to backfill/validate this column's existing values before adding a real FK.

## Verdict

**PASS**

All required schema fields, constraints, the composite tenant-safe FK, the Billing boundary (no `tax_scheme_id` default, no FK, no `tax_schemes` table), RLS enable/force/default-deny policy using the pre-existing unmodified `current_app_org_id()`, and rollback ordering were independently verified against the real migration SQL and the real, live PostgreSQL 16 database — not merely restated from the Builder's evidence. All 30 WP-016B tests were read in full, their assertions evaluated for soundness (exact constraint-name matching, row-count-plus-identity checks, out-of-band physical-existence verification after negative DELETE tests, and a genuine up→down→up round trip that re-verifies RLS afterward), and confirmed passing in three consecutive live runs with zero state leakage. No blockers were found. The three advisories above are non-blocking observations for future reviewers and future Billing-domain work, not defects in this Work Package.
