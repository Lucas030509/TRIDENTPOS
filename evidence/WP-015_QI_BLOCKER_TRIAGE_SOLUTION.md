# WP-015 — Quick Integrity Blocker Triage (Solution Architect)

## Role / Independence Declaration

I am acting as a fresh, independent instance of `01_Solution_Architect` under
EAAF v1.2.0. I did not author the WP-015 implementation under review, did not
author the Coordinator Quick Integrity (QI) pass that raised the 5 blockers
and 2 evidence advisories triaged below, and did not author the Builder
evidence file. Every finding below was independently re-derived from the
actual canonical document text and the actual frozen source code — quoted
verbatim where load-bearing — not from trusting the Coordinator's or
Builder's characterizations. Where I disagree with either party's framing,
that disagreement is called out explicitly.

This document is a **triage only**: it specifies what the correct
remediation should be. It does not implement any fix, does not modify the
Frozen Subject or any product code, does not create a PR, does not merge
anything, does not start another Work Package, and does not resolve any
Product Owner decision. It is also explicitly **not** the later mandatory
full independent Specialist Review of the eventual remediated candidate —
that is a separate, future task.

**Pinned Framework:** EAAF v1.2.0 @ `7e036f43240b3dc28ccb996e350263598275b2cd`
(external pin, not vendored in this repository, not touched by this triage).

**Frozen Subject:** `21f99d901c0b19a99d1a18bcec780055822805e8`
(branch `feat/wp-015-kds-lan-dispatcher-printer-service`), verified by direct
inspection (`git log -1 --format="%H %P"`) to be a single-parent child of
canonical `main` `f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`.

**This review's own branch:** `review/wp-015-qi-blocker-triage-solution`,
created directly from the Frozen Subject
(`git checkout -b review/wp-015-qi-blocker-triage-solution 21f99d901c0b19a99d1a18bcec780055822805e8`),
verified before adding this commit to have tip
`21f99d901c0b19a99d1a18bcec780055822805e8` with parent
`f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`.

---

## QI-BLK-015-01 — Recall Contract Mismatch

### Canonical text (verbatim, `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1)

```
### 6.1 Contrato TRIDENTPOS ↔ KDS (Restaurant Operations)
...
- **Consultas Funcionales:**
  - `ConsultarOrdenesActivas(kdsEstacionId)`
  - `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)`
```

### Frozen implementation (verbatim)

`packages/pos/src/kds-service.ts`:
```ts
/**
 * `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)`
 */
public recuperarOrdenRecall(
  kdsEstacionId: string,
  ventanaMaxMinutos: number = 120,
): readonly KdsTicket[] {
  return this.#kdsRepo.listTicketsForRecall(kdsEstacionId, ventanaMaxMinutos);
}
```

`packages/pos/src/kds-ports.ts`:
```ts
listTicketsForRecall(kdsEstacionId: string, windowMinutes: number): readonly KdsTicket[];
```

`packages/pos-edge-runtime/src/kds-sqlite-repository.ts` implements this as a
station-scoped `WHERE kds_estacion_id = ? AND created_at >= ?` list query.

### Independent confirmation

**CONFIRMED.** The JSDoc comment directly above the method even quotes the
correct canonical signature (`ordenProduccionId, ventanaMaxMinutos = 120`)
while the actual parameter list and body implement a completely different
contract: first positional argument is `kdsEstacionId` (a station), not
`ordenProduccionId` (a specific production order), and the return type is a
station-wide list (`readonly KdsTicket[]`) rather than a lookup of one
order. This is not a naming quibble — the parameter's *identity* changes:
"give me back this one order" becomes "give me every order at this
station created recently."

### Reasoning from the canonical text itself (not invented)

