# WP-005 BUILDER EVIDENCE REPORT: CLOUD IAM & ADMINISTRATIVE AUTHENTICATION

## 1. Executive Metadata

- **Work Package:** WP-005 — Cloud IAM & Administrative Authentication
- **Builder Agent:** `13_Backend_Developer`
- **Operating Mode:** `SOLO_MAINTAINER`
- **Implementation Base:** `a3c625bc01f0933e4bed60c25d9109e592956510`
- **Governing Change Request:** `ACR-2026-006` (PROMOTED / GOVERNING)
- **Feature Branch:** `feature/wp-005-cloud-iam-auth`
- **Migration Filename:** `packages/database/migrations/20260904180000_cloud_iam_auth.sql`
- **Governed Toolchain:**
  - Node.js: `24.20.0`
  - npm: `11.19.0`
  - TypeScript: `~5.4.5` (`skipLibCheck = false`)
- **Date:** 2026-09-04
- **Builder Verdict:** READY FOR ROLE-SEPARATED REVIEW

---

## 2. Dependencies & Versions (Exact & Pinned)

| Package | Version | Workspace | Purpose | Verification |
|---|---|---|---|---|
| `jose` | `5.9.6` | `@trident/core` | RFC 7519 Cryptographic JWT / JWS / JWKS verification | SATISFIED |
| `argon2` | `0.45.1` | `@trident/core` | RFC 9106 Argon2id Cloud PIN hash generation & baseline verification | SATISFIED |

No unpinned ranges (`^` or `~`) were used for new dependencies. Monorepo dependency graph constraints checked with `npm run graph:check` (`@trident/core -> (none)`, `@trident/database -> @trident/core`).

---

## 3. Schema Objects & Relational Integrity

### 3.1 Owned Database Objects
WP-005 strictly owns exactly four tables in PostgreSQL Cloud:
1. `users`
2. `roles`
3. `user_roles`
4. `user_branch_credentials`

**Prohibited Entities:** `permissions` and `role_permissions` tables DO NOT exist (validated by automated test `WP005-T06` and `WP005-T07`). RBAC authority is strictly governed by `roles.permissions JSONB`.

### 3.2 Composite Keys & Multi-Tenant Foreign Keys
- `users`:
  - `CONSTRAINT uq_users_org_email UNIQUE (organization_id, email)`
  - `CONSTRAINT uq_users_org_id UNIQUE (organization_id, id)`
- `roles`:
  - `CONSTRAINT uq_roles_org_code UNIQUE (organization_id, code)`
  - `CONSTRAINT uq_roles_org_id UNIQUE (organization_id, id)`
- `user_roles`:
  - `PRIMARY KEY (organization_id, user_id, branch_id, role_id)`
  - `CONSTRAINT fk_user_roles_user FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE`
  - `CONSTRAINT fk_user_roles_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE`
  - `CONSTRAINT fk_user_roles_role FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE CASCADE`
- `user_branch_credentials`:
  - `CONSTRAINT uq_user_branch_cred UNIQUE (organization_id, user_id, branch_id)`
  - `CONSTRAINT uq_user_branch_cred_org_id UNIQUE (organization_id, id)`
  - `CONSTRAINT fk_user_branch_cred_user FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE`
  - `CONSTRAINT fk_user_branch_cred_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id) ON DELETE CASCADE`

Cross-tenant references are mathematically impossible at the database layer (validated by automated tests `WP005-T10` and `WP005-T11`).

---

## 4. Row Level Security (RLS) & Default-Deny Isolation

All four WP-005 tables enforce:
1. `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`
2. `ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;`
3. Foundational policy:
   ```sql
   CREATE POLICY tenant_isolation_policy ON <table_name>
       FOR ALL
       USING (organization_id = current_app_org_id())
       WITH CHECK (organization_id = current_app_org_id());
   ```

### Isolation Proof Matrix:
- Default deny with no tenant context: returns 0 rows across all 4 tables (`WP005-T14`).
- Tenant A reading Tenant B users: returns 0 rows (`WP005-T15`).
- Tenant A reading Tenant B roles: returns 0 rows (`WP005-T16`).
- Tenant A reading Tenant B user_roles: returns 0 rows (`WP005-T17`).
- Tenant A reading Tenant B credentials: returns 0 rows (`WP005-T18`).

---

## 5. Cryptographic JWT Verification & Subject Binding

### 5.1 Verifier Design (`@trident/core`)
- Implementation: `verifyAccessToken` in `packages/core/src/jwt.ts`.
- Allowed Algorithms: `['RS256', 'EdDSA']` (RFC compliant, rejecting `alg=none`, symmetric HMAC confusion, and unapproved asymmetric algorithms).
- Validation: Validates signature, `iss`, `aud`, `exp`, `nbf` (when present), and `sub` (must be non-empty and conform to UUID syntax).
- Does not rely on unverified decode.

