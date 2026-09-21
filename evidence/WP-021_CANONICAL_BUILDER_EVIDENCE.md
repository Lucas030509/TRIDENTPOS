# WP-021 CANONICAL BUILDER EVIDENCE (R2 FISCAL SAFETY REMEDIATION)

## Work Package Information
- **Work Package:** WP-021 — Fiscal Invoicing Engine (PAC CFDI 4.0 / Electronic Invoicing)
- **Role:** 13_Backend_Developer
- **Mode:** BUILDER ONLY
- **Canonical Baseline SHA:** `26b606ad73acc37263a610dc9f0c979291b810a6`
- **R1 Frozen Subject SHA:** `5c0d6fef728535db85aae7f52c2430f768938ba8`
- **Remediation Branch:** `feat/wp-021-fiscal-invoicing-engine-r2`
- **Governing Framework:** EAAF v1.3.0 (Pinned Framework SHA: `167cea36c09c1031c763971ff790db2e0d0f7362`)
- **Risk Class:** RC4 — CRITICAL
- **Circuit Breaker State:** NORMAL (Builder iteration R2)

---

## 1. Package Topology & Dependency Boundaries
- **Package Created:** `packages/billing` (`@trident/billing`)
- **Pure Domain Runtime Dependencies:** `@trident/core` ONLY.
- **Unauthorized Runtime Dependencies:** 0 (Zero dependencies on `@trident/procurement`, `@trident/pos`, `@trident/inventory`, `@trident/database`, `@trident/cloud-server`, `@trident/crm`, `@trident/finance`, `@trident/sync`, `@trident/edge`, `@trident/ui`).
- **Composition Layer:** Cross-context orchestration is strictly contained in `packages/cloud-server` (`@trident/cloud-server`), which orchestrates `@trident/billing`, `@trident/database`, and transactional outbox events.

---

## 2. R2 Remediation of Quick Integrity Blockers

### QI-BLK-021-R1-01: CSD Vault & Fail-Closed Signing
- **Integrated `ICsdVault` Abstraction:** Defined provider-neutral interface `ICsdVault` with method `getSigningCredentials(organizationId, vaultId)`.
- **Fail-Closed Default:** Implemented `UnavailableCsdVault` as default runtime vault dependency, throwing `CsdCredentialsMissingError` if invoked.
- **Removed Direct Private Key PEM Input:** Stripped `command.csd?.privateKeyPem` from `StampFiscalInvoiceCommand`. Private keys are resolved dynamically through the injected vault using the tenant's `private_key_vault_id`.
- **Removed Mock Seal Fallback:** Completely removed `SELLO_EMISOR_MOCK` fallbacks from all signing routines. Any missing credential, invalid key, or signing failure causes immediate fail-closed rejection.
- **Strict Ephemeral In-Memory Key Handling (SEC-VAL-05):** Private keys exist only in memory during the exact signing operation. Private keys are never persisted to database tables, never logged, never emitted in outbox event payloads, and never included in returned DTOs.

### QI-BLK-021-R1-02: Mock PAC Removed from Default Runtime
- **Fail-Closed Runtime PAC Adapter:** Created `UnavailablePacConnector` as default runtime dependency for `PostgresBillingService`. Attempting fiscal operations without an explicitly configured PAC adapter immediately throws `PacConnectorError` and fails closed.
- **Mock PAC Test Fixture Isolation:** `MockPacConnector` is restricted strictly to unit/integration test fixtures with explicit injection.
- **Dynamic PAC Provider Identity:** Removed hard-coded `'MOCK_PAC'` from production mappers and outbox event payloads. The provider name is resolved dynamically from `pacConnector.providerName`.

### QI-BLK-021-R1-03 & QI-BLK-021-R1-04: Durable Stamping Operation Queue & Crash Reconciliation
- **Durable Operation Table (`fiscal_stamping_operations`):**
  - Tenant and branch scoped ownership (`organization_id`, `branch_id`).
  - Strict semantic idempotency constraint `uq_stamping_ops_org_idempotency (organization_id, idempotency_key)`.
  - Stored request identity SHA256 hash (`request_hash`) to detect and reject conflicting semantic reuse.
  - Operation status lifecycle: `PENDING`, `IN_FLIGHT`, `RETRYABLE`, `SUCCEEDED`, `FAILED_TERMINAL`, `RECONCILIATION_REQUIRED`.
  - Attempt counters, retry scheduling timestamp (`next_retry_at`), external provider reference (`external_reference`), and stamped UUID (`external_uuid`).
  - Row-Level Security (`ENABLE` and `FORCE`) with tenant-scoped policies.
