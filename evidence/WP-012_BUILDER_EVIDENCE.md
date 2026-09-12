# WP-012 BUILDER EVIDENCE REPORT (S12-R3)

**Work Package:** WP-012 Transactional Outbox & Ingested Idempotency Engine  
**Candidate Subject:** `S12-R3` (Evidence-Only Integrity Corrected Candidate)  
**Parent Candidate:** `S12-R2 = e018bf129fe8ceddc13fe0403c23c800f46c05cd` (Immutable)  
**Preceding Candidates:** `S12-R1 = 49cb9660d01f944834df0974b815352cf1d6085c` (Immutable), `S12 = 3d88bc18d6eea8ce75d47ab0e3b9c8c79f20d0d8` (Immutable)  
**Parent Baseline:** `M11 = 40d149ac139d11df7e716a561133069eef238db8`  
**Direct Lineage:** `S12-R3^ = e018bf129fe8ceddc13fe0403c23c800f46c05cd` (`S12-R2`)  
**Date:** 2026-09-12  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Implementation Branch:** `feature/wp-012-transactional-outbox-idempotency`  
**Implementation PR:** `#36` (OPEN and UNMERGED — No reviewers invoked)  

---

## 1. Executive Summary & Remediation Overview

Candidate `S12-R2` successfully resolved all six code-level quick integrity issues (`QI-012-01` through `QI-012-06`), receiving **PASS** from the Coordinator. The Coordinator placed `QI-012-07` on **HOLD** solely because the Builder Evidence document contained approximations and wording imprecisions rather than matching literal `S12-R2` runtime artifacts.

Under EAAF governance, `S12-R2` is strictly immutable. Candidate `S12-R3` was created as an exact direct child of `S12-R2` as an **EVIDENCE-ONLY** correction. Zero code, test, migration, or configuration files were modified.

The corrections in `S12-R3` resolve `QI-012-07` completely:

1. **Literal Cloud PostgreSQL DDL:**
   Replaced manually reconstructed schema snippets with the literal SQL from `packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`, preserving actual table names, column orders, check constraint values (`'RECEIVED', 'DURABLY_STORED', 'APPLIED', 'DUPLICATE_ACCEPTED', 'REJECTED', 'REQUIRES_RECONCILIATION'`), and actual constraint identifiers (`fk_idempotency_log_branch`, `uq_idempotency_log_key`, `uq_idempotency_log_client_op`, `uq_ingested_idempotency_tuple`, `chk_idempotency_log_status`).
2. **Literal Edge SQLite Schema:**
   Recorded the literal DDL from `packages/edge/src/db/outbox-persistence.ts`, including `id TEXT PRIMARY KEY`, `aggregate_sequence_number INTEGER NOT NULL CHECK (aggregate_sequence_number >= 1)`, `status TEXT NOT NULL DEFAULT 'PENDING'`, and `CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'SYNCED', 'FAILED'))`.
3. **Truthful Test-Access Boundary Disposition:**
   Removed inaccurate blanket statements. Accurately documented that:
   - `EdgeOutboxPersistence` has zero dependency on `test-access.ts`.
   - The WP-012 `InternalOutboxAdapter` has zero dependency on `test-access.ts`.
   - `EdgeDatabaseService` retains the inherited WP-008 module-private test registry integration (`registerTestNativeDatabase`).
   - The test registry is unexported from the production public API, and normal production consumers cannot obtain native SQLite handles.
   - `WP012-R2-T73`, `T74`, and `T75` verify that `exec`, `prepare`, and `InternalOutboxAdapter` do not leak through the `@trident/edge` public API.
4. **Accurate Test Provider Export Disposition:**
   Correctly stated that `CloudReceiptIssuer` and `CloudReceiptVerifier` are production contracts exported from `@trident/core`, while `TestCloudReceiptIssuer` and `TestCloudReceiptVerifier` are **excluded from the normal production root entrypoint and isolated in the explicit test-support subpath (`@trident/core/test-support`)**.
5. **Exact Receipt Persistence & Replay Disposition:**
   Documented that `IngestedIdempotencyEngine` requires an explicit `CloudReceiptIssuer` via constructor; no default exists. On initial `APPLIED`, `response_payload`, `receipt_payload`, and `receipt_token` are persisted. On exact duplicate replay, the persisted `receipt_payload` is loaded from PostgreSQL and returned verbatim; the issuer is NOT invoked a second time (invocation count = 1).
