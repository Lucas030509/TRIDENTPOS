# WP-016 / DEC-017 — PR #65 — Code Review R1
Reviewer: 11_Code_Reviewer, independent ChatGPT review instance (not Builder).
Round: 1 of maximum 2. Profile: EAAF Lean per activation.
Timestamp: 2026-10-06T17:23:06Z
Repository: Lucas030509/TRIDENTPOS
Subject: 8f75aafbb55b447b8c309f4e41266933d02408c6
Subject tree: 57c70cf89973996818658c8655847dbf0aa8cb25
Diff base / verified merge-base: 167704791e26b1f6964c47ad38e927c04613d1e2
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362.
Loaded: registry/AGENTS.yaml, agents/architecture/11_Code_Reviewer.md, registry/GATES.yaml, gates/CODE_REVIEW_GATE.md.
SSOT: IMPLEMENTATION_PLAN.md lines 700–723; PRODUCT_OWNER_OQ_RESOLUTION.md lines 71–75.
State: BLOCK (gate advancement prohibited; EAAF gate equivalent HOLD).
This review does not replace Data/Security/QA, authorize merge, or change the frozen subject.

## Blocking findings
- CR16-BLK-01: packages/pos/src/cash-shift-service.ts:114–119. Missing PIN bypasses configured validator. With an always-rejecting validator, movement with explicit invalid PIN returns 401, identical movement with operatorPin omitted returns 201 and zero additional validator calls. DEC-017 requires PIN on every collection; options.pinValidator is also optional in fastify-app.ts:46,240, allowing production composition without IAM. Required: fail closed on missing PIN/validator in runtime and validate with offline IAM; negative tests for omitted/invalid PIN.
- CR16-BLK-02: packages/pos-edge-runtime/src/fastify-app.ts:642–672 (also 596–619,691–706,726–749,770–786); packages/pos-edge-runtime/src/cash-shift-sqlite-repository.ts:138–150. Body identity checking does not scope the retrieved aggregate. Reproduction uses two apps sharing the same SQLite database: enrolled ORG_A/BR_A/ST_A submits movement against a stored ORG_B/BR_B/ST_B shift, omitting body identities; response 201 mutates foreign shift to version 3. Expected rejection before read/authorization/mutation. Fixture represents a persisted foreign row; no claim that normal deployment intentionally shares databases. Required: verify stored organization/branch/station against enrollment on every /turnos/:id/* operation; protect OCC snapshots too.
- CR16-BLK-03: packages/pos-edge-runtime/src/fastify-app.ts:41,522–525,553–555. Station enrollment is optional and missing enrollment falls back to client stationId. Reproduction creates app with tenant enrollment but no stationId; apertura accepts CLIENT_CHOSEN with 201. Violates activation requirement that station identity only comes from enrollment. Required: fail closed when enrolled station identity absent, no request fallback.
- CR16-BLK-04: packages/pos-edge-runtime/src/cash-shift-runtime.test.ts:261–321. Required crash-during-Corte-Z test is absent: INT-03 uses stale expectedVersion=99 and throws OCC before INSERT corte/audit/outbox or COMMIT. It neither crashes a process nor reopens persistent storage, and asserts no outbox state. Passing this test proves stale-version rejection, not crash recovery/durability (DAT-04). Required: interrupt/fault at relevant transaction/commit boundaries and reopen database; assert shift/corte/audit/outbox consistency and FULL durability.
- CR16-BLK-05: packages/pos-edge-runtime/src/cash-shift-runtime.test.ts:214–258; packages/pos/src/cash-shift-service.test.ts:359–426. Explicit double-close-by-OCC criterion lacks a meaningful test. INT-02 makes one stale first close after arqueo, never two closes. DOM-06 sequential second close tests ShiftLockedError with current version, not competing closes protected by OCC. Required: two Corte Z attempts against same version, one success and one OCC conflict; exactly one corte/outbox and correct final state.

## Advisories
- CR16-ADV-01: packages/pos-edge-runtime/src/fastify-app.ts:509,517,525. 403 mismatch messages disclose enrolled organization/branch/station IDs. Reproduced TENANT_MISMATCH includes ORG_A. Prefer generic mismatch messages. Classified advisory because no evidence identifies these IDs as secrets; does not independently justify BLOCK.
- CR16-ADV-02: packages/pos/src/cash-shift-service.test.ts:322–356. Blind-count test checks resulting arithmetic, not temporal ordering of declaration vs disclosure. Current HTTP arqueo requires declaredCash before returning computed totals. Strengthen explicit order assertion; do not infer UI behavior from backend tests.

## Evidence and limits
- Immutable checkout identity and merge-base verified; git status clean after review. No implementation edits.
- Node v24.19.0, npm 11.9.0. npm ci --ignore-scripts succeeded. Build via npm exec turbo run build -- --filter=@trident/pos-edge-runtime...: 4/4 tasks successful.
- npm run graph:check: graph validation successful, 44/44 tests pass. pos cash-shift domain imports ports/types/core only, no SQL; SQLite and hardware/IAM adapters in pos-edge-runtime; local_audit persistence in edge. No reproduced boundary violation.
- node --test packages/pos/dist/cash-shift-service.test.js packages/pos-edge-runtime/dist/cash-shift-runtime.test.js: 15/15 pass. Existing tests verify arithmetic, non-participating operator rejection, operator breakdown, lifecycle/outbox/audit and integer precision. These passes do not cover the blocking gaps above.
- Review-only script outside repository reproduces BLK-01/02/03 and ADV-01; also confirms non-participant rejection 403. No source changes.
- Repository uses runInTransaction with durabilityMode FULL for saveCorteZSync; outbox enqueue is inside same transaction, externally visible after commit. Static transaction placement is sound; crash evidence remains missing.
- Scoped tests only; no claim full repository QA/Security PASS. Parallel 03_Data_Architect review is independent and is not substituted or approved here.
- Remediation owner: Builder. Handoff: fix BLK-01..05, freeze new SHA, return for R2 (maximum 2); retain R1 immutable history.

## Reproducibility
Run after dependency install and scoped build:
node ../review65/probes.mjs
The archived companion evidence contains the exact probe source and complete outputs.
Evidence SHA-256:
probes.mjs 0dee0fbba3722f2a2c539463aa54b026a6d42377ac6fb59859d1450e7a9e74f6
probes.log 7e93c1765612969e07cea7d6578390108243e280b100aeab24f322263927141c
tests.log 739d8add32029d26c9424f765c22110a43708e474e7933be7c80cc9e7c870600
graph.log 7cb25769213ddf1f31af17e9b6d7851c919e150bd7dc21b2f80e453d43333ab9
build.log 86736f31a33ce5da6fe53a0786fbd0ea0883363135b3e2b95833e63f0bb1b50a
