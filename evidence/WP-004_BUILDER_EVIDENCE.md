# WP-004 BUILDER EVIDENCE REPORT

## 1. Executive Metadata

- **Work Package:** WP-004 — Organization & Branch Multi-Tenant RLS Foundation
- **Builder Agent:** `17_Database_Engineer`
- **Operating Mode:** `SOLO_MAINTAINER`
- **Human / Organizational Independence:** NOT AVAILABLE (Solo Maintainer governed under EAAF v1.2.0 / ADR-010)
- **Review Model:** ROLE-SEPARATED EAAF AGENT REVIEW (Specialist: `08_Security_Architect`, Data Specialist: `03_Data_Architect`, Mandatory Code Review: `11_Code_Reviewer`)
- **Canonical Main:** `fa618c3705c057ddba5ec8a3d34426f702b8c74b` (`origin/main`)
- **Previous Subject:** `1b9d1219869cb26ff953092fb9e78de8f52864da`
- **Feature Branch:** `feature/wp-004-tenant-rls-foundation`
- **Existing PR:** PR #13
- **ACR-2026-005 Promotion Provenance:**
  - Promotion PR: PR #12
  - Author Subject: `f8e9ba6e4370f8bac6801d46afa14047557c93ac`
  - Data Review Evidence: `86b8ab0e179fb2728d26b07150532e3ac1e7cbc6`
  - Security Review Evidence: `805e26c73f0a4aa4f8a0f4580d1e0fc6fea01023`
  - Resolution: `organization_memberships` formally eliminated from WP-004 scope; WP-004 strictly owns `organizations`, `branches`, `current_app_org_id()`, transaction-scoped tenant context, composite integrity keys, and RLS default deny.
- **Governed Local Toolchain:**
  - Node: `24.20.0`
  - npm: `11.19.0`
- **Date:** 2026-09-04
- **Builder Verdict:** READY FOR ROLE-SEPARATED REVIEW

---

## 2. Corrected Scope Verification

| Entity / Capability | Scope Owner | Status in WP-004 |
|---|---|---|
| `organizations` | WP-004 | IMPLEMENTED |
| `branches` | WP-004 | IMPLEMENTED |
| `organization_memberships` | N/A (Excluded by ACR-2026-005) | ABSENT / PROHIBITED |
| `current_app_org_id()` | WP-004 | IMPLEMENTED |
| `set_config` transaction-local context | WP-004 | IMPLEMENTED |
| PostgreSQL Row Level Security (RLS) | WP-004 | IMPLEMENTED |
| FORCE ROW LEVEL SECURITY | WP-004 | IMPLEMENTED |
| Default Deny Isolation Policies | WP-004 | IMPLEMENTED |
| Composite Key `(organization_id, id)` | WP-004 | IMPLEMENTED |
| Least-Privilege Application Test Principal | WP-004 | IMPLEMENTED & REMEDIATED |
| `users`, `roles`, `permissions`, `user_roles` | WP-005 | ABSENT (Enforced by WP004-T28) |
| Supabase Auth / JWT / RBAC Middleware | WP-005 | ABSENT |

---

## 3. Migration & Schema Specification

### Migration Artifact
- **Filename:** `packages/database/migrations/20260904170000_tenant_rls_foundation.sql`
- **Timestamp ID:** `20260904170000` (> `20260904160000_baseline_infrastructure.sql`)
- **Migration Engine:** Canonical WP-003 TypeScript Migration Engine
- **Migration Impact:** EXPAND

### Canonical Schema DDL (`Up`)
```sql
-- 1. Organizations (Tenant Root)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organizations_tax_id UNIQUE (tax_id)
);

-- 2. Branches (Scoped to Organization)
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/Mexico_City',
    address JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_branches_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_branches_org_id UNIQUE (organization_id, id)
);
```

### Relational & Composite Identity Constraints
- `uq_organizations_tax_id`: `UNIQUE (tax_id)` enforces tenant fiscal uniqueness.
- `uq_branches_org_code`: `UNIQUE (organization_id, code)` enforces branch code uniqueness per tenant.
- `uq_branches_org_id`: `UNIQUE (organization_id, id)` provides the tenant-scoped composite relational target for downstream foreign keys to guarantee multi-tenant referential integrity.

---

## 4. Tenant Context & Helper Semantics

