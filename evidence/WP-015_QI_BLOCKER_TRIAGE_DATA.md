# WP-015 QUICK INTEGRITY BLOCKER TRIAGE — DATA ARCHITECTURE DISPOSITION

## 0. Role, Independence & Scope Declaration

**Role:** `03_Data_Architect`, fresh independent instance. I did not author the WP-015
implementation under review, and this triage was produced with no coordination with,
and no reliance on, any parallel `01_Solution_Architect` review of the same subject.
All findings below were re-derived directly from the actual canonical text and the
actual frozen code, read by this instance in this task, not from the Coordinator's
Quick Integrity summary or from any other reviewer's conclusions.

**Framework (pinned, external, not vendored, untouched):** EAAF v1.2.0 @
`7e036f43240b3dc28ccb996e350263598275b2cd`

**Frozen Subject under triage:** `21f99d901c0b19a99d1a18bcec780055822805e8`
(branch `feat/wp-015-kds-lan-dispatcher-printer-service`), verified direct single-parent
child of canonical `main` `f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`
(`git log -1 --format="%H %P" 21f99d901c0b19a99d1a18bcec780055822805e8` →
`21f99d901c0b19a99d1a18bcec780055822805e8 f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`).

**Scope constraint honored:** this is a triage of what remediation *should* be. No
implementation file, ADR, DATA_MODEL.md, DATA_AUTHORITY_MATRIX.md, or any other
canonical document was modified by this review. No Work Package was started or
resolved. No Product Owner decision was touched. Nothing was migrated or deleted.

---

## 1. A Governance-Hygiene Predicate That Both Blockers Depend On

Before triaging the two blockers, an independent verification was required: **is
`ADR-012` actually canonical and binding, or is it still, as its own file header
literally states, `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`?**
This matters because both blockers below turn on ADR-012 being authoritative.

Reading `ADR/ADR-012-edge-exact-fixed-point-monetary-representation.md` directly:

> **Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`
> **Date:** 2026-09-13

Reading `DATA_MODEL.md`'s own document header directly:

> **Version:** `1.1 PROPOSED OVERLAY — ACR-2026-013` (Underlying baseline: `1.0
> APPROVED / FROZEN — 2026-09-01` with ACR-2026-011 Canonical Overlay — G9)
> **Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`

Taken at face value, both documents claim to be non-canonical proposals. However,
reading `IMPLEMENTATION_PLAN.md`'s own header (also canonical `main`) directly:

> **ACR-2026-013 MERGED / CANONICAL ON MAIN**
> Amendment under `ACR-2026-013`: Harmonization of Edge exact fixed-point signed
> integer storage (`INTEGER` scale 4, `ADR-012`) and monorepo package composition
> topology (`ADR-013`) for WP-014 ... and WP-017 ... Merged to canonical `main`:
> Exact Numerics & Bounded-Context Composition Model at
> `dceb4cf90fb75c7b32c90a86a616a341a5288ba3`; Package Dependency Graph Enforcement
> at `38062575ceed063c8f03af5a5c473d140dd264df`. *(Corrected by `ACR-2026-015`
> Canonical Amendment R1 — CA-QI-015-24: this banner previously and incorrectly
> stated `PROPOSED / PENDING GOVERNANCE APPROVAL`, which was factually stale by
> the time this candidate was prepared.)*
>
> **Version:** `1.3 MERGED / CANONICAL ON MAIN — ACR-2026-015` ... (`ACR-2026-013`,
> `ACR-2026-014`, and `ACR-2026-015` overlays are all `MERGED / CANONICAL ON MAIN`)

And confirmed independently by the physical DDL: `DATA_MODEL.md` Sec. 3's own
`cuenta_items` table is *already* declared with `INTEGER` columns
(`unit_price_applied INTEGER NOT NULL, -- Cents4 (ADR-012)`, `quantity INTEGER NOT
NULL, -- Escala 4 (ADR-012, ej. 1.0000 = 10000)`), not the `REAL` that the
"proposed, pending" status would imply if it were truly unmerged. WP-014 itself
(frozen, already-implemented, cited by this very task as the correct reference
pattern) implements exactly this `INTEGER`/`bigint` scheme, and `WP-014`'s own
`IMPLEMENTATION_PLAN.md` entry cites `ADR-012` as one of its **Frozen Requirements**
(not a pending proposal).

