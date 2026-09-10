# SEC-VAL-07: ELECTRON SECURITY & IPC ALLOWLIST HARDENING EVIDENCE REPORT

## 1. Executive Governance & Control Objective

- **Control Gate:** `SEC-VAL-07` — Electron Security & IPC Allowlist Hardening
- **Work Package:** `WP-007` — Edge Host Runtime Scaffolding & Electron Security Hardening
- **Builder Agent:** `16_Native_Edge_Developer`
- **Operating Mode:** `SOLO_MAINTAINER`
- **Governing Architecture Change Request:** `ACR-2026-009` (Edge Runtime SSOT Reference & Execution Boundary Correction)
- **Canonical Errata Reference:** `GOVERNANCE_ERRATA_WP007_ACR_ID.md`
- **Implementation Base SHA:** `0ab4cf993970795844fcd7b746d31d3c3c252485`
- **Feature Branch:** `feature/wp-007-edge-runtime-electron-hardening`
- **PR:** `#24`
- **Governed Toolchain & Pinned Versions:**
  - Host Node.js LTS Toolchain: `24.20.0`
  - Host npm: `11.19.0`
  - Host TypeScript: `~5.4.5` (`skipLibCheck = false`)
  - Pinned Electron Runtime Dependency: `electron@44.3.0` (exact pin in `packages/edge/package.json`)
  - Embedded Chromium Engine: `152.0.7977.78`
  - Embedded Node.js Runtime in Electron: `24.20.0`
  - Embedded V8 Engine: `15.2.124.19`
- **Date:** 2026-09-10
- **Remediation Iteration:** R1 (Actual Electron Runtime Security Validation)
- **Builder Verdict:** `READY FOR ROLE-SEPARATED REVIEW`
- **SEC-VAL-07 Control Status:** `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION`

---

## 2. Prior Quick Integrity Blocker & Remediation

### 2.1 Blocker Identified
During initial external Quick Integrity Check of subject `S1` (`04bf722a20c2cf6afcdb57e78caaf60ac5494c94`), one blocking issue was identified:
> "SEC-VAL-07 currently relies primarily on Node.js unit/simulation tests and does NOT objectively exercise the hardened boundary inside an actual Electron runtime."

### 2.2 Remediation Executed
1. **Preserved Unit-Level Defense:** Kept existing test suite `WP007-T01` through `WP007-T22` (22 tests) validating static invariants, payload parsers, configuration boundaries, and dispatch guards under pure Node.js.
2. **Added Actual Electron Integration Suite:** Implemented `packages/edge/src/electron.test.ts` executing inside the real pinned `electron@44.3.0` binary without mocks.
3. **Real Electron Harness Validation Points:**
   - Real BrowserWindow effective preferences verified via `webContents.getLastWebPreferences()`.
   - Real renderer execution verified via `webContents.executeJavaScript()`.
   - Real preload script loaded inside the production window, exposing `window.tridentBridge`.
   - Real IPC round-trip verified end-to-end (`renderer -> contextBridge -> preload -> ipcRenderer -> ipcMain -> handler -> response`).
   - Arbitrary IPC negative test proving unexposed escape hatches.
   - Real `will-navigate` lifecycle interception blocking external navigation while remaining on the local origin.
   - Real `setWindowOpenHandler` default-deny blocking popup/new-window creation.
   - Real Content Security Policy enforcement verified in live renderer (dynamic `eval()` blocked).
4. **Deterministic Headless Linux Execution:**
   - Implemented `packages/edge/scripts/run-electron-tests.mjs` which detects headless Linux environments and wraps Electron in `xvfb-run`.
   - Modified `.github/workflows/ci.yml` `unit-tests` job to run under `xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" npm run test`.
5. **Transitive npm Scripts:** Configured `test:unit`, `test:electron`, and composite `test: npm run test:unit && npm run test:electron`.

---

## 3. Trust Boundary & Security Architecture Controls Implemented

