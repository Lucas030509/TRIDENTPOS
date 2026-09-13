# WP-014 BUILDER EVIDENCE REPORT

**Work Package:** WP-014 — Dining Room, Tables & Orders Domain Engine with OCC  
**Builder Agent:** `16_Native_Edge_Developer`  
**Role:** Implementation Builder  
**Canonical Base:** `38062575ceed063c8f03af5a5c473d140dd264df` (M14 - ACR-2026-013 Canonical)  
**Implementation Branch:** `feature/wp-014-dining-orders-occ-r2`  
**Clean Merge-Base:** `38062575ceed063c8f03af5a5c473d140dd264df`  
**Governing Framework:** `EAAF v1.2.0` (Pinned SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Status:** `IMPLEMENTED / READY FOR COORDINATOR QUICK INTEGRITY`  

---

## 1. Executive Summary

WP-014 implements the core dining room, tables, and restaurant accounts domain engine with Optimistic Concurrency Control (OCC) for local floor operations in accordance with `ADR-012`, `ADR-013`, `DATA_MODEL.md`, and `IMPLEMENTATION_PLAN.md`.

All authoritative financial arithmetic is strictly implemented using exact fixed-point scale-4 integers (`bigint`) in `@trident/core`, with zero JavaScript floating point math. Dining aggregate logic and OCC version validation are isolated in pure domain package `@trident/pos`. Local edge persistence in SQLite under WAL mode and atomic transactional outbox integration are composed inside `@trident/pos-edge-runtime`.

---

## 2. Package Topology & Architectural Invariants

| Package | Role | Dependencies | Modifications in WP-014 |
| :--- | :--- | :--- | :--- |
| `@trident/core` | Platform Foundation | None | Introduced canonical `Money`, `roundDiv`, lexical decimal converters, line financial calculators |
| `@trident/pos` | Bounded Context Domain | `@trident/core` | Pure domain entities (`Mesa`, `Cuenta`, `CuentaItem`, `CuentaItemModificador`), repository ports, `DiningDomainService`, neutral PO policy hooks |
| `@trident/edge` | Edge Infrastructure | `@trident/core` | Added safe parameterized query/mutation methods on `EdgeDatabaseService` without exposing raw `exec`/`prepare` |
| `@trident/pos-edge-runtime` | Composition Root | `@trident/core`, `@trident/pos`, `@trident/edge`, `fastify` | Fastify LAN REST daemon, SQLite DDL/repositories, transactional outbox boundary |

### Architectural Boundaries Verification (`npm run graph:check`)
- Discovered 7 workspace packages.
- Zero circular dependencies.
- Zero domain-to-infrastructure imports (`@trident/pos` has zero imports of `@trident/edge` or `@trident/database`).
- No business logic in composition root `@trident/pos-edge-runtime`.
- Graph test suite: **44/44 PASS**.

---

## 3. Exact Numerics & Financial Representation (ADR-012)

### 3.1 Primitives in `@trident/core`
- `Money`: Immutable value object wrapping `amountScale4: bigint` with scale factor `10000n`.
- `roundDiv(a: bigint, b: bigint): bigint`: Commercial Half Away From Zero rounding for scale-4 integer division.
- Range bounds: `[-999_999_999_999n, +999_999_999_999n]` conforming to PostgreSQL `DECIMAL(12,4)` limits.
- Zero JavaScript floating-point numbers (`number`) in financial calculation or storage.
- Strict canonical decimal string conversions (`scaledBigIntToDecimalString`, `decimalStringToScaledBigInt` matching `/^-?\d+\.\d{4}$/`).

### 3.2 Mandatory Normative Rounding Vectors (ADR-012 Sec. 4.2)
```
roundDiv(  5000n, 10000n) =  1n  [PASS]
roundDiv( -5000n, 10000n) = -1n  [PASS]
roundDiv( 14999n, 10000n) =  1n  [PASS]
roundDiv(-14999n, 10000n) = -1n  [PASS]
roundDiv( 15000n, 10000n) =  2n  [PASS]
roundDiv(-15000n, 10000n) = -2n  [PASS]
```

### 3.3 Exact Line Financial Formula Sequence
- Line Subtotal: `roundDiv(unitPriceScale4 * quantityScale4, 10000n)`
- Net Subtotal: `lineSubtotal - discountAmountScale4`
- Tax Amount: `roundDiv(netSubtotal * taxRateScale4, 10000n)`
- Line Total: `netSubtotal + taxAmount`
- Account Aggregate Totals: Exact integer sum of child line totals (no global tax recomputation).

---

## 4. Dining Domain & Concurrency Control (OCC)

### 4.1 Domain Aggregates (`@trident/pos`)
- `Mesa`: Table aggregate with lifecycle `DISPONIBLE` -> `OCUPADA` -> `DISPONIBLE`.
- `Cuenta`: Dining account aggregate with lifecycle `ABIERTA` -> `PAGADA` | `ANULADA`.
- `CuentaItem`: Order line with product snapshot, scale-4 monetary attributes, status `ACTIVO` | `CANCELADO`.
- `CuentaItemModificador`: Product customization line item persisting modifier price at scale 4. Canonical table: `cuenta_item_modificadores`.

### 4.2 Optimistic Concurrency Control (OCC)
- CAS on aggregate mutations: `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`.
- Version mismatch: Throws `OCCConflictError` mapping to HTTP 409 with the current database snapshot returned in `currentSnapshot`.
- Concurrency verification (`WP014-T07`): Tested true concurrent race condition on the same SQLite database file between two competing clients. Exactly one client succeeds; the competing client receives HTTP 409; **0 lost updates**.

---

## 5. Persistence & Transactional Outbox (WP-012 Integration)

- SQLite database running under WAL mode (`journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`).
- Monetary and tax amounts persisted strictly as SQLite `INTEGER` (scale factor 10,000). Zero `REAL` columns.
- Reused canonical `EdgeOutboxPersistence` from WP-012 without duplicating outbox tables or mechanisms.
- **Atomic Invariant:** Business mutations and outbox records commit in the identical SQLite transaction. Failure of either rolls back both with 0 partial state (`WP014-T09`).

---

## 6. Protected Product Owner Policies (Pending Decision)

In strict accordance with EAAF v1.2 governance, the following PO items remain **PENDING PO DECISION** with neutral interfaces/hooks only and **zero unauthorized default behavior**:
- `OQ-SSOT-01` (Item Cancellation Semantics): `CancellationPolicy` hook interface only.
- `OQ-SSOT-02` (Table Transfer Rules): `TransferValidationRule` hook interface only.
- `OQ-SSOT-06` (Bill Split Proration Strategy): `BillSplitProrationStrategy` interface only.
- All 9/9 protected PO open questions remain explicitly preserved without speculative code.

---

## 7. Performance Benchmark

Local engineering benchmark executed in `WP014-T12`:
- **Hardware / Environment:** macOS darwin-arm64 (Apple Silicon)
- **Operation Tested:** Sequential `addItemToCuenta` mutation + SQLite WAL persistence + transactional outbox enqueue
- **Sample Count:** 50 sequential orders
- **Results:**
  - Min: 0.959 ms
  - Median (p50): 2.200 ms
  - p95: 3.973 ms
  - Max: 6.117 ms
- **Target Invariant (<5ms p95):** PASS locally.
- **Security Debt Statement:** Local development hardware cannot conclusively establish the frozen edge production hardware target. Therefore, **`SEC-VAL-08` remains OPEN** and is not closed by this local benchmark.

---

## 8. Test Matrix & Regression Results

| Scope / Package | Tests Run | Passed | Failed | Skipped |
| :--- | :--- | :--- | :--- | :--- |
| Monorepo Graph Enforcement (`scripts/check-graph.test.mjs`) | 44 | 44 | 0 | 0 |
| `@trident/core` (including 7 new Money/roundDiv tests) | 56 | 56 | 0 | 0 |
| `@trident/pos` (pure dining domain unit tests) | 8 | 8 | 0 | 0 |
| `@trident/pos-edge-runtime` (integration, OCC race, outbox tests) | 12 | 12 | 0 | 0 |
| `@trident/edge` (unit tests + Electron runtime tests) | 165 | 165 | 0 | 0 |
| `@trident/database` (PostgreSQL and cloud outbox tests) | 283 | 283 | 0 | 0 |
| `@trident/sync` (WAN sync protocol tests) | 39 | 39 | 0 | 0 |
| `@trident/ui` (UI component library tests) | 1 | 1 | 0 | 0 |
| Integration Suite (`tests/integration/wp013-sync-e2e.test.mjs`) | 1 | 1 | 0 | 0 |
| **Total Monorepo Test Suite** | **609** | **609** | **0** | **0** |

---

## 9. Quality & Governance Gates

- `npm run format:check`: **PASS** (0 style issues)
- `npm run lint`: **PASS** (0 errors across 7 packages)
- `npm run typecheck`: **PASS** (0 errors across 7 packages)
- `npm run graph:check`: **PASS** (0 boundary or cycle violations)
- `npm run clean && npm run build`: **PASS** (clean compilation from scratch)
- `npm test`: **PASS** (609/609 passed, 0 failures, 0 skipped)

---

## 10. Scope Boundaries

- **Business Scope Expansion:** NONE.
- **WP-015 (KDS / Kitchen Engine):** NOT implemented.
- **WP-016 (Cash Shift / Cortes):** NOT implemented.
- **WP-017 (Inventory / Recipes):** ZERO code imported or referenced.
- **PR Creation:** NOT authorized / NOT created.
- **Merge to Main:** NOT authorized.
