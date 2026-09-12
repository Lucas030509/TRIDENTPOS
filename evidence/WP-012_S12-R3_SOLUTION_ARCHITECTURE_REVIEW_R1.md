# WP-012 S12-R3 Solution Architecture Review (R1 Replacement)

**Reviewer:** `01_Solution_Architect`  
**Review Type:** Independent Specialist Solution Architecture Review (Replacement R1)  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Baseline:** `M11 = 40d149ac139d11df7e716a561133069eef238db8`  
**Frozen Review Subject:** `S12-R3 = eb2ab2934c2280e5a275f4666ee2bc684beaa516`  
**Branch:** `review/wp-012-s12-r3-solution-r1`  
**Date:** 2026-09-12  

---

## 1. Executive Summary & Verdict

This independent architectural review replaces the original review sidecar to ensure literal fidelity with candidate `S12-R3` (`eb2ab2934c2280e5a275f4666ee2bc684beaa516`). The review evaluates the implementation against canonical architectural baselines: `IMPLEMENTATION_PLAN.md`, `SYNC_AND_OFFLINE_ARCHITECTURE.md`, `DATA_ARCHITECTURE.md`, `DATA_MODEL.md`, `SECURITY_ARCHITECTURE.md`, `ADR-006` (Transactional Outbox & Ingested Idempotency), and `ADR-007` (Cloud Integration Outbox & Dispatcher).

Source artifacts directly audited:
- `packages/core/src/sync-contracts.ts`
- `packages/core/src/test-support.ts`
- `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`
- `packages/database/src/outbox/cloud-integration-outbox.ts`
- `packages/database/src/outbox/ingested-idempotency-engine.ts`
- `packages/edge/src/db/edge-database.ts`
- `packages/edge/src/db/internal-outbox-adapter.ts`
- `packages/edge/src/db/outbox-persistence.ts`
- All 76 governed WP-012 test cases and monorepo regression suites.

### Overall Verdict: **PASS**
- **Blocking Findings:** 0
- **Advisory Findings:** 1 (`ARCH-ADV-012-01`)

Candidate `S12-R3` satisfies all architectural requirements and principles established in ADR-006 and ADR-007, enforces strict multi-tenant and branch isolation, achieves sound crash durability, guarantees atomic transactions, encapsulates raw database handles, and maintains clean modular-monolith boundaries without out-of-scope leakage.

---

## 2. Comprehensive Architectural Assessment

### 2.1 Multi-Instance Concurrency & Advisory Lock Architecture
In `packages/database/src/outbox/ingested-idempotency-engine.ts` (lines 85-89), concurrency serialization across distributed or multi-worker Cloud ingestion instances is implemented as:

```ts
const lockKey = `${branchId}:${event.aggregateType}:${event.aggregateId}`;
await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));', [
  orgId,
  lockKey,
]);
```

#### Architectural Analysis:
1. **Overload Employed:** PostgreSQL two-key transaction-level advisory lock `pg_advisory_xact_lock(int4, int4)`.
2. **Key Parameters:**
   - Key #1: `hashtext($1)` where `$1 = orgId` (tenant partition).
   - Key #2: `hashtext($2)` where `$2 = `${branchId}:${event.aggregateType}:${event.aggregateId}`` (branch and stream partition).
   - Notice: `branchId` is explicitly incorporated into Key #2, preventing cross-branch collision within the same tenant.
3. **Hashing Mechanism:** `hashtext()` is PostgreSQL's internal 32-bit string hashing algorithm, producing signed 32-bit integers (`int4`). There is NO MD5 digest and NO custom 64-bit integer hashing function in `IngestedIdempotencyEngine`.
4. **Collision Invariant Analysis:**
   In the event of a 32-bit hash collision under `hashtext()` between two distinct aggregate streams belonging to the same organization, the consequence is strictly **benign false contention** (two unrelated streams momentarily serialize their processing).
   A hash collision CANNOT cause:
   - Data corruption, race conditions, or duplicate mutations: The transaction proceeds to acquire an exclusive row-level lock on `aggregate_sequences` (`SELECT ... FOR UPDATE`), and table-level unique constraints (`uq_ingested_idempotency_tuple`, `uq_idempotency_log_key`) guarantee structural consistency.
   - Cross-tenant leakage: Key #1 hashes `orgId`, and Row Level Security (RLS) policies along with composite foreign keys enforce absolute tenant boundaries.
   Therefore, this architecture provides sound, non-blocking serialization.

