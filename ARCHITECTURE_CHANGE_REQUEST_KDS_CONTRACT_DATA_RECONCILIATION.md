# ARCHITECTURE CHANGE REQUEST — ACR-2026-016

## KDS Contract & Data Authority Reconciliation

**Document ID:** `ACR-2026-016`
**Title:** KDS Contract & Data Authority Reconciliation
**Classification:** ARCHITECTURE CLARIFICATION / DATA AUTHORITY RECONCILIATION / SSOT HARMONIZATION / VALIDATION-DEBT FORMALIZATION
**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW`
**Date:** 2026-09-16
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`
**Authoring Roles:** `01_Solution_Architect`, `03_Data_Architect`
**Originating WP-015 Frozen Subject:** `21f99d901c0b19a99d1a18bcec780055822805e8` (`HOLD — QUICK INTEGRITY REMEDIATION REQUIRED`)
**Canonical Base:** `f0e21e51c86cb3c0bcdfdce1953dc616ad4169bc`
**Authoring Branch:** `architecture/acr-2026-016-kds-contract-data-reconciliation-r3`

---

## 1. Executive Summary & Governance Context

During the post-implementation Quick Integrity evaluation of work package `WP-015: Kitchen Display System (KDS) LAN Event Dispatcher & Printer Service` (Frozen Subject: `21f99d901c0b19a99d1a18bcec780055822805e8`), five architectural and data integrity blockers (`QI-BLK-015-01` through `QI-BLK-015-05`) and two evidence-reporting advisories (`Evidence Advisory 015-A` and `015-B`) were identified across two independent specialist triage reviews:

1. **Solution Architecture QI Triage:** Branch `review/wp-015-qi-blocker-triage-solution` (Commit `4b4e17db09d5114b3830c5f68df87ac94b676a72`), documented in `evidence/WP-015_QI_BLOCKER_TRIAGE_SOLUTION.md`.
2. **Data Architecture QI Triage:** Branch `review/wp-015-qi-blocker-triage-data` (Commit `d8a848a0dae38900c5cd951591f14a1da4c29bf5`), documented in `evidence/WP-015_QI_BLOCKER_TRIAGE_DATA.md`.

These triage evaluations confirmed that the implementation of WP-015 suffered from contractual ambiguity in the functional recall contract, lack of data model persistence for operational preparation times, non-conformance of KDS item quantities with the canonical fixed-point standard (`ADR-012`), potential Second-Source-of-Truth risk between historical `kds_ordenes` and implemented `kds_tickets`, and conflation of local loopback benchmark tests with dedicated physical LAN hardware saturation requirements (`ADR-005`).

