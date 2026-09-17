# WP-015 — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service — Canonical Remediation Builder Evidence

## WP

`WP-015` — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service (Canonical Remediation under ACR-2026-016).

## Builder Agent

`16_Native_Edge_Developer` (implementation only — this evidence file is NOT an independent specialist review, NOT a code review, and does not self-approve this work).

## Canonical Base SHA

`eb6cef40e39248bb9d4d688482cb0393dcc79510` — verified via `git rev-parse origin/main` (unmoved throughout implementation).

## Implementation Branch

`feat/wp-015-kds-canonical-remediation`, created directly from `eb6cef40e39248bb9d4d688482cb0393dcc79510`.

## Changed Files (24 total including this evidence document)

**Modified (7):**
- `package-lock.json` (registers `ws`/`@types/ws` for `@trident/edge`)
- `packages/edge/package.json` (adds `ws` dependency, `@types/ws` devDependency, extends `test:unit` script)
- `packages/edge/src/index.ts` (barrel-exports the new `kds/` subsystem)
- `packages/pos-edge-runtime/package.json` (extends `test` script)
- `packages/pos-edge-runtime/src/index.ts` (barrel-exports new KDS composition modules)
- `packages/pos/package.json` (extends `test` script)
- `packages/pos/src/index.ts` (barrel-exports new KDS domain modules)

**New (17):**
- `evidence/WP-015_BUILDER_EVIDENCE.md` — this builder evidence artifact (Advisory 015-A compliance)
- `packages/pos/src/kds-types.ts` — KDS domain types (`KdsEstacion`, `KdsTicket`, `KdsTicketPartida`, `ImpresoraRed`, event contract with `tiempoPreparacionMinutos`, `preparationTimeMinutes`)
- `packages/pos/src/kds-ports.ts` — `KdsRepositoryPort`, `PrinterRepositoryPort`, `KdsEventPublisherPort` (including `getTicketForRecall`)
- `packages/pos/src/kds-service.ts` — `KdsDomainService` (pure domain logic: `enviarComandaACocina`, `iniciarPreparacionOrden`, `confirmarOrdenSurtida`, `consultarOrdenesActivas`, `recuperarOrdenRecall` with preparation time & ADR-012 quantity rules)
- `packages/pos/src/kds-service.test.ts` — domain unit tests (WP015-T01..T09, WP015-R1-01..R1-05, WP015-R2-01..R2-02, WP015-R3-01..R3-02)
- `packages/edge/src/kds/escpos-formatter.ts` — pure ESC/POS byte formatter
- `packages/edge/src/kds/escpos-formatter.test.ts` — formatter unit tests (WP015-T10..T12)
- `packages/edge/src/kds/escpos-printer-client.ts` — raw TCP ESC/POS printer transport
- `packages/edge/src/kds/escpos-printer-client.test.ts` — printer client unit tests (WP015-T13..T16)
- `packages/edge/src/kds/ws-dispatcher.ts` — `KdsWebSocketDispatcher` (`WS /kds/events`)
- `packages/edge/src/kds/ws-dispatcher.test.ts` — dispatcher unit tests (WP015-T17..T22)
- `packages/edge/src/kds/index.ts` — barrel export for the `kds/` subsystem
- `packages/pos-edge-runtime/src/kds-schema.ts` — SQLite DDL for the 4 WP-015 Data Objects (`preparation_time_minutes` column, scale-4 `quantity INTEGER`)
- `packages/pos-edge-runtime/src/kds-sqlite-repository.ts` — `SqliteKdsRepository` (implements both ports, SQLite scale-4 integer storage, recall retrieval, preparation time persistence)
- `packages/pos-edge-runtime/src/printer-queue-runner.ts` — `PrinterQueueRunner` (retry/backoff orchestration with intermediate `PRINTING` persistence)
- `packages/pos-edge-runtime/src/kds-runtime.ts` — `createKdsRuntime` composition root
- `packages/pos-edge-runtime/src/kds-runtime.test.ts` — end-to-end integration tests (WP015-T23..T28)

