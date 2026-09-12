# WP-011 S11-R2 Independent Data Architecture Review Report

**Review Subject (Frozen Candidate):** `S11-R2 = 3a924474d4411f81dbfb08c38fbb230179c2aea5`  
**Parent Candidate Lineage:** `M10` -> `S11` -> `S11-R1` -> `S11-R2`  
**Reviewer:** `03_Data_Architect`  
**Date:** 2026-09-12  
**Framework:** `EAAF v1.2.0`  
**Pinned Framework SHA:** `7e036f43240b3dc28ccb996e350263598275b2cd`  
**Canonical Baseline:** `M10 = d12fee7df0d0be00234a23f2598bdbfc63c907ae`  
**Review Branch:** `review/wp-011-s11-r2-data` (Direct branch from S11-R2)  
**PR:** #35 (OPEN / UNMERGED)  
**Overall Verdict:** **`PASS`**  
**Blocking Findings:** **`0`**  
**Advisory Findings:** **`2`**  

---

## 1. Scope & Frozen Architecture References Inspected

The independent Data Architecture Review evaluated the full data lifecycle, persistence models, transactional concurrency mechanisms, referential integrity constraints, tenant isolation enforcement, and failure safety of WP-011 at frozen commit `3a924474d4411f81dbfb08c38fbb230179c2aea5`.

### Canonical Architecture References Inspected:
1. `IMPLEMENTATION_PLAN.md` (WP-011 scope and constraints)
2. `DATA_ARCHITECTURE.md` (Authority topology, storage segregation, consistency model)
3. `DATA_MODEL.md` (Sec 2.1 `folio_leases`, Sec 3 Edge SQLite schema)
4. `SYNC_AND_OFFLINE_ARCHITECTURE.md` (Sec 1 REM-01 folio leasing and fencing rules)
5. `ADR/ADR-002-cloud-branch-data-authority-by-topology.md` (Cloud authority, Edge consumer)
6. `ADR/ADR-006-outbox-and-idempotent-sync.md` (Idempotency and ordering invariants)
7. `ADR/ADR-008-disaster-recovery-strategy.md` (Contingency ranges, zombie edge node fencing)
8. `evidence/WP-011_BUILDER_EVIDENCE.md` (Canonical candidate evidence report)
9. `COORDINATOR_PROMPT_WP011_GOVERNANCE_CLARIFICATION.md` (Approved Policies 1–5)
10. `COORDINATOR_PROMPT_WP011_S11-R1_REMEDIATION.md` (Mandated Remediations QI-011-01..06)
11. `COORDINATOR_PROMPT_WP011_S11-R2_EVIDENCE_REMEDIATION.md` (Mandated Remediation QI-011-R1-E01)

### Implementation Artifacts Independently Inspected:
- `packages/core/src/folio-contracts.ts`
- `packages/database/migrations/20260904200000_folio_leases.sql`
- `packages/database/src/leases.ts`
- `packages/database/src/index.test.ts`
- `packages/edge/src/db/folio-persistence.ts`
- `packages/edge/src/folio.test.ts`
- `packages/sync/src/router.ts`
- `packages/sync/src/types.ts`

---

## 2. Independent Verification of Core Data Invariants (A–P)

### A. Cloud Authority
- **Finding:** Cloud is verified as the sole authoritative allocator for fiscal folio ranges.
- **Verification:** The Edge runtime has no capability to independently allocate or expand a folio range. Folio persistence in `@trident/edge` is strictly operational (`FolioPersistence.setActiveLease`) and consumes locally assigned numbers up to the authoritative `range_end`. Any new range requires an authenticated Cloud transaction via `CloudLeaseManager.allocateLease`.

