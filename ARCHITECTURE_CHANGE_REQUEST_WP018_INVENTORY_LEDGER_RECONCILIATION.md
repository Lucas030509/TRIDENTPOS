# ACR-2026-017 — WP-018 Inventory Ledger, Waste & KDS Depletion Reconciliation

**Status:** PROPOSED / FROZEN CANDIDATE — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-17  
**Canonical Base:** `bfc3f9ba36f2c8c413639cdd50eaea0f4ac19cd6`  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Affected WP:** `WP-018 — Real-Time Kárdex, Waste Tracking & KDS Depletion Service`  
**Protected PO Decisions:** 9/9 remain OPEN. This ACR does **not** resolve `OQ-SSOT-07` or any other Product Owner question.

---

## 1. Problem Statement

The current canonical documents contain contradictions that would force the WP-018 Builder to invent data authority or business behavior:

1. `IMPLEMENTATION_PLAN.md` names WP-018 data objects as `stock_actual`, `movimientos_inventario` (Kárdex), and `mermas_inventario`, while canonical `DATA_MODEL.md` physically defines `stock_ledger` only.
2. `IMPLEMENTATION_PLAN.md` states that Kárdex balances are never updated directly and are derived from append-only movements, which conflicts with treating `stock_actual` as a writable authoritative balance table.
3. `IMPLEMENTATION_PLAN.md` requires a configurable negative-stock alert, while the test description says `negative stock prevention test`. `FUNCTIONAL_ARCHITECTURE.md` explicitly requires restaurant operation to continue and recognizes deferred inventory depletion / pending stock state; therefore Inventory must not block the sale solely because physical stock becomes negative.
4. `FUNCTIONAL_ARCHITECTURE.md` contract 6.2 transports `selectedModifiers[]`, while `OQ-SSOT-07` keeps modifier recipe semantics OPEN. Silent omission or guessed modifier depletion is prohibited.
5. Canonical `stock_ledger` lacks the explicit tenant-safe composite FKs, RLS/FORCE RLS, append-only DB enforcement, concurrency sequencing, and idempotency constraints needed by WP-018 acceptance criteria.
6. Waste requires a mandatory reason code and photo attachment link, but the current canonical physical schema has no governed structure for that metadata.
7. `ADR-007` requires critical inter-module Cloud effects to use a durable PostgreSQL transactional outbox; WP-018 must consume KDS-originated production confirmation without volatile in-memory-only delivery.

WP-018 implementation MUST NOT begin until these contradictions are governed.

---

## 2. Sources of Authority Preserved

This ACR preserves and reconciles, rather than replaces, the following canonical rules:

- `FUNCTIONAL_ARCHITECTURE.md` §6.2: trigger event `OrdenProduccionConfirmadaEnKDS` and Inventory capability behavior.
- `DATA_AUTHORITY_MATRIX.md`: Recipes, Warehouses & Kárdex are Cloud PostgreSQL SoR in Full Suite topology.
- `ADR-002`: authority is segregated by topology and domain; no dual-master inventory authority.
- `ADR-007`: critical Cloud inter-module events use PostgreSQL Transactional Outbox.
- `ADR-012`: exact Scale-4 quantity / monetary representation where applicable.
- `ADR-013`: Inventory pure domain remains in `@trident/inventory`; persistence in `@trident/database`; composition in `@trident/cloud-server`.
- `WP-017`: `warehouses`, `ingredients`, `recipes`, `recipe_items`, recipe explosion, fixed-point domain primitives, and `ModifierRecipeResolver` contract are already canonical.
- `WP-015`: KDS authoritative Edge runtime is `kds_tickets` + `kds_ticket_partidas`; `OrdenProduccionConfirmadaEnKDS` is the production completion event.

---

## 3. Canonical WP-018 Data Authority

### 3.1 Sole authoritative inventory movement ledger

The canonical physical Cloud PostgreSQL Kárdex SoR is:

`stock_ledger`

It is **append-only**. Ordinary application code MUST NOT update or delete existing ledger rows.

Conceptual aliases in older planning text are mapped as follows:

- `movimientos_inventario` = conceptual business name for physical `stock_ledger`.
- `stock_actual` = **derived balance/read model**, never an independent writable source of truth.
- `mermas_inventario` = conceptual waste-registration capability represented physically by governed waste metadata linked to a `MERMA` movement.

There is exactly one authoritative quantity history: `stock_ledger.quantity_delta`.

### 3.2 Current stock projection

`stock_actual` MUST NOT be implemented as a mutable authoritative balance table.

WP-018 may expose current balance through:

- a read-only SQL view, or
- an application query that performs the equivalent deterministic aggregation.

Canonical balance formula:

`SUM(stock_ledger.quantity_delta)` grouped by:

`organization_id + branch_id + warehouse_id + ingredient_id`