- **Non-Blocking Saga Transaction Boundaries:**
  - **Phase 1 (DB TX):** Prepares durable operation, validates idempotency and request hash, retrieves CSD credentials via vault, builds and signs CFDI XML, commits transaction. Unbounded PAC network calls are NEVER performed while holding database locks.
  - **Phase 2 (Non-TX Network):** Calls external PAC connector `timbrar`.
  - **Phase 3 (DB TX):**
    - On PAC timeout / network drop: updates operation to `RECONCILIATION_REQUIRED` and re-throws `PacTimeoutError` without duplicating stamps.
    - On PAC rejection: updates operation to `FAILED_TERMINAL` and re-throws `PacConnectorError`.
    - On PAC success: marks operation `SUCCEEDED`, transitions `fiscal_invoices` to `STAMPED`, and emits `FacturaFiscalEmitida` outbox event atomically.

### Global Batch Advisories
- **Calendar-Accurate Month-End Boundary:** Updated `createGlobalInvoiceBatch` to compute calendar-accurate month ends using `new Date(year, month, 0).getDate()` rather than a fixed 28-day constant.
- **Unclaimed Folio Capability Boundary:** `findUnclaimedFolios` remains a provider-neutral capability contract interface, returning empty results unless provided by an authorized source adapter.

---

## 3. Persistence & Database Migration
- **Migration File:** `packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql`
- **Tables Managed (Exact 6):**
  1. `tax_schemes` — Tenant-isolated tax configurations (IVA, IEPS, ISR, retentions).
  2. `emisor_fiscal_config` — Tenant-isolated fiscal emitter profiles (RFC, Razon Social, Regimen, CSD certificates).
  3. `fiscal_invoices` — Authoritative fiscal invoice headers with UUID, folio, series, XML payloads, stamps, and cancellation details.
  4. `fiscal_invoice_items` — Detailed invoice line items with SAT product/unit codes, quantities, and item-level taxes.
  5. `lotes_facturacion_global` — Periodic consolidated invoice batches for unclaimed public sales.
  6. `fiscal_stamping_operations` — Durable fiscal stamping operation queue and crash reconciliation ledger.
- **Tenant Isolation & Security:**
  - Row-Level Security (RLS) enabled on all 6 tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
  - Strict RLS enforcement enabled on all 6 tables (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
  - Default-deny tenant isolation verified via database test suite.
  - Foreign keys strictly enforce tenant composite keys `(organization_id, branch_id) REFERENCES branches(organization_id, id)`.
  - Zero cross-context physical foreign keys to `pos`, `finance`, or `inventory`.
- **Down Migration:**
  - Deterministic down migration dropping tables in reverse dependency order without using `CASCADE`.
  - Migration rollback verified and predecessor survival proven.

---

## 4. Cloud Server Composition & Atomic Outbox
- **Service:** `PostgresBillingService` implementing `CloudBillingCompositionService`.
- **Constructor Defaults:** `UnavailablePacConnector` and `UnavailableCsdVault` (fail-closed production runtime).
- **Outbox Integration:** Enqueues `FacturaFiscalEmitida` and `FacturaFiscalCancelada` within atomic database transactions upon verified fiscal operations.

---

## 5. Verification & Test Metrics
- **Unit Tests (`@trident/billing`):** 24/24 PASS (100%) across 7 test suites
- **Database Tests (`@trident/database`):** 328/328 PASS across 13 suites (including 8 WP-021 specific tests and down-migration survival tests)
- **Cloud Server Tests (`@trident/cloud-server`):** 137/137 PASS across 6 suites (including 13 WP-021 specific composition, security, idempotency, and outbox tests)
- **Monorepo Build:** 12/12 packages built successfully (`npm run build`)
- **Electron Runtime Validation (`packages/edge`):** 10/10 PASS (100%) (`npm run --prefix packages/edge test:electron`)
- **Static Analysis:**
  - Format (`npm run format:check`): PASS
  - Lint (`npm run lint`): PASS (0 errors across 12 packages)
  - Typecheck (`npm run typecheck`): PASS (0 errors across 12 packages)
  - Graph Boundary Checker (`npm run graph:check`): PASS (44/44 tests passed, 0 boundary violations, 0 circular dependencies)
  - Git Diff Check (`git diff --check`): PASS

---

## 6. Architectural Drift & Open Questions Status
- **Architecture Drift:** None (PASS). Pure modular monolith boundaries strictly respected.
- **OQ-ARCH-02 (Fiscal Stamping Timing):** OPEN. No timing policy or automatic scheduler assumed or added.
- **Circuit Breaker State:** NORMAL.
- **Verdict:** IMPLEMENTED — FROZEN SUBJECT.