### `current_app_org_id()` PL/pgSQL Function
```sql
CREATE OR REPLACE FUNCTION current_app_org_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_val TEXT;
BEGIN
    v_val := current_setting('app.current_organization_id', true);
    IF v_val IS NULL OR trim(v_val) = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_val::UUID;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;
```

#### Security Properties
1. **SECURITY INVOKER Semantics:** Executes with caller privileges; does not escalate permissions.
2. **STABLE:** Pure function with respect to transaction state; safe for planner in scan filters.
3. **Fixed search_path:** `SET search_path = pg_catalog, public` mitigates search_path hijacking.
4. **Missing-OK Context Retrieval:** `current_setting('app.current_organization_id', true)` returns `NULL` when unset without throwing unhandled exceptions.
5. **Fail-Closed Default Deny:** Malformed UUID strings, SQL injection payloads, whitespace, and empty strings catch `invalid_text_representation` / `OTHERS` and evaluate strictly to `NULL`, resulting in zero row visibility.

### Application Tenant Context Helpers (`packages/database/src/tenant.ts`)
- `setTenantContext(client, orgId)`: Executes parameterized `SELECT set_config('app.current_organization_id', $1, true)`.
  - `is_local = true`: Ensures transaction locality equivalent to `SET LOCAL`.
  - Full parameterization prevents SQL string interpolation attacks.
- `withTenantTransaction(pool, orgId, callback)`: Encapsulates connection acquisition, `BEGIN`, `setTenantContext`, callback execution, `COMMIT`, `ROLLBACK` on error, and connection release to the pool.

---

## 5. PostgreSQL Row Level Security (RLS) & Catalog Proofs

