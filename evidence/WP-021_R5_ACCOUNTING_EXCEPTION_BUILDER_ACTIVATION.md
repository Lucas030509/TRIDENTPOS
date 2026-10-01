# WP-021 — Human Accounting Exception and Bounded Builder Activation

## Authority and exact decision
Authority: PRODUCT_OWNER_HUMAN — Simón Sánchez.
Human statement received 2026-10-01T14:03:46-06:00:
> Autorizo una excepción de gobernanza para activar exactamente una iteración Builder de WP-021 pese a la contabilidad histórica pendiente de verificar. Esa obligación permanece abierta; no se inventan, reinician ni reducen contadores, ni se modifican límites globales. Cualquier exceso posteriormente acreditado exige STOP y nueva decisión humana. Security continúa HOLD; Code Review, PR y merge no están autorizados. PAC_SELECTED=NO y OQ_ARCH_02=OPEN.

The Governance Coordinator records this human decision; it does not self-authorize or act as Builder.

## Governing sources
Framework Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362:
framework/EXECUTION_CIRCUIT_BREAKERS.md; framework/HUMAN_DECISION_GATES.md; framework/DECISION_ESCALATION_RULES.md.
Project Lucas030509/TRIDENTPOS.
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
Current immutable subject: 36ba35baea8aa88143dbd5b3993589c9adf9abd6.
Historical immutable R4: fa4545c5dd6491bac473d959635b27015b804911.
Builder-only human authorization: 417ca6253711d740201c6597a7f7b5b321615930.
Prior accounting preflight HOLD: 921c5725a22c947cbc3a244330f02e1abdab5836.
Previous consumed authorization: 33e7e8d4ce057ae3c5a55ed401d711e4094129cf.

## Effect and accounting obligation
This explicit decision disposes of the activation blocker caused by incomplete historical accounting as bounded, non-blocking Governance Debt for exactly the single iteration already granted by 417ca6253711d740201c6597a7f7b5b321615930.
It does NOT grant a second iteration in addition to that iteration.
Declared recurrence remains 1 per recurring High fingerprint (AT LIMIT, not EXCEEDED); mechanically verified accumulated recurrence remains UNKNOWN.
Declared implementation Security review cycles remain 2 (R4 HOLD, R5 HOLD); mechanically verified complete accumulated review count remains UNKNOWN.
No counters are invented, reduced or reset. The prior preflight remains immutable evidence; it is superseded for activation disposition only, not rewritten as a successful mechanical reconstruction.
Outstanding obligation: recover original R4 Security fingerprints and complete applicable execution/review history, reconcile counters, preserve evidence, and STOP immediately if any independently blocking excess is subsequently established. A new explicit human decision is then required.
This exception is not authority to proceed through any known exceeded independent control.

## Unchanged controls and gate state
Manifest limits remain Builder=3, reviews=3, recurrence=1, same-cause CI=2, architecture reopens=1.
No available evidence establishes CI exceedance; this is not a zero-count assertion.
No architecture reopen is requested or permitted. No architecture change, PAC selection or capability accreditation is authorized.
Quick Integrity for current subject remains PASS.
Security remains HOLD: Critical=0, High=7 PARTIAL, Medium=1 PARTIAL.
No Security risk acceptance or Code Review, PR, merge, staging or production authority is granted.
Main, project-manifest.json, application code, historical R4 and current R5 remain unchanged.

## Bounded handoff
Builder activation is authorized for exactly ONE iteration scoped only to SEC-WP021-R4-HIGH-01 through HIGH-07 and SEC-WP021-R4-MED-01.
Downstream Builder MUST reload this evidence commit, the original 417ca625 authority and the prior preflight.
Produce a new branch, commit and immutable Frozen SHA with mechanically verifiable lineage from current R5, exact Builder evidence, finding-to-change traceability, canonical REQ-75..REQ-92 executable evidence, build/lint/typecheck/tests and database-backed tests where required.
After new freeze, STOP. The one iteration is consumed according to the original authority. No automatic second iteration.
Then Quick Integrity for the new SHA, independent 08_Security_Architect, and only after future Security PASS a valid 11_Code_Reviewer handoff.
No Builder was activated or executed by the recording operation.

## Persistence
GIT_SIDECAR branch: evidence/wp-021-r5-accounting-exception-builder-activation.
Direct parent must be canonical base. Only this governance evidence file is changed.

## Formal status
AUTHORITY=PRODUCT_OWNER_HUMAN
BUILDER_BUDGET_AUTHORIZATION_SHA=417ca6253711d740201c6597a7f7b5b321615930
ITERATIONS_GRANTED_TOTAL=1
ADDITIONAL_ITERATIONS_GRANTED_BY_THIS_RECORD=0
ACCOUNTING_EXCEPTION=AUTHORIZED
ACCOUNTING_OBLIGATION=OPEN_NON_BLOCKING_GOVERNANCE_DEBT_FOR_ONE_ITERATION
ACCUMULATED_RECURRENCE=NOT_MECHANICALLY_VERIFIED
ACCUMULATED_REVIEW_CYCLES=NOT_MECHANICALLY_VERIFIED
COUNTERS_RESET=NO
GLOBAL_BUDGET_CHANGED=NO
PROJECT_MANIFEST_CHANGED=NO
STOP_ON_SUBSEQUENTLY_VERIFIED_EXCESS=YES
SECURITY_GATE=HOLD
SECURITY_RISK_ACCEPTED=NO
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
CODE_REVIEW_AUTHORIZED=NO
PR_APPROVAL=NOT_AUTHORIZED
MERGE_AUTHORIZED=NO
STAGING_AUTHORIZED=NO
PRODUCTION_AUTHORIZED=NO
GOVERNANCE_DISPOSITION=EXPLICIT_HUMAN_EXCEPTION
BUILDER_ACTIVATION_AUTHORIZED=YES
BUILDER_EXECUTED=NO
