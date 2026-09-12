# WP-013 BUILDER EVIDENCE REPORT (S13-R1)

**Work Package:** WP-013 Bidirectional Synchronization Service & WAN Reconnection Protocol  
**Bounded Context:** Platform Core / Sync  
**Remediation Candidate Subject:** `S13-R1` (Remediated Implementation Candidate)  
**Initial S13 Subject:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`  
**Parent Baseline:** `M12 = 719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`  
**Direct Lineage:** `S13-R1^ = S13 = bd1b85cf108fd909dcd5fc8192ef63c790c92141` -> `M12`  
**Date:** 2026-09-12  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Implementation Branch:** `feature/wp-013-bidirectional-sync-reconnection`  
**Governance Authority:** `COORDINATOR_PROMPT_WP013_S13-R1_REMEDIATION.md`, `SYNC_AND_OFFLINE_ARCHITECTURE.md` Sec. 4 & 5, `ADR-002`, `ADR-005`, `ADR-006`  

---

## 1. Executive Summary & Remediation Authorization

Under formal Coordinator remediation authorization (`COORDINATOR_PROMPT_WP013_S13-R1_REMEDIATION.md`), candidate `S13` was remediated to produce `S13-R1`. All six Coordinator blockers (R1-01 through R1-06) and the advisory item (R1-07) have been systematically resolved, verified with real automated tests, and proven against active code.

### Summary of Resolved Blockers & Advisories:
1. **BLOCKER R1-01 (WebSocket Authentication Must Fail Closed):**
   - Eliminated all fail-open fallback behavior in `CloudWebSocketSyncGateway`.
   - `authenticator: IWebSocketAuthenticator` made strictly mandatory; constructor throws `GATEWAY_INITIALIZATION_ERROR` if omitted.
   - Handshake upgrade uses `verifyClient` returning HTTP 401 Unauthorized if authentication material is missing or invalid.
   - Session authority is strictly server-derived into an authenticated `AuthContext`.
   - Client-provided `organizationId` and `branchId` in stream payloads never establish authority; they are checked against verified session authority and rejected if mismatched.
   - `EdgeSyncClient` accepts `authToken` (string or factory function) and transmits `Authorization: Bearer <token>` securely during connection establishment.
2. **BLOCKER R1-02 (Replace False Tenant-Spoofing Test):**
   - Replaced placeholder assertions in `WP013-T02` with explicit negative tests:
     - `WP013-T02A`: Missing authentication rejected with HTTP 401 before stream operation.
     - `WP013-T02B`: Malformed/forged token rejected with HTTP 401 before stream operation.
     - `WP013-T02C`: Tenant A / Branch A connection sending Tenant B payload rejected with `ERROR_CODE_UNAUTHORIZED_TENANT`; `batchProcessor` NOT called; zero Cloud mutation.
     - `WP013-T02D`: Tenant A / Branch A connection sending Branch B payload rejected with `ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH`; `batchProcessor` NOT called; zero Cloud mutation.
     - `WP013-T02E`: Payload organization mismatch rejected; `batchProcessor` NOT called.
3. **BLOCKER R1-03 (Real SQLite Outbox Failure-Mode Test):**
   - Remediated `WP013-CHAOS-01` to use the REAL Edge persistence stack on an isolated disk SQLite database file (`EdgeDatabaseService`).
   - Uses real WP-012 transactional `EdgeOutboxPersistence` with `TestCloudReceiptVerifier`.
   - Uses real `EdgeSyncPersistence`.
   - Offline operations created transactionally in SQLite; physical rows verified as `PENDING`.
   - Full process restart simulated: closed client and database, re-opened SAME SQLite file, verified all pending records survived restart intact.
   - Restored connectivity, drained persisted outbox, and verified rows transition to `SYNCED` only after authentic receipt verification.
   - Replayed already-accepted operation; proved `DUPLICATE_ACCEPTED` with identical receipt, zero duplicate mutations, and eventual convergence.
4. **BLOCKER R1-04 (Network Failure Test Must Exercise Real Socket Failure):**
   - `WP013-CHAOS-01` terminates the actual WebSocket gateway server (`gateway.close()`).
   - Edge client detects real transport failure via `ws.on('close')`, records `WAN_DISCONNECTED` telemetry, and transitions to `RECONNECTING`.
   - Restored gateway on the same port; client reconnects automatically and drains outbox.
5. **BLOCKER R1-05 (Enforce Checkpoint Monotonicity):**
   - Enforced fail-closed monotonicity in Cloud repository `SyncCheckpointRepository` and SQL `ON CONFLICT DO UPDATE WHERE EXCLUDED.last_synced_sequence >= sync_checkpoints.last_synced_sequence AND EXCLUDED.last_snapshot_version >= sync_checkpoints.last_snapshot_version`.
   - Enforced fail-closed monotonicity in Edge SQLite `EdgeSyncPersistence`.
   - Added negative tests `WP013-DB-06` (sequence regression 84 -> 40 rejected with `CHECKPOINT_REGRESSION_REJECTED`) and `WP013-DB-07` (version regression 5 -> 3 rejected).
   - Added Edge SQLite test `WP013-T05` verifying regression rejection.
   - Replaced arbitrary `Math.max(aggregateSequenceNumber)` across unrelated aggregates with cumulative monotonic stream watermarks.
6. **BLOCKER R1-06 (Govern the Kill Switch Control Plane):**
   - Treated `KILL_SWITCH_COMMAND` as a privileged control-plane operation in `CloudWebSocketSyncGateway`.
   - Ordinary Edge stations are rejected with `ERROR_CODE_CONTROL_PLANE_FORBIDDEN` and cannot toggle the global kill switch.
   - Added negative test `WP013-T04A` proving normal Edge station is rejected and global kill switch is untouched.
   - Added positive test `WP013-T04B` proving privileged control plane (`isControlPlane: true`, `CLOUD_OPS`) can toggle kill switch and broadcast to connected stations.
7. **ADVISORY R1-07 (Backoff / Jitter Evidence Consistency):**
   - Configured `ExponentialBackoffPolicy` with production default `deterministic: false` and `jitterRatio: 0.20` (+/- 20% random jitter).
   - Added test `WP013-T06` proving production jitter produces varying delays within [base * 0.8, base * 1.2], while `deterministic: true` produces deterministic delays.

---

## 2. Git Lineage & Commit Invariants

- **Canonical Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`
- **Initial S13 Commit:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`
- **Candidate Subject S13-R1 Parent:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141` (`S13`)
- **Implementation Branch:** `feature/wp-013-bidirectional-sync-reconnection`
- **No Force-Push / History Rewrite:** Linear descent from S13 preserved.

