# WP-007 BUILDER EVIDENCE REPORT: EDGE HOST RUNTIME SCAFFOLDING & ELECTRON SECURITY HARDENING

## 1. Executive Metadata

- **Work Package:** `WP-007` — Edge Host Runtime Scaffolding & Electron Security Hardening
- **Builder Agent:** `16_Native_Edge_Developer`
- **Operating Mode:** `SOLO_MAINTAINER`
- **Implementation Base SHA:** `0ab4cf993970795844fcd7b746d31d3c3c252485`
- **Governing Architecture Change Request:** `ACR-2026-009` (Edge Runtime SSOT Reference & Execution Boundary Correction)
- **Canonical Errata Reference:** `GOVERNANCE_ERRATA_WP007_ACR_ID.md`
- **Feature Branch:** `feature/wp-007-edge-runtime-electron-hardening`
- **PR:** `#24`
- **Governed Toolchain & Pinned Versions:**
  - Host Node.js LTS Toolchain: `24.20.0`
  - Host npm: `11.19.0`
  - Host TypeScript: `~5.4.5` (`skipLibCheck = false`)
  - Pinned Runtime Dependency: `electron@44.3.0` (exact pin in `packages/edge/package.json`)
  - Embedded Chromium Engine: `152.0.7977.78`
  - Embedded Node.js Runtime in Electron: `24.20.0`
  - Embedded V8 Engine: `15.2.124.19`
- **Date:** 2026-09-10
- **Remediation Iteration:** R1 (Actual Electron Runtime Security Validation)
- **Builder Verdict:** `READY FOR ROLE-SEPARATED REVIEW`
- **SEC-VAL-07 Status:** `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION`

---

## 2. Prior Integrity Blocker & Remediation Overview

### 2.1 Prior Blocker Description
External Quick Integrity Check of subject `S1` (`04bf722a20c2cf6afcdb57e78caaf60ac5494c94`) identified that `SEC-VAL-07` relied primarily on Node.js unit/simulation tests (`node --test dist/index.test.js`) using plain JavaScript objects, simulated renderer scopes, static BrowserWindow preference objects, and isolated dispatch guards. While valid as unit-level defenses, they did not objectively exercise the hardened boundary inside an actual Electron runtime.

### 2.2 Remediation Strategy (R1)
1. **Preserved Existing Unit Tests:** Retained all 22 unit tests (`WP007-T01`..`WP007-T22`) as the unit-level defense layer.
2. **Added Actual Electron Runtime Integration Test Layer:**
   - Implemented `packages/edge/src/electron.test.ts` executing inside the actual pinned `electron@44.3.0` binary without mocks.
   - Built harness using the production `EdgeApplicationHost` and `createMainWindow()` path.
   - Designed 8 runtime security test cases (`WP007-E01`..`WP007-E08`).
3. **CommonJS Sandbox Preload Compatibility:** Added `packages/edge/src/preload.cjs` so that the sandboxed Electron preload executes cleanly without ESM module syntax collisions while strictly exposing `window.tridentBridge`.
4. **Headless Linux / Xvfb CI Strategy:**
   - Added `packages/edge/scripts/run-electron-tests.mjs` with automatic headless Linux detection wrapping execution in `xvfb-run` when `DISPLAY` is absent.
   - Updated `.github/workflows/ci.yml` `unit-tests` job to run under `xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" npm run test`.
5. **Transitive Execution:** Updated `packages/edge/package.json` with scripts `test:unit`, `test:electron`, and composite `test: npm run test:unit && npm run test:electron`. Monorepo `npm run test` transitively runs both unit and Electron integration suites.

---

## 3. Test Architecture: Unit vs. Actual Electron Runtime

The test suite is strictly partitioned into two complementary verification layers:

```
+-----------------------------------------------------------------------------------------+
|                                    TEST ARCHITECTURE                                    |
+-----------------------------------------------------------------------------------------+
| [ LAYER 1: UNIT VALIDATION ]                                                            |
| Command: npm run test:unit (node --test dist/index.test.js)                             |
| Scope: Pure Node.js unit testing of exported APIs, config schemas, guards, and policies |
| Tests: WP007-T01 through WP007-T22 (22 tests)                                           |
| Status: PASS (0 failed, 0 skipped)                                                      |
+-----------------------------------------------------------------------------------------+
| [ LAYER 2: ACTUAL ELECTRON RUNTIME VALIDATION ]                                         |
| Command: npm run test:electron (node scripts/run-electron-tests.mjs)                     |
| Binary: Real electron@44.3.0 binary (Embedded Node 24.20.0, Chromium 152.0.7977.78)     |
| Scope: Live BrowserWindow, real renderer execution, real preload contextBridge,         |
|        actual IPC round trip, will-navigate cancellation, setWindowOpenHandler deny,    |
|        and dynamic CSP evaluation blocking                                              |
| Tests: WP007-E01 through WP007-E08 (8 tests)                                            |
| Status: PASS (0 failed, 0 skipped)                                                      |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Actual Electron Runtime Test Execution Results (WP007-E01..E08)

Command executed:
```bash
npm run test:electron
# Executes: node scripts/run-electron-tests.mjs
# Binary: electron@44.3.0
```

Execution Output:
```text
[EXECUTING ACTUAL ELECTRON BINARY]: .../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .../packages/edge/dist/electron.test.js

