# HANDOFF — TO IMPLEMENTATION PHASE (BUILDERS)

> [!CAUTION]
> **GOVERNANCE STATUS: GATE PASS + PO APPROVED — IMPLEMENTATION NOT ACTIVE UNTIL MAIN BRANCH PROTECTION VERIFIED**  
> 1. `IMPLEMENTATION_READINESS_GATE`: **PASS** (Evaluated by Independent Solution Architect at `ee3348e...`).
> 2. Product Owner Decision: **APPROVED & FROZEN** (`PRODUCT_OWNER_IMPLEMENTATION_READINESS_APPROVAL.md`).
> 3. Repository Control: **PENDING REMOTE ACTIVATION** (GitHub `main` branch protection).
> 
> Builders and development agents remain **STRICTLY PROHIBITED** from writing implementation code, applying migrations, or executing `WP-001` until remote branch protection on `main` is enabled and independently verified.

---

**Project:** `ERP RESTAURANTES / TRIDENTPOS`  
**From Authority:** `01_Solution_Architect — IMPLEMENTATION READINESS REMEDIATION AUTHOR`  
**To Target:** EAAF Implementation Layer (`13_Backend_Developer`, `14_Mobile_Developer`, `15_Web_Frontend_Developer`, `16_Native_Edge_Developer`, `17_Database_Engineer`, `18_DevOps_Engineer`)  
**Governing Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Frozen Architecture Baseline Main SHA:** `6c31b64c435d50177e192fc6c5b7e83e18ffd87f`  
**Authoring Branch:** `architecture/implementation-readiness`  
**Date:** `2026-09-03`  

---

## 1. Activation Preconditions (Mandatory Gates Before Code Implementation)

Before any work package implementation begins:
1. **Gate Verdict:** `IMPLEMENTATION_READINESS_GATE` evaluated as **`PASS`** by Independent Solution Architect.
2. **Product Owner Decision:** Formal PO Approval recorded and frozen.
3. **Repository Control Activation Precondition (`AMEND-GOV-IR-001` Implementation Activation Bootstrap Protocol):**
   - **Stage A (Pre-WP-001 Bootstrap):** Remote `main` branch protection must be enabled prior to merging `WP-001`, enforcing:
     * Mandatory pull requests before merging (direct commits to `main` prohibited).
     * Minimum 1 approved review from designated reviewer (builder cannot self-approve).
     * Prohibition of force pushes and branch deletions.
     * Automated status check contexts omitted during Stage A because no CI workflows exist in repository prior to `WP-002`.
     * Strict compensating controls for `WP-001`: local `npm ci`, local `npm run build`, dependency graph linting, evidence artifact with command output, dual review (`01_Solution_Architect` + `11_Code_Reviewer`).
   - **Stage B (Post-WP-002 Full Protection):** Immediately after `WP-002` merges and establishes GitHub Actions workflow contexts, `main` branch protection must be updated to enforce mandatory passing CI status checks (`build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`). Stage B is a hard precondition before `WP-003` or any subsequent domain WP can merge.
4. **Supply Chain Contract:** Monorepo package management adheres strictly to `npm workspaces`, committed `package-lock.json`, and `npm ci` in all CI/build environments per `SUPPLY_CHAIN_SECURITY.md`.
5. **Tooling Decision:** ORM selection (`Drizzle` vs. `Prisma`) must be formally recorded by `17_Database_Engineer` and `03_Data_Architect` prior to starting `WP-003`.
6. **Migration Governance:** Database schema evolution adheres strictly to `DATA_MIGRATION_STRATEGY.md` (Expand-Transition-Contract). Universal destructive down-migrations in production are prohibited.

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

## 3. Branching, PR and Dual Review Rules

* **Branch Per Work Package:** Every WP must be implemented on its own dedicated branch: `feature/wp-XXX-<slug>`.
* **Builder $\ne$ Reviewer:** The author/builder of a PR cannot approve their own pull request.
* **Dual Review Requirements:** Every code-producing PR must receive approved reviews from BOTH:
  1. **Primary Specialist Reviewer:**
     - Database changes: `03_Data_Architect` (and `08_Security_Architect` for RLS).
     - Security/Crypto/Auth/IPC changes: `08_Security_Architect`.
     - Context boundary/Architecture contracts: `01_Solution_Architect`.
     - DevOps pipelines/Packaging: `10_DevOps_Platform_Architect`.
     - Testing/Chaos: `09_QA_Test_Architect`.
  2. **Mandatory Code Reviewer:** `11_Code_Reviewer` on 100% of code-producing PRs.
* **Evidence Delivery:** Every PR must include its verifiable evidence markdown artifact under `evidence/` documenting Expected vs. Actual, test run output, commit SHA, and remaining risk.

---

## 4. Protected Product Owner Decisions (Strict Invariants)

Builders are **STRICTLY FORBIDDEN** from making arbitrary assumptions or selecting default values regarding the 9 protected questions:
- `OQ-SSOT-01` through `OQ-SSOT-07` and `OQ-ARCH-01` through `OQ-ARCH-02`.
- All code touching these areas must strictly use the neutral, parameterized interfaces defined in `IMPLEMENTATION_PLAN.md` Section 10.
- Any work package marked `PO Decision Required Before WP Completion` cannot be merged until the Product Owner records a formal business decision.

---

## 5. Security Validation Debts & External Authority

- The 11 cataloged Security Validation Debts (`SEC-VAL-01` to `SEC-VAL-11`) are hard contractual requirements.
- For `SEC-VAL-04` (Folio Leases): Rejection of zombie Edges must return `HTTP 403 LEASE_REVOKED` and allocated ranges must never be recycled.
- For `SEC-VAL-10` (Webhooks): Verification logic must be provider-contract-driven with provider-defined replay windows without universal HMAC assumptions.
- For `SEC-VAL-11` (Legal & Privacy Retention): Technical implementation is built by `13_Backend_Developer`, but final validation is an external governance dependency requiring formal review from Product Owner / Authorized Legal Counsel. `OWNER/PROVIDER REQUIRED BEFORE SEC-VAL-11 CAN CLOSE`.

---

## 6. Stop Conditions for Builders

Builders must immediately **STOP** and trigger an architectural escalation if:
1. Implementation requires modifying any frozen schema or contract.
2. A cross-context database join or cyclic module dependency appears necessary.
3. An unparameterized assumption about an open PO decision is required to proceed.
4. An automated test fails on multi-tenant RLS isolation or SQLite durability.

---

**DOCUMENT STATUS: APPROVED BASELINE — NOT ACTIVE UNTIL MAIN BRANCH PROTECTION VERIFIED**