6. **Exact `markSynced` Signature & Verifier Disposition:**
   Documented that `markSynced(id, ack)` arity is strictly 2. No per-call verifier override exists. Verifier authority is established at `EdgeOutboxPersistence` construction time. Missing verifier fails closed. Invalid or forged receipt fails closed.
7. **Exact CI Test Metrics:**
   Truthfully recorded exact package test counts from CI Run `34714390260`: Total 458 passed, 0 failed, 0 skipped.

---

## 2. Lineage Invariant Proof

- **Canonical Baseline M11:** `40d149ac139d11df7e716a561133069eef238db8`
- **Candidate S12 (Immutable):** `3d88bc18d6eea8ce75d47ab0e3b9c8c79f20d0d8`
- **Candidate S12-R1 (Immutable):** `49cb9660d01f944834df0974b815352cf1d6085c`
- **Candidate S12-R2 (Immutable):** `e018bf129fe8ceddc13fe0403c23c800f46c05cd`
- **Current Candidate S12-R3:** Direct child commit of `S12-R2` on `feature/wp-012-transactional-outbox-idempotency`
- **Parent Invariant Proof:** `git rev-parse S12-R3^` = `e018bf129fe8ceddc13fe0403c23c800f46c05cd` (`S12-R2`)
- **PR #36:** Maintained OPEN and UNMERGED; HEAD advanced to `S12-R3`. Zero reviewer invocations.

---

## 3. Changed Files Inventory (`S12-R2..S12-R3`)

| File | Subsystem | Nature of Change |
|---|---|---|
| `evidence/WP-012_BUILDER_EVIDENCE.md` | Evidence | [EVIDENCE-ONLY] Corrected literal DDL schemas, test-access boundary description, test-support subpath wording, receipt replay description, and test counts. |

**Total changed files in `S12-R2..S12-R3`:** Exactly 1 (`evidence/WP-012_BUILDER_EVIDENCE.md`).  
**Git compare `S12-R2..S12-R3`:** `ahead_by = 1`, `behind_by = 0`. Zero code, test, or configuration changes.

---

## 4. Truthful Data Model & Runtime Specification

### 4.1 Cloud PostgreSQL Schema (`packages/database/migrations/20260904210000_transactional_outbox_idempotency.sql`)

The following definitions are taken verbatim from the active migration file:

```sql
-- 1. Ingested Idempotency Log
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

CREATE INDEX idx_idempotency_log_lookup ON ingested_idempotency_log (organization_id, branch_id, aggregate_type, aggregate_id);
CREATE INDEX idx_idempotency_log_created_at ON ingested_idempotency_log (created_at);

ALTER TABLE ingested_idempotency_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_idempotency_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON ingested_idempotency_log
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Aggregate Sequences (Per-stream causal monotonicity tracking)
CREATE TABLE aggregate_sequences (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    current_sequence_number BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_aggregate_sequences PRIMARY KEY (organization_id, branch_id, aggregate_type, aggregate_id),
    CONSTRAINT fk_aggregate_sequences_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT chk_aggregate_sequences_positive CHECK (current_sequence_number >= 0)
);

ALTER TABLE aggregate_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON aggregate_sequences
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Reordering Buffer Queue (Sequence gap buffering)
CREATE TABLE reordering_buffer_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    aggregate_sequence_number BIGINT NOT NULL CHECK (aggregate_sequence_number >= 1),
    action VARCHAR(100) NOT NULL,
    client_op_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'BUFFERED',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drained_at TIMESTAMPTZ NULL,
    CONSTRAINT fk_reordering_buffer_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_reordering_buffer_seq UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, aggregate_sequence_number),
    CONSTRAINT uq_reordering_buffer_key UNIQUE (organization_id, idempotency_key),
    CONSTRAINT chk_reordering_buffer_status CHECK (status IN ('BUFFERED', 'DRAINED'))
);

CREATE INDEX idx_reordering_buffer_stream ON reordering_buffer_queue (organization_id, branch_id, aggregate_type, aggregate_id, aggregate_sequence_number);
CREATE INDEX idx_reordering_buffer_status ON reordering_buffer_queue (status);

ALTER TABLE reordering_buffer_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reordering_buffer_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON reordering_buffer_queue
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Cloud Integration Outbox (ADR-007)
CREATE TABLE cloud_integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    delivery_attempts INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NULL,
    lock_id VARCHAR(100) NULL,
    locked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL,
    CONSTRAINT fk_cloud_outbox_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT chk_cloud_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DLQ')),
    CONSTRAINT chk_cloud_outbox_retry_count CHECK (retry_count >= 0 AND retry_count <= 5),
    CONSTRAINT chk_cloud_outbox_delivery_attempts CHECK (delivery_attempts >= 0),
    CONSTRAINT chk_cloud_outbox_max_retries CHECK (max_retries = 5)
);

CREATE INDEX idx_cloud_outbox_pending ON cloud_integration_outbox (status, next_retry_at) WHERE status IN ('PENDING', 'PROCESSING');
CREATE INDEX idx_cloud_outbox_org ON cloud_integration_outbox (organization_id);

ALTER TABLE cloud_integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_integration_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cloud_integration_outbox
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 5. Cloud Integration DLQ (Dead Letter Queue)
CREATE TABLE cloud_integration_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NULL,
    originating_outbox_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    raw_payload JSONB NOT NULL,
    error_code VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    error_trace TEXT NULL,
    retry_count INT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    moved_to_dlq_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_cloud_dlq_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

CREATE INDEX idx_cloud_dlq_org ON cloud_integration_dlq (organization_id);
CREATE INDEX idx_cloud_dlq_created ON cloud_integration_dlq (moved_to_dlq_at);

ALTER TABLE cloud_integration_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_integration_dlq FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cloud_integration_dlq
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());
```

