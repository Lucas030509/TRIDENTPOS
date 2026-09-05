# GOVERNANCE ERRATA — WP-007 ACR IDENTIFIER CORRECTION

**Canonical Errata ID:** `ACR-2026-009`  
**Project:** ERP RESTAURANTES / TRIDENTPOS  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Classification:** `METADATA-ONLY GOVERNANCE IDENTIFIER CORRECTION`  
**Status:** `CANONICAL ERRATA`  
**Effective Base:** `ae5810b49789d56cf322fd501026ee0975b2916a`  
**Operating Mode:** `SOLO_MAINTAINER`

---

## 1. Purpose

This errata resolves a clerical Architecture Change Request identifier collision introduced during the WP-007 pre-implementation consistency transaction.

No architecture, requirement, acceptance criterion, security control, data model, implementation boundary, Product Owner decision, test obligation, or work-package ownership is changed by this document.

---

## 2. Collision

The identifier `ACR-2026-008` was already canonically assigned to:

- `ARCHITECTURE_CHANGE_REQUEST_WP006_FINAL_INTEGRITY_CLOSURE.md`
- WP-006 Final Integrity Closure

The subsequently merged WP-007 document:

- `ARCHITECTURE_CHANGE_REQUEST_WP007_EDGE_RUNTIME_CONSISTENCY.md`

also displayed `ACR-2026-008` due solely to a clerical numbering error.

Architecture Change Request identifiers must be unique.

---

## 3. Canonical Resolution

Effective immediately:

- `ACR-2026-008` remains exclusively assigned to WP-006 Final Integrity Closure.
- The canonical identifier for `ARCHITECTURE_CHANGE_REQUEST_WP007_EDGE_RUNTIME_CONSISTENCY.md` is `ACR-2026-009`.
- Any historical or current WP-007 reference reading `ACR-2026-008 (Edge Runtime SSOT Reference & Execution Boundary Correction)` MUST be interpreted as `ACR-2026-009`.
- Specifically, the WP-007 `Governing Architecture` reference in `IMPLEMENTATION_PLAN.md` is superseded by this errata with respect to identifier only.

The filename, technical body, scope, security invariants, implementation boundaries, and test obligations of the reviewed WP-007 ACR remain unchanged.

---

## 4. Review Preservation

The WP-007 pre-implementation author subject remains:

`accb831ea8d3a61efa4e078a7f882f7f0a28e541`

The independent Security review evidence remains:

`06ae4e7c5c5f2dd166ecde9f8b67c41a2b281594`

That review evaluated the substantive technical contents and implementation boundary of the WP-007 ACR. This errata changes only the unique governance identifier and therefore does not invalidate the technical Security Review verdict.

No prior review evidence is rewritten.

---

## 5. Builder Rule

All WP-007 implementation and review evidence created after this errata MUST reference:

`ACR-2026-009 — WP-007 Edge Runtime SSOT Reference & Execution Boundary Correction`

Builders and reviewers MUST NOT cite `ACR-2026-008` as a WP-007 governing ACR.

---

## 6. Non-Changes

The following remain unchanged:

- Builder: `16_Native_Edge_Developer`
- Specialist Reviewer: `08_Security_Architect`
- Mandatory Code Reviewer: `11_Code_Reviewer`
- Electron / Node.js Edge baseline
- `SEC-VAL-07` ownership
- all 9 Product Owner decisions remain `PENDING PO DECISION`
- WP-008 / WP-009 / WP-010 scope boundaries
- Stage B required checks
- ADR-003 hardware certification debt remains OPEN

---

## 7. Precedence

For identifier resolution only, this errata has precedence over the duplicate `ACR-2026-008` label embedded in the WP-007 pre-implementation documents.

For all substantive technical requirements, the reviewed WP-007 ACR and `IMPLEMENTATION_PLAN.md` remain authoritative.