This Architecture Change Request (`ACR-2026-016`) provides the formal, binding reconciliation across all canonical architecture documents (`FUNCTIONAL_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `DATA_MODEL.md`, `DATA_DICTIONARY.md`, `DATA_AUTHORITY_MATRIX.md`, `ADR-005`, and `ADR-012`). It establishes clear, unambiguous data authority and contract rules to enable a clean, mechanically auditable remediation of WP-015 upon canonicalization.

---

## 2. Originating Findings & Traceability Matrix

| Quick Integrity Finding | Problem Summary | Architectural Resolution in ACR-2026-016 | Primary Document Amended |
|---|---|---|---|
| **`QI-BLK-015-01`** | **Recall Contract Ambiguity:** Implementation defined `RecuperarOrdenRecall` keyed by station id with array return, contradicting the functional SSOT signature `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos)`. | Explicitly formalizes `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)` as an id-keyed lookup returning a single ticket or null, using `completed_at` as the window anchor without mutation. | `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1, `IMPLEMENTATION_PLAN.md` WP-015 |
| **`QI-BLK-015-02`** | **Preparation Time Parameter Discarded:** `ConfirmarOrdenSurtida` accepted `tiempoPreparacionMinutos` in the contract, but the value was silently discarded by the service and omitted from `kds_tickets` and domain events. | Canonicalizes `preparation_time_minutes INTEGER NULL` (with domain validation `>= 0`) on `kds_tickets` and mandates its propagation in the `OrdenProduccionConfirmadaEnKDS` domain event. | `DATA_MODEL.md` Sec. 3, `DATA_DICTIONARY.md` Sec. 1.2, `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1, `IMPLEMENTATION_PLAN.md` WP-015 |
| **`QI-BLK-015-03`** | **Quantity Representation Non-Conformance:** `kds_ticket_partidas.quantity` was represented as `TEXT` in SQLite and `string` in TypeScript domain (wire transport representation leaking into domain/persistence layers), failing to implement the canonical `ADR-012` three-layer model. | Establishes `kds_ticket_partidas.quantity` as SQLite `INTEGER NOT NULL` (Scale 4, factor 10,000), TypeScript domain `bigint`, and wire transport as canonical decimal string (`"1.0000"`), reusing `@trident/core` primitives. | `DATA_MODEL.md` Sec. 3, `DATA_DICTIONARY.md` Sec. 1.2, `IMPLEMENTATION_PLAN.md` WP-015 |
| **`QI-BLK-015-04`** | **KDS Data Authority & Second-SoR Risk:** Historical table `kds_ordenes` in `DATA_MODEL.md` overlapped `kds_tickets` with identical status enums and no declared structural relationship or authority hierarchy. | Declares `kds_tickets` + `kds_ticket_partidas` as the sole authoritative Edge runtime entity for KDS production orders; classifies `kds_ordenes` as `SUPERSEDED / HISTORICAL — DO NOT WRITE`. | `DATA_MODEL.md` Sec. 3, `DATA_DICTIONARY.md` Sec. 1.2, `DATA_AUTHORITY_MATRIX.md` |
| **`QI-BLK-015-05`** | **ADR-005 Physical LAN Validation Debt:** Software loopback latency test was presented as satisfying the physical LAN 20-client saturation benchmark (`< 5 ms`) required by `ADR-005` Sec. 11. | Formalizes non-security performance validation debt `PERF-VAL-015-01` owned by `WP-028: Hardware Benchmarking & Release Packaging` (Wave 9), clarifying that loopback software tests do not substitute physical LAN benchmarks. | `ADR-005` Sec. 11 & 13, `IMPLEMENTATION_PLAN.md` WP-015 & WP-028 |
| **`Evidence Advisory 015-A`** | **Changed-Files Triage Count Self-Exclusion:** Builder evidence stated 23 files changed, excluding itself from the tally (actual git diff: 24 files). | Establishes the governing rule that all future remediation evidence files must state the total inclusive of the evidence file itself. | `IMPLEMENTATION_PLAN.md` WP-015 Evidence Required |
| **`Evidence Advisory 015-B`** | **"Regression Tests: PASS" Compression Risk:** Bare "Regression Tests: PASS" obscured pre-existing Electron sandbox environment limitations. | Mandates explicit separation between WP regression status, pre-existing environment-only sandbox issues, and WP-specific test suite metrics. | `IMPLEMENTATION_PLAN.md` WP-015 Evidence Required |

---

## 3. Binding Architectural & Data Decisions

### 3.1 KDS Data Authority & Entity Model
1. **Authoritative Runtime Objects:**
   - `kds_tickets`: Sole authoritative Edge-local table representing KDS production orders / kitchen tickets for `WP-015` and downstream consumers.
   - `kds_ticket_partidas`: Authoritative child line items belonging to `kds_tickets`.
   - `kds_estaciones`: Authoritative configuration and operational state of KDS physical stations (`name`, `station_type` [`COCINA`, `BARRA`], `status` [`ACTIVA`, `INACTIVA`]).
   - `impresoras_red`: Authoritative configuration and connectivity state of network receipt and order printers (`name`, `host`, `port` default 9100, `kds_estacion_id`, `status` [`ONLINE`, `OFFLINE`, `UNKNOWN`]).
2. **Superseded Historical Object (`kds_ordenes`):**
   - The entity `kds_ordenes` defined in the baseline `DATA_MODEL.md` Sec. 3 is formally classified as **`SUPERSEDED / HISTORICAL — DO NOT WRITE`**.
   - **Rationale:** `kds_ordenes` predated the comprehensive multi-station and printing requirements implemented by WP-015. It materially overlaps `kds_tickets` in lifecycle statuses (`PENDIENTE`, `EN_PREPARACION`, `LISTO`, `ENTREGADO`) and aggregate sequence tracking.
   - **Operational Invariant:** No runtime code currently depends on `kds_ordenes` (zero codebase footprint). New runtime implementation MUST NOT write to or read from `kds_ordenes`. No bidirectional sync exists or will exist between `kds_ordenes` and `kds_tickets`. `kds_ordenes` is not an independent aggregate.
   - **Non-Destructive Governance:** Historical schema is not destructively deleted in this architecture step. Any physical DDL cleanup for existing databases will occur through a separately governed migration step.
3. **Print Queue Integration:**
   - Printer state (`print_status`, `print_attempts`, `printer_id`, `last_print_error`) is modeled directly as columns on `kds_tickets`. A KDS ticket represents the atomic unit of kitchen production and its physical print dispatch; a separate queue table would introduce redundant second-source state.

### 3.2 Recall Functional Contract (`RecuperarOrdenRecall`)
1. **Contract Signature:**
   ```typescript
   RecuperarOrdenRecall(ordenProduccionId: string, ventanaMaxMinutos: number = 120): KdsTicket | null
   ```
2. **Behavioral Semantics:**
   - Lookup is strictly id-keyed by `ordenProduccionId` (the unique identifier of the specific production order/ticket).
   - It is NOT a station-wide enumeration (station active ticket queries are handled by `ConsultarOrdenesActivas(kdsEstacionId)`).
   - Recall applies exclusively to previously completed production orders (`completed_at IS NOT NULL`).
   - The recall window anchor is the canonical `completed_at` timestamp.
   - If the ticket does not exist $\rightarrow$ returns `null` (or domain not-found equivalent).
   - If the ticket exists but is not completed $\rightarrow$ returns `null` (not eligible for recall).
   - If the elapsed time since `completed_at` exceeds `ventanaMaxMinutos` (default 120 minutes) $\rightarrow$ returns `null`.
   - Query operation: zero state mutation occurs.
   - No Product Owner decision is required or modified.

### 3.3 Preparation Time Architecture & Event Propagation
1. **Command Parameter Treatment:**
   - The parameter `tiempoPreparacionMinutos` in `ConfirmarOrdenSurtida(ordenProduccionId, kdsEstacionId, tiempoPreparacionMinutos)` represents an operational duration measurement supplied at the moment of kitchen production completion.
   - The parameter MUST NOT be discarded.
2. **Data Persistence:**
   - Persisted in `kds_tickets` under logical column `preparation_time_minutes INTEGER NULL`.
   - Column properties:
     * Type: `INTEGER NULL` (represented as whole elapsed minutes).
     * Domain validation: Non-negative integer (`>= 0`).
     * Lifecycle: `NULL` while ticket is pending or in preparation; populated upon successful execution of `ConfirmarOrdenSurtida`.
     * Immutability: Once recorded at completion, the measurement is immutable as part of the historical production record.
3. **Event Propagation:**
   - The domain event `OrdenProduccionConfirmadaEnKDS` MUST include `tiempoPreparacionMinutos` as an explicit payload field alongside `completedAt` and `ordenProduccionId`.
   - Consumers (such as future operational reporting or inventory kárdex triggers) receive the measurement directly in the event without timestamp reconstruction.
4. **Scope Boundaries:**
   - `completed_at` remains the canonical UTC completion timestamp.
   - No direct runtime dependency on Analytics is created. Analytics will consume the measurement asynchronously via existing Outbox replication (`WP-012`/`WP-013`).

### 3.4 Exact Fixed-Point Quantity Representation (`ADR-012` Compliance)
1. **Storage & Domain Types:**
   - SQLite physical storage: `kds_ticket_partidas.quantity INTEGER NOT NULL`.
   - Fixed-point Scale: 4 decimal places (factor $10^4 = 10,000$, e.g., $1.0000 \rightarrow 10000$, $0.5000 \rightarrow 5000$).
   - TypeScript domain layer (`@trident/pos`): `bigint` exclusively (e.g., `quantity: bigint`).
   - Wire / JSON / WebSocket transport: Canonical decimal string with exactly 4 fractional digits (e.g., `"1.0000"`, `"0.5000"`).
2. **Conversion Primitives:**
   - Repository adapters and transport boundaries MUST reuse the canonical conversion functions from `@trident/core` (`scaledBigIntToDecimalString`, `decimalStringToScaledBigInt`).
   - No custom conversion arithmetic or floating-point conversions (`parseFloat`, `Number()`) are permitted.

### 3.5 Status Enumerations & Canonical Vocabularies
1. **KDS Ticket Production Statuses (`KdsTicketStatus`):**
   - `PENDIENTE`: Ticket created from comanda, awaiting preparation.
   - `EN_PREPARACION`: Preparation initiated at station.
   - `LISTO`: Preparation complete; ready for service/delivery.
   - `ENTREGADO`: Order delivered to dining room or dispatch.
2. **KDS Ticket Partida Statuses (`KdsTicketPartidaStatus`):**
   - `PENDIENTE`: Line item awaiting preparation.
   - `EN_PREPARACION`: Line item currently in preparation.
   - `LISTO`: Line item completed.
3. **Urgency Levels (`UrgencyLevel`):**
   - `NORMAL`: Standard preparation priority.
   - `ALTA`: High priority preparation.
   - `URGENTE`: Maximum priority (e.g. urgent order, re-fire, or expedited comanda).
4. **Printer Queue Job Statuses (`PrintJobStatus`):**
   - `PENDING`: Initial state upon ticket creation before submission to queue runner.
   - `QUEUED`: Print attempt did not complete successfully and the ticket remains durably persisted in Edge SQLite (`kds_tickets.print_status = 'QUEUED'`) as retry-eligible work. This state survives process, runtime, or database restarts according to the persistent queue design (it is NOT an ephemeral, in-memory, or process-local queue).
   - `PRINTING`: Declared print-job lifecycle state representing an active transmission attempt. Note: The WP-015 R1 Frozen Subject declared this state in the domain vocabulary (`PrintJobStatus`) but did not persist/materialize the transition in `PrinterQueueRunner` prior to socket transmission. Future WP-015 remediation must explicitly reconcile this state with the runtime implementation (either by materializing the transition consistently if retained by the canonical contract, or obtaining governed reviewer direction before removing it). R1 must not be described as already demonstrating a persisted `PRINTING` transition.
   - `PRINTED`: ESC/POS payload successfully delivered through the configured TCP transport without a detected transport-layer error; the socket write completed and connection closed cleanly. `PRINTED` does NOT prove physical paper output, nor does it represent a hardware-level print acknowledgement unless a future governed device-status protocol explicitly adds that capability.
   - `FAILED`: Print job failed after exhaustion of retries (does not block kitchen workflow; recorded durably in SQLite with `last_print_error`).
5. **Printer Hardware Statuses (`PrinterStatus`):**
   - `ONLINE`: Socket connectivity verified.
   - `OFFLINE`: Socket unreachable or connection refused.
   - `UNKNOWN`: Default status before initial discovery / heartbeat check.
6. **Station Types & Statuses:**
   - `KdsEstacionType`: `COCINA`, `BARRA`.
   - `KdsEstacionStatus`: `ACTIVA`, `INACTIVA`.
7. **Untouched Business Enums:**
   - `Cuenta.status` (`ABIERTA`, `IMPRESA`, `PAGADA`, `ANULADA`) and `Mesa.status` (`DISPONIBLE`, `OCUPADA`, `EN_CUENTA`, `BLOQUEADA`) remain strictly untouched.

### 3.6 ADR-005 Performance Validation Debt (`PERF-VAL-015-01`)
1. **Status of ADR-005:**
   - `ADR-005` remains **`ACCEPTED WITH VALIDATION REQUIRED`**.
   - The requirement for dedicated physical LAN latency validation ($< 5\text{ ms}$) with 20 concurrent WebSocket clients remains an active architectural invariant.
2. **Formalization of Debt Item:**
   - **Debt Identifier:** `PERF-VAL-015-01`
   - **Title:** `KDS Physical LAN Latency & 20-Client Saturation Validation`
   - **Classification:** Non-Security Performance / Hardware Validation Debt.
   - **Originating WP:** `WP-015` (KDS LAN Event Dispatcher).
   - **Execution & Discharge Gate:** `WP-028: Hardware Benchmarking & Release Packaging` (Wave 9).
   - **Required Discharge Evidence:** Physical LAN topology diagram, device inventory, Wi-Fi/Ethernet RF conditions, 20 concurrently connected KDS client sessions, latency sampling logs, $p50/p95/max$ latency distributions, reconnection flood test results, and formal PASS/FAIL verdict against the ADR-005 threshold.
3. **Software Test Qualification:**
   - In WP-015, software loopback tests and 5-client mock fan-out tests are valuable software regression evidence, but MUST NOT be claimed as satisfying the physical LAN hardware benchmark required by ADR-005.

### 3.7 Governance Metadata Synchronization
1. **ADR-012 Header:**
   - Corrected from stale `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL` to `APPROVED / CANONICAL (via ACR-2026-013)`, preserving historical lineage.
2. **DATA_MODEL.md & DATA_DICTIONARY.md Headers:**
   - Updated to reflect that `ACR-2026-013` and `ACR-2026-014` are merged/canonical on main, and adding the proposal notice for `ACR-2026-016`.

---

## 4. Implementation Plan & Work Package Amendments

### 4.1 WP-015 Specification Updates
In `IMPLEMENTATION_PLAN.md`, `WP-015` is updated with:
- **Frozen Requirements & Inputs:** Add `ADR-005`, `ADR-012`, `ADR-013`, `ACR-2026-016`, `FUNCTIONAL_ARCHITECTURE.md` Sec. 6.1.
- **Data Objects:** SQLite `kds_estaciones`, `kds_tickets`, `kds_ticket_partidas`, `impresoras_red` (explicitly noting `kds_tickets` as sole authority and `kds_ordenes` as superseded).
- **Acceptance Criteria:**
  1. `RecuperarOrdenRecall` is id-keyed by `ordenProduccionId` and validates eligibility against the `completed_at` anchor within `ventanaMaxMinutos = 120`.
  2. `ConfirmarOrdenSurtida` captures `tiempoPreparacionMinutos`, persists it in `kds_tickets.preparation_time_minutes`, and propagates it in `OrdenProduccionConfirmadaEnKDS`.
  3. `kds_ticket_partidas.quantity` strictly follows `ADR-012` (SQLite `INTEGER` scale-4, domain `bigint`, wire canonical decimal string).
  4. `kds_tickets` is the sole authoritative entity for KDS production orders; `kds_ordenes` is superseded and non-writable.
  5. Local loopback tests are qualified as software-only and do not claim physical LAN benchmark satisfaction.
  6. `PERF-VAL-015-01` is formally tracked as OPEN and delegated to `WP-028`.
- **Validation Debt:** `Security Debt: None`, `Performance / Hardware Validation Debt: PERF-VAL-015-01 — OPEN — OWNED BY WP-028`.

### 4.2 WP-028 Specification Updates
In `IMPLEMENTATION_PLAN.md`, `WP-028` is updated to:
- Explicitly list `PERF-VAL-015-01` and `ADR-005 Sec. 11` under Inputs, Outputs, Acceptance Criteria, and Validation Debt tracking.
- Discharge the 20-client physical LAN saturation benchmark before release readiness.

---

## 5. Future WP-015 Remediation Protocol

1. **Remediation Invariant:**
   - Implementation work on WP-015 remediation MUST NOT begin until `ACR-2026-016` has completed independent review, received Product Owner approval, and been merged canonically to `main`.
2. **Remediation Branching:**
   - Upon canonicalization of `ACR-2026-016`, a fresh remediation branch `feature/wp-015-kds-lan-dispatcher-printer-service-r2` MUST be created directly from the updated canonical `main`.
   - The originating frozen subject `21f99d901c0b19a99d1a18bcec780055822805e8` remains immutable historical evidence and will not be modified or force-pushed.

---

## 6. Product Owner & Architecture Invariants Preservation

- **Protected Product Owner Decisions:**
  - All nine (9) protected PO decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly **`9 / 9 OPEN`** (`PENDING PO DECISION`).
  - Neither `PRODUCT_DECISIONS.md` nor `OPEN_QUESTIONS.md` has been modified.
- **Architectural Constraints:**
  - 11 Bounded Contexts preserved (`MODULAR BY DESIGN — INTEGRATED BY CONTRACT`).
  - TRIDENTPOS ownership of KDS and local printing preserved.
  - Zero direct cross-module runtime coupling.
  - Reservations remain strictly **EXCLUDED**.
  - Total Work Package headers: **35**. Executable Work Packages: **34**.
  - `WP-026` remains a **NON-EXECUTABLE UMBRELLA**.
  - Frontend Architecture and Visual System remain distinct, uncanonicalized future gates.
  - All 11 mandatory conditions from `ACR-2026-015` remain fully binding and unchanged.

---

## 7. Document Lifecycle State

**Document State:** `PROPOSED — PENDING INDEPENDENT REVIEW`
This document represents the formal architecture proposal authored by `01_Solution_Architect` and `03_Data_Architect`. It does NOT constitute approval, freeze, canonicalization, or merge authorization.