Notice: Production Cloud migration contains zero `wp012_test_*` tables. Test domain fixture tables are created and dropped exclusively within test lifecycles.

### 4.2 Edge SQLite WAL Schema (`packages/edge/src/db/outbox-persistence.ts`)

The following schema is created by `EdgeOutboxPersistence.#initializeSchema()` verbatim:

```sql
CREATE TABLE IF NOT EXISTS outbox_queue (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  client_op_id TEXT NOT NULL UNIQUE,
  aggregate_sequence_number INTEGER NOT NULL CHECK (aggregate_sequence_number >= 1),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  receipt_token TEXT,
  receipt_verified_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced_at TEXT,
  last_error TEXT,
  CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'SYNCED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_queue_status ON outbox_queue (status);
CREATE INDEX IF NOT EXISTS idx_outbox_queue_stream ON outbox_queue (aggregate_type, aggregate_id, aggregate_sequence_number);
```

Notice: Production Edge initialization creates zero `local_fixture_orders` tables.

---

## 5. Architectural Mechanism & Contract Documentation

### 5.1 Collision-Safe Idempotency Key Derivation & Defense-in-Depth
- **Canonical Serialization:** `canonicalizeIdempotencyPayload(parts)` serializes the logical tuple as a strict JSON array of UTF-8 strings in exact order: `[orgId, branchId, aggregateType, aggregateId, action, clientOpId]`.
- **Hashing:** `formatIdempotencyKey` computes a 64-character lowercase hex SHA-256 hash over this canonical JSON array string.
- **Defense-in-Depth Comparison:** When an incoming request matches a persisted `idempotency_key`, the Cloud Ingested Idempotency Engine compares all 6 components of the persisted row against the incoming event. If any component differs, it fails closed with `IDEMPOTENCY_COLLISION` and executes zero mutation.

### 5.2 Opaque Trust Provider Boundary & Verifiable Replay
- **Production Contracts:**
  - `CloudReceiptIssuer`: `issueReceipt(context: ReceiptIssuanceContext): CloudTransactionReceipt`
  - `CloudReceiptVerifier`: `verifyReceipt(receipt: CloudTransactionReceipt, expectedContext: ReceiptIssuanceContext): boolean`
  Both interfaces are production contracts exported from `@trident/core`.
- **Test Provider Isolation:**
  - `TestCloudReceiptIssuer` and `TestCloudReceiptVerifier` are **excluded from the normal production root entrypoint of `@trident/core`**.
  - They are available exclusively through the explicit test-support subpath export: `@trident/core/test-support`.
  - This boundary remains eligible for independent Solution Architecture review.
