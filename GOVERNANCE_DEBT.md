# Governance Debt

## Authority

This register is governed by EAAF v1.3.0 pinned at:

`167cea36c09c1031c763971ff790db2e0d0f7362`

Governance Debt is not a substitute for PASS and cannot hide a mandatory gate failure.

## Active Records

### GD-001 — Fiscal event envelope preservation across native migration and PITR
- source: WP-021 / SEC-WP021-R4-HIGH-02 (Security Gate PR #61 R1 `709190e` / `6a63d235`)
- type: evidence gap (RE-ACOTADO a STAGING_GATE por Security Gate §5.B)
- description: eventContractVersion and original envelope preservation proven in tests/native/wp021-pitr.mjs; physical PITR executed on clean schema. Full migration comparison from populated prior schema and outbox correlation re-scoped to STAGING_GATE.
- evidence: evidence/wp021-pr61-security-r1/SECURITY_GATE_PR61_R1.md
- impact: fiscal event integrity after disaster recovery on pre-populated installations unproven
- affected capabilities: fiscal outbox, fiscal event consumers
- blocking targets: STAGING_GATE; fiscal stamping flag ON in any environment; prior to migration on populated installation
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner (Simón Sánchez); executor 13_Backend_Developer / 18_DevOps_Engineer
- exit criteria: execution linked to release SHA, migration from populated prior schema, complete pre/post envelope comparison, physical PITR and outbox correlation PASS
- due/review trigger: STAGING_GATE or first request to enable fiscal stamping
- status: OPEN
- canonical commit: (set at merge)

### GD-002 — Native safety of fiscal DOWN migrations
- source: WP-021 / SEC-WP021-R4-HIGH-03 (Security Gate PR #61 R1 `709190e` / `6a63d235`)
- type: evidence gap (RE-ACOTADO a STAGING_GATE por Security Gate §5.B)
- description: DOWN guards contain row_security=off, ACCESS EXCLUSIVE locks, and populated table rejection; tests/native/wp021-concurrency.mjs tests concurrency. Real DOWN SQL execution under installed non-bypass role re-scoped to STAGING_GATE.
- evidence: evidence/wp021-pr61-security-r1/SECURITY_GATE_PR61_R1.md
- impact: potential loss of populated fiscal/recovery rows on rollback in an installed environment
- affected capabilities: billing migrations
- blocking targets: STAGING_GATE; any DOWN migration on an installed environment
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner; executor 17_Database_Engineer
- exit criteria: execute real DOWN SQL of each relevant migration under installed non-bypass role and concurrent writer, including isolated marker, RLS hidden rows, rejection without data loss and clean session PASS
- due/review trigger: STAGING_GATE or first installed-environment migration
- status: OPEN
- canonical commit: (set at merge)

### GD-003 — Native executable coverage of REQ-75..92
- source: WP-021 / SEC-WP021-R4-HIGH-07 (Security Gate PR #61 R1 `709190e` / `6a63d235`)
- type: evidence gap (RE-ACOTADO a STAGING_GATE por Security Gate §5.B)
- description: CI executes unit-tests and native PostgreSQL PITR and concurrency test scripts. Exhaustive REQ-75..92 one-to-one matrix and release SHA native evidence re-scoped to STAGING_GATE.
- evidence: evidence/wp021-pr61-security-r1/SECURITY_GATE_PR61_R1.md
- impact: production accreditation of fiscal recovery unproven
- affected capabilities: WP-021 fiscal engine
- blocking targets: STAGING_GATE; activating fiscal stamping in any environment
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner; executor 09_QA_Test_Architect
- exit criteria: requirement->executable case matrix, native release SHA evidence including populated migration, real scripts and recoveries PASS
- due/review trigger: STAGING_GATE
- status: OPEN
- canonical commit: (set at merge)

## Explicit Non-Debt Items

The following remain outside Governance Debt and retain their existing blocking/decision semantics:

- `QI-BLK-021-R1-04` / WP-021 PAC crash and reconciliation safety: active implementation blocker history; not debt.
- WP-021 R2 findings requiring fail-closed CSD metadata and strict fiscal success evidence: active implementation blockers; not debt.
- `OQ-ARCH-02` and all other protected Product Owner Open Questions: OPEN Human Decision items; not debt.
- Missing PAC provider contract semantics required by a current acceptance criterion: `BLOCKED BY CONTRACT` when applicable; not debt.

## Record Format

Any future Governance Debt entry must contain:

- ID
- source WP/ACR/incident
- type
- description
- evidence
- impact
- affected capabilities
- blocking targets
- non-blocking targets
- owner
- exit criteria
- due/review trigger
- status: OPEN | IN_PROGRESS | RESOLVED | ACCEPTED_RISK
- canonical commit

## Eligibility

A finding may be recorded as Governance Debt only when:

1. current acceptance criteria can be met without pretending the missing capability exists;
2. the limitation is explicit in evidence;
3. no safety, security, compliance, or other mandatory invariant requires immediate resolution;
4. downstream features that depend on the gap are explicitly blocked.