### 5.2 Subject Binding
- Identity Invariant: `users.id` IS the verified Supabase subject UUID (`jwt.sub`).
- Production authentication never identifies users by email.
- AuthenticatedPrincipal contract:
  ```ts
  export interface AuthenticatedPrincipal {
    readonly userId: string;
    readonly organizationId: string;
    readonly branchId?: string | undefined;
    readonly permissions: readonly string[];
  }
  ```

---

## 6. Safe Tenant Bootstrap Sequence & Tenant Hopping Defense

Implementation in `packages/database/src/iam.ts`:
1. Cryptographically verify access JWT and extract verified `jwt.sub`.
2. Syntactically validate candidate `organizationId` and candidate `branchId` as valid UUIDs.
3. BEGIN database transaction.
4. Inject transaction-local tenant context via `SELECT set_config('app.current_organization_id', $1, true);`. The candidate context acts purely as a restrictive RLS filter.
5. Query `users` with BOTH `id = verified jwt.sub` AND `organization_id = candidateOrgId` AND `is_active = TRUE`.
6. Under FORCE RLS, if the candidate tenant does not own the user, the database returns 0 rows. Transaction is rolled back and request is rejected immediately (`USER_NOT_FOUND_OR_INACTIVE`).
7. Tenant hopping test: User A1 (Tenant A) requesting Tenant B is strictly rejected and 0 data is leaked (`WP005-T30`).
8. Matching email test: User A1 (email `admin@tenant-a.com` in Tenant A) requesting Tenant B (where User B2 also has email `admin@tenant-a.com`) is rejected because identity is bound to `jwt.sub`, not email (`WP005-T31`).

---

## 7. RBAC Evaluation Engine

- Authority: `user_roles -> roles -> roles.permissions JSONB`.
- `permissions` JSONB must be an array of non-empty permission strings (e.g. `["comanda.iniciar", "caja.cobrar"]`).
- Malformed JSONB fails closed (`RbacEvaluationError: MALFORMED_PERMISSIONS`).
- Role assignment is branch-scoped: User requesting Branch A requires an active assignment on Branch A (`WP005-T32`, `WP005-T35`).
- Inactive role is denied (`WP005-T34`).
- Client-supplied claims (e.g. `role: "SUPER_ADMIN"`, `permissions: ["*:*"]`, `isAdmin: true`) in token payload are strictly ignored (`WP005-T36`).

---

## 8. Argon2id Cloud PIN Provisioning Service

- RFC 9106 frozen baseline parameters:
  - `memoryCost`: `65536 KiB` (64 MB)
  - `timeCost`: `3` iterations
  - `parallelism`: `4` threads
  - `saltLength`: `16 bytes` CSPRNG
  - `hashLength`: `32 bytes`
- `provisionBranchPinCredential`: Hashes PIN, writes `user_branch_credentials` record (`WP005-T37`, `WP005-T38`).
- `rotateBranchPinCredential`: Atomically increments `credential_version`, updates hash, un-revokes (`WP005-T39`).
- `revokeBranchPinCredential`: Sets `is_revoked = TRUE` (`WP005-T40`).
- Plaintext PIN is transient only; never persisted to DB (`WP005-T41`) and never logged.
- Offline Edge runtime verification and rate limiting are preserved for `WP-010`.

---

## 9. Database Principal & Connection Isolation

- Database tests run under least-privilege role `trident_test_app` (`WP005-T43`):
  - `rolsuper = false`
  - `rolbypassrls = false`
  - DML only (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), no `TRUNCATE`, no `REFERENCES`, no `TRIGGER`.
- Connection pooling reuse does not leak tenant context: `set_config('...', true)` cleared automatically on transaction end (`WP005-T42`).

---

## 10. Automated Test Matrix Results

### 10.1 @trident/core Suite (22 Tests — ALL PASS)
- Foundation (2 tests)
- Cryptographic JWT Verifier Suite (12 tests)
- RBAC Evaluation Engine Suite (5 tests)
- Argon2id Branch PIN Engine Suite (3 tests)

