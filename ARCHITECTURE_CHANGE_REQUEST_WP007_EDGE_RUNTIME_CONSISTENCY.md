# ARCHITECTURE CHANGE REQUEST: WP-007 EDGE RUNTIME SSOT REFERENCE & EXECUTION BOUNDARY CORRECTION

**ID:** `ACR-2026-008`  
**Framework:** `EAAF v1.2.0 @ 7e036f43240b3dc28ccb996e350263598275b2cd`  
**Workflow:** `workflows/ARCHITECTURE_CHANGE.md`  
**Requester:** `01_Solution_Architect — WP-007 IMPLEMENTATION PLAN CONSISTENCY REMEDIATION AUTHOR`  
**Date:** `2026-09-04`  
**Status:** `PROPOSED / PENDING GOVERNED REVIEW`  
**Base Commit:** `42a4d2698e814e1a5e6cd5da3755bb52a1ac6fb7`  
**Operating Mode:** `SOLO_MAINTAINER`  
**Classification:** `NON-FUNCTIONAL GOVERNANCE CONSISTENCY CORRECTION`  

---

## 1. Governance Affirmations & Invariants

This Architecture Change Request is a non-functional governance and plan consistency correction executed prior to the activation of the Builder (`16_Native_Edge_Developer`) for Work Package `WP-007: Edge Host Runtime Scaffolding & Electron Security Hardening`.

The following invariants are formally affirmed:
1. **Runtime Baseline Preserved:** Electron / Node.js (TypeScript) remains the frozen, authoritative Edge Host runtime baseline as governed by `TECH_STACK_DECISIONS.md` and `ADR-003`.
2. **Zero Functional Modifications:** No product feature, functional capability, or restaurant business workflow is added, modified, or removed.
3. **Product Owner Neutrality Preserved:** All nine (9) protected Product Owner decisions remain `PENDING PO DECISION`. No business behavior is resolved or pre-empted.
4. **Data Models Unchanged:** No relational schema, local SQLite schema, or entity data model is altered.
5. **Zero Weakening of Security Controls:** No security control, isolation boundary, or hardening requirement is weakened, bypassed, or removed. All acceptance criteria are clarified to enforce fail-closed verification.
6. **Purpose:** The sole purpose is to eliminate erroneous source-section citations, align requirement references with the authoritative architecture baselines, and strictly freeze the execution boundaries between `WP-007` and subsequent Edge/Sync work packages.

---

## 2. Problem Statement & Ambiguities Identified

A pre-implementation audit of `IMPLEMENTATION_PLAN.md` (WP-007) identified two erroneous cross-document citations and several execution ambiguities:

1. **Erroneous Requirement Reference (Contradiction A):**
   `IMPLEMENTATION_PLAN.md` cites `SOLUTION_ARCHITECTURE.md Sec. 3` for WP-007. However, Section 3 of `SOLUTION_ARCHITECTURE.md` is titled *"Manejo de Eventos en Cloud: In-Process vs. Durable Integration Outbox (REM-05)"* and governs Cloud event messaging. The actual Edge Host Container Model and Branch Operational Plane are defined in `SOLUTION_ARCHITECTURE.md Sec. 1`, `DEPLOYMENT_TOPOLOGY.md Sec. 1 & 3`, `TECH_STACK_DECISIONS.md Sec. 1 & 2`, and `ADR-003`.
2. **Erroneous Security Reference (Contradiction B):**
   `IMPLEMENTATION_PLAN.md` cites `SECURITY_ARCHITECTURE.md Sec. 8` for WP-007. Section 8 governs *"Peripheral and Payment Security Boundary"* (ESC/POS printers and payment terminals). The actual Electron Security hardening baseline is established in `SECURITY_ARCHITECTURE.md Sec. 9` (*"Electron Runtime Security Baseline"*).
3. **Unbounded Execution Scope (Risk of Scope Creep):**
   Without explicit execution boundaries, the Builder could prematurely attempt to implement SQLite databases (`WP-008`), station pairing/mTLS enrollment (`WP-009`), or offline PIN authentication (`WP-010`) within WP-007.
4. **Configuration Secrets Leakage Risk:**
   `IMPLEMENTATION_PLAN.md` declares `edge-config.json` without defining its security boundaries, risking the accidental persistence of secret-bearing material (tokens, private keys, database encryption keys) in cleartext configuration.
