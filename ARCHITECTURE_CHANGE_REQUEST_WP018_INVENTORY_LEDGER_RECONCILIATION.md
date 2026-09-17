# ACR-2026-017 — WP-018 Inventory Ledger, Waste & KDS Depletion Reconciliation

**Status:** PROPOSED / FROZEN CANDIDATE R2 — PENDING INDEPENDENT REVIEW  
**Date:** 2026-09-17  
**Canonical Base:** `bfc3f9ba36f2c8c413639cdd50eaea0f4ac19cd6`  
**R1 Historical Candidate:** `b5714663545a8d8112cd303d75da17d6c8fc0a2c` — immutable / superseded by R2  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Affected WP:** `WP-018 — Real-Time Kárdex, Waste Tracking & KDS Depletion Service`  
**Protected PO Decisions:** 9/9 remain OPEN. This ACR does **not** resolve `OQ-SSOT-07` or any other Product Owner question.

---

## 1. Problem Statement

The canonical WP-018 sources are internally inconsistent and would force the Builder to invent authority or business semantics:

1. `IMPLEMENTATION_PLAN.md` names `stock_actual`, `movimientos_inventario`, `mermas_inventario`, while `DATA_MODEL.md` physically defines only `stock_ledger` for Kárdex.
2. The plan says current stock is derived from append-only movements, which is incompatible with a writable `stock_actual` authority.
3. The plan asks for a configurable negative-stock alert but also names a `negative stock prevention test`; `FUNCTIONAL_ARCHITECTURE.md` states restaurant operation continues and recognizes pending/deferred inventory impact.
4. `selectedModifiers[]` is carried into Inventory while `OQ-SSOT-07` remains OPEN.
5. Current `stock_ledger` lacks explicit WP-018 idempotency, monotonic sequencing, tenant-safe composite FKs, RLS/FORCE RLS, and DB-level append-only enforcement.
6. Waste requires mandatory reason and photo evidence but no governed physical metadata structure exists.
7. `ADR-007` requires durable PostgreSQL transactional outbox delivery for critical Cloud inter-module effects.

WP-018 implementation MUST NOT begin until this reconciliation is canonical.

---

## 2. Preserved Sources of Authority

This ACR preserves:

- `FUNCTIONAL_ARCHITECTURE.md` §6.2 and event `OrdenProduccionConfirmadaEnKDS`.
- `DATA_AUTHORITY_MATRIX.md`: Recipes, Warehouses & Kárdex are Cloud PostgreSQL SoR in Full Suite.
- `ADR-002`: segregated authority; no dual-master inventory state.
- `ADR-007`: durable Cloud inter-module events via PostgreSQL Transactional Outbox.
- `ADR-012`: exact Scale-4 numerical representation where applicable.
- `ADR-013`: `@trident/inventory` pure domain, `@trident/database` persistence, `@trident/cloud-server` composition.
- canonical WP-017 recipe/warehouse/ingredient schema and `ModifierRecipeResolver` contract.
- canonical WP-015 KDS schema and production-completion event.

---

## 3. Canonical Data Authority

### 3.1 Sole movement SoR

Physical Cloud PostgreSQL authority:

`stock_ledger`

It is append-only. Ordinary application paths may INSERT compensating movements but may not UPDATE or DELETE historical rows.

Conceptual mapping:

- `movimientos_inventario` → physical `stock_ledger`.
- `stock_actual` → derived balance/read model only.
- `mermas_inventario` → waste-registration metadata linked to a `MERMA` ledger movement.

There is exactly one authoritative quantity history: `stock_ledger.quantity_delta`.

### 3.2 Current stock

`stock_actual` MUST NOT become an independently writable table.

Canonical balance:

`SUM(quantity_delta)` grouped by:

`organization_id + branch_id + warehouse_id + ingredient_id`

Implementation may expose this as a read-only SQL view or equivalent application query.

### 3.3 `balance_after`

Existing `stock_ledger.balance_after` remains an immutable audit snapshot, not a second authority.

Invariant:

For each stock aggregate ordered by `movement_sequence_number`, `balance_after` equals the cumulative sum of `quantity_delta` through that movement.

---

## 4. Required `stock_ledger` Hardening

WP-018 Expand migration must ensure at minimum:

- `id UUID PRIMARY KEY`
- `organization_id UUID NOT NULL`
- `branch_id UUID NOT NULL`
- `warehouse_id UUID NOT NULL`
- `ingredient_id UUID NOT NULL`
- `movement_type VARCHAR(50) NOT NULL`
- canonical movement values: `COMPRA`, `CONSUMO_KDS`, `MERMA`, `AJUSTE_FISICO`, `TRANSFERENCIA`
- `reference_event_id VARCHAR(100) NOT NULL`
- `quantity_delta DECIMAL(12,4) NOT NULL CHECK (quantity_delta <> 0)`
- `unit_cost DECIMAL(12,4) NOT NULL`
- `total_cost DECIMAL(12,4) NOT NULL`
- `balance_after DECIMAL(12,4) NOT NULL`
- `movement_sequence_number BIGINT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Required candidate key:

`UNIQUE (organization_id, id)`

Required tenant-safe composite FKs:

- `(organization_id, branch_id)` → `branches(organization_id, id)`
- `(organization_id, warehouse_id)` → `warehouses(organization_id, id)`
- `(organization_id, ingredient_id)` → `ingredients(organization_id, id)`

Required sequence uniqueness:

`UNIQUE (organization_id, branch_id, warehouse_id, ingredient_id, movement_sequence_number)`

Required command/event idempotency uniqueness for stock-affecting commands originating outside the ledger:

`UNIQUE (organization_id, branch_id, warehouse_id, ingredient_id, movement_type, reference_event_id)`

This key governs at least:

- `CONSUMO_KDS`: `reference_event_id` = stable KDS production event/order id from the governed integration envelope.
- `MERMA`: `reference_event_id` = stable waste command/client operation id.

The same pattern may be reused by later governed WPs only where one logical command is canonically aggregated to one movement per ingredient/warehouse.

---

## 5. RLS & Append-Only Enforcement

`stock_ledger` and every new WP-018 table MUST use:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- fail-closed tenant policy using `organization_id = current_app_org_id()` for both read and write checks.

Database-level append-only protection MUST reject ordinary:

- `UPDATE`
- `DELETE`

against `stock_ledger`.

Corrections use compensating counter-movements only.

---

## 6. Waste Registration

WP-018 adds:

`inventory_waste_records`

Required fields:

- `id UUID PRIMARY KEY`
- `organization_id UUID NOT NULL`
- `branch_id UUID NOT NULL`
- `warehouse_id UUID NOT NULL`
- `ingredient_id UUID NOT NULL`
- `stock_ledger_id UUID NOT NULL`
- `command_id VARCHAR(100) NOT NULL`
- `reason_code VARCHAR(100) NOT NULL`
- `photo_attachment_url TEXT NOT NULL`
- `notes TEXT NULL`
- `actor_id UUID NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Required uniqueness:

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, command_id)`
- `UNIQUE (organization_id, stock_ledger_id)` — one waste evidence record per linked MERMA movement.

Required tenant-safe FKs:

- `(organization_id, branch_id)` → `branches(organization_id, id)`
- `(organization_id, warehouse_id)` → `warehouses(organization_id, id)`
- `(organization_id, ingredient_id)` → `ingredients(organization_id, id)`
- `(organization_id, stock_ledger_id)` → `stock_ledger(organization_id, id)`
- if `actor_id` is present: `(organization_id, actor_id)` → `users(organization_id, id)`

Invariant:

Each waste record references exactly one `stock_ledger` movement with:

- `movement_type = 'MERMA'`
- `quantity_delta < 0`
- same organization / branch / warehouse / ingredient.

This invariant must be protected by transaction/application validation and, where practical, a DB trigger or equivalent database constraint mechanism.

The MERMA ledger movement and its waste record commit atomically in one tenant transaction.

Blank `reason_code` or `photo_attachment_url` is invalid.

Quantity authority remains only in `stock_ledger`.

---

## 7. KDS Depletion Contract

### 7.1 Trigger

Canonical event:

`OrdenProduccionConfirmadaEnKDS`

Logical contract follows `FUNCTIONAL_ARCHITECTURE.md` §6.2:

- `organizacionId`
- `sucursalId`
- `centroConsumoId`
- `ordenId`
- `fechaHora`
- `tiempoPreparacionMinutos`
- `items[] { productoId, cantidad, selectedModifiers[] }`

Order identity MUST remain the governed production-order identity; KDS station identity may not substitute for it.

### 7.2 Durable path

Full Suite path:

KDS Edge completion
→ existing Edge outbox/sync (`WP-012` / `WP-013`)
→ Cloud durable integration event
→ Inventory WP-018 consumer
→ `stock_ledger`

Critical depletion MUST NOT rely only on volatile in-memory delivery.

### 7.3 Atomic consumer transaction

One KDS event application transaction must atomically perform:

1. replay/idempotency check,
2. recipe lookup,
3. ingredient explosion,
4. per-stock-aggregate serialization,
5. `CONSUMO_KDS` ledger inserts,
6. sequence and `balance_after` calculation,
7. negative-stock alert determination,
8. durable `InventarioDescontadoPorReceta` outbox insert.

No partial durable depletion is valid.

---

## 8. Concurrency & Monotonic Kárdex

Concurrent movements for the same aggregate:

`organization_id + branch_id + warehouse_id + ingredient_id`

must serialize deterministically within PostgreSQL.

A transaction-scoped advisory lock or architecture-equivalent mechanism is permitted.

Required guarantees:

- no lost movements,
- no duplicate KDS or waste movement on replay,
- strictly monotonic `movement_sequence_number`,
- exact `balance_after`,
- exact derived balance after concurrent deductions.

No hidden mutable balance table may become authority.

---

## 9. Negative Stock

Negative stock does **not** block restaurant sale or KDS completion.

This preserves the frozen functional rule that restaurant operations continue and Inventory side-effects may be deferred/pending.

Therefore:

- a valid `CONSUMO_KDS` movement may result in balance `< 0`;
- the movement still commits;
- an operational alert is emitted/recorded;
- no replenishment/purchasing algorithm may be invented;
- Inventory MUST NOT reject or roll back consumption solely due to negative result.

The stale plan phrase:

`negative stock prevention test`

is superseded by:

`negative stock non-blocking alert test`.

Required behavior: the crossing movement commits exactly once, derived balance is correctly negative, and the operational alert is produced without rolling back the originating restaurant operation.

---

## 10. `OQ-SSOT-07` Remains OPEN

This ACR chooses no modifier recipe semantics.

`ModifierRecipeResolver` remains contract-only.

For `selectedModifiers[]`:

- never silently ignore modifiers;
- never guess additive/replacement/subtractive/precedence behavior;
- if an authorized resolver exists, consume its deterministic resolved ingredient deltas;
- while unresolved, a modifier-bearing depletion event is durably quarantined/replayable with reason `MODIFIER_RECIPE_RESOLUTION_PENDING` or equivalent;
- zero stock movement for that event is committed until the complete recipe result is deterministic;
- sale/KDS completion is unaffected;
- future PO-approved semantics may replay the pending event idempotently.

This is fail-closed data preservation, not resolution of the PO question.

`OQ-SSOT-07 = OPEN`.

---

## 11. `registerWaste()`

Canonical application command consumes at minimum:

- `organizationId`
- `branchId`
- `warehouseId`
- `ingredientId`
- positive caller-facing waste quantity converted to a negative ledger delta
- `reasonCode`
- `photoAttachmentUrl`
- optional `notes`
- optional `actorId`
- stable `commandId`

Atomic result:

- one `MERMA` stock movement with `reference_event_id = commandId`,
- one linked `inventory_waste_records` row with the same `commandId`,
- correct sequence and `balance_after`,
- negative-stock alert if applicable.

Retry with the same `commandId` is idempotent and must not create a second movement or second waste record.

---

## 12. Package Boundaries

WP-018 extends canonical WP-017 topology.

### `@trident/inventory`

Pure domain ownership:

- movement validation/value objects,
- depletion orchestration over governed recipe explosion,
- Kárdex invariants,
- waste command rules,
- negative-balance classification,
- `ModifierRecipeResolver` consumption as contract only.

Runtime dependency: `@trident/core` only.

Forbidden direct runtime dependencies:

- `@trident/pos`
- `@trident/edge`
- `@trident/database`

### `@trident/database`

Owns PostgreSQL migration, RLS, append-only enforcement and persistence primitives.

### `@trident/cloud-server`

Owns composition:

- `withTenantTransaction()` boundary,
- durable KDS event consumer adapter,
- repository wiring,
- transactional outbox insertion.

No Inventory business rules belong in the composition root.

---

## 13. Required Tests

Minimum evidence:

1. Kárdex cumulative integrity: derived balance equals historical sum.
2. Concurrent KDS depletion: no loss, monotonic sequence, exact balance.
3. KDS replay idempotency: no duplicate movement.
4. Negative stock non-blocking alert.
5. DB append-only: UPDATE/DELETE rejected.
6. RLS + FORCE RLS tenant isolation.
7. Composite FK cross-tenant rejection.
8. Waste atomicity: MERMA + waste evidence commit together.
9. Waste validation: blank reason/photo rejected.
10. Waste retry idempotency using `commandId`.
11. Tenant-safe waste → ledger linkage.
12. Modifier unresolved quarantine: zero stock movement and durable replayability.
13. Resolver-present path using a test/dummy resolver without defining PO semantics.
14. Transaction failure leaves zero partial movement/outbox/waste state.
15. Durable `InventarioDescontadoPorReceta` outbox insertion.
16. Authorized non-production rollback removes only WP-018-owned additions and preserves WP-017 schema/data.

---

## 14. Migration & Rollback

Migration impact: `EXPAND`.

Production rollback:

- application rollback while expanded schema remains compatible,
- forward-fix preferred,
- no universal destructive production down.

Business correction:

- compensating counter-movement only,
- never mutate/delete historical ledger rows.

---

## 15. Canonical WP-018 Acceptance Criteria After Reconciliation

WP-018 may be `DONE / CANONICAL` only if:

- `stock_ledger` is the sole authoritative movement SoR;
- current stock is derived;
- append-only is enforced;
- RLS/FORCE RLS + tenant-safe composite FKs pass;
- KDS depletion is durable, atomic and idempotent;
- concurrent deductions preserve monotonic exact ledger state;
- negative stock is non-blocking and alerting;
- waste uses a MERMA movement plus mandatory linked evidence;
- waste retry is idempotent;
- `InventarioDescontadoPorReceta` is durably outboxed;
- unresolved modifier events are not silently/partially depleted;
- `OQ-SSOT-07` remains OPEN;
- Builder does not alter governing documents.

---

## 16. Explicit Non-Decisions

This ACR does NOT define:

- replenishment algorithm (`OQ-SSOT-05` stays OPEN),
- modifier recipe semantics (`OQ-SSOT-07` stays OPEN),
- new inventory valuation method,
- physical cycle-count UX,
- photo storage provider,
- alert delivery vendor/channel,
- external ERP reconciliation policy,
- UI implementation.

---

## 17. Canonical Overlay Priority

Once approved and merged, this ACR supersedes conflicting WP-018 wording in older canonical documents until those documents receive a metadata/content hygiene update.

Binding corrections:

- physical movement SoR = `stock_ledger`;
- `stock_actual` = derived read model only;
- waste metadata = `inventory_waste_records` linked to MERMA movement;
- Inventory Cloud schema source = `DATA_MODEL.md` §2.3; KDS event source = Edge/KDS schema §3 + `FUNCTIONAL_ARCHITECTURE.md` §6.2;
- `negative stock prevention test` is superseded by non-blocking alert behavior;
- modifier-bearing depletion remains replayable and unapplied until an authorized resolver makes the full result deterministic.

A later governance-hygiene patch may rewrite the older wording, but the Builder must follow this ACR when canonical.

---

## 18. Governance Gate

Required before WP-018 Builder start:

1. Coordinator Quick Integrity on exact R2 subject.
2. Independent `01_Solution_Architect` review.
3. Independent `03_Data_Architect` review.
4. Independent `11_Code_Reviewer` consistency review.
5. Coordinator synthesis.
6. Product Owner approval of exact frozen subject.
7. PR Gate.
8. PR + required CI/Security.
9. Merge authorization.
10. Merge.
11. Post-merge CI/Security validation.
12. `DONE / CANONICAL` declaration.

Only then may WP-018 start from the resulting canonical `main`.