- **Mandatory Issuer Injection in Cloud Engine:**
  - `IngestedIdempotencyEngine` strictly requires an explicit `CloudReceiptIssuer` instance injected via constructor (`constructor(issuer: CloudReceiptIssuer)`).
  - No default `TestCloudReceiptIssuer` fallback exists.
  - Omission or invalid argument fails closed immediately with `TypeError` (`ERR_INVALID_ARG_TYPE`).
- **Persisted Receipt Replay on Duplicates:**
  - On initial `APPLIED` processing, the engine persists `response_payload`, `receipt_payload` (JSONB), and `receipt_token`.
  - On exact duplicate replay, the persisted logical tuple is verified, persisted `response_payload` is returned, and persisted `receipt_payload` is returned verbatim without invoking the issuer a second time (call count = 1).
  - WP-012 does NOT claim cryptographic algorithm or key management is completed; that remains behind the opaque provider boundary.
- **Edge Verifier Composition & Fixed Authority:**
  - `EdgeOutboxPersistence.prototype.markSynced` has signature strictly `markSynced(id, ack)`. Arity is 2; zero per-call verifier override exists.
  - Verifier authority is established exclusively at `EdgeOutboxPersistence` construction time via options (`new EdgeOutboxPersistence(db, { verifier })`).
  - Missing verifier: FAIL CLOSED.
  - Invalid or forged receipt: FAIL CLOSED.
  - Only `APPLIED` or `DUPLICATE_ACCEPTED` with a successfully verified matching receipt may transition the local event to `SYNCED`.

### 5.3 Edge Database Encapsulation & Test Registry Disposition
- **Encapsulation of Raw SQLite Handle:**
  - Generic `public exec(sql)` and `public prepare(sql)` were completely removed from `EdgeDatabaseService`.
  - An internal adapter (`InternalOutboxAdapter`) bound via module-scoped `WeakMap<EdgeDatabaseService, InternalOutboxAdapter>` provides internal outbox persistence with structured access.
  - `InternalOutboxAdapter` is NOT exported through `@trident/edge` or `@trident/edge/db`.
  - Normal production consumers cannot access raw SQL execution methods (`WP012-R2-T73`, `T74`, `T75`).
- **Test-Access Boundary Truthful Disposition:**
  - `EdgeOutboxPersistence` has ZERO direct dependency on `test-access.ts`.
  - `InternalOutboxAdapter` has ZERO dependency on `test-access.ts`.
  - `EdgeDatabaseService` retains the pre-existing, inherited WP-008 module-private test registry integration (`registerTestNativeDatabase`).
  - That test registry is NOT exported through the production public API. Normal production consumers cannot obtain the native SQLite handle.
  - WP-008 regression tests continue to prove native SQLite handle encapsulation.

### 5.4 Authoritative Retry Accounting & Backoff Policy
- **Failed Delivery Accounting:**
  1. Initial delivery failure: `delivery_attempts = 1`, `retry_count = 0` (Remains outside DLQ, status `PENDING`)
  2. Failure of retry #1: `delivery_attempts = 2`, `retry_count = 1` (Remains outside DLQ)
  3. Failure of retry #2: `delivery_attempts = 3`, `retry_count = 2` (Remains outside DLQ)
  4. Failure of retry #3: `delivery_attempts = 4`, `retry_count = 3` (Remains outside DLQ)
  5. Failure of retry #4: `delivery_attempts = 5`, `retry_count = 4` (Remains outside DLQ)
  6. Failure of retry #5: `delivery_attempts = 6`, `retry_count = 5` (Routes to `cloud_integration_dlq`, status `DLQ`)
- **Canonical Limit:** Governed maximum retries is frozen to canonical `CANONICAL_MAX_RETRIES = 5`. Any attempt to override with non-canonical values is rejected at the service boundary.

### 5.5 Multi-Worker Claim Ownership & CAS Semantics
- **Atomic Batch Claim (SQL CTE):**
  ```sql
  WITH claimed AS (
    SELECT id
    FROM cloud_integration_outbox
    WHERE organization_id = $1
      AND status IN ('PENDING', 'PROCESSING')
      AND next_retry_at <= NOW()
      AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '2 minutes')
    ORDER BY created_at ASC
    LIMIT $3
    FOR UPDATE SKIP LOCKED
  )
  UPDATE cloud_integration_outbox
  SET status = 'PROCESSING',
      lock_id = $2,
      locked_at = NOW()
  WHERE id IN (SELECT id FROM claimed)
  RETURNING ...;
  ```