============================================================
TRIDENTPOS WP-007: ACTUAL ELECTRON RUNTIME VALIDATION SUITE
Electron Binary: 44.3.0
Embedded Node: 24.20.0
Embedded Chromium: 152.0.7977.78
============================================================

✔ WP007-E01: production BrowserWindow effective preferences (contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true)
✔ WP007-E02: real renderer Node isolation (zero access to require, process, Buffer, fs, child_process, ipcRenderer)
✔ WP007-E03: real preload/contextBridge surface (window.tridentBridge present with exact allowed methods, zero generic send/invoke)
✔ WP007-E04: approved IPC actual end-to-end round trip (renderer -> contextBridge -> preload -> ipcRenderer -> ipcMain -> response)
✔ WP007-E05: arbitrary IPC escape hatch unavailable (raw ipcRenderer absent, generic invoke/send absent)
[SECURITY VIOLATION] Denied navigation to 'https://unauthorized-external-test.tridentpos.invalid/': Destination URL outside authorized local origin list
✔ WP007-E06: external navigation blocked (will-navigate intercepts unauthorized destination, remains on local origin)
[SECURITY VIOLATION] Denied window.open to 'https://unauthorized-popup-test.tridentpos.invalid/'
✔ WP007-E07: window.open/new window blocked (setWindowOpenHandler denies popup creation)
✔ WP007-E08: effective CSP verified in real renderer (eval blocked by Content Security Policy, strict self-only policy active)

