# WP-015 — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service — Canonical Remediation R2 Builder Evidence

## WP

`WP-015` — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service (Canonical Remediation R2 under ACR-2026-016).

## Builder Agent

`16_Native_Edge_Developer` (implementation only — this evidence file is NOT an independent specialist review, NOT a code review, and does not self-approve this work).

## Canonical Base SHA

`eb6cef40e39248bb9d4d688482cb0393dcc79510` — verified via `git rev-parse origin/main` (unmoved throughout implementation).

## R1 Frozen Subject SHA

`71a01545c807837583acdf26fea2acaa230c55f6` — immutable baseline for R2 remediation.

## Implementation Branch

`feat/wp-015-kds-canonical-remediation-r2`, created directly from `71a01545c807837583acdf26fea2acaa230c55f6`.

## Changed Files (25 total in main -> R2 diff)

**Modified (7):**
- `package-lock.json` (registers `ws`/`@types/ws` for `@trident/edge`)
- `packages/edge/package.json` (adds `ws` dependency, `@types/ws` devDependency, extends `test:unit` script)
- `packages/edge/src/index.ts` (barrel-exports the new `kds/` subsystem)
- `packages/pos-edge-runtime/package.json` (extends `test` script)
- `packages/pos-edge-runtime/src/index.ts` (barrel-exports new KDS composition modules)
- `packages/pos/package.json` (extends `test` script)
- `packages/pos/src/index.ts` (barrel-exports new KDS domain modules and wire mappers)

**New (18):**
- `evidence/WP-015_CANONICAL_REMEDIATION_BUILDER_EVIDENCE.md` — this single builder evidence artifact (renamed from R1)
- `packages/pos/src/kds-types.ts` — KDS domain types (`KdsTicketPartida.quantity: bigint`, wire DTOs, discriminated `KdsDomainEvent` types)
- `packages/pos/src/kds-ports.ts` — `KdsRepositoryPort`, `PrinterRepositoryPort` (including `getTicketForRecall`, `recoverInterruptedPrintingJobs`), `KdsEventPublisherPort`
- `packages/pos/src/kds-service.ts` — `KdsDomainService` (pure domain logic: `enviarComandaACocina`, `iniciarPreparacionOrden`, `confirmarOrdenSurtida`, `consultarOrdenesActivas`, `recuperarOrdenRecall` with preparation time & ADR-012 bigint quantity rules)
- `packages/pos/src/kds-wire-mapper.ts` — Wire DTO mappers (`mapKdsTicketToWire`, `mapKdsTicketPartidaToWire`, `parseComandaWireItem`)
- `packages/pos/src/kds-service.test.ts` — domain unit tests (WP015-T01..T09, WP015-R1-01..R1-05, WP015-R2-01..R2-02, WP015-R3-01..R3-02)
- `packages/edge/src/kds/escpos-formatter.ts` — pure ESC/POS byte formatter
- `packages/edge/src/kds/escpos-formatter.test.ts` — formatter unit tests (WP015-T10..T12)
- `packages/edge/src/kds/escpos-printer-client.ts` — raw TCP ESC/POS printer transport
- `packages/edge/src/kds/escpos-printer-client.test.ts` — printer client unit tests (WP015-T13..T16)
- `packages/edge/src/kds/ws-dispatcher.ts` — `KdsWebSocketDispatcher` (`WS /kds/events`)
- `packages/edge/src/kds/ws-dispatcher.test.ts` — dispatcher unit tests (WP015-T17..T22)
- `packages/edge/src/kds/index.ts` — barrel export for the `kds/` subsystem
- `packages/pos-edge-runtime/src/kds-schema.ts` — SQLite DDL for the 4 WP-015 Data Objects (`preparation_time_minutes` column, scale-4 `quantity INTEGER`)
- `packages/pos-edge-runtime/src/kds-sqlite-repository.ts` — `SqliteKdsRepository` (implements both ports, SQLite scale-4 integer storage, recall retrieval, preparation time persistence, `recoverInterruptedPrintingJobs()`)
- `packages/pos-edge-runtime/src/printer-queue-runner.ts` — `PrinterQueueRunner` (retry/backoff orchestration with durable PRINTING attempt increment and quantity formatting)
- `packages/pos-edge-runtime/src/kds-runtime.ts` — `createKdsRuntime` composition root (full canonical event propagation with wire mapping)
- `packages/pos-edge-runtime/src/kds-runtime.test.ts` — end-to-end integration tests (WP015-T23..T30)