- **CAS Predicates:**
  Both `completeEvent` and `handleFailure` enforce `WHERE id = $1 AND status = 'PROCESSING' AND lock_id = $2`. If zero rows are updated (e.g. lease expired and reclaimed by another worker), the operation fails closed with `STALE_CLAIM`.

---

## 6. Complete Verification Test Matrix (76 Tests)

### 6.1 Original Tests (`WP012-T01` .. `WP012-T46`)

| Test ID | Description | Component | Status |
|---|---|---|---|
| `WP012-T01` | Edge OutboxQueue initializes under canonical SQLite WAL database | `@trident/edge` | **PASS** |
| `WP012-T02` | Domain fixture mutation + outbox event commit atomically | `@trident/edge` | **PASS** |
| `WP012-T03` | Outbox insert failure rolls back domain fixture mutation | `@trident/edge` | **PASS** |
| `WP012-T04` | Domain mutation failure rolls back outbox insert | `@trident/edge` | **PASS** |
| `WP012-T05` | clientOpId is preserved across retry representation | `@trident/database` | **PASS** |
| `WP012-T06` | Idempotency identity is deterministic for identical logical operation | `@trident/database` | **PASS** |
| `WP012-T07` | Different clientOpId produces a different logical operation | `@trident/database` | **PASS** |
| `WP012-T08` | Different aggregate/action cannot collide logically | `@trident/database` | **PASS** |
| `WP012-T09` | Exact duplicate request returns persisted original result | `@trident/database` | **PASS** |
| `WP012-T10` | Exact duplicate executes zero second mutation | `@trident/database` | **PASS** |
| `WP012-T11` | Duplicate result survives process/service re-instantiation | `@trident/database` | **PASS** |
| `WP012-T12` | Concurrent duplicate requests using independent PostgreSQL connections produce exactly one mutation | `@trident/database` | **PASS** |
| `WP012-T13` | Cross-tenant idempotency access is denied | `@trident/database` | **PASS** |
| `WP012-T14` | Cross-branch operation cannot reuse another branch authority | `@trident/database` | **PASS** |
| `WP012-T15` | First greenfield aggregate sequence 1 applies | `@trident/database` | **PASS** |
| `WP012-T16` | Expected next sequence applies and advances causal sequence | `@trident/database` | **PASS** |
| `WP012-T17` | incomingSequence < expectedSequence causes zero new mutation | `@trident/database` | **PASS** |
| `WP012-T18` | incomingSequence > expectedSequence is durably buffered | `@trident/database` | **PASS** |
| `WP012-T19` | Gap event is not applied to domain handler | `@trident/database` | **PASS** |
| `WP012-T20` | Missing sequence interval is correctly identified | `@trident/database` | **PASS** |
| `WP012-T21` | Arrival of missing sequence closes gap | `@trident/database` | **PASS** |
| `WP012-T22` | Contiguous sequence drains in strict aggregateSequenceNumber order | `@trident/database` | **PASS** |
| `WP012-T23` | Timestamps cannot alter causal ordering | `@trident/database` | **PASS** |
| `WP012-T24` | ReorderingBuffer survives process restart | `@trident/database` | **PASS** |
| `WP012-T25` | ACK APPLIED marks Edge outbox row SYNCED only with valid Cloud receipt | `@trident/edge` | **PASS** |
| `WP012-T26` | ACK DUPLICATE_ACCEPTED marks Edge outbox row SYNCED only with valid Cloud receipt | `@trident/edge` | **PASS** |
| `WP012-T27` | RECEIVED does NOT mark Edge row SYNCED | `@trident/edge` | **PASS** |
| `WP012-T28` | DURABLY_STORED does NOT mark Edge row SYNCED | `@trident/edge` | **PASS** |
| `WP012-T29` | Missing Cloud receipt/signature material does NOT mark Edge row SYNCED | `@trident/edge` | **PASS** |
| `WP012-T30` | CloudIntegrationOutbox event persists atomically with Cloud fixture transaction | `@trident/database` | **PASS** |
| `WP012-T31` | Cloud transaction rollback removes both fixture mutation and integration event | `@trident/database` | **PASS** |
| `WP012-T32` | Dispatcher successfully dispatches one pending event and records durable completion | `@trident/database` | **PASS** |
| `WP012-T33` | Retryable failure increments retry state | `@trident/database` | **PASS** |
| `WP012-T34` | Dispatcher applies exponential backoff delay | `@trident/database` | **PASS** |
| `WP012-T35` | Failure after retry #5 routes event to CloudIntegrationDLQ | `@trident/database` | **PASS** |
| `WP012-T36` | Non-retryable validation failure routes directly to DLQ | `@trident/database` | **PASS** |
| `WP012-T37` | Poison event moved to DLQ does not permanently block processing of subsequent queue items | `@trident/database` | **PASS** |
| `WP012-T38` | DLQ preserves raw payload + error + trace/context + attempt information | `@trident/database` | **PASS** |
| `WP012-T39` | Multiple dispatcher workers cannot process the same claimed event concurrently | `@trident/database` | **PASS** |
| `WP012-T40` | Outbox backlog >100 triggers governed alert hook | `@trident/edge` | **PASS** |
| `WP012-T41` | Outbox backlog ==100 does not trigger >100 condition | `@trident/edge` | **PASS** |
| `WP012-T42` | RLS denies direct cross-tenant access to WP-012 Cloud persistence | `@trident/database` | **PASS** |
| `WP012-T43` | Composite branch integrity rejects organization/branch mismatch | `@trident/database` | **PASS** |
| `WP012-T44` | Malformed SyncBatchDTO fails closed before mutation | `@trident/sync` | **PASS** |
| `WP012-T45` | Untrusted tenant/branch fields cannot override verified AuthContext | `@trident/sync` | **PASS** |
| `WP012-T46` | Repository regression suite passes 100% | monorepo | **PASS** |