`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1 uses a naming convention that is
internally consistent and diagnostic here:
- `ConsultarOrdenesActivas(kdsEstacionId)` — plural **"Ordenes"** (orders),
  parameterized by station — correctly implemented as a station-wide list
  (this part of the frozen code is NOT in question).
- `RecuperarOrdenRecall(ordenProduccionId, ...)` — singular **"Orden"**
  (order), parameterized by the order's own id.

The singular/plural distinction in the same section, applied consistently
to the two queries, is strong internal evidence that `RecuperarOrdenRecall`
is meant to retrieve **one already-known production order** (the caller
already has `ordenProduccionId` — e.g. from a receipt or an audit trail —
and wants to know if/what it was), not to enumerate a station's history.

### Required remediation (exact)

1. **Service signature** (`packages/pos/src/kds-service.ts`):
   ```ts
   public recuperarOrdenRecall(
     ordenProduccionId: string,
     ventanaMaxMinutos: number = 120,
   ): KdsTicket | null
   ```
2. **Repository port** (`packages/pos/src/kds-ports.ts`): remove
   `listTicketsForRecall(kdsEstacionId, windowMinutes)` and replace it with
   an id-keyed lookup consistent with the port's existing
   `getTicketById(id: string): KdsTicket | null` pattern, e.g.:
   ```ts
   getTicketForRecall(ordenProduccionId: string, windowMinutes: number): KdsTicket | null;
   ```
   (Implementation may either reuse `getTicketById` plus a domain-layer
   window check, keeping the window-comparison business rule in
   `@trident/pos` rather than the SQL adapter, or push the window predicate
   into the SQL adapter for efficiency — either is an acceptable Builder
   implementation choice; the port's *shape* — one id in, one ticket-or-null
   out — is the part that is not discretionary.)
3. **Return shape:** a single `KdsTicket`, or `null` if the order does not
   exist or falls outside the recall window. A "recall miss" is a routine,
   expected outcome (order too old, wrong id, never existed) — modeling it
   as `null` rather than a thrown `DomainError` is consistent with how the
   same file already treats other pure lookups (`getTicketById`), and
   recall is a read/query operation per Sec. 6.1's own "Consultas
   Funcionales" heading, not a command that mutates state.
4. **Recall-window semantics:** "recall" in a KDS domain conventionally
   means retrieving an order that has already left the active production
   board (i.e., has a `completedAt`) so staff can review or reprint it
   after the fact. Recommend filtering on `completedAt IS NOT NULL AND
   (now - completedAt) <= ventanaMaxMinutos` — i.e., `null` is returned both
   when the ticket is unknown and when it has not yet been completed or the
   window has elapsed. This is my architectural inference from domain
   convention and the existing `completedAt` column already present on
   `kds_tickets`; `FUNCTIONAL_ARCHITECTURE.md` does not spell out the exact
   window anchor point (`completedAt` vs. `createdAt`) in prose, so a
   Builder implementing this should record the choice explicitly in the
   remediation evidence rather than leaving it implicit, in case a future
   reviewer disagrees with the anchor point.
5. **Tests required** (new/replacing existing `kds-service.test.ts`
   coverage that currently exercises `listTicketsForRecall`):
   - Recall of an existing, completed ticket within the window → returns
     that exact ticket.
   - Recall of a ticket completed outside the window → returns `null`.
   - Recall of a ticket that exists but has not yet reached `LISTO`/has no
     `completedAt` → returns `null`.
   - Recall of a nonexistent `ordenProduccionId` → returns `null`.
   - Port-level test confirming the lookup is keyed by ticket id, not by
     `kdsEstacionId` (i.e., a regression test that would have caught this
     exact mismatch).
   - Removal/update of any existing test or mock referencing
     `listTicketsForRecall`.

**SSOT ambiguity note:** The signature mismatch itself is unambiguous. The
only genuinely underspecified detail is the exact recall-window anchor
(`completedAt` vs. some other timestamp) and whether a miss should be
`null` vs. a thrown 404-style `DomainError` — both are narrow, low-risk
implementation choices that do not require a new architecture artifact to
resolve; a Builder can pick a reasonable default (as recommended above) and
document it.

---

## QI-BLK-015-02 — Preparation Time Discarded

### Canonical text (verbatim)

`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1:
```
- `ConfirmarOrdenSurtida(ordenProduccionId, kdsEstacionId, tiempoPreparacionMinutos)`
...
- `OrdenProduccionConfirmadaEnKDS` *(Hito operacional formal de confirmación de producción)*
```

### Frozen implementation (verbatim)

