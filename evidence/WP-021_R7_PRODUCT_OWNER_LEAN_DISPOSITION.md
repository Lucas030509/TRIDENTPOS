# WP-021 — Product Owner Lean Disposition for R7

## Authority and exact decision
Authority: PRODUCT_OWNER_HUMAN — Simón Sánchez.
Date: 2026-10-04.
Delivery coordinator: `19_Lean_Delivery_Orchestrator` (ACR-2026-021, EAAF Lean Delivery Profile).

> Como autoridad humana de TRIDENTPOS, reemplazo el alcance de la autorización R7 registrada en `7972f0e` por el siguiente: R7 corrige exclusivamente los defectos reproducidos SEC-WP021-R4-HIGH-04 (A1, A2) y SEC-WP021-R4-HIGH-06 (A3, A4), con pruebas de regresión que fallen antes y pasen después. HIGH-02, HIGH-03 y HIGH-07 dejan de bloquear el merge: se registran como Deuda de Gobierno con objetivo de bloqueo en el Production Gate y en cualquier activación del timbrado fiscal. WP-021 se integra a `main` con el kill switch de timbrado fiscal en OFF. Autorizo una sola ronda de revisión en paralelo (08_Security_Architect sobre HIGH-04/06 y regresión de HIGH-01/05/MED-01, y 11_Code_Reviewer), y una segunda ronda solo sobre el diff si hay defectos reproducidos. La contabilidad histórica se cierra como ACCEPTED_UNVERIFIABLE. PAC_SELECTED=NO y OQ_ARCH_02=OPEN. No autorizo staging, producción ni cambios de arquitectura.

## Governing subjects
Framework: Lucas030509/EAAF-Framework @ 167cea36c09c1031c763971ff790db2e0d0f7362 (+ ACR-2026-021 Lean profile).
Canonical base: 885855f4b4c51833135a9d384c673ed4bc0e406b.
Source R6 subject: 83dd38b9773acee4d5a56d439ad2d3e959b000d2 (must be published to GitHub before R7 starts).
Security HOLD R6 evidence: 2fa267bd9d661343e36b8a8f9be7085287204bae.
Superseded scope: 7972f0e (WP-021 R6 HOLD — bounded R7 human authorization). Its non-scope controls remain unless changed here.

## R7 scope (Builder: 13_Backend_Developer)
1. **HIGH-04 / A1** — `packages/billing/src/xml-validator.ts`: the stamped-result comparator must preserve every original node, including all `cfdi:Complemento` children (e.g. payment complement `Monto`), allowing only the legitimate `tfd:TimbreFiscalDigital` addition. Regression: A1 mutation (Monto 100 → 999999) must be rejected.
2. **HIGH-04 / A2** — XML parsing must reject non-well-formed input (missing attribute separator, raw `&`). Prefer a conformant XML parser over the custom one if available in the approved stack; otherwise harden the parser. Regression: A2 input must be rejected.
3. **HIGH-06 / A3** — `packages/cloud-server/src/index.ts` `reconcileConsumerRestore`: must not hard-code `effectMode='TRANSACTIONAL_SQL'`; replay must carry effect classification; external effects require durable idempotency by `semanticEventId` or return `BLOCKED BY CONTRACT`. Regression: A3 scenario must produce at most one external call.
4. **HIGH-06 / A4** — ordinary redelivery in a restore-pending state must not report `duplicate=true` when the business effect is missing; require the recovery-state gate/verifier. Regression: A4 scenario must re-apply or block, never silently skip.
5. Keep HIGH-01, HIGH-05 and MED-01 regression tests green.
6. Native PostgreSQL: run the billing/cloud-server/database suites against a disposable native PostgreSQL if available (`DATABASE_URL`); otherwise mark `NOT EXECUTED`. Not a merge blocker under this disposition.

Out of scope: PITR physical tests, populated native migration rehearsal, PAC selection, new features, refactors.

## Deferred items (Governance Debt)
| Debt ID | Source | Blocking target | Exit test |
|---|---|---|---|
| GD-001 | SEC-WP021-R4-HIGH-02 | Fiscal stamping flag ON in any environment; Production Gate | Envelope/version preserved across native populated migration and physical PITR restore |
| GD-002 | SEC-WP021-R4-HIGH-03 | Any DOWN migration in installed env; Production Gate | Native PostgreSQL multi-connection lock/RLS guard test on populated fiscal tables |
| GD-003 | SEC-WP021-R4-HIGH-07 | Fiscal stamping flag ON in any environment; Production Gate | Native REQ-75..92 suite incl. concurrency and PITR, all PASS |

Eligibility (GOVERNANCE_DEBT.md §Eligibility): acceptance criteria are met with stamping disabled; limitations explicit in R6 evidence; no invariant requires immediate resolution because fiscal stamping is unreachable (flag OFF, no PAC, no production); dependent capabilities are explicitly blocked above.

## Merge path
Publish R6 → Builder R7 (one iteration) → PR to `main` → CI green → parallel round 1 (08 + 11) → [round 2 diff-only if reproduced defects] → merge with flag OFF → `evidence/WP-021_SUMMARY.md`.
A reproduced defect after round 2 → `DECISION REQUIRED` to Product Owner.

## Formal status
AUTHORITY=PRODUCT_OWNER_HUMAN
R7_SCOPE=HIGH-04,HIGH-06
DEFERRED_TO_DEBT=HIGH-02(GD-001),HIGH-03(GD-002),HIGH-07(GD-003)
FISCAL_STAMPING_FLAG=OFF
REVIEW_ROUNDS_MAX=2 (parallel: 08_Security_Architect, 11_Code_Reviewer)
CODE_REVIEW_AUTHORIZED=YES
PR_AUTHORIZED=YES
MERGE_AUTHORIZED=YES_ON_ROUND_PASS_WITH_FLAG_OFF
HISTORICAL_ACCOUNTING=ACCEPTED_UNVERIFIABLE
STAGING_AUTHORIZED=NO
PRODUCTION_AUTHORIZED=NO
ARCHITECTURE_CHANGE_AUTHORIZED=NO
PAC_SELECTED=NO
OQ_ARCH_02=OPEN
