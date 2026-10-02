# WP-021 R6 — Independent Security Gate

## Scope
Gate: SECURITY_GATE. Reviewer: EAAF:08 / 08_Security_Architect (independent reviewer activation; did not author this candidate). Review completed 2026-10-02 UTC. Risk: RC4, fiscal authority, secrets, tenant isolation and restore/replay boundaries.
Repository: Lucas030509/TRIDENTPOS.
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362.
Frozen subject: 83dd38b9773acee4d5a56d439ad2d3e959b000d2.
Subject ref: refs/heads/feat/wp-021-security-remediation-r6 (bundle ref; publication not established).
Tree: bbb19289a1829c47118fc8aec71ad2593523a47a.
Direct parent: 36ba35baea8aa88143dbd5b3993589c9adf9abd6.
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
Scope exclusively HIGH-01..07 and MED-01, canonical invariants and REQ-75..92. No Builder, Code Reviewer or human authority action. No candidate/main/manifest/architecture edits.

## Sources
Reloaded pinned registry/AGENTS.yaml; resolved ID 08 to agents/architecture/08_Security_Architect.md (profile itself says Version 1.2.0; used the bytes in pinned v1.3 framework); registry/GATES.yaml; gates/SECURITY_GATE.md; templates/GATE_EVIDENCE_TEMPLATE.md; framework/EVIDENCE_REQUIREMENTS.md; framework/EXECUTION_CIRCUIT_BREAKERS.md.
Reloaded governance commits 417ca6253711d740201c6597a7f7b5b321615930, 921c5725a22c947cbc3a244330f02e1abdab5836 and 136c651f05352af61d87620c478f0cb007f328cc through authenticated GitHub reads. They are separate sidecars, absent from subject bundle ancestry; that absence was not interpreted as absent authorization.
Recovered original Security R5 report from Markdown pegado.md, libfile_c1084c97db988191a9e26217980023e8: full 309 lines, 18,584 bytes, exact R5 subject 36ba35ba...; seven High PARTIAL and one Medium PARTIAL. It is a historical input, not execution evidence for R6. Original R4 raw fingerprints and complete ledger remain unavailable, as documented by governance; this review does not fabricate them.
Read frozen evidence/WP-021_R6_SECURITY_REMEDIATION_BUILDER_EVIDENCE.md, all changed implementation/test/migration files and relevant surrounding billing/runtime/consumer composition. Read canonical ARCHITECTURE_CHANGE_REQUEST_WP021_PAC_RECONCILIATION.md §§4.1, 14.2, event/subscriber rules and acceptance 75–92. ACR and manifest equal canonical base.

## Findings
Results below distinguish closure of a bounded implementation defect from production accreditation. No security risk acceptance exists. Paths relative to subject repository. Fingerprints are explicit normalized four-component tuples (gate/reviewer | invariant | artifact/path | failure class); not claimed byte-identical to missing original R4 fingerprints.

### SEC-WP021-R4-HIGH-01 — RESOLVED within reviewed implementation boundary
Paths: packages/billing/src/pac-connector.ts (validatePacCapabilityProvenance, authorizePacCapabilityUse), packages/cloud-server/src/index.ts (authorizeCapability and lookup/dispatch call sites), packages/billing/src/security-remediation.test.ts.
Expected: authenticated exact bytes/media/length/digest and exact provider/contract/operation/capability/recovery/tenant binding; current signed status and fail-closed freshness/sequence before every lookup/replay/dispatch.
Actual: byte/media checks mandatory; RSA verification with organization-controlled authorities, exact scope, validity and current registry reads; registry acceptSequence contract; lookup guarded. Independently rerun positive/negative signature, scope, stale/future/revoked/rollback and table-driven matrix tests PASS. Missing registry fails closed. E1+E2.
Limitation: durable/atomic registry implementation is an external protected composition contract, not supplied or proven. In-memory fixtures prove validation behavior only, never production revocation continuity across restarts. No production capability accredited.
Fingerprint: SECURITY_GATE/08 | authenticated current PAC provenance | packages/billing/src/pac-connector.ts;packages/cloud-server/src/index.ts | incomplete trust/provenance/revocation enforcement.

