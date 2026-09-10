# WP-008 BUILDER EVIDENCE REPORT: EDGE LOCAL DATABASE (SQLITE WAL) & DURABILITY MANAGER

## 1. Executive Metadata

- **Work Package:** `WP-008` — Edge Local Database (SQLite WAL) & Durability Manager
- **Builder Agent:** `16_Native_Edge_Developer`
- **Operating Mode:** `SOLO_MAINTAINER`
- **Implementation Base SHA:** `898d64856c533043068614d04f6dcc55bf351f83`
- **Feature Branch:** `feature/wp-008-edge-sqlite-wal-durability`
- **Governing Architecture Change Request / Baseline:**
  - `ADR/ADR-004-embedded-database-sqlite-durability.md`
  - `DATA_ARCHITECTURE.md` Sec. 3 (Branch Operational Plane Persistence)
  - `IMPLEMENTATION_PLAN.md` (`WP-008`)
- **Governed Toolchain & Pinned Versions:**
  - Host Node.js LTS Toolchain: `24.20.0`
  - Host npm: `11.19.0`
  - Host TypeScript: `~5.4.5` (`skipLibCheck = false`)
  - Pinned Embedded Database Dependency: `better-sqlite3@13.0.3` (exact pin, no `^` or `~`)
  - Pinned Types: `@types/better-sqlite3@9.6.0` (exact pin)
  - Embedded SQLite Engine: `3.53.4`
  - Pinned Host Electron Runtime: `electron@44.3.0`
- **Date:** 2026-09-10
- **Builder Verdict:** `READY FOR ROLE-SEPARATED REVIEW`

---

## 2. Implementation & Architectural Design

### 2.1 File Artifacts Added and Modified

- **New Core Modules:**
  - `packages/edge/src/db/types.ts`: Error hierarchies (`EdgeDatabaseError`, `EdgeIntegrityViolationError`, `EdgeDurabilityError`), durability modes (`NORMAL`, `FULL`), checkpoint modes, WAL alert threshold constant (50 MB), and interfaces.
  - `packages/edge/src/db/write-serializer.ts`: `WriteSerializer` providing FIFO serialized execution for competing write operations to eliminate avoidable `SQLITE_BUSY` errors without hiding errors or infinite retries.
  - `packages/edge/src/db/wal-manager.ts`: `WalCheckpointManager` providing WAL/SHM file size observability, preventative 50 MB alert threshold auditing (ADR-004 Sec. 10), and native SQLite WAL checkpoint dispatching (`PASSIVE`, `FULL`, `RESTART`, `TRUNCATE`).
  - `packages/edge/src/db/edge-database.ts`: `EdgeDatabaseService` connection factory and lifecycle manager with strict WAL activation and readback verification, dual synchronous durability model (`setSyncPragma`, `runInDurabilityMode`, `runCriticalTransaction`), transaction coordination (`runInTransaction`), integrity checks (`verifyIntegrity`, `assertIntegrity`), and cleanup.
  - `packages/edge/src/db/index.ts`: Subsystem exports.
- **New Test Fixtures & Suites:**
  - `packages/edge/src/database.test.ts`: Automated test suite covering `WP008-T01` through `WP008-T15`.
  - `packages/edge/scripts/crash-worker-helper.cjs`: Child worker script for deterministic uncommitted transaction generation and abrupt `SIGKILL` crash simulation.
- **Modified Packaging & Re-Exports:**
  - `packages/edge/package.json`: Added exact dependency `"better-sqlite3": "13.0.3"` and devDependency `"@types/better-sqlite3": "9.6.0"`; updated `test:unit` to include `dist/database.test.js`.
  - `packages/edge/src/index.ts`: Re-exported `db` subsystem (`export * from './db/index.js'`).
  - `package-lock.json`: Added exact lockfile entries for `better-sqlite3@13.0.3` and `@types/better-sqlite3@9.6.0`.

### 2.2 Controlled Local Persistence Path