`packages/pos/src/kds-service.ts`:
```ts
public confirmarOrdenSurtida(
  kdsTicketId: string,
  kdsEstacionId: string,
  _tiempoPreparacionMinutos: number,
): KdsTicket {
  ...
  const updated: KdsTicket = {
    ...ticket,
    status: 'LISTO',
    partidas: ticket.partidas.map((p) => ({ ...p, status: 'LISTO' })),
    completedAt: now,
    updatedAt: now,
  };
  const saved = this.#kdsRepo.saveTicket(updated);
  this.#emit('OrdenProduccionConfirmadaEnKDS', saved);
  return saved;
}
```

### Independent confirmation

**CONFIRMED.** The parameter is received (so the *arity* of the functional
command is satisfied), renamed with the TypeScript "intentionally unused"
underscore convention, and never read again in the method body. It is not
persisted (no column for it exists — see below), not included in the
emitted event (the event payload is `{ type, kdsEstacionId, ticket,
emittedAt }`, and `KdsTicket` has no preparation-time field), and not used
in any validation branch.

### Where could it be persisted? — independent check of every plausible target

- `kds_tickets` (WP-015, frozen schema, `packages/pos-edge-runtime/src/kds-schema.ts`):
  no `tiempo_preparacion` / `prep_time` / equivalent column.
- `kds_ordenes` (pre-existing, `DATA_MODEL.md` Sec. 3): no such column
  either (`id, cuenta_id, mesa_reference, urgency_level, status,
  aggregate_sequence_number, created_at, completed_at`).
- `DATA_DICTIONARY.md`: no KDS-specific entry for a preparation-time field
  at all (grepped for `kds` — zero preparation-time-related rows).
- `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.2 (`TRIDENTPOS ↔ Inventory`, the one
  documented downstream consumer of `OrdenProduccionConfirmadaEnKDS`)
  enumerates its consumed parameters explicitly: `organizacionId,
  sucursalId, centroConsumoId, ordenId, fechaHora, items[]`. This list does
  **not** include `tiempoPreparacionMinutos` — so at minimum, Inventory
  does not need it forwarded to it. This does not rule out Analytics (Sec.
  5 describes Analytics as consolidating "indicadores" — a per-station
  average-prep-time KPI would be a completely standard use for exactly
  this value) needing it, but no document says so explicitly.

### Disposition: **ARCHITECTURE CLARIFICATION REQUIRED**

I cannot definitively determine, from the current SSOT, whether
`tiempoPreparacionMinutos` should be (a) persisted as a new column on
`kds_tickets`, (b) included in the `OrdenProduccionConfirmadaEnKDS` event
payload for a downstream consumer (most plausibly Analytics, though this is
not named anywhere), or (c) validation-only (e.g., must be a positive
integer, with no storage/propagation intent). All three readings are
consistent with the bare functional signature; none is confirmed or
excluded by `DATA_MODEL.md`, `DATA_DICTIONARY.md`, or
`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1/6.2. The "Hito operacional formal de
confirmación de producción" annotation on the event tells me this
confirmation is meant to be a formally significant milestone — which
argues against silently discarding a parameter the functional contract
explicitly requires the caller to supply — but it does not tell me *where*
the value should land.

