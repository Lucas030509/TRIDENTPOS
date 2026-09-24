# ACR-2026-020 R5 — Agent 03 Data Architecture Review

**Reviewer role:** Agent 03 — Data Architect  
**Repository:** Lucas030509/TRIDENTPOS  
**Exact Frozen Candidate R5:** 06accfe15183336734d1f046655a4e4563dd45b7  
**Candidate branch:** governance/acr-2026-020-wp021-pac-reconciliation-r5  
**R5 reset evidence:** db6e2992ed6aadc2242d870046a656c2d178a25e  
**Governing EAAF:** Lucas030509/EAAF-Framework@167cea36c09c1031c763971ff790db2e0d0f7362 (v1.3.0)  
**Review type:** Read-only semantic review; no implementation or tests were run.

## Finding — ACR020-R5-DATA-BLK-01: Consumer-only restore can lose an acknowledged effect

R5 correctly couples the consumer business effect and inbox marker in one local transaction and distinguishes same-domain restoration from producer PITR in §14.2. However, it does not require redrive or reconciliation when a consumer-only restore rolls both records back after the producer recorded delivery and received acknowledgment.

In that sequence, the effect and inbox return consistently to their pre-event state, while the producer may have no reason to redeliver. The consumer effect can remain missing. Test 87 assumes replay occurs; test 88 addresses inconsistent restoration but not the consistently rolled-back, previously acknowledged event. A durable replay/reconciliation source is required for that recovery case.

This leaves the consumer-local restore advisory unresolved at the data-recovery boundary. Relevant sources are R5 §14.2 and tests 87–90, plus the R4 Solution Architecture and Integration restore advisories.

## Assessment

- **Ownership:** Billing owns fiscal operations and producer outbox; each consumer owns its effect and inbox; PAC/provider remains authoritative for external fiscal outcomes.
- **Transaction boundary:** Consumer effect and inbox are atomic in a consumer-local transaction; separate physical databases are not required.
- **Restore/PITR:** Producer PITR replay against a consumer that retained its inbox is addressed. Consumer-only rollback needs the redrive/reconciliation requirement above.
- **Replay horizon:** §14.2.4 requires inbox retention through the maximum approved producer PITR and tenant-restore horizon and blocks use if that horizon or retention cannot be verified.
- **Multi-tenancy and migrations:** Tenant isolation and lossless migration requirements remain explicit in §§9.2 and 18.2–18.6; tests 55–64 preserve fiscal identity and event correlation and fail closed on lossy mapping.

R5 invents no statutory retention period, purge schedule, or Product Owner/Legal authority. Its operational inbox minimum is conditional on an approved replay horizon.

# DATA ARCHITECTURE GATE = HOLD

This result applies only to exact R5 06accfe15183336734d1f046655a4e4563dd45b7. It does not claim implementation conformance or test execution.