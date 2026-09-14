# WP-014 BUILDER EVIDENCE REPORT (S14-R4 FINAL)

**Work Package:** WP-014 — Dining Room, Tables & Orders Domain Engine with OCC  
**Builder Agent:** `16_Native_Edge_Developer`  
**Role:** Implementation Builder — Evidence-Only Finalization S14-R4 (FINAL)  
**Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df` (M14 - ACR-2026-013 Canonical)  
**Implementation Branch:** `feature/wp-014-dining-orders-occ-r2`  
**Prior Candidate S14-R3:** `5b6f0644b4e901554f327dabf7139f148e3a778f`  
**Lineage:** `38062575... (base) -> eb832e58... (S14) -> 054f4f59... (S14-R1) -> fefe6ba5... (S14-R2) -> 5b6f0644... (S14-R3) -> S14-R4`  
**Governing Framework:** `EAAF v1.2.0` (Pinned SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Status:** `READY FOR COORDINATOR FINAL FREEZE`  

---

## 1. Executive Summary & S14-R3 Surgical Remediation

This remediation delivers candidate **S14-R3**, resolving the final two quick integrity blockers identified in `COORDINATOR_PROMPT_WP014_S14_R3_REMEDIATION.md`:

1. **QI-014-05 (clientOpId Transport Boundary Validation & Infrastructure Rollback Proof):**
   - Externally supplied `clientOpId` is validated as canonical UUIDv4 using `isValidUuidV4` from `@trident/core` at the Fastify transport boundary before entering any business transaction or domain mutation.
   - Applied consistently across all frozen endpoints: `POST /cuentas`, `POST /ordenes/partidas`, and `PUT /cuentas/:id/cerrar`.
   - Invalid `clientOpId` immediately returns **HTTP 400 VALIDATION_ERROR** with `{ error: 'VALIDATION_ERROR', message: 'clientOpId must be a valid UUIDv4' }`. It does NOT begin a business mutation, does NOT advance aggregate version, does NOT enqueue outbox records, and does NOT return HTTP 500.
   - Preserves defense-in-depth invariant in `EdgeOutboxPersistence.enqueue()`.
   - Replaced input-dependent rollback tests with a real infrastructure/persistence failure injection seam: stubbed outbox enqueue throws an error during the synchronous SQLite transaction block with valid client inputs.
   - Verified that forced persistence failure returns generic HTTP 500, executes full SQLite rollback, leaves zero partial state, preserves aggregate versions, and leaves zero outbox records for account opening (Mesa + Cuenta), line addition, and account closing (Cuenta + Mesa).
   - Tested hardened Fastify error boundary (`HTTP 500 {"error":"INTERNAL_SERVER_ERROR","message":"An internal server error occurred"}`) using an unexpected internal exception containing sensitive connection strings, proving zero leakage of stack traces or SQLite internals.

2. **QI-014-06 (Public API Surface Restricted to Frozen Contract & Mesa OCC Domain Proof):**
   - Removed unauthorized public Fastify routes: `POST /mesas`, `GET /mesas`, and `PUT /mesas/:id`.
   - Production Fastify public surface is now strictly restricted to the frozen contract:
     - `POST /cuentas`
     - `POST /ordenes/partidas`
     - `PUT /cuentas/:id/cerrar`
   - Mesa remains a canonical WP-014 domain aggregate and repository entity.
   - Mesa OCC is proven directly at the domain/repository layer without public HTTP surface expansion:
     - Mesa at version 1 updated with `expectedVersion: 1` succeeds and advances to version 2.
     - Stale update with `expectedVersion: 1` throws `OCCConflictError` containing `aggregateId`, `expectedVersion: 1`, `actualVersion: 2`, and current snapshot at version 2.
     - `serializeSnapshotToDTO(mesa)` produces `{ aggregateType: 'MESA', snapshot: ... }`.
   - Verified that `POST /mesas`, `GET /mesas`, and `PUT /mesas/:id` return HTTP 404 on the production Fastify application.

3. **Preservation of Blockers QI-014-01 through QI-014-04:**
   - **QI-014-01 (PASS):** Protected policies fail closed (`CancellationPolicy`, `TransferValidationRule`, `BillSplitProrationStrategy` throw 501 `PROTECTED_POLICY_NOT_CONFIGURED` / `STRATEGY_NOT_CONFIGURED`).
   - **QI-014-02 (PASS):** Zero `Number()` conversions in authoritative financial persistence. Direct 64-bit `bigint` binding and `safeIntegers(true)` queries.
   - **QI-014-03 (PASS):** Real single-transaction business + outbox atomicity under `options.outbox.executeWithOutbox(...)`.
   - **QI-014-04 (PASS):** Mesa + Cuenta cross-aggregate atomicity and type-safe OCC snapshots.

---

## 2. Changed Files S14-R2 -> S14-R3 (3 Files Total)

1. `evidence/WP-014_BUILDER_EVIDENCE.md`
2. `packages/pos-edge-runtime/src/fastify-app.ts`
3. `packages/pos-edge-runtime/src/index.test.ts`

---

## 3. Package Topology & Architectural Invariants

| Package | Role | Dependencies | Modifications in WP-014 |
| :--- | :--- | :--- | :--- |
| `@trident/core` | Platform Foundation | None | Canonical `Money`, `roundDiv`, lexical decimal converters, line financial calculators, `isValidUuidV4` |
| `@trident/pos` | Bounded Context Domain | `@trident/core` | Pure domain aggregates (`Mesa`, `Cuenta`, `CuentaItem`, `CuentaItemModificador`), repository ports, fail-closed policy hooks |
| `@trident/edge` | Edge Infrastructure | `@trident/core` | Parameterized database queries, `safeIntegers(true)` queries (`queryRowSafe`/`queryRowsSafe`), enhanced `executeWithOutbox` |
| `@trident/pos-edge-runtime` | Composition Root | `@trident/core`, `@trident/pos`, `@trident/edge`, `fastify` | Fastify LAN REST daemon, frozen REST routes, clientOpId transport validation, single-transaction business+outbox execution |

### Architectural Boundaries Verification (`npm run graph:check`)
- Discovered 7 workspace packages.
- Zero circular dependencies.
- Zero domain-to-infrastructure imports (`@trident/pos` has zero imports of `@trident/edge` or `@trident/database`).
- No business logic in composition root `@trident/pos-edge-runtime`.
- Graph test suite: **44/44 PASS**.

---

## 4. Protected Product Owner Policies (Pending Decision)

All 9/9 protected PO open questions remain explicitly **PENDING PO DECISION**:
- `OQ-SSOT-01` (Item Cancellation Semantics): `CancellationPolicy` hook interface; fails closed with `PROTECTED_POLICY_NOT_CONFIGURED` (501) when absent.
- `OQ-SSOT-02` (Table Transfer Rules): `TransferValidationRule` hook interface; fails closed with `PROTECTED_POLICY_NOT_CONFIGURED` (501) when absent.
- `OQ-SSOT-06` (Bill Split Proration Strategy): `BillSplitProrationStrategy` hook interface; fails closed with `STRATEGY_NOT_CONFIGURED` (501) when absent.
- Zero unauthorized default business choices implemented.

---

## 5. Performance Benchmark

Local engineering benchmark executed in `WP014-T12`:
- **Hardware / Environment:** macOS darwin-arm64 (Apple Silicon)
- **Operation Tested:** Sequential `addItemToCuenta` mutation + SQLite WAL persistence + transactional outbox enqueue
- **Sample Count:** 50 sequential orders

```
Local Performance Signal:
PARTIAL / INCONCLUSIVE FOR FROZEN <5ms TARGET

