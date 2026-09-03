# HANDOFF — TO IMPLEMENTATION PHASE (BUILDERS)

> [!CAUTION]
> **GOVERNANCE STATUS: NOT ACTIVE UNTIL IMPLEMENTATION_READINESS_GATE PASS**  
> Builders and development agents are **STRICTLY PROHIBITED** from writing implementation code, applying migrations, or executing build work until the `IMPLEMENTATION_READINESS_GATE` has been formally evaluated by an `Independent Solution Architect` and awarded **`PASS`**, followed by official Product Owner approval.

---

**Project:** `ERP RESTAURANTES / TRIDENTPOS`  
**From Authority:** `01_Solution_Architect — IMPLEMENTATION READINESS AUTHOR`  
**To Target:** EAAF Implementation Layer (`13_Backend_Developer`, `14_Mobile_Developer`, `15_Web_Frontend_Developer`, `16_Native_Edge_Developer`, `17_Database_Engineer`, `18_DevOps_Engineer`)  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Frozen Architecture Baseline Main SHA:** `6c31b64c435d50177e192fc6c5b7e83e18ffd87f`  
**Authoring Branch:** `architecture/implementation-readiness`  
**Date:** `2026-09-03`  

---

## 1. Governance Context & Prerequisites for Activation

Before any work package implementation begins:
1. **Gate Verdict:** `IMPLEMENTATION_READINESS_GATE` must be **PASS**.
2. **Product Owner Decision:** Formal `PRODUCT_OWNER_IMPLEMENTATION_READINESS_APPROVAL` recorded and frozen.
3. **Repository Control:** GitHub `main` branch protection must be enabled with mandatory PR reviews and CI status checks.

---

## 2. Authorized Work Package Execution Waves

Builders must execute work packages in strict wave dependency sequence according to [`IMPLEMENTATION_PLAN.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/IMPLEMENTATION_PLAN.md):

* **Wave 0 (Tooling & Foundation):** `WP-001` (Monorepo), `WP-002` (CI/CD & Security), `WP-003` (Postgres Baseline)
* **Wave 1 (Platform Core):** `WP-004` (Tenancy RLS), `WP-005` (Cloud IAM), `WP-006` (Audit Logging)
* **Wave 2 (Edge Runtime & Local DB):** `WP-007` (Electron Hardening), `WP-008` (SQLite WAL), `WP-009` (Trust Bootstrap), `WP-010` (Offline IAM)
* **Wave 3 (Data Sync & Leases):** `WP-011` (Folio Leases), `WP-012` (Outbox & Idempotency), `WP-013` (Sync Service)
* **Wave 4 (TRIDENTPOS Operations P0):** `WP-014` (Orders & OCC), `WP-015` (KDS LAN & Printers), `WP-016` (Cash Shifts & Cortes X/Z)
* **Wave 5 (Inventory & Procurement P1):** `WP-017` (Recipes & Warehouses), `WP-018` (Kárdex & Depletion), `WP-019` (Procurement & Receiving)
* **Wave 6 (Finance & Billing P1):** `WP-020` (Finance AP/AR), `WP-021` (Fiscal Invoicing PAC)
* **Wave 7 (CRM & Delivery Hub P2):** `WP-022` (CRM & Loyalty), `WP-023` (Delivery Aggregators)
* **Wave 8 (Presentation Surfaces):** `WP-024` (Backoffice Web), `WP-025` (Mobile Waiter), `WP-026` (Desktop POS & KDS UI)
* **Wave 9 (Hardening & Release):** `WP-027` (E2E Chaos Testing), `WP-028` (Hardware Benchmarks & Signed Packaging)

---

## 3. Branching, PR and Review Rules

* **Branch Per Work Package:** Every WP must be implemented on its own dedicated branch: `feature/wp-XXX-<slug>`.
* **Builder $\ne$ Reviewer:** The author/builder of a PR cannot approve their own pull request.
* **Review Requirements:**
  - Database schema changes require `03_Data_Architect` approval.
  - Security-sensitive code (auth, crypto, RLS, IPC) requires `08_Security_Architect` approval.
  - Architecture contracts and context boundaries require `01_Solution_Architect` approval.
  - DevOps pipelines require `10_DevOps_Platform_Architect` approval.
  - All code requires `11_Code_Reviewer` verification.
* **Evidence Delivery:** Every PR must include its verifiable evidence markdown artifact under `evidence/` documenting Expected vs. Actual, test run output, and remaining risk.

---

## 4. Protected Product Owner Decisions (Strict Invariants)

Builders are **STRICTLY FORBIDDEN** from making arbitrary assumptions regarding the 9 protected questions:
- `OQ-SSOT-01` through `OQ-SSOT-07` and `OQ-ARCH-01` through `OQ-ARCH-02`.
- All code touching these areas must use the parameterized interfaces defined in `IMPLEMENTATION_PLAN.md` Section 10.

---

## 5. Security Validation Debts to Deliver

The 11 cataloged Security Validation Debts (`SEC-VAL-01` to `SEC-VAL-11`) are hard contractual requirements. A work package covering a debt cannot be merged without its corresponding validation test evidence.

---

## 6. Stop Conditions for Builders

Builders must immediately **STOP** and trigger an architectural escalation if:
1. Implementation requires modifying any frozen schema or contract.
2. A cross-context database join or cyclic module dependency appears necessary.
3. An unparameterized assumption about an open PO decision is required to proceed.
4. An automated test fails on multi-tenant RLS isolation or SQLite durability.

---

**DOCUMENT STATUS: DRAFT — NOT ACTIVE UNTIL GATE PASS**
