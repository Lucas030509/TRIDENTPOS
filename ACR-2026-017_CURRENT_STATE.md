# ACR-2026-017 — Current Canonical State

**Status:** APPROVED / MERGED / CANONICAL ON MAIN  
**Date:** 2026-09-17  
**Repository:** `Lucas030509/TRIDENTPOS`  
**ACR Document:** `ARCHITECTURE_CHANGE_REQUEST_WP018_INVENTORY_LEDGER_RECONCILIATION.md`  
**Approved Frozen Subject:** `33a64cb5bdbfdcaf0aace7adca1cd88c9b43edc3`  
**PR:** `#50`  
**Canonical Merge:** `734b97646b26f2029ee9d51b95697d9610e73d62`  
**Product Owner Approval:** `60ae17d2432b86a887889d7acf510ff542cd2776`  
**PR Validation:** `ce697bd27669fc6496c283a04396d5fb685bdd06`  
**Merge Authorization:** `b8a04bc6cb657f28f1389a469beb89a06c12b627`  
**Post-Merge CI:** `35268507312` — SUCCESS  
**Post-Merge Security Scan:** `35268507409` — SUCCESS  

## Current-State Authority

This file is the current-state status overlay for ACR-2026-017.

The header inside the frozen ACR subject still contains pre-approval wording (`PROPOSED / FROZEN CANDIDATE R2 — PENDING INDEPENDENT REVIEW`) because that text is part of the exact Product-Owner-approved frozen subject and was intentionally not rewritten after approval.

For status/provenance only, that pre-approval header is historical and is superseded by this current-state overlay.

The semantic content of the approved ACR is unchanged.

## Canonical Effect

ACR-2026-017 is binding authority for WP-018 and supersedes conflicting older WP-018 wording as specified by the approved ACR.

Canonical effects include:

- `stock_ledger` is the sole authoritative inventory movement ledger.
- Current stock is derived from append-only ledger movements and is not a separately writable source of truth.
- KDS depletion and waste registration require durable idempotency.
- Inventory tenant isolation uses RLS/FORCE RLS and tenant-safe composite relational integrity.
- Negative stock does not block restaurant sale or KDS completion solely due to insufficient stock; the movement commits and operational alerting is produced.
- Waste evidence links atomically to exactly one canonical `MERMA` ledger movement.
- `InventarioDescontadoPorReceta` is emitted through durable Cloud transactional-outbox semantics.
- Modifier-dependent depletion must not invent or silently ignore modifier semantics.
- `OQ-SSOT-07` remains OPEN.

## Protected Product Owner Decisions

Protected Product Owner state remains:

**9 / 9 OPEN**

This current-state overlay closes no Product Owner question and changes no approved business semantics.

## Governance Provenance

- Quick Integrity: `a92a3bc66e987859d81092337fc26fcc02a4eff0` — PASS
- Solution Review: `814faf9dff46108c724ab35c2944e5d20d2630b7` — PASS
- Data Review: `016bf839a8ec5771fb00a57a2073ceb8d8b78bf1` — PASS
- Code Consistency Review: `e555f0045b9259091ad8f3ac7ca102f569c51f2f` — PASS
- Coordinator Synthesis: `c8aa03f6d1cfce5a0040091365319732d631b47f` — PASS
- Product Owner Approval: `60ae17d2432b86a887889d7acf510ff542cd2776` — PASS
- PR Gate: `f2569ac27a4401862822053b5bd886252849cf3d` — PASS
- PR Validation: `ce697bd27669fc6496c283a04396d5fb685bdd06` — PASS
- Merge Authorization: `b8a04bc6cb657f28f1389a469beb89a06c12b627` — PASS
- PR #50: MERGED
- Canonical merge: `734b97646b26f2029ee9d51b95697d9610e73d62`
- Post-merge CI run `35268507312`: SUCCESS
- Post-merge Security Scan run `35268507409`: SUCCESS

## Verdict

**ACR-2026-017: APPROVED / MERGED / CANONICAL ON MAIN**

WP-018 architecture/data governance precondition is satisfied once this status overlay itself is merged and post-merge validated.
