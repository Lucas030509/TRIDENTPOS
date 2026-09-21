# WP-021 CANONICAL BUILDER EVIDENCE (R1 INITIAL IMPLEMENTATION)

## Work Package Information
- **Work Package:** WP-021 — Fiscal Invoicing Engine (PAC CFDI 4.0 / Electronic Invoicing)
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Baseline SHA:** `26b606ad73acc37263a610dc9f0c979291b810a6`
- **Branch:** `feat/wp-021-fiscal-invoicing-engine`
- **Direct Parent:** Canonical Baseline (`26b606ad73acc37263a610dc9f0c979291b810a6`)
- **Governing Framework:** EAAF v1.3.0 (Pinned Framework SHA: `167cea36c09c1031c763971ff790db2e0d0f7362`)
- **Risk Class:** RC4 — CRITICAL

---

## 1. Package Topology & Dependency Boundaries
- **Package Created:** `packages/billing` (`@trident/billing`)
- **Pure Domain Runtime Dependencies:** `@trident/core` ONLY.
- **Unauthorized Runtime Dependencies:** 0 (Zero dependencies on `@trident/procurement`, `@trident/pos`, `@trident/inventory`, `@trident/database`, `@trident/cloud-server`, `@trident/crm`, `@trident/finance`, `@trident/sync`, `@trident/edge`, `@trident/ui`).
- **Composition Layer:** Cross-context integration is strictly contained in `packages/cloud-server` (`@trident/cloud-server`), which orchestrates `@trident/billing`, `@trident/database`, and transactional outbox events.

---

## 2. Implemented Capabilities
1. **Scale-4 Fixed-Point Arithmetic & Tax Calculations (`@trident/billing`):**
   - Exact fixed-point numeric calculations complying with ADR-012.
   - Inclusive and exclusive multi-tier tax computation (IVA 16%, IEPS 8%, retention taxes, zero tax, exempt).
   - Validation for scale-4 format across all monetary and numeric quantities.
2. **SAT RFC & Catalog Validators:**
   - Persona Moral (12 chars), Persona Física (13 chars), Generic National (`XAXX010101000`), Generic International (`XEXX010101000`).
   - Mexican 5-digit Postal Code (CP) format validator (`01000` - `99999`).
   - SAT Regimen Fiscal 3-digit validator (e.g. `601`, `612`, `626`, `616`, etc.).
3. **CFDI 4.0 XML Engine & Cadena Original Formatter:**
   - Canonical Cadena Original 4.0 string builder formatted per SAT CFDI 4.0 specification.
   - Schema-valid XML document generation conforming to CFDI 4.0 standard.
4. **CSD Signer & Verification Engine:**
   - RSA-SHA256 digital signature creation for Cadena Original using CSD (Certificado de Sello Digital) private keys.
   - OpenSSL RSA-SHA256 signature verification.
   - Clean Base64 certificate PEM normalization.
5. **Provider-Neutral PAC Connector & Circuit Breaker:**
   - `IPacConnector` neutral interface for external Authorized Certification Provider (PAC) operations (`timbrar`, `cancelar`, `consultarEstatus`).
   - `PacCircuitBreaker` with fail-closed timeout and consecutive failure protection.
   - `MockPacConnector` with deterministic timeout simulation, error injection, and idempotent caching.
   - PAC integration status marked as `PROVIDER CONTRACT PENDING` / `BLOCKED BY CONTRACT` without hard-coding invented external provider API details.
6. **Pure Domain Lifecycle State Engine:**
   - Strict state transitions: `DRAFT -> STAMPED -> CANCELLED`.
   - Rejection of invalid transitions (e.g. cancelling a `DRAFT` invoice, double stamping).
   - SAT cancellation reasons enforcement: Motivo `01` strictly mandates `uuidSustitucion`.
7. **Batch Candidate Query (OQ-ARCH-02 Protected Scope):**
   - Pure domain batch query for grouping unclaimed tickets within branch/date boundaries.
   - Trigger timing policy preserved as `OPEN` under `OQ-ARCH-02` governance.

---

## 3. Persistence & Database Migration
- **Migration File:** `packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql`
- **Tables Created (Exact 5):**
  1. `tax_schemes` — Tenant-isolated tax configurations (IVA, IEPS, ISR, retentions).
  2. `emisor_fiscal_config` — Tenant-isolated fiscal emitter profiles (RFC, Razon Social, Regimen, CSD certificates).
  3. `fiscal_invoices` — Authoritative fiscal invoice headers with UUID, folio, series, XML payloads, stamps, and cancellation details.
  4. `fiscal_invoice_items` — Detailed invoice line items with SAT product/unit codes, quantities, and item-level taxes.
  5. `lotes_facturacion_global` — Periodic consolidated invoice batches for unclaimed public sales.
- **Tenant Isolation & Security:**
  - Row-Level Security (RLS) enabled on all 5 tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
  - Strict RLS enforcement enabled on all 5 tables (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
  - Default-deny tenant isolation verified via database test suite.
  - Foreign keys strictly enforce tenant composite keys `(organization_id, branch_id) REFERENCES branches(organization_id, id)`.
  - Zero cross-context physical foreign keys to `pos`, `finance`, or `inventory`.
- **Down Migration:**
  - Deterministic down migration dropping tables in reverse dependency order without using `CASCADE`.
  - Migration rollback verified and predecessor survival proven.

---

## 4. Cloud Server Composition & Atomic Outbox
- **Service:** `PostgresBillingService` implementing `CloudBillingCompositionService`.
- **Transactional Atomicity:**
  - Single tenant transaction boundary for invoice creation, stamping, and cancellation.
  - Idempotency protection with `FOR UPDATE` row-level locks on fiscal invoice records.
  - Outbox integration enqueuing `FacturaFiscalEmitida` and `FacturaFiscalCancelada` events within the same database transaction.

---

## 5. Verification & Test Metrics
- **Unit Tests (`@trident/billing`):** 24/24 PASS (100%)
- **Database Tests (`@trident/database`):** 327/327 PASS across 13 suites (including 7 WP-021 specific tests and down-migration survival tests)
- **Cloud Server Tests (`@trident/cloud-server`):** 133/133 PASS across 6 suites (including 9 WP-021 specific composition and outbox tests)
- **Monorepo Build:** 12/12 packages built successfully
- **Electron Runtime Validation (`packages/edge`):** 10/10 PASS (100%)
- **Static Analysis:**
  - Format (`npm run format:check`): PASS
  - Lint (`npm run lint`): PASS (0 errors across 12 packages)
  - Typecheck (`npm run typecheck`): PASS (0 errors across 12 packages)
  - Graph Boundary Checker (`npm run graph:check`): PASS (44/44 tests passed, 0 boundary violations, 0 circular dependencies)
  - Git Diff Check (`git diff --check`): PASS

---

## 6. Architectural Drift & Open Questions Status
- **Architecture Drift:** None (PASS). Pure modular monolith boundaries strictly respected.
- **OQ-ARCH-02 (Fiscal Stamping Timing):** OPEN. No timing policy assumed or inferred.
- **Circuit Breaker State:** NORMAL.
- **Verdict:** IMPLEMENTED — FROZEN SUBJECT.