```
+-----------------------------------------------------------------------------------------+
|                                    RENDERER CONTEXT                                     |
|                                                                                         |
|  [ Production HTML / Scripts ]                                                          |
|  - contextIsolation: true                                                               |
|  - nodeIntegration: false                                                               |
|  - sandbox: true                                                                        |
|  - webSecurity: true                                                                    |
|  - Zero Node primitives (require, process, Buffer, fs, child_process = undefined)       |
|  - Content Security Policy: default-src 'self'; script-src 'self';                      |
|                            connect-src 'self' wss: https:;                              |
+-----------------------------------------------------------------------------------------+
                                           |
                                           | Typed invocations via window.tridentBridge
                                           v
+-----------------------------------------------------------------------------------------+
|                                    PRELOAD BOUNDARY                                     |
|                                                                                         |
|  [ contextBridge.exposeInMainWorld('tridentBridge', ...) ]                              |
|  - Statically defined API: ping(), getSystemMetadata(), getHealthStatus()               |
|  - Zero raw ipcRenderer exposed                                                         |
|  - Zero generic send() or invoke() proxying                                             |
+-----------------------------------------------------------------------------------------+
                                           |
                                           | IPC Channel (Allowlist Only)
                                           v
+-----------------------------------------------------------------------------------------+
|                                  MAIN PROCESS (TRUSTED)                                 |
|                                                                                         |
|  [ IpcDispatchGuard ]                                                                   |
|  - Static Channel Allowlist:                                                            |
|      * 'trident:ping'                                                                   |
|      * 'trident:get-system-metadata'                                                    |
|      * 'trident:get-health-status'                                                      |
|  - Trusted boundary payload validation (rejects malformed inputs, extra arguments)       |
|  - Fail-closed dispatch: rejects unapproved channels with security violation error     |
|                                                                                         |
|  [ Navigation & Window Lockdown ]                                                       |
|  - will-navigate listener: default-deny external/remote origins                         |
|  - setWindowOpenHandler: default-deny all popup/new-window requests                     |
|                                                                                         |
|  [ Session Security Headers ]                                                           |
|  - onHeadersReceived: Injects CSP, X-Content-Type-Options, X-Frame-Options               |
|                                                                                         |
|  [ Edge Configuration: edge-config.json ]                                               |
|  - Validated non-sensitive metadata only                                                 |
|  - Recursive scan fails closed on any prohibited secret key                             |
+-----------------------------------------------------------------------------------------+
                                           |
                                           | Decoupled Task Queue (ADR-003 Sec. 8)
                                           v
+-----------------------------------------------------------------------------------------+
|                              BACKGROUND WORKER SUPERVISOR                               |
|                                                                                         |
|  [ EdgeWorkerSupervisor ]                                                               |
|  - Decoupled process execution scaffold for heavy background tasks                      |
|  - Zero main-thread or UI event loop blocking                                           |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Actual Electron Runtime Test Matrix (WP007-E01..E08)

Command: `npm run test:electron` (executed with real pinned `electron@44.3.0` binary).

| Test ID | Test Name | Verification Method | Result | Notes |
|---|---|---|---|---|
| **WP007-E01** | Production BrowserWindow Effective Preferences | `webContents.getLastWebPreferences()` | **PASS** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. Negative test confirms `assertHardenedWebPreferences` rejects weakened preferences. |
| **WP007-E02** | Real Renderer Node Isolation | `webContents.executeJavaScript()` in live renderer | **PASS** | Confirmed `require`, `process`, `Buffer`, `ipcRenderer`, `child_process`, `fs` are `undefined`. Direct `require('node:fs')` call blocked. |
| **WP007-E03** | Real Preload / contextBridge Surface | Audited `window.tridentBridge` inside real renderer | **PASS** | Strictly exposes `ping`, `getSystemMetadata`, `getHealthStatus`. Confirmed `send`, `invoke`, `on`, and raw `ipcRenderer` are absent. |
| **WP007-E04** | Approved IPC Actual E2E Round Trip | Live call through `window.tridentBridge.ping(...)`, `getSystemMetadata()`, `getHealthStatus()` | **PASS** | Full round trip through contextBridge -> preload -> ipcRenderer -> ipcMain -> IpcDispatchGuard -> handler -> response. Nonce and metadata verified. |
| **WP007-E05** | Arbitrary IPC Escape Hatch Negative Proof | Inspected renderer execution scope | **PASS** | Raw `ipcRenderer` absent, generic send/invoke methods absent, arbitrary channel calls impossible. |
| **WP007-E06** | External Navigation Blocked | Live navigation attempt via `window.location.href = 'https://unauthorized-external-test.tridentpos.invalid/'` | **PASS** | `will-navigate` intercepted and cancelled the event; window remained on authorized local origin. |
| **WP007-E07** | Window Open / Popup Blocked | Live execution of `window.open(...)` from renderer | **PASS** | `setWindowOpenHandler` denied creation; window count remained 1. |
| **WP007-E08** | Effective CSP Enforcement in Real Renderer | DOM inspection and dynamic `eval()` execution attempt in live renderer | **PASS** | Strict CSP meta tag validated (`default-src 'self'`); dynamic `eval()` rejected by browser engine. |

**Runtime Test Summary:** 8 total | 8 passed | 0 failed | 0 skipped.

---

## 5. Pure Unit Test Matrix (WP007-T01..T22)

Command: `npm run test:unit` (`node --test dist/index.test.js`).

| Test ID | Description | Result |
|---|---|---|
| `WP007-T01` | Package metadata and `@trident/core` dependency | **PASS** |
| `WP007-T02` | `HARDENED_WEB_PREFERENCES` invariant defaults | **PASS** |
| `WP007-T03` | [Negative] Fails closed on disabled `contextIsolation` | **PASS** |
| `WP007-T04` | [Negative] Fails closed on enabled `nodeIntegration` | **PASS** |
| `WP007-T05` | [Negative] Fails closed on disabled `sandbox` | **PASS** |
| `WP007-T06` | [Negative] Fails closed on insecure content or worker node integration | **PASS** |
| `WP007-T07` | `auditRendererIsolation` clean scope verification | **PASS** |
| `WP007-T08` | [Negative] `auditRendererIsolation` detects leaked Node primitives | **PASS** |
| `WP007-T09` | Authoritative static channel allowlist | **PASS** |
| `WP007-T10` | Approved typed channel execution through `IpcDispatchGuard` | **PASS** |
| `WP007-T11` | [Negative] Unapproved IPC channel rejected fail-closed | **PASS** |
| `WP007-T12` | [Negative] Malformed payloads rejected at trusted boundary | **PASS** |
| `WP007-T13` | [Negative] External and malicious URLs blocked | **PASS** |
| `WP007-T14` | `handleNavigationAttempt` calls `preventDefault` | **PASS** |
| `WP007-T15` | [Negative] `createWindowOpenHandler` strictly returns `{ action: 'deny' }` | **PASS** |
| `WP007-T16` | [Negative] Simulated injected script cannot reach Node APIs | **PASS** |
| `WP007-T17` | `FROZEN_CSP_DIRECTIVE` adherence to SSOT | **PASS** |
| `WP007-T18` | [Negative] Rejects `'unsafe-inline'`, `'unsafe-eval'`, and wildcards `*` | **PASS** |
| `WP007-T19` | `edge-config.json` loading and schema validation | **PASS** |
| `WP007-T20` | [Negative] Rejects secret-bearing configuration keys | **PASS** |
| `WP007-T21` | [Negative] Fails closed on malformed configuration | **PASS** |
| `WP007-T22` | `EdgeWorkerSupervisor` background task decoupling | **PASS** |

**Unit Test Summary:** 22 total | 22 passed | 0 failed | 0 skipped.

---

## 6. Supply Chain & SAST Scan Results

- **Trivy Vulnerability Scan (SCA):**
  - Targets: `package-lock.json`
  - Findings: **0 HIGH, 0 CRITICAL** (Clean)
- **TruffleHog Secret Scan:**
  - Findings: **0 Verified Secrets, 0 Unverified Secrets** (Clean)
- **Static Security Analysis (ESLint & Strict TypeScript):**
  - `npm run lint`: **0 errors, 0 warnings**
  - `npm run typecheck`: **7/7 packages successful, 0 errors** (`skipLibCheck = false`)
- **CycloneDX SBOM Generation:**
  - Validated JSON structure with `electron@44.3.0`.

---

## 7. Security Debt Governance & Boundaries

Per `ACR-2026-009 Sec. 7` and `IMPLEMENTATION_PLAN.md`:

1. **`SEC-VAL-07` Status:**
   - Implementation controls present and validated by 22 unit tests and 8 actual Electron runtime tests.
   - Status remains: **`IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION`**.
   - Builder MUST NOT mark it CLOSED; awaiting independent security review.
2. **Unrelated Security Debt Items (Strictly Preserved as OPEN):**
   - `SEC-VAL-03` (Station Pairing & Trust Bootstrap): Owned by `WP-009` — **OPEN**
   - `SEC-VAL-02` (Offline IAM Brute Force Resistance): Owned by `WP-010` — **OPEN**
   - `SEC-VAL-08` (Target Hardware Argon2 Benchmark): Owned by `WP-010` / `WP-028` — **OPEN**
   - `SEC-VAL-06` (Edge SQLite & Sync Tamper-Evidence): Owned by `WP-013` / `WP-008` — **OPEN**
   - `DAT-04` / `RSK-08` (SQLite Power-Loss Durability): Owned by `WP-008` — **OPEN**
   - `RSK-11` (Low-Memory Target POS Hardware Certification): Owned by `WP-026` / `WP-028` — **OPEN**
   - `ADR-003 Target Hardware Benchmark`: **OPEN**

---

## 8. Prohibited Scope Verification

The implementation was audited to confirm zero premature feature creep:
- Zero SQLite connections or SQLCipher references
- Zero station enrollment or mTLS pairing code
- Zero offline PIN authentication or Argon2 verification in `@trident/edge`
- Zero local HTTP REST servers or WebSocket sync engine implementations
- Zero ESC/POS printer or cash drawer drivers
- Zero auto-updater or distribution packaging scripts
- Zero resolution of Product Owner decisions (all 9 remain `PENDING PO DECISION`)