**Minimum architecture artifact required before a Builder can remediate
this:** a `DATA_MODEL.md` column addition on `kds_tickets` (Expand
migration, e.g. `tiempo_preparacion_minutos INTEGER NULL`) **and/or** a
`FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1/6.2 or `IMPLEMENTATION_PLAN.md`
WP-015 Acceptance-Criteria amendment stating explicitly whether the value
is persisted, event-propagated, or validation-only, authored/authorized by
`03_Data_Architect` (data model changes) and/or `01_Solution_Architect`
(functional contract clarification). Until that artifact exists, my
recommendation to a future Builder is the narrowest defensible default:
persist the value on `kds_tickets` (it is directly analogous to
`completed_at`, already a column on the same row) and include it in the
`OrdenProduccionConfirmadaEnKDS` event payload — but this is advisory, not
authorized, and should not be implemented as a silent Builder judgment call
the way the frozen candidate silently discarded it.

This is counted as an **architecture blocker** in the final tally below.

---

## QI-BLK-015-04 — KDS Data Authority Collision

### Canonical text

`DATA_MODEL.md` Sec. 3 (Edge SQLite Logical Schema), verbatim:
```sql
-- Órdenes y Comandas de KDS (Cocina / Barra)
CREATE TABLE kds_ordenes (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL,
    mesa_reference TEXT NOT NULL,
    urgency_level TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL, -- PENDIENTE, EN_PREPARACION, LISTO, ENTREGADO
    aggregate_sequence_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT NULL
);
```

`IMPLEMENTATION_PLAN.md` WP-015 entry: `Data Objects: SQLite kds_estaciones,
kds_tickets, kds_ticket_partidas, impresoras_red`.

Frozen `kds_tickets` schema (`packages/pos-edge-runtime/src/kds-schema.ts`):
`id, cuenta_id, mesa_reference, kds_estacion_id, urgency_level, status
(PENDIENTE/EN_PREPARACION/LISTO/ENTREGADO), print_status, print_attempts,
printer_id, last_print_error, aggregate_sequence_number, created_at,
updated_at, completed_at`.

### Independent structural analysis

The two tables are **not** merely "in the same domain area" — they share:
- Identical status vocabulary: `PENDIENTE, EN_PREPARACION, LISTO,
  ENTREGADO` (verbatim, same four values, same order, in both
  `DATA_MODEL.md`'s inline comment and `kds-types.ts`'s `KdsTicketStatus`
  union).
- Identical core columns: `cuenta_id`, `mesa_reference`, `urgency_level`,
  `aggregate_sequence_number`, `created_at`, `completed_at`.
- `kds_tickets` is a strict superset of `kds_ordenes`'s columns plus
  station-routing (`kds_estacion_id`) and print-queue fields
  (`print_status`, `print_attempts`, `printer_id`, `last_print_error`,
  `updated_at`).

This is far closer to "the same aggregate, evolved" than "two unrelated
concepts that happen to share a subject area." The Builder evidence file's
own characterization —
> "an unrelated, never-wired `kds_ordenes` table (simpler shape, no
> relation to WP-015's four named Data Objects)"

asserts "no relation" without citing any canonical text for that claim,
and my independent column-level comparison above directly contradicts it.
"Never-wired" is true (see below); "unrelated" is not adequately proven and
I do not accept it as-is.

### Is `kds_ordenes` authoritative for anything currently?

I checked the actual frozen and canonical-main source trees, not just the
documents:
```
git grep -n "kds_ordenes" 21f99d901c0b19a99d1a18bcec780055822805e8 -- '*.ts' '*.sql' '*.js'   → no matches
git grep -n "kds_ordenes" f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc -- '*.ts' '*.sql' '*.js'   → no matches
```
**Zero runtime code anywhere in this repository creates, reads, or writes
`kds_ordenes`.** It exists exclusively as a `CREATE TABLE` statement inside
`DATA_MODEL.md`'s documentation. It is therefore not authoritative for
anything *today* in the running system — there is no live second writer to
reconcile, no data to migrate, and no concurrent-mutation risk right now.

Separately, and independently of WP-015: **no Work Package entry in
`IMPLEMENTATION_PLAN.md` lists `kds_ordenes` in its `Data Objects` field.**
I grepped every `Data Objects:` line in the document; `kds_ordenes` appears
nowhere. `WP-014`'s own Data Objects line (`SQLite mesas, cuentas,
cuenta_items, cuenta_item_modificadores...`) — the WP whose other tables
sit immediately adjacent to `kds_ordenes` in the same DDL block — does
**not** claim it either. This table is an orphan in `IMPLEMENTATION_PLAN.md`
regardless of WP-015: it is canonically defined but has no WP-assigned
owner at all, which is itself a pre-existing SSOT gap this triage did not
create.

Symmetrically, WP-015's own four Data Objects (`kds_estaciones`,
`kds_tickets`, `kds_ticket_partidas`, `impresoras_red`) do **not** appear
anywhere in `DATA_MODEL.md` either (grepped, zero matches beyond
`kds_ordenes`). So the two canonical documents are mutually out of sync in
both directions: `DATA_MODEL.md` documents a table no WP owns, and
`IMPLEMENTATION_PLAN.md` assigns WP-015 tables that `DATA_MODEL.md` does
not yet document.

`DATA_AUTHORITY_MATRIX.md`'s "KDS (Preparación Cocina/Barra)" row (Edge
SQLite / Edge Host Local / Edge TRIDENTPOS, conflict policy "Causal
Sequence Number") names the *bounded-context-level* authority but does not
name a specific physical table, so it is compatible with either table (or
both, or neither in its current unwired state) and does not, by itself,
resolve the collision.

### Recommended disposition (advisory — not a unilateral architecture change)

1. **Not currently a live second-source-of-truth risk**, because
   `kds_ordenes` has zero implementation footprint anywhere in the
   codebase — there is no concurrent writer to reconcile today.
2. **It is a confirmed documentation-integrity defect**: an orphaned,
   unowned canonical table whose shape strongly overlaps the concept
   WP-015 independently (re)implemented as `kds_tickets`. The Builder's
   "unrelated" framing is not adequately substantiated and should not be
   carried forward into remediation evidence as settled fact.
3. **Going forward, `kds_tickets` (WP-015) should be treated as the sole
   owner of KDS production-order state** — it is the actively-used,
   WP-owned, code-wired table with the fuller column set (station
   routing + print queue) needed for real KDS operation. `kds_ordenes`
   should not be independently wired up by any future WP without first
   reconciling it against `kds_tickets`.
4. **No runtime migration/compatibility work is required for WP-015 to
   proceed** (no data exists in `kds_ordenes` to migrate). What is
   required, as a tracked follow-up, is a `03_Data_Architect`-authorized
   `DATA_MODEL.md` correction — either removing `kds_ordenes` and
   documenting `kds_tickets`/`kds_estaciones`/`kds_ticket_partidas`/
   `impresoras_red` in its place, or explicitly annotating `kds_ordenes`
   as `SUPERSEDED BY kds_tickets (WP-015)` / historical-only, so a future
   reader does not attempt to wire it up as if it were still live. This is
   a narrow, low-risk documentation correction (zero code depends on
   `kds_ordenes`), not a redesign of WP-015's implementation.
5. **Open question I cannot close unilaterally:** why `kds_ordenes` was
   added to `DATA_MODEL.md` in the first place (an earlier draft of the
   same concept later superseded by the WP-015 work order's four-table
   design? a placeholder never cleaned up?) is not discoverable from the
   documents available to this triage. I am flagging this as an open
   provenance question for `03_Data_Architect`, not resolving it.

I do **not** count this as a blocker to WP-015's own remediation path
(WP-015's four tables are additive and internally self-consistent); it is
counted as a tracked documentation follow-up, separate from the
architecture-blocker tally below.

---

## QI-BLK-015-05 — ADR-005 Physical-LAN Validation

### Canonical text (verbatim, `ADR-005`)

```
**Status:** `ACCEPTED WITH VALIDATION REQUIRED`
...
- *Pros:* Entrega instantánea de comandas a KDS (*LATENCY TARGET: < 5 ms en
  LAN dedicada — REQUIRES BENCHMARK*), canal persistente y mínimo overhead.
