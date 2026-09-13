# WP-013 BUILDER EVIDENCE REPORT (S13-R2)

**Work Package:** WP-013 Bidirectional Synchronization Service & WAN Reconnection Protocol  
**Bounded Context:** Platform Core / Sync  
**Remediation Candidate Subject:** `S13-R2 = 1fbe1593252036f4d61e407df06f3e5a28e4f28c` (Direct-Child Remediation Candidate)  
**Parent Subject (S13-R1):** `8c02aa4cb943d364f828f9482e6a5d5cb907030b`  
**Original Implementation (S13):** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`  
**Parent Baseline:** `M12 = 719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`  
**Direct Lineage:** `S13-R2 (1fbe159)` -> `S13-R1 (8c02aa4)` -> `S13 (bd1b85c)` -> `M12 (719b1ff)`  
**Date:** 2026-09-12  
**Author / Builder Agent:** `13_Backend_Developer`  
**Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Implementation Branch:** `feature/wp-013-bidirectional-sync-reconnection`  
**Governance Authority:** `WP-013 S13-R2 FINAL QUICK INTEGRITY REMEDIATION`, `SYNC_AND_OFFLINE_ARCHITECTURE.md` Sec. 4 & 5, `ADR-002`, `ADR-005`, `ADR-006`  

---

## 1. Executive Summary & R2 Remediation Authorization

Under formal Coordinator Quick Integrity verdict (`S13-R1 QUICK INTEGRITY = HOLD`), candidate `S13-R1` was remediated to produce candidate `S13-R2`. S13 and S13-R1 were preserved immutably without history rewrite. All six Coordinator remediation requirements (R2-01 through R2-06) have been systematically implemented, verified against active code, and validated with automated tests.

### Summary of Resolved R2 Requirements:
1. **R2-01 (Prove True Automatic WAN Reconnection & SQLite Outbox Drain):**
   - Implemented dedicated integration test `WP013-T08` in `packages/sync/src/stream.test.ts`.
   - Verified initial baseline sync with `CloudWebSocketSyncGateway` and `EdgeSyncClient`.
   - Terminated the real HTTP server and WebSocket transport (`gateway.close()`, `server.close()`).
   - Left the SAME `EdgeSyncClient` running without calling `client.connect()`.
   - Confirmed real socket termination detected, `WAN_DISCONNECTED` emitted, state transitions to `RECONNECTING`, and exponential retry loop activates.
   - Persisted new operations into real SQLite `EdgeOutboxPersistence` while the WAN was completely down.
   - Restored the gateway on the exact same port/path.
   - Verified client retry loop automatically detects transport availability, transitions to `CONNECTED`, emits `WAN_RECONNECTED`, drains all pending SQLite outbox records to zero, and marks rows `SYNCED` only after valid receipt verification.
2. **R2-02 (Strict Control-Plane Claim Typing):**
   - Eliminated truthiness coercion (`Boolean(claims.isControlPlane)`) in `packages/sync/src/stream-gateway.ts`.
   - Enforced literal boolean equality: `claims.isControlPlane === true`.
   - String `"true"`, string `"false"`, number `1`, null, or undefined strictly fail closed and cannot grant control-plane authority.
   - Enforced strict array typing for `roles` and `permissions` (must be non-empty string elements).
   - Added negative tests verifying that malformed custom security claims never result in privilege escalation.
3. **R2-03 (Production JWT WebSocket Authentication Tests):**
   - Added `WP013-T07: Production JwtWebSocketAuthenticator Suite` in `packages/sync/src/stream.test.ts` using cryptographically signed RS256 JWTs.
   - Tested real RS256 station JWT authentication (valid UUID subject, organizationId, branchId) -> connection succeeds.
   - Tested invalid/forged signature (wrong key) -> HTTP 401 upgrade rejection.
   - Tested wrong issuer -> HTTP 401 upgrade rejection.
   - Tested wrong audience -> HTTP 401 upgrade rejection.
   - Proved authority comes strictly from verified JWT claims; payload cannot override tenant or branch authority.
   - Proved control-plane claim typing: `false`, `"false"`, `"true"`, and `1` fail closed on kill switch operations; literal boolean `true` with control-plane role succeeds.
4. **R2-04 (Concurrent PostgreSQL Checkpoint Monotonicity):**
   - Added `WP013-DB-09` in `packages/database/src/sync.test.ts` using two independent PostgreSQL pool connections (`clientA`, `clientB`).
   - Concurrently executed overlapping queries attempting to advance sequence (150 vs 80) and snapshot version (15 vs 8).
   - Verified at the SQL transaction level (`ON CONFLICT DO UPDATE WHERE ...`) that higher sequence (150) strictly wins, lower sequence update (80) produces 0 mutations, and regression attempts fail closed.
5. **R2-05 (Real WP-012 Cloud Ingestion E2E Pipeline):**
   - Implemented `WP013-DB-10` in `packages/database/src/sync.test.ts` connecting real components:
     `Real Edge SQLite Outbox` -> `EdgeSyncClient` -> `CloudWebSocketSyncGateway` -> `Real IngestedIdempotencyEngine` on PostgreSQL 16 -> `CloudTransactionReceipt` -> `Edge receipt verification` -> `SQLite SYNCED`.
   - Proves:
     1. First operation mutates PostgreSQL domain table once.
     2. Duplicate replay with identical `clientOpId` returns `DUPLICATE_ACCEPTED`.
     3. Duplicate causes zero second mutation in PostgreSQL (`count = 1`).
     4. Original persisted receipt is returned with valid server signature.
     5. Edge marks row `SYNCED` in SQLite, backlog drains to 0.
     6. Sequence gap (sequence 1 to 5) triggers buffering/reconciliation without domain mutation.
6. **R2-06 (Jitter Evidence Consistency):**
   - Updated `ExponentialBackoffPolicy` in `packages/core/src/sync-contracts.ts` to implement symmetric `base ± 20%` jitter:
     `const jitter = capped * this.#jitterRatio * (Math.random() * 2 - 1);`
   - Verified test bounds `[800, 1200]` for `base = 1000` in `packages/sync/src/stream.test.ts`.

---

## 2. Git Lineage & Commit Invariants

- **Canonical Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`
- **Initial S13 Subject:** `bd1b85cf108fd909dcd5fc8192ef63c790c92141`
- **Remediation Candidate S13-R1:** `8c02aa4cb943d364f828f9482e6a5d5cb907030b`
- **Current Candidate S13-R2:** Direct child of `S13-R1` (`8c02aa4`)
- **Implementation Branch:** `feature/wp-013-bidirectional-sync-reconnection`
- **No Force-Push / History Rewrite:** Linear descent preserved (`M12` -> `S13` -> `S13-R1` -> `S13-R2`).

---

## 3. S13-R2 Remediation Diff Summary

```
 packages/core/src/sync-contracts.ts   |   4 +-
 packages/database/src/sync.test.ts    | 242 ++++++++++++++++++++++++++++++
 packages/database/tsconfig.json       |   3 +-
 packages/sync/src/stream-gateway.ts   |  17 ++-
 packages/sync/src/stream.test.ts      | 266 +++++++++++++++++++++++++++++++-
 evidence/WP-013_BUILDER_EVIDENCE.md   | 280 +++++++++++++++++++++++++++++++---
 6 files changed, 786 insertions(+), 26 deletions(-)
```

---

## 4. Evidence of R2 Remediation Invariants

### 4.1 R2-01: True Automatic WAN Reconnection (`WP013-T08`)
- **Test:** `WP013-T08: True Automatic WAN Reconnection & Outbox Drain Without Manual Connect` in `packages/sync/src/stream.test.ts`.
- **Flow:**
  1. `CloudWebSocketSyncGateway` started on dynamic HTTP port.
  2. `EdgeSyncClient` connected; baseline sync verified (`CONNECTED`).
  3. Real socket/transport closed via `gateway.close()`; HTTP server closed.
  4. Same `EdgeSyncClient` instance left running; NO `client.connect()` called.
  5. Socket closure detected, `WAN_DISCONNECTED` emitted, state enters `RECONNECTING`.
  6. 2 new operations enqueued into real disk-backed SQLite outbox table (`outbox_queue`).
  7. Gateway restarted on exact same port and route.
  8. Automatic retry timer triggered; client automatically transitions to `CONNECTED`.
  9. `WAN_RECONNECTED` telemetry emitted.
  10. SQLite outbox automatically drained: backlog count reaches 0, records verified `SYNCED` with authentic receipt tokens.

### 4.2 R2-02: Strict Control-Plane Claim Typing
- **Code:** `packages/sync/src/stream-gateway.ts`:
  ```typescript
  isControlPlane: claims.isControlPlane === true,
  roles: Array.isArray(claims.roles)
    ? claims.roles.filter((r): r is string => typeof r === 'string' && r.length > 0)
    : [],
  permissions: Array.isArray(claims.permissions)
    ? claims.permissions.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [],
  ```
- **Test Evidence:** `WP013-T07` validates:
  - `isControlPlane: false` -> rejected (`CONTROL_PLANE_FORBIDDEN`).
  - `isControlPlane: "false"` -> rejected (`CONTROL_PLANE_FORBIDDEN`).
  - `isControlPlane: "true"` -> rejected (`CONTROL_PLANE_FORBIDDEN`).
  - `isControlPlane: 1` -> rejected (`CONTROL_PLANE_FORBIDDEN`).
  - Missing claim -> rejected (`CONTROL_PLANE_FORBIDDEN`).
  - Literal `isControlPlane: true` + role `CLOUD_OPS` -> allowed.

### 4.3 R2-03: Production JWT WebSocket Authentication (`WP013-T07`)
- **Test:** `WP013-T07: Production JwtWebSocketAuthenticator Suite` in `packages/sync/src/stream.test.ts`.
- **Cryptographic Setup:** Real RS256 key pair generated via Node `crypto` / `jose`.
- **Test Matrix:**
  - Valid Station JWT signed with private key -> HTTP 101 Switching Protocols, authenticated `AuthContext`.
  - Forged token signed with different key -> HTTP 401 Unauthorized.
  - Token with wrong issuer -> HTTP 401 Unauthorized.
  - Token with wrong audience -> HTTP 401 Unauthorized.
  - Authority strictly server-derived: client attempting to send payload for another tenant/branch rejected with `UNAUTHORIZED_TENANT`.

### 4.4 R2-04: Concurrent PostgreSQL Checkpoint Monotonicity (`WP013-DB-09`)
- **Test:** `WP013-DB-09: Concurrent PostgreSQL Checkpoint Monotonicity across independent connections` in `packages/database/src/sync.test.ts`.
- **Setup:** Two separate pool clients (`clientA`, `clientB`) executing concurrent SQL transactions against PostgreSQL 16.
- **Verification:**
  - Baseline established at sequence 100, snapshot 10.
  - Connection A attempts update to (150, 15).
  - Connection B concurrently attempts stale update to (80, 8).
  - SQL `ON CONFLICT DO UPDATE WHERE EXCLUDED.last_synced_sequence >= sync_checkpoints.last_synced_sequence AND EXCLUDED.last_snapshot_version >= sync_checkpoints.last_snapshot_version`.
  - Persisted final authority is strictly (150, 15). Stale update resulted in 0 row mutations.
  - Regressing snapshot version (160, 9 < 15) produced 0 row mutations.

### 4.5 R2-05: Real WP-012 Cloud Ingestion E2E Pipeline (`WP013-DB-10`)
- **Test:** `WP013-DB-10: Real WP-012 Cloud Ingestion E2E with PostgreSQL, receipts, and idempotency` in `packages/database/src/sync.test.ts`.
- **Components:**
  - Real disk SQLite Outbox (`EdgeOutboxPersistence`).
  - `EdgeSyncClient` with real WebSocket transport.
  - `CloudWebSocketSyncGateway`.
  - `PostgreSqlIngestedBatchProcessor` backed by real `IngestedIdempotencyEngine` on PostgreSQL 16.
  - Real `TestCloudReceiptIssuer` and `TestCloudReceiptVerifier`.
- **Verified Invariants:**
  1. First operation applied; PostgreSQL domain table mutated once; sequence advanced to 1; row marked `SYNCED` in SQLite with authentic receipt.
  2. Duplicate replay returns `DUPLICATE_ACCEPTED` with identical receipt.
  3. Duplicate replay causes zero second mutation in PostgreSQL.
  4. Sequence gap (sequence 5 with expected 2) returns governed buffering result without domain mutation.

### 4.6 R2-06: Jitter Evidence Consistency
- **Implementation:** Symmetric `base ± 20%` jitter in `ExponentialBackoffPolicy`.
- **Formula:** `delay = Math.min(Math.max(capped + capped * 0.20 * (Math.random() * 2 - 1), 0), maxDelay)`.
- **Test Evidence:** Verified in `WP013-T06` that delays are within `[800, 1200]` for `base = 1000`.

---

## 5. Complete Monorepo Regression Test Results

Full monorepo regression suite executed across all 6 packages:

| Package | Test Suites | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| `@trident/core` | 8 | 49 | 49 | 0 | 0 |
| `@trident/database` | 7 | 231 | 231 | 0 | 0 |
| `@trident/sync` | 5 | 40 | 40 | 0 | 0 |
| `@trident/edge` (Unit & SQLite) | 2 | 155 | 155 | 0 | 0 |
| `@trident/edge` (Electron Runtime) | 1 | 10 | 10 | 0 | 0 |
| `@trident/pos` | 1 | 1 | 1 | 0 | 0 |
| `@trident/ui` | 1 | 1 | 1 | 0 | 0 |
| **TOTAL** | **25** | **487** | **487** | **0** | **0** |

- **Format Check:** `npm run format:check` PASSED (All matched files use Prettier code style).
- **Lint:** `npm run lint` PASSED (0 errors across all 6 packages).
- **Build:** `npm run build` PASSED (All 6 packages compiled cleanly).
- **Typecheck:** `npm run typecheck` PASSED (0 errors across all 6 packages).
- **Dependency Graph:** `npm run graph:check` PASSED (0 boundary violations, 0 circular dependencies).
- **Acceptance Tests Skipped:** Strictly 0 skipped acceptance tests.

---

## 6. Security Validation Debt Disposition

### 6.1 SEC-VAL-09 Disposition
- **Governed Status:** `OPEN / PARTIAL`
- **Builder Proposed Status:** `SEC-VAL-09 EVIDENCE COMPLETE — PROPOSED FOR INDEPENDENT EVALUATION`
  *(Reserved strictly for independent specialist review and Coordinator evaluation; not marked closed).*

### 6.2 Preserved Security Debts
- **`SEC-VAL-03`:** `OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED` (Preserved untouched).
- **`SEC-VAL-08`:** `OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED` (Preserved untouched).
- **`SEC-VAL-02`:** `CLOSED` (Preserved).
- **`SEC-VAL-04`:** `CLOSED` (Preserved).

---

## 7. Product Owner Decision Protection

All nine Product Owner open questions remain strictly `PENDING PO DECISION`:
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

## 8. WP-014 Boundary Invariant Confirmation

WP-014 remains completely prohibited and untouched.
- No dining domain models.
- No tables (`mesas`).
- No restaurant checks (`cuentas`).
- No restaurant OCC logic.
- No kitchen display service (`KDS`).
- No cash management or inventory domains.
Synthetic aggregate names only used in test fixtures (`ORDER`).

---

## 9. Final Builder Status

**Status:** `WP-013 S13-R2 IMPLEMENTED — READY FOR COORDINATOR QUICK INTEGRITY`
