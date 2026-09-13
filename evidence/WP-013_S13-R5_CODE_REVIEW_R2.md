# WP-013 S13-R5 Independent Code Review R2

**EAAF v1.2.0 — WP-013**  
**INDEPENDENT CODE REVIEW REPORT (R2 REMEDIATION)**

- **Project:** TRIDENTPOS — ERP PARA RESTAURANTES
- **Repository:** `Lucas030509/TRIDENTPOS`
- **Work Package:** WP-013 — Bidirectional Synchronization Service & WAN Reconnection Protocol
- **Bounded Context:** Platform Core / Sync
- **Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)
- **Reviewer Agent:** `11_Code_Reviewer`
- **Review Type:** INDEPENDENT CODE REVIEW (REMEDIATION R2)
- **Review Branch:** `review/wp-013-s13-r5-code-r2`
- **Canonical Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`
- **Frozen Subject SHA:** `9013745959a1f35c497e7f4ef4f55cf7c138d91f`
- **Parent SHA (Frozen Subject):** `9013745959a1f35c497e7f4ef4f55cf7c138d91f`
- **Lineage:** `M12 (719b1ff)` → `S13 (bd1b85c)` → `S13-R1 (8c02aa4)` → `S13-R2 (d17d823)` → `S13-R3 (4f0e398)` → `S13-R4` (`e4776ba`) → `S13-R5` (`9013745`)
- **Sibling Review Sidecars:**
  - Solution Architect R1: `12f7257e12fa54c035e0d29a8513171f6a7f3b25` (`review/wp-013-s13-r5-solution-r1` — SUPERSEDED)
  - Solution Architect R2: `9264234b0b243a0e7512c3e17fc82893a82a107f` (`review/wp-013-s13-r5-solution-r2` — ACCEPTED)
  - Code Review R1: `6a0dfc7df19e71b670e5605117ef9dfb77a41291` (`review/wp-013-s13-r5-code-r1` — HOLD, incomplete impact analysis)
- **Date:** 2026-09-13

---

## 1. Executive Summary & Purpose of R2 Remediation

This R2 review remediates the incomplete concurrency impact analysis in Code Review R1 concerning advisory `CODE-ADV-013-01`.

The implementation under review remains strictly frozen at **S13-R5 = `9013745959a1f35c497e7f4ef4f55cf7c138d91f`**. Zero modifications have been made to application code, migrations, tests, package manifests, or architecture documents.

This report is created on an independent sibling branch (`review/wp-013-s13-r5-code-r2`), branching directly from `9013745959a1f35c497e7f4ef4f55cf7c138d91f`.

---

## 2. Deep-Dive Concurrency Impact Re-Evaluation: `CODE-ADV-013-01`

### 2.1 Code-Level Inspection: `markSynced()` SQL Predicate
In `packages/edge/src/db/outbox-persistence.ts` (lines 262–276):
```ts
return this.#edgeDb.runInTransaction(() => {
  const updateStmt = this.#adapter.prepare(`
    UPDATE outbox_queue
    SET
      status = 'SYNCED',
      receipt_token = ?,
      receipt_verified_at = ?,
      synced_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE id = ?;
  `);

  const res = updateStmt.run(receipt.serverSignature, receipt.appliedAt, id);
  return res.changes > 0;
});
```

**Literal Verification:**  
The `UPDATE outbox_queue` statement filters **strictly by `WHERE id = ?` without an `AND status = 'PENDING'` guard**.
If an already-`SYNCED` record is re-submitted to `markSynced()`, the SQLite engine executes the update, updates `receipt_token`, `receipt_verified_at`, and `synced_at`, and returns `res.changes = 1`. Consequently, `markSynced()` evaluates to `true`.

---

