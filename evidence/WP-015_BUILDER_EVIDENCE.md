# WP-015 — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service — Builder Evidence

## WP

`WP-015` — Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service.

## Builder Agent

`16_Native_Edge_Developer` (implementation only — this evidence file is NOT
an independent specialist review, NOT a code review, and does not
self-approve this work).

## Canonical Base SHA

`f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc` — verified via
`git rev-parse origin/main` immediately before branching (unmoved
throughout implementation).

## Implementation Branch

`feat/wp-015-kds-lan-dispatcher-printer-service`, created directly from
`f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc` (verified: this branch's own
parent is `f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`, whose own parents are
`456f75e854d62012af899cd2a467446375e5d65f` and
`1aa8ab9a1bc61dc7198ae02d9ecfc6c207c5fa3a`, matching the known GOV-HYGIENE-015-POST-01
merge topology).

## Changed Files (23 total)

**Modified (7):**
- `package-lock.json` (registers `ws`/`@types/ws` for `@trident/edge`)
- `packages/edge/package.json` (adds `ws` dependency, `@types/ws` devDependency, extends `test:unit` script)
- `packages/edge/src/index.ts` (barrel-exports the new `kds/` subsystem)
- `packages/pos-edge-runtime/package.json` (extends `test` script)
- `packages/pos-edge-runtime/src/index.ts` (barrel-exports new KDS composition modules)
- `packages/pos/package.json` (extends `test` script)
- `packages/pos/src/index.ts` (barrel-exports new KDS domain modules)

**New (16):**
- `packages/pos/src/kds-types.ts` — KDS domain types (`KdsEstacion`, `KdsTicket`, `KdsTicketPartida`, `ImpresoraRed`, event contract)
- `packages/pos/src/kds-ports.ts` — `KdsRepositoryPort`, `PrinterRepositoryPort`, `KdsEventPublisherPort`
- `packages/pos/src/kds-service.ts` — `KdsDomainService` (pure domain logic, FUNCTIONAL_ARCHITECTURE.md Sec. 6.1 contract)
- `packages/pos/src/kds-service.test.ts` — domain unit tests (WP015-T01..T09)
- `packages/edge/src/kds/escpos-formatter.ts` — pure ESC/POS byte formatter
- `packages/edge/src/kds/escpos-formatter.test.ts` — formatter unit tests (WP015-T10..T12)
- `packages/edge/src/kds/escpos-printer-client.ts` — raw TCP ESC/POS printer transport
- `packages/edge/src/kds/escpos-printer-client.test.ts` — printer client unit tests (WP015-T13..T16)
- `packages/edge/src/kds/ws-dispatcher.ts` — `KdsWebSocketDispatcher` (`WS /kds/events`)
- `packages/edge/src/kds/ws-dispatcher.test.ts` — dispatcher unit tests (WP015-T17..T22)
- `packages/edge/src/kds/index.ts` — barrel export for the `kds/` subsystem
- `packages/pos-edge-runtime/src/kds-schema.ts` — SQLite DDL for the 4 WP-015 Data Objects
- `packages/pos-edge-runtime/src/kds-sqlite-repository.ts` — `SqliteKdsRepository` (implements both ports)
- `packages/pos-edge-runtime/src/printer-queue-runner.ts` — `PrinterQueueRunner` (retry/backoff orchestration)
- `packages/pos-edge-runtime/src/kds-runtime.ts` — `createKdsRuntime` composition root
- `packages/pos-edge-runtime/src/kds-runtime.test.ts` — end-to-end integration tests (WP015-T23..T26)

No other file changed. Specifically excluded from this diff and never
staged: `.claude/` and `scripts/dev-pos-server.mjs` (pre-existing local
untracked artifacts, unrelated to WP-015, confirmed absent from every
`git status --short` check performed throughout this work).

## Package Topology (ADR-013 Compliance)

- **`@trident/pos`** (domain, Layer 2): `KdsDomainService` and its ports —
  pure business logic implementing FUNCTIONAL_ARCHITECTURE.md Sec. 6.1's
  `EnviarComandaACocina` / `IniciarPreparacionOrden` /
  `ConfirmarOrdenSurtida` / `ConsultarOrdenesActivas` /
  `RecuperarOrdenRecall` contract. Depends only on `@trident/core`. Never
  imports `@trident/edge` (independently verified by
  `npm run graph:check` — see Architecture-Boundary Validation below).