---

## 3. Remediation Diff Summary

```
 packages/core/src/sync-contracts.ts                |   19 +-
 packages/database/src/sync.test.ts                 |   90 +-
 packages/database/src/sync/checkpoint-repository.ts|   26 +-
 packages/database/src/sync/telemetry-repository.ts |    6 +-
 packages/edge/src/db/sync-persistence.ts           |   34 +-
 packages/sync/src/catalog-delta-service.ts         |   11 +-
 packages/sync/src/edge-client.ts                   |  135 ++-
 packages/sync/src/stream-gateway.ts                |  268 ++++--
 packages/sync/src/stream.test.ts                   | 1015 +++++++++++++-------
 packages/sync/src/types.ts                         |   10 +-
 packages/sync/tsconfig.json                        |    3 +-
 evidence/WP-013_BUILDER_EVIDENCE.md                |  450 +++++++++-
 12 files changed, 1480 insertions(+), 587 deletions(-)
```

---

## 4. Evidence of Remediation Invariants

### 4.1 R1-01 & R1-02: Fail-Closed Authentication & Tenant Spoof Rejection
- **Gateway Initialization Failure:** `new CloudWebSocketSyncGateway({ ... })` without authenticator immediately throws `GATEWAY_INITIALIZATION_ERROR`.
- **Handshake Rejection:** `verifyClient` rejects unauthenticated connections with HTTP 401 (`WP013-T02A`).
- **Forged Auth Rejection:** `verifyClient` rejects invalid/forged Bearer tokens with HTTP 401 (`WP013-T02B`).
- **Tenant Spoofing Rejection:** Connection authenticated as Tenant A / Branch A sending `UPSTREAM_BATCH` claiming Tenant B receives `SYNC_ERROR` (`UNAUTHORIZED_TENANT`); `batchProcessor.processedBatches.length` remains 0; zero Cloud mutation occurs (`WP013-T02C`).
- **Branch Mismatch Rejection:** Message claiming Branch B receives `SYNC_ERROR` (`ORGANIZATION_BRANCH_MISMATCH`); `batchProcessor` not called (`WP013-T02D`).
- **Inner Payload Mismatch:** Batch payload claiming different tenant rejected with `UNAUTHORIZED_TENANT` (`WP013-T02E`).

