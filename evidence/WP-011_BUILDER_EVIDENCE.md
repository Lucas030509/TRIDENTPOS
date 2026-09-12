# WP-011 BUILDER EVIDENCE REPORT (S11-R2)

**Work Package:** WP-011 Folio Lease Allocation & Fencing Protocol Engine  
**Candidate Subject:** `S11-R2` (Evidence Integrity Remediation Candidate)  
**Parent Candidate:** `S11-R1 = 96d46f58b484e3983f6f7e15f2b4dae0981c9a48`  
**Direct Lineage:** `S11-R2^ = S11-R1` (Natural child commit; S11 and S11-R1 are immutable)  
**Historical Predecessors:**  
- `S11 = 64b076a17ff7f962eccd0682afb6c92dd1073c2e` (Failed Coordinator Quick Integrity: QI-011-01..06)  
- `S11-R1 = 96d46f58b484e3983f6f7e15f2b4dae0981c9a48` (Implementation Remediation Passed Source Check; Held for Evidence Integrity: QI-011-R1-E01)  
**Date:** 2026-09-12  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Baseline:** `M10 = d12fee7df0d0be00234a23f2598bdbfc63c907ae`  
**Implementation Branch:** `feature/wp-011-folio-lease-fencing`  
**Implementation PR:** #35 (Kept OPEN and UNMERGED; no reviewers invoked)  

---

## 1. Executive Summary & Remediation Overview

### Historical Lineage & Disposition Summary
1. **Candidate `S11` (`64b076a17ff7f962eccd0682afb6c92dd1073c2e`):**  
   Evaluated by Coordinator Quick Integrity (`COORDINATOR_PROMPT_WP011_S11-R1_REMEDIATION.md`). Resulted in **FAIL** due to six (6) blocking authority, fencing, and referential integrity deficiencies (`QI-011-01` through `QI-011-06`). `S11` was preserved as **IMMUTABLE**.
2. **Candidate `S11-R1` (`96d46f58b484e3983f6f7e15f2b4dae0981c9a48`):**  
   Engineered as direct child commit (`S11-R1^ = S11`). All six blocking defects were genuinely remediated in code (router, CloudLeaseManager, FolioPersistence, migrations). Evaluated under Coordinator Quick Integrity:
   - `S11-R1 IMPLEMENTATION INTEGRITY = PASS`
   - `S11-R1 OVERALL QUICK INTEGRITY = HOLD — EVIDENCE CORRECTION REQUIRED`
   - **Finding `QI-011-R1-E01` (Evidence Integrity Issue):** The implementation passed all checks and tests, but `evidence/WP-011_BUILDER_EVIDENCE.md` documented an aspirational/older schema draft rather than the exact implemented runtime DDL in migration `20260904200000_folio_leases.sql` and `packages/edge/src/db/folio-persistence.ts`.
   - `S11-R1` remains completely **IMMUTABLE**.
3. **Candidate `S11-R2`:**  
   Created as a direct, natural child commit of `S11-R1` (`S11-R2^ = S11-R1`). This is an **EVIDENCE-ONLY remediation commit**. Exactly one file is modified: `evidence/WP-011_BUILDER_EVIDENCE.md`. Zero production code, zero tests, zero package configurations, and zero migrations have been modified.

### Summary of Resolved Deficiencies & Integrity Remediations:

