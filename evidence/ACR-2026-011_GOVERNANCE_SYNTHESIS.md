# ACR-2026-011 GOVERNANCE SYNTHESIS & RECONCILIATION EVIDENCE
## Joint Data and Security Architecture Synthesis for WP-009

**Document ID:** `EVIDENCE-ACR-2026-011-SYNTHESIS`  
**Version:** `1.0 SYNTHESIS EVIDENCE`  
**Date:** `2026-09-11`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Operating Mode:** `SOLO_MAINTAINER`  
**Author Agents:** `03_Data_Architect` & `08_Security_Architect`  
**Governing ACR:** [`ARCHITECTURE_CHANGE_REQUEST_WP009_TRUST_BOOTSTRAP.md`](file:///Volumes/SSD_ORICO/BRAIN/TRIDENTPOSREST/eeaaf/TRIDENTPOS/ARCHITECTURE_CHANGE_REQUEST_WP009_TRUST_BOOTSTRAP.md)  
**Status:** `PROPOSED / PENDING PRODUCT OWNER APPROVAL`  

---

## 1. Executive Baseline & Lineage

- **Canonical Main SHA (G8):** `bb44f35bbe459ae86869b541e42dea12fc8173f8`
- **Reviewed Trigger Candidate (S9-R1):** `6b7fc1982e04872fa9255a701cb978380376807d` (`INVALIDATED FOR INDEPENDENT REVIEW`)
- **Data Clarification Input (ED9):** `469e30d07e4ea3e18bb9c22e1c7089f37b1dc560` on branch `clarification/wp-009-data-authority-r2`
- **Security Clarification Input (ES9C):** `c5dbd25b977d8a2cc54da3f21a888bf07dbb7cbc` on branch `clarification/wp-009-security-architecture-r1`
- **Current Governance Branch:** `governance/acr-2026-011-wp-009-trust-bootstrap` (Branched directly from canonical G8)

---

## 2. Synthesis of Architectural Clarifications

This document synthesizes the independent evaluations of the Data Architect (ED9) and Security Architect (ES9C) into a single, unified governance proposal:

```text
==================================================================================================================================
ARCHITECTURAL TOPIC      DATA ARCHITECT EVALUATION (ED9)      SECURITY ARCHITECT EVALUATION (ES9C) SYNTHESIZED ACR-2026-011 RULING
==================================================================================================================================
1. Transaction Boundary  Mandated single atomic SQLite        Confirmed transaction must commit    MANDATORY DATA-INV-WP009-01:
                         transaction (DATA-INV-WP009-01)      before success audit is emitted;     Single runInTransaction for CAS
                         for CAS consumption + credential     rejection of split CAS/insert        consumption + credential insert.
                         insert to prevent burned tokens.     transactions.                        consumed_at reverts to NULL on error.
----------------------------------------------------------------------------------------------------------------------------------
2. Multi-Tenant Context  Mandatory organization_id &          Affirmed tenant and branch scoping   Mandatory organization_id & branch_id
                         branch_id in local records to        must be validated against token and  in both enrollment_tokens and
                         prevent cross-tenant contamination.  credentials fail-closed.             station_credentials.
----------------------------------------------------------------------------------------------------------------------------------
3. station_token_hash    Excluded from durable schema;        Excluded from durable schema;        REMOVED from station_credentials.
   Disposition           shift tokens represent transient     Local Station Token is 12h session   Durable hardware identity separated
                         authorization, not device identity.  material; sessions belong to WP-010. from ephemeral session management.
----------------------------------------------------------------------------------------------------------------------------------
4. Edge TLS Private Key  Referred to Security Architect       Plaintext file 0600 is insufficient; Encrypted at rest via OS Keyring
   Storage & Lifecycle   for cryptographic evaluation.        mandated OS Keyring (DPAPI/Keychain); (DPAPI/Keyring). Fail-closed on start
                                                              silent regeneration PROHIBITED.      if corrupt. Zero silent regeneration.
----------------------------------------------------------------------------------------------------------------------------------
5. Station Token HMAC    Referred to Security Architect       Volatile in-memory key breaks floor  Mandatory 256-bit CSPRNG key
   Signing Key           for key lifecycle evaluation.        sessions across restart; mandated    persisted in OS Keyring. Distinct from
                                                              256-bit persistent key in Keyring.   TLS key. Weak keys rejected.
----------------------------------------------------------------------------------------------------------------------------------
6. Station Pin Store     Affirmed pinning contract            initialPin is PROHIBITED in prod;    Tamper-resistant platform store
                         requires durable client storage.     mandated platform-level tamper-      contract; initialPin prohibited
                                                              resistant storage (Keystore/Keyring). in production client interfaces.
----------------------------------------------------------------------------------------------------------------------------------
7. Trusted Time & Clock  Affirmed token expiration requires   process.hrtime.bigint() for pairing; Monotonic pairing duration; anchor
   Rollback Protection   valid timestamps.                    lastKnownCloudTime anchor; rollback  lastKnownCloudTime in SQLite; rollback
                                                              > 5 min triggers lockout & audit.    > 5 min locks node and emits CRITICAL.
----------------------------------------------------------------------------------------------------------------------------------
8. Audit Sequencing &    TerminalEnrolada is local forensic   TerminalEnrolada / SUCCESS emitted   Post-commit audit emission only;
   False-Success Bug     provenance; must not conflate with   ONLY AFTER atomic transaction commit; mandatory default local audit sink;
                         WP-012 WAN replication event.        fail-closed audit execution.         WP-012 owns outbox_queue transport.
----------------------------------------------------------------------------------------------------------------------------------
9. Persistence API       getEnrollmentPersistence() is an     Public persistence escape hatches    EnrollmentPersistence is strictly
   Encapsulation         ungoverned backdoor; must be         bypass trust bootstrap verification; package-private / internal to
                         package-private / module-internal.   must remain module-internal.         @trident/edge. Public API removed.
==================================================================================================================================
```

---

## 3. Inventory of Governed SSOT Files Amended

The following seven (7) canonical architecture documents have been amended to incorporate the synthesized decisions:

1. **`DATA_AUTHORITY_MATRIX.md`:** Added 4 explicit rows in Section 1 establishing SoR, writable nodes, read replicas, and sync directions for `stations`, `edge_hosts`, `enrollment_tokens`, and `station_credentials`.
2. **`DATA_MODEL.md`:** Added Section 3 SQLite DDL for `enrollment_tokens` and `station_credentials` with composite unique constraints and check constraints, excluding `station_token_hash`.
3. **`DATA_DICTIONARY.md`:** Added 17 dictionary attribute definitions for `enrollment_tokens` and `station_credentials`.
4. **`SECURITY_ARCHITECTURE.md`:** Added Invariants 4 through 7 in Section 3.2 enforcing OS Keyring encryption, prohibition of silent TLS regeneration, TLS probe isolation, post-commit audit emission, and platform pin storage.
5. **`IAM_SECURITY_MODEL.md`:** Updated Sections 4 and 5 with persistent HMAC key specifications, session vs. identity separation, monotonic pairing timer, `lastKnownCloudTime` storage anchor, and `ClockRollbackDetected` CRITICAL audit lockout.
6. **`SECURITY_CONTROL_MATRIX.md`:** Added Section 3 formally specifying `SEC-VAL-03` debt disposition (software algorithms closed in WP-009, hardware LAN validation assigned to WP-028).
7. **`IMPLEMENTATION_PLAN.md`:** Updated WP-009 outputs, acceptance criteria, test descriptions, and Section 11 debt mappings to enforce `DATA-INV-WP009-01`, internal persistence encapsulation, and elimination of public overrides.

---

## 4. Verification Checklist & Invariants Confirmation

- [x] Canonical `main` confirmed at `bb44f35bbe459ae86869b541e42dea12fc8173f8`.
- [x] Dedicated branch `governance/acr-2026-011-wp-009-trust-bootstrap` created from exact G8.
- [x] Application code modified: **NO** (Zero lines in `packages/*` source files changed).
- [x] PR #28 modified: **NO** (PR remains in its original state on branch `feature/wp-009-edge-enrollment-trust-bootstrap`).
- [x] Clarification branches ED9 and ES9C modified: **NO** (Both remain unchanged sibling branches).
- [x] Product Owner protected decisions (`OQ-SSOT-01` to `07`, `OQ-ARCH-01`, `OQ-ARCH-02`) preserved: **YES** (All remain `PENDING PO DECISION`).
- [x] Product Owner Status: **`PROPOSED / PENDING PRODUCT OWNER APPROVAL`**.

---

DOCUMENT STATUS: SYNTHESIS COMPLETE — READY FOR GOVERNANCE REVIEW
