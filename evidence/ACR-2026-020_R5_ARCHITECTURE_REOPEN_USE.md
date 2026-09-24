# ACR-2026-020 R5 — Scoped Architecture-Reopen Exception Use

**Repository:** Lucas030509/TRIDENTPOS  
**Exact R5 subject reopened:** 06accfe15183336734d1f046655a4e4563dd45b7  
**Candidate branch:** governance/acr-2026-020-wp021-pac-reconciliation-r5  
**Human authorization:** R5 reset sidecar db6e2992ed6aadc2242d870046a656c2d178a25e  
**Governing EAAF:** Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362 (v1.3.0)  
**Global project-manifest budgets:** unchanged

## Authority and use

The R5 reset record preserves the Authorized Human's direction: if this R5 cycle consumes or exceeds max_architecture_reopens = 1, one additional architecture-reopen exception is authorized for ACR-2026-020 R5 only, without changing the global manifest value.

This record invokes that single R5-only exception for one final remediation and exact-subject review of the already-authorized R5 candidate. It does not create a new reset, additional review cycle, R6, Builder authorization, or further reopen authority.

## Bounded remediation scope

The single reopen addresses findings returned against exact R5 06accfe15183336734d1f046655a4e4563dd45b7:

- Agent 09 QA: test 78 must explicitly verify rejection before mutation when a supported-version payload omits a required field; define event-version syntax and malformed-version behavior.
- Agent 08 Security: bind capability approval to an authenticated trust root and evidence digest; define digest representation, authoritative revocation status/freshness, and tenant scope where approvals vary by tenant.
- Agent 03 Data: require durable replay/reconciliation after a consumer-only restore rolls back an acknowledged effect and inbox; redelivery must be possible even after prior transport acknowledgement.

These findings are limited to R5's event-version compatibility, capability-provenance validation, and supporting consumer restore-domain contract. No PAC/vendor, broker, endpoint, credential, provider capability, statutory retention period, or Product Owner decision is selected or inferred.

## Protected invariants

- No change to project-manifest.json or any global budget/counter.
- max_builder_iterations and same_blocker_recurrence remain unchanged.
- WP-021 Builder R3 is not authorized.
- OQ-ARCH-02 remains OPEN.
- No R6 or additional R5 remediation/review is authorized after this single reopen.
- All new gate evidence must bind to the final exact R5 subject; earlier R5 reports remain historical evidence for 06accfe15183336734d1f046655a4e4563dd45b7 only.

**EXCEPTION USE:** ONE SCOPED R5 ARCHITECTURE REOPEN — USED.
