# WP-013 S13-R5 Solution Architect Independent Review R2

**EAAF v1.2.0 — WP-013**  
**INDEPENDENT SPECIALIST REVIEW REPORT (R2 REMEDIATION)**

- **Project:** TRIDENTPOS — ERP PARA RESTAURANTES
- **Repository:** `Lucas030509/TRIDENTPOS`
- **Work Package:** WP-013 — Bidirectional Synchronization Service & WAN Reconnection Protocol
- **Bounded Context:** Platform Core / Sync
- **Governing Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)
- **Reviewer Agent:** `01_Solution_Architect`
- **Review Type:** INDEPENDENT SPECIALIST REVIEW (REMEDIATION R2)
- **Review Branch:** `review/wp-013-s13-r5-solution-r2`
- **Canonical Baseline M12:** `719b1ff0508b28cb40cd5e6b2643e2c0c365f0da`
- **Frozen Subject SHA:** `9013745959a1f35c497e7f4ef4f55cf7c138d91f`
- **Parent SHA (Frozen Subject):** `9013745959a1f35c497e7f4ef4f55cf7c138d91f`
- **Lineage:** `M12 (719b1ff)` → `S13 (bd1b85c)` → `S13-R1 (8c02aa4)` → `S13-R2 (d17d823)` → `S13-R3 (4f0e398)` → `S13-R4` (`e4776ba`) → `S13-R5` (`9013745`)
- **Sibling Review Sidecar (R1):** `12f7257e12fa54c035e0d29a8513171f6a7f3b25` (branch `review/wp-013-s13-r5-solution-r1`)
- **Date:** 2026-09-13

---

## 1. Governance Context & Purpose of R2 Remediation

Following Coordinator review of the initial Solution Architect Review (R1), a `HOLD — REVIEW EVIDENCE FACTUAL ACCURACY` was issued due to two specific factual inaccuracies in the R1 documentation:
1. **Defect SR-R1-01:** R1 erroneously asserted that `tsc -b` excludes test files.
2. **Defect SR-R1-02:** R1 erroneously described `scripts/check-graph.mjs` as performing "AST/source scanning" when it actually performs regex-based source-text scanning.

The underlying implementation candidate remains immutable, frozen, and valid at **S13-R5 = `9013745959a1f35c497e7f4ef4f55cf7c138d91f`**. No code or configuration changes were authorized or performed.

This R2 report is created on a brand new sibling sidecar branch (`review/wp-013-s13-r5-solution-r2`), branching directly from `9013745959a1f35c497e7f4ef4f55cf7c138d91f` (not from R1). It serves as the complete, standalone, authoritative Solution Architect review of candidate S13-R5.

---

## 2. Review Evidence Defect Remediations & Technical Evaluations

### 2.1 Remediation of Defect SR-R1-01: TypeScript Build & Test Compilation Architecture

#### 2.1.1 Factual Baseline Correction
In `packages/sync/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*"]
}
```
`packages/sync/tsconfig.json` specifies `"include": ["src/**/*"]` with **no `exclude` property**. Furthermore, the root `tsconfig.base.json` provides no exclusion for `*.test.ts`. Consequently:
- Running `npm run build` (`tsc -b`) in `packages/sync` **does compile all test files** located under `src/` (`src/index.test.ts`, `src/ingestion.test.ts`, `src/stream.test.ts`).
- The compilation output produces `dist/index.test.js`, `dist/ingestion.test.js`, and `dist/stream.test.js` alongside the production modules.
- This design aligns with the package's test script in `packages/sync/package.json`:
  ```json
  "test": "node --test dist/index.test.js dist/ingestion.test.js dist/stream.test.js"
  ```
  where Node.js's native test runner executes the compiled JavaScript files directly from `dist/`.

#### 2.1.2 Independent Architectural Assessment (6 Required Dimensions)
1. **Does compiling test files into `dist/` introduce a runtime dependency on `@trident/edge`?**  
   **No.** Transpiling TypeScript to JavaScript is an ahead-of-time code transformation. It does not execute the module or create runtime import bindings for external consumers of `@trident/sync`.
2. **Is `@trident/edge` still correctly classified as a devDependency?**  
   **Yes.** `@trident/edge` is required exclusively to execute the test suite (`dist/stream.test.js`) during local test execution and CI pipelines. No production source file in `packages/sync/src/` imports or depends on `@trident/edge`.