### 2.2 Concurrency Scenario Step-by-Step Analysis
When two asynchronous callers invoke `flushOutbox()` concurrently:
1. **Initial State:** SQLite table `outbox_queue` has $N$ rows in `status = 'PENDING'`.
2. **Concurrent Fetch:** Caller A invokes `flushOutbox()`. Before Caller A's network request resolves, Caller B invokes `flushOutbox()`. Both execute `getPendingEvents(limit)`, querying `WHERE status = 'PENDING' ORDER BY created_at ASC`. Both retrieve the same $N$ pending records.
3. **Dual Transmission:** Caller A and Caller B both construct a `SyncBatchDTO` and send an `UPSTREAM_BATCH` message over the WebSocket connection to the Cloud Gateway.
4. **Cloud Processing & Idempotency:**
   - The first batch to arrive is processed by `IngestedIdempotencyEngine`. The events transition to `APPLIED`, domain mutations are committed to PostgreSQL, and genuine `CloudTransactionReceipt`s are signed and returned.
   - The second batch arrives at `IngestedIdempotencyEngine`. The engine checks the 6-tuple `(organizationId, branchId, aggregateType, aggregateId, action, clientOpId)` in `ingested_idempotency_log`. It detects duplicate submissions, returns `DUPLICATE_ACCEPTED` with the previously persisted receipt, and executes **0 duplicate domain mutations**.
5. **Caller A Receipt Processing:** Caller A receives `UPSTREAM_ACK`, verifies receipts with `CloudReceiptVerifier`, and calls `outbox.markSynced(row.id, result)`. The rows transition from `PENDING` to `SYNCED`. `syncedCount` increments by $N$.
6. **Caller B Receipt Processing (The Defect Path):** Caller B receives its `UPSTREAM_ACK` (with the same authentic receipts returned by `DUPLICATE_ACCEPTED`). It verifies the receipts and calls `outbox.markSynced(row.id, result)` on the exact same rows.
   - Because `WHERE id = ?` lacks `AND status = 'PENDING'`, SQLite matches the already-`SYNCED` rows, re-writes the receipt metadata, and reports `changes = 1`.
   - `markSynced()` returns `true`.
   - Caller B increments its local `syncedCount` by $N$.
7. **Checkpoint Overcount:**
   In `packages/sync/src/edge-client.ts` (lines 481–495):
   ```ts
   if (this.#syncPersistence && syncedCount > 0) {
     const current = this.#syncPersistence.getCheckpoint('OUTBOX_INGESTION');
     const nextSeq = (current?.lastSyncedSequence ?? 0) + syncedCount;
     this.#syncPersistence.upsertCheckpoint({
       id: crypto.randomUUID(),
       organizationId: this.#auth.organizationId,
       branchId: this.#auth.branchId,
       streamType: 'OUTBOX_INGESTION',
       checkpointType: 'UPSTREAM_SEQUENCE',
       lastSyncedSequence: nextSeq,
       lastSnapshotVersion: 0,
       lastSyncTimestamp: new Date().toISOString(),
       metadata: { batchId, syncedCount },
     });
   }
   ```
   - Caller A advances `lastSyncedSequence` from 0 to $N$.
   - Caller B advances `lastSyncedSequence` from $N$ to $2N$.
   - The SQLite `edge_sync_checkpoints` and PostgreSQL `sync_checkpoints` tables accept monotonically increasing values and do not detect that the second increment represents re-acknowledged duplicate rows.

---

### 2.3 Comprehensive Control-Path Impact Investigation
To definitively determine whether this overcount constitutes an architectural blocker or a non-blocking advisory, **every reader of `OUTBOX_INGESTION` and `sync_checkpoints` across the entire monorepo was exhaustively traced**:

| Control Path Dimension | Dependency on `OUTBOX_INGESTION.lastSyncedSequence` | Direct Code Evidence | Impact Assessment |
|---|---|---|---|
| **1. Synchronization Resume** | **NONE.** Does not read checkpoint. | `EdgeOutboxPersistence.getPendingEvents()` (`packages/edge/src/db/outbox-persistence.ts#L281-L304`) selects events strictly using `WHERE status = 'PENDING' ORDER BY created_at ASC`. It never filters by sequence number or checkpoint value. | **NO IMPACT.** Resume is strictly row-state driven. |
| **2. Outbox Event Selection** | **NONE.** Does not read checkpoint. | Once a row is marked `SYNCED`, `WHERE status = 'PENDING'` will never select it again. Even if inflated to $2N$, the checkpoint has zero influence on event selection. | **NO IMPACT.** No events are skipped or falsely selected. |
| **3. Causal Reconciliation & Gap Handling** | **NONE.** Does not read checkpoint. | Gap detection is handled on Cloud by `IngestedIdempotencyEngine` using per-aggregate tracking in `aggregate_sequences` table via `aggregate_sequence_number`. It never consults `sync_checkpoints` or station-level sequence numbers. | **NO IMPACT.** Reconciliation is strictly per-aggregate. |
| **4. Retry & Failure Behavior** | **NONE.** Does not read checkpoint. | Failed events remain in `outbox_queue` in `PENDING` status with incremented `retry_count`. Retries are governed by `CANONICAL_MAX_RETRIES` (5) and local status, completely independent of checkpoints. | **NO IMPACT.** Retry logic is unchanged. |
| **5. Catalog Delta Pulling** | **NONE.** Does not read checkpoint. | `pullCatalogDeltas()` in `EdgeSyncClient` reads `getCheckpoint('CATALOG_DELTA')` and uses `lastSnapshotVersion`. It never reads `OUTBOX_INGESTION`. | **NO IMPACT.** Downstream deltas are completely decoupled. |
| **6. Domain Data Integrity** | **PROTECTED.** Guaranteed by Cloud idempotency. | In `IngestedIdempotencyEngine` (`packages/database/src/outbox/ingested-idempotency-engine.ts`), duplicate submissions hit the idempotency log and return `DUPLICATE_ACCEPTED` with 0 domain mutations. | **NO IMPACT.** Domain state remains completely uncorrupted. |
| **7. Local Outbox Row Status** | **IDEMPOTENT.** Rows remain `SYNCED`. | Each row in `outbox_queue` has `status = 'SYNCED'`. Overwriting `receipt_token` and timestamps with identical receipts from the duplicate replay causes no corruption. | **NO IMPACT.** Rows reach correct terminal status. |

---

### 2.4 True Nature of the Defect & Classification

#### Factual Finding:
The numerical value of `OUTBOX_INGESTION.lastSyncedSequence` represents a **cumulative count of acknowledged event instances**, rather than a strict 1:1 count of distinct outbox rows. Under concurrent overlapping flushes, this counter can become inflated.

#### Crux of Classification:
Because `OUTBOX_INGESTION.lastSyncedSequence` currently possesses **zero authoritative control-path role** in event selection, resume, ordering, retry, reconciliation, or domain mutation, this numerical inflation **cannot cause data loss, skipped events, phantom transactions, or security violations**.

Therefore, `CODE-ADV-013-01` is formally classified as:  
**CONFIRMED ADVISORY — NON-BLOCKING**.

---

### 2.5 Recommended Future Hardening (For Subsequent Work Packages)
When future work packages (e.g. centralized station analytics or audit reconciliation) consume `OUTBOX_INGESTION.lastSyncedSequence`, two surgical hardenings should be applied:
1. **Internal Single-Flight Re-entrancy Latch in `EdgeSyncClient`:**
   ```ts
   // packages/sync/src/edge-client.ts
   #isFlushing = false;

   public async flushOutbox(limit = 100): Promise<{ flushed: number; synced: number }> {
     if (this.#isFlushing) return { flushed: 0, synced: 0 };
     this.#isFlushing = true;
     try {
       // ... existing flush logic ...
     } finally {
       this.#isFlushing = false;
     }
   }
   ```
