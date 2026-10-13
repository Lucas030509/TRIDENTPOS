# WP-021 Fiscal Invoicing Engine — Security Remediation Builder Evidence

## 1. Governance & Lineage Metadata

| Attribute | Canonical Value |
| :--- | :--- |
| **Governing Framework** | `Lucas030509/EAAF-Framework` |
| **Framework Pinned SHA** | `167cea36c09c1031c763971ff790db2e0d0f7362` (EAAF v1.3.0) |
| **Canonical Project Repository** | `Lucas030509/TRIDENTPOS` |
| **Canonical Base (`main`)** | `885855f4b4c51833135a9d384c673ed4bc0e406b` |
| **Canonical Architecture** | `ACR-2026-020 R5` (`54e08752156153260b609eff99ef8d7ea1990b86`) |
| **Human Authorization Branch** | `evidence/wp-021-r4-security-hold-extra-builder-authorization` |
| **Human Authorization SHA** | `33e7e8d4ce057ae3c5a55ed401d711e4094129cf` |
| **Human Authorization File** | `evidence/WP-021_R4_SECURITY_HOLD_EXTRA_BUILDER_AUTHORIZATION.md` |
| **Historical Frozen R4 SHA** | `fa4545c5dd6491bac473d959635b27015b804911` (Immutable HOLD) |
| **Active Remediation Branch** | `feat/wp-021-fiscal-invoicing-engine-security-remediation-r5` |
| **Role** | `13_Backend_Developer` (Builder ONLY) |
| **Iteration** | Single Authorized Security Remediation Iteration (1 of 1) |

---

## 2. Exact Files Modified & Created

```text
packages/billing/src/errors.ts
packages/billing/src/error-sanitizer.ts (NEW)
packages/billing/src/xml-validator.ts (NEW)
packages/billing/src/types.ts
packages/billing/src/pac-connector.ts
packages/billing/src/index.ts
packages/billing/src/index.test.ts
packages/cloud-server/src/index.ts
packages/cloud-server/src/billing.test.ts
packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql
packages/database/src/billing.test.ts
evidence/WP-021_SECURITY_REMEDIATION_BUILDER_EVIDENCE.md (NEW)
```

---

## 3. Finding Remediation Matrix (7 HIGH + 1 MEDIUM)