A cached/materialized projection may be introduced only by a future governed change and must remain rebuildable from the ledger.

### 3.3 `balance_after`

The existing `stock_ledger.balance_after` field is retained as an immutable audit snapshot on each movement row, not as an independent authority.

Invariant:

For each stock aggregate, ordered by the canonical movement sequence, `balance_after` MUST equal the cumulative sum of all `quantity_delta` values through that movement.

A mismatch is an integrity failure.

---

## 4. Required WP-018 Physical Schema Hardening

WP-018 must use an Expand migration to harden / extend the canonical Inventory schema.

### 4.1 `stock_ledger`

Required invariants:

- `organization_id UUID NOT NULL`
- `branch_id UUID NOT NULL`
- `warehouse_id UUID NOT NULL`
- `ingredient_id UUID NOT NULL`
- `movement_type` canonical values: `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`
- `reference_event_id VARCHAR(100) NOT NULL`
- `quantity_delta DECIMAL(12,4) NOT NULL`
- `quantity_delta <> 0`
- `unit_cost DECIMAL(12,4) NOT NULL`
- `total_cost DECIMAL(12,4) NOT NULL`
- `balance_after DECIMAL(12,4) NOT NULL`
- `movement_sequence_number BIGINT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Tenant-safe composite foreign keys are mandatory:

- `(organization_id, branch_id)` → `branches(organization_id, id)` or repository-equivalent candidate-key-safe reference.
- `(organization_id, warehouse_id)` → `warehouses(organization_id, id)`.
- `(organization_id, ingredient_id)` → `ingredients(organization_id, id)`.

Required uniqueness:

- `(organization_id, branch_id, warehouse_id, ingredient_id, movement_sequence_number)`
- KDS idempotency uniqueness sufficient to prevent a replayed production event from deducting the same aggregated ingredient twice. Canonical key:
  `(organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)` for `CONSUMO_KDS` movements.

### 4.2 RLS

`stock_ledger` and all new WP-018 tables MUST use:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- fail-closed `organization_id = current_app_org_id()` policies

### 4.3 Database-level append-only enforcement

WP-018 must add DB-level protection that rejects ordinary:

- `UPDATE`
- `DELETE`

against `stock_ledger`.

Corrections use compensating counter-movements only.

---

## 5. Waste Registration

WP-018 shall add a physical Cloud table:

`inventory_waste_records`

Purpose: retain mandatory waste metadata without duplicating stock authority.

Required fields:

- `id UUID PRIMARY KEY`
- `organization_id UUID NOT NULL`
- `branch_id UUID NOT NULL`
- `warehouse_id UUID NOT NULL`
- `ingredient_id UUID NOT NULL`
- `stock_ledger_id UUID NOT NULL`
- `reason_code VARCHAR(100) NOT NULL`
- `photo_attachment_url TEXT NOT NULL`
- `notes TEXT NULL`
- `actor_id UUID NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Invariant:

Each waste record MUST reference exactly one `stock_ledger` movement whose `movement_type = 'MERMA'` and whose `quantity_delta < 0`.

The `MERMA` ledger movement and `inventory_waste_records` row must commit atomically in the same tenant transaction.

`reason_code` and `photo_attachment_url` are mandatory and must reject blank values at the application boundary; DB CHECK constraints should enforce non-empty canonical text where supported.

Waste metadata is descriptive evidence; quantity authority remains only in `stock_ledger`.

---

## 6. KDS Depletion Contract

### 6.1 Trigger

WP-018 consumes canonical event:

`OrdenProduccionConfirmadaEnKDS`

The logical contract follows `FUNCTIONAL_ARCHITECTURE.md` §6.2:

- `organizacionId`
- `sucursalId`
- `centroConsumoId`
- `ordenId`
- `fechaHora`
- `tiempoPreparacionMinutos`
- `items[] { productoId, cantidad, selectedModifiers[] }`

The canonical KDS production-order identity is `ordenProduccionId` / `ordenId` as carried by the governed integration envelope; station identity MUST NOT replace order identity.

### 6.2 Durable path

In Full Suite topology the event path is:

KDS Edge completion
→ existing Edge outbox/sync pipeline (`WP-012` / `WP-013`)
→ Cloud durable integration event
→ Inventory WP-018 consumer
→ `stock_ledger`

Critical Inventory depletion MUST NOT rely solely on an in-memory volatile event handler.

The Cloud integration outbox / dispatcher governed by `ADR-007` is the durable handoff mechanism.

### 6.3 Atomic application

For one production event, the Inventory application transaction must atomically perform:

1. idempotency / replay check,
2. recipe lookup,
3. ingredient explosion,
4. stock aggregate serialization,
5. append-only `CONSUMO_KDS` movement inserts,
6. immutable `balance_after` snapshots,
7. negative-stock alert determination,
8. durable emission of `InventarioDescontadoPorReceta` through the Cloud transactional outbox.