2. **Strict Status Predicate in `markSynced()` SQL:**
   ```sql
   -- packages/edge/src/db/outbox-persistence.ts
   UPDATE outbox_queue
   SET
     status = 'SYNCED',
     receipt_token = ?,
     receipt_verified_at = ?,
     synced_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   WHERE id = ? AND status = 'PENDING';
   ```
   This ensures that if a row was already marked `SYNCED`, `res.changes` evaluates to 0, returning `false` and preventing duplicate increment of `syncedCount`.

---

## 3. Comprehensive Code Inspection Summary

### 3.1 Correctness & State Machine (`packages/sync/src/edge-client.ts`)
- Connection states: `'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISABLED'`.
- Autonomous lifecycle: Transport loss (heartbeat timeout or socket close) automatically transitions client to `RECONNECTING` and engages exponential backoff with full symmetric jitter (`ExponentialBackoffPolicy`).
- Same running client reconnects automatically without manual `.connect()` intervention.
- Dead sockets are terminated via heartbeat timeouts (`HEARTBEAT_FAILED`).

### 3.2 WebSocket Security & Authentication (`packages/sync/src/stream-gateway.ts`)
- Mandatory fail-closed authenticator (`JwtWebSocketAuthenticator`).
- RS256 station JWT verification with strict issuer (`iss`) and audience (`aud`) checks.
- Two-layer tenant fencing: message envelope (`organizationId`, `branchId`) and batch payload (`batch.organizationId`, `batch.branchId`) are fenced against verified server session authority (`AuthContext`).
- Strict control plane boolean typing: `rawControlPlane === true` (strings/numbers evaluate to `false`).
- Kill-switch commands require verified control plane privileges.

### 3.3 Downstream Catalog Deltas (`packages/sync/src/catalog-delta-service.ts`)
- Versioned delta pull via `DOWNSTREAM_DELTA_REQUEST`.
- SHA-256 entity checksum verification (`computeCatalogDeltaChecksum`).
- Atomic staging and activation in SQLite inside a single transaction (`runInTransaction()`).

### 3.4 WP-012 Integration & Durability
- Verified with real `IngestedIdempotencyEngine` on PostgreSQL 16.
- Deduplication returns `DUPLICATE_ACCEPTED` with 0 domain mutations.
- Out-of-order events buffered in `reordering_buffer_queue`.
- SQLite WAL mode ensures crash durability across process terminations.

---

## 4. Reconfirmation of Existing Architectural Advisories

1. **`ARCH-ADV-013-01`: Edge Outbox Checkpoint Monotonic Counter Semantics vs Aggregate-Local Sequencing**  
   *Assessment:* Confirmed **ADVISORY**. `OUTBOX_INGESTION.lastSyncedSequence` is a cumulative station-level high-water counter, not a global cross-aggregate causal sequence.
2. **`ARCH-ADV-013-02`: Compiled Test Artifacts in Package Distribution Output (`dist/*.test.js`)**  
   *Assessment:* Confirmed **ADVISORY**. `packages/sync/tsconfig.json` compiles `*.test.ts` into `dist/` to enable `node --test`. Package subpath encapsulation (`"exports": { ".": "./dist/index.js" }`) prevents runtime exposure, but release bundling should filter test files from distribution tarballs.
3. **`ARCH-ADV-013-03`: Regex-Based Source Import Scanning in Monorepo Boundary Checker**  
   *Assessment:* Confirmed **ADVISORY**. `scripts/check-graph.mjs` utilizes regex matching rather than a TypeScript AST parser. Suitable for current CI/CD enforcement, but future hardening should adopt the TypeScript Compiler API (`ts.createSourceFile`).

---

## 5. Security Validation Debt Disposition (`SEC-VAL-09`)