### 10.2 @trident/database Suite (94 Tests — ALL PASS)
- Suite 1: WP-003 PostgreSQL Migration Engine Suite (18 tests)
- Suite 2: WP-004 Multi-Tenant RLS Foundation Suite (29 tests)
- Suite 3: WP-005 Cloud IAM & Administrative Authentication Suite (47 tests):
  - `WP005-T01`: WP-005 migration applies after canonical WP-004 — PASS
  - `WP005-T02`: users schema exact — PASS
  - `WP005-T03`: roles schema exact — PASS
  - `WP005-T04`: user_roles schema exact — PASS
  - `WP005-T05`: user_branch_credentials schema exact — PASS
  - `WP005-T06`: permissions table DOES NOT exist — PASS
  - `WP005-T07`: role_permissions table DOES NOT exist — PASS
  - `WP005-T08`: users composite tenant identity exists — PASS
  - `WP005-T09`: roles composite tenant identity exists — PASS
  - `WP005-T10`: cross-tenant user_roles FK rejected — PASS
  - `WP005-T11`: cross-tenant credential FK rejected — PASS
  - `WP005-T12`: RLS enabled all four tables — PASS
  - `WP005-T13`: FORCE RLS all four tables — PASS
  - `WP005-T14`: no tenant context returns zero rows — PASS
  - `WP005-T15`: Tenant A cannot read Tenant B users — PASS
  - `WP005-T16`: Tenant A cannot read Tenant B roles — PASS
  - `WP005-T17`: Tenant A cannot read Tenant B user_roles — PASS
  - `WP005-T18`: Tenant A cannot read Tenant B credentials — PASS
  - `WP005-T19`: valid signed JWT accepted — PASS
  - `WP005-T20`: invalid signature rejected — PASS
  - `WP005-T21`: expired JWT rejected — PASS
  - `WP005-T22`: future nbf rejected — PASS
  - `WP005-T23`: wrong issuer rejected — PASS
  - `WP005-T24: wrong audience rejected — PASS
  - `WP005-T25`: missing subject rejected — PASS
  - `WP005-T26`: alg-none / algorithm confusion rejected — PASS
  - `WP005-T27`: jwt.sub maps directly to users.id — PASS
  - `WP005-T28`: email-only authentication lookup not used — PASS
  - `WP005-T29`: inactive user rejected — PASS
  - `WP005-T30`: Tenant A JWT + Tenant B requested org rejected — PASS
  - `WP005-T31`: same email in different tenant does not alter identity binding — PASS
  - `WP005-T32`: valid branch role permission allowed — PASS
  - `WP005-T33`: missing permission denied — PASS
  - `WP005-T34`: inactive role denied — PASS
  - `WP005-T35`: wrong branch denied — PASS
  - `WP005-T36`: client-supplied role/permission ignored — PASS
  - `WP005-T37`: Argon2id PIN hash generated — PASS
  - `WP005-T38`: Argon2 parameters match frozen baseline — PASS
  - `WP005-T39`: PIN rotation increments credential_version atomically — PASS
  - `WP005-T40`: revoked credential state persists correctly — PASS
  - `WP005-T41`: plaintext PIN never persisted — PASS
  - `WP005-T42`: connection reuse does not leak tenant context — PASS
  - `WP005-T43`: normal app test role NOBYPASSRLS / NOSUPERUSER — PASS
  - `WP005-T44`: zero-to-latest WP-003 + WP-004 + WP-005 migration — PASS
  - `WP005-T45`: controlled non-production WP-005 down returns to WP-004 state — PASS
  - `WP005-T46`: up → down → up succeeds — PASS
  - `WP005-T47`: WP-003 and WP-004 migration checksums unchanged — PASS

---

## 11. Security Debts & PO Invariants

- **`SEC-VAL-05` (Token Secret Management & Validation):**
  - Status: `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION`
  - Builder does NOT declare this item closed.
- **Product Owner Decisions:**
  - All nine Product Owner questions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain untouched and strictly `PENDING PO DECISION`.
  - WP-005 has zero dependency on pending PO questions.

---

## 12. Local Toolchain Verification

Executed under Node `24.20.0` / npm `11.19.0` / PostgreSQL `16.14`:
- `node --version`: `v24.20.0` — SATISFIED
- `npm --version`: `11.19.0` — SATISFIED
- `npm run graph:check` — SATISFIED
- `npm run format:check` — SATISFIED
- `npm run typecheck` — SATISFIED
- `npm run lint` — SATISFIED
- `npm run build` — SATISFIED
- `npm run test` (All 6 packages, 116 total tests) — SATISFIED

---

## 13. Remote CI Verification & Workflow Runs

- **PR:** [#16](https://github.com/Lucas030509/TRIDENTPOS/pull/16) (`feat(platform): [WP-005] cloud IAM and administrative authentication`)
- **PR State:** OPEN
- **Branch:** `feature/wp-005-cloud-iam-auth`
- **CI Workflow Run ID:** `33928076497`
- **Security Scan Workflow Run ID:** `33928076530`

| Workflow / Context | GitHub Run ID | Status | Conclusion |
|---|---|---|---|
| `build` | `33928076497` | SUCCESS | SATISFIED |
| `lint` | `33928076497` | SUCCESS | SATISFIED |
| `typecheck` | `33928076497` | SUCCESS | SATISFIED |
| `unit-tests` | `33928076497` | SUCCESS | SATISFIED |
| `secret-scan` | `33928076530` | SUCCESS | SATISFIED |
| `sca-scan` | `33928076530` | SUCCESS | SATISFIED |
| `sast-scan` | `33928076530` | SUCCESS | SATISFIED |
| `sbom-generate` | `33928076530` | SUCCESS | SATISFIED |

---

## 14. Builder Conclusion

WP-005 implementation fulfills all frozen requirements, data model constraints, cryptographic baselines, and tenant isolation rules without false greens.

- **Verdict:** `READY FOR ROLE-SEPARATED REVIEW`
- **Builder Status:** `SATISFIED`
- **Blocking Findings:** 0
- **WP-006 Authorization:** NOT YET AUTHORIZED