**Finding:** `ADR-012` and `DATA_MODEL.md`'s Edge-SQLite fixed-point rule are
**substantively canonical and binding** — `IMPLEMENTATION_PLAN.md` explicitly
records `ACR-2026-013` (the ACR that produced `ADR-012`) as `MERGED / CANONICAL ON
MAIN`, the DDL content already reflects it, and WP-014 was built and frozen against
it as a Frozen Requirement. The `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE
APPROVAL` banners still sitting at the top of `ADR-012` and `DATA_MODEL.md`
themselves are **stale governance metadata** that the `ACR-2026-015` canonicalization
pass corrected in `IMPLEMENTATION_PLAN.md` but did not go back and correct in
`ADR-012` or `DATA_MODEL.md`. I flag this explicitly as a **documentation-hygiene
defect in canonical SSOT** (self-contradictory status metadata across
`ADR-012`/`DATA_MODEL.md` vs. `IMPLEMENTATION_PLAN.md`) — it does not, on its own,
invalidate ADR-012's substantive authority, because a corroborating canonical
document (`IMPLEMENTATION_PLAN.md`) and the already-frozen WP-014 implementation
both independently confirm the rule is live and binding. But it should be corrected
(update the two stale status banners) as a low-cost governance hygiene fix,
independent of and prior to any WP-015 remediation.

This predicate holds for both blockers below: I treat ADR-012 as binding canonical
law for the purposes of this triage.

---

## 2. QI-BLK-015-03 — Edge Quantity Representation Violates Fixed-Point Rule

### 2.1 Independent confirmation of the violation

`ADR-012` §4.1, quoted directly:

> Todos los valores numéricos monetarios, tasas impositivas y cantidades
> fraccionarias persistidos en Edge SQLite se almacenan como `INTEGER` con escala
> fija de **4 decimales** (factor de escala $S = 10,000$)... Queda **terminantemente
> prohibido** el uso de `REAL`, `FLOAT` o números flotantes de JavaScript en
> cualquier esquema, consulta o payload de base de datos Edge.

`ADR-012` §4.2 table, quoted directly, explicitly includes quantities as a governed
concept (not just money):

> | **Cantidades Fraccionarias** (`quantity`, insumos/recetas) | 4 | $10,000$ |
> `DECIMAL(12,4)` | `"1.0000"` | `10000` |

`ADR-012` §4.4, quoted directly, defines the exact per-layer representation:

> Se define una representación autoritativa por capa:
> - **SQLite:** `signed INTEGER` escala 4.
> - **Dominio TypeScript:** `bigint` escala 4.
> - **Transporte API y Sincronización:** `STRING` decimal canónico con exactamente
>   4 dígitos fraccionarios (ej. `"150.5000"`).

WP-014's own already-frozen, already-correct implementation of this exact rule for
its own `quantity` field, confirmed by direct read of canonical `main`:

- `DATA_MODEL.md` Sec. 3: `quantity INTEGER NOT NULL, -- Escala 4 (ADR-012, ej.
  1.0000 = 10000)` on `cuenta_items`.
- `packages/pos/src/types.ts:38`: `readonly quantity: bigint; // Scale 4 (e.g.
  1.0000 = 10000n)` on the `CuentaItem` domain type.
- `packages/pos-edge-runtime/src/dining-sqlite-repository.ts`: reads bind
  `quantity: BigInt(itemRow.quantity)` from the `INTEGER` column back to `bigint`,
  and writes bind the raw `bigint` directly to the `INTEGER` column.
- `packages/pos-edge-runtime/src/fastify-app.ts`: the **composition-root Fastify
  route handlers** convert at the HTTP boundary — `decimalStringToScaledBigInt`
  parses inbound JSON string fields (including `quantity`) into `bigint` before
  calling the domain service, and `scaledBigIntToDecimalString` serializes `bigint`
  fields (including `item.quantity`) back into canonical 4-decimal strings before
  writing the JSON response.
- `packages/core/src/money.ts`: the exact, already-existing, reusable
  `scaledBigIntToDecimalString(scaled: bigint): string` and
  `decimalStringToScaledBigInt(str: string): bigint` primitives that implement
  ADR-012 §4.4's lexical, float-free conversion rule.

