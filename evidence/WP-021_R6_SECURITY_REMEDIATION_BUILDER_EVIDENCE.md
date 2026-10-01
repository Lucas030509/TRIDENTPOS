# WP-021 Security Remediation R6 — Builder Evidence

## Role and exact authority
Role: 13_Backend_Developer / Builder only; EAAF v1.3.0.
Framework SHA: 167cea36c09c1031c763971ff790db2e0d0f7362.
Source SHA/direct implementation parent: 36ba35baea8aa88143dbd5b3993589c9adf9abd6.
Historical R4: fa4545c5dd6491bac473d959635b27015b804911.
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
Branch: feat/wp-021-security-remediation-r6 (local; not pushed).
Reloaded authority: 417ca6253711d740201c6597a7f7b5b321615930.
Reloaded historical preflight HOLD: 921c5725a22c947cbc3a244330f02e1abdab5836.
Reloaded explicit accounting exception: 136c651f05352af61d87620c478f0cb007f328cc.
Reloaded independent Security report: Markdown pegado.md, Library libfile_c1084c97db988191a9e26217980023e8, exact subject 36ba35ba...; Security HOLD, Critical=0, High=7 PARTIAL, Medium=1 PARTIAL.
Read pinned agents/implementation/13_Backend_Developer.md and canonical ACR-2026-020 requirements before freeze.
Exactly ONE implementation iteration and ONE new freeze. Local edit/check passes within this iteration are not new implementation candidates or CI runs.

## Governing boundaries
No main, manifest, budget or canonical architecture changes. Both earlier subjects remain immutable.
Historical accounting is NOT MECHANICALLY VERIFIED; obligation remains open under the explicit human exception. No counters invented, reduced or reset. No independent excess was established in this operation; any subsequently established excess requires STOP and a new human decision.
PAC_SELECTED=NO; OQ_ARCH_02=OPEN.
Production registry, PAC, external sink and replay-retention approval are not accredited by test fixtures.

## Finding-to-change traceability (Builder claims, not independent resolutions)
| Finding | Changes | Executable evidence / limits |
|---|---|---|
| HIGH-01 | SHA-256 bytes and media mandatory; provider/exact operation/capability/tenant/recovery binding; RSA signature checks of approval and current revocation; fail closed on absent trust/freshness; current registry read for each use; registry-owned durable atomic sequence contract; stamp lookup also guarded | Billing REQ-81..87 uses genuine RSA signatures, forged signatures, missing/changed bytes, media mismatch, revocation after success, stale/future status and rollback; test registry is simulation; production registry remains unavailable |
| HIGH-02 | Strict canonical version syntax and safe integers; no consumer default; required-field/subscriber checks; reconciliation STAMP version; immutable operation event envelope and outbox payload; original-envelope replay | REQ-75..79 unit assertions; REQ-80 SQL envelope/recreation/immutability and retry test; native PITR NOT EXECUTED |
| HIGH-03 | DOWN checks every affected table, locks all before counts and sets row_security=off so hidden rows cannot be silently ignored; additive migration also protects recovery truth | SQL table-by-table guard tests and non-bypass role with hidden rows; native PostgreSQL runner NOT EXECUTED |
| HIGH-04 | XML namespaces, exact placement, duplicate and expanded attributes, bounded size/depth, CFDI/TFD versions and metadata; provider RFC; original submitted XML pin; full tenant/invoice/operation/request/idempotency correlation; organization-controlled authenticated result verifier; CANCEL uses received UUID; IN_FLIGHT requires reconciliation | XML abuse unit tests; real X509/RSA simulated provider STAMP/CANCEL SQL tests; wrong-tenant result blocked; no production PAC contract proof |
| HIGH-05 | Public fiscal configuration rejects PEM/username/password/token fields and unknown command fields; stores only vault refs and NULL PEM; DTO returns no PEM; CSD certificate/key fetched only at the internal vault signing boundary | SQL ingress tests show rejection before persistence and safe DTO; cryptographic fixture secrets are test-only, not production API inputs |
| HIGH-06 | Inbox reservation and business effect share SQL transaction; conflicting semantic replay rejected; metadata-only restore cannot mark inbox; durable-source interval/retention and ack-independent replay required; explicit SQL effect mode; governed horizon required; verify SQL effect on restored duplicates; unapproved external effects BLOCKED BY CONTRACT | REQ-88..92 SQL effect/inbox rollback simulations and replay, missing-effect retained-inbox block, insufficient retention, prior acknowledgment, failure rollback, tenant RLS; physical/native PITR and native concurrency NOT EXECUTED |
| HIGH-07 | Replaced misleading REQ-labelled tests with canonical semantics; new unit evolution/trust matrix and SQL recovery assertions; adjusted legacy tests to stricter API and schema | Canonical coverage listed below; labels are not substitute for assertions; simulation and native limitations explicit |
| MED-01 | Opaque error messages, allowlisted domain codes/generated correlation, no blacklist dependence; sanitize persisted reconciliation/rejection/pending paths and external rethrows; crypto/XML/version errors avoid echoing raw material | JSON/JWT/encoded/multiline/PEM unit canaries and SQL provider error canary persistence/external exception test |

