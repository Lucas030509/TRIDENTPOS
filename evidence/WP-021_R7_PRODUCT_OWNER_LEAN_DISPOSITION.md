# WP-021 — Product Owner Lean Disposition for R7

## Authority and exact decision
Authority: PRODUCT_OWNER_HUMAN — Simón Sánchez.
Date: 2026-10-04.
Delivery coordinator: `19_Lean_Delivery_Orchestrator` (ACR-2026-021, EAAF Lean Delivery Profile).

> Como autoridad humana de TRIDENTPOS, ratifico la iteración R7 (`873b3cee74a70c00162b950b5efa7507d3270c04`) y autorizo un único ajuste acotado R7.1 sobre la misma rama para: (a) cerrar el caso A4 de SEC-WP021-R4-HIGH-06 y (b) ejecutar la evidencia nativa exigida por HIGH-02, HIGH-03 y HIGH-07 (PostgreSQL nativo, concurrencia multi-conexión y PITR físico en clúster desechable). Los hallazgos HIGH-02/03/04/06/07 permanecen bajo la autoridad del Security Gate: solo 08_Security_Architect, en un nuevo veredicto sobre el SHA de R7.1, puede cerrarlos o re-acotarlos a un Gate posterior. No convierto hallazgos del HOLD R6 en deuda ni acepto riesgo de seguridad. WP-021 se integra a `main` solo con Security PASS y Code Review PASS sobre el mismo SHA, con el kill switch de timbrado fiscal en OFF. La contabilidad histórica se cierra como ACCEPTED_UNVERIFIABLE. PAC_SELECTED=NO y OQ_ARCH_02=OPEN. No autorizo staging, producción ni cambios de arquitectura.

## Governing subjects
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362 (+ ACR-2026-021 Lean profile).
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
R6 subject: 83dd38b9773acee4d5a56d439ad2d3e959b000d2 (origin/feat/wp-021-security-remediation-r6).
R7 subject: 873b3cee74a70c00162b950b5efa7507d3270c04 (origin/feat/wp-021-security-remediation-r7).
Security HOLD R6 evidence: 2fa267bd9d661343e36b8a8f9be7085287204bae.
Superseded scope: 7972f0e (WP-021 R6 HOLD — bounded R7 human authorization), only where changed here.

## R7 status (already executed)
Independent adversarial re-run on native PostgreSQL 16.15 (input evidence, not a Gate verdict): A1 CLOSED, A2 CLOSED, A3 CLOSED, A4 OPEN, A5 regression PASS; WP-021 native integration suite 18/18 PASS. Builder clean-run verification: build, lint, typecheck, format, graph PASS; 859/859 workspace tests; 18/18 native.

## R7.1 scope (Builder: 13_Backend_Developer) — one bounded commit series on the R7 branch
1. **HIGH-06 / A4** — per-(organization_id, consumer_context) restore-pending marker (additive migration, RLS/FORCE RLS); while set, `processEventWithInbox` fails closed; `reconcileConsumerRestore` clears it only after verified completion. Regressions: A4 blocks while pending; after reconcile, effect present and redelivery duplicate; tenant isolation of the marker.
2. **HIGH-02 / HIGH-07 (PITR)** — executable physical PITR test on a disposable native PostgreSQL cluster: `archive_mode=on` + WAL archive, apply migrations, populate fiscal operations/outbox/inbox envelopes, `pg_basebackup`, further writes, recovery to target time via `recovery.signal`, then assert envelope, `eventContractVersion`, request hashes and outbox correlations preserved and post-target writes absent.
3. **HIGH-03** — native multi-connection test: concurrent writer on populated fiscal tables while DOWN guard runs under the native migration role; assert DOWN refuses and no rows are lost, including RLS-hidden rows.
4. Keep A1, A2, A3, A5, HIGH-01, HIGH-05, MED-01 regressions green.
5. Any item that cannot execute is reported `NOT EXECUTED` with the reason; never substituted by PGlite.

Out of scope: PAC selection, new features, refactors, installed-environment operations.

## Merge path
R7.1 frozen SHA → PR to `main` → CI green → parallel round 1 (08_Security_Architect on HIGH-02/03/04/06/07 + regressions; 11_Code_Reviewer) → [round 2 diff-only if reproduced defects] → merge with flag OFF → `evidence/WP-021_SUMMARY.md`.
Any finding the Security Gate re-scopes to a later Gate is recorded in `GOVERNANCE_DEBT.md` at that time, citing the Security verdict.
A reproduced defect after round 2 → `DECISION REQUIRED` to Product Owner.

## Formal status
AUTHORITY=PRODUCT_OWNER_HUMAN
R7=RATIFIED
R7_1_SCOPE=HIGH-06(A4),HIGH-02/07(physical PITR evidence),HIGH-03(native concurrency evidence)
SECURITY_FINDINGS_AUTHORITY=08_Security_Architect (close or re-scope only by new Gate verdict)
FINDINGS_CONVERTED_TO_DEBT_BY_PO=NONE
SECURITY_RISK_ACCEPTED=NO
FISCAL_STAMPING_FLAG=OFF
REVIEW_ROUNDS_MAX=2 (parallel: 08_Security_Architect, 11_Code_Reviewer)
CODE_REVIEW_AUTHORIZED=YES
PR_AUTHORIZED=YES
MERGE_AUTHORIZED=ONLY_WITH_SECURITY_PASS_AND_CODE_REVIEW_PASS_ON_SAME_SHA_WITH_FLAG_OFF
HISTORICAL_ACCOUNTING=ACCEPTED_UNVERIFIABLE
STAGING_AUTHORIZED=NO
PRODUCTION_AUTHORIZED=NO
ARCHITECTURE_CHANGE_AUTHORIZED=NO
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