No partial durable depletion is valid.

---

## 7. Concurrency & Monotonic Kárdex

Concurrent production confirmations for the same stock aggregate must serialize deterministically inside PostgreSQL.

WP-018 must use a transaction-scoped serialization mechanism for each aggregate key:

`organization_id + branch_id + warehouse_id + ingredient_id`

An implementation using PostgreSQL transaction advisory locks or an architecture-equivalent mechanism is permitted.

The implementation MUST prove:

- no lost movements,
- no duplicate KDS movement on replay,
- strictly monotonic `movement_sequence_number` per aggregate,
- `balance_after` equals cumulative ledger sum after concurrent deductions.

No mutable `stock_actual` row may be used as hidden authority.

---

## 8. Negative Stock Semantics

Negative stock does **not** block restaurant sale or KDS completion.

This is not a new Product Owner decision; it preserves the frozen functional rule that restaurant operation continues when Inventory cannot satisfy stock synchronously and that inventory may remain pending / below expected physical balance.

Therefore:

- a valid `CONSUMO_KDS` movement may produce a derived balance `< 0`;
- the movement MUST still be committed;
- an operational alert MUST be emitted/recorded;
- the alert threshold/configuration may be parameterized, but the Builder MUST NOT invent a replenishment algorithm or purchasing policy;
- WP-018 MUST NOT reject or roll back the KDS consumption solely because the resulting stock is negative.

The stale WP-018 test phrase `negative stock prevention test` is interpreted and must be corrected by the governing plan overlay as:

`negative stock non-blocking alert test`.

Required test:

A depletion that crosses below zero commits exactly once, yields the correct negative derived balance, and produces the configured operational alert without blocking the originating restaurant operation.

---

## 9. `OQ-SSOT-07` — Modifier Recipe Semantics Remain OPEN

This ACR does **not** choose additive, subtractive, replacement, precedence, or any other modifier recipe rule.

`ModifierRecipeResolver` remains a contract only.

For `selectedModifiers[]`:

- WP-018 MUST NOT silently ignore modifiers.
- WP-018 MUST NOT guess modifier ingredient effects.
- When a concrete authorized resolver is available, WP-018 may consume its resolved ingredient deltas.
- While `OQ-SSOT-07` remains unresolved, a KDS depletion event containing unresolved modifiers must be durably quarantined / left replayable with an explicit reason such as `MODIFIER_RECIPE_RESOLUTION_PENDING`; **zero stock movement for that event may be committed until the complete recipe result is deterministic**.
- Restaurant sale / KDS completion remains unaffected; only the Inventory depletion side-effect is deferred.
- Once the future PO-approved rule becomes canonical, the pending event may be replayed idempotently.

This safeguard is data-preserving and does not constitute a Product Owner choice.

`OQ-SSOT-07` remains `OPEN`.

---

## 10. `registerWaste()` Contract

Canonical application command:

`registerWaste(input)`

Minimum input:

- `organizationId`
- `branchId`
- `warehouseId`
- `ingredientId`
- positive waste quantity supplied by caller and converted to a negative ledger delta by the domain service
- `reasonCode`
- `photoAttachmentUrl`
- optional `notes`
- optional `actorId`
- idempotency key / command identifier

Atomic result:

- one `stock_ledger` row with `movement_type='MERMA'` and negative `quantity_delta`,
- one linked `inventory_waste_records` row,
- correct monotonic sequence and `balance_after`,
- optional negative-stock operational alert if resulting balance is below threshold.

Retries MUST NOT duplicate the waste movement.

---

## 11. Package & Dependency Boundaries

WP-018 extends the canonical WP-017 topology:

### `@trident/inventory`

Owns pure domain behavior:

- movement value objects / validation,
- depletion calculation orchestration over already-governed recipe explosion,
- waste command rules,
- Kárdex invariants,
- negative-balance classification,
- `ModifierRecipeResolver` consumption as a contract only.

Runtime dependencies: `@trident/core` only.

Forbidden direct runtime dependencies:

- `@trident/pos`
- `@trident/edge`
- `@trident/database`

### `@trident/database`

Owns PostgreSQL migrations, RLS, append-only enforcement and persistence primitives.

### `@trident/cloud-server`

Owns composition:

- `withTenantTransaction()` boundary,
- durable event consumer adapter,
- repository wiring,
- transactional outbox emission.

No Inventory business rules may be placed in the composition root.

---

## 12. Required WP-018 Tests

WP-018 cannot pass with only happy-path unit tests.

Required minimum evidence:

1. Kárdex cumulative integrity: derived current balance equals exact historical movement sum.
2. Concurrent KDS depletion: no lost update, monotonic sequence, exact cumulative balance.
3. Replay/idempotency: same KDS event reprocessed produces zero duplicate stock movement.
4. Negative stock non-blocking alert: movement commits, balance may become negative, alert generated, no sale/KDS rollback.
5. Append-only DB enforcement: UPDATE and DELETE are rejected.
6. RLS tenant isolation and FORCE RLS.
7. Composite FK cross-tenant rejection.
8. Waste atomicity: MERMA movement + waste metadata commit together.
9. Waste validation: blank reason or photo link rejected.
10. Waste idempotency: retry does not duplicate movement.
11. Modifier unresolved quarantine: selected modifiers with no authorized resolver produce zero stock movement and remain durably replayable.
12. Resolver-present path: use a test/dummy resolver contract to prove deterministic resolved deltas without defining PO semantics.
13. Transaction rollback: failure after movement preparation but before commit leaves zero partial movement/outbox rows.
14. Durable outbox: successful depletion atomically persists `InventarioDescontadoPorReceta` integration event.
15. Rollback ownership: WP-018 migration rollback in non-production removes only WP-018-owned objects and preserves WP-017 tables and data.

---

## 13. Migration & Rollback Rules

Migration impact: `EXPAND`.

Production rollback follows canonical migration strategy:

- application rollback while expanded schema remains compatible,
- forward-fix preferred,
- no destructive universal production down.

Any authorized non-production `migrateDown()` test must prove WP-017 objects survive.

Business correction uses compensating Kárdex counter-movements; existing ledger rows are never edited or deleted.

---

## 14. WP-018 Acceptance Criteria After Reconciliation

WP-018 is eligible for `DONE / CANONICAL` only when:

- `stock_ledger` is the sole authoritative movement ledger;
- current stock is derived, not independently mutable;
- append-only behavior is enforced in database and application boundaries;
- RLS/FORCE RLS and tenant-safe composite FKs pass;
- KDS depletion is durable, idempotent and atomic;
- concurrent deductions preserve exact monotonic ledger integrity;
- negative stock does not block the restaurant operation and generates an alert;
- waste is represented by a compensating/negative ledger movement plus mandatory linked evidence metadata;
- `InventarioDescontadoPorReceta` is durably emitted through the Cloud transactional outbox;
- unresolved modifier events are not silently or partially depleted;
- `OQ-SSOT-07` remains OPEN until the Product Owner separately decides it;
- no governing documents are modified by the Builder.

---

## 15. Explicit Non-Decisions / Exclusions

This ACR does NOT define:

- replenishment / purchase suggestion algorithm (`OQ-SSOT-05` remains OPEN),
- modifier recipe semantics (`OQ-SSOT-07` remains OPEN),
- inventory valuation method beyond already frozen cost snapshots,
- physical cycle-count UX,
- photo storage provider,
- alert delivery channel/vendor,
- external ERP inventory reconciliation policy,
- UI implementation.

---

## 16. Required Downstream Documentation Overlay

Upon approval/canonicalization, this ACR governs the following corrections:

- `IMPLEMENTATION_PLAN.md` WP-018 entry:
  - map conceptual objects to physical `stock_ledger` + derived balance + waste metadata;
  - replace stale `negative stock prevention test` with `negative stock non-blocking alert test`;
  - add explicit `OQ-SSOT-07` safeguarded dependency for modifier-bearing depletion events;
  - correct primary data input reference from `DATA_MODEL.md Sec. 3` to Inventory Cloud schema (`Sec. 2.3`) plus KDS Edge contract (`Sec. 3`).
- `DATA_MODEL.md`:
  - harden `stock_ledger` authority/invariants;
  - define `inventory_waste_records`;
  - define derived stock projection semantics;
  - add RLS/FORCE RLS and append-only controls.
- `DATA_AUTHORITY_MATRIX.md`:
  - state explicitly that `stock_ledger` is the sole Cloud Inventory movement SoR and current stock is derived.
- `FUNCTIONAL_ARCHITECTURE.md` §6.2:
  - preserve `selectedModifiers[]` but state unresolved modifier depletion is deferred/replayable and must not be silently approximated.

No implementation branch may treat this ACR as canonical until governance completes.

---

## 17. Governance Gate

Required before Builder start:

1. Coordinator Quick Integrity on this exact candidate.
2. Independent `01_Solution_Architect` review.
3. Independent `03_Data_Architect` review.
4. Independent `11_Code_Reviewer` consistency review.
5. Coordinator synthesis.
6. Product Owner approval of the exact frozen subject.
7. PR Gate.
8. PR + required CI/Security checks.
9. Merge authorization.
10. Merge.
11. Post-merge CI/Security validation.
12. `DONE / CANONICAL` declaration.

Only then may WP-018 Builder start from the resulting canonical `main`.