## Checks executed
| Command | Result |
|---|---|
| npm run build | PASS; 12 tasks |
| npm run lint | PASS; 0 errors, existing/new any warnings remain (cloud 25 warnings) |
| npm run typecheck | PASS; 20 tasks |
| npm test --workspace=@trident/billing | PASS; 45/45 tests |
| npm run graph:check | PASS; 44 tests |
| npm run format:check | PASS |
| git diff --check | PASS |
| env -u DATABASE_URL npm test --workspace=@trident/cloud-server | Invocation FAIL/exit 1: DATABASE_URL absent; native DB scenarios NOT EXECUTED |
| env -u DATABASE_URL npm test --workspace=@trident/database | Invocation FAIL/exit 1: DATABASE_URL absent; native DB scenarios NOT EXECUTED |
| WP021_TEST_DATABASE_ADAPTER=file:///.../adapter.mjs node --test --test-concurrency=1 tests/integration/wp021-security-remediation.test.mjs | PASS; 16/16 against PGlite 0.5.8 PostgreSQL WASM SQL engine; SQL engine simulation, not native PostgreSQL 16 |

Native PostgreSQL binaries were acquired into scratch only, but initdb cannot run under the environment's sole mapped UID 0. Socket-based PGlite attempts did not establish native runner execution and are not counted as PASS. The direct PGlite adapter enabled actual SQL constraints, RLS, transactions and triggers in targeted tests. It does not prove native multi-connection scheduling, crashes, physical backups or PITR.
The root npm test aggregate/native full regression is NOT EXECUTED successfully and is not claimed PASS.

## Canonical REQ-75..92 coverage
75 strict syntax and identity/version independence; 76 optional minor evolution and same-major consumer; 77 breaking meaning/new required field major increment; 78 missing/malformed/unsupported version and required payload rejection before mutation; 79 required subscriber compatibility.
80 actual SQL persisted envelope, retry field update, outbox recreation and immutable triggers. Migration executed in the SQL test schema. Native PITR remains NOT EXECUTED.
81 genuine cryptographic approval; 82 authority/signature/bytes/media/length failures; 83 absent/inverifiable approval; 84 revocation/supersession/expiry after earlier positive; 85 provider/operation/capability/recovery/tenant mismatches; 86 invalid bounds/current state freshness/signature/rollback; 87 per-operation/recovery capability matrix.
88 paired SQL rollback simulation then durable-source replay; 89 inconsistent or absent restore evidence and retained-inbox/missing-effect block; 90 source coverage/retention/unavailability/cross-tenant block; 91 consumer-only rollback after prior ack with new source read and one effect; 92 external effect without proven durable idempotency BLOCKED BY CONTRACT.