Observed:
p50 = 2.129 ms
p95 = 3.587 ms
max = 6.315 ms

Interpretation:
Median and p95 were below 5ms in the local development environment.
At least one measured operation exceeded 5ms.
Therefore the implementation evidence does not claim universal compliance with the <5ms frozen target.

SEC-VAL-08:
OPEN / NOT CLOSED

Target-hardware benchmark:
REQUIRED LATER
```

---

## 6. Test Matrix & Regression Results

| Scope / Package | Tests Run | Passed | Failed | Skipped |
| :--- | :--- | :--- | :--- | :--- |
| Monorepo Graph Enforcement (`npm run graph:check`) | 44 | 44 | 0 | 0 |
| `@trident/core` (Money, roundDiv, canonicalize, JWT, Pin, RBAC, etc.) | 56 | 56 | 0 | 0 |
| `@trident/pos` (dining domain unit tests + QI-014-01 fail-closed tests) | 9 | 9 | 0 | 0 |
| `@trident/pos-edge-runtime` (integration, OCC race, exact BigInt, production outbox atomicity, Mesa OCC) | 17 | 17 | 0 | 0 |
| `@trident/edge` (unit tests + Electron runtime tests) | 155 | 155 | 0 | 0 |
| `@trident/database` (PostgreSQL and cloud outbox tests) | 230 | 230 | 0 | 0 |
| `@trident/sync` (WAN sync protocol tests) | 40 | 40 | 0 | 0 |
| `@trident/ui` (UI component library tests) | 1 | 1 | 0 | 0 |
| Integration Suite (`tests/integration/wp013-sync-e2e.test.mjs`) | 1 | 1 | 0 | 0 |
| **Workspace / Package Tests Subtotal** | **508** | **508** | **0** | **0** |
| **Root Integration Tests Subtotal** | **1** | **1** | **0** | **0** |
| **npm test Total** | **509** | **509** | **0** | **0** |
| **npm run graph:check Total** | **44** | **44** | **0** | **0** |
| **Total Validations Executed Independently** | **553** | **553** | **0** | **0** |

---

## 7. Quality & Governance Gates

- `npm ci`: **PASS**
- `npm run format:check`: **PASS** (0 style issues)
- `npm run lint`: **PASS** (0 errors across 7 packages)
- `npm run typecheck`: **PASS** (0 errors across 7 packages)
- `npm run graph:check`:
  - **PASS — 44/44** (0 boundary or cycle violations)
- `npm run clean && npm run build`: **PASS** (clean compilation from scratch)
- `npm test`:
  - **PASS — 509/509**
  - Breakdown:
    - 508 workspace/package tests
    - 1 root integration test
- **Total Validations Executed**:
  - **553/553 PASS**
  - Failures: 0
  - Skipped: 0
- **Performance**:
  - **PARTIAL / INCONCLUSIVE**
- **SEC-VAL-08**:
  - **OPEN**
- **Protected PO Decisions**:
  - **9/9 PENDING PO DECISION**

---

## 8. Scope Boundaries

- **Business Scope Expansion:** NONE.
- **WP-015 (KDS / Kitchen Engine):** NOT implemented.
- **WP-016 (Cash Shift / Cortes):** NOT implemented.
- **WP-017 (Inventory / Recipes):** ZERO code imported or referenced.
- **PR Creation:** NOT authorized / NOT created.
- **Merge to Main:** NOT authorized.