- Default database filename: `edge_pos.db`.
- Database path resolution:
  - If `options.databasePath` is provided, resolved explicitly.
  - Else if environment variable `TRIDENT_EDGE_DB_PATH` is defined, resolved from environment.
  - Else resolved to `<process.cwd()>/data/edge_pos.db`.
- Automated tests execute strictly in isolated, unique temporary directories created via `os.tmpdir()` (`fs.mkdtempSync`), ensuring zero pollution or mutation of developer or production database files.

### 2.3 SQLite WAL Activation & Baseline Verification

- Connection factory configures:
  - `PRAGMA foreign_keys = ON;`
  - `PRAGMA busy_timeout = 5000;` (configurable, default 5000ms)
  - `PRAGMA journal_mode = WAL;`
- Readback verification: The factory executes `PRAGMA journal_mode` and asserts `effectiveMode.toLowerCase() === 'wal'`. If not active, it fails closed immediately and aborts instantiation.

### 2.4 Dual Synchronous Durability Model

Per ADR-004:
1. **Operational Floor Transactions (Default):**
   - Configured with `PRAGMA synchronous = NORMAL;` (SQLite integer value `1`).
   - Optimized for sub-millisecond local latency on high-frequency restaurant floor and KDS operations.
2. **Financial / Fiscal Critical Transactions:**
   - Supported via `setSyncPragma('FULL')` and `runCriticalTransaction(fn)` / `runInDurabilityMode('FULL', fn)`.
   - Forces fsync barriers (`PRAGMA synchronous = FULL;`, SQLite integer value `2`).
   - Guaranteed restoration: A `finally` block ensures that regardless of whether the critical transaction succeeds or throws an exception, `synchronous` mode is safely restored to `NORMAL`.
   - Rejects any unauthorized durability modes (e.g. `OFF`, `EXTRA`, arbitrary SQL injection).

### 2.5 Write Serialization Strategy

- SQLite is an embedded single-writer database.
- `WriteSerializer` provides an in-process FIFO execution queue.
- Serializes concurrent write operations so that competing promises do not trigger avoidable `SQLITE_BUSY` errors.
- Unhandled errors propagate immediately to the caller without silent swallow or unbounded retry loops.

### 2.6 WAL Checkpoint & Growth Observability

- Preventative observability threshold: **50 MB** (`52,428,800` bytes) per ADR-004 Sec. 10.
- `WalCheckpointManager.getWalStats()` inspects on-disk sizes of `${dbPath}-wal` and `${dbPath}-shm` and flags `isAboveAlertThreshold`.
- `checkpoint(mode)` triggers native SQLite `PRAGMA wal_checkpoint(<mode>)` (`PASSIVE`, `FULL`, `RESTART`, `TRUNCATE`).
- Strict prohibition on manual deletion or alteration of `-wal` / `-shm` files.

### 2.7 Native Integrity Verification

- `verifyIntegrity()` executes `PRAGMA integrity_check;`.
- Returns `{ healthy: true, status: 'ok', details: ['ok'] }` on success.
- `assertIntegrity()` throws `EdgeIntegrityViolationError` fail-closed if corrupted or invalid pages are detected.

---

## 3. Test Evidence Matrix (WP008-T01..T15)

Command executed:
```bash
npm run test --workspace=@trident/edge
```

Output Summary:
- Total unit tests executed: 37 (22 WP-007 + 15 WP-008)
- Actual Electron runtime tests executed: 9 (WP007-E01..E09)
- Total passed: 46
- Total failed: 0
- Total skipped: 0

