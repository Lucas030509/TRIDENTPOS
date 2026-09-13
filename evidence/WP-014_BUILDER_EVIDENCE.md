# WP-014 BUILDER EVIDENCE REPORT (S14-R2)

**Work Package:** WP-014 — Dining Room, Tables & Orders Domain Engine with OCC  
**Builder Agent:** `16_Native_Edge_Developer`  
**Role:** Implementation Builder — Surgical Remediation S14-R2  
**Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df` (M14 - ACR-2026-013 Canonical)  
**Implementation Branch:** `feature/wp-014-dining-orders-occ-r2`  
**Prior Candidate S14-R1:** `054f4f59a9f44848d312ba432e4c711716961dff`  
**Lineage:** `38062575... (base) -> eb832e58... (S14) -> 054f4f59... (S14-R1) -> S14-R2`  
**Governing Framework:** `EAAF v1.2.0` (Pinned SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Status:** `IMPLEMENTED / READY FOR COORDINATOR QUICK INTEGRITY`  

---

## 1. Executive Summary & S14-R2 Surgical Remediation

This remediation delivers candidate **S14-R2**, directly resolving the four functional integrity blockers identified in Coordinator review `COORDINATOR_PROMPT_WP014_S14_R2_REMEDIATION.md`:

1. **QI-014-01 (Protected Policies Fail Closed):**
   - `CancellationPolicy`: When cancellation is invoked without a configured policy, it fails closed by throwing `DomainError` with code `PROTECTED_POLICY_NOT_CONFIGURED` (HTTP 501). The account is not mutated. No cancellation default is selected.
   - `TransferValidationRule`: When table transfer validation is invoked without a configured rule, it fails closed by throwing `DomainError` with code `PROTECTED_POLICY_NOT_CONFIGURED` (HTTP 501). Does NOT return `true` or allowed by default.
   - `BillSplitProrationStrategy`: Existing fail-closed behavior preserved (throws `STRATEGY_NOT_CONFIGURED`, HTTP 501).
   - All 9/9 Product Owner decisions remain strictly `PENDING PO DECISION`.

2. **QI-014-02 (ADR-012 Authoritative Persistence Exactness):**
   - Removed all `Number(...)` coercions from the authoritative financial persistence path in `SqliteDiningRoomRepository`.
   - Monetary scale-4 fields (`subtotal`, `taxTotal`, `discountsTotal`, `tipsTotal`, `totalAmount`, `unitPriceApplied`, `quantity`, `taxRateApplied`, `taxAmountApplied`, `discountAmountApplied`, `modifierPriceApplied`) are bound directly as native 64-bit `bigint` into SQLite `INTEGER`.
   - Added `queryRowSafe<T>` and `queryRowsSafe<T>` to `EdgeDatabaseService` with `safeIntegers(true)` so that reads return native `bigint` without IEEE-754 floating-point conversion.
   - Verified via unit test `WP014-T13` with values exceeding `Number.MAX_SAFE_INTEGER` (`9007199254740993n`), proving exact round-trip where float conversion loses precision.

3. **QI-014-03 (Real Transactional Outbox in Production Routes):**
   - Production Fastify routes (`POST /cuentas`, `POST /ordenes/partidas`, `PUT /cuentas/:id/cerrar`) now execute business persistence and outbox insertion within a single synchronous SQLite transaction via `options.outbox.executeWithOutbox(...)` (calling `options.edgeDb.runInTransaction`).
   - No transaction is held open across unresolved asynchronous operations.
   - Verified via integration test `WP014-T14` using injected outbox failures against actual production routes: business state is completely rolled back (no account, no occupied mesa, no line items, no closed account), aggregate version does not advance, and zero outbox records exist.

4. **QI-014-04 (Aggregate Atomicity & OCC Snapshot Type Safety):**
   - Cross-aggregate atomicity between `Mesa` and `Cuenta` is strictly preserved under single transaction boundaries; partial state between table and account is prevented on both open and close operations (`WP014-T15`).
   - Hardened `OCCConflictError` serialization in Fastify error handler: dynamically detects `Mesa` vs `Cuenta` snapshots without unsafe casts. Returns HTTP 409 with `aggregateType: 'MESA'` or `aggregateType: 'CUENTA'` and the respective DTO snapshot (`WP014-T16`).
   - Hardened internal error boundary: unexpected infrastructure exceptions return generic 500 `{ error: 'INTERNAL_SERVER_ERROR', message: 'An internal server error occurred' }` with zero raw SQLite error message leakage (`WP014-T17`).

---

## 2. Changed Files S14-R1 -> S14-R2 (9 Files Total)

1. `evidence/WP-014_BUILDER_EVIDENCE.md`
2. `packages/edge/src/db/edge-database.ts`
3. `packages/edge/src/db/outbox-persistence.ts`
4. `packages/pos-edge-runtime/src/dining-sqlite-repository.ts`
5. `packages/pos-edge-runtime/src/fastify-app.ts`
6. `packages/pos-edge-runtime/src/index.test.ts`
7. `packages/pos/src/dining-service.ts`
8. `packages/pos/src/index.test.ts`
9. `packages/pos/src/ports.ts`

---

## 3. Package Topology & Architectural Invariants

| Package | Role | Dependencies | Modifications in WP-014 |
| :--- | :--- | :--- | :--- |
| `@trident/core` | Platform Foundation | None | Canonical `Money`, `roundDiv`, lexical decimal converters, line financial calculators |
| `@trident/pos` | Bounded Context Domain | `@trident/core` | Pure domain aggregates (`Mesa`, `Cuenta`, `CuentaItem`, `CuentaItemModificador`), repository ports, fail-closed policy hooks |
| `@trident/edge` | Edge Infrastructure | `@trident/core` | Parameterized database queries, `safeIntegers(true)` queries (`queryRowSafe`/`queryRowsSafe`), enhanced `executeWithOutbox` |
| `@trident/pos-edge-runtime` | Composition Root | `@trident/core`, `@trident/pos`, `@trident/edge`, `fastify` | Fastify LAN REST daemon, SQLite persistence without `Number()`, single-transaction business+outbox routes |

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
p50 = 2.359 ms
p95 = 3.420 ms
max = 6.791 ms

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
| Monorepo Graph Enforcement (`scripts/check-graph.test.mjs`) | 44 | 44 | 0 | 0 |
| `@trident/core` (Money, roundDiv, canonicalize, JWT, Pin, RBAC, etc.) | 21 | 21 | 0 | 0 |
| `@trident/pos` (dining domain unit tests + QI-014-01 fail-closed tests) | 9 | 9 | 0 | 0 |
| `@trident/pos-edge-runtime` (integration, OCC race, exact BigInt, production outbox atomicity, Mesa OCC) | 17 | 17 | 0 | 0 |
| `@trident/edge` (unit tests + Electron runtime tests) | 165 | 165 | 0 | 0 |
| `@trident/database` (PostgreSQL and cloud outbox tests) | 60 | 60 | 0 | 0 |
| `@trident/sync` (WAN sync protocol tests) | 40 | 40 | 0 | 0 |
| `@trident/ui` (UI component library tests) | 1 | 1 | 0 | 0 |
| Integration Suite (`tests/integration/wp013-sync-e2e.test.mjs`) | 1 | 1 | 0 | 0 |
| **Total Monorepo Test Suite** | **358** | **358** | **0** | **0** |

---

## 7. Quality & Governance Gates

- `npm run format:check`: **PASS** (0 style issues)
- `npm run lint`: **PASS** (0 errors across 7 packages)
- `npm run typecheck`: **PASS** (0 errors across 7 packages)
- `npm run graph:check`: **PASS** (0 boundary or cycle violations)
- `npm run clean && npm run build`: **PASS** (clean compilation from scratch)
- `npm test`: **PASS** (358/358 passed, 0 failures, 0 skipped)

---

## 8. Scope Boundaries

- **Business Scope Expansion:** NONE.
- **WP-015 (KDS / Kitchen Engine):** NOT implemented.
- **WP-016 (Cash Shift / Cortes):** NOT implemented.
- **WP-017 (Inventory / Recipes):** ZERO code imported or referenced.
- **PR Creation:** NOT authorized / NOT created.
- **Merge to Main:** NOT authorized.