### RLS Policies
```sql
-- Organizations Isolation
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON organizations
    FOR ALL
    USING (id = current_app_org_id())
    WITH CHECK (id = current_app_org_id());

-- Branches Isolation
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON branches
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

### PostgreSQL Catalog Introspection Evidence
Verified via automated integration tests (`WP004-T15`..`T18`):
- `pg_class.relrowsecurity`:
  - `organizations`: `true`
  - `branches`: `true`
- `pg_class.relforcerowsecurity`:
  - `organizations`: `true` (table owner cannot bypass RLS)
  - `branches`: `true` (table owner cannot bypass RLS)
- `pg_policies`:
  - `organizations`: `tenant_isolation_policy`, `cmd = 'ALL'`, `qual = (id = current_app_org_id())`, `with_check = (id = current_app_org_id())`
  - `branches`: `tenant_isolation_policy`, `cmd = 'ALL'`, `qual = (organization_id = current_app_org_id())`, `with_check = (organization_id = current_app_org_id())`

---

## 6. Test Principal & Least-Privilege Remediation

### 6.1. Least-Privilege Role Grants Remediation
In the previous subject (`1b9d1219869cb26ff953092fb9e78de8f52864da`), tests granted `GRANT ALL ON TABLE organizations, branches TO trident_test_app`. This was overly broad for an application principal.

The privileges have been remediated to strictly minimal DML permissions:
```sql
GRANT USAGE ON SCHEMA public TO trident_test_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO trident_test_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches TO trident_test_app;
GRANT EXECUTE ON FUNCTION current_app_org_id() TO trident_test_app;
```

#### Withheld / Excluded Privileges
The test principal is strictly denied:
- `TRUNCATE` (verified via `WP004-T29`)
- `REFERENCES` (verified via `WP004-T29`)
- `TRIGGER` (verified via `WP004-T29`)
- `SUPERUSER` (`rolsuper = false`, verified via `WP004-T13`)
- `BYPASSRLS` (`rolbypassrls = false`, verified via `WP004-T14`)
- `CREATEDB`
- `CREATEROLE`

### 6.2. Non-DML Privilege Negative Test (`WP004-T29`)
Added test `WP004-T29: Least-privilege application role cannot TRUNCATE tenant tables`:
1. Catalog introspection via `has_table_privilege`:
   - `has_table_privilege('trident_test_app', 'organizations', 'TRUNCATE') = false`
   - `has_table_privilege('trident_test_app', 'branches', 'TRUNCATE') = false`
   - `has_table_privilege('trident_test_app', 'organizations', 'REFERENCES') = false`
   - `has_table_privilege('trident_test_app', 'branches', 'REFERENCES') = false`
   - `has_table_privilege('trident_test_app', 'organizations', 'TRIGGER') = false`
   - `has_table_privilege('trident_test_app', 'branches', 'TRIGGER') = false`
   - `has_table_privilege('trident_test_app', 'organizations', 'SELECT') = true`
   - `has_table_privilege('trident_test_app', 'branches', 'SELECT') = true`
2. Execution enforcement:
   - Executing `TRUNCATE organizations;` under `trident_test_app` role fails with PostgreSQL error `42501 (permission denied for table organizations)`.
   - Executing `TRUNCATE branches;` under `trident_test_app` role fails with PostgreSQL error `42501 (permission denied for table branches)`.
   - Protection is enforced directly by PostgreSQL core privilege verification without relying on RLS policies.

### 6.3. Governed Clean Role Teardown Remediation
Previously, teardown relied on `DROP ROLE IF EXISTS trident_test_app; .catch(() => {})`, which swallowed errors when role objects or schema grants remained.

Remediation:
1. Swallowing `.catch(() => {})` has been removed; any teardown failure now fails the test suite.
2. Clean object dependency revocation is explicitly executed before dropping the role:
   ```sql
   DROP TABLE IF EXISTS test_composite_ref, branches, organizations CASCADE;
   DELETE FROM _migrations WHERE id = '20260904170000';
   DROP OWNED BY trident_test_app;
   DROP ROLE trident_test_app;
   ```
3. Verified in test execution: `trident_test_app` is dropped cleanly with zero dependency errors, and `SELECT rolname FROM pg_roles WHERE rolname = 'trident_test_app'` confirms 0 rows post-test.

### 6.4. Adversarial Cross-Tenant Attack Test Matrix

| Test ID | Scenario Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| `WP004-T06` | Query without tenant context | Zero rows returned (Default Deny) | 0 rows in orgs & branches | SATISFIED |
| `WP004-T07` | Tenant A reads Tenant B org row | Zero rows returned | 0 rows visible | SATISFIED |
| `WP004-T08` | Tenant A reads Tenant B branch row | Zero rows returned | 0 rows visible | SATISFIED |
| `WP004-T09` | Tenant B reads Tenant A data | Zero rows returned | 0 rows visible | SATISFIED |
| `WP004-T10` | Tenant A inserts branch under Tenant B `org_id` | Blocked by `WITH CHECK` | Error: `new row violates row-level security policy` | SATISFIED |
| `WP004-T11` | Tenant A updates branch `org_id` to Tenant B | Blocked by `WITH CHECK` | Error: `new row violates row-level security policy` | SATISFIED |
| `WP004-T11b` | Tenant A attempts update on Tenant B branch | Zero rows updated | `rowCount: 0` | SATISFIED |
| `WP004-T12` | Tenant A attempts delete on Tenant B branch | Zero rows deleted; Tenant B branch intact | `rowCount: 0`, intact | SATISFIED |
| `WP004-T19` | Cross-tenant composite FK reference | Foreign key constraint violation | Rejected by FK constraint | SATISFIED |
| `WP004-T20` | Context persistence after transaction end | Context reverts to `NULL` | `current_app_org_id() = null` | SATISFIED |
| `WP004-T21` | Pooled connection reuse across tenants | Prior context does not leak | Transaction boundary clean | SATISFIED |
| `WP004-T22` | Malformed tenant context injection attack | Fails closed; zero rows returned | 0 rows across all payloads | SATISFIED |
| `WP004-T29` | Least-privilege role attempts TRUNCATE / non-DML | Denied by PostgreSQL permission enforcement | Rejected with `42501 permission_denied`; catalog privs = false | SATISFIED |

---

## 7. Migration Lifecycle & Rollback Verification

- **Zero-to-Latest (`WP004-T23`):** Fresh database applies `20260904160000_baseline_infrastructure` followed by `20260904170000_tenant_rls_foundation` cleanly.
- **Down / Rollback (`WP004-T24`):** `migrateDown` reverts `20260904170000`, drops RLS policies, tables, and `current_app_org_id()`, cleanly returning the database to canonical WP-003 state.
- **Up -> Down -> Up Cycle (`WP004-T25`):** Complete reversible migration cycle executes cleanly with data and isolation functionality fully restored upon re-application.
- **WP-003 Checksum Preservation (`WP004-T26`):** SHA-256 digest of `20260904160000_baseline_infrastructure.sql` matches canonical ledger checksum `9afc000a171307db905528c3f366f0b81446c38311dfd5d82e8781cc3cc54493`.
- **Scope Guards (`WP004-T27`, `WP004-T28`):**
  - `organization_memberships`: Confirmed DOES NOT EXIST.
  - WP-005 tables (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_branch_credentials`): Confirmed NONE EXIST.