...
## 11. Validation / Evidence Required
- Pruebas de latencia y saturación con 20 clientes WebSocket conectados
  concurrentemente en red local.
```

### Independent verification of what was actually measured

I read the actual test file, not just the evidence file's summary
(`packages/edge/src/kds/ws-dispatcher.test.ts`):

- `WP015-T17`: single client, single broadcast — functional correctness
  only, no timing.
- `WP015-T18` ("multi-client broadcast test"): **5** clients
  (`clientCount = 5`), verifies exactly-once delivery / no duplication —
  **does not measure latency at all**.
- `WP015-T19` ("LAN latency test"): **a single client**, 20 sequential
  broadcast round-trips over `127.0.0.1` loopback, asserting
  `maxMs < 250` as a CI-regression guard. This is the test that produced
  the `avgMs=0.089-0.177` figures.

So, independently of the Coordinator's framing: there is no single test
that combines "5 concurrent clients" with "measured latency" — the QI
blocker's "5-client fan-out" description conflates two separate tests
(T18's 5-client correctness check and T19's 1-client latency check). The
underlying substance of the blocker is nonetheless accurate: **nothing in
this test suite approaches ADR-005 Sec. 11's actual requirement — 20
concurrent clients, on physical (non-loopback) LAN hardware.** All
measurements here are loopback, single-process, zero network hardware in
the path.

The Builder evidence file itself is candid about this (verbatim):
> "The ADR-005 Sec. 11 physical-LAN, 20-concurrent-client hardware
> benchmark is NOT performed here and remains an OPEN validation item
> requiring real network hardware — this is recorded as an advisory below,
> not silently converted into a false PASS."

I independently confirmed the evidence file's own body **never** contains
the literal string "LAN Latency Test: PASS" nor a bare, unqualified
"Regression Tests: PASS" (`grep -n "PASS\|Regression Tests\|LAN Latency
Test"` against the frozen evidence file returns only the two internal
`graph:check` PASS mentions and the phrase "converted into a false PASS").
If a separate, out-of-repository "final report" line used that
unqualified wording (as this triage's brief states), that discrepancy is
between the evidence file and that external artifact, not internal to the
evidence file itself — but the governance risk (a future reader
misreading the loopback number as a physical-LAN PASS) is real regardless
of which artifact said it, since the *evidence file's own* WP-015
`IMPLEMENTATION_PLAN.md` entry still lists `Security Debt: None` (see
below), which is the actual canonical place this should be tracked and
currently is not.

### Governance precedent already established in this repository

This is not a novel situation. `IMPLEMENTATION_PLAN.md`'s
`SEC-VAL-*` debt table already handles structurally identical
"requires-real-hardware-not-available-in-dev/CI" cases by deferring them
to `WP-028: Hardware Benchmarking & Release Packaging` (Wave 9), with the
originating WP doing the software-only verification it can do now:

- `SEC-VAL-03` (Trust Bootstrap & Rogue Edge Resistance): "Software
  verification in `WP-009`; physical LAN rogue hardware and multicast
  validation in `WP-028`."
- `SEC-VAL-08` (Argon2id hardware benchmark): `WP-010` → `WP-028`.
- `DAT-04` (SQLite power-loss durability on SSD): `WP-008` → `WP-028`.

`SEC-VAL-03` in particular is directly analogous: it is *also* a
physical-LAN, real-network-hardware validation requirement that could not
be satisfied in a dev/CI sandbox, and the established, already-approved
governance pattern for exactly this situation is (B) — formally tracked
debt, deferred to `WP-028`, not a hard block on the originating WP's
implementation-review progression.

### Disposition: **FORMALLY DEFERRED**

Following this repository's own established precedent, ADR-005 Sec. 11's
physical-LAN validation should be **(B) formally deferred**, not (A) a
blocker to WP-015 progressing beyond implementation review — provided it
is actually recorded as tracked debt, which it currently is **not**:
WP-015's own `IMPLEMENTATION_PLAN.md` entry states `Security Debt: None`
(line 675), which is inconsistent with the SEC-VAL-03/08 /DAT-04 pattern
and is itself a defect this triage identifies.

**Exact corrective action required:**
1. Amend WP-015's `IMPLEMENTATION_PLAN.md` `Security Debt` field from
   `None` to a new tracked id. The next unused `SEC-VAL-*` id in this
   document, by inspection, is **`SEC-VAL-12`** (existing ids run
   `SEC-VAL-01` through `SEC-VAL-11`) — I am recommending this id, not
   assigning it; the actual `IMPLEMENTATION_PLAN.md` edit is out of this
   triage's scope and requires the appropriate authoring role.
2. Add a `SEC-VAL-12` row to the debt table (Sec. "Security Debt Ledger" /
   wherever `SEC-VAL-03` etc. are tabulated) worded on the `SEC-VAL-03`
   template: *"ADR-005 Sec. 11 Physical-LAN WebSocket Validation | Software
   verification (loopback CI regression guard) in `WP-015`; physical-LAN,
   20-concurrent-client hardware saturation and `<5ms` latency benchmark in
   `WP-028`."*
3. **Exact acceptance criterion that remains OPEN:** ADR-005 Sec. 11 —
   latency and saturation testing with 20 concurrent WebSocket clients on
   real (physical, non-loopback) local network hardware, confirming the
   `<5ms`-on-dedicated-LAN-hardware target.
4. **Exact wording to prevent misreading**, for any future evidence file
   or status line describing this measurement:
   > "LAN Latency (Loopback CI Regression Guard): PASS — avg 0.089–0.177ms,
   > max <1.2ms, single WebSocket client, 20 sequential round-trips,
   > `127.0.0.1`, zero network hardware in path. **This is NOT the ADR-005
   > Sec. 11 physical-LAN validation** (20 concurrent clients on real LAN
   > hardware), which remains OPEN and is tracked as `SEC-VAL-12`, owned by
   > `WP-028`."
   Any wording that says simply "LAN Latency Test: PASS" without that
   qualification is a governance defect regardless of which document it
   appears in, because it invites exactly the misreading ADR-005's own
   "ACCEPTED WITH VALIDATION REQUIRED" status was designed to prevent.

---

## Evidence Advisory 015-A — Changed File Count

### Independent verification

```
git diff --name-only f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc 21f99d901c0b19a99d1a18bcec780055822805e8 | wc -l
→ 24
```
The actual diff touches 24 files. The evidence file's own heading reads
"Changed Files (23 total)" and its itemized breakdown (7 modified + 16 new
= 23) does not include `evidence/WP-015_BUILDER_EVIDENCE.md` itself, which
is the 24th file in the actual diff. **CONFIRMED**: this is exactly a
self-exclusion artifact (the evidence file cannot trivially count itself
while being written), not a fabrication of the underlying changes — the 23
files it does list are accurately described.

### Exact corrected wording for a future evidence file

A future WP-015 remediation evidence file should state the total inclusive
of itself, e.g.:
> "Changed Files (25 total): 7 modified, 17 new (16 implementation files +
> this evidence file)."
(Counts illustrative — the future remediation will change the exact
modified/new split; the structural fix is: **the tally must include the
evidence file itself**, stated explicitly, e.g. "(N total, including this
evidence file)" rather than silently omitting it.)