### 4.2 R1-03 & R1-04: Real SQLite Persistence, Process Restart, and Real Socket Failure (`WP013-CHAOS-01`)
- **Real SQLite Database:** Created on disk using `EdgeDatabaseService` in temporary directory.
- **Real WP-012 Outbox Persistence:** `EdgeOutboxPersistence` bound with `TestCloudReceiptVerifier`.
- **Real Sync Persistence:** `EdgeSyncPersistence` bound to real SQLite instance.
- **Baseline Sync:** 1 operation enqueued transactionally; flushed and verified `SYNCED` in SQLite with authentic receipt.
- **Real Socket Failure:** Gateway closed via `gateway.close()`. Client detected transport failure via `ws.on('close')`, emitted `WAN_DISCONNECTED`, entered `RECONNECTING`.
- **Offline Durability:** 3 offline operations created transactionally in SQLite; physical rows verified as `PENDING`.
- **Process Restart Simulation:** Client disconnected; SQLite connection closed. Same SQLite database file re-opened with new instances of `EdgeDatabaseService`, `EdgeOutboxPersistence`, and `EdgeSyncPersistence`.
- **Pending Rows Survived Restart:** All 3 rows confirmed `PENDING` with exact payloads in SQLite.
- **Server Restored & Reconnected:** Gateway restarted on same port. Edge client connected, auto-flushed outbox.
- **Receipt Verification:** All 3 rows transitioned to `SYNCED` with verified receipt tokens in SQLite.
- **Duplicate Replay:** Operation replayed into batch processor; returned `DUPLICATE_ACCEPTED` with identical receipt, zero duplicate mutations.
- **Eventual Convergence:** Outbox backlog count reaches 0. Total 4 operations (1 baseline + 3 offline) 100% `SYNCED` in SQLite. Zero lost transactions.

### 4.3 R1-05: Checkpoint Monotonicity Enforcement
- **Cloud Database:** `SyncCheckpointRepository.upsertCheckpoint()` enforces `new >= current` for sequence and snapshot version. Throws `CHECKPOINT_REGRESSION_REJECTED`.
- **Edge SQLite:** `EdgeSyncPersistence.upsertCheckpoint()` enforces `new >= current`. Throws `CHECKPOINT_REGRESSION_REJECTED`.
- **Negative Tests:**
  - `WP013-DB-06`: Cloud sequence 84 -> 40 regression rejected.
  - `WP013-DB-07`: Cloud snapshot 5 -> 3 regression rejected.
  - `WP013-DB-08`: Equal sequence/version accepted idempotently.
  - `WP013-T05`: Edge SQLite sequence 84 -> 40 and snapshot 10 -> 7 regressions rejected.

### 4.4 R1-06: Governed Kill Switch Control Plane
- **Privileged Gateway Guard:** `KILL_SWITCH_COMMAND` checks `auth.isControlPlane || auth.roles.includes('CLOUD_OPS')`.
- **Ordinary Station Rejection:** Negative test `WP013-T04A` proves station operator is rejected with `CONTROL_PLANE_FORBIDDEN` and global kill switch remains enabled.
- **Authorized Toggle & Broadcast:** Positive test `WP013-T04B` proves control plane client can toggle kill switch, which broadcasts to connected stations, halting sync immediately.

