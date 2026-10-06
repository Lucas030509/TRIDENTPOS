# WP-016 — Code Review bounded human-authorized verification
Date: 2026-10-06
Reviewer: Codex / 11_Code_Reviewer, independent review activation, not author of changes.
Framework: EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362 + Lean profile.
Repository: Lucas030509/TRIDENTPOS; PR #65.
Subject SHA: 6d1bbafe063f07fefd597ceb17ce019a1c068bab
Subject tree: cade0b2e3f1c2ff54cb9e66b2df6d513d6fa3b23
Diff base / R2: 4ad5058dfb7d62cb9d9afab10b09775a1c93aa03
Sidecar canonical base: 167704791e26b1f6964c47ad38e927c04613d1e2
Authority: subject evidence/WP-016_PO_DECISION_R3.md authorizes ONE correction and ONE bounded verification of BLK-01/BLK-04; new blocker requires STOP.
Predecessor R2: 58eb33c4c7a030113ba2da94515bcbd9bcb59c23:evidence/WP016_PR65_CODE_REVIEW_R2.md (SHA-256 4f956f20e995524d01d35d4adb0bc1af57d116f89a531a2e5151216e268e6e76).
Pinned registry, role-11 profile and CODE_REVIEW_GATE reloaded. This is the explicit exception, not an automatic additional round or budget reset.

## Closure
### CR16-BLK-01 — CERRADO
Citation: packages/pos/src/cash-shift-service.ts options and constructor (lines 35–120), unconditional validatePin calls for opening, adding operator, movement, X, arqueo, Z; packages/pos-edge-runtime/src/fastify-app.ts lines 233–260 and six turnos handlers.
pinValidator is mandatory at type and runtime boundaries. Absent/null validator throws PIN_VALIDATOR_REQUIRED (500) on CashShiftDomainService construction. PIN missing/blank rejects before calling port; supplied PIN always invokes port, rejection raises INVALID_OPERATOR_PIN before mutations.
Fastify creates OfflineIamPinValidatorAdapter when offlineIamService is supplied; explicit pinValidator remains injectable. Without either validator/service, all six routes return PIN_VALIDATOR_REQUIRED and cannot mutate. The app can still start for unrelated capabilities; the CashShiftService itself cannot be constructed without the validator.
DOM-08/DOM-09 and INT-07 PASS. Independent probe confirms constructor undefined/null rejection; all six route guards; actual adapter wiring using a controlled IAM port double, valid opening then missing/empty/invalid PIN movement attempts all 401, zero movement rows (opening float 0). Port receives enrolled station identity. This tests adapter/composition, not real IAM credential enrollment.
No conditional “validator absent => skip” remains in the reviewed service paths.

### CR16-BLK-04 — CERRADO
Citation: packages/pos-edge-runtime/src/cash-shift-runtime.test.ts WP016-INT-03, lines 308 onward; cash-shift-sqlite-repository.ts options lines 64–81 and hook lines 544–545 inside saveCorteZSync transaction.
INT-03 starts a real child process, executes actual saveCorteZSync, and self-SIGKILLs in onBeforeCorteZCommit after real shift/corte/outbox writes and before COMMIT under FULL durability. Parent asserts child.signal==='SIGKILL'. Reopened SQLite retains CERRADO_ARQUEO/version 2, zero corte and zero outbox for aggregate_id=corteId (not shiftId).
Post-recovery successful commit yields CORTE_Z_EMITIDO/version 3, one corte and one corresponding outbox filtered by successfulCorte.id.
Executed candidate test PASS. This establishes process-crash atomicity at the requested financial boundary, not physical power-loss certification.
The test uses zero discrepancy, so discrepancy audit is not exercised by this test; no new out-of-scope finding opened.

## Hook wiring check
No onBeforeCorteZCommit is supplied by production Fastify composition. Source scan across packages finds declaration/assignment/invocation in repository and assignment only in crash test. Hook is undefined by default. No active-production-hook advisory warranted. The hook remains an exported optional test seam in repository API; review does not assert it is compile-time stripped.

## Executed evidence
Isolated runtime outside candidate; tracked source binding verified for 117 files using previous verified R2 source Git blob inventory plus every changed subject file blob from complete GitHub compare (one commit, R2 merge base).
Build: tsc -b packages/core packages/pos packages/edge packages/pos-edge-runtime — exit 0, empty diagnostic log.
Tests: node --test packages/pos/dist/cash-shift-service.test.js packages/pos-edge-runtime/dist/cash-shift-runtime.test.js — exit 0, 22 PASS, zero failed/skipped, includes DOM-08/DOM-09 and real SIGKILL INT-03.
Independent check: node probe.mjs — exit 0.
Files build.log, tests.log, probe.mjs and probe.log accompany this report; SHA256SUMS.txt seals contents.
No full-workspace, QA, Security, deployment, or physical-power-failure PASS claimed. No candidate file modified.

## Verdict and handoff
STATE=PASS
CLOSED_IDS=CR16-BLK-01,CR16-BLK-04
NEW_BLOCKERS=NONE within reviewed diff.
Only the authorized two closures and hook check are assessed. Other R2 outcomes remain their predecessor record; this verification does not replace Data/Security/QA or issue merge authority.
Next: Coordinator Synthesis.
GIT_SIDECAR on canonical base; PR COMMENT is notification only. Connector identity is the PR author's account, so this is an independent role assessment, not a separate-account GitHub approval vote.