- **Current Governed State:** `SEC-VAL-09 = OPEN / PARTIAL`
- **Builder Proposed Status:** `SEC-VAL-09 EVIDENCE COMPLETE — PROPOSED FOR INDEPENDENT EVALUATION`
- **Code Reviewer Evaluation:**
  - **Verdict:** `SEC-VAL-09 EVIDENCE VALIDATED`
  - **Justification:** Empirical test evidence in test `WP013-CHAOS-01` (14 sequential validation gates exercising real SQLite persistence, process restart, gateway termination, offline order enqueueing, autonomous reconnect, and receipt verification) and `tests/integration/wp013-sync-e2e.test.mjs` thoroughly proves WAN failure modes and offline continuity for the scope of WP-013.
  - **Governance Invariant:** Canonical debt closure is reserved for Coordinator and Product governance; `SEC-VAL-09` remains `OPEN / PARTIAL` pending hardware soak testing in `WP-027`.
  - **Preserved Security Debts:** `SEC-VAL-03 = OPEN / PARTIAL`, `SEC-VAL-08 = OPEN / PARTIAL` remain preserved untouched.

---

## 6. Protected Product Owner Decisions & Scope Invariants

- **Product Owner Decisions:** All 9 open questions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain untouched and strictly **`PENDING PO DECISION`**.
- **WP-014 Prohibited:** Strictly untouched (zero dining tables, checks, table transfers, split billing, or KDS logic).

---

## 7. Monorepo Quality & Regression Verification

Full regression suite verified on branch `review/wp-013-s13-r5-code-r2`:
- `npm run format:check`: **PASS** (0 formatting deviations).
- `npm run lint`: **PASS** (0 errors).
- `npm run typecheck`: **PASS** (0 errors across all 6 packages).
- `npm run graph:check`: **PASS** (0 cycles, 0 boundary violations, 10/10 test cases pass).
- `npm test`: **PASS** (497/497 tests pass, 0 fail, 0 skip across 27 test suites).

---

## 8. Findings Register

### 8.1 Blocking Findings
**NONE (0 Blocking Findings).**

---

### 8.2 Advisory Findings

#### `ARCH-ADV-013-01`: Edge Outbox Checkpoint Monotonic Counter Semantics
- **Severity:** `ADVISORY`
- **Context:** `OUTBOX_INGESTION.lastSyncedSequence` represents cumulative station drain volume and must not be interpreted as a global causal sequence.

#### `ARCH-ADV-013-02`: Compiled Test Artifacts in Package Distribution Output
- **Severity:** `ADVISORY`
- **Context:** `dist/*.test.js` files are generated for native test runner execution. Encapsulation prevents runtime exposure, but release packaging should filter test files.

#### `ARCH-ADV-013-03`: Regex-Based Source Import Scanning in Monorepo Boundary Checker
- **Severity:** `ADVISORY`
- **Context:** `scripts/check-graph.mjs` uses regex rather than a TypeScript AST parser.

#### `CODE-ADV-013-01`: Concurrency Latch and Predicate Hardening for `markSynced()` and `flushOutbox()`
- **Severity:** `CONFIRMED ADVISORY — NON-BLOCKING`
- **Context:**
  Concurrent calls to `flushOutbox()` can cause duplicate ACKs to re-trigger `markSynced()` because the SQL lacks `AND status = 'PENDING'`. This inflates `OUTBOX_INGESTION.lastSyncedSequence`.
- **Impact Assessment:**
  Because the checkpoint has zero control-path authority (resume, event selection, retry, and reconciliation do not consult it) and Cloud idempotency prevents duplicate domain mutations, this counter inflation causes no data loss or corruption.
- **Hardening Guidance:**
  Add `#isFlushing` single-flight guard to `EdgeSyncClient` and `AND status = 'PENDING'` to `markSynced()` SQL in future maintenance cycles.

---

## 9. Formal Review Verdict

**WP-013 S13-R5 CODE REVIEW R2 — PASS WITH ADVISORIES**

Candidate `S13-R5` (`9013745959a1f35c497e7f4ef4f55cf7c138d91f`) is code-complete, functionally correct, robustly isolated, and ready for Merge Authorization by the Coordinator.
