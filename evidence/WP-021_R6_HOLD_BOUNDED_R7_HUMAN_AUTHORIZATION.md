# WP-021 R6 Security HOLD — Bounded R7 Human Authorization

## Authority and exact decision
Authority: PRODUCT_OWNER_HUMAN — Simón Sánchez.
Human decision received: 2026-10-03T07:41:39-06:00.
The Coordinator records the human decision; it does not act as Builder or independent reviewer.

> Como autoridad humana de TRIDENTPOS, autorizo exactamente una iteración Builder adicional desde `83dd38b9773acee4d5a56d439ad2d3e959b000d2`, exclusivamente para HIGH-02/03/04/06/07 del informe `2fa267bd9d661343e36b8a8f9be7085287204bae`, y una revisión Security independiente del nuevo SHA. Otorgo excepciones acotadas al presupuesto Builder, al ciclo de revisión adicional y a la recurrencia de estos hallazgos para este único ciclo. La contabilidad histórica permanece abierta, sin inventar ni reiniciar contadores. Exijo pruebas nativas de PostgreSQL, concurrencia y PITR; si no pueden ejecutarse, deben declararse NOT EXECUTED. No autorizo cambios arquitectónicos, aceptación de riesgo, modificación de límites globales, Code Review, PR, merge ni despliegue. PAC_SELECTED=NO y OQ_ARCH_02=OPEN. Autorizo persistir esta decisión antes de activar Builder. Cualquier nuevo HOLD/FAIL obliga a STOP.

## Exact governing subjects
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362.
Project: Lucas030509/TRIDENTPOS.
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
Immutable source R6: 83dd38b9773acee4d5a56d439ad2d3e959b000d2.
Source tree: bbb19289a1829c47118fc8aec71ad2593523a47a.
Independent Security HOLD evidence: 2fa267bd9d661343e36b8a8f9be7085287204bae, evidence/wp021-r6-security-review/WP021_R6_SECURITY_GATE.md.
Previous consumed Builder authority: 417ca6253711d740201c6597a7f7b5b321615930.
Previous accounting disposition: 136c651f05352af61d87620c478f0cb007f328cc.
Controls: framework/EXECUTION_CIRCUIT_BREAKERS.md and framework/HUMAN_DECISION_GATES.md at pinned framework.

## Bounded disposition and scope
Exactly ONE additional Builder iteration from R6, and ONE independent Security review of its new frozen SHA.
Authorized findings only: SEC-WP021-R4-HIGH-02, HIGH-03, HIGH-04, HIGH-06, HIGH-07.
Implement within canonical architecture:
- Preserve event envelopes through native populated migration and physical PITR.
- Prove native migration/RLS/locking/concurrent-writer safety without destructive installed-environment operations.
- Preserve original XML complements except legitimate TFD addition; reject malformed XML; regress independent A1/A2.
- Enforce external-effect classification and durable idempotency or BLOCKED BY CONTRACT in recovery; regress A3/A4.
- Provide executable requirement coverage including native PostgreSQL, concurrency and PITR.
Use isolated disposable native test environments. This does not authorize production restore, data destruction, migration ledger/checksum rewrite or installed-state changes.
Preserve regression coverage of closed HIGH-01/HIGH-05/MED-01 without unrelated scope expansion.

## Circuit breakers and accounting
Scoped exceptions apply to Builder budget, one additional Security review cycle and recurrence of the listed findings for this cycle only.
No global manifest limits change (Builder=3, reviews=3, recurrence=1, same-cause CI=2, architecture reopens=1).
Historical accumulated counters remain NOT_MECHANICALLY_VERIFIED; declared R4/R5/R6 Security history has three cycles, not a verified complete ledger.
Preserve fingerprints/history; do not invent, reset, reduce or hide counters.
This disposition allows the bounded cycle despite open historical accounting; it does not close that obligation.
No exception to same-cause CI limits, architecture reopens or unrelated controls is granted.
Any independently blocking control outside these express exceptions requires STOP and human decision.
Any new HOLD/FAIL requires STOP; no automatic further remediation or review cycle.

## Required deliverable and downstream reload
Before implementation, Builder must reload this committed decision, exact Security report and adversarial reproduction files, pinned Builder profile and canonical SSOT.
Produce a new branch, one bounded iteration, immutable Frozen SHA with direct lineage from R6, exact finding-to-change traceability, executable REQ-75..92 evidence, commands/exit codes/environment/log digests and build/lint/typecheck/tests.
Native PostgreSQL/concurrency/PITR must be attempted in an appropriate native environment; inability to execute remains NOT EXECUTED, never PASS or substituted by PGlite.
After freeze: STOP. Authorization is consumed by creation/freeze of the new candidate.
Sequence: persisted authority reload -> Builder -> freeze/STOP -> Quick Integrity -> one independent Security review.
Code Review is NOT authorized by this record, even upon future Security PASS; obtain the applicable downstream handoff/authority separately.
Preserve R4/R5/R6, canonical architecture, main and manifest. No PAC/provider accreditation.

## Persistence
GIT_SIDECAR: evidence/wp-021-r6-hold-bounded-r7-authorization.
Direct parent: canonical base. Only this evidence file changes.
This recording operation does not execute Builder or Security.

## Formal status
AUTHORITY=PRODUCT_OWNER_HUMAN
SOURCE_SUBJECT_SHA=83dd38b9773acee4d5a56d439ad2d3e959b000d2
SOURCE_SECURITY_GATE=HOLD
BUILDER_ITERATIONS_GRANTED=1
INDEPENDENT_SECURITY_REVIEWS_GRANTED=1
BUILDER_BUDGET_EXCEPTION=AUTHORIZED_FOR_THIS_CYCLE_ONLY
REVIEW_CYCLE_EXCEPTION=AUTHORIZED_FOR_THIS_CYCLE_ONLY
LISTED_FINDING_RECURRENCE_EXCEPTION=AUTHORIZED_FOR_THIS_CYCLE_ONLY
HISTORICAL_ACCOUNTING=OPEN_NOT_VERIFIED
COUNTERS_RESET=NO
PROJECT_MANIFEST_CHANGE_AUTHORIZED=NO
GLOBAL_BUDGET_CHANGE_AUTHORIZED=NO
ARCHITECTURE_CHANGE_AUTHORIZED=NO
SECURITY_RISK_ACCEPTED=NO
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
CODE_REVIEW_AUTHORIZED=NO
PR_APPROVAL=NOT_AUTHORIZED
MERGE_AUTHORIZED=NO
STAGING_AUTHORIZED=NO
PRODUCTION_AUTHORIZED=NO
BUILDER_EXECUTED=NO
STOP_ON_NEW_HOLD_FAIL=YES