### 2.2 Transactional Outbox Architecture & Atomicity
- **Edge SQLite WAL (`packages/edge/src/db/outbox-persistence.ts`):**  
  Domain fixture mutations and outbox records commit within a single synchronous SQLite transaction via `EdgeDatabaseService.runInTransaction()` (or `executeWithOutbox()`). Rollback of the domain operation rolls back the outbox record, and outbox validation failures roll back domain state (`WP012-T02`..`T04`, `WP012-R2-T76`).
- **Cloud PostgreSQL Outbox (`packages/database/src/outbox/cloud-integration-outbox.ts`):**  
  Integration events are enqueued into `cloud_integration_outbox` within the caller's authoritative PostgreSQL client transaction (`WP012-T30`..`T31`).

### 2.3 Ingested Idempotency Architecture & Collision Model
- **Canonical Key Derivation (`packages/core/src/sync-contracts.ts`):**  
  `canonicalizeIdempotencyPayload(parts)` serializes `[orgId, branchId, aggregateType, aggregateId, action, clientOpId]` into a strict UTF-8 JSON array string, hashed with SHA-256 via `formatIdempotencyKey()`. This guarantees delimiter collision safety (`WP012-R1-T47`).
- **Defense-in-Depth Verification (`packages/database/src/outbox/ingested-idempotency-engine.ts`):**  
  On idempotency-key match, all 6 components of the persisted log entry are verified against the incoming event. Any mismatch rejects fail-closed with `IDEMPOTENCY_COLLISION` without mutating state (`WP012-R1-T48`).
- **Zero-Mutation Replay with Persisted Receipt:**  
  Exact duplicate requests return `DUPLICATE_ACCEPTED` with the persisted `response_payload` and `receipt_payload` retrieved from PostgreSQL, executing zero second mutations and zero second issuer calls (`WP012-T09`..`T11`, `WP012-R2-T70`, `WP012-R2-T71`).

### 2.4 Aggregate Causal Sequencing & Reordering Buffer
- **Monotonic Causal Sequence (`aggregate_sequences`):**  
  Enforces sequential ordering starting at sequence 1 for greenfield aggregates (`WP012-T15`). Negative or zero sequence numbers are rejected by schema check constraints (`CHECK (aggregate_sequence_number >= 1)`).
- **Gap Buffering & Contiguous Drainage (`reordering_buffer_queue`):**  
  Events with `sequence > expected` are buffered with status `'BUFFERED'` without domain execution (`WP012-T18`..`T20`). Arrival of missing sequences triggers contiguous ordered drainage in ascending sequence number order (`WP012-T21`..`T22`).
- **Safe Integer Boundaries:**  
  Both Edge and Cloud validate `Number.isSafeInteger(seq) && seq >= 1` (`WP012-R1-T63`..`T64`).

### 2.5 Receipt Issuer & Verifier Trust Boundary
- **Production Contracts (`packages/core/src/sync-contracts.ts`):**  
  `CloudReceiptIssuer` and `CloudReceiptVerifier` define clean interfaces for the trust boundary. Cryptographic algorithm implementation and key hierarchies remain behind this provider boundary.
- **Mandatory Issuer Injection:**  
  `IngestedIdempotencyEngine` requires an explicit `CloudReceiptIssuer` constructor argument (`packages/database/src/outbox/ingested-idempotency-engine.ts#L26-L32`). Omission fails closed immediately with `TypeError` (`ERR_INVALID_ARG_TYPE`) (`WP012-R2-T65`).