## Residual implementation and execution limits
- No production PAC/registry is selected or configured. The default runtime fails closed. PacAuthorizationRegistry is a protected-composition integration boundary; its acceptSequence must be implemented durably/atomically and fiscal result verification must validate authenticated provider evidence under the approved contract. In-memory fixtures do not meet production obligations.
- Consumer restoration requires governing horizon configuration, consumer-owned effect verification, and a durable source with approved coverage independent of transport acknowledgments. Unknown approval/retention is blocking. No production replay source is accredited here.
- Non-transactional effects remain BLOCKED BY CONTRACT, rather than asserting an idempotency guarantee from mocks.
- Existing R5 test databases with the older modified WP-021 migration checksum will be rejected by the migration runner. No ledger/checksum rewrite, data destruction or upgrade of an installed environment was performed or authorized. The original candidate migration is unmerged implementation code; this change does not alter either frozen Git subject. Installed-state reconciliation requires its own governed procedure.
- Native PostgreSQL 16 full suites, native crash/PITR, concurrent deliveries and production provider guarantees remain NOT EXECUTED / NOT PROVEN.
- Builder does not declare findings independently RESOLVED, Security PASS, Code Review approval, PR approval or merge authority.

## Changed files
- packages/billing/src/csd-signer.ts
- packages/billing/src/error-sanitizer.ts
- packages/billing/src/index.test.ts
- packages/billing/src/pac-connector.ts
- packages/billing/src/security-remediation.test.ts
- packages/billing/src/types.ts
- packages/billing/src/xml-validator.ts
- packages/cloud-server/src/billing-test-fixtures.ts
- packages/cloud-server/src/billing.test.ts
- packages/cloud-server/src/index.ts
- packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql
- packages/database/migrations/20261001000000_wp021_security_event_integrity.sql
- packages/database/src/billing.test.ts
- tests/integration/wp021-security-remediation.test.mjs
- evidence/WP-021_R6_SECURITY_REMEDIATION_BUILDER_EVIDENCE.md

## Execution log SHA-256
```json
{
  "wp021-r6-billing.log": "5f3b155c7d9100299484a6012da4740424e022dde937f539e586f13fab6b3f0d",
  "wp021-r6-build.log": "357819db82d673afb6006e3b90e37979611a130245941e66072caee64203e66c",
  "wp021-r6-cloud-server-native.log": "ce840985691ed542f0935b3e4e674dfc4ee472456992405ae9a717bc5eb31128",
  "wp021-r6-database-native.log": "00a0db50b68116235e163179a14c62985ca0d1c360cbb85a33033ae316e8587f",
  "wp021-r6-format-check.log": "89a0d19f8fd5c46b54c8dfdaf758622b97c0289f7813bd4280ceafca4d91c826",
  "wp021-r6-format.log": "45d4ea46ee5c134a771daf91d052fa8fe36be49d63e7824144cd48b3253c8f2c",
  "wp021-r6-graph.log": "391b9633e7f1cd72218434506c1a12d9790b0ebeb6312f7f6338a3f46fd2cdbe",
  "wp021-r6-lint.log": "44feb5ae4a09273a6b086871d5910ada7d923961fd9d0ffd2b7abf5505d386f6",
  "wp021-r6-sql-targeted.log": "db7aa07f7642741989e0b4e90bcd1fcbb14b5a2317b86fa33dba035f7b2bdb51",
  "wp021-r6-typecheck.log": "e47554b93f54d6efa6fa22263b39d57a9c70bb48a35ff2ad5f8eda402c443d0e"
}
```

## Freeze and handoff
The commit containing this evidence is the sole Frozen R6 candidate; its SHA is reported in the external mechanical freeze record/transport artifact (avoids self-referential commit SHA).
After commit/freeze, Builder MUST STOP. This consumes the one authorization in 417ca625...; 136c651f... adds no second iteration.
Next role: Governance Coordinator & Quick Integrity Verifier for the new SHA, then independent 08_Security_Architect. ONLY a future Security PASS permits Code Reviewer.

STATUS=IMPLEMENTATION READY FOR REVIEW
SOURCE_SECURITY_GATE=HOLD
NEW_SUBJECT_SECURITY_GATE=NOT_REVIEWED
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
CODE_REVIEW_AUTHORIZED=NO
PR_APPROVAL=NOT_AUTHORIZED
MERGE_AUTHORIZED=NO