### B. Range Non-Overlap & Advisory Concurrency Control
- **Finding:** Concurrent allocations are serialized deterministically using PostgreSQL transactional advisory locks (`pg_advisory_xact_lock`).
- **Verification:**
  - Lock Key: `folio_lease:${options.organizationId}:${options.branchId}:${options.folioType}` hashed with `hashtext()`.
  - Transaction Scope: Lock is acquired within `BEGIN ... COMMIT/ROLLBACK` block and automatically freed upon transaction termination.
  - Concurrency Safety: Tested under multi-connection concurrent access (`WP011-T03`, `WP011-T21`, `WP011-R1-T36`, `WP011-R1-T37`). Zero overlapping ranges occur across simultaneous parallel allocation requests.

### C. Active Lease Exclusivity & Conflict Semantics
- **Finding:** Ordinary lease requests while an `ACTIVE` or `ALLOCATED` lease exists fail closed with HTTP 409 `ACTIVE_LEASE_EXISTS` and **zero mutation**.
- **Verification:** In `CloudLeaseManager.allocateLease`, `historicalRes.rows.find(row => row.status === 'ACTIVE' || row.status === 'ALLOCATED')` strictly detects active authority. If `options.isDisasterRecoveryReplacement` is falsy, it throws `ActiveLeaseExistsError`. No new rows, epoch increments, range modifications, or status mutations occur.

### D. Exhaustion Successor Monotonicity
- **Finding:** Successor leases allocated after numeric exhaustion begin strictly at `MAX(historical range_end) + 1`.
- **Verification:** When prior leases are `EXHAUSTED`, `CloudLeaseManager` loops through all historical records, extracts the absolute maximum `range_end`, and sets `rangeStart = maxRangeEnd + 1`. Historic numbers are never re-used or shifted.

### E. Zero Range Recycling Across Terminal States
- **Finding:** Range recycling is completely prevented across all terminal lease statuses: `ALLOCATED`, `ACTIVE`, `EXHAUSTED`, `REVOKED`, `ABANDONED_CONTINGENCY_RANGE`, `RECONCILED`.
- **Verification:** The historical selection query does not filter out revoked or abandoned leases:
  ```sql
  SELECT id, range_end, epoch_id, status
  FROM folio_leases
  WHERE organization_id = $1 AND branch_id = $2 AND folio_type = $3
  ORDER BY range_end DESC;
  ```
  Even unconsumed tails of abandoned contingency ranges remain permanently unallocated in the historical record, ensuring zero numeric overlap.

### F. Greenfield Initialization
- **Finding:** The first lease allocation for an unallocated `(organization_id, branch_id, folio_type)` tuple begins at 1 (`GREENFIELD_INITIAL_RANGE_START`).
- **Verification:** Greenfield detection evaluates `if (historicalRes.rows.length === 0)` and initializes `rangeStart = 1`, `nextEpoch = 'ep_1'`. No arbitrary non-governed migration seeding mechanism exists.

### G. Epoch Monotonicity
- **Finding:** Epoch numbering strictly follows non-lexical integer monotonicity (`ep_1` -> `ep_2` -> ... -> `ep_10`).
- **Verification:** Monotonicity is verified in `compareEpochs` which parses `ep_(\d+)` and compares numerical values. Epoch 10 evaluates strictly greater than Epoch 2 (`ep_10 > ep_2`). Generation of next epoch uses `maxEpochNumber + 1`.