- **Test Provider Isolation:**  
  `TestCloudReceiptIssuer` and `TestCloudReceiptVerifier` are excluded from the root entrypoint of `@trident/core` and isolated in `@trident/core/test-support` (`WP012-R2-T66`).
- **Edge Fixed Verifier Authority:**  
  `EdgeOutboxPersistence.prototype.markSynced` has signature strictly `markSynced(id, ack)`. Verifier authority is established at construction time. Missing verifier fails closed (`WP012-R2-T68`).

### 2.6 Edge Encapsulation & Test Access Boundary
- **Handle Encapsulation:**  
  Generic `public exec(sql)` and `public prepare(sql)` were removed from `EdgeDatabaseService` (`WP012-R2-T73`, `WP012-R2-T74`).
- **Internal Adapter:**  
  `InternalOutboxAdapter` is stored in a module-scoped `WeakMap<EdgeDatabaseService, InternalOutboxAdapter>` in `packages/edge/src/db/internal-outbox-adapter.ts`, unexported from package entrypoints (`WP012-R2-T75`).
- **Test Access Boundary:**  
  `EdgeOutboxPersistence` and `InternalOutboxAdapter` have zero dependency on `test-access.ts`. The inherited WP-008 module-private test registry in `EdgeDatabaseService` is unexported from the production public API.

### 2.7 Multi-Tenancy, Branch Isolation & RLS
- **Composite Branch Foreign Keys:**  
  Composite foreign keys referencing `branches(organization_id, id)` are enforced across all 5 tables (`ingested_idempotency_log`, `aggregate_sequences`, `reordering_buffer_queue`, `cloud_integration_outbox`, `cloud_integration_dlq`). Organization/branch mismatches are rejected fail-closed (`WP012-T43`, `WP012-R1-T49`).
- **Row Level Security:**  
  RLS is enabled and forced on all five tables, isolating tenants via `current_app_org_id()` (`WP012-T42`).

### 2.8 Dispatcher Claiming, CAS Semantics & Retry Policy
- **Atomic Batch Claim:**  
  `claimBatch` executes a single SQL CTE with `FOR UPDATE SKIP LOCKED`, preventing concurrent claim conflicts (`WP012-T39`, `WP012-R1-T57`).
- **CAS Claim Ownership:**  
  Both `completeEvent` and `handleFailure` enforce `WHERE id = $1 AND status = 'PROCESSING' AND lock_id = $2`. Lost leases fail closed with `STALE_CLAIM` (`WP012-R1-T58`, `WP012-R1-T59`).
- **Canonical Retry Policy:**  
  Frozen to `maxRetries = 5`. Initial failure is recorded as attempt 1, retry_count 0. Failures 1 through 4 remain in retry status. Failure of retry #5 routes to `cloud_integration_dlq` (`WP012-R1-T53`..`T56`).

---

## 3. Findings Register

### 3.1 Blocking Findings
**NONE (0 Blocking Findings).**

---

### 3.2 Advisory Findings

#### `ARCH-ADV-012-01`: Asynchronous Receipt Verifier Interface Alignment in Synchronous Edge Persistence
- **Severity:** `ADVISORY`
- **Artifact:** `packages/core/src/sync-contracts.ts` (lines 144-149) and `packages/edge/src/db/outbox-persistence.ts` (lines 254-260)
- **Location:** `CloudReceiptVerifier.verifyReceipt` return type vs `EdgeOutboxPersistence.markSynced` execution model.
- **Evidence:**
  In `packages/core/src/sync-contracts.ts`:
  ```ts
  export interface CloudReceiptVerifier {
    verifyReceipt(
      receipt: CloudTransactionReceipt,
      expectedContext: ReceiptIssuanceContext,
    ): Promise<boolean> | boolean;
  }
  ```
  In `packages/edge/src/db/outbox-persistence.ts`:
  ```ts
  const verificationResult = this.#verifier.verifyReceipt(receipt, context);
  const isVerified = typeof verificationResult === 'boolean' ? verificationResult : false;
  if (!isVerified) return false;
  ```