- **`@trident/edge`** (infrastructure, Layer 3): `KdsWebSocketDispatcher`
  (raw `ws` WebSocket server, per ADR-005 "Servidor WebSocket nativo (ws)
  en el Edge Host"), `EscPosPrinterClient` (raw TCP socket transport), and
  `formatKdsTicketEscPos` (pure byte formatter) — generic device I/O only,
  zero KDS/order business semantics, per ADR-013 §4.2's explicit
  placement of "ESC/POS printer pattern" transport in `@trident/edge`
  (also independently confirmed by WP-016C's own entry, which cites this
  exact pattern).
  - `WP-016C` will reuse `EscPosPrinterClient` for its own card-terminal
    socket I/O per its own `IMPLEMENTATION_PLAN.md` entry
    ("mirrors the existing WP-015 ESC/POS printer pattern").
- **`@trident/pos-edge-runtime`** (composition root, Layer 4):
  `SqliteKdsRepository` (SQLite persistence adapter implementing both
  `@trident/pos` ports), `PrinterQueueRunner` (retry/backoff policy — an
  orchestration concern per ADR-013 Invariant 3, not domain or transport),
  and `createKdsRuntime` (wires everything together: zero business logic
  of its own, matching `createPosFastifyApp`'s established WP-014
  pattern).

ADR-013 §4.2 explicitly lists "KDS LAN" as `@trident/pos` domain scope and
the ESC/POS printer pattern as `@trident/edge` infrastructure scope — this
implementation places code exactly per that assignment.

## KDS WebSocket Implementation

`KdsWebSocketDispatcher` in `@trident/edge`, implementing `WS /kds/events`
per `IMPLEMENTATION_PLAN.md`'s WP-015 APIs/Contracts field and ADR-005:

- Raw `ws` `WebSocketServer` (matches the only existing precedent in this
  codebase, `packages/sync/src/stream-gateway.ts`'s `CloudWebSocketSyncGateway`).
- Fail-closed station authentication: connections are refused unless an
  `authenticateStation` callback is configured AND returns true (ADR-005
  Sec. 9 "Autenticacion mediante token de estacion/dispositivo").
- 5-second heartbeat ping/pong with automatic termination of unresponsive
  clients (ADR-005 Sec. 5.3 "Heartbeats cada 5 segundos").
- Full-state resync frame (`KDS_RESYNC`) sent on every connection via an
  optional `getResyncSnapshot` callback (ADR-005 "resincronizacion
  completa de estado" on reconnect).
- `broadcast()` fans out an already-decided domain event verbatim to every
  connected client — zero business-rule evaluation, zero order-authority
  mutation (WP-015 work order Sec. 8 requirement).
- Connection/disconnection logging via a pluggable `logger` (ADR-005 Sec. 10).

## Event Contract Implemented

`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1's three domain events, emitted by
`KdsDomainService` and transported verbatim by the dispatcher:

- `ComandaEnviadaACocina`
- `OrdenProduccionIniciadaEnKDS`
- `OrdenProduccionConfirmadaEnKDS`

## SQLite Objects (Edge-Local, WP-015 Data Objects)

`kds-schema.ts` defines exactly the 4 Data Objects named in
`IMPLEMENTATION_PLAN.md`'s WP-015 entry: `kds_estaciones`, `kds_tickets`,
`kds_ticket_partidas`, `impresoras_red`. No migration is required (Edge
SQLite, `CREATE TABLE IF NOT EXISTS`, matching WP-014's established
schema-bootstrap pattern via `EdgeDatabaseService.executeSchema`).

Print-queue state (`print_status`, `print_attempts`, `printer_id`,
`last_print_error`) is modeled as columns on `kds_tickets` itself rather
than a separate queue table: `DATA_AUTHORITY_MATRIX.md` has no row for a
distinct "printer queue" entity, and a KDS ticket IS the physical print
job for that comanda — a separate table would create a second source of
truth for the same fact. Conflict policy follows
`DATA_AUTHORITY_MATRIX.md`'s "KDS (Preparacion Cocina/Barra)" row
("Causal Sequence Number", not OCC compare-and-swap) — `kds_tickets` has
no `version` column; writes are append/advance only via
`aggregate_sequence_number`, mirroring the pattern already used by the
pre-existing (unrelated) `kds_ordenes` table and by outbox events
elsewhere in this codebase.

## Printer Transport Implementation

`EscPosPrinterClient` in `@trident/edge`: raw `net.Socket` TCP client,
default port 9100 per the WP-015 spec. Single-attempt transport primitive
(retry policy lives in the composition root, not here, per ADR-013
Invariant 3). Every recoverable failure mode (refused, unreachable,
reset/paper-out, timeout) rejects with a typed `PrinterConnectionError`
carrying a `reason` enum — never throws synchronously, never leaves a
dangling socket or timer (verified by tests WP015-T13..T16).

## ESC/POS Queue & Retry Strategy

`PrinterQueueRunner` in `@trident/pos-edge-runtime` (composition root):

- `runPendingQueueOnce()` attempts every ticket with `printStatus` in
  `PENDING` / `QUEUED` / `FAILED` (under the configurable `maxAttempts`
  cap, default 5).
- On success: marks the ticket `PRINTED`, marks the printer `ONLINE`.
- On failure: marks the ticket `QUEUED` (still eligible for retry) or
  `FAILED` (attempt cap exhausted) with `lastPrintError` recorded, and
  marks the printer `OFFLINE` — **never throws out of the loop for one
  ticket's printer failure**, so one broken printer cannot block any
  other ticket's print attempt or the caller's order flow.
- Printer resolution: explicit `printerId` on the ticket takes priority;
  otherwise falls back to the first printer registered for the ticket's
  KDS estacion.

## Failure Handling (WP-015 Acceptance Criteria: "handles printer offline
state gracefully without crashing order flow; queues unprinted tickets")

Verified directly by tests:

- **Order flow independence**: `enviarComandaACocina` never touches the
  printer/transport layer — a ticket is fully created and dispatched over
  WebSocket regardless of printer state (WP015-T24, WP015-T25).
- **Printer offline/unreachable**: `PrinterConnectionError` with reason
  `REFUSED`; ticket transitions to `QUEUED`, `printAttempts` incremented,
  `lastPrintError` recorded (WP015-T14, WP015-T24).
- **Paper-out / mid-transfer reset**: `PrinterConnectionError` with reason
  `RESET`; ticket queued for retry, and a subsequent successful attempt
  (once the printer "recovers") transitions the ticket to `PRINTED`
  (WP015-T15, WP015-T25).
- **No ticket loss**: at every stage the ticket row remains queryable in
  SQLite with an accurate `printStatus`; nothing is silently discarded.
- **No uncaught exception**: `PrinterQueueRunner.runPendingQueueOnce()`
  never throws for an individual ticket's printer failure (verified: all
  4 integration tests complete without an uncaught rejection even when
  every printer scenario fails).

## LAN Latency Measurement

Measured directly (not fabricated) in `ws-dispatcher.test.ts`
(WP015-T19): 20 broadcast round-trips over a real loopback WebSocket
connection.

```
[WP-015 LAN latency] samples=20 avgMs=0.089-0.177 maxMs=0.361-1.155 (varied slightly across runs)
```

**Test environment**: macOS loopback socket (`127.0.0.1`), Node.js
`v24.20.0`, single process, no network hardware in the path.

**Governance note on the ADR-005 `<5ms` target**: ADR-005 Option B cites
a `<5ms` LAN-dedicated-hardware latency target explicitly marked
"REQUIRES BENCHMARK" — that describes real Wi-Fi/Ethernet hardware
conditions, not a CI loopback socket. Asserting that exact figure in this
environment would either be trivially true for the wrong reason (loopback
is inherently far faster than real LAN hardware) or spuriously flaky
under CI jitter — both would be a fabricated signal, which this evidence
does not report. The measured loopback latency (sub-millisecond to ~1ms)
is recorded honestly above, is well within an order of magnitude below
the ADR-005 target, and the test asserts only a generous 250ms
CI-regression bound to catch gross dispatcher defects. **The ADR-005
Sec. 11 physical-LAN, 20-concurrent-client hardware benchmark is NOT
performed here and remains an OPEN validation item requiring real
network hardware** — this is recorded as an advisory below, not silently
converted into a false PASS.

## Printer Disconnect Test Log

`WP015-T14` (unit, `@trident/edge`): connection to an unassigned port
(no listener) → `PrinterConnectionError` reason `REFUSED`, resolved in
~1-2ms.

`WP015-T24` (integration, `@trident/pos-edge-runtime`): a full KDS ticket
created via `KdsDomainService`, then `PrinterQueueRunner.runPendingQueueOnce()`
against a printer bound to an unreachable port → outcome `FAILED`,
ticket `printStatus` transitions `PENDING` → `QUEUED`, `printAttempts`
becomes `1`, `lastPrintError` populated, printer status becomes
`OFFLINE`. Order flow (`ticket.status === 'PENDIENTE'`) is confirmed
unaffected.

## Paper-Out / Failure Simulation Log

`WP015-T15` (unit): a TCP stub that accepts the connection then issues
`socket.resetAndDestroy()` on receiving data (paper-out/jam signature) →
`PrinterConnectionError` reason `RESET` (or `UNKNOWN` fallback,
platform-dependent), no uncaught exception.

`WP015-T25` (integration): a stub printer resets the FIRST connection
attempt, then accepts normally on the SECOND. First
`runPendingQueueOnce()` pass: outcome `FAILED`, ticket `QUEUED`, 1
attempt recorded. Second pass: outcome `PRINTED`, ticket `printStatus`
becomes `PRINTED`, `printAttempts` becomes `2`, and the recovered
printer stub actually received non-empty ESC/POS bytes (verified via
`Buffer.concat(received).length > 0`).

## Queue Persistence / Restart-Recovery Test Log

`WP015-T26` (integration): a ticket is created and a failed print
attempt recorded (`printStatus: QUEUED`, `printAttempts: 1`) against a
fresh `EdgeDatabaseService` instance backed by a real on-disk SQLite
file. That database connection is then explicitly closed (simulating
process/app restart) and a **second, independent** `EdgeDatabaseService`
instance is opened against the same file path. The queued print job is
confirmed still present, with `printStatus: QUEUED` and
`printAttempts: 1` intact, and still returned by
`listPendingPrintJobs()` — proving the print queue survives a process
restart via ordinary SQLite durability (no in-memory-only state).

## Regression Test Results

All pre-existing canonical suites remain green:

| Package | Tests | Pass | Fail |
|---|---|---|---|
| `@trident/core` | (full suite) | all | 0 |
| `@trident/database` | 260 | 260 | 0 |
| `@trident/edge` (`test:unit`) | 168 | 168 | 0 |
| `@trident/pos` | 18 | 18 | 0 |
| `@trident/pos-edge-runtime` | 21 | 21 | 0 |
| `@trident/sync` | (full suite) | all | 0 |
| `@trident/ui` | 1 | 1 | 0 |
| Root `test:integration` | 1 | 1 | 0 |

**One pre-existing, environment-caused failure, unrelated to WP-015**:
`@trident/edge`'s `test:electron` step (`npm run test:electron`, invoked
by `npm run test` after `test:unit`) fails in this sandbox with
`SyntaxError: The requested module 'electron' does not provide an export
named 'BrowserWindow'` when attempting to run the actual Electron binary.
**Independently reproduced identically on unmodified canonical `main`**
(`f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`, via `git stash` before
re-running `node scripts/run-electron-tests.mjs`) — this is a pre-existing
sandbox/environment limitation (this environment cannot run a full
Electron main-process binary), not a regression introduced by this WP.
`@trident/edge`'s own `test:unit` script (168 tests, run independently of
Electron) is unaffected and fully green.

## Build / Lint / Typecheck

- **Build**: `npm run build` (root, `turbo run build`) — 7/7 packages
  successful.
- **Typecheck**: `npm run typecheck` (root) — 10/10 tasks successful
  (build+typecheck per package).
- **Lint**: `npm run lint` (root) — 7/7 tasks successful, 0 errors. Two
  ESLint errors and one set of unused imports introduced during
  development (`prefer-const` on `escpos-printer-client.ts`'s
  `connectTimer`, unused `before`/`after` imports in
  `escpos-printer-client.test.ts`) were found and fixed before freeze.
  Remaining warnings (`@typescript-eslint/no-explicit-any`) exist only in
  pre-existing, untouched files (`outbox.test.ts` in both `@trident/edge`
  and `@trident/database`, `stream.test.ts` in `@trident/sync`,
  `ingested-idempotency-engine.ts` in `@trident/database`) — none
  introduced by WP-015.
- **Unit tests**: see Regression Test Results above; 26 new WP-015 tests
  (WP015-T01 through WP015-T26) all pass.

## Architecture-Boundary Validation

`npm run graph:check` (root) — `node scripts/check-graph.mjs && node
--test scripts/check-graph.test.mjs` — **PASSED**, 44/44 internal graph
tests pass. Specifically confirmed:

- `@trident/pos -> @trident/core` only (no `@trident/edge` import from
  `@trident/pos` — the forbidden `pos -> edge` domain-to-infrastructure
  relation is independently enforced and still correctly fails in the
  checker's own negative test matrix).
- `@trident/pos-edge-runtime -> @trident/core`, `-> @trident/pos`,
  `-> @trident/edge` — all three explicitly listed as `PASS` in the
  Required Graph Test Matrix.
- No circular dependencies detected in the runtime graph.
- All test/dev manifest dependency boundary rules satisfied.

## Security Observations

- No new avoidable security debt introduced, consistent with WP-015's
  declared `Security Debt: None`.
- `KdsWebSocketDispatcher` fails closed: a connection is refused unless
  an explicit station authenticator is configured and accepts it (no
  silent "allow all" default).
- `EscPosPrinterClient` connects only to a host/port explicitly supplied
  by the caller (from the `impresoras_red` table via the composition
  root) — no arbitrary remote host is accepted from untrusted input in
  this implementation.
- No secrets are transmitted in WebSocket payloads (payloads are ticket
  data only) and none are logged.
- No existing station/Edge trust boundary is bypassed or weakened.
- No WAN dependency is introduced into local KDS/order continuity — the
  dispatcher and printer client operate purely over local sockets.
- No existing security control was disabled to make any test pass.

## Product Owner Decisions

`WP-015`'s own `PO Dependency` field is `None`. No protected Product
Owner decision was read, inferred, resolved, or modified by this
implementation. `PRODUCT_DECISIONS.md` and `OPEN_QUESTIONS.md` are not
among the changed files (confirmed via `git status --short`). All 9
global protected Product Owner questions remain exactly as they were
before this WP (unrelated to this diff).

## Unresolved Implementation Advisories (Non-Blocking)

1. **ADR-005 Sec. 11 physical-LAN benchmark not performed.** The
   `<5ms`-on-dedicated-hardware target and the 20-concurrent-client
   saturation test require real Wi-Fi/Ethernet network hardware not
   available in this development/CI environment. The loopback
   measurement recorded above is a regression guard only, not a
   substitute. Tracked as an open validation item for eventual
   hardware-based QA, consistent with how WP-014's own local benchmark
   (`WP014-T12`) already flags its target-hardware validation
   (`SEC-VAL-08`) as separately OPEN.
2. **`kds_ordenes` (pre-existing, unrelated table) not reconciled.**
   `DATA_MODEL.md` Sec. 3 already defines an unrelated, never-wired
   `kds_ordenes` table (simpler shape, no relation to WP-015's four named
   Data Objects) predating this WP. This implementation does not touch,
   migrate, or supersede it, since WP-015's Frozen Requirements name only
   `kds_estaciones` / `kds_tickets` / `kds_ticket_partidas` /
   `impresoras_red`. Flagged for future architecture review to avoid two
   overlapping KDS order representations, but out of this WP's authorized
   scope to resolve unilaterally.
3. **`DATA_MODEL.md` / `DATA_DICTIONARY.md` do not yet document the four
   WP-015 Data Objects' column-level DDL.** This candidate defines their
   schema (`kds-schema.ts`) following established repository conventions
   (TEXT PRIMARY KEY UUIDs, `status TEXT NOT NULL` with enum comment,
   `created_at`/`updated_at` ISO timestamps), but canonical `DATA_MODEL.md`
   itself is out of this WP's authorized file scope to amend.

## Blockers

**0.**

## Final Builder Status

**IMPLEMENTED — READY FOR COORDINATOR QUICK INTEGRITY.**

All WP-015 canonical scope (LAN WebSocket dispatcher, ESC/POS printer
service with queue/retry, Edge SQLite persistence for the 4 named Data
Objects) is implemented, tested (26 new tests, all passing), and
integrated per ADR-013's package topology with zero architecture-boundary
violations. All pre-existing regression suites remain green except one
pre-existing, independently-reproduced-on-clean-`main`, environment-only
Electron sandbox limitation unrelated to this WP. Zero blockers. Three
non-blocking advisories recorded above for future governance attention.
This evidence file does not itself constitute independent review, code
review, or any authorization to merge, start another Work Package, or
close any protected Product Owner decision.