| Finding Identifier | Severity | Implementation Summary | Test Coverage & Assertion | Command Executed | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-WP021-R4-HIGH-01** | HIGH | Implemented ACR R5 PAC capability provenance fail-closed validation: digital attestation, evidence SHA-256 digest, byte length, exact scope binding (tenant/org/operation), temporal validity bounds, revocation status/monotonic sequence, and cache TTL verification in `validatePacCapabilityProvenance`. Enforced across STAMP, CANCEL, authoritative lookups, and Rule A/B recovery. | `REQ-81` to `REQ-87`, `WP021-SEC-02` | `npm test --workspace=@trident/billing` | PASS |
| **SEC-WP021-R4-HIGH-02** | HIGH | Implemented `eventContractVersion` (`major.minor`, default `'1.0'`) across domain events, outbox payloads, consumer inbox, migrations, and replay pipelines. Version is validated syntactically, unknown major rejected, compatible minor accepted, and preserved across replay without polluting `semanticEventId`. | `REQ-75` to `REQ-80`, `WP021-REQ-75to80` | `npm test --workspace=@trident/billing` | PASS |
| **SEC-WP021-R4-HIGH-03** | HIGH | Replaced destructive `DROP TABLE` in down-migration with a fail-closed check (`DO $$ ... RAISE EXCEPTION ... $$`) aborting rollback if `fiscal_invoices` or `fiscal_stamping_operations` has rows, preserving fiscal truth. Non-destructive down allowed only when tables are empty in non-production. | `WP021-DOWN-01` | `npm test --workspace=@trident/database` | PASS |
| **SEC-WP021-R4-HIGH-04** | HIGH | Implemented structural recursive-descent XML parser and `validateAndExtractTimbreFiscalDigital` in `xml-validator.ts` verifying CFDI 4.0 `<cfdi:Comprobante>` and `<tfd:TimbreFiscalDigital>` (UUID, FechaTimbrado, SelloSAT, NoCertificadoSAT, RfcProvCertif) matching invoice UUID and rejecting pre-stamp XML or malformed tags. | `WP021-SEC-HIGH-04`, CFDI XML tests | `npm test --workspace=@trident/billing` | PASS |
| **SEC-WP021-R4-HIGH-05** | HIGH | Removed plaintext private keys and passwords from public commands (`ConfigureEmisorFiscalCommand`). Emisor configuration exclusively references `privateKeyVaultId`. Private keys and PAC tokens are never persisted in business tables, outbox, errors, or returned DTOs. | `WP021-SEC-01`, `WP021-SEC-04` | `npm test --workspace=@trident/cloud-server` | PASS |
| **SEC-WP021-R4-HIGH-06** | HIGH | Implemented `ConsumerInboxService` and `consumer_inbox_events` table for transactional deduplication, durable idempotency, restore-domain isolation, duplicate suppression, and safe replay reconciliation (`reconcileConsumerRestore`). | `WP021-REQ-88to92` | `npm test --workspace=@trident/cloud-server` | PASS |
| **SEC-WP021-R4-HIGH-07** | HIGH | Built executable automated test suites with unambiguous identifiers for all Acceptance Requirements 75–92 (Event versioning 75–80, Capability provenance 81–87, Consumer restore-domain 88–92), executing in CI with exit code 0. | `REQ-75`..`80`, `REQ-81`..`87`, `REQ-88`..`92` | `npm test` | PASS |
| **SEC-WP021-R4-MED-01** | MEDIUM | Implemented `FiscalErrorSanitizer` in `error-sanitizer.ts` with strict regex scrubbing of PEM headers, database connection URIs, passwords, bearer tokens, and credentials from persisted and external error messages. | `WP021-SEC-MED-01`, Error Sanitizer suite | `npm test --workspace=@trident/billing` | PASS |

---

## 4. Requirements 75–92 Executable Test Matrix