| Test ID | Test Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **WP008-T01** | WAL activation | `PRAGMA journal_mode` returns `wal` | `wal` verified on native connection | **PASS** |
| **WP008-T02** | Default operational synchronous mode | Effective mode corresponds to `NORMAL` (value `1`) | `NORMAL` (native `1`) verified | **PASS** |
| **WP008-T03** | Critical FULL durability mode | Controlled switch to `FULL` (value `2`); rejection of unauthorized modes | `FULL` (native `2`) verified; unauthorized mode throws `EdgeDurabilityError` | **PASS** |
| **WP008-T04** | Durability mode restoration | Operational mode returns safely to `NORMAL` after successful critical transaction | Mode inside block is `FULL`; restored to `NORMAL` in finally block | **PASS** |
| **WP008-T05** | Durability restoration after exception | Mode returns safely to `NORMAL` after transaction failure; transaction rolls back; DB remains usable | Restored to `NORMAL`; uncommitted entries rolled back; subsequent transaction succeeds | **PASS** |
| **WP008-T06** | Transaction commit | `runInTransaction()` commits all changes atomically | All rows persisted and queryable | **PASS** |
| **WP008-T07** | Transaction rollback | Injected failure causes zero partial transaction persistence | Pre-existing data intact; uncommitted entries absent | **PASS** |
| **WP008-T08** | Concurrent reader during writer | Concurrent reader reads committed snapshot without `SQLITE_BUSY` during uncommitted writer | Reader obtains committed snapshot without error; observes updated snapshot after commit | **PASS** |
| **WP008-T09** | Competing writes | `runSerializedWrite()` maintains sequential order and data integrity | 10 concurrent async writes executed in exact FIFO sequence with 0 errors | **PASS** |
| **WP008-T10** | WAL checkpoint | Generates WAL activity and executes `PASSIVE` and `TRUNCATE` checkpoints | Checkpoints return `busy: 0`, log truncated | **PASS** |
| **WP008-T11** | WAL observability | Observes WAL size on disk and evaluates 50 MB alert threshold | Stats report valid sizes; alert flag triggers when threshold exceeded; default is 50 MB | **PASS** |
| **WP008-T12** | Integrity check | `PRAGMA integrity_check;` returns `ok` for valid database; fails closed on corrupted DB | Valid DB returns `ok`; corrupted header bytes cause `assertIntegrity()` rejection | **PASS** |
| **WP008-T13** | Abrupt process termination recovery | Terminate child process during uncommitted transaction with `SIGKILL`; reopen database | Reopened cleanly; `integrity_check` returns `ok`; committed records valid; incomplete transaction absent | **PASS** |
| **WP008-T14** | Repeated recovery stress | Deterministically survives repeated crash/recovery cycles (5 iterations) | All 5 cycles pass integrity assertions; committed count matches iteration; zero leaked records | **PASS** |
| **WP008-T15** | Existing regression suite | Core Edge package info and pre-existing APIs remain intact | Service lifecycle and metadata verified cleanly; all 22 WP-007 tests pass | **PASS** |

---

## 4. Durability & Recovery Evidence: Software vs. Hardware Distinction

Per WP-008 instructions Section 15 and 16, software crash simulation must never be equated with physical hardware power-loss validation:

```
+-----------------------------------------------------------------------------------------+
|                              DURABILITY VALIDATION STATUS                               |
+-----------------------------------------------------------------------------------------+
| [ VALIDATION LAYER A: SOFTWARE CRASH / PROCESS-KILL RECOVERY ]                          |
| Method: Abrupt SIGKILL of child process during active uncommitted WAL transaction       |
| Cycles: Single crash test (WP008-T13) + 5 repeated stress cycles (WP008-T14)            |
| Verification: Database reopen, PRAGMA integrity_check == ok, atomic rollback of partial  |
|               records, retention of committed records                                    |
| Status: PASSED                                                                          |
+-----------------------------------------------------------------------------------------+
| [ VALIDATION LAYER B: PHYSICAL HARDWARE POWER-LOSS (DAT-04 / RSK-08) ]                  |
| Method: Abrupt electrical power cut on physical POS hardware and consumer SSDs to test   |
|         flush-barrier behavior against volatile SSD write caches                         |
| Requirement: Representative target hardware and lab testbench per WP-028                |
| Status: OPEN / PARTIAL — TARGET HARDWARE EVIDENCE REQUIRED                             |
+-----------------------------------------------------------------------------------------+
```

