# Governance Debt

## Authority

This register is governed by EAAF v1.3.0 pinned at:

`167cea36c09c1031c763971ff790db2e0d0f7362`

Governance Debt is not a substitute for PASS and cannot hide a mandatory gate failure.

## Active Records

None at the time of the EAAF v1.3 project-manifest migration.

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
