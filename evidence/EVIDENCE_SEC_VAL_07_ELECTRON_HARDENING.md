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
- **Remediation Iteration:** R2 (Remove `--no-sandbox` False Green & Enforce Active Chromium Sandbox)
- **Builder Verdict:** `READY FOR ROLE-SEPARATED REVIEW`
- **SEC-VAL-07 Control Status:** `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION`

---

## 2. Integrity Blockers & Remediation History

### 2.1 Remediation R1 Summary
Resolved initial blocker where tests relied purely on Node.js unit/simulation checks. Added actual Electron runtime integration suite (`WP007-E01`..`WP007-E08`) executing the real pinned `electron@44.3.0` binary without mocks.

### 2.2 Remediation R2: `--no-sandbox` False Green Removal
- **Previous R2 Blocker:** External verification found that the test harness (`packages/edge/scripts/run-electron-tests.mjs`) included an insecure fallback that injected `--no-sandbox` into Electron CLI args when the Linux SUID sandbox check failed, invalidating the runtime sandbox proof.
- **Remediation Executed:**
  1. **Removed `--no-sandbox` Fallback Entirely:** Completely deleted the `--no-sandbox` fallback switch from the test runner.
  2. **Fail-Closed Linux Sandbox Enforcement:** If `chrome-sandbox` is missing, not owned by root (UID != 0), or lacks SUID (mode 4755), the harness immediately aborts with exit code 1.
  3. **Deterministic CI Configuration:** Updated `.github/workflows/ci.yml` `unit-tests` to ensure Electron binary extraction, apply `sudo chown root:root` and `sudo chmod 4755` to `chrome-sandbox`, and perform deterministic `stat` verification failing the workflow if root SUID is missing.
  4. **Added WP007-E09 Validation:** Added runtime audit ensuring zero `--no-sandbox` or `--disable-setuid-sandbox` CLI flags, confirming `sandbox: true` on the production BrowserWindow, and proving active Chromium sandbox in the live renderer.
- **Final Runtime State:** Electron executes with the full Chromium OS sandbox active. Zero sandbox-disabling flags are permitted.

---

## 3. Trust Boundary & Security Architecture Controls Implemented

```
+-----------------------------------------------------------------------------------------+
|                                    RENDERER CONTEXT                                     |
|                                                                                         |
|  [ Production HTML / Scripts ]                                                          |
|  - contextIsolation: true                                                               |
|  - nodeIntegration: false                                                               |
|  - sandbox: true (Chromium Sandbox ACTIVE — zero --no-sandbox)                          |
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

## 4. Actual Electron Runtime Test Matrix (WP007-E01..E09)

Command: `npm run test:electron` (executed with real pinned `electron@44.3.0` binary, Chromium sandbox active).

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
| **WP007-E09** | Runtime Sandbox Switches Audit | Inspected `process.argv` and `app.commandLine` for sandbox switches | **PASS** | Proved absence of `--no-sandbox`, `--disable-setuid-sandbox`, `--no-zygote`, and verified active Chromium sandbox. |

**Runtime Test Summary:** 9 total | 9 passed | 0 failed | 0 skipped.

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

- **Trivy Vulnerability Scan (SCA):** 0 HIGH, 0 CRITICAL (Clean).
- **TruffleHog Secret Scan:** 0 Verified Secrets, 0 Unverified Secrets (Clean).
- **Static Security Analysis (ESLint & Strict TypeScript):** 0 errors, 0 warnings across all monorepo packages (`skipLibCheck = false`).
- **CycloneDX SBOM Generation:** Validated with pinned `electron@44.3.0`.

---

## 7. Security Debt Governance & Boundaries

Per `ACR-2026-009 Sec. 7` and `IMPLEMENTATION_PLAN.md`:

1. **`SEC-VAL-07` Status:**
   - Implementation controls present and validated by 22 unit tests and 9 actual Electron runtime tests under active Chromium sandbox.
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