### 4.5 R1-07: Backoff & Jitter Behavior
- Configured 20% random jitter in `ExponentialBackoffPolicy` (`jitterRatio: 0.20`, `deterministic: false` by default).
- Test `WP013-T06` verifies varying backoff delays within [0.8 * base, 1.2 * base].

---

## 5. Complete Regression Test Suite Results

Full monorepo regression suite executed:

| Package | Test Suite File(s) | Total Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| `@trident/core` | `dist/index.test.js` | 49 | 49 | 0 | 0 |
| `@trident/database` | `dist/index.test.js`, `dist/outbox.test.js`, `dist/sync.test.js` | 229 | 229 | 0 | 0 |
| `@trident/edge` (Unit & SQLite) | `dist/index.test.js`, `dist/database.test.js`, `dist/enrollment.test.js`, `dist/offline-iam.test.js`, `dist/folio.test.js`, `dist/outbox.test.js` | 155 | 155 | 0 | 0 |
| `@trident/edge` (Electron Runtime) | `scripts/run-electron-tests.mjs` | 10 | 10 | 0 | 0 |
| `@trident/pos` | `dist/index.test.js` | 1 | 1 | 0 | 0 |
| `@trident/ui` | `dist/index.test.js` | 1 | 1 | 0 | 0 |
| `@trident/sync` | `dist/index.test.js`, `dist/ingestion.test.js`, `dist/stream.test.js` | 33 | 33 | 0 | 0 |
| **TOTAL** | **All 6 Packages** | **478** | **478** | **0** | **0** |

- **Format Check:** `npm run format:check` PASSED (0 issues).
- **Lint:** `npm run lint` PASSED (0 errors across all 6 packages).
- **Build:** `npm run build` PASSED (all 6 packages compiled cleanly).
- **Typecheck:** `npm run typecheck` PASSED (0 errors across all 6 packages).
- **Dependency Graph:** `npm run graph:check` PASSED (0 boundary violations, 0 cycles).

---

## 6. Security Validation Debt Disposition

### 6.1 SEC-VAL-09 Disposition
- **Current Governed Status:** `OPEN / PARTIAL`
- **Builder Proposed Status:** `SEC-VAL-09 EVIDENCE COMPLETE — PROPOSED FOR INDEPENDENT EVALUATION`
  *(Final disposition reserved strictly for role-separated Specialist Review and Coordinator evaluation).*

### 6.2 Preserved Security Debts
- **`SEC-VAL-03`:** `OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED` (Preserved strictly untouched).
- **`SEC-VAL-08`:** `OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED` (Preserved strictly untouched).
- **`SEC-VAL-02`:** `CLOSED` (Preserved).
- **`SEC-VAL-04`:** `CLOSED` (Preserved).

---

## 7. Product Owner Decision Protection

All nine Product Owner decisions remain strictly `PENDING PO DECISION`:
- `OQ-SSOT-01`: PENDING PO DECISION
- `OQ-SSOT-02`: PENDING PO DECISION
- `OQ-SSOT-03`: PENDING PO DECISION
- `OQ-SSOT-04`: PENDING PO DECISION
- `OQ-SSOT-05`: PENDING PO DECISION
- `OQ-SSOT-06`: PENDING PO DECISION
- `OQ-SSOT-07`: PENDING PO DECISION
- `OQ-ARCH-01`: PENDING PO DECISION
- `OQ-ARCH-02`: PENDING PO DECISION

---

## 8. WP-014 Boundary Confirmation

WP-014 remains completely untouched. No restaurant domain logic, dining models, tables/mesas, cuentas, kitchen display (KDS), or billing entities have been introduced.

---

## 9. Final Remediation Status

**Status:** `WP-013-R1 IMPLEMENTED — READY FOR COORDINATOR FREEZE / QUICK INTEGRITY`
