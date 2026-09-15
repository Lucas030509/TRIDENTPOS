# WP-016B Builder Evidence — Platform Core Master Catalog Foundation (Categories & Products)

## Governance Context

- Canonical baseline (obligatory): `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`
- Branch: `feature/wp-016b-platform-core-master-catalog`
- Branch parent verified: `d102f5296c9175c485aeb1a4bf7b5af3a93173b5` (exact match, confirmed via `git checkout -b feature/wp-016b-platform-core-master-catalog origin/main` and `git log -1 --oneline`)
- Governance basis: ACR-2026-014 — Platform Core Master Catalog Physical Prerequisite for WP-017 (`APPROVED / MERGED / CANONICAL`, merge commit `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`)
- Repository verified: `Lucas030509/TRIDENTPOS`, local clone at `eeaaf/TRIDENTPOS`, `origin/main` fetched and confirmed to equal the canonical SHA before any work began.

## Changed Files

```
A  evidence/WP-016B_BUILDER_EVIDENCE.md
A  packages/database/migrations/20260904223000_platform_core_master_catalog.sql
M  packages/database/src/index.test.ts
M  packages/database/src/outbox.test.ts
```

4 files changed.

No other packages, domains, or files were touched. Specifically NOT touched: Inventory, Billing, POS, cloud-server, tax_schemes, warehouses/ingredients/recipes, modifiers, branch_product_overrides.

### Why `outbox.test.ts` and the rest of `index.test.ts` were modified

`packages/database/src/outbox.test.ts` and `packages/database/src/index.test.ts` (WP-003/004/005/006/011 suites) each contain a hardcoded `DROP TABLE IF EXISTS ... CASCADE` reset list used to force a clean schema state between suites. This is pre-existing convention in this file — every prior WP (WP-005 `users/roles`, WP-006 `audit_log_events/stations`, WP-011 `folio_leases`, etc.) added its own new tables to these same shared lists when introduced.

`categories`/`products` reference `organizations(id)` via a plain (non-CASCADE-worthy) foreign key. Verified empirically that `DROP TABLE organizations ... CASCADE` only drops the **FK constraint** on `categories`/`products`, not the tables themselves (PostgreSQL only cascades to drop dependent constraints/views, not tables that merely hold an FK to the dropped table). Without adding `products, categories` to these reset lists, orphaned `categories`/`products` tables (missing their FK constraint) survive a "full reset," which:
1. Breaks `WP003-T14: no domain/WP-004 tables created` (extra unexpected tables detected), and
2. Breaks any subsequent `migrateUp()` that tries to `CREATE TABLE categories` again ("relation already exists").

This was reproduced and confirmed directly against PostgreSQL 16 before the fix, and confirmed resolved (3 consecutive full `db:test` runs, 260/260 pass each time, zero state leakage) after adding `products, categories` to each affected reset list. This is test-harness hygiene within the same package being modified (`@trident/database`), not a scope expansion into another bounded context.

## Migration

`packages/database/migrations/20260904223000_platform_core_master_catalog.sql`

### categories

Matches the canonical schema in Section 13 exactly:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id UUID NOT NULL REFERENCES organizations(id)`
- `code VARCHAR(50) NOT NULL`, `name VARCHAR(100) NOT NULL`, `sort_order INTEGER NOT NULL DEFAULT 0`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `uq_categories_org_code UNIQUE (organization_id, code)`
- `uq_categories_org_id UNIQUE (organization_id, id)`

### products

Matches the canonical schema in Section 14 exactly:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id UUID NOT NULL REFERENCES organizations(id)`
- `category_id UUID NOT NULL` (no default)
- `code VARCHAR(50) NOT NULL`, `name VARCHAR(255) NOT NULL`, `description TEXT NULL`
- `product_type VARCHAR(50) NOT NULL`
- `base_price DECIMAL(12,4) NOT NULL`
- `tax_scheme_id UUID NOT NULL` — verified via `information_schema.columns.column_default IS NULL` and `is_nullable = 'NO'`; no `tax_schemes` table created (WP016B-T25 confirms absence)
- `is_inventoriable BOOLEAN NOT NULL DEFAULT TRUE`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `created_at`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`; `deleted_at TIMESTAMPTZ NULL`
- `uq_products_org_code UNIQUE (organization_id, code)`
- `uq_products_org_id UNIQUE (organization_id, id)`
- `fk_products_category FOREIGN KEY (organization_id, category_id) REFERENCES categories (organization_id, id) ON DELETE RESTRICT`

Verified live via `psql \d categories` / `\d products` against the local PostgreSQL 16 instance after running `db:migrate` — output matches the spec exactly (see command transcript in session; column types, defaults, constraint names, and the composite FK all confirmed).

### RLS

Both tables: `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a `tenant_isolation_policy` using the existing, unmodified `current_app_org_id()` function — identical pattern to WP-004's `organizations`/`branches` policies. `current_app_org_id()` was not touched.