### SEC-WP021-R4-HIGH-02 — PARTIAL, OPEN HIGH (blocking evidence)
Paths: packages/billing/src/types.ts; packages/cloud-server/src/index.ts (enqueueFiscalEvent, recreateFiscalEventOutbox, ConsumerInboxService); packages/database/migrations/20261001000000_wp021_security_event_integrity.sql; tests/integration/wp021-security-remediation.test.mjs.
Expected: strict version/required-payload/subscriber enforcement and original envelope preservation in retry/recreation/migration/PITR.
Actual: missing default removed, strict safe-integer syntax and subscriber guards present; STAMP reconciliation propagates version; persisted envelope and immutable triggers tested with SQL. Canonical unit assertions and targeted REQ-80 SQL simulation PASS. E1/E2 plus PGlite SQL simulation.
Limitation: native populated predecessor migration and physical PITR/recovery preservation NOT EXECUTED. REQ-80 requires preservation across these paths; SQL recreation plus manual rollback is insufficient to close full invariant. Production subscriber topology is not accredited by supplied fixtures. No missing-version runtime bypass reproduced in R6.
Fingerprint: SECURITY_GATE/08 | compatible eventContractVersion end-to-end | packages/billing/src/types.ts;packages/cloud-server/src/index.ts;packages/database/migrations/20261001000000_wp021_security_event_integrity.sql | incomplete propagation/compatibility/preservation proof.

### SEC-WP021-R4-HIGH-03 — PARTIAL, OPEN HIGH (native safety evidence)
Paths: packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql (Down); packages/database/migrations/20261001000000_wp021_security_event_integrity.sql (Down); tests/integration/wp021-security-remediation.test.mjs.
Expected: refuse loss of every populated fiscal/recovery table even under hidden RLS rows/concurrent writers.
Actual: original DOWN locks all seven affected tables before counts, disables row_security locally and raises before drops; additive DOWN guards operation/inbox. Table-by-table guard and hidden-row non-bypass role tests PASS in PGlite. E1 and SQL simulation. R5 omission of the other tables corrected.
Limitation: native PostgreSQL migration role, multi-connection scheduling/locks and installed-state migration/checksum drift not validated. Simulation adapter returns clients sharing a single engine; cannot establish lock interleavings. No destructive migration run on any installed environment. Native safety proof remains outstanding.
Fingerprint: SECURITY_GATE/08 | preserve populated fiscal/recovery truth on DOWN | packages/database/migrations/20260905030000_billing_fiscal_invoicing.sql | incomplete destructive migration safety proof.

### SEC-WP021-R4-HIGH-04 — PARTIAL, OPEN HIGH (reproduced defect)
Paths: packages/billing/src/xml-validator.ts:328–340 (normalize), parseAttributes/parseNode; packages/cloud-server/src/index.ts (validateFiscalEvidence, validateAuthoritativeStampResult, STAMP/CANCEL reconciliation).
Expected: preserve original submitted fiscal XML except legitimate TFD addition; well-formed XML and authoritative tenant/invoice/request/idempotency-correlated fiscal evidence.
Actual improvements: namespace/placement/duplicate checks, limits, provider RFC, correlation and organization-controlled verification callback; cancellation compares received UUID. Existing wrong-tenant and success tests PASS.
Independent A1: original payment complement Monto=100 changed to Monto=999999; validateAndExtractTimbreFiscalDigital with expectedOriginalXml and expectedProvider accepted it. normalize filters every child named Complemento, discarding original business complement content. This proves the comparator does not pin the full submitted invoice. It does not claim a production PAC signed the mutation; authenticity callback does not itself implement submitted-document preservation.
Independent A2: parseXmlStructure accepts <root a="1"b="2">unescaped & text</root>, lacking required attribute separator and containing raw ampersand. Custom parser does not guarantee XML well-formedness.
Both deterministic checks reproduced with exit 0 in adversarial.mjs, meaning defect reproduction succeeded. E2. Forged namespaces/duplicate attributes are correctly rejected by current tests; that does not close these cases. Production PAC/SAT signature/certificate chain validation remains unaccredited.
Fingerprint: SECURITY_GATE/08 | authoritative correlated STAMP/CANCEL result | packages/billing/src/xml-validator.ts;packages/cloud-server/src/index.ts | incomplete fiscal result identity/content validation.