**Governing Documentation Integrity:**
Zero governing documentation or architecture files were modified. `ARCHITECTURE_CHANGE_REQUEST_KDS_CONTRACT_DATA_RECONCILIATION.md`, `FUNCTIONAL_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `DATA_AUTHORITY_MATRIX.md`, `ADR/ADR-005-local-lan-communication-protocol.md`, `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md`, `SOLUTION_ARCHITECTURE.md`, and `SECURITY_ARCHITECTURE.md` are strictly READ-ONLY.

Excluded from git staging: `.claude/` and `scripts/dev-pos-server.mjs` (untracked local development artifacts).

---

## Canonical Remediation Summary (ACR-2026-016 & Quick Integrity Findings)

### 1. Remediation R1 (QI-BLK-015-01): Canonical Recall Contract
- **Contract Signature**: `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)`
- **Behavior**:
  - Accepts `ordenProduccionId` as the unique recall authority (station ID cannot substitute production order ID).
  - Queries by production-order identity and returns the exact `KdsTicket` or `null`.
  - Uses `completed_at` as the recall-window anchor (`now - completed_at <= windowMinutes * 60 * 1000`).
  - Strictly non-mutating: does not alter ticket status or database records.
- **Tests**:
  - `WP015-R1-01`: Existing completed order within recall window -> returns exact ticket.
  - `WP015-R1-02`: Existing completed order outside recall window -> returns null.
  - `WP015-R1-03`: Missing or incomplete order id -> returns null.
  - `WP015-R1-04`: Recall operation causes no state mutation.
  - `WP015-R1-05`: Station identity cannot substitute `ordenProduccionId`.
  - `WP015-T28`: Edge SQLite integration test for recall lookup.

### 2. Remediation R2 (QI-BLK-015-02): Preparation Time Persistence & Event Propagation
- **Persistence**:
  - Column `kds_tickets.preparation_time_minutes` in SQLite DDL (`kds-schema.ts`): `INTEGER NULL CHECK (preparation_time_minutes IS NULL OR preparation_time_minutes >= 0)`.
  - Initial state before completion: `NULL`.
  - On `confirmarOrdenSurtida`: validates non-negative whole integer and persists to SQLite.
- **Domain Event**:
  - `OrdenProduccionConfirmadaEnKDS` explicitly includes `tiempoPreparacionMinutos: number | null`.
- **Tests**:
  - `WP015-R2-01`: Valid zero minutes accepted and persisted.
  - `WP015-R2-02`: Rejection of negative values or floating-point decimals.
  - `WP015-T04`: Full lifecycle verification of preparation time emission.
  - `WP015-T27`: Edge SQLite persistence and reload of preparation time.

### 3. Remediation R3 (QI-BLK-015-03): ADR-012 Quantity Representation
- **Representation**:
  - Wire / JSON: Canonical 4-decimal string format (e.g., `"1.0000"`, `"0.1250"`, `"12.3456"`).
  - Domain arithmetic: `bigint` scale 4 (factor `10000n`).
  - SQLite persistence: `kds_ticket_partidas.quantity INTEGER NOT NULL` (stored as integer `10000` for 1 unit, `1250` for 0.125 units).
  - Canonical Primitives: Reuses `@trident/core` (`decimalStringToScaledBigInt`, `scaledBigIntToDecimalString`). Zero IEEE 754 floating point arithmetic in authoritative quantity paths.
- **Tests**:
  - `WP015-R3-01`: Valid fractional and integer quantities parse correctly.
  - `WP015-R3-02`: Rejection of zero, negative, invalid decimal strings, and excessive precision.
  - `WP015-T23`: Edge SQLite integer persistence roundtrip verification.

### 4. Remediation R4 (QI-BLK-015-04): Printer Lifecycle & Intermediate `PRINTING` State
- **Printer Queue Runner**:
  - Before initiating TCP socket connection and byte transmission, `PrinterQueueRunner` updates `kds_tickets.print_status` to `'PRINTING'` in SQLite.
  - On completion: updates to `'PRINTED'`, increments attempts, marks printer `ONLINE`.
  - On failure: updates to `'QUEUED'` (if attempts < maxAttempts) or `'FAILED'` with `last_print_error`, marks printer `OFFLINE`.
  - Durability: Survives process restart without queue loss.

---

## Package Topology (ADR-013 Compliance)

- **`@trident/pos`** (domain, Layer 2): Pure business logic implementing FUNCTIONAL_ARCHITECTURE.md Sec. 6.1 contract (`EnviarComandaACocina`, `IniciarPreparacionOrden`, `ConfirmarOrdenSurtida`, `ConsultarOrdenesActivas`, `RecuperarOrdenRecall`). Depends only on `@trident/core`.
- **`@trident/edge`** (infrastructure, Layer 3): `KdsWebSocketDispatcher` (raw `ws` WebSocket server, per ADR-005), `EscPosPrinterClient` (raw TCP socket transport), and `formatKdsTicketEscPos` (pure byte formatter). Generic device I/O only, zero KDS business semantics.
- **`@trident/pos-edge-runtime`** (composition root, Layer 4): `SqliteKdsRepository` (SQLite persistence adapter implementing both domain ports), `PrinterQueueRunner` (orchestration), and `createKdsRuntime`.

Verified by `npm run graph:check` (44/44 rules pass).

---

## Test Execution Results (Advisory 015-B Compliance)

### Unit & Integration Suite Summary

| Package | Test Target | Tests | Pass | Fail | Notes |
|---|---|---|---|---|---|
| `@trident/pos` | `src/kds-service.test.ts`, dining tests | 27 | 27 | 0 | Pure domain logic & ADR-012 tests |
| `@trident/edge` | `test:unit` (escpos, ws-dispatcher, outbox) | 168 | 168 | 0 | Unit & loopback transport tests |
| `@trident/pos-edge-runtime` | `kds-runtime.test.ts`, dining tests | 23 | 23 | 0 | Edge SQLite & printer queue integration |
| `@trident/core` | Core money & utilities | (full) | all | 0 | ADR-012 fixed point primitives |
| `@trident/database` | Cloud database & outbox | 260 | 260 | 0 | Cloud ingestion & schema |
| `@trident/sync` | Sync stream | (full) | all | 0 | Edge-cloud sync |
| `@trident/ui` | UI components | 1 | 1 | 0 | Frontend UI |
| Root | `test:integration` | 1 | 1 | 0 | Cross-package integration |

### Environment Limitation Disclosure
`@trident/edge`'s `test:electron` step (`npm run test:electron`) fails in headless / non-GUI sandbox environments with `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`. This is an environment/sandbox limitation (Electron cannot boot in headless node without display server), reproduced identically on clean canonical `main` (`eb6cef40e39248bb9d4d688482cb0393dcc79510`). All unit tests (`npm run test:unit` in `@trident/edge`) and all other package tests pass 100%.

---

## Build, Typecheck, Lint & Dependency Graph Validation

- **Build**: `npm run build` (turbo run build across 7 packages) — PASS (0 errors).
- **Typecheck**: `npm run typecheck` (tsc across all packages) — PASS (0 errors).
- **Lint**: `npm run lint` (eslint across all packages) — PASS (0 errors).
- **Dependency Graph**: `npm run graph:check` — PASS (44/44 tests pass).

---

## Performance & LAN Latency Validation

- **Local Software Loopback Benchmark** (measured in `ws-dispatcher.test.ts`):
  - 20 broadcast round-trips over loopback WebSocket connection: avgMs = ~0.1ms, maxMs = ~0.4ms.
- **Physical LAN Validation Target (PERF-VAL-015-01)**:
  - ADR-005 Sec. 11 physical-LAN target (<5ms on dedicated network hardware, 20 concurrent clients) cannot be validated on a local loopback environment.
  - **`PERF-VAL-015-01` remains OPEN and is assigned to `WP-028` (Hardware Integration & LAN QA)**.
  - Software loopback measurements are recorded as regression guards only and are NOT conflated with physical hardware validation.

---

## Security Observations

- No security debt introduced (`Security Debt: None`).
- `KdsWebSocketDispatcher` fails closed: station connections rejected unless authenticated by token callback.
- `EscPosPrinterClient` connects only to authorized host/port registered in `impresoras_red`.
- No sensitive data or credentials transmitted in KDS events or logged.
- Local LAN continuity preserved: zero cloud or external WAN dependencies.

---

## Final Builder Status

**IMPLEMENTED — READY FOR COORDINATOR QUICK INTEGRITY.**

All remediation requirements (R1 recall contract, R2 preparation time persistence and event propagation, R3 ADR-012 scale-4 integer quantity representation, R4 printer queue intermediate status) are fully implemented and covered by automated tests.
