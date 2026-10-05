# Governance Debt

## Authority

This register is governed by EAAF v1.3.0 pinned at:

`167cea36c09c1031c763971ff790db2e0d0f7362`

Governance Debt is not a substitute for PASS and cannot hide a mandatory gate failure.

## Active Records

### GD-001 — Fiscal event envelope preservation across native migration and PITR
- source: WP-021 / SEC-WP021-R4-HIGH-02 (Security HOLD R6 `2fa267b`)
- type: evidence gap (NOT EXECUTED in Builder environment)
- description: eventContractVersion and original envelope preservation proven only in PGlite SQL simulation; native populated migration and physical PITR not executed.
- evidence: evidence/wp021-r6-security-review/WP021_R6_SECURITY_GATE.md
- impact: fiscal event integrity after disaster recovery unproven
- affected capabilities: fiscal outbox, fiscal event consumers
- blocking targets: fiscal stamping flag ON in any environment; Production Gate
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner (Simón Sánchez); executor 13_Backend_Developer / 18_DevOps_Engineer
- exit criteria: native PostgreSQL populated-migration + physical PITR restore test PASS
- due/review trigger: WP-027 or first request to enable fiscal stamping
- status: OPEN
- canonical commit: (set at merge)

### GD-002 — Native safety of fiscal DOWN migrations
- source: WP-021 / SEC-WP021-R4-HIGH-03
- type: evidence gap (NOT EXECUTED)
- description: DOWN guards proven in PGlite single-engine simulation; native migration role, multi-connection locks and installed-state checksum drift not validated.
- evidence: evidence/wp021-r6-security-review/WP021_R6_SECURITY_GATE.md
- impact: potential loss of populated fiscal/recovery rows on rollback in an installed environment
- affected capabilities: billing migrations
- blocking targets: any DOWN migration on an installed environment; Production Gate
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner; executor 17_Database_Engineer
- exit criteria: native PostgreSQL multi-connection DOWN-guard test on populated tables PASS
- due/review trigger: WP-027 or first installed-environment migration
- status: OPEN
- canonical commit: (set at merge)

### GD-003 — Native executable coverage of REQ-75..92
- source: WP-021 / SEC-WP021-R4-HIGH-07
- type: evidence gap (NOT EXECUTED)
- description: canonical requirement suite executed with PGlite only; native concurrency and PITR coverage absent.
- evidence: evidence/wp021-r6-security-review/WP021_R6_SECURITY_GATE.md
- impact: production accreditation of fiscal recovery unproven
- affected capabilities: WP-021 fiscal engine
- blocking targets: fiscal stamping flag ON in any environment; Production Gate
- non-blocking targets: merge of WP-021 to main with fiscal stamping flag OFF
- owner: Product Owner; executor 09_QA_Test_Architect
- exit criteria: native REQ-75..92 suite incl. concurrency and PITR all PASS
- due/review trigger: WP-027
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