### SEC-WP021-R4-HIGH-05 — RESOLVED within reviewed public ingress boundary
Paths: packages/billing/src/types.ts; packages/billing/src/csd-signer.ts; packages/cloud-server/src/index.ts (configureEmisorFiscal and DTO); tests/integration/wp021-security-remediation.test.mjs.
Expected: public configuration contains vault references, no plaintext-equivalent private-key/certificate secret channel or DTO leak.
Actual: allowlisted command keys reject certificatePem/username/password/token inputs; vault reference shape validated; SQL stores NULL PEM; DTO omits PEM; internal signing retrieves certificate/key through vault. Independent supplied SQL ingress and DTO test PASS. E1 and PGlite SQL simulation.
Limit: internal plaintext key lifetime remains part of signing boundary; no production vault/rotation/operational guarantee asserted. No claim that arbitrary text fields can detect every encoded secret; the removed dedicated secret channel is the closure reviewed.
Fingerprint: SECURITY_GATE/08 | no plaintext-equivalent secret ingress | packages/billing/src/types.ts;packages/cloud-server/src/index.ts | secret material allowed through public ingress.

### SEC-WP021-R4-HIGH-06 — PARTIAL, OPEN HIGH (reproduced defect)
Paths: packages/cloud-server/src/index.ts:6697–6810 (processEventWithInbox), 6839–6926 (reconcileConsumerRestore), 6649–6678 (replay/plan interfaces).
Expected: restore consistency gate, durable-source replay and transactional SQL effects; non-transactional effect either durably idempotent by semanticEventId or BLOCKED BY CONTRACT (REQ-92).
Actual improvements: SQL inbox reservation before handler in same transaction; conflict comparison; explicit restore policy/source interval; required verifyEffect during restore; supplied rollback/replay/retention tests PASS in PGlite.
Independent A3: direct EXTERNAL delivery correctly blocks, but reconcileConsumerRestore unconditionally sets effectMode='TRANSACTIONAL_SQL'. Replay interface has no integration-effect classification or durable-idempotency proof. A supplied external handler increments externalCalls, then verifier throws (simulated database-side failure). SQL inbox rolls back; second restore calls handler again. Actual externalCalls=2 and inbox count=0. No durable sink proof existed. This demonstrates missing enforcement on recovery composition and possible duplicate external effects; no live external system was contacted. E2 with PGlite transaction execution.
Independent A4: insert SQL effect/inbox, delete only effect, ordinary redelivery without optional verifyEffect returns duplicate=true and never invokes handler; effect remains absent. Explicit reconcileConsumerRestore with verifier blocks this case in supplied tests, but ordinary replay does not require recovery-state gate/verifier. This is a qualified coverage/restore-gating limitation, not a claim that paired restore is defective.
Native crash/PITR/concurrency and production durable replay source NOT EXECUTED/NOT ACCREDITED.
Fingerprint: SECURITY_GATE/08 | durable replay and inbox/business-effect consistency | packages/cloud-server/src/index.ts;consumer_inbox_events | restore-domain inconsistency/external idempotency enforcement gap.