------------------------------------------------------------
Actual Electron Runtime Tests: 8 total | 8 passed | 0 failed | 0 skipped
------------------------------------------------------------
```

### Detailed Validation Findings:
- **WP007-E01 (Effective WebPreferences):** Verified directly against `webContents.getLastWebPreferences()`. Confirmed `contextIsolation === true`, `nodeIntegration === false`, `sandbox === true`, `webSecurity === true`.
- **WP007-E02 (Real Renderer Node Isolation):** Executed in live Chromium renderer via `webContents.executeJavaScript()`. Confirmed `typeof require === 'undefined'`, `typeof process === 'undefined'`, `typeof Buffer === 'undefined'`, `typeof ipcRenderer === 'undefined'`, and direct `require('node:fs')` throws reference error.
- **WP007-E03 (Real Preload / contextBridge Surface):** Loaded real preload inside production BrowserWindow. Confirmed `window.tridentBridge` exists with exactly allowed methods (`ping`, `getSystemMetadata`, `getHealthStatus`). Proved `send`, `invoke`, `on`, and raw IPC objects are undefined.
- **WP007-E04 (Approved IPC End-to-End Round Trip):** Executed actual IPC calls from the live renderer through `window.tridentBridge.ping(...)`, `getSystemMetadata()`, and `getHealthStatus()`. Flowed renderer -> contextBridge -> preload -> ipcRenderer -> ipcMain -> IpcDispatchGuard -> handler -> response.
- **WP007-E05 (Arbitrary IPC Escape Hatch Negative Proof):** Verified renderer cannot invoke arbitrary channels because raw `ipcRenderer` is absent and no generic `send`/`invoke` methods exist on `window.tridentBridge`.
- **WP007-E06 (Actual Navigation Blocking):** Triggered unauthorized navigation from renderer (`window.location.href = 'https://unauthorized-external-test.tridentpos.invalid/'`). Verified `will-navigate` intercepted and cancelled the navigation, leaving the window on the authorized `file:` origin.
- **WP007-E07 (Actual window.open Blocking):** Executed `window.open(...)` from renderer. Verified `setWindowOpenHandler` denied creation and window count remained exactly 1.
- **WP007-E08 (Effective CSP Enforcement):** Verified renderer document contains strict CSP (`default-src 'self'; script-src 'self'`). Proved dynamic `eval()` execution is blocked by the browser engine.

---

## 5. Unit Test Execution Results (WP007-T01..T22)

Command executed:
```bash
npm run test:unit
```

Execution Output:
```text
✔ WP007-T01: @trident/edge returns expected package metadata and core dependency (0.75ms)
✔ WP007-T02: HARDENED_WEB_PREFERENCES strictly enforces required isolation properties (0.12ms)
✔ WP007-T03: [Negative] assertHardenedWebPreferences fails closed on disabled contextIsolation (0.25ms)
✔ WP007-T04: [Negative] assertHardenedWebPreferences fails closed on enabled nodeIntegration (0.17ms)
✔ WP007-T05: [Negative] assertHardenedWebPreferences fails closed on disabled sandbox (0.15ms)
✔ WP007-T06: [Negative] assertHardenedWebPreferences fails closed on insecure content or worker node integration (0.16ms)
✔ WP007-T07: auditRendererIsolation confirms zero leaked primitives in clean scope (0.58ms)
✔ WP007-T08: [Negative] auditRendererIsolation detects leaked Node primitives (0.16ms)
✔ WP007-T09: Allowed channels match authoritative frozen set (0.11ms)
✔ WP007-T10: Approved typed channel executes successfully through IpcDispatchGuard (0.31ms)
✔ WP007-T11: [Negative] Arbitrary or unapproved IPC channel is rejected fail-closed (0.30ms)
✔ WP007-T12: [Negative] Malformed payloads are rejected at the trusted boundary (0.48ms)
✔ WP007-T13: [Negative] External and malicious URLs are blocked from navigation (0.19ms)
✔ WP007-T14: handleNavigationAttempt calls preventDefault on unauthorized navigation (0.19ms)
✔ WP007-T15: [Negative] createWindowOpenHandler strictly returns action: deny across all URLs (0.37ms)
✔ WP007-T16: [Negative] Simulated injected script in renderer cannot reach privileged Node APIs (0.11ms)
✔ WP007-T17: FROZEN_CSP_DIRECTIVE strictly adheres to SECURITY_ARCHITECTURE.md Sec. 9 (0.33ms)
✔ WP007-T18: [Negative] assertHardenedCSP rejects unsafe-inline, unsafe-eval, and wildcards (0.26ms)
✔ WP007-T19: edge-config.json loads and validates successfully with valid metadata (0.70ms)
✔ WP007-T20: [Negative] assertNoProhibitedSecrets rejects secret-bearing keys (0.42ms)
✔ WP007-T21: [Negative] validateEdgeConfig fails closed on malformed configurations (0.42ms)
✔ WP007-T22: EdgeWorkerSupervisor manages process decoupling without blocking main thread (0.23ms)

tests 22 | pass 22 | fail 0 | cancelled 0 | skipped 0 | todo 0
```

---

## 6. Supply Chain & Quality Verifications

- **Trivy Vulnerability Scanner (SCA):** 0 HIGH, 0 CRITICAL vulnerabilities detected.
- **TruffleHog Secret Scan:** 0 verified secrets, 0 unverified secrets across changes.
- **Static Analysis (ESLint):** 0 errors, 0 warnings across all monorepo packages.
- **Type Checking (`tsc --noEmit`):** Clean across all 7 packages (`skipLibCheck = false`).
- **Graph Constraint Check:** Clean (`@trident/edge -> @trident/core`).
- **CycloneDX SBOM Generation:** Validated with pinned `electron@44.3.0`.

---

## 7. Security Debt Governance & Boundaries

- **`SEC-VAL-07` Status:** `IMPLEMENTATION CONTROLS PRESENT — PENDING ROLE-SEPARATED SECURITY VALIDATION` (Builder MUST NOT mark it CLOSED; awaiting independent security review).
- **Unrelated Security Debt Items (Strictly Preserved as OPEN):**
  - `SEC-VAL-03` (Station Pairing & Trust Bootstrap): Owned by `WP-009` — **OPEN**
  - `SEC-VAL-02` (Offline IAM Brute Force Resistance): Owned by `WP-010` — **OPEN**
  - `SEC-VAL-08` (Target Hardware Argon2 Benchmark): Owned by `WP-010` / `WP-028` — **OPEN**
  - `SEC-VAL-06` (Edge SQLite & Sync Tamper-Evidence): Owned by `WP-013` / `WP-008` — **OPEN**
  - `DAT-04` / `RSK-08` (SQLite Power-Loss Durability): Owned by `WP-008` — **OPEN**
  - `RSK-11` (Low-Memory Target POS Hardware Certification): Owned by `WP-026` / `WP-028` — **OPEN**
  - `ADR-003 Target Hardware Benchmark`: **OPEN**