| Requirement | Description | Test Identifier | Test File | Test Command | Exit Code | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-75** | Canonical `major.minor` eventContractVersion syntax | `REQ-75: Validates canonical major.minor eventContractVersion format` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-76** | Missing eventContractVersion fails closed | `REQ-76: Missing eventContractVersion fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-77** | Malformed eventContractVersion fails closed | `REQ-77: Malformed eventContractVersion format fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-78** | Unknown major version rejected by consumers | `REQ-78: Unknown major version is distinguishable and rejected by subscribers` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-79** | Compatible minor version accepted | `REQ-79: Compatible minor version is accepted without breaking changes` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-80** | Version excluded from deterministic semanticEventId | `REQ-80: Version is NOT included in semanticEventId (deterministic stability)` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-81** | Valid contractual provenance record accepted | `REQ-81: Valid contractual provenance record passes capability validation` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-82** | Missing provenance record fails closed | `REQ-82: Missing provenance record fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-83** | Evidence digest mismatch fails closed | `REQ-83: Evidence digest mismatch or altered bytes fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-84** | Revoked provenance status fails closed | `REQ-84: Revoked provenance status fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-85** | Expired provenance validity bounds fails closed | `REQ-85: Expired provenance validity bounds fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-86** | Scope mismatch (op/cap/tenant) fails closed | `REQ-86: Scope mismatch (operation, capability, or tenant) fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-87** | Stale positive cache exceeding TTL fails closed | `REQ-87: Stale positive status cache exceeding maxStatusAgeMs fails closed` | `packages/billing/src/index.test.ts` | `npm test --workspace=@trident/billing` | 0 | PASS |
| **REQ-88** | Consumer rejects missing/malformed version | `WP021-REQ-88to92 (Assertion 1)` | `packages/cloud-server/src/billing.test.ts` | `npm test --workspace=@trident/cloud-server` | 0 | PASS |
| **REQ-89** | Consumer rejects incompatible major version | `WP021-REQ-88to92 (Assertion 2)` | `packages/cloud-server/src/billing.test.ts` | `npm test --workspace=@trident/cloud-server` | 0 | PASS |
| **REQ-90** | Consumer processes event & commits inbox atomically | `WP021-REQ-88to92 (Assertion 3)` | `packages/cloud-server/src/billing.test.ts` | `npm test --workspace=@trident/cloud-server` | 0 | PASS |
| **REQ-91** | Replay/redelivery suppressed via deduplication | `WP021-REQ-88to92 (Assertion 4)` | `packages/cloud-server/src/billing.test.ts` | `npm test --workspace=@trident/cloud-server` | 0 | PASS |
| **REQ-92** | Consumer restore-domain reconciliation | `WP021-REQ-88to92 (Assertion 6)` | `packages/cloud-server/src/billing.test.ts` | `npm test --workspace=@trident/cloud-server` | 0 | PASS |

---

## 5. Commands Executed and Verification Results

| Step | Command Line | Exit Code | Summary |
| :--- | :--- | :--- | :--- |
| **Build** | `npm run build` | `0` | All 12 monorepo packages compiled cleanly with TypeScript composite projects. |
| **Lint** | `npm run lint` | `0` | ESLint passed with 0 errors across all packages. |
| **Typecheck** | `npm run typecheck` | `0` | TypeScript `tsc --noEmit` passed with 0 type errors. |
| **Format Check** | `npm run format:check` | `0` | Prettier code style verified across the entire codebase. |
| **Graph Check** | `npm run graph:check` | `0` | Architectural boundary and dependency graph check passed (44 tests). |
| **Billing Tests** | `npm test --workspace=@trident/billing` | `0` | 44/44 unit tests passed (Numerics, RFC, Tax, CFDI, Signer, Provenance, Versioning, XML, Error Sanitizer). |
| **Database Tests** | `npm test --workspace=@trident/database` | `0` | 328/328 database integration and migration tests passed. |
| **Cloud Server Tests** | `npm test --workspace=@trident/cloud-server` | `0` | 141/141 cloud server integration tests passed. |
| **Full Suite** | `npm test` | `0` | All workspace tests + integration E2E suite passed with 0 failures. |
| **Secret Scan** | `grep -rnE "(BEGIN.*PRIVATE KEY\|password\s*[:=])"` | `0` | Verified 0 leaked production secrets; only redaction assertions matched. |

---

## 6. Security & Governance Assertions

1. **PAC Selection:** PAC remains unselected (`PAC_SELECTED=NO`). No real PAC credentials configured. `UnavailablePacConnector` and `MockPacConnector` used for runtime and testing fail-closed guarantees.
2. **Open Questions:** `OQ-ARCH-02` remains `OPEN` (`OQ_ARCH_02=OPEN`). Batch candidate query infrastructure implemented without premature closure of operational batch policy.
3. **Project Manifest:** `project-manifest.json` is completely unchanged (`PROJECT_MANIFEST_CHANGED=NO`).
4. **Historical Subject:** Historical frozen R4 commit `fa4545c5dd6491bac473d959635b27015b804911` is untouched and immutable (`HISTORICAL_R4_IMMUTABLE=YES`).
5. **Secret Persistence:** Plaintext private keys and credentials are never persisted in PostgreSQL tables, outbox records, diagnostics, or public DTOs.
6. **Role Boundary:** Builder role (`13_Backend_Developer`) strictly preserved. No PR opened, no merge performed, no independent review verdicts emitted.

---

## 7. Residual Risks & Technical Debt

1. **PAC Integration Readiness:** Full production PAC adapter will require actual PAC capability provenance attestation signed by the security governance authority when a vendor is accredited.
2. **Global Invoicing Consolidation Policy:** Operational scheduling of `lotes_facturacion_global` remains governed under `OQ-ARCH-02`.