### 4.1 Debt Disposition

- **`DAT-04` (SQLite Target-Hardware Power-Loss Durability Validation):**
  - **Status:** **`OPEN / PARTIAL`**
  - **Rationale:** Software crash recovery (kill -9) verified; physical power interruption testing on representative SSD target hardware remains open and assigned to `WP-028` / target hardware certification.
- **`RSK-08` (SSD Volatile Cache Loss):**
  - **Status:** **`OPEN / PARTIAL`**
  - **Rationale:** Software controls implemented (dual synchronous mode `NORMAL` / `FULL`); physical validation requires hardware testing under `WP-028`.
- **`SEC-VAL-06` (Tamper-Evident Audit & SQLite Hash Chain):**
  - **Status:** **`OPEN`**
  - **Rationale:** Assigned to `WP-013` / `WP-008` (local audit trail hash-chain verification during Cloud synchronization).

---

## 5. False-Green & Code Smells Audit

An exhaustive search across the entire WP-008 changeset yielded zero bypasses or false-green indicators:

| Search Pattern | Result | Notes |
|---|---|---|
| `test.skip` / `describe.skip` / `it.skip` | **0 occurrences** | None |
| `.only(` / `todo(` | **0 occurrences** | None |
| `@ts-ignore` / `@ts-nocheck` | **0 occurrences** | Strict TypeScript enforced (`skipLibCheck = false`) |
| `continue-on-error` / `allow-failure` | **0 occurrences** | None in CI or test configs |
| `|| true` | **0 occurrences** | None in WP-008 changes |
| Swallowed promise errors (`.catch(() => {})`) | **0 occurrences** | All errors propagate or fail closed |
| Unconditional mocks replacing SQLite engine | **0 occurrences** | Real `better-sqlite3@13.0.3` (SQLite 3.53.4) executed |
| In-memory only databases in durability tests | **0 occurrences** | All durability, WAL, and crash tests use isolated disk files |

---

## 6. Prohibited Scope Audit

The implementation strictly honors the WP-008 boundaries. The following prohibited capabilities were audited and confirmed absent:

- Station enrollment, pairing QR, mDNS discovery (`WP-009`): **ABSENT (0%)**
- Offline PIN authentication, CachedUsers, Argon2 (`WP-010`): **ABSENT (0%)**
- Folio leases, fencing tokens (`WP-011`): **ABSENT (0%)**
- Transactional sync outbox queue (`WP-012`): **ABSENT (0%)**
- Bidirectional Cloud sync engine (`WP-013`): **ABSENT (0%)**
- Restaurant business logic (mesas, cuentas, comandas, KDS, Caja, Corte Z): **ABSENT (0%)**
- Peripheral hardware drivers (ESC/POS printers, cash drawers): **ABSENT (0%)**
- SQLCipher implementation: **ABSENT (0%)**
- Product Owner pending business decisions: **All 9 decisions remain PENDING (100% neutral)**

---

## 7. Supply Chain & Quality Verifications

- **Trivy SCA Scan:** 0 HIGH, 0 CRITICAL vulnerabilities detected.
- **TruffleHog Secret Scan:** 0 verified secrets, 0 unverified secrets across changes.
- **Static Analysis (ESLint):** 0 errors, 0 warnings across all monorepo packages.
- **Strict TypeScript (`tsc --noEmit`):** Clean across all packages (`skipLibCheck = false`).
- **Graph Constraint Check:** Clean (`@trident/edge -> @trident/core`).
- **Prettier Code Formatting:** 100% compliant across all files.

---

## 8. Builder Conclusion & Next Steps

WP-008 implementation is complete, objectively verified by 15 dedicated tests and 31 pre-existing regression tests, and complies with all EAAF v1.2.0 rules.

The feature branch is ready for commit, PR creation, implementation subject freeze, and independent role-separated reviews by `03_Data_Architect` and `11_Code_Reviewer`.