### Rollback

`-- Down` drops `products` before `categories` (per Section 17's non-production down order), then the RLS policies. Verified live: `db:migrate:down` (with `ALLOW_DESTRUCTIVE_DOWN=true`) successfully reverted the migration and removed both tables.

## Test Suite

Added `describe('TRIDENTPOS WP-016B Platform Core Master Catalog Foundation (Categories & Products) Suite', ...)` to `packages/database/src/index.test.ts` (appended after the WP-011 suite — the last suite in that file), with **30 tests total** (`WP016B-T01` … `WP016B-T30`, confirmed by direct count of `it(...)` blocks in the suite and by the passing test-runner output), following the exact `before`/`after`/`asTestRole`/isolated-suite-dir conventions already used by the WP-003/WP-004/WP-011 suites in the same file. Moved the single `closePool(pool)` call from WP-011's `after()` to WP-016B's `after()`, since WP-016B is now the last suite in the file.

**WP-016B test count: 30/30 PASS.** (The requirements-coverage table below has 19 rows because several requirements are each satisfied by more than one test — the row count is not the test count.)

Coverage against Section 16 requirements:

| Requirement | Test(s) |
|---|---|
| Migration chain applies | WP016B-T01, T27 |
| categories/products schema matches spec | WP016B-T02, T03 |
| RLS enabled + forced | WP016B-T04, T05 |
| Default-deny with no tenant context | WP016B-T06 |
| Tenant A sees only Tenant A rows (categories & products) | WP016B-T07, T09 |
| Tenant B sees only Tenant B rows (categories & products) | WP016B-T08, T10 |
| Tenant A cannot INSERT as Tenant B | WP016B-T11, T12 |
| Tenant A cannot UPDATE Tenant B rows | WP016B-T13, T14 |
| Tenant A cannot DELETE Tenant B rows | WP016B-T15, T16 |
| Product from Tenant A must not reference Category from Tenant B (composite tenant FK) | WP016B-T17 (rejected), T18 (valid same-tenant reference succeeds) |
| ON DELETE RESTRICT on referenced category | WP016B-T19 |
| uq_categories_org_code / uq_products_org_code | WP016B-T20, T21 (reject duplicates), T22 (same code allowed across tenants) |
| tax_scheme_id NOT NULL, no default | WP016B-T23, and schema assertion in T03 |
| category_id NOT NULL | WP016B-T24 |
| Out-of-scope confirmation (tax_schemes, Inventory tables) | WP016B-T25, T26 |
| Fresh zero-to-latest migration | WP016B-T27 |
| Down reverts both tables in one step, correct ledger state | WP016B-T28 |
| Up → Down → Up round trip | WP016B-T29 |
| Migration checksum immutability | WP016B-T30 |

## Local Quality Gates (all executed against this exact candidate)

| Gate | Result |
|---|---|
| `npm ci` | PASS |
| `npm run format:check` | PASS (after `prettier --write` on the two modified test files) |
| `npm run lint` | PASS — 0 errors. See exact monorepo-wide warning accounting below. |
| `npm run typecheck` | PASS — 0 errors, 10/10 tasks successful |
| `npm run graph:check` | PASS — 44/44 tests, 0 fail (dependency graph enforcement, kept as a separate count per Section 21) |
| `npm run clean` | PASS |
| `npm run build` | PASS — 7/7 packages |
| `npm run db:migrate` (real PostgreSQL 16, `tridentpos_test`) | PASS — applied `20260904223000_platform_core_master_catalog` cleanly on top of the full existing chain |
| `npm run db:migrate:down` (`ALLOW_DESTRUCTIVE_DOWN=true`) | PASS — reverted cleanly |
| `npm run db:test` (`@trident/database`, real PostgreSQL) | PASS — **260/260**, 0 fail, run 3 consecutive times back-to-back with zero state leakage between runs |
| `npm test` (full monorepo, `turbo run test && npm run test:integration`) | **FAIL — BASELINE-REPRODUCED ENVIRONMENTAL EXCEPTION** (see full accounting below) |
| `npm run test:integration` (root) | PASS — 1/1 — **executed separately**, as a standalone invocation, not as the completed second half of the root `npm test` chain (the `&&` in `npm test` never reaches `test:integration` because the preceding `turbo run test` fails) |

### `npm run lint` exact warning accounting

```text
npm run lint:
PASS — 0 errors

Pre-existing warnings:
23 total

Breakdown:
@trident/sync: 4
@trident/database: 13
@trident/edge: 6

Warnings introduced by WP-016B:
0
```

By exact file:

```text
@trident/sync:
  packages/sync/src/stream.test.ts — 4

@trident/database:
  packages/database/src/outbox.test.ts — 11
  packages/database/src/outbox/ingested-idempotency-engine.ts — 2

@trident/edge:
  packages/edge/src/outbox.test.ts — 6
```

All 23 warnings are pre-existing `@typescript-eslint/no-explicit-any` warnings, verified independently against the canonical baseline `d102f5296c9175c485aeb1a4bf7b5af3a93173b5`'s lint output. None were introduced by WP-016B. Note: `packages/database/src/outbox.test.ts` is one of the two files WP-016B modifies (to add `products, categories` to its pre-existing schema-reset `DROP TABLE` list — see "Why `outbox.test.ts` ... were modified" above), but the 11 warning-producing lines in that file are pre-existing and unrelated to the WP-016B diff hunk; they are not introduced, moved, or altered by this change.

### `npm test` exact status — do not report as PASS

```text
npm test:
FAIL / BASELINE-REPRODUCED ENVIRONMENTAL EXCEPTION

Successful unit sub-suites before/around failure:
538 tests PASS
  @trident/pos                9
  @trident/ui                 1
  @trident/sync               40
  @trident/pos-edge-runtime   17
  @trident/core               56
  @trident/database           260
  @trident/edge (test:unit)   155

Blocking command component:
@trident/edge test:electron

Failure:
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'

Attributable to WP-016B:
NO

Reproduced on untouched canonical baseline d102f5296c9175c485aeb1a4bf7b5af3a93173b5:
YES (verified via `git stash` to remove all WP-016B changes, rebuild, and re-run
the identical `npm run test --workspace=@trident/edge` command — same failure
class reproduces on the untouched baseline)

npm run test:integration:
PASS — 1/1
EXECUTED SEPARATELY (root `npm test`'s `&&` chain never reaches this step
because the preceding `turbo run test` exits non-zero)
```

**Baseline exception classification:** `PRE-EXISTING / ENVIRONMENT-SPECIFIC / OUT-OF-SCOPE / NON-REGRESSION`. This classification documents the failure; it does not convert the failed `npm test` command to PASS. Whether this baseline exception is non-blocking for freeze is a Coordinator determination, not a Builder one.

npm test count, graph:check count, and db:test count are reported separately, per Section 21 — they are never combined, and `npm test` overall is reported as FAIL, not PASS, per the accounting above.

## Failures / Skips

- `npm test` (root): **FAIL**, due to `@trident/edge`'s `test:electron` step (real Electron binary GUI harness incompatibility inside this sandbox: `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`).
- Classification: `PRE-EXISTING / ENVIRONMENT-SPECIFIC / OUT-OF-SCOPE / NON-REGRESSION`.
- Attributable to WP-016B: **NO**. Reproduced identically on the untouched canonical baseline `d102f5296c9175c485aeb1a4bf7b5af3a93173b5` via `git stash`. `@trident/edge` was not modified by this Work Package.
- No other failures or skips anywhere in the candidate (database suite, graph check, integration test).

## Protected PO Decisions

`9/9 PENDING PO DECISION` — none inferred, closed, defaulted, or converted into concrete policy by this Work Package. `tax_scheme_id` was kept exactly as specified: `UUID NOT NULL`, no default, no FK, no `tax_schemes` table created.

## Out-of-Scope Confirmation

Verified via WP016B-T25 and WP016B-T26 that this migration introduces **only** `categories` and `products`, and that `tax_schemes`, `warehouses`, `ingredients`, `recipes`, `recipe_items`, `modifier_groups`, and `modifiers` do not exist in the schema. No Inventory, Billing, POS, or cloud-server files were modified. WP-017 remains untouched and on `HOLD`.