- **Architectural Consequence:**
  `CloudReceiptVerifier` defines a production contract supporting `Promise<boolean> | boolean` to accommodate future asynchronous verifiers (e.g. involving remote hardware tokens or async cryptographic key vaults).
  However, `EdgeOutboxPersistence.markSynced` is a synchronous method operating within synchronous SQLite WAL transactions.
  Under S12-R3:
  1. **Safety today:** If an asynchronous verifier returning `Promise<boolean>` were passed, `typeof verificationResult === 'boolean'` evaluates to `false` (`typeof Promise === 'object'`), causing `markSynced` to fail closed safely.
  2. **Interoperability limitation:** A future asynchronous verifier cannot succeed through synchronous `markSynced`.
  3. **Current repository state:** WP-012 defines the contract but deliberately leaves production asymmetric cryptographic verification to subsequent work packages; the only concrete verifier implementation in the repository is `TestCloudReceiptVerifier` in `@trident/core/test-support`, which is synchronous. All 76 tests pass.
- **Remediation Recommendation:**
  When asynchronous cryptographic verification is introduced in subsequent work packages, provide an asynchronous outbox synchronization lifecycle method (e.g. `markSyncedAsync`) or define a synchronous-specific verifier sub-interface (`SyncCloudReceiptVerifier`) for synchronous SQLite persistence boundaries.

---

## 4. Architectural Checklist Summary

| Architecture Dimension | Evaluated Requirement | Result |
|---|---|---|
| **Advisory Locks** | PostgreSQL 2-key `pg_advisory_xact_lock(hashtext(org), hashtext(branch:stream))` | **PASS** |
| **Atomicity** | Edge SQLite domain + outbox transactional consistency | **PASS** |
| **Atomicity** | Cloud PostgreSQL integration outbox transactional consistency | **PASS** |
| **Idempotency** | Collision-safe canonical serialization `[org, branch, aggType, aggId, action, opId]` | **PASS** |
| **Idempotency** | Defense-in-depth 6-tuple verification on duplicate lookup | **PASS** |
| **Idempotency** | Exact duplicate zero-mutation semantics & persisted receipt replay | **PASS** |
| **Sequencing** | Greenfield sequence 1, safe positive integer causal monotonicity | **PASS** |
| **Gap Safety** | Out-of-order buffering and contiguous ascending drainage | **PASS** |
| **Trust Boundary** | Opaque `CloudReceiptIssuer` / `CloudReceiptVerifier` contracts | **PASS** |
| **Trust Boundary** | Mandatory issuer injection in Cloud Ingested Engine | **PASS** |
| **Trust Boundary** | Fixed verifier authority in Edge persistence (no per-call override) | **PASS** |
| **Encapsulation** | Removal of raw SQL `exec`/`prepare` from `EdgeDatabaseService` | **PASS** |
| **Encapsulation** | Module-private `InternalOutboxAdapter` unexported from package | **PASS** |
| **Isolation** | Composite foreign keys `(organization_id, branch_id)` on all 5 tables | **PASS** |
| **Isolation** | Forced Row Level Security across all Cloud outbox tables | **PASS** |
| **Dispatcher** | Single SQL CTE `FOR UPDATE SKIP LOCKED` claim batching | **PASS** |
| **Dispatcher** | CAS lease ownership predicates on completion and failure | **PASS** |
| **Reliability** | Canonical 5-retry limit with exponential backoff and DLQ routing | **PASS** |
| **Durability** | SQLite WAL and PostgreSQL recovery across restarts | **PASS** |
| **Observability** | Alert hook triggering on pending backlog > 100 | **PASS** |
| **Modularity** | Zero circular dependencies, acyclic layer hierarchy | **PASS** |
| **Scope** | Zero WP-013 or WP-014 scope leakage | **PASS** |

---

## 5. Formal Verdict

**VERDICT: PASS**  
**Blocking Findings:** 0  
**Advisory Findings:** 1  

The solution architecture of candidate `S12-R3` is sound, robust, verified, and ready for baseline progression.