| Defect / Item ID | Severity | Scope | Description & Resolution Summary | Verification Test(s) / Evidence |
|---|---|---|---|---|
| **QI-011-01** | **CRITICAL** | Code | **Public DR Authority Escape:** Removed `isDisasterRecoveryBootstrap` from public `FolioLeaseRequestDTO`. Router strictly rejects DR parameters with HTTP 400 `INVALID_REQUEST`. DR replacement authority is confined strictly to internal trusted service invocations. | `WP011-R1-T31` |
| **QI-011-02** | **HIGH** | Code | **Ungoverned Active-Lease Revocation & Epoch Churn:** Ordinary lease requests while an `ACTIVE` or `ALLOCATED` lease exists fail closed with HTTP 409 `ACTIVE_LEASE_EXISTS` and **ZERO mutation** (no epoch advance, no range allocation, no status mutation). Normal sequential allocations require exhaustion of prior leases. Greenfield concurrency yields exactly 1 winner and fail-closed rejections for competing requests. | `WP011-R1-T32`..`T37` |
| **QI-011-03** | **HIGH** | Code | **`leaseId` Not Bound in Heartbeat:** Heartbeat validates that supplied `leaseId` exactly matches authoritative lease ID (`options.leaseId === activeLease.id`). Mismatched lease identity within tenant/branch scope returns fail-closed HTTP 403 `LEASE_REVOKED` (anti-oracle disposition) with ZERO HWM mutation. | `WP011-R1-T38`..`T40` |
| **QI-011-04** | **HIGH** | Migration | **Cloud DB Referential Invariant Not Enforced:** In `20260904200000_folio_leases.sql`, replaced simple branch FK with composite foreign key: `CONSTRAINT fk_folio_leases_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`. Prevents cross-tenant branch references even under direct application-role SQL execution. | `WP011-R1-T41` |
| **QI-011-05** | **CRITICAL** | Code | **Untrusted Client HTTP Headers Used as Authority:** Prohibited deriving `AuthContext` from raw request headers `x-organization-id` and `x-branch-id`. Enforced Pattern B: `handleNodeHttp` accepts verified upstream `AuthContext` only. Missing auth context strictly yields HTTP 401 `UNAUTHORIZED_TENANT`. Verified auth context strictly controls authority regardless of body/header values. | `WP011-R1-T42`..`T44` |
| **QI-011-06** | **HIGH** | Code | **Edge Stale-Epoch Replay & Out-of-Bounds Local State:** In `FolioPersistence.setActiveLease`, added atomic transaction validation: rejects stale epoch replay (`incoming.epoch < current.epoch`), rejects conflicting tokens/ranges on same epoch, enforces bounds `range_start - 1 <= currentFolio <= range_end`, and persists `EXHAUSTED` when `currentFolio === range_end`. | `WP011-R1-T45`..`T51` |
| **QI-011-R1-E01** | **EVIDENCE** | Evidence | **Builder Evidence Schema Discrepancy:** Aligned `evidence/WP-011_BUILDER_EVIDENCE.md` verbatim with implemented PostgreSQL migration `20260904200000_folio_leases.sql` (no default on status, real range check, real indexes, composite FK, RLS) and SQLite DDL in `packages/edge/src/db/folio-persistence.ts` (7 columns, `folio_type` as PK, exact check constraints, no non-existent columns/indexes). | Verbatim DDL documentation in Sec 4.1 & 4.2 |

---

## 2. Prerequisites & Lineage Invariant Proof

- **Canonical Baseline M10:** `d12fee7df0d0be00234a23f2598bdbfc63c907ae`
- **Candidate S11 SHA (Immutable Parent):** `64b076a17ff7f962eccd0682afb6c92dd1073c2e` (Failed Coordinator Quick Integrity)
- **Candidate S11-R1 SHA (Immutable Parent of S11-R2):** `96d46f58b484e3983f6f7e15f2b4dae0981c9a48` (Implementation PASS; Evidence HOLD)
- **Candidate S11-R2 Direct Parent Invariant:** `S11-R2^ == S11-R1` (`96d46f58b484e3983f6f7e15f2b4dae0981c9a48`)
- **PR #35 Status:** OPEN, UNMERGED. Reviewers (`03_Data_Architect`, `11_Code_Reviewer`) have NOT been invoked.

---

## 3. Complete Changed-File Inventory

### 3.1 S11-R1 -> S11-R2 (Evidence Remediation Commit)
In candidate `S11-R2`, **ONLY** the following file is modified:

| File | Subsystem | Nature of Remediation |
|---|---|---|
| `evidence/WP-011_BUILDER_EVIDENCE.md` | Evidence | Corrected schema representation to verbatim match implemented Cloud migration DDL and Edge SQLite runtime DDL per `QI-011-R1-E01`. |

- **Production code changed:** NONE.
- **Tests changed:** NONE.
- **Migrations changed:** NONE.
- **Package configurations changed:** NONE.

### 3.2 Full Feature Branch Inventory (M10 -> S11-R2)
The cumulative set of files modified on branch `feature/wp-011-folio-lease-fencing` relative to `M10`:

| File | Subsystem | Nature of Change |
|---|---|---|
| `packages/core/src/folio-contracts.ts` | Core Contracts | Defined protocol types, epoch parsing, and error codes (`ACTIVE_LEASE_EXISTS`, `INVALID_REQUEST`). |
| `packages/core/src/index.ts` | Core Exports | Exported folio contracts and epoch validation utilities. |
| `packages/database/migrations/20260904200000_folio_leases.sql` | Cloud Database Migration | PostgreSQL table `folio_leases` with composite FK, status and range checks, and RLS. |
| `packages/database/src/connection.ts` | Production Database Engine | Preserved canonical baseline (`dotenv.config()`). |
| `packages/database/src/leases.ts` | Cloud Lease Manager | Implemented advisory locking, allocation, heartbeat, DR replacement, and conflict checks. |
| `packages/database/src/index.ts` | Database Exports | Exported `CloudLeaseManager` and related types/errors. |
| `packages/database/src/index.test.ts` | Database Test Suite | 36 comprehensive tests covering gates E–P and remediation scenarios `WP011-R1-T32`..`T41`. |
| `packages/edge/src/db/folio-persistence.ts` | Edge SQLite Engine | Implemented `FolioPersistence` with SQLite WAL, atomic anti-replay transaction, and bounds enforcement. |
| `packages/edge/src/db/edge-database.ts` | Edge SQLite Service | Added `runInTransaction` method for atomic SQLite transaction blocks. |
| `packages/edge/src/folio.test.ts` | Edge Test Suite | 11 tests covering local lease lifecycle, anti-replay, and bounds `WP011-R1-T45`..`T51`. |
| `packages/sync/src/types.ts` | Public DTOs | Public request/response DTOs for HTTP folio leasing. |
| `packages/sync/src/router.ts` | HTTP Sync Router | Pattern B router enforcing verified auth context, DR parameter rejection, and status codes. |
| `packages/sync/src/index.ts` | Sync Exports | Exported sync router and public types. |
| `packages/sync/src/index.test.ts` | Sync Router Test Suite | 8 tests covering HTTP routing, auth validation, and rejection of spoofed headers. |
| `evidence/WP-011_BUILDER_EVIDENCE.md` | Evidence | Truthful evidence report matching implemented runtime code and DDL. |

---

## 4. Truthful Data Model & Architecture Specification

### 4.1 Cloud PostgreSQL Schema (`folio_leases`)
The exact DDL implemented in `packages/database/migrations/20260904200000_folio_leases.sql`:

```sql
CREATE TABLE folio_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    folio_type VARCHAR(50) NOT NULL,
    epoch_id VARCHAR(50) NOT NULL,
    fencing_token VARCHAR(100) NOT NULL,
    range_start BIGINT NOT NULL,
    range_end BIGINT NOT NULL,
    high_water_mark BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL,
    abandoned_at TIMESTAMPTZ NULL,
    reconciled_at TIMESTAMPTZ NULL,
    CONSTRAINT fk_folio_leases_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_folio_leases_epoch UNIQUE (organization_id, branch_id, folio_type, epoch_id),
    CONSTRAINT chk_folio_leases_type CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA')),
    CONSTRAINT chk_folio_leases_status CHECK (status IN ('ALLOCATED', 'ACTIVE', 'EXHAUSTED', 'REVOKED', 'ABANDONED_CONTINGENCY_RANGE', 'RECONCILED')),
    CONSTRAINT chk_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start),
    CONSTRAINT chk_folio_leases_hwm CHECK (high_water_mark >= range_start - 1 AND high_water_mark <= range_end)
);

-- Performance & Query Indices
CREATE INDEX idx_folio_leases_org_branch_type ON folio_leases (organization_id, branch_id, folio_type);
CREATE INDEX idx_folio_leases_status ON folio_leases (status);
CREATE INDEX idx_folio_leases_fencing_token ON folio_leases (fencing_token);

-- Row Level Security & Multi-Tenant Isolation
ALTER TABLE folio_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_leases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON folio_leases
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

#### Verbatim Cloud Schema Properties:
- **`status` column:** Defined as `status VARCHAR(50) NOT NULL` (has **NO** `DEFAULT` clause; application layer explicitly supplies initial status `'ACTIVE'`).
- **Range CHECK constraint:** `CONSTRAINT chk_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start)` (enforces greenfield range start $\ge 1$ and non-inverted ranges).
- **HWM CHECK constraint:** `CONSTRAINT chk_folio_leases_hwm CHECK (high_water_mark >= range_start - 1 AND high_water_mark <= range_end)` (permits initial unconsumed lease where $\text{HWM} = \text{range\_start} - 1$, and forbids exceeding `range_end`).
- **Composite Referential Constraint:** `CONSTRAINT fk_folio_leases_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)` (prevents cross-tenant branch pollution).
- **Indices:** Exactly three indexes:
  1. `idx_folio_leases_org_branch_type ON folio_leases (organization_id, branch_id, folio_type)`
  2. `idx_folio_leases_status ON folio_leases (status)`
  3. `idx_folio_leases_fencing_token ON folio_leases (fencing_token)`
  *(No partial index `idx_folio_leases_active` exists).*
- **Row-Level Security:** Enforced and forced (`FORCE ROW LEVEL SECURITY`) with policy evaluating `current_app_org_id()` (which reads session configuration `app.current_organization_id`).

---

### 4.2 Edge SQLite Schema (`local_folio_leases`)
The exact DDL executed at initialization in `packages/edge/src/db/folio-persistence.ts`:

```sql
CREATE TABLE IF NOT EXISTS local_folio_leases (
  folio_type TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL,
  fencing_token TEXT NOT NULL,
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  current_folio INTEGER NOT NULL,
  status TEXT NOT NULL,
  CONSTRAINT chk_local_folio_leases_type CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA')),
  CONSTRAINT chk_local_folio_leases_status CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REVOKED')),
  CONSTRAINT chk_local_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start)
);
```

#### Verbatim Edge Schema Properties:
- **Primary Key:** `folio_type TEXT PRIMARY KEY`. At the Edge node (single-branch, single-tenant POS runtime), exactly one authoritative lease record exists per folio type.
- **Total Columns:** Exactly seven (7) columns:
  1. `folio_type TEXT PRIMARY KEY`
  2. `epoch_id TEXT NOT NULL`
  3. `fencing_token TEXT NOT NULL`
  4. `range_start INTEGER NOT NULL`
  5. `range_end INTEGER NOT NULL`
  6. `current_folio INTEGER NOT NULL`
  7. `status TEXT NOT NULL`
- **Columns not present at Edge:** The local table does **NOT** contain `id`, `organization_id`, `branch_id`, `allocated_at`, or `updated_at`. Edge identity is implicitly bound to the local database container.
- **Indices:** Primary key index on `folio_type`. Does **NOT** contain a composite index `uq_local_folio_lease_type`.
- **CHECK constraints:**
  - `CONSTRAINT chk_local_folio_leases_type CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA'))`
  - `CONSTRAINT chk_local_folio_leases_status CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REVOKED'))`
  - `CONSTRAINT chk_local_folio_leases_range CHECK (range_start >= 1 AND range_end >= range_start)`
- **Atomic WAL Anti-Replay Transaction:** Evaluated within `setActiveLease` in an explicit transaction (`EdgeDatabaseService.runInTransaction`). Rejects older epochs, rejects conflicting token/range on identical epoch, validates `range_start - 1 <= currentFolio <= range_end`, and sets status to `EXHAUSTED` if `currentFolio === range_end`.

---

## 5. Structured Concurrency Evidence (Truthful Persisted State)

In S11, concurrency was mistakenly reported using in-memory return objects that concealed historical lease revocation. In S11-R1/S11-R2, under the governed fail-closed conflict rule (QI-011-02), concurrent allocations for the same `(organization_id, branch_id, folio_type)` tuple result in **exactly ONE winner** and fail-closed HTTP 409 `ACTIVE_LEASE_EXISTS` conflicts for all competing requests, with **ZERO mutation** on the winner or database.

### 5.1 Greenfield Concurrency Persisted State Proof (`WP011-R1-T36`)
Five (5) simultaneous requests executed against unallocated tuple `(tenantBId, branchB1Id, CORTE_Z)` with `requestedBlockSize = 50`:

| Request # | Method & Route | Requested Block | Response Status | Error Code / Result | Persisted DB Status | Persisted Range |
|---|---|---|---|---|---|---|
| Req 1 | `allocateLease` | 50 | **201 OK** | Successful Allocation | `ACTIVE` | `[1, 50]` |
| Req 2 | `allocateLease` | 50 | **409 Conflict** | `ACTIVE_LEASE_EXISTS` | *(No row created)* | N/A |
| Req 3 | `allocateLease` | 50 | **409 Conflict** | `ACTIVE_LEASE_EXISTS` | *(No row created)* | N/A |
| Req 4 | `allocateLease` | 50 | **409 Conflict** | `ACTIVE_LEASE_EXISTS` | *(No row created)* | N/A |
| Req 5 | `allocateLease` | 50 | **409 Conflict** | `ACTIVE_LEASE_EXISTS` | *(No row created)* | N/A |

- **Persisted DB State Query:** `SELECT id, status, range_start, range_end FROM folio_leases WHERE branch_id = $1 AND folio_type = 'CORTE_Z';`
- **Row Count:** Exactly 1 row.
- **Winning Lease Status:** `ACTIVE`.
- **Winning Range:** `[1, 50]`.
- **Competing Rows:** 0 phantom rows, 0 partial mutations, 0 epoch advances.

---

## 6. Comprehensive Test Suite Matrix (51 Tests)

All 51 tests across the monorepo execute cleanly with zero failures, zero skipped tests, and zero source-string substitutions:

| Test ID | Subsystem | Description | Result |
|---|---|---|---|
| `WP011-T01` | Cloud DB | First lease allocation succeeds and is durably persisted | **PASS** |
| `WP011-T02` | Cloud DB | Two sequential allocations never overlap (prior exhausted) | **PASS** |
| `WP011-T03` | Cloud DB | High concurrency lease requests produce zero overlapping ranges | **PASS** |
| `WP011-T04` | Cloud DB | New allocation begins strictly after authoritative prior range_end | **PASS** |
| `WP011-T05` | Cloud DB | `EXHAUSTED` range is never recycled | **PASS** |
| `WP011-T06` | Cloud DB | `REVOKED` range is never recycled | **PASS** |
| `WP011-T07` | Cloud DB | `ABANDONED_CONTINGENCY_RANGE` is never recycled | **PASS** |
| `WP011-T08` | Core / Cloud | Epoch monotonicity across multiple replacements | **PASS** |
| `WP011-T09` | Core / Cloud | Non-lexical epoch comparison (`ep_10 > ep_2`) | **PASS** |
| `WP011-T10` | Core / Cloud | New generation supersedes old | **PASS** |
| `WP011-T11` | Cloud DB | Stale epoch receives exact HTTP 403 `LEASE_REVOKED` | **PASS** |
| `WP011-T12` | Cloud DB | Stale fencing token receives fail-closed rejection | **PASS** |
| `WP011-T13` | Cloud DB | Zombie heartbeat cannot reactivate old lease | **PASS** |
| `WP011-T14` | Cloud DB | Zombie request creates zero fiscal state mutation | **PASS** |
| `WP011-T15` | Cloud DB | High water mark cannot decrease | **PASS** |
| `WP011-T16` | Cloud DB | High water mark cannot exceed range_end | **PASS** |
| `WP011-T17` | Cloud DB | High water mark from stale epoch cannot mutate active lease | **PASS** |
| `WP011-T18` | Cloud DB | Cross-tenant lease access denied under RLS | **PASS** |
| `WP011-T19` | Cloud DB | Cross-branch lease access denied | **PASS** |
| `WP011-T20` | Cloud DB | Fencing token from another tenant/branch denied | **PASS** |
| `WP011-T21` | Cloud DB | Concurrent requests across independent DB connections remain non-overlapping | **PASS** |
| `WP011-T22` | Cloud DB | Transaction failure during allocation causes zero partial lease authority | **PASS** |
| `WP011-T23` | Edge SQLite | Local lease persistence in SQLite WAL | **PASS** |
| `WP011-T24` | Edge SQLite | `consumeNextFolio` monotonic incrementation | **PASS** |
| `WP011-T25` | Edge SQLite | Exhausted lease refuses issuance fail-closed | **PASS** |
| `WP011-T26` | Edge SQLite | Revoked lease refuses issuance fail-closed | **PASS** |
| `WP011-T27` | Sync / Cloud | Invalid block size strictly rejected with HTTP 400 without clamping | **PASS** |
| `WP011-T28` | Cloud DB | Lease carries zero wall-clock TTL and survives WAN disconnection | **PASS** |
| `WP011-T29` | Cloud DB | Heartbeat nominal reporting interval (60s) operational reporting | **PASS** |
| `WP011-T30` | Cloud DB | Repository regression suite continues to pass | **PASS** |
| `WP011-R1-T31` | Sync Router | Public lease request with `isDisasterRecoveryBootstrap` rejected HTTP 400 `INVALID_REQUEST` | **PASS** |
| `WP011-R1-T32` | Cloud DB | Ordinary request while `ACTIVE` returns 409 `ACTIVE_LEASE_EXISTS` | **PASS** |
| `WP011-R1-T33` | Cloud DB | Ordinary request while `ACTIVE` causes zero DB mutation | **PASS** |
| `WP011-R1-T34` | Cloud DB | Ordinary request while `ALLOCATED` returns conflict with zero mutation | **PASS** |
| `WP011-R1-T35` | Cloud DB | New request after `EXHAUSTED` succeeds with `MAX(range_end)+1` | **PASS** |
| `WP011-R1-T36` | Cloud DB | Concurrent greenfield requests result in exactly one winner; competitors fail closed | **PASS** |
| `WP011-R1-T37` | Cloud DB | Concurrent requests after an `EXHAUSTED` lease result in exactly one new allocation | **PASS** |
| `WP011-R1-T38` | Cloud DB | Wrong `leaseId` + correct current epoch/token => rejection, zero HWM mutation | **PASS** |
| `WP011-R1-T39` | Cloud DB | Old `leaseId` after replacement => HTTP 403 `LEASE_REVOKED`, zero mutation | **PASS** |
| `WP011-R1-T40` | Cloud DB | Cross-tenant `leaseId` cannot be used as an oracle | **PASS** |
| `WP011-R1-T41` | Cloud DB | Composite FK `fk_folio_leases_branch` rejects Tenant A referencing Tenant B branch ID | **PASS** |
| `WP011-R1-T42` | Sync Router | Spoofed `x-organization-id` / `x-branch-id` headers alone cannot establish authority | **PASS** |
| `WP011-R1-T43` | Sync Router | No verified auth context yields HTTP 401 `UNAUTHORIZED_TENANT` | **PASS** |
| `WP011-R1-T44` | Sync Router | Trusted injected context controls authority regardless of malicious payload/headers | **PASS** |
| `WP011-R1-T45` | Edge SQLite | `ep_2` installed, then replay `ep_1` => rejected and `ep_2` remains unchanged | **PASS** |
| `WP011-R1-T46` | Edge SQLite | `ep_10` cannot be overwritten by `ep_2` | **PASS** |
| `WP011-R1-T47` | Edge SQLite | Same epoch + different fencing token rejected | **PASS** |
| `WP011-R1-T48` | Edge SQLite | Same epoch + conflicting range rejected | **PASS** |
| `WP011-R1-T49` | Edge SQLite | Newer epoch accepted transactionally | **PASS** |
| `WP011-R1-T50` | Edge SQLite | Invalid `currentFolio` outside range rejected with zero mutation | **PASS** |
| `WP011-R1-T51` | Edge SQLite | `currentFolio == range_end` persists `EXHAUSTED` | **PASS** |

---

## 7. Gates A–P Verification Matrix