Now, the frozen WP-015 subject, confirmed by direct read of commit
`21f99d901c0b19a99d1a18bcec780055822805e8`:

- `packages/pos-edge-runtime/src/kds-schema.ts`:
  `CREATE TABLE IF NOT EXISTS kds_ticket_partidas ( ... quantity TEXT NOT NULL, ...
  )` — the **physical SQLite storage type is `TEXT`**, in direct violation of
  ADR-012 §4.1/§4.4's mandatory `signed INTEGER` scale-4 physical representation.
- `packages/pos/src/kds-types.ts`: `readonly quantity: string; // canonical
  4-decimal string` on `KdsTicketPartida`, and `quantity: string` on the
  `EnviarComandaInput` items — the **domain type is a plain string**, in direct
  violation of ADR-012 §4.4's mandatory `bigint` domain representation. The file's
  own header comment even says *"All quantities are canonical scale-4 decimal
  strings (transport-safe, ADR-012 convention)"* — this conflates the ADR-012
  **transport-layer** representation with the required **domain and physical
  storage** representations, which ADR-012 explicitly separates into three
  distinct layers.
- `packages/pos-edge-runtime/src/kds-sqlite-repository.ts`: `KdsTicketPartidaRow`
  declares `quantity: string`; the repository reads/writes this string verbatim
  to/from the `TEXT` column with **zero conversion** — there is no
  `decimalStringToScaledBigInt`/`scaledBigIntToDecimalString` call anywhere in this
  file for `quantity`. The transport-layer string is persisted directly as the
  physical storage representation, which is exactly the failure mode ADR-012 §4.4
  exists to prevent (collapsing the three-layer boundary into one).

**Confirmed independently: this is a genuine, unambiguous deviation from the
canonical fixed-point rule.** It is not merely a style inconsistency — it
reintroduces exactly the two things ADR-012 was created to eliminate: (a) a
persisted representation that requires string-based lexical/alphabetic comparison
and cannot use `SUM()`/`MIN()`/`MAX()` integer aggregate semantics safely per
ADR-012 §3 Option D.4, and (b) domain-layer arithmetic (any future comparison,
sorting, or aggregation of `KdsTicketPartida.quantity`, e.g. total item count on a
ticket) that would have to either re-parse the string every time or fall back to
`Number()`/`parseFloat()`, both expressly and "terminantemente" prohibited by
ADR-012 §4.4.2 for authoritative financial/quantity conversions.

I searched for an approved architecture/data amendment authorizing a KDS-specific
exception to this rule (a KDS-specific ADR, ACR, or DATA_MODEL.md/DATA_DICTIONARY.md
override). **None exists.** `DATA_DICTIONARY.md` contains zero entries for any of
the four WP-015 tables (`kds_estaciones`, `kds_tickets`, `kds_ticket_partidas`,
`impresoras_red`) — confirmed by direct grep, the only KDS-adjacent hits in that
file are unrelated `station_type`/`audit_log_events.source` enum-value mentions of
the literal substring "KDS". `DATA_MODEL.md` Sec. 3 likewise contains no DDL at all
for any of the four WP-015 tables — the Builder's own evidence file
(`evidence/WP-015_BUILDER_EVIDENCE.md`, at the frozen commit) admits this directly:
*"`DATA_MODEL.md` / `DATA_DICTIONARY.md` do not yet document the four WP-015 Data
Objects' column-level DDL... canonical `DATA_MODEL.md` itself is out of this WP's
authorized file scope to amend."* So there is no canonical DDL text for
`kds_ticket_partidas` to point to at all, approved or otherwise — the Builder
authored the physical schema unilaterally, and in doing so, deviated from the
*general* (not KDS-specific) fixed-point rule that ADR-012 §4.2 states applies to
**all** "Cantidades Fraccionarias," with no domain carve-out. **No exception exists.
Say so plainly: this must be corrected, not grandfathered.**

### 2.2 Exact required correction

**(a) Correct SQLite physical column type.** `kds_ticket_partidas.quantity` must be
declared `INTEGER NOT NULL` — identical storage discipline to
`cuenta_items.quantity`:

```sql
CREATE TABLE IF NOT EXISTS kds_ticket_partidas (
    id TEXT PRIMARY KEY,
    kds_ticket_id TEXT NOT NULL REFERENCES kds_tickets(id),
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    quantity INTEGER NOT NULL, -- Escala 4 (ADR-012, ej. 1.0000 = 10000)
    comments TEXT NULL,
    modifiers_snapshot TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

**(b) Correct TypeScript domain representation.** `KdsTicketPartida.quantity` (and
the corresponding `EnviarComandaInput.items[].quantity`) must be typed `bigint`,
matching `CuentaItem.quantity: bigint` in `packages/pos/src/types.ts:38`:

```typescript
export interface KdsTicketPartida {
  ...
  readonly quantity: bigint; // Scale 4 (e.g. 1.0000 = 10000n)
  ...
}
```

**(c) Correct transport/API representation.** Because `KdsTicketPartida` crosses
both the local Fastify REST boundary (if/when a KDS REST endpoint accepts item
quantities) and the `WS /kds/events` WebSocket boundary (`KdsDomainEvent.ticket`
carries the full `KdsTicket` including its `partidas`, per
`packages/pos/src/kds-types.ts`), the JSON payload representation must be the same
canonical fixed 4-decimal string ADR-012 §4.4.3 mandates for "todos los payloads
JSON externos de APIs (Fastify REST, WebSockets)" — i.e. exactly the same
`decimalStringToScaledBigInt`/`scaledBigIntToDecimalString` pair from
`@trident/core` that WP-014's `fastify-app.ts` already uses for `cuenta_items`
fields. No new conversion primitive should be built; the existing one must be
reused.

**(d) Exact location of the conversion boundary.** Per ADR-013's bounded-context
topology (pure business domains vs. technical infrastructure adapters vs.
application composition roots) and the pattern WP-014 already establishes:
- The **domain package** (`packages/pos/src/kds-types.ts`, `kds-service.ts`-style
  domain logic) must exclusively use `bigint` — it never sees a decimal string.
- The **repository adapter** (`packages/pos-edge-runtime/src/kds-sqlite-repository.ts`)
  must exclusively use `bigint` ↔ `INTEGER` binding — `BigInt(row.quantity)` on
  read (matching `dining-sqlite-repository.ts`'s existing pattern for
  `cuenta_items.quantity`), and direct `bigint` binding on write (SQLite's
  `better-sqlite3`-style driver accepts `bigint` for `INTEGER` columns natively,
  exactly as the existing `cuenta_items`/`turnos_caja` code already does).
- The **composition-root route/dispatcher handler** (wherever WP-015's WebSocket
  dispatcher or any future KDS REST route assembles the outbound JSON payload —
  the WP-015 equivalent of `fastify-app.ts`) is the **only** place
  `decimalStringToScaledBigInt`/`scaledBigIntToDecimalString` should be called, on
  the way in and out of the wire boundary — exactly mirroring where WP-014's
  `fastify-app.ts` already performs this conversion for `cuenta_items` fields
  (lines converting `unitPriceApplied`, `quantity`, `taxRateApplied`, etc.).
  Business-rule-free transport code (the KDS WebSocket dispatcher, described in
  `kds-types.ts`'s own header comment as having "no business-rule ownership") must
  still perform this float-free lexical conversion, because it is a transport
  serialization concern, not a business rule.

**(e) Required new/changed tests.** An exact-bigint-roundtrip test analogous to
WP-014's own `packages/pos-edge-runtime/src/index.test.ts:538`
(`WP014-T13: QI-014-02: Exact SQLite BigInt write/read roundtrip without Number
coercion (> MAX_SAFE_INTEGER)`) is required for `kds_ticket_partidas.quantity`:
persist a `quantity` value exceeding `Number.MAX_SAFE_INTEGER` (e.g.
`9007199254740993n`) through the KDS repository, read it back, and assert exact
`bigint` equality with zero `Number()` coercion anywhere in the round trip. In
addition: (i) a unit test that a `KdsDomainEvent` broadcast over `WS /kds/events`
serializes `quantity` as a canonical 4-decimal string (regex
`/^-?\d+\.\d{4}$/`) and not a raw bigint/number; (ii) a unit test that the
composition-root boundary rejects a malformed incoming quantity string via
`decimalStringToScaledBigInt`'s existing strict-regex validation (reusing
`@trident/core`'s own test vectors, no new validation logic needed); (iii) a
migration/regression test confirming no `REAL` affinity leaks into
`kds_ticket_partidas.quantity` (SQLite type-affinity check, mirroring how WP-014's
suite already guards against `REAL` reappearing).

**Disposition:** This blocker is **fully specifiable as a straightforward
conformance fix** — it requires no new architecture decision, because ADR-012
already governs this exact case generally, WP-014 already demonstrates the correct
pattern end-to-end, and `@trident/core` already ships the required conversion
primitives. It needs an implementation-level correction, not a canonical amendment.

---

## 3. QI-BLK-015-04 — KDS Data Authority Collision (Data-Authority Angle Only)

*(Explicitly answering the data-authority question only — not the functional/
contract question, which is the parallel Solution Architect's angle and is not
relied upon or referenced here.)*

### 3.1 Column-by-column comparison

`DATA_MODEL.md` Sec. 3, `kds_ordenes` (pre-existing table), quoted directly:

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

Frozen WP-015 `kds_tickets` (`packages/pos-edge-runtime/src/kds-schema.ts` at
`21f99d901c0b19a99d1a18bcec780055822805e8`), quoted directly:

```sql
CREATE TABLE IF NOT EXISTS kds_tickets (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT NOT NULL,
    mesa_reference TEXT NOT NULL,
    kds_estacion_id TEXT NOT NULL REFERENCES kds_estaciones(id),
    urgency_level TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL,
    print_status TEXT NOT NULL DEFAULT 'PENDING',
    print_attempts INTEGER NOT NULL DEFAULT 0,
    printer_id TEXT NULL REFERENCES impresoras_red(id),
    last_print_error TEXT NULL,
    aggregate_sequence_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NULL
);
```

**Direct column overlap:** `id`, `cuenta_id`, `mesa_reference`, `urgency_level`,
`status` (identical enum domain: `PENDIENTE, EN_PREPARACION, LISTO, ENTREGADO` —
`kds_ordenes`'s DDL comment states this enum explicitly; `kds_tickets`'s
`KdsTicketStatus` TypeScript union in `packages/pos/src/kds-types.ts` is the
byte-identical set `'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO'`),
`aggregate_sequence_number`, `created_at`, `completed_at` — **7 of `kds_ordenes`'s
8 columns are reproduced verbatim in `kds_tickets`** (only `id` differs in row
identity, trivially). `kds_tickets` additionally carries `kds_estacion_id`,
`print_status`, `print_attempts`, `printer_id`, `last_print_error`, `updated_at` —
all genuinely new print/station-routing concerns WP-015 introduces.

**Finding: these are not disjoint entities.** They represent the identical
real-world fact — the state of a kitchen production order/ticket for a given
`cuenta` — with the identical status lifecycle, the identical causal-ordering
mechanism, and the identical linkage back to `cuenta_id`/`mesa_reference`.
`kds_tickets` is best characterized as a *superset* of `kds_ordenes` (all of
`kds_ordenes`'s fields plus print/station fields), not a genuinely different
concept. This is corroborated by the frozen implementation's own code comment in
`kds-schema.ts`:

> Conflict policy per `DATA_AUTHORITY_MATRIX.md` ("KDS (Preparacion Cocina/
> Barra)" row): Causal Sequence Number, not OCC compare-and-swap -- writes are
> append/advance only, so no `version` column is required on `kds_tickets`
> (unlike mesas/cuentas).

— i.e., the Builder itself invoked the *same single* `DATA_AUTHORITY_MATRIX.md`
"KDS" row to justify `kds_tickets`'s conflict policy that would equally justify
`kds_ordenes`'s conflict policy, treating them as one authority concern while
building two physical tables for it.

### 3.2 What `DATA_AUTHORITY_MATRIX.md` actually says

`DATA_AUTHORITY_MATRIX.md` Sec. 1, the KDS row, quoted directly (full row, exact
column headers):

> | Agregado / Entidad | Topología | Authoritative Source (SoR) | Writable Node |
> Read Replica | Dirección de Sync | Política de Conflicto | Autoridad de
> Reconciliación |
> | **KDS (Preparación Cocina/Barra)** | 1. Full Suite | Edge SQLite | Edge Host
> Local | Cloud (Analytics) | Edge → Cloud (Outbox) | Causal Sequence Number |
> Edge TRIDENTPOS |

This row is **entity-level and generic** — it says "Edge SQLite" as the SoR, not
a named physical table. It does **not** name `kds_ordenes`, does **not** name
`kds_tickets`, and does **not** describe any relationship, ownership split, or
reconciliation rule between two physical tables. It predates WP-015: this document
carries `Status: APPROVED / FROZEN — 2026-09-01`, and the only KDS table that
existed in the canonical `DATA_MODEL.md` as of that baseline date was
`kds_ordenes` (WP-015, dated after `ADR-012`'s 2026-09-13, did not exist yet). The
strong inference is that this row was originally scoped around `kds_ordenes` as
the sole KDS production-order entity, since it was the only one in existence when
the row was authored and frozen — but the matrix text itself does not say this
explicitly, so I state it as an inference, not a canonical fact.

**Does the matrix's KDS row match `kds_ordenes`, `kds_tickets`, both, or neither?**
Textually, it matches **both equally** (or, more precisely, matches neither by
specific name — it is silent on which physical table is meant), because it never
names a table. Substantively, given the causal-sequence-number conflict policy and
"Edge Host Local" writable-node semantics, it fits `kds_ordenes`'s pre-existing
shape and `kds_tickets`'s new shape equally well, since `kds_tickets` was built as
an almost-exact superset. **Canonical SSOT does not disambiguate this. It is
silent, and I say so explicitly rather than resolving it unilaterally.**

`DATA_DICTIONARY.md` is silent as well: it contains **zero column-level entries**
for `kds_ordenes`, `kds_tickets`, `kds_ticket_partidas`, `kds_estaciones`, or
`impresoras_red` (confirmed by direct grep — the only "KDS" substring hits in that
file are unrelated `stations.station_type` and `audit_log_events.source` enum
values).

### 3.3 Second-Source-of-Truth risk assessment

**Yes, there is a genuine Second-Source-of-Truth risk, specifically for KDS
production state.** Both `kds_ordenes` and `kds_tickets` are independently
writable Edge SQLite tables that can each hold a `status` value
(`PENDIENTE`/`EN_PREPARACION`/`LISTO`/`ENTREGADO`) and an
`aggregate_sequence_number` for the *same* `cuenta_id`. Nothing in the frozen
implementation or canonical documents establishes:
- which table (if either) is written first, or whether both are meant to be
  written for the same production event;
- whether `kds_ordenes` is meant to be superseded/retired now that `kds_tickets`
  exists, versus deliberately left as a legacy/unused table;
- a foreign-key or any other structural link between the two tables (there is
  none — `kds_tickets` does not reference `kds_ordenes.id` anywhere, and vice
  versa);
- which table, if any, is the one the `DATA_AUTHORITY_MATRIX.md` "Cloud
  (Analytics)" read replica / "Edge → Cloud (Outbox)" sync direction is meant to
  be sourced from — a Cloud analytics consumer following the matrix's own row
  literally would not know which Edge table is authoritative.

The Builder's own evidence file (`evidence/WP-015_BUILDER_EVIDENCE.md`, read at
the frozen commit) is internally inconsistent on exactly this point — it labels
`kds_ordenes` "pre-existing, unrelated" in the same sentence set where it also
writes: *"Flagged for future architecture review to avoid two overlapping KDS
order representations"* — i.e., the Builder's own text simultaneously asserts
non-relation and flags an overlap risk. That internal tension in the Builder's own
evidence corroborates, rather than resolves, the finding of genuine collision
risk; it is not proof of disjointness.

### 3.4 Reconciliation vs. migration

Coexistence of `kds_ordenes` and `kds_tickets` would require an **explicit**
reconciliation rule — e.g., "`kds_ordenes` is deprecated/unused and slated for
removal, `kds_tickets` is the sole authority going forward" or "`kds_ordenes` is a
coarser per-`cuenta` aggregate header and `kds_tickets` is a finer
per-`kds_estacion`-routed sub-ticket, in a documented one-to-many parent/child
relationship." **Neither rule is stated anywhere in canonical SSOT.** I decline to
invent one myself: a plausible reconciliation (the parent/child split by
`kds_estacion_id`) is *conceivable* given `kds_ordenes` lacks a station reference
and `kds_tickets` has one, but this is speculation on my part, not a documented
architecture decision, and per this task's own instruction I will not resolve it
unilaterally. Genuine consolidation (retire `kds_ordenes`, or formally define the
parent/child split, or rename/migrate) requires a canonical `DATA_MODEL.md` +
`DATA_AUTHORITY_MATRIX.md` amendment (an ACR, analogous in process to how
`ACR-2026-013` resolved the WP-014 monetary-representation pre-flight conflict) —
it is not a call `03_Data_Architect` triage can make unilaterally, and it is not a
mechanical conformance fix the way QI-BLK-015-03 is.

**Disposition:** This blocker **cannot be resolved by implementation-level
correction alone.** It requires a canonical data-architecture amendment (new or
amended ACR/ADR touching `DATA_MODEL.md` and `DATA_AUTHORITY_MATRIX.md`) to either
(a) formally retire/migrate `kds_ordenes` in favor of `kds_tickets`, or (b)
formally define disjoint lifecycle roles for the two tables with an explicit
structural relationship, before WP-015 (or any WP building on top of it) can be
considered data-architecturally sound. Absent that amendment, the current
coexistence is a live Second-Source-of-Truth risk, not a documented and accepted
design.

---

## 4. Verdict

Blocker `QI-BLK-015-03` is fully specifiable as an implementation conformance fix
against already-canonical, already-demonstrated (WP-014) rules — no new
architecture decision needed. Blocker `QI-BLK-015-04` cannot be closed without a
new canonical data-architecture amendment, because canonical SSOT
(`DATA_AUTHORITY_MATRIX.md`, `DATA_DICTIONARY.md`) is silent on the relationship
between `kds_ordenes` and `kds_tickets`, and I am independently confirming a
genuine, unresolved Second-Source-of-Truth risk rather than inventing a
reconciliation rule myself.

Because one of the two blockers requires a canonical amendment before it can be
correctly closed, the overall verdict is **DATA ARCHITECTURE CHANGE REQUIRED**,
specifically for `QI-BLK-015-04` (the `kds_ordenes` vs. `kds_tickets` collision).
`QI-BLK-015-03` alone would have supported `REMEDIATION SPECIFIED`.

### Final Answers

- `QI-BLK-015-03 SQLite quantity type: INTEGER (signed 64-bit, NOT NULL)`
- `Expected scale: 4 (factor 10,000 / 10^4, per ADR-012 §4.1-4.2)`
- `Domain/transport conversion: SQLite INTEGER <-> TypeScript bigint at the repository adapter boundary (packages/pos-edge-runtime/src/kds-sqlite-repository.ts, mirroring dining-sqlite-repository.ts's BigInt(row.quantity) read / direct bigint bind write); bigint <-> canonical 4-decimal STRING at the composition-root wire boundary only (WP-015's WebSocket dispatcher / any future KDS REST route, mirroring fastify-app.ts), using the existing @trident/core primitives scaledBigIntToDecimalString / decimalStringToScaledBigInt verbatim -- no new conversion logic to be written. The domain package (packages/pos/src/kds-types.ts) must use bigint exclusively and never see a decimal string.`
- `QI-BLK-015-04 kds_ordenes vs kds_tickets: NOT genuinely disjoint -- kds_tickets reproduces 7 of kds_ordenes's 8 columns verbatim (id, cuenta_id, mesa_reference, urgency_level, identical status enum, aggregate_sequence_number, created_at, completed_at) and represents the same real-world fact (a kitchen production ticket for a cuenta) with the same causal-sequence conflict policy; kds_tickets is a superset adding only print/station-routing fields. DATA_AUTHORITY_MATRIX.md's single "KDS" row is entity-level/generic and names neither table, so canonical SSOT is silent on which table (if either) is authoritative and provides no reconciliation rule between them.`
- `Second Source of Truth Risk: YES`
- `Migration required: ARCHITECTURE DECISION REQUIRED`
- `Schema blockers remaining: 2 (both QI-BLK-015-03 and QI-BLK-015-04 remain open pending action -- 015-03 pending an implementation-level fix per the specification above; 015-04 pending a canonical architecture amendment before any fix, implementation-level or otherwise, can be correctly authorized)`
- `Verdict: DATA ARCHITECTURE CHANGE REQUIRED`