**Governing Documentation Integrity:**
Zero governing documentation or architecture files were modified. `ARCHITECTURE_CHANGE_REQUEST_KDS_CONTRACT_DATA_RECONCILIATION.md`, `FUNCTIONAL_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `DATA_AUTHORITY_MATRIX.md`, `ADR/ADR-005-local-lan-communication-protocol.md`, `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md`, `SOLUTION_ARCHITECTURE.md`, `SECURITY_ARCHITECTURE.md`, `PRODUCT_DECISIONS.md`, and `OPEN_QUESTIONS.md` are strictly READ-ONLY.

Excluded from git staging: `.claude/` and `scripts/dev-pos-server.mjs` (untracked local development artifacts).

---

## Canonical Remediation R2 Resolution Summary

### 1. QI-R2-015-01: Quantity Domain Type & Representation (ADR-012)
- **Authoritative Domain Model (`@trident/pos`)**:
  - `KdsTicketPartida.quantity`: strictly `bigint` (scale 4, e.g., `15000n` for `1.5000`, `1250n` for `0.1250`, `123456n` for `12.3456`).
  - `EnviarComandaItemInput.quantity`: strictly `bigint`.
  - Zero JavaScript `Number()` or `parseFloat()` coercion in authoritative domain calculations and persistence.
- **SQLite Persistence (`@trident/pos-edge-runtime`)**:
  - `kds_ticket_partidas.quantity INTEGER NOT NULL`.
  - Stored by binding `bigint` directly via `executeMutation` and loaded safely via `queryRowsSafe` / `BigInt(row.quantity)` without `Number()` coercion.
- **Wire / Transport DTOs (`kds-wire-mapper.ts`)**:
  - `mapKdsTicketToWire(ticket)` converts `bigint` to canonical 4-decimal strings (e.g. `"1.5000"`) for WebSocket broadcast and resync snapshots.
  - `parseComandaWireItem` converts incoming canonical decimal strings to `bigint` at the transport boundary before domain ingestion.
- **Automated Tests**:
  - `WP015-R3-01`: Unit test verifying `1.5000 -> 15000n`, `0.1250 -> 1250n`, `12.3456 -> 123456n`, and wire serialization back to exact 4-decimal strings.
  - `WP015-R3-02`: Unit test rejecting non-bigint, zero, or negative quantities.
  - `WP015-T23`: Integration test verifying SQLite integer storage and round-trip domain `bigint` retrieval.

### 2. QI-R2-015-02: Interrupted PRINTING Recovery & Durability
- **Durable Attempt Recording**:
  - In `PrinterQueueRunner.#attemptPrint()`, when transitioning from `PENDING/QUEUED` to `PRINTING`, `print_attempts` is incremented and persisted durably to SQLite BEFORE network I/O starts.
- **Fail-Safe Startup Recovery**:
  - `SqliteKdsRepository.recoverInterruptedPrintingJobs()` executes automatically on repository bootstrap / runtime startup.
  - Any persisted ticket with `print_status = 'PRINTING'` is transitioned to `print_status = 'QUEUED'` with `last_print_error = 'RECOVERED_AFTER_RESTART_DURING_PRINTING'`.
  - Interrupted jobs are never marked `PRINTED` without transport acknowledgement, preserving retry eligibility without ticket loss.
- **Automated Tests**:
  - `WP015-T26`: Restart recovery of `FAILED` jobs.
  - `WP015-T29`: Real SQLite restart test for interrupted `PRINTING` jobs recovering to `QUEUED`, verifying attempt count preservation, error message, and inclusion in `listPendingPrintJobs()`.

### 3. QI-R2-015-03: Confirmation Event Transport & Wire Mapping
- **Discriminated Domain Events**:
  - `OrdenProduccionConfirmadaEnKDS` explicitly requires `ordenProduccionId: string`, `completedAt: string`, `tiempoPreparacionMinutos: number`, and `ticket: KdsTicket`.
- **WebSocket Event Mapping**:
  - `createKdsRuntime()` event publisher broadcasts explicit canonical payload for `OrdenProduccionConfirmadaEnKDS` containing `ordenProduccionId`, `completedAt`, `tiempoPreparacionMinutos`, and `ticket` mapped to wire DTO (`KdsTicketWireDto`).
  - Prevents `bigint` from entering `JSON.stringify` while ensuring all event fields are delivered verbatim over `WS /kds/events`.
- **Automated Tests**:
  - `WP015-T04`: Domain event emission lifecycle.
  - `WP015-T30`: End-to-end WebSocket integration test receiving and asserting `OrdenProduccionConfirmadaEnKDS` with exact fields `ordenProduccionId`, `completedAt`, `tiempoPreparacionMinutos`, and wire string quantities.

---

## Test Execution Results

### Unit & Integration Suite Summary

| Package | Test Target | Tests | Pass | Fail | Notes |
|---|---|---|---|---|---|
| `@trident/pos` | `src/kds-service.test.ts`, dining tests | 27 | 27 | 0 | Pure domain logic, bigint quantity, & ADR-012 tests |
| `@trident/edge` | `test:unit` (escpos, ws-dispatcher, outbox) | 168 | 168 | 0 | Unit & loopback transport tests |
| `@trident/pos-edge-runtime` | `kds-runtime.test.ts`, dining tests | 25 | 25 | 0 | Edge SQLite, printing recovery, & WS integration |
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

## Final Builder Status

**IMPLEMENTED — R2 FROZEN SUBJECT CANDIDATE READY FOR COORDINATOR QUICK INTEGRITY.**

All three R2 blockers (`QI-R2-015-01`, `QI-R2-015-02`, `QI-R2-015-03`) are fully resolved and covered by automated tests.