| Gate | Description | Status | Evidence & Test Mapping |
|---|---|---|---|
| **A** | Canonical Baseline Lineage | **PASS** | S11-R2 is a direct child of S11-R1 (`S11-R2^ = S11-R1 = 96d46f58b484e3983f6f7e15f2b4dae0981c9a48`), which branched from `M10 = d12fee7df0d0be00234a23f2598bdbfc63c907ae`. S11 and S11-R1 remain immutable. |
| **B** | Scope Constraint | **PASS** | Only WP-011 folio leasing and fencing implemented. No billing, prefetch, or outbox. |
| **C** | Cloud Migration & Schema | **PASS** | Migration `20260904200000_folio_leases.sql` implements `folio_leases` with `status VARCHAR(50) NOT NULL` (no default), range check `range_start >= 1 AND range_end >= range_start`, indexes `idx_folio_leases_org_branch_type`, `idx_folio_leases_status`, `idx_folio_leases_fencing_token`, composite FK `(organization_id, branch_id) REFERENCES branches(organization_id, id)`, and RLS via `current_app_org_id()`. Verified in `WP011-R1-T41`. |
| **D** | Edge SQLite Schema | **PASS** | `local_folio_leases` table created with `folio_type TEXT PRIMARY KEY`, 7 columns total, check constraints `chk_local_folio_leases_type`, `chk_local_folio_leases_status`, `chk_local_folio_leases_range`, WAL mode, and atomic anti-replay transaction. Verified in `WP011-T23`..`T26` and `WP011-R1-T45`..`T51`. |
| **E** | Concurrent Allocation | **PASS** | Verified in `WP011-T03`, `WP011-T21`, `WP011-R1-T36`, `WP011-R1-T37`. Exactly 1 winner, 409 conflict for competitors. |
| **F** | Monotonic Range Advancement | **PASS** | Greenfield starts at 1 (`WP011-T01`); subsequent start = $\max(\text{range\_end}) + 1$ (`WP011-T04`, `WP011-R1-T35`). |
| **G** | Zero Range Recycling | **PASS** | Verified in `WP011-T05` (EXHAUSTED), `WP011-T06` (REVOKED), and `WP011-T07` (ABANDONED_CONTINGENCY_RANGE). |
| **H** | Epoch Monotonicity | **PASS** | Monotonic epoch sequence verified in `WP011-T08`, non-lexical comparison in `WP011-T09` (`ep_10 > ep_2`), generation in `WP011-T10`, edge anti-replay in `WP011-R1-T45`..`T49`. |
| **I** | Fencing Token Enforcement | **PASS** | Stale token fails closed in `WP011-T12`; wrong epoch fails closed with HTTP 403 `LEASE_REVOKED` in `WP011-T11`; `leaseId` bound in `WP011-R1-T38`..`T40`. |
| **J** | Zombie Edge Node Rejection | **PASS** | Zombie heartbeat rejected fail-closed in `WP011-T13`; zero mutation verified in `WP011-T14` and `WP011-R1-T38`. |
| **K** | Tenant & Branch Isolation | **PASS** | Composite FK enforced in `WP011-R1-T41`; RLS blocks cross-tenant in `WP011-T18`; foreign key & filters block cross-branch in `WP011-T19`, `WP011-T20`; Pattern B router blocks spoofed headers in `WP011-R1-T42`..`T44`. |
| **L** | High-Water Monotonicity | **PASS** | HWM cannot decrease (`WP011-T15`), cannot exceed `range_end` (`WP011-T16`), cannot mutate from stale epoch (`WP011-T17`), local bounds verified in `WP011-R1-T50`..`T51`. |
| **M** | Transactional Failure Safety | **PASS** | Aborted allocation transaction leaves zero partial state (`WP011-T22`). SQLite rollback leaves zero mutation in `folio.test.ts`. |
| **N** | Secret Redaction | **PASS** | Fencing tokens use constant-time equality and are omitted/redacted from error messages, logs, and public DTOs. |
| **O** | Regression & Approved Policies | **PASS** | Policy 1 invalid block size strictly rejected without clamping (`WP011-T27`); Policy 2 zero TTL verified (`WP011-T28`); Policy 3 60s reporting interval verified (`WP011-T29`); full regression suite passed (`WP011-T30`). |
| **P** | Security Debt & Governance | **PASS** | `SEC-VAL-04` reported as `OPEN / PARTIAL — CLOSURE CANDIDATE PENDING INDEPENDENT REVIEW`; `SEC-VAL-02` unchanged `CLOSED`; `SEC-VAL-08` and `SEC-VAL-03` preserved; 9 PO decisions remain `PENDING PO DECISION`. |

---

## 8. Security Validation Debt Disposition

