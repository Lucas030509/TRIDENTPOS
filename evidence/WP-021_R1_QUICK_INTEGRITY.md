# WP-021 R1 — QUICK INTEGRITY REVIEW

**Repository:** Lucas030509/TRIDENTPOS  
**Canonical Baseline:** `26b606ad73acc37263a610dc9f0c979291b810a6`  
**Frozen Subject:** `5c0d6fef728535db85aae7f52c2430f768938ba8`  
**Branch Reviewed:** `feat/wp-021-fiscal-invoicing-engine`  
**Risk:** RC4  
**Result:** HOLD

## Subject integrity
- Remote feature tip equals Frozen Subject: PASS.
- Frozen Subject is direct child of canonical baseline: PASS.
- Candidate is ahead 1 / behind 0: PASS.
- Canonical `main` remains at baseline: PASS.
- Governing documents modified by candidate: NO.

## Canonical WP requirements verified
WP-021 requires, among other things:
- XML CFDI 4.0 generation/validation;
- CSD private-key secure-vault integration;
- provider-neutral PAC connector;
- PAC circuit breaker;
- PAC timeout handled with **queued retry without duplicating stamp request**;
- protected `OQ-ARCH-02` remains neutral regarding manual vs scheduled batch trigger.

## Blocking findings

### QI-BLK-021-R1-01 — CSD secure-vault requirement is not implemented and signing fails open
Canonical WP-021 output requires CSD private-key secure-vault integration and acceptance requires signing with the private key decrypted in memory.

Observed implementation:
- `ICsdVault` / `InMemoryCsdVault` exist only as abstractions/test memory storage.
- `PostgresBillingService.stampFiscalInvoice()` accepts `command.csd?.privateKeyPem` directly.
- The persisted `private_key_vault_id` is not resolved through a vault during stamping.
- If signing throws, code substitutes `SELLO_EMISOR_MOCK` and continues.

Impact:
A missing/bad CSD key can still proceed toward a nominal fiscal stamp with a fabricated emitter seal. This violates fail-closed fiscal/security behavior and does not satisfy SEC-VAL-05.

Required remediation:
- inject/use an approved fail-closed CSD vault boundary;
- resolve credentials by persisted vault reference;
- decrypt/use private key only in memory;
- remove production fallback to mock seal;
- signing/vault failure must abort stamping with no fiscal-success state.

### QI-BLK-021-R1-02 — Default runtime PAC is a Mock that can fabricate fiscal success
Observed constructor:
`PostgresBillingService(..., pacConnector: IPacConnector = new MockPacConnector(), ...)`.

The Mock PAC can synthesize UUID, SAT seal, certificate number and stamped XML, while the real provider contract is explicitly pending.

Impact:
The default runtime composition can represent fabricated PAC/SAT outcomes as `STAMPED`. A provider-neutral core may include a mock for tests, but production/composition must fail closed unless an explicitly injected approved PAC adapter is configured.

Required remediation:
- remove `MockPacConnector` as default production/composition dependency;
- require explicit connector injection or a fail-closed unavailable-provider adapter;
- keep mock only in test composition;
- do not hard-code `MOCK_PAC` into persisted/runtime success mapping or emitted production event data.

### QI-BLK-021-R1-03 — Required durable queued retry on PAC timeout is absent
Canonical acceptance criterion:
“handles PAC timeouts with queued retry without duplicating stamp request.”

Observed implementation:
- PAC timeout throws `PacTimeoutError`;
- transaction rolls back/leaves invoice DRAFT;
- test verifies only that invoice remains DRAFT;
- no durable PAC stamping request/retry queue is created;
- no persisted retry state was found.

Impact:
The explicit acceptance criterion is not met.

Required remediation:
Implement a durable, idempotent retry mechanism for stamping requests with stable semantic request identity and evidence that timeout/retry does not create duplicate fiscal stamping.

### QI-BLK-021-R1-04 — External side effect is not crash-safe / durable-idempotent
`stampFiscalInvoice()`:
1. opens tenant DB transaction;
2. locks invoice FOR UPDATE;
3. performs external PAC call;
4. only after external success persists UUID/stamped state;
5. commits later.

If PAC succeeds and the process/DB transaction fails before durable commit, the authoritative local state remains unstamped while the external fiscal side effect may already exist.

Current mock idempotency is an in-memory `Map`, not durable across process restart, and the concrete PAC idempotency contract is still pending.

Impact:
A retry after an ambiguous success window can issue another external request without durable proof that the same fiscal operation is being reconciled. This contradicts the WP's no-duplicate retry requirement.

Required remediation:
Introduce a durable stamping-operation/idempotency record and explicit reconciliation state/protocol for the “PAC may have succeeded, local commit unknown/failed” window. Do not rely on in-memory mock caching.

## OQ-ARCH-02
PASS for neutrality at this Quick Integrity stage:
- Canonical OQ explicitly permits batch grouping capability while leaving manual vs scheduled trigger unresolved.
- Candidate does not appear to install an automatic scheduler/trigger.

Advisory:
`createGlobalInvoiceBatch()` derives `periodEnd` as day 28 and `queryUnclaimedFiscalFolios()` currently calls the pure selector with an empty input set. Specialist/code review should verify these are not incorrectly represented as complete production batch behavior.

## Builder evidence accuracy
HOLD:
Builder evidence states:
- “Fiscal Secrets Handling: PASS”
- timeout/idempotent behavior as implemented
- secure-vault integration

Those statements are stronger than the code supports for the blockers above.

## Gate decision
**HOLD**

Do not proceed to Security Specialist Review or Code Review on this subject. Remediate first and freeze a new direct-child remediation branch/subject according to EAAF iteration rules.

**Next Gate:** BUILDER REMEDIATION R2 → CHATGPT QUICK INTEGRITY RE-REVIEW
