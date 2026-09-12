# WP-012 S12-R3 Code Review R2

**Reviewer:** 11_Code_Reviewer  
**Date:** 2026-09-12  
**Target Subject (Frozen SHA):** `eb2ab2934c2280e5a275f4666ee2bc684beaa516` (PR #36 HEAD / S12-R3)  
**Status:** REPLACEMENT REVIEW R2 (Fresh inspection directly from S12-R3)  
**Verdict:** **PASS**  
**Blockers:** 0  
**Advisories:** 2 (`CODE-ADV-012-01`, `CODE-ADV-012-02`)

---

## 1. Scope & Review Objectives

This review evaluates the implementation code, database migrations, synchronization contracts, and edge durability layers in frozen subject `eb2ab2934c2280e5a275f4666ee2bc684beaa516` (PR #36 HEAD).

All findings, code references, database schemas, and constraints have been verified against the physical files in the repository:
- `packages/core/src/sync-contracts.ts`
- `packages/core/src/test-support.ts`
- `packages/database/src/outbox/ingested-idempotency-engine.ts`
- `packages/database/src/outbox/cloud-integration-outbox.ts`
- `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`
- `packages/edge/src/db/edge-database.ts`
- `packages/edge/src/db/internal-outbox-adapter.ts`
- `packages/edge/src/db/outbox-persistence.ts`
- `packages/sync/src/sync-ingestion-router.ts`

---

## 2. Quality Verification of S12 Remediation Items (QI-012-01 through QI-012-07)

### 2.1 QI-012-01: Idempotency Identity Collision Safety
- **Implementation File:** `packages/database/src/outbox/ingested-idempotency-engine.ts`
- **Core Contract File:** `packages/core/src/sync-contracts.ts`
- **Code Inspection:**
  - In `packages/core/src/sync-contracts.ts`, `canonicalizeIdempotencyPayload()` produces an unambiguous JSON array over all six tuple components: `[orgId, branchId, aggregateType, aggregateId, action, clientOpId]`.
  - `formatIdempotencyKey()` hashes this canonical array via SHA-256 (`crypto.createHash('sha256')`).
  - In `packages/database/src/outbox/ingested-idempotency-engine.ts` (lines 85–89), concurrent requests for the aggregate stream are serialized using PostgreSQL transaction-scoped advisory locking:
    ```ts
    const lockKey = `${branchId}:${event.aggregateType}:${event.aggregateId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));', [
      orgId,
      lockKey,
    ]);
    ```
    - Key 1: `hashtext(orgId)` (tenant namespace partition).
    - Key 2: `hashtext(${branchId}:${event.aggregateType}:${event.aggregateId})` (aggregate stream).
  - In lines 125–139, upon finding an existing row in `ingested_idempotency_log` matching `(organization_id, idempotency_key)`, the engine performs defense-in-depth verification comparing `existing.branch_id`, `existing.aggregate_type`, `existing.aggregate_id`, `existing.action`, and `existing.client_op_id` against the incoming event. If any component differs, it throws `IDEMPOTENCY_COLLISION`.
- **Advisory Lock Collision Domain Analysis:**
  PostgreSQL's `hashtext()` function returns a signed 32-bit integer (`int4`) for each parameter, providing a composite lock space of $2^{32} \times 2^{32}$. Any 32-bit hash collision across differing aggregate streams causes temporary transaction lock contention (false contention). It **cannot cause duplicate mutation, data corruption, causal sequence corruption, or tenant leakage**, because database primary keys and unique constraints (`uq_idempotency_log_key`, `uq_idempotency_log_client_op`, `uq_ingested_idempotency_tuple`) enforce physical correctness.

### 2.2 QI-012-02: Cloud Receipt Trust Boundary
- **Core Contract:** `packages/core/src/sync-contracts.ts` (`CloudTransactionReceipt`, `CloudReceiptIssuer`, `CloudReceiptVerifier`)
- **Edge Persistence:** `packages/edge/src/db/outbox-persistence.ts` (`EdgeOutboxPersistence`)
- **Database Engine:** `packages/database/src/outbox/ingested-idempotency-engine.ts`
- **Code Inspection:**
  - `EdgeOutboxPersistence.markSynced(id: string, ack: SyncEventAckDTO): boolean` requires:
    1. `ack.status === 'APPLIED' || ack.status === 'DUPLICATE_ACCEPTED'`
    2. `isValidCloudReceipt(ack.receipt)`
    3. `receipt.clientOpId === row.clientOpId && receipt.aggregateSequenceNumber === row.aggregateSequenceNumber`
    4. Configured `this.#verifier` (if `this.#verifier` is null/undefined, returns `false` fail-closed)
    5. `this.#verifier.verifyReceipt(receipt, context)` evaluating strictly to `true`.
  - In `EdgeOutboxPersistence`, the verifier is supplied strictly at construction time; `markSynced(id, ack)` does not accept per-call verifier overrides.
  - In `IngestedIdempotencyEngine` (lines 141–148), upon replaying an existing idempotent event, the engine returns the previously stored receipt payload from database column `receipt_payload` (`existing['receipt_payload']`) verbatim rather than invoking the issuer to generate a new receipt.