5. **Version Pinning Specifics:**
   The directive `Electron 30+ (IMPLEMENTATION VERSION TO PIN)` requires procedural clarification regarding monorepo toolchain alignment and host Node.js LTS (Node 24) vs. Electron's internal embedded Node runtime per `ADR-011`.

---

## 3. Normalized Architectural Source Citations

The frozen architectural references for `WP-007` are formally corrected and normalized to the following governing sources:

### 3.1 Solution Architecture & Deployment Topology
- **`SOLUTION_ARCHITECTURE.md` Sec. 1:** Container Model (C4 Level 2) — Branch Operational Plane container definition and Edge Host process topology.
- **`DEPLOYMENT_TOPOLOGY.md` Sec. 1:** Edge Host deployment topology and local network boundary.
- **`DEPLOYMENT_TOPOLOGY.md` Sec. 3:** Branch Operational Plane — provisional hardware baseline (x86_64 / ARM64, 4GB–8GB RAM constraints).

### 3.2 Technical Stack & Decision Records
- **`TECH_STACK_DECISIONS.md` Sec. 1:** Edge Host Runtime baseline (`Electron / Node.js TypeScript`).
- **`TECH_STACK_DECISIONS.md` Sec. 2:** Electron vs. Tauri architectural trade-offs and performance certification directive (`REM-08`).
- **`ADR-003` Sec. 5:** Selected Baseline — Electron / Node.js for local Edge Host orchestration.
- **`ADR-003` Sec. 8:** Failure Modes — Worker separation and main-thread blocking mitigation.
- **`ADR-003` Sec. 9:** Security Considerations — Hardening mandates and vulnerability minimization.
- **`ADR-003` Sec. 11:** Validation & Evidence Required — Baseline target hardware qualification.

### 3.3 Security Architecture Baseline
- **`SECURITY_ARCHITECTURE.md` Sec. 9:** Electron Runtime Security Baseline:
  - `contextIsolation = true` and `nodeIntegration = false` mandatory across all windows.
  - Minimal preload scripts with strictly typed IPC bridge and static channel allowlist.
  - Restrictive Content Security Policy (CSP): `default-src 'self'; script-src 'self'; connect-src 'self' wss: https:;`.
  - Code signing and update signature verification baseline.

---

## 4. Work Package 007 Implementation Boundary Freeze

To prevent premature feature creep and ensure role separation, the execution boundary for `WP-007` is strictly defined:

### 4.1 Permitted Scope (WP-007 MAY Implement)
1. Electron application package and scaffolding inside the existing monorepo architecture (e.g. `@trident/edge` or dedicated application workspace).
2. Electron main process bootstrap and lifecycle management.
3. Minimal, hardened preload script utilizing `contextBridge`.
4. Minimal renderer bootstrap required exclusively to verify and prove runtime boundary security.
5. `BrowserWindow` security configuration enforcing:
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: true`
   - `webSecurity: true`
6. Restrictive Content Security Policy (CSP) headers complying with `SECURITY_ARCHITECTURE.md Sec. 9`.
7. Statically declared, typed IPC bridge exposed via `contextBridge.exposeInMainWorld()`.
8. Explicit IPC channel allowlist (disallowing arbitrary channels).
9. Trusted boundary payload validation for all IPC messages in the main process.
10. Interception and blocking of arbitrary external URL navigation (`will-navigate` / `setWindowOpenHandler`).
11. Denial of unauthorized window creation (default-deny on popup/new window requests).
12. Security-focused automated test suite exercising positive and negative isolation controls.
13. Minimal Edge worker / process separation scaffold if required to satisfy `ADR-003 Sec. 8`.

### 4.2 Strictly Prohibited Scope (WP-007 MUST NOT Implement)
The following capabilities belong exclusively to subsequent work packages and are prohibited in WP-007:
- **SQLite Database & Durability (`WP-008`):** No SQLite connection, WAL configuration, SQLCipher encryption, or migrations.
- **Station Enrollment & Trust Bootstrap (`WP-009`):** No pairing QR generation, mTLS certificate enrollment, mDNS discovery, or station credentials.
- **Offline IAM & Authentication Engine (`WP-010`):** No local PIN authentication, Argon2id verification, CachedUsers cache, or session ticket issuance.
- **Local Business APIs & Synchronization (`WP-011` / `WP-012` / `WP-013`):** No local HTTP REST endpoints, WebSocket sync engines, transactional outbox handlers, or WAN replication.
- **Peripherals & Functional Floor Logic (`WP-014`–`WP-024`):** No printer drivers (ESC/POS), cash drawer controls, KDS business logic, table orders, or POS billing.
- **Production Packaging & Release Automation:** No production auto-update daemon, production code signing certificates, or distribution installers.
- **Product Owner Decisions:** No resolution of pending business decisions.

---

## 5. Security & Configuration Policies

### 5.1 Edge Configuration Boundary (`edge-config.json`)
If created or scaffolded during `WP-007`, `edge-config.json` is strictly restricted to non-sensitive runtime configuration metadata (e.g. environment name, port bindings, log level).
- **Prohibited Secrets:** Passwords, PINs, pin hashes, JWTs, refresh tokens, enrollment tokens, private keys, API secrets, database keys, OAuth secrets, pairing secrets, and service credentials MUST NEVER appear in `edge-config.json`.
- **Validation:** Configuration must be strictly validated against a typed schema upon startup and fail closed on unrecognized or malformed properties.

### 5.2 Electron Trust Boundary Governed Invariants
1. **Renderer Isolation:** Renderer process must have zero access to Node.js built-ins (`require`, `process`, `fs`, `child_process`, `net`, `os`, `crypto`).
2. **Preload Sanitization:** Preload scripts must never expose the raw `ipcRenderer` object or generic proxy methods (such as `send(channel, ...)` or `invoke(channel, ...)`). Only specific, typed functions with static allowlisted channels may be exposed.
3. **Navigation Lockdown:** All window open events and navigation attempts away from the local application origin must be intercepted and denied (`default-deny`).
4. **CSP Enforcement:** CSP must prohibit inline script execution (`'unsafe-inline'`), dynamic script evaluation (`'unsafe-eval'`), and wildcard origin loading.
5. **Fail-Closed Semantics:** Unknown IPC channel requests or invalid payloads must trigger immediate rejection and operational security logging.

---

## 6. Version Pinning Governance

- The Builder must select and pin an exact supported version of Electron (`>= 30.0.0`) in `package.json` and `package-lock.json`.
- The version selection must integrate deterministically with the repository's npm workspace structure.
- Host development and build tooling continue to be governed by Node.js 24 LTS (`ADR-011`). The Node.js version bundled internally within the selected Electron binary is governed by Electron's upstream distribution; the Builder shall not attempt to force Electron's embedded runtime to match the host Node version.
- Floating ranges (`^` or `~`) for the core runtime dependency are prohibited.

---

## 7. Security Debt & Verification Staging

- **`SEC-VAL-07` Ownership:** `WP-007` is directly accountable for providing automated validation evidence for `SEC-VAL-07` (*Electron Security & IPC Allowlist Hardening*).
- **Non-Closure of Unrelated Security Debt:** The execution of `WP-007` MUST NOT close or claim resolution for:
  - `SEC-VAL-03` (Station Pairing & Trust Bootstrap — `WP-009`)
  - `SEC-VAL-02` (Offline IAM Brute Force Resistance — `WP-010`)
  - `SEC-VAL-08` (Target Hardware Argon2 Benchmark — `WP-010`)
  - `SEC-VAL-06` (Edge SQLite & Sync Tamper-Evidence — `WP-013`)
  - `DAT-04` / `RSK-08` (SQLite Power-Loss Durability — `WP-008`)
  - `RSK-11` (Low-Memory Target POS Hardware Certification — Later Gate)
- **ADR-003 Benchmark Requirement:** Final POS target-hardware benchmarking remains `OPEN` until the full Edge software stack is assembled for hardware certification.

---

## 8. Summary of Plan Changes (`IMPLEMENTATION_PLAN.md`)

Section `#### WP-007` in `IMPLEMENTATION_PLAN.md` is amended to:
1. Replace `SOLUTION_ARCHITECTURE.md Sec. 3` with `SOLUTION_ARCHITECTURE.md Sec. 1`, `DEPLOYMENT_TOPOLOGY.md Sec. 1, 3`, `TECH_STACK_DECISIONS.md Sec. 1, 2`, and `ADR-003`.
2. Replace `SECURITY_ARCHITECTURE.md Sec. 8` with `SECURITY_ARCHITECTURE.md Sec. 9`.
3. Enumerate the explicit permitted vs. prohibited implementation boundary rules.
4. Detail the 11 objective automated test obligations required for `SEC-VAL-07`.
5. Codify the security boundaries of `edge-config.json`.