### H. Database Schema Integrity & Constraints
- **Finding:** Cloud migration `20260904200000_folio_leases.sql` implements rigorous referential and domain constraints:
  - Composite Foreign Key: `CONSTRAINT fk_folio_leases_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`. Prevents cross-tenant branch reference.
  - Unique Epoch: `CONSTRAINT uq_folio_leases_epoch UNIQUE (organization_id, branch_id, folio_type, epoch_id)`.
  - Check Type: `CHECK (folio_type IN ('TICKET', 'CORTE_X', 'CORTE_Z', 'FACTURA'))`.
  - Check Status: `CHECK (status IN ('ALLOCATED', 'ACTIVE', 'EXHAUSTED', 'REVOKED', 'ABANDONED_CONTINGENCY_RANGE', 'RECONCILED'))`.
  - Check Range: `CHECK (range_start >= 1 AND range_end >= range_start)`.
  - Check HWM: `CHECK (high_water_mark >= range_start - 1 AND high_water_mark <= range_end)`.
  - Row Level Security: `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

### I. Multi-Tenant Isolation & RLS
- **Finding:** Multi-tenancy is enforced at the database engine level via `tenant_isolation_policy` evaluating `current_app_org_id()` (`app.current_organization_id`).
- **Verification:** Direct SQL queries without a valid tenant context return 0 rows. Injected tenant context strictly confines queries to the caller's organization. Cross-tenant branch references fail composite foreign key enforcement.

### J. Heartbeat Authentication & Fencing
- **Finding:** Heartbeat requests strictly validate tenant, branch, folio_type, `leaseId`, `epoch_id`, and `fencing_token` before updating high water mark.
- **Verification:** Stale epoch or mismatched `leaseId` fails closed with HTTP 403 `LEASE_REVOKED` and causes zero mutation on Cloud state. Fencing token verification utilizes `crypto.timingSafeEqual`.

### K. High Water Mark Monotonicity
- **Finding:** High water mark cannot regress or exceed `range_end`.
- **Verification:** Heartbeat checks `if (options.currentFolio < currentDbHwm) throw new HighWaterRegressionError(...)`. The database CHECK constraint `high_water_mark >= range_start - 1 AND high_water_mark <= range_end` guarantees engine-level enforcement.

### L. Disaster Recovery Replacement Boundaries
- **Finding:** Public clients cannot request disaster recovery replacements.
- **Verification:** Public `FolioLeaseRequestDTO` strictly excludes DR parameters. The HTTP router (`packages/sync/src/router.ts`) rejects any incoming DR properties with HTTP 400 `INVALID_REQUEST`. Internal trusted calls setting `isDisasterRecoveryReplacement: true` mark the active lease as `ABANDONED_CONTINGENCY_RANGE` and allocate a successor strictly starting at `MAX(range_end) + 1`.

### M. Edge Persistence Data Integrity
- **Finding:** Local SQLite storage in `@trident/edge` matches the single-node POS operational model.
- **Verification:**
  - Table `local_folio_leases` uses `folio_type TEXT PRIMARY KEY`. Exactly one authoritative lease per folio type can exist on the Edge node.
  - Exactly 7 columns: `folio_type`, `epoch_id`, `fencing_token`, `range_start`, `range_end`, `current_folio`, `status`.
  - Atomic anti-replay transaction in `FolioPersistence.setActiveLease` prevents stale epoch replay (`incoming.epoch < current.epoch`), rejects conflicting tokens/ranges on the same epoch, and enforces `range_start - 1 <= currentFolio <= range_end`.

### N. Crash & Failure Safety
- **Finding:** Both Cloud and Edge persistence exhibit transactional atomicity under failure.
- **Verification:** In `CloudLeaseManager`, all mutations occur inside explicit `BEGIN ... COMMIT` blocks; any error invokes `ROLLBACK`, leaving zero partial state (`WP011-T22`). On Edge, SQLite WAL transactions in `FolioPersistence` guarantee rollback on failure.

### O. Migration Safety
- **Finding:** Migration `20260904200000_folio_leases.sql` is a clean additive migration on top of baseline `M10`. No prior migrations were retroactively modified.

### P. Builder Evidence Alignment
- **Finding:** The updated `evidence/WP-011_BUILDER_EVIDENCE.md` at commit `S11-R2` accurately reflects the exact implemented DDL and runtime behaviors. The prior discrepancy (`QI-011-R1-E01`) is completely resolved.

---

## 3. Adversarial Analysis

### 3.1 Advisory Lock 32-bit Hash Space Contention
`pg_advisory_xact_lock(hashtext(lockKey))` maps the compound lock string to a signed 32-bit integer (`int4`). In an adversarial scenario with extreme tenant/branch counts ($> 10^5$), hash collisions are mathematically possible.
- **Data Integrity Assessment:** A hash collision in `pg_advisory_xact_lock` causes mutual exclusion between two un-related tenant/branch/folio tuples (false contention), but **never** allows concurrent execution of the same tuple. It is fail-safe with respect to data integrity.
- **Recommendation:** Documented as Advisory Finding `ADV-DATA-01`. For long-term scale beyond tens of thousands of branches, 64-bit advisory locks `pg_advisory_xact_lock(bigint)` can be considered.

### 3.2 JavaScript `Number.MAX_SAFE_INTEGER` vs PostgreSQL `BIGINT`
PostgreSQL `BIGINT` supports up to $9.22 \times 10^{18}$. In Node.js, `Number.MAX_SAFE_INTEGER` is $9,007,199,254,740,991$ ($2^{53} - 1$). The `pg` driver returns `BIGINT` as strings, which `leases.ts` converts using `Number(row.range_end)`.
- **Data Integrity Assessment:** Monotonic folio progression starting at 1 with maximum block sizes of 1,000 cannot realistically approach $9 \times 10^{15}$ under any conceivable operational POS workload (it would require billions of transactions per day for thousands of years). However, if an administrative or legacy system were manually injected with a folio range above $2^{53}$, precision loss could occur.
- **Recommendation:** Documented as Advisory Finding `ADV-DATA-02`. An explicit check `if (maxRangeEnd > Number.MAX_SAFE_INTEGER) throw ...` or native `BigInt` handling can be added in future hardening packages.

---

## 4. Findings Summary

| Finding ID | Severity | Subsystem | Description | Status |
|---|---|---|---|---|
| **ADV-DATA-01** | **ADVISORY** | Cloud DB | `hashtext()` 32-bit advisory lock key space presents theoretical false contention under massive branch counts; completely safe for data integrity. | Documented |
| **ADV-DATA-02** | **ADVISORY** | Core / Cloud | `Number(range_end)` conversion assumes values below `Number.MAX_SAFE_INTEGER` ($9 \times 10^{15}$); safe for all operational POS workloads. | Documented |

- **Total Blocking Findings:** **`0`**
- **Total Advisory Findings:** **`2`**

---

## 5. Security Validation Debt & Protected Governance Disposition

- **`SEC-VAL-04` (Folio lease allocation, concurrency fencing, and zombie Edge rejection):**  
  **`RECOMMEND CLOSURE PENDING COORDINATOR FINAL DISPOSITION`**.  
  Independent Data Architecture review confirms that all advisory lock concurrency controls, active lease fail-closed semantics, heartbeat fencing token validation, composite foreign key referential integrity, non-lexical epoch monotonicity, and Edge SQLite WAL anti-replay mechanisms are fully implemented and verified across 51 passing automated tests. The reviewer does not self-close; final closure is reserved for the Coordinator.
- **`SEC-VAL-02` (Offline IAM brute-force lockout):**  
  Unchanged: **`CLOSED`** (Formally closed in WP-010).
- **`SEC-VAL-08` (Argon2id benchmark on $\le 2\text{ GB}$ RAM hardware):**  
  Unchanged: **`OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED`**.
- **`SEC-VAL-03` (Target hardware / LAN mDNS & TLS validation):**  
  Unchanged: **`OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`**.
- **Protected Product Owner Decisions (OQ-SSOT-01..07, OQ-ARCH-01..02):**  
  All nine decisions remain strictly **`PENDING PO DECISION`** without unilateral assumption or modification.

---

## 6. Final Data Architecture Verdict

**Verdict:** **`PASS`**  
Candidate `S11-R2` (`3a924474d4411f81dbfb08c38fbb230179c2aea5`) satisfies all data authority, referential integrity, persistence, and concurrency requirements of EAAF v1.2.0 WP-011 with 0 blockers.