### 2.3 QI-012-03: Retry Off-by-One / Exact Initial + 5 Retries
- **Implementation File:** `packages/database/src/outbox/cloud-integration-outbox.ts`
- **Contract File:** `packages/core/src/sync-contracts.ts`
- **Code Inspection:**
  - `CANONICAL_MAX_RETRIES = 5` is exported from `@trident/core`.
  - In `CloudIntegrationOutboxService.enqueue()`, `maxRetries` is enforced to 5.
  - In `handleFailure()`:
    ```ts
    const newDeliveryAttempts = row.deliveryAttempts + 1;
    const newRetryCount = Math.max(0, newDeliveryAttempts - 1);
    const shouldRouteToDlq = isNonRetryable || newDeliveryAttempts > row.maxRetries;
    ```
    Initial delivery failure (attempt 1) leaves `newRetryCount = 0`. Retries 1 through 5 correspond to delivery attempts 2 through 6. When delivery attempt 6 fails (`newDeliveryAttempts > 5`), the event routes to `cloud_integration_dlq`. Exactly 1 initial attempt + 5 retries = 6 delivery attempts before DLQ.

### 2.4 QI-012-04: Cloud Tenant/Branch Composite FK Integrity
- **Migration File:** `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`
- **Code Inspection:**
  - Table `ingested_idempotency_log` declares:
    `CONSTRAINT fk_idempotency_log_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
  - Table `aggregate_sequences` declares:
    `CONSTRAINT fk_aggregate_sequences_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
  - Table `reordering_buffer_queue` declares:
    `CONSTRAINT fk_reordering_buffer_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
  - Table `cloud_integration_outbox` declares:
    `CONSTRAINT fk_cloud_outbox_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
  - Table `cloud_integration_dlq` declares:
    `CONSTRAINT fk_cloud_dlq_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)`
  - Referential integrity is enforced with standard foreign key semantics (no `ON DELETE CASCADE` clauses).

### 2.5 QI-012-05: Dispatcher Claim Ownership / Stale-Worker Safety
- **Implementation File:** `packages/database/src/outbox/cloud-integration-outbox.ts`
- **Code Inspection:**
  - `CloudIntegrationOutboxService.claimBatch()` claims pending rows using an atomic SQL Common Table Expression (CTE) with `FOR UPDATE SKIP LOCKED`, assigning `status = 'PROCESSING'`, `lock_id = $workerId`, and `locked_at = NOW()`.
  - `completeEvent()` enforces Compare-And-Swap (CAS) on `status = 'PROCESSING' AND lock_id = $claimToken`. If zero rows are updated, it throws `ERROR_CODE_STALE_CLAIM`.
  - `handleFailure()` verifies `row.status === 'PROCESSING' && row.lockId === claimToken` under `FOR UPDATE`, and performs CAS update verifying `lock_id = $claimToken`. A stale worker whose claim has expired or been reassigned cannot fail or transition another worker's claim.

### 2.6 QI-012-06: Test-Only Production Leakage / Edge Database Encapsulation
- **Implementation Files:**
  - `packages/edge/src/db/edge-database.ts`
  - `packages/edge/src/db/internal-outbox-adapter.ts`
  - `packages/edge/src/db/test-access.ts`
- **Code Inspection:**
  - `EdgeDatabaseService` in `packages/edge/src/db/edge-database.ts` exposes no public `exec()` or `prepare()` methods.
  - Low-level execution capabilities needed by outbox persistence are provided through `InternalOutboxAdapter` in `packages/edge/src/db/internal-outbox-adapter.ts`, which uses module-private `WeakMap` registries not exported from `@trident/edge` package entrypoints.
  - Test helper registries in `packages/edge/src/db/test-access.ts` are separate and restricted to test harnesses.
  - Production database schema initialization contains no test tables (e.g. `local_fixture_orders`).

### 2.7 QI-012-07: Builder Evidence Factual Integrity
- **Evidence File:** `evidence/WP-012_BUILDER_EVIDENCE.md`
- **Verification:**
  - Builder evidence correctly references `packages/edge/src/db/test-access.ts` as a test utility.
  - Builder evidence accurately describes `TestCloudReceiptIssuer` and `TestCloudReceiptVerifier` as test harnesses in `packages/core/src/test-support.ts`.
  - Builder evidence cites the actual advisory lock `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))` without mentioning non-existent alternative hashing functions.
  - Builder evidence correctly reflects the migration DDL without inventing constraint names.

---

## 3. Database Migration DDL Verification

The actual migration file `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql` defines `ingested_idempotency_log` verbatim as:

```sql
CREATE TABLE ingested_idempotency_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    client_op_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    aggregate_sequence_number BIGINT NOT NULL CHECK (aggregate_sequence_number >= 1),
    status VARCHAR(50) NOT NULL,
    response_payload JSONB NOT NULL,
    receipt_payload JSONB NOT NULL,
    receipt_token VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_idempotency_log_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_idempotency_log_key UNIQUE (organization_id, idempotency_key),
    CONSTRAINT uq_idempotency_log_client_op UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id),
    CONSTRAINT uq_ingested_idempotency_tuple UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, aggregate_sequence_number),
    CONSTRAINT chk_idempotency_log_status CHECK (status IN ('RECEIVED', 'DURABLY_STORED', 'APPLIED', 'DUPLICATE_ACCEPTED', 'REJECTED', 'REQUIRES_RECONCILIATION'))
);
```

### Key DDL Observations:
1. Primary Table Name: `ingested_idempotency_log`.
2. Relevant Columns: `client_op_id`, `action`, `status`, `response_payload`, `receipt_payload`, `receipt_token`.
3. Sequence Positivity Check: Inline unnamed constraint: `CHECK (aggregate_sequence_number >= 1)`.
4. Named Constraints:
   - `fk_idempotency_log_branch`
   - `uq_idempotency_log_key`
   - `uq_idempotency_log_client_op`
   - `uq_ingested_idempotency_tuple`
   - `chk_idempotency_log_status`

---

## 4. Test Suite Execution & Monorepo Test Counts

The monorepo test suite was executed across all workspace packages via `npm test`.

### Verified Test Counts by Package:
- `@trident/core`: **49** passed
- `@trident/database`: **221** passed
- `@trident/edge`: **165** total passed (155 Node unit/integration + 10 Electron runtime)
- `@trident/sync`: **21** passed
- `@trident/pos`: **1** passed
- `@trident/ui`: **1** passed

**Monorepo Total:** **458 passed**, 0 failed, 0 skipped.  
**Governed WP-012 Tests:** **76 PASS**.

---

## 5. Security Governance & Product Owner Items

### 5.1 Preserved Security Debt
- `SEC-VAL-02`: **CLOSED** (verified receipt validation fail-closed in `EdgeOutboxPersistence`).
- `SEC-VAL-04`: **CLOSED** (verified encapsulation of `EdgeDatabaseService` and module-internal adapter isolation).
- `SEC-VAL-03`: **OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED** (preserved for future work packages).
- `SEC-VAL-08`: **OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED** (preserved for future work packages).
- `SEC-VAL-09`: **OPEN / UNTOUCHED** (preserved for future work packages).

### 5.2 Product Owner Decisions
All nine governance items remain strictly **PENDING PO DECISION**:
`OQ-SSOT-01`, `OQ-SSOT-02`, `OQ-SSOT-03`, `OQ-SSOT-04`, `OQ-SSOT-05`, `OQ-SSOT-06`, `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`.

---

## 6. Review Advisories

### CODE-ADV-012-01: Explicit Constraint Naming for Future Migrations
- **Severity:** ADVISORY (Non-blocking)
- **Artifact:** `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`
- **Location:** Line 18
- **Evidence:** `aggregate_sequence_number BIGINT NOT NULL CHECK (aggregate_sequence_number >= 1)` is defined as an inline unnamed CHECK constraint.
- **Runtime Consequence:** Functionally enforced by PostgreSQL with identical semantics, but assigned a system-generated name (e.g. `ingested_idempotency_log_aggregate_sequence_number_check`).
- **Recommendation:** Future DDL migrations should explicitly declare named constraints (such as `CONSTRAINT chk_aggregate_sequence_positive CHECK (...)`) to simplify operational diagnostics and migration rollback scripts.

### CODE-ADV-012-02: Synchronous `markSynced()` vs Async `CloudReceiptVerifier` Interface
- **Severity:** ADVISORY (Non-blocking)
- **Artifact:** `packages/edge/src/db/outbox-persistence.ts`
- **Location:** Lines 254–260
- **Evidence:**
  `CloudReceiptVerifier.verifyReceipt()` contract returns `Promise<boolean> | boolean`. In `EdgeOutboxPersistence.markSynced()`:
  ```ts
  const verificationResult = this.#verifier.verifyReceipt(receipt, context);
  const isVerified = typeof verificationResult === 'boolean' ? verificationResult : false;
  ```
- **Runtime Consequence:** If an asynchronous verifier implementation is supplied, `typeof verificationResult === 'boolean'` evaluates to `false`. The operation fails closed safely (no false-green transitions to `SYNCED`), but an asynchronous verifier cannot authorize the transition through the current synchronous method.
- **Recommendation:** When asynchronous verification (such as WebCrypto or remote KMS) is implemented in future work packages, introduce an asynchronous lifecycle method (e.g. `markSyncedAsync()`). Non-blocking for S12-R3.

---

## 7. Conclusion

The frozen implementation `eb2ab2934c2280e5a275f4666ee2bc684beaa516` strictly satisfies all technical, architectural, and quality invariants. All citations in this review reflect literal, verified code from the repository.

**Final Verdict:** **PASS** (0 Blockers, 2 Advisories)