### 6.2 Remediation 1 Tests (`WP012-R1-T47` .. `WP012-R1-T64`)

| Test ID | Description | Component | Status |
|---|---|---|---|
| `WP012-R1-T47` | Two delimiter-ambiguous logical tuples produce distinct idempotency identities | `@trident/core` | **PASS** |
| `WP012-R1-T48` | Distinct logical tuple can never receive another tuple's cached response even under forced identity collision simulation | `@trident/database` | **PASS** |
| `WP012-R1-T49` | `cloud_integration_outbox` rejects organization A + branch B mismatch | `@trident/database` | **PASS** |
| `WP012-R1-T50` | Arbitrary non-empty forged receipt signature cannot mark Edge row SYNCED | `@trident/edge` | **PASS** |
| `WP012-R1-T51` | Missing `CloudReceiptVerifier` fails closed | `@trident/edge` | **PASS** |
| `WP012-R1-T52` | Trusted deterministic TEST verifier permits valid APPLIED receipt | `@trident/edge` | **PASS** |
| `WP012-R1-T53` | Initial failure does not consume retry #1 | `@trident/database` | **PASS** |
| `WP012-R1-T54` | Initial failure + retries #1..#4 remain outside DLQ | `@trident/database` | **PASS** |
| `WP012-R1-T55` | Failure of retry #5 moves event to DLQ | `@trident/database` | **PASS** |
| `WP012-R1-T56` | Non-canonical `maxRetries` override cannot alter governed limit of 5 | `@trident/database` | **PASS** |
| `WP012-R1-T57` | Concurrent workers claim disjoint events using independent PostgreSQL connections | `@trident/database` | **PASS** |
| `WP012-R1-T58` | Stale Worker A cannot complete an event after Worker B has legitimately reclaimed it | `@trident/database` | **PASS** |
| `WP012-R1-T59` | Stale Worker A cannot record failure/DLQ transition after Worker B owns the current claim | `@trident/database` | **PASS** |
| `WP012-R1-T60` | Production Edge outbox implementation has no runtime dependency on test-access | `@trident/edge` | **PASS** |
| `WP012-R1-T61` | Production Cloud migration contains no `wp012_test_*` table | `@trident/database` | **PASS** |
| `WP012-R1-T62` | Production Edge initialization contains no `local_fixture_orders` test table | `@trident/edge` | **PASS** |
| `WP012-R1-T63` | Fractional `aggregateSequenceNumber` rejected at Edge persistence boundary | `@trident/edge` | **PASS** |
| `WP012-R1-T64` | Unsafe integer `aggregateSequenceNumber` rejected | `@trident/edge` | **PASS** |

### 6.3 Remediation 2 Tests (`WP012-R2-T65` .. `WP012-R2-T76`)