### SEC-WP021-R4-HIGH-07 — PARTIAL, OPEN HIGH
Paths: packages/billing/src/security-remediation.test.ts; tests/integration/wp021-security-remediation.test.mjs; packages/cloud-server/src/billing.test.ts; packages/database/src/billing.test.ts; frozen Builder evidence.
Expected: executable canonical REQ-75..92 proof including actual integration boundaries needed for each guarantee.
Actual: labels now largely match canonical semantics; 45 Billing tests PASS and separate subset 14 PASS (overlapping, not 59 unique tests); 16 SQL tests PASS with PGlite. However REQ-92 test invokes direct delivery only, omitting restore path reproduced by A3; XML tests omit A1/A2. Native full regression, concurrency and PITR absent. Evidence cannot prove guarantees falsified by independent counterexamples. Test exit codes alone do not close this finding.
Fingerprint: SECURITY_GATE/08 | executable canonical REQ-75..92 evidence | packages/billing/src/security-remediation.test.ts;tests/integration/wp021-security-remediation.test.mjs | insufficient requirement proof.

### SEC-WP021-R4-MED-01 — RESOLVED within reviewed fiscal error boundary
Paths: packages/billing/src/error-sanitizer.ts; packages/cloud-server/src/index.ts (dispatch/reconciliation/rejection/pending error paths).
Expected: no raw PEM/password/token/encoded/multiline provider material persisted or rethrown.
Actual: opaque message, allowlisted code and generated correlation replace untrusted text; lookup catches opaque; persisted reconciliation and rejection strings sanitized; gateway/validation catches rethrow safe messages. Unit canaries and SQL provider error canary tests PASS; independent A5 JSON/JWT/multiline/PEM cases PASS. E1/E2 and PGlite SQL simulation. This is bounded fiscal error handling, not application-wide secret scanning certification.
Fingerprint: SECURITY_GATE/08 | no secret leakage through fiscal errors | packages/billing/src/error-sanitizer.ts;packages/cloud-server/src/index.ts | incomplete sanitization/call-site coverage.

## Evidence
Mechanical identity independently verified: bundle SHA-256 875cb7d3fbbd7c12b64bef2953ba4ab11ec38b5355ca1248b282dc136d3cd98f; bundle verify exit 0; exact subject/tree/parent/ref; ancestor R5/R4/base exit 0; fsck exit 0; one implementation commit; exact 15 changed files; ten supplied execution-log hashes match frozen Builder evidence. Subject tracked tree clean after tests. mechanical.json records hashes and checks.

| Executed check | Expected | Actual | Level/limitation |
|---|---|---|---|
| npm ci --offline --ignore-scripts --no-audit --no-fund | install dependencies | exit 1, incomplete cache | environment, not test failure |
| npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000 | install pinned dependencies | exit 0 | no source edit |
| npm run build | compile candidate | exit 0 | independent build.log |
| npm test --workspace=@trident/billing | unit regressions | exit 0, 45/45 | E2, billing.log |
| node --test packages/billing/dist/security-remediation.test.js | canonical subset | exit 0, 14/14 | E2, overlapping subset |
| explicit PGlite 0.5.8 adapter + node --test --test-concurrency=1 tests/integration/wp021-security-remediation.test.mjs | targeted SQL assertions | exit 0, 16/16 | SQL simulation, not native E3 |
| node review/adversarial.mjs | reproduce gaps, test opaque errors | exit 0; A1–A4 reproduced, A5 safe | E2 plus PGlite SQL simulation; adversarial.log |
| env -u DATABASE_URL npm test --workspace=@trident/cloud-server | native suite | exit 1, DATABASE_URL absent | native scenarios NOT EXECUTED |
| env -u DATABASE_URL npm test --workspace=@trident/database | native suite | exit 1, DATABASE_URL absent | native scenarios NOT EXECUTED |