---

## Evidence Advisory 015-B — "Regression Tests: PASS" Overclaim Risk

### Independent verification of the underlying facts

From the frozen evidence file's own "Regression Test Results" section and
my own reading of it:
- All directly-invoked package test scripts (`@trident/core`,
  `@trident/database` 260/260, `@trident/edge test:unit` 168/168,
  `@trident/pos` 18/18, `@trident/pos-edge-runtime` 21/21, `@trident/sync`,
  `@trident/ui` 1/1, root `test:integration` 1/1) are reported green.
- Separately, `@trident/edge`'s `npm run test` invokes `test:unit` **then**
  `test:electron`; `test:electron` genuinely fails in this environment
  with `SyntaxError: The requested module 'electron' does not provide an
  export named 'BrowserWindow'`.
- The evidence file states this failure was independently reproduced
  identically on unmodified canonical `main` (via `git stash` before
  re-running `node scripts/run-electron-tests.mjs`), supporting the claim
  that it is a pre-existing, environment-only limitation (this sandbox
  cannot run a full Electron main-process binary) and not a WP-015
  regression.
- WP-015's own new test suite: 26/26 (`WP015-T01`–`WP015-T26`) passing.

These facts, taken together, are accurate and were not fabricated. The
risk is purely one of **compression**: a bare "Regression Tests: PASS"
(wherever such a line appears) erases the distinction between "the
canonical full-suite command's actual exit status" (fail, for an
unrelated reason) and "did this WP break anything" (no).