---

## 8. Governed Local Quality Gate Results

All commands executed under the frozen runtime in workspace `/Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS`:

| Command | Toolchain Version | Exit Code | Result Summary |
|---|---|---|---|
| `node --version` | `v24.20.0` | 0 | Frozen Node LTS Krypton runtime |
| `npm --version` | `11.19.0` | 0 | Governed npm package manager |
| `npm ci` | `11.19.0` | 0 | Deterministic install, 0 vulnerabilities |
| `npm run graph:check` | `24.20.0` | 0 | No circular dependencies, all 6 package boundaries satisfied |
| `npm run format:check` | `24.20.0` | 0 | All matched files use Prettier code style (0 style issues) |
| `npm run typecheck` | `24.20.0` | 0 | Turbo typecheck in 6 packages passed cleanly (0 errors) |
| `npm run lint` | `24.20.0` | 0 | ESLint in 6 packages passed cleanly (0 errors, 0 warnings) |
| `npm run build` | `24.20.0` | 0 | Turbo build in 6 packages passed cleanly |
| `npm run test` (with `DATABASE_URL`) | `24.20.0` | 0 | **47 tests passed across 2 suites** (WP-003: 18/18, WP-004: 29/29) |
| `actionlint .github/workflows/*.yml` | system | 0 | 0 errors |
| `trufflehog` | system | 0 | 0 verified/unverified secrets committed |
| `trivy fs --config trivy.yaml` | system | 0 | 0 High/Critical vulnerabilities |

---

## 9. Security Debt & Architecture Baselines Disposition

### SEC-VAL-01: Multi-Tenant Isolation
- **Status:** `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED VALIDATION`
- **Note:** Builder does NOT declare SEC-VAL-01 closed or approved. Awaiting independent reviews by `08_Security_Architect`, `03_Data_Architect`, and `11_Code_Reviewer`.

### Preserved Open Technical Debts
The following debts remain intentionally open in accordance with governance instructions:
- `DAT-04`: Database Connection Pooling Optimization
- `DAT-08`: Read Replica Configuration
- `SEC-VAL-02` through `SEC-VAL-11`: Future wave security validation gates
- `RSK-08`, `RSK-11`, `RSK-15`: System risk registry items

### Product Owner Inquiries
All 9 Product Owner architecture questions remain in status: `PENDING PO DECISION`.
- WP-004 PO Dependency: **NONE**.

---

## 10. Remote CI Verification & Workflow Runs

- **PR:** #13 (`feat(platform): [WP-004] multi-tenant RLS foundation`)
- **PR State:** OPEN
- **Remote Checks Requirement:** All remote checks must succeed on the final subject commit.

| Workflow / Context | GitHub Run ID | Status | Conclusion |
|---|---|---|---|
| `build` | PENDING REMOTE RUN | PENDING | PENDING |
| `lint` | PENDING REMOTE RUN | PENDING | PENDING |
| `typecheck` | PENDING REMOTE RUN | PENDING | PENDING |
| `unit-tests` | PENDING REMOTE RUN | PENDING | PENDING |
| `secret-scan` | PENDING REMOTE RUN | PENDING | PENDING |
| `sca-scan` | PENDING REMOTE RUN | PENDING | PENDING |
| `sast-scan` | PENDING REMOTE RUN | PENDING | PENDING |
| `sbom-generate` | PENDING REMOTE RUN | PENDING | PENDING |

---

## 11. Builder Conclusion

- **Previous Subject:** `1b9d1219869cb26ff953092fb9e78de8f52864da`
- **Verdict:** `READY FOR ROLE-SEPARATED REVIEW`
- **Builder Status:** `SATISFIED`
- **Blocking Findings:** 0
- **WP-005 Authorization:** NOT AUTHORIZED