Independent review did not rerun lint/typecheck/graph/format; supplied logs' integrity verified, their results remain Builder execution evidence. Native PostgreSQL concurrency, physical crash/PITR and full native regression NOT EXECUTED. No production PAC, registry, vault, replay source or external sink accreditation. Test fixtures with genuine RSA/X509 are still simulations.

| Canonical REQ | Independent result for reviewed scope |
|---|---|
| 75–77 | strict syntax and evolution functions E2 PASS; not a production schema registry certification |
| 78–79 | guards E1/E2 and SQL simulation PASS; runtime subscriber composition coverage limited |
| 80 | PARTIAL: SQL envelope/recreation verified, physical PITR and populated native migration unproven |
| 81–87 | validation behavior E1/E2 PASS within fail-closed protected-registry boundary; production registry/provider durability unaccredited |
| 88 | PARTIAL: paired SQL rollback/replay simulated; native restore unproven |
| 89 | PARTIAL: explicit reconcile blocks inconsistent effect, ordinary replay can suppress missing effect without verifier (A4) |
| 90 | source retention/completeness guards simulated; source guarantees and approved productive horizon unaccredited |
| 91 | ack-independent source re-read simulated; physical consumer restore unproven |
| 92 | NOT SATISFIED across recovery path: A3 duplicate external effect without durable idempotency |

Evidence persistence backend: GIT_SIDECAR, separate evidence-only commit/ref based on canonical base, bound by subject SHA in this report. Published commit/ref and archive digests must accompany the handoff. Library/local file alone is not EAAF immutable persistence. This report does not claim a persistence identifier before the backend returns one.

## Risks
Five High findings remain open: HIGH-02/03 due required evidence limits, HIGH-04/06 with reproduced defects, HIGH-07 insufficient canonical coverage. HIGH-01/05 and MED-01 close only bounded reviewed implementation defects, not provider readiness. No new Critical established; this is not a global vulnerability-free assertion. Authenticated provider data can still fail full-document binding. Recovery handler composition lacks external-effect enforcement. RLS guard simulation is useful but cannot prove native lock scheduling or PITR.
Modified unmerged initial migration can conflict with existing installed checksum; installed-state reconciliation needs its own governed procedure. No checksum/ledger was rewritten.

## Open Decisions
PAC_SELECTED=NO; OQ_ARCH_02=OPEN. Productive PAC/registry/source and Data-approved restore horizon remain unaccredited. Historical accounting remains OPEN_NOT_VERIFIED. One Builder authorization consumed. No counters invented/reset/reduced. R5-to-R6 semantic continuation of HIGH-04/06/07 recorded; original R4 fingerprints and complete ledger missing, so no fabricated numeric accumulated recurrence or proven-excess assertion. Governance must reconcile history and STOP on any subsequently accredited excess. Any additional implementation requires explicit human disposition; this review grants none.

## Handoff
STOP. Route this immutable HOLD evidence to Governance Coordinator and authorized human decision process. No handoff to EAAF:11. No remediation, new Builder iteration, Code Review, PR, merge, staging or production authorized. Other gates not executed because this is exclusively Security review.

## Status
SECURITY_GATE=HOLD
SUBJECT_SHA=83dd38b9773acee4d5a56d439ad2d3e959b000d2
HIGH_OPEN=5
HIGH_WITH_REPRODUCED_IMPLEMENTATION_DEFECT=2
HIGH_WITH_EVIDENCE_COVERAGE_GAP=3
MEDIUM_OPEN=0
HISTORICAL_ACCOUNTING=OPEN_NOT_VERIFIED
CONTROL_STATE=HUMAN_DECISION_REQUIRED_FOR_FURTHER_IMPLEMENTATION
BUILDER_ITERATION_CONSUMED=YES
CODE_REVIEW_AUTHORIZED=NO
PR_APPROVAL=NOT_AUTHORIZED
MERGE_AUTHORIZED=NO
STAGING_AUTHORIZED=NO
PRODUCTION_AUTHORIZED=NO
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