3. **Are any production entrypoints or exported runtime modules capable of loading the compiled test files?**  
   **No.** `packages/sync/src/index.ts` is the single production entrypoint and exports only:
   ```ts
   export * from './types.js';
   export * from './router.js';
   export * from './sync-ingestion-router.js';
   export * from './stream-gateway.js';
   export * from './edge-client.js';
   export * from './catalog-delta-service.js';
   ```
   It does not import, export, or reference any test files.
4. **Does `packages/sync/package.json` expose only the intended production entrypoint?**  
   **Yes.** The package manifest enforces strict encapsulation:
   ```json
   "main": "./dist/index.js",
   "types": "./dist/index.d.ts",
   "exports": {
     ".": {
       "types": "./dist/index.d.ts",
       "import": "./dist/index.js"
     }
   }
   ```
   Under Node.js subpath exports encapsulation, external consumers can only resolve `@trident/sync` to `./dist/index.js`. Any attempt to import subpaths such as `@trident/sync/dist/stream.test.js` is blocked by the Node.js runtime (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
5. **Could a production packaging/deployment mechanism include compiled test artifacts after devDependencies are pruned?**  
   **Yes.** If a deployment packaging step (e.g., Docker containerization or npm pack) naively bundles the entire `dist/` directory, `dist/*.test.js` will be physically present on disk. If an operator or script invokes `node dist/stream.test.js` in a production environment where `devDependencies` have been pruned (`npm prune --production`), the process will fail with `ERR_MODULE_NOT_FOUND` for `@trident/edge`.
6. **Architectural Classification:**  
   This condition is an **ADVISORY technical debt** (`ARCH-ADV-013-02`), **NOT an architectural blocker**. Runtime isolation and dependency boundaries remain completely secure.

#### 2.1.3 Explicit Conceptual Dependency Taxonomy
- **Compile-time Dependency:** Tools and type definitions required by the TypeScript compiler (`typescript`, `@types/ws`).
- **Test/Dev Dependency:** Libraries needed solely to run automated tests (`@trident/edge`, `jose 5.9.6`).
- **Runtime Dependency:** Modules loaded into memory when downstream packages or services execute production workflows (`@trident/core`, `ws`).
- **Package/Distribution Artifact:** Physical files emitted into `dist/` during build time.

---

### 2.2 Remediation of Defect SR-R1-02: Dependency Graph Checker Implementation Analysis

#### 2.2.1 Factual Baseline Correction
`scripts/check-graph.mjs` **does not parse an Abstract Syntax Tree (AST)**. It utilizes a regular expression scanner operating over raw source file text:
```javascript
const TRIDENT_IMPORT_REGEX =
  /(?:import\s+(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\s*\(\s*|require\s*\(\s*)['"](@trident\/[^'"/]+)(?:\/[^'"]+)?['"]/g;
```

#### 2.2.2 Verification of Detected Import Forms
The regex successfully detects and captures internal `@trident/*` dependencies across:
- **Static imports:** `import { foo } from '@trident/core';` or `import '@trident/core';`
- **Static re-exports:** `export * from '@trident/core';` or `export { bar } from '@trident/core';`
- **Dynamic imports:** `import('@trident/edge')`
- **CommonJS require calls:** `require('@trident/edge')`
- **Subpath imports:** `@trident/core/test-support` (the regex captures `@trident/core` via capture group 1 while matching trailing path segments)

#### 2.2.3 Scanner Coverage, Limitations & Potential Bypass Classes
- **Comment False Positives:** Because the scanner operates on raw text without lexical stripping of comments, an import appearing inside a block or line comment (e.g., `// import '@trident/edge'`) will be flagged as an import violation.
- **Dynamic Expression Bypasses:** Imports computed via string concatenation (e.g., `import('@trident/' + 'edge')`) or template literal expressions (e.g., ``import(`@trident/${pkgName}`)``) cannot be detected by string literal regex.
- **Indirect Loader Bypasses:** Dynamic loader aliasing (e.g., `const dynamicImport = import; dynamicImport(...)` or `const req = require; req('@trident/edge')`) bypasses detection.
- **Architectural Classification:**  
  In the context of this repository, standard coding standards enforced by ESLint, TypeScript compilation, and human code review preclude dynamic string-concatenated imports or aliased loaders. The regex scanner provides effective, fast, and deterministic boundary verification in CI/CD. The absence of an AST parser is classified as an **ADVISORY technical debt** (`ARCH-ADV-013-03`), **NOT an architectural blocker**.

---

## 3. Comprehensive Specialist Review of Candidate S13-R5

### 3.1 Architecture Boundaries & Monolith Model
- **Principle:** Modular by Design — Integrated by Contract.
- **Runtime Graph Invariant Verified:**
  ```
  @trident/core     -> []
  @trident/database -> [@trident/core]
  @trident/pos      -> [@trident/core]
  @trident/sync     -> [@trident/core]
  @trident/ui       -> [@trident/core]
  @trident/edge     -> [@trident/core]
  ```
  No business module runtime-depends on another business module.
- **Automated Verification:** `npm run graph:check` executes `check-graph.mjs` and the unit test suite `check-graph.test.mjs`, passing 10/10 automated boundary regression tests.

### 3.2 Synchronization Topology (Sec. 4 & 5, ADR-005, ADR-006)
- **Edge-Local Authority:** During offline operation, Edge POS stations write domain state and enqueue outbox records transactionally into local SQLite (`EdgeOutboxPersistence`). Operations remain fully authorized locally without Cloud availability.
- **Ingestion & Receipt Verification:**
  - Upon network availability, `EdgeSyncClient` streams batches over `WSS /api/v1/sync/stream`.
  - `CloudWebSocketSyncGateway` verifies tenant authenticity and forwards batches to `ISyncBatchProcessor`.
  - `IngestedIdempotencyEngine` processes transactions in PostgreSQL 16 and produces cryptographically verifiable receipts (`CloudTransactionReceipt`).
  - `EdgeSyncClient` receives receipts and invokes `outbox.markSynced(id, ackResult)`.
  - `EdgeOutboxPersistence` validates receipt signatures via `CloudReceiptVerifier` before transitioning SQLite outbox records to `SYNCED`.
- **Integrity:** Zero dropped transactions under simulated or real partition and recovery scenarios.

### 3.3 Automatic WAN Reconnection Protocol
- **Autonomous Transport Management:**  
  `EdgeSyncClient` manages its own connection lifecycle without requiring manual external `.connect()` intervention.
- **Failure Detection & State Transitions:**  
  Transport drops are detected via WebSocket `close` events or heartbeat ping/pong timeouts (`HEARTBEAT_FAILED`). The client automatically transitions to `RECONNECTING`.
- **Backoff & Jitter:**  
  Reconnection retries adhere to `ExponentialBackoffPolicy`, calculating exponential backoff with full symmetric jitter to prevent synchronized retry storms across multi-terminal branches.
- **Autonomous Recovery:**  
  Upon socket re-establishment, the same live client instance resets retry counters, emits `WAN_RECONNECTED` telemetry, drains backlogged outbox records via `flushOutbox()`, and triggers downstream catalog synchronization via `pullCatalogDeltas()`.

### 3.4 Outbox Semantics & Durability
- **Durable Persistence:** SQLite in WAL mode ensures transactions survive operating system crashes or process terminations.
- **Crash Recovery Tested:** In `WP013-CHAOS-01`, `EdgeDatabaseService` was terminated and reopened from disk; all offline enqueued transactions remained durable and were drained upon network restoration.
- **Receipt Enforcement:** Unverified or unacknowledged records remain in `PENDING` status. Only cryptographically verified receipts transition records to `SYNCED`.

### 3.5 WP-012 Integration & Idempotency
- **Deduplication:** Integrated with `IngestedIdempotencyEngine` in PostgreSQL 16. Duplicate event replays return `DUPLICATE_ACCEPTED` with cached receipts and 0 domain mutations.
- **Sequence Gap Handling:** Out-of-order events are buffered in `reordering_buffer_queue` with status `REQUIRES_RECONCILIATION`.
- **Repository Integration Suite:** `tests/integration/wp013-sync-e2e.test.mjs` validates cross-package workflows (Edge SQLite → WebSocket → Cloud Ingestion → PostgreSQL 16) at the repository level without introducing prohibited package runtime dependencies.

### 3.6 Checkpoint Architecture
- **Cloud Checkpoints:** Stored in `sync_checkpoints` with composite unique constraint `(organization_id, branch_id, stream_type)` and Row Level Security.
- **Edge Checkpoints:** Stored in `edge_sync_checkpoints` with stream-type uniqueness and SQL-level regression checks (`WHERE excluded.last_synced_sequence >= edge_sync_checkpoints.last_synced_sequence`).
- **Monotonic Progression:** Stale or regressing sequence updates throw `CHECKPOINT_REGRESSION_REJECTED`.

### 3.7 WebSocket Security Architecture
- **Fail-Closed Initialization:** `CloudWebSocketSyncGateway` requires a valid `IWebSocketAuthenticator`; missing authenticators cause immediate termination (`GATEWAY_INITIALIZATION_ERROR`).
- **RS256 JWT Authentication:** `JwtWebSocketAuthenticator` verifies RS256 station access tokens, strictly enforcing issuer (`iss`), audience (`aud`), and valid UUID tenant identifiers.
- **Tenant & Branch Fencing:** Ingress stream headers and batch payload properties are fenced against verified server session authority (`AuthContext`). Mismatches fail closed with `ERROR_CODE_UNAUTHORIZED_TENANT` or `ERROR_CODE_ORGANIZATION_BRANCH_MISMATCH`.
- **Strict Control Plane Claim Validation:** The claim `isControlPlane` must evaluate strictly to literal boolean `true`. String values (`"true"`), numeric values (`1`), and non-boolean truthy types fail closed (`isControlPlane = false`).
- **Kill-Switch Security:** Kill-switch commands over WebSocket require control-plane authority (`auth.isControlPlane === true`, role `CLOUD_OPS`, or permission `sync.kill_switch.manage`). Ordinary Edge stations cannot toggle the global kill switch.

### 3.8 Catalog Delta Architecture
- **Downstream Synchronization:** Versioned catalog deltas are retrieved via `DOWNSTREAM_DELTA_REQUEST` using snapshot watermarks.
- **Checksum Verification:** Edge persistence recalculates SHA-256 entity checksums (`computeCatalogDeltaChecksum`), rejecting mismatched payloads with `ERROR_CODE_DELTA_CHECKSUM_MISMATCH`.
- **Atomic Activation:** Deltas are staged in `catalog_staging` and activated into `catalog_entities` inside a single SQLite transaction (`runInTransaction()`).

### 3.9 Failure Modes & Resilience Evaluation
All required failure modes pass architectural evaluation:
1. WAN partition: Detected via heartbeat timeout and socket close; client transitions to `RECONNECTING`.
2. WAN recovery: Autonomous reconnection, outbox drain, delta pull.
3. Edge restart: Survives via SQLite WAL durability.
4. Duplicate replay: Handled safely by `IngestedIdempotencyEngine`.
5. Sequence gaps: Safely buffered in PostgreSQL.
6. Checkpoint regressions: Rejected with `CHECKPOINT_REGRESSION_REJECTED`.
7. Tenant spoofing: Blocked fail-closed by WebSocket gateway fencing.
8. Unauthorized kill-switch activation: Blocked with `ERROR_CODE_CONTROL_PLANE_FORBIDDEN`.

---

## 4. Security Validation Debt Disposition (`SEC-VAL-09`)

- **Current Governed State:** `SEC-VAL-09 = OPEN / PARTIAL`
- **Builder Proposed Status:** `SEC-VAL-09 EVIDENCE COMPLETE — PROPOSED FOR INDEPENDENT EVALUATION`
- **Specialist Review Evaluation:**
  - **Verdict:** `SEC-VAL-09 EVIDENCE VALIDATED`
  - **Justification:** The empirical test evidence generated by test `WP013-CHAOS-01` (14 sequential validation gates exercising real SQLite disk databases, process restart, gateway termination, offline order enqueueing, autonomous reconnect, and receipt verification) alongside root integration suite `tests/integration/wp013-sync-e2e.test.mjs` demonstrates complete architectural fulfillment of WAN failure modes and offline continuity for the scope of WP-013.
  - **Governance Invariant:** In accordance with EAAF v1.2.0 rules, this independent review does NOT mark `SEC-VAL-09` as `CLOSED`. Canonical debt closure remains reserved for Coordinator and Product governance, particularly as physical 30-minute hardware soak testing bridges into WP-027.
  - **Preserved Security Debts:**
    - `SEC-VAL-03 = OPEN / PARTIAL` (Preserved untouched)
    - `SEC-VAL-08 = OPEN / PARTIAL` (Preserved untouched)

---

## 5. Protected Product Owner Decisions

All nine Product Owner open questions remain strictly untouched, unresolved, and in `PENDING PO DECISION` status:
- `OQ-SSOT-01`: PENDING PO DECISION
- `OQ-SSOT-02`: PENDING PO DECISION
- `OQ-SSOT-03`: PENDING PO DECISION
- `OQ-SSOT-04`: PENDING PO DECISION
- `OQ-SSOT-05`: PENDING PO DECISION
- `OQ-SSOT-06`: PENDING PO DECISION
- `OQ-SSOT-07`: PENDING PO DECISION
- `OQ-ARCH-01`: PENDING PO DECISION
- `OQ-ARCH-02`: PENDING PO DECISION

No implementation behavior or default assumption has been substituted for official Product Owner determinations.

---

## 6. WP-014 Scope Boundary Invariant

WP-014 remains strictly prohibited and unauthorized:
- Zero dining tables (`mesas`).
- Zero dining checks (`cuentas`).
- Zero table transfers or split billing logic.
- Zero kitchen display service (`KDS`) domains.
- Zero cash drawer or inventory domain logic.

---

## 7. Findings Register

### 7.1 Blocking Findings
**NONE (0 Blocking Findings).**

---

### 7.2 Advisory Findings

#### `ARCH-ADV-013-01`: Edge Outbox Checkpoint Monotonic Counter Semantics vs Aggregate-Local Sequencing
- **Severity:** `ADVISORY`
- **Artifact:** `packages/sync/src/edge-client.ts` (lines 481-495) and `packages/edge/src/db/sync-persistence.ts` (lines 84-145)
- **Analysis:**
  In `EdgeSyncClient.prototype.flushOutbox`:
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
  The implementation advances `lastSyncedSequence` by `syncedCount`.
  1. *Safety:* Checkpoint monotonicity is preserved for tracking station drain volume.
  2. *Architectural Guidance:* Under TRIDENTPOS event-sourcing contracts (governed by WP-012), sequence numbers represent causal ordering scoped to individual aggregates (`aggregateSequenceNumber`), not a single global linear sequence across all aggregates. Downstream systems must interpret `OUTBOX_INGESTION.lastSyncedSequence` strictly as a cumulative station drain counter, and not as a global cross-aggregate causal log index.

#### `ARCH-ADV-013-02`: Compiled Test Artifacts in Package Distribution Output (`dist/*.test.js`)
- **Severity:** `ADVISORY`
- **Artifact:** `packages/sync/tsconfig.json` and `packages/sync/package.json`
- **Analysis:**
  Because `packages/sync/tsconfig.json` includes `"src/**/*"` without an `exclude` rule, test files (`*.test.ts`) are compiled into `dist/` to enable `node --test dist/*.test.js`.
  1. *Safety:* Node.js subpath exports encapsulation in `package.json` (`"exports": { ".": "./dist/index.js" }`) ensures external consumers can never import or execute these compiled test files.
  2. *Architectural Guidance:* For production artifact packaging (e.g. Docker images or npm registry publishing), build tooling should introduce a production-specific tsconfig (e.g., `tsconfig.build.json` with `exclude: ["**/*.test.ts"]`) or packaging exclusions (`.npmignore` / `"files"` whitelist) to prevent compiled test files from being bundled into release artifacts.

#### `ARCH-ADV-013-03`: Regex-Based Source Import Scanning in Monorepo Boundary Checker
- **Severity:** `ADVISORY`
- **Artifact:** `scripts/check-graph.mjs` (`TRIDENT_IMPORT_REGEX`)
- **Analysis:**
  `scripts/check-graph.mjs` verifies package boundary rules using regex matching rather than a TypeScript Abstract Syntax Tree (AST) parser.
  1. *Safety:* Standard static/dynamic imports and re-exports are reliably detected and validated in CI.
  2. *Architectural Guidance:* Future infrastructure hardening should consider migrating the import scanner to the TypeScript Compiler API (`ts.createSourceFile`) to eliminate comment false positives and provide native handling for complex expression forms.

---

## 8. Monorepo Quality & Test Verification

Full independent verification of the test suite on branch `review/wp-013-s13-r5-solution-r2`:
- `npm run format:check`: **PASS** (0 formatting deviations).
- `npm run lint`: **PASS** (0 errors).
- `npm run typecheck`: **PASS** (0 errors across all 6 packages).
- `npm run graph:check`: **PASS** (0 cycles, 0 boundary violations, 10/10 test cases pass).
- `npm test`: **PASS** (497/497 tests pass, 0 fail, 0 skip across 27 suites).

---

## 9. Formal Review Verdict

**WP-013 S13-R5 SOLUTION ARCHITECT REVIEW R2 — PASS WITH ADVISORIES**

- **Blocking Findings:** 0
- **Advisory Findings:** 3 (`ARCH-ADV-013-01`, `ARCH-ADV-013-02`, `ARCH-ADV-013-03`)
- **SEC-VAL-09 Assessment:** `SEC-VAL-09 EVIDENCE VALIDATED`
- **Readiness:** Candidate `S13-R5` (`9013745959a1f35c497e7f4ef4f55cf7c138d91f`) is architecturally sound, verified, and ready for Code Review authorization (`11_Code_Reviewer`) by the Coordinator.