| Test ID | Description | Component | Status |
|---|---|---|---|
| `WP012-R2-T65` | IngestedIdempotencyEngine fails closed immediately if CloudReceiptIssuer is omitted or invalid | `@trident/database` | **PASS** |
| `WP012-R2-T66` | TestCloudReceiptIssuer and TestCloudReceiptVerifier are not exported from @trident/core root entrypoint | `@trident/core` | **PASS** |
| `WP012-R2-T67` | markSynced arity is strictly 2 and does not permit per-call verifier override | `@trident/edge` | **PASS** |
| `WP012-R2-T68` | Missing or omitted verifier fails closed | `@trident/edge` | **PASS** |
| `WP012-R2-T69` | Injected trusted test verifier validates genuine APPLIED receipt | `@trident/edge` | **PASS** |
| `WP012-R2-T70` | Replay of duplicate event returns byte/field-equivalent original CloudTransactionReceipt from persistence | `@trident/database` | **PASS** |
| `WP012-R2-T71` | Duplicate replay does not call injected CloudReceiptIssuer a second time | `@trident/database` | **PASS** |
| `WP012-R2-T72` | Duplicate receipt retrieved after engine restart matches original persisted receipt and passes verification | `@trident/database` | **PASS** |
| `WP012-R2-T73` | EdgeDatabaseService does not expose public exec() method | `@trident/edge` | **PASS** |
| `WP012-R2-T74` | EdgeDatabaseService does not expose public prepare() method | `@trident/edge` | **PASS** |
| `WP012-R2-T75` | Internal outbox adapter cannot be obtained through any public API of @trident/edge | `@trident/edge` | **PASS** |
| `WP012-R2-T76` | Edge atomic domain + outbox transaction functions properly using runInTransaction | `@trident/edge` | **PASS** |

---

## 7. Gates A–P Verification Report

- **Gate A — Canonical Lineage: PASS.** `S12-R3` is a direct child commit of `S12-R2 = e018bf129fe8ceddc13fe0403c23c800f46c05cd`. `M11 = 40d149ac139d11df7e716a561133069eef238db8`.
- **Gate B — WP-012 Scope Isolation: PASS.** No WP-013 (WebSocket streaming) or WP-014 (business domain consumers) implemented.
- **Gate C — Edge Transactional Outbox Atomicity: PASS.** Verified via `WP012-T02`..`T04`, `WP012-R2-T76`. Local domain operations and outbox queue commit atomically in SQLite WAL.
- **Gate D — Cloud Ingested Idempotency Durability: PASS.** Verified via `WP012-T05`, `T09`, `T11`, `WP012-R2-T70`. Records and complete receipts survive process and connection re-instantiation.
- **Gate E — Exact Duplicate Zero-Mutation Semantics: PASS.** Verified via `WP012-T10`, `WP012-R1-T48`, `WP012-R2-T70`, `WP012-R2-T71`. Duplicate yields `DUPLICATE_ACCEPTED` with zero second mutation and zero second issuer call.
- **Gate F — Multi-Instance Concurrency Safety: PASS.** Verified via `WP012-T12`, `T39`, `WP012-R1-T57`. Advisory locks serialize idempotency; atomic SQL CTE and CAS predicates serialize dispatcher workers.
- **Gate G — Aggregate Causal Sequence Monotonicity: PASS.** Verified via `WP012-T15`..`T17`, `WP012-R1-T63`..`T64`. Greenfield sequence 1, monotonic increments, safe integers enforced.
- **Gate H — Reordering Buffer / Gap Safety: PASS.** Verified via `WP012-T18`..`T24`. Future sequence buffered without domain execution; gap drainage is strictly contiguous and ordered.
- **Gate I — Structured ACK Semantics: PASS.** Verified via `WP012-T25`..`T29`. Strict DTO structure and explicit status handling.
- **Gate J — Edge SYNCED Transition Safety: PASS.** Verified via `WP012-T25`..`T29`, `WP012-R1-T50`..`T52`, `WP012-R2-T67`..`T69`. Transition to `SYNCED` requires verified receipt from trusted verifier.
- **Gate K — CloudIntegrationOutbox Atomicity: PASS.** Verified via `WP012-T30`..`T31`. Outbox events commit atomically with domain transactions.
- **Gate L — Retry / Backoff / DLQ Safety: PASS.** Verified via `WP012-T32`..`T38`, `WP012-R1-T53`..`T56`. Initial attempt + 5 retries before DLQ; canonical 5 retries frozen.
- **Gate M — Tenant / Branch Isolation: PASS.** Verified via `WP012-T13`, `T14`, `T42`, `T43`, `WP012-R1-T49`. Composite foreign keys and forced RLS prevent cross-tenant leakage.
- **Gate N — Crash / Transaction Failure Safety: PASS.** Verified via `WP012-T03`, `T04`, `T11`, `T24`, `T31`. Zero orphaned rows or partial states.
- **Gate O — Observability / Backlog Signals: PASS.** Verified via `WP012-T40`..`T41`. Outbox backlog > 100 triggers alert hook; == 100 does not.
- **Gate P — Governance / Regression / Evidence Integrity: PASS.** Verified via `WP012-T46`, `WP012-R1-T60`..`T62`, `WP012-R2-T65`..`T76`. Monorepo passes 100% (458 tests, 0 failed, 0 skipped).

