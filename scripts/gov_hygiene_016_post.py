from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s), found {count}: {old!r}")
    p.write_text(text.replace(old, new))


MERGE = "d17633ab26606baf67029609f9db6d993b5c9909"
PO = "d3c37383999242100cf23caab3e2e4ba8ce0b03b"
CI = "35229769662"
SEC = "35229769855"

acr = "ARCHITECTURE_CHANGE_REQUEST_KDS_CONTRACT_DATA_RECONCILIATION.md"
replace_exact(acr, "**Status:** `PROPOSED — PENDING INDEPENDENT REVIEW`", "**Status:** `APPROVED / MERGED / CANONICAL ON MAIN`")
replace_exact(
    acr,
    "**Authoring Branch:** `architecture/acr-2026-016-kds-contract-data-reconciliation-r3`",
    "**Authoring Branch:** `architecture/acr-2026-016-kds-contract-data-reconciliation-r3`\n"
    "**Canonical PR:** `#45`\n"
    f"**Canonical Merge Commit:** `{MERGE}`\n"
    f"**Product Owner Approval Evidence:** `{PO}`\n"
    f"**Post-Merge CI:** `{CI}` — `SUCCESS`\n"
    f"**Post-Merge Security:** `{SEC}` — `SUCCESS`",
)

adr = "ADR/ADR-005-local-lan-communication-protocol.md"
replace_exact(
    adr,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Reaffirms the physical LAN 20-client saturation benchmark requirement (`< 5 ms` target latency) and formalizes performance validation debt `PERF-VAL-015-01`, owned for empirical hardware discharge by `WP-028` (Hardware Benchmarking & Release Packaging). Software loopback tests in `WP-015` qualify as software-only evidence and do not discharge physical LAN validation. Pending formal independent review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Reaffirms the physical LAN 20-client saturation benchmark requirement (`< 5 ms` target latency) and formalizes performance validation debt `PERF-VAL-015-01`, owned for empirical hardware discharge by `WP-028` (Hardware Benchmarking & Release Packaging). Software loopback tests in `WP-015` qualify as software-only evidence and do not discharge physical LAN validation. Product Owner approval and post-merge validation are complete; `PERF-VAL-015-01` remains OPEN until discharged by `WP-028`.",
)

fa = "FUNCTIONAL_ARCHITECTURE.md"
replace_exact(
    fa,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: Clarification of KDS functional contracts, formalization of `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)` as an id-keyed query anchored on `completed_at`, and inclusion of operational `tiempoPreparacionMinutos` persistence and event propagation in `OrdenProduccionConfirmadaEnKDS`. Pending independent review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: clarification of KDS functional contracts, formalization of `RecuperarOrdenRecall(ordenProduccionId, ventanaMaxMinutos = 120)` as an id-keyed query anchored on `completed_at`, and inclusion of operational `tiempoPreparacionMinutos` persistence and event propagation in `OrdenProduccionConfirmadaEnKDS`.",
)
replace_exact(fa, "**Version:** `1.4 PROPOSED OVERLAY — ACR-2026-016`", "**Version:** `1.4 MERGED / CANONICAL ON MAIN — ACR-2026-016`")
replace_exact(fa, "**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`", f"**Status:** `ACR-2026-016: APPROVED / MERGED / CANONICAL ON MAIN` (PR `#45`, canonical merge commit `{MERGE}`)")

dm = "DATA_MODEL.md"
replace_exact(
    dm,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Establishes `kds_tickets` and `kds_ticket_partidas` as the sole authoritative Edge runtime schema for KDS production orders, classifies historical `kds_ordenes` as superseded/non-writable, standardizes `kds_estaciones` and `impresoras_red`, integrates `preparation_time_minutes` (INTEGER NULL `>= 0`), and enforces `ADR-012` Scale 4 integer quantity representation. Pending formal independent review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Establishes `kds_tickets` and `kds_ticket_partidas` as the sole authoritative Edge runtime schema for KDS production orders, classifies historical `kds_ordenes` as superseded/non-writable, standardizes `kds_estaciones` and `impresoras_red`, integrates `preparation_time_minutes` (INTEGER NULL `>= 0`), and enforces `ADR-012` Scale 4 integer quantity representation.",
)
replace_exact(dm, "**Version:** `1.3 PROPOSED OVERLAY — ACR-2026-016`", "**Version:** `1.3 MERGED / CANONICAL ON MAIN — ACR-2026-016`")
replace_exact(dm, "**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`", f"**Status:** `ACR-2026-016: APPROVED / MERGED / CANONICAL ON MAIN` (PR `#45`, canonical merge commit `{MERGE}`)")

dd = "DATA_DICTIONARY.md"
replace_exact(
    dd,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Adds dictionary definitions for authoritative KDS entities (`kds_estaciones`, `impresoras_red`, `kds_tickets`, `kds_ticket_partidas`), formalizes `preparation_time_minutes` (INTEGER NULL `>= 0`) and ADR-012 scale-4 integer `quantity`, and classifies historical `kds_ordenes` as superseded/non-writable. Pending formal independent review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Adds dictionary definitions for authoritative KDS entities (`kds_estaciones`, `impresoras_red`, `kds_tickets`, `kds_ticket_partidas`), formalizes `preparation_time_minutes` (INTEGER NULL `>= 0`) and ADR-012 scale-4 integer `quantity`, and classifies historical `kds_ordenes` as superseded/non-writable.",
)
replace_exact(dd, "**Version:** `1.3 PROPOSED OVERLAY — ACR-2026-016`", "**Version:** `1.3 MERGED / CANONICAL ON MAIN — ACR-2026-016`")
replace_exact(dd, "**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`", f"**Status:** `ACR-2026-016: APPROVED / MERGED / CANONICAL ON MAIN` (PR `#45`, canonical merge commit `{MERGE}`)")