### Exact corrected wording for a future evidence file

A future evidence file must never write a bare "Regression Tests: PASS."
It should instead separate the four facts explicitly, e.g.:
> "Regression Tests: NO REGRESSION INTRODUCED BY WP-015. Canonical command
> `npm run test:electron` (invoked by `@trident/edge`'s `npm run test`)
> FAILS in this environment (`SyntaxError: ... 'electron' does not provide
> an export named 'BrowserWindow'`) — a pre-existing, environment-only
> limitation, independently reproduced identically on unmodified canonical
> `main`; not caused by this WP. All directly-run unit/integration suites
> unaffected by that limitation are green (`@trident/edge test:unit`
> 168/168, `@trident/database` 260/260, ... ). WP-015's own new test suite:
> 26/26 (`WP015-T01`–`WP015-T26`) PASS."

---

## Final Answers

- `QI-BLK-015-01 Recall contract: CONFIRMED`
  `Required remediation: Change KdsDomainService.recuperarOrdenRecall to (ordenProduccionId: string, ventanaMaxMinutos: number = 120): KdsTicket | null; replace KdsRepositoryPort.listTicketsForRecall(kdsEstacionId, windowMinutes) with an id-keyed lookup (e.g. getTicketForRecall(ordenProduccionId, windowMinutes): KdsTicket | null), returning null when the ticket does not exist, has not been completed, or falls outside the recall window (recommended anchor: completedAt); add tests for hit/miss/uncompleted/nonexistent/id-not-station-keyed cases.`

- `QI-BLK-015-02 Preparation time: ARCHITECTURE CLARIFICATION REQUIRED — artifact needed: a DATA_MODEL.md column addition on kds_tickets (Expand migration) and/or a FUNCTIONAL_ARCHITECTURE.md Sec. 6.1/6.2 or IMPLEMENTATION_PLAN.md WP-015 Acceptance-Criteria amendment stating explicitly whether tiempoPreparacionMinutos is persisted, propagated in the OrdenProduccionConfirmadaEnKDS event payload, or validation-only, authorized by 03_Data_Architect and/or 01_Solution_Architect. Advisory default pending that authorization: persist on kds_tickets and include in the event payload.`

- `QI-BLK-015-04 KDS authority: kds_ordenes has zero runtime code footprint anywhere in the repository (verified via git grep on both the Frozen Subject and canonical main) and is not claimed as a Data Object by any WP in IMPLEMENTATION_PLAN.md (including WP-014, its closest neighbor) — it is not currently a live second-source-of-truth risk, but its column shape substantially overlaps kds_tickets (identical status vocabulary and core fields), contradicting the Builder evidence's unsubstantiated "unrelated" characterization. Recommended disposition: kds_tickets (WP-015) should be treated as the sole going-forward owner of KDS production-order state; kds_ordenes should be marked SUPERSEDED/historical-only or removed from DATA_MODEL.md via a 03_Data_Architect-authorized documentation correction (no code migration needed, since no data or code depends on kds_ordenes today). This is a tracked documentation follow-up, not a blocker to WP-015's own remediation path.`

- `QI-BLK-015-05 ADR-005 physical LAN validation: FORMALLY DEFERRED` — future gate: `WP-028: Hardware Benchmarking & Release Packaging` (Wave 9), following the exact precedent of SEC-VAL-03/SEC-VAL-08/DAT-04 (software verification in the originating WP, physical-hardware validation in WP-028). Condition: WP-015's `IMPLEMENTATION_PLAN.md` `Security Debt` field must be corrected from `None` to a new tracked id (recommended: `SEC-VAL-12`) explicitly naming ADR-005 Sec. 11 as the OPEN acceptance criterion owned by WP-028, and any evidence/status wording describing the loopback measurement must carry the explicit non-substitution qualification specified above.

- `Evidence Advisory A: A future WP-015 remediation evidence file's "Changed Files" heading must state the total inclusive of the evidence file itself (e.g., "(N total, including this evidence file)"), not omit it from its own tally as the frozen evidence file did (23 stated vs. 24 actual, per git diff --name-only).`

- `Evidence Advisory B: A future evidence file must never state a bare "Regression Tests: PASS." It must separate: (1) whether WP-015 introduced a regression (no), (2) the canonical full-suite command's actual result (npm run test:electron fails, SyntaxError re: BrowserWindow export), (3) that this is a pre-existing, environment-only limitation independently reproduced on unmodified canonical main, and (4) the WP-specific suite's own result (26/26 WP015-T01–T26 pass, plus all directly-run unit suites green).`

- `Architecture blockers remaining: 1` (QI-BLK-015-02 only; QI-BLK-015-01 and QI-BLK-015-05 are fully specified code/governance-process fixes needing no new architecture artifact, and QI-BLK-015-04's needed action is a narrow, zero-code-impact documentation correction rather than a blocking architecture change to WP-015 itself.)

- `Verdict: ARCHITECTURE CHANGE REQUIRED` — specifically for QI-BLK-015-02 (preparation-time persistence/propagation target), which cannot be remediated by a Builder without a prior DATA_MODEL.md and/or FUNCTIONAL_ARCHITECTURE.md/IMPLEMENTATION_PLAN.md amendment authorized by 03_Data_Architect and/or 01_Solution_Architect. All other blockers and both advisories are REMEDIATION SPECIFIED in full above and can proceed without further architecture authorization (QI-BLK-015-04's DATA_MODEL.md documentation correction is recommended but does not block WP-015's own remediation).