---

## 8. Monorepo Quality Gate Results & CI Metrics

- `npm run graph:check`: **PASS** (0 circular dependencies, acyclic layer boundaries verified)
- `npm run format`: **PASS** (100% formatted with Prettier)
- `npm run lint`: **PASS** (0 errors across all 6 packages)
- `npm run typecheck`: **PASS** (TypeScript compilation 100% clean across all 6 packages)
- `npm run build`: **PASS** (All 6 packages build cleanly)
- `npm test`: **PASS**

### 8.1 Package Test Counts from CI
- `@trident/core`: 49 tests passed (0 failed, 0 skipped)
- `@trident/database`: 221 tests passed (0 failed, 0 skipped)
- `@trident/edge`: 165 tests passed (155 node + 10 Electron runtime; 0 failed, 0 skipped)
- `@trident/sync`: 21 tests passed (0 failed, 0 skipped)
- `@trident/pos`: 1 test passed (0 failed, 0 skipped)
- `@trident/ui`: 1 test passed (0 failed, 0 skipped)
- **Monorepo Total:** 458 tests passed, 0 failed, 0 skipped.

### 8.2 GitHub Actions Workflows
- **CI Workflow (Implementation Verification):** Run ID `34714390260`, Subject SHA `e018bf129fe8ceddc13fe0403c23c800f46c05cd`, Result: **SUCCESS** (`build = SUCCESS`, `lint = SUCCESS`, `typecheck = SUCCESS`, `unit-tests = SUCCESS`).
- **Security Scan Workflow (Implementation Verification):** Run ID `34714390276`, Subject SHA `e018bf129fe8ceddc13fe0403c23c800f46c05cd`, Result: **SUCCESS** (`secret-scan = SUCCESS`, `sca-scan = SUCCESS`, `sast-scan = SUCCESS`, `sbom-generate = SUCCESS`).

---

## 9. Security Debt & Governance Decisions Disposition

### 9.1 Security Debt Status
- **Canonical WP-012 Security Debt: NONE.**
- Inherited Debt Preserved Truthfully:
  - `SEC-VAL-02 = CLOSED`
  - `SEC-VAL-04 = CLOSED`
  - `SEC-VAL-03 = OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`
  - `SEC-VAL-08 = OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED`
  - `SEC-VAL-09 = OPEN / UNTOUCHED` (Belongs to later WAN/offline continuity validation)

### 9.2 WP-011 Hardening Advisories
All four WP-011 hardening advisories remain preserved without opportunistic modification:
- `ADV-DATA-01` — advisory lock hash-space hardening
- `ADV-DATA-02` — PostgreSQL BIGINT → JavaScript Number extreme-range hardening
- `ADV-CODE-01` — explicit currentFolio `Number.isInteger`/`Number.isSafeInteger` validation
- `ADV-CODE-02` — BIGINT/Number extreme-range hardening

### 9.3 Product Owner Open Decisions
All nine open questions remain explicitly **`PENDING PO DECISION`**:
- `OQ-SSOT-01` through `OQ-SSOT-07`
- `OQ-ARCH-01`
- `OQ-ARCH-02`  
Zero decisions resolved, defaulted, or guessed.

### 9.4 Future Work Package & Reviewer Boundaries
- **WP-013:** `NOT STARTED`
- **WP-014:** `NOT STARTED`
- **Specialist Reviewer Invocation:** `NO`
- **Code Reviewer Invocation:** `NO`