dam = "DATA_AUTHORITY_MATRIX.md"
replace_exact(
    dam,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Formalizes `kds_tickets` + `kds_ticket_partidas` as the sole authoritative Edge runtime entities for KDS production orders, `kds_estaciones` for station config, `impresoras_red` for printer config, and designates historical `kds_ordenes` as superseded and non-writable. Pending formal independent review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Formalizes `kds_tickets` + `kds_ticket_partidas` as the sole authoritative Edge runtime entities for KDS production orders, `kds_estaciones` for station config, `impresoras_red` for printer config, and designates historical `kds_ordenes` as superseded and non-writable.",
)
replace_exact(dam, "**Version:** `1.2 PROPOSED OVERLAY — ACR-2026-016`", "**Version:** `1.2 MERGED / CANONICAL ON MAIN — ACR-2026-016`")
replace_exact(dam, "**Status:** `PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL`", f"**Status:** `ACR-2026-016: APPROVED / MERGED / CANONICAL ON MAIN` (PR `#45`, canonical merge commit `{MERGE}`)")

ip = "IMPLEMENTATION_PLAN.md"
replace_exact(
    ip,
    "> **ACR-2026-016 PROPOSED ARCHITECTURE CHANGE — PENDING GOVERNANCE APPROVAL**\n>\n> Proposed amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Establishes `kds_tickets` as the sole authoritative Edge runtime entity (classifying historical `kds_ordenes` as superseded/non-writable), reconciles `RecuperarOrdenRecall` as id-keyed by `ordenProduccionId` anchored on `completed_at`, canonicalizes operational `preparation_time_minutes` persistence and event propagation, enforces `ADR-012` Scale 4 integer quantities on `kds_ticket_partidas`, and formalizes performance validation debt `PERF-VAL-015-01` owned by `WP-028`. Pending formal review and Product Owner approval.",
    f"> **ACR-2026-016 APPROVED / MERGED / CANONICAL ON MAIN** (PR `#45`, canonical merge commit `{MERGE}`)\n>\n> Canonical amendment under `ACR-2026-016`: KDS Contract & Data Authority Reconciliation. Establishes `kds_tickets` as the sole authoritative Edge runtime entity (classifying historical `kds_ordenes` as superseded/non-writable), reconciles `RecuperarOrdenRecall` as id-keyed by `ordenProduccionId` anchored on `completed_at`, canonicalizes operational `preparation_time_minutes` persistence and event propagation, enforces `ADR-012` Scale 4 integer quantities on `kds_ticket_partidas`, and formalizes performance validation debt `PERF-VAL-015-01` owned by `WP-028`. Product Owner approval and post-merge CI/security validation are complete; `PERF-VAL-015-01` remains OPEN.",
)
replace_exact(
    ip,
    "**Version:** `1.3 MERGED / CANONICAL ON MAIN — ACR-2026-015` (Underlying baseline: `1.0 APPROVED / FROZEN — 2026-09-03` with ACR-2026-011 Canonical Overlay — G9; ACR-2026-013, ACR-2026-014, and ACR-2026-015 overlays are all `MERGED / CANONICAL ON MAIN`) *(current-state corrected post-merge — GOV-HYGIENE-015-POST-01; previously read \"1.3 CANDIDATE OVERLAY — ACR-2026-015\")*",
    "**Version:** `1.4 MERGED / CANONICAL ON MAIN — ACR-2026-016` (Underlying baseline: `1.0 APPROVED / FROZEN — 2026-09-03` with ACR-2026-011 Canonical Overlay — G9; ACR-2026-013, ACR-2026-014, ACR-2026-015, and ACR-2026-016 overlays are all `MERGED / CANONICAL ON MAIN`)",
)
replace_exact(
    ip,
    "**Status:** `ACR-2026-015: MERGED / CANONICAL ON MAIN` (PR `#43`, canonical merge commit `456f75e854d62012af899cd2a467446375e5d65f`; `ACR-2026-013`/`ACR-2026-014`/`ACR-2026-015` are all canonical on `main`; see banners above) *(current-state corrected post-merge — GOV-HYGIENE-015-POST-01; previously read \"PRODUCT OWNER APPROVED / GATE PASSED — PENDING CANONICAL MERGE\")*",
    f"**Status:** `ACR-2026-016: APPROVED / MERGED / CANONICAL ON MAIN` (PR `#45`, canonical merge commit `{MERGE}`; `ACR-2026-013`/`ACR-2026-014`/`ACR-2026-015`/`ACR-2026-016` are canonical on `main`; see banners above)",
)

targets = [acr, adr, fa, dm, dd, dam, ip]
stale = [
    "ACR-2026-016 PROPOSED ARCHITECTURE CHANGE",
    "PENDING INDEPENDENT REVIEW",
    "PROPOSED OVERLAY — ACR-2026-016",
    "Pending formal independent review and Product Owner approval",
    "Pending formal review and Product Owner approval",
    "Pending independent review and Product Owner approval",
]
for path in targets:
    text = Path(path).read_text()
    for marker in stale:
        if marker in text:
            raise SystemExit(f"stale current-state marker remains in {path}: {marker}")

ip_text = Path(ip).read_text()
for required in ["OQ-SSOT-01", "OQ-SSOT-07", "OQ-ARCH-01", "OQ-ARCH-02", "PERF-VAL-015-01", "WP-026"]:
    if required not in ip_text:
        raise SystemExit(f"Implementation Plan invariant missing after edit: {required}")

print("Metadata remediation assertions passed for exactly seven governed files.")