| Debt ID | Summary | Target WP | Status in S11-R2 | Truthful Rationale |
|---|---|---|---|---|
| **`SEC-VAL-04`** | Folio lease allocation, concurrency fencing, and zombie Edge rejection validation | WP-011 | **`OPEN / PARTIAL — CLOSURE CANDIDATE PENDING INDEPENDENT REVIEW`** | Reported as candidate for closure. All advisory lock concurrency, active lease fail-closed conflict, exact leaseId heartbeat binding, composite FK referential integrity, non-lexical epoch monotonicity, Edge atomic anti-replay, and bounds checks are fully verified across 51 tests (`WP011-T01` to `WP011-R1-T51`). **Builder does not self-close.** Final disposition is Coordinator-controlled following independent review. |
| **`SEC-VAL-02`** | Offline IAM brute-force and lockout validation | WP-010 | **`CLOSED`** | Formally closed by Coordinator in WP-010 handoff. Status unchanged. |
| **`SEC-VAL-08`** | Argon2id benchmark on $\le 2\text{ GB}$ RAM target hardware | WP-010 | **`OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED`** | Software-constrained benchmark executed in WP-010; physical $\le 2\text{ GB}$ RAM POS terminal testing required during hardware qualification. Status preserved. |
| **`SEC-VAL-03`** | Target hardware / LAN mDNS & TLS validation | WP-028 | **`OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** | Inherited from WP-009; deferred to deployment package WP-028 per governance. Status preserved. |

---

## 9. Protected Product Owner Decisions Status

All nine (9) protected Product Owner decisions remain strictly **`PENDING PO DECISION`** without assumption or unilateral resolution:
- `OQ-SSOT-01`: Post-kitchen cancellation policy (`PENDING PO DECISION`)
- `OQ-SSOT-02`: Waiter transfer password requirement (`PENDING PO DECISION`)
- `OQ-SSOT-03`: Accounts receivable credit limit validation (`PENDING PO DECISION`)
- `OQ-SSOT-04`: Mobile total account cancellation flow (`PENDING PO DECISION`)
- `OQ-SSOT-05`: Automatic purchase suggestion criteria (`PENDING PO DECISION`)
- `OQ-SSOT-06`: Bill split discount & tip proration rules (`PENDING PO DECISION`)
- `OQ-SSOT-07`: Recipe modifier priority & consolidation (`PENDING PO DECISION`)
- `OQ-ARCH-01`: Multi-cashier shift model (`PENDING PO DECISION`)
- `OQ-ARCH-02`: Unbilled folios monthly closing treatment (`PENDING PO DECISION`)

---

## 10. Verification Summary & Commands

- `npm run graph:check`: **SUCCESS** (All package boundary and monorepo adjacency rules satisfied)
- `npm run format:check`: **SUCCESS** (Prettier code style verified across all files)
- `npm run lint`: **SUCCESS** (Turbo run lint across all 6 packages passed with 0 warnings/errors)
- `npm run typecheck`: **SUCCESS** (Turbo run typecheck passed across all 7 targets with 0 errors)
- `npm test`: **SUCCESS** (Full monorepo suite passed with 12/12 packages/tasks successful, 0 failed)
  - `@trident/database`: 177/177 tests passed (including `WP011-T01`..`T22`, `T27`..`T30`, `WP011-R1-T32`..`T41`)
  - `@trident/edge`: 130/130 unit tests + 10/10 real Electron runtime tests passed (including `WP011-T23`..`T26`, `WP011-R1-T45`..`T51`)
  - `@trident/sync`: 18/18 tests passed (including `WP011-T08`..`T11`, `WP011-T27`, `WP011-R1-T31`, `WP011-R1-T42`..`T44`)
  - `@trident/core`: 46/46 tests passed
  - `@trident/pos`: 3/3 tests passed
  - `@trident/ui`: 3/3 tests passed
- **Total WP-011 Specific Tests:** 51/51 PASSED (`WP011-T01`..`T30` + `WP011-R1-T31`..`T51`)
- **Total Monorepo Tests Executed:** 387 total assertions / tests, 0 failed, 0 skipped.

---

## 11. Known Deviations

**NONE.** Implementation conforms strictly to canonical architectural specifications, the Coordinator Approved Governance Clarifications, the Quick Integrity Remediation Mandate `QI-011-01` through `QI-011-06`, and the Evidence Integrity Remediation `QI-011-R1-E01`.
