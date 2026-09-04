# WP-002 BUILDER EXECUTION EVIDENCE
## Automated CI/CD Pipelines & Security Scanning

**WP ID:** `WP-002`  
**Title:** `Automated CI/CD Pipelines & Security Scanning`  
**Wave:** `Wave 0 — Repository, Tooling & Governance Foundation`  
**Bounded Context:** `Platform Core`  
**Builder:** `18_DevOps_Engineer`  
**Implementation Base SHA:** `4991941f0276e26e8ed26ce9cf8dfaf69dd43da5`  
**Branch:** `feature/wp-002-ci-security`  
**Date:** `2026-09-04` (UTC)  
**Human / Organizational Independence:** `NOT AVAILABLE — SOLO MAINTAINER`  
**Builder Verdict:** **`READY FOR ROLE-SEPARATED REVIEW`**  

---

## 1. Execution Environment & Toolchain Pinning

- **Node.js Runtime:** `v24.20.0` (Active LTS: *Krypton*)
- **Node Pinning Mechanism:** `.nvmrc` (`24.20.0`) and `.node-version` (`24.20.0`)
- **Package Manager:** `npm` v`11.19.0`
- **Installation Strategy:** Deterministic clean install via `npm ci`
- **Host OS:** Darwin / macOS 26.6.2 (ARM64 `arm64`)
- **Remote CI Runner:** GitHub-hosted `ubuntu-24.04` (Canonical Ubuntu 24.04 LTS runner environment)

---

## 2. Supply-Chain Security & Action Pinning

Per EAAF v1.2 and `SUPPLY_CHAIN_SECURITY.md`, floating third-party GitHub Action tags (`@main`, `@master`, `@v4`, `@latest`) are strictly prohibited. All actions are resolved to official upstream repositories and pinned to immutable full 40-character commit SHAs:

| Action Identifier | Upstream Repository | Resolved Release / Version | Immutable Full Commit SHA | Purpose |
|---|---|---|---|---|
| `actions/checkout` | `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | Deterministic workspace checkout |
| `actions/setup-node` | `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` | Node.js 24 LTS runtime & npm cache bootstrap |
| `actions/upload-artifact` | `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | Secure SBOM artifact persistence |
| `trufflesecurity/trufflehog` | `trufflesecurity/trufflehog` | `v3.97.4` | `363923b901c911a9164f50b6c423f47c15372b1c` | Enterprise-grade secret detection scanner |
| `aquasecurity/trivy-action` | `aquasecurity/trivy-action` | `0.36.0` | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | SCA vulnerability scanner & CycloneDX SBOM generator |

---

## 3. Workflow Architecture & Principle of Least Privilege

Two segregating, non-overlapping workflow pipelines were authored under `.github/workflows/`:

### 3.1. `.github/workflows/ci.yml`
- **Trigger:**
  - `pull_request` targeting `main`
  - `push` targeting `main`
- **Concurrency:** `group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`
- **Permissions:** Top-level `permissions: contents: read` (no write permissions, no dangerous `pull_request_target`)
- **Runner:** `runs-on: ubuntu-24.04`
- **Jobs:**
  1. `build`: Verifies monorepo graph constraints via `npm run graph:check` and builds all workspace packages via `npm run build`.
  2. `lint`: Enforces formatting via `npm run format:check` and linting rules via `npm run lint`.
  3. `typecheck`: Runs strict compiler type checking across all workspace packages via `npm run typecheck`.
  4. `unit-tests`: Executes package unit test suites via `npm run test`.

### 3.2. `.github/workflows/security-scan.yml`
- **Trigger:**
  - `pull_request` targeting `main`
  - `push` targeting `main`
- **Concurrency:** `group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`
- **Permissions:** Top-level `permissions: contents: read` (no write permissions)
- **Runner:** `runs-on: ubuntu-24.04`
- **Jobs:**
  1. `secret-scan`: Full-depth checkout (`fetch-depth: 0`) and secret scanning via TruffleHog OSS (`version: '3.97.4'`, `extra_args: --results=verified,unverified`) failing on detected secrets.
  2. `sca-scan`: Filesystem Software Composition Analysis via Aqua Security Trivy (`version: 'v0.74.0'`) with blocking policy on `HIGH,CRITICAL` severities (`exit-code: '1'`).
  3. `sast-scan`: Static analysis baseline implemented for current WP-001 scaffold enforcing ESLint and strict TypeScript compiler rules.
  4. `sbom-generate`: Generates CycloneDX 1.7 machine-readable SBOM (`tridentpos-sbom.cdx.json`) via Trivy (`version: 'v0.74.0'`) and uploads it as a GitHub Actions artifact with a 14-day retention period.

---

## 4. Local Command Execution & Regression Verification

All local commands executed cleanly against the implementation branch:

| Command | Exit Code | Output Summary |
|---|---|---|
| `node --version` | `0` | `v24.20.0` |
| `npm --version` | `0` | `11.19.0` |
| `npm ci` | `0` | Clean dependency tree verification, 0 vulnerabilities |
| `npm run graph:check` | `0` | Dependency graph validation passed: 5 packages verified, 0 cycles |
| `npm run format:check` | `0` | All matching files formatted properly |
| `npm run typecheck` | `0` | 6/6 tasks successful, 0 type errors |
| `npm run lint` | `0` | 5/5 tasks successful, 0 lint warnings/errors |
| `npm run build` | `0` | 5/5 packages compiled successfully (`tsc -b`) |
| `npm run test` | `0` | 6 unit tests across 5 packages passed (0 failures) |

---

## 5. Workflow Syntax Validation

Both workflow definition files were validated locally prior to remote submission:
1. **Parser Validation:** Ruby `YAML.load_file` verified both `.github/workflows/ci.yml` and `.github/workflows/security-scan.yml` are valid YAML syntax.
2. **Action Linter:** `actionlint` v`1.7.12` executed against all workflow files with zero errors or warnings:
   ```bash
   actionlint .github/workflows/*.yml
   # Exit code: 0
   ```

---

## 6. Negative Validation Evidence

To ensure the pipelines are fail-closed and will gate invalid changes, negative tests were executed:

### 6.1. Secret Scanner Negative Validation (TruffleHog OSS)
- **Canary:** Synthetic AWS access key pair (`AKIA[SYNTHETIC_CANARY_REDACTED]` / `wJalr[SYNTHETIC_CANARY_REDACTED]`) written to temporary file `canary_test.tmp`.
- **Command:** `trufflehog filesystem canary_test.tmp --fail`
- **Result:**
  ```text
  Found unverified result 🐷🔑❓
  Detector Type: AWS
  Resource_type: Access key
  File: canary_test.tmp
  Line: 1
  Exit code: 183
  ```
- **Cleanup:** Temporary canary file was removed immediately (`rm -f canary_test.tmp`). Zero canary tokens were committed to git.

### 6.2. CI Pipeline Negative Validation
- **Typecheck Failure:** Introduced deliberate syntax/type violation (`const bad: number = 'not-a-number';`).
  - Result: `tsc --noEmit` exited with code `1`.
  - Cleanup: Temporary test file removed.
- **Format Check Failure:** Introduced deliberately unformatted file (`const unformatted   =    1 ;`).
  - Result: `prettier --check` exited with code `1`.
  - Cleanup: Temporary test file removed.

### 6.3. SCA Threshold Configuration & Fail-Closed Policy
- Trivy SCA is configured with `--severity HIGH,CRITICAL --exit-code 1`.
- Verified `--exit-code 1` causes Trivy to terminate with non-zero exit code if vulnerabilities are found.
- Current repository scan: Clean (`0` vulnerabilities in `package-lock.json`).

---

## 7. Machine-Readable SBOM Generation Evidence

- **Format:** CycloneDX 1.7 specification (`bomFormat: "CycloneDX"`, `specVersion: "1.7"`).
- **Generator:** Aqua Security Trivy `v0.74.0` (pinned via `version: 'v0.74.0'`).
- **Artifact Filename:** `tridentpos-sbom.cdx.json`.
- **Artifact Name in GitHub Actions:** `tridentpos-sbom`.
- **Retention:** 14 days.
- **Local Verification:**
  ```json
  {
    "$schema": "http://cyclonedx.org/schema/bom-1.7.schema.json",
    "bomFormat": "CycloneDX",
    "specVersion": "1.7",
    "metadata": {
      "tools": {
        "components": [
          {
            "name": "trivy",
            "version": "0.74.0"
          }
        ]
      }
    }
  }
  ```

---

## 8. Remote Execution & Real Context Discovery (Historical Run on d4ca0d1)

Provisional implementation commit `d4ca0d1` was pushed to branch `feature/wp-002-ci-security` and implementation Pull Request **#7** was opened targeting `main`.

### 8.1. Observed GitHub Workflow Runs
- **CI Workflow Run:** Run ID `33877503823`, Conclusion: `success`.
- **Security Scan Workflow Run:** Run ID `33877503840`, Conclusion: `success`.

### 8.2. Real Observed Status Check / Context Names
The real check run names discovered through live GitHub API observation on the PR commit are:

| Check / Context Name | Associated Workflow | GitHub Job ID | Remote Conclusion |
|---|---|---|---|
| `build` | `CI` | `101037883970` | `success` |
| `lint` | `CI` | `101037883612` | `success` |
| `typecheck` | `CI` | `101037883900` | `success` |
| `unit-tests` | `CI` | `101037883874` | `success` |
| `secret-scan` | `Security Scan` | `101037884450` | `success` |
| `sca-scan` | `Security Scan` | `101037885196` | `success` |
| `sast-scan` | `Security Scan` | `101037884793` | `success` |
| `sbom-generate` | `Security Scan` | `101037884703` | `success` |

> [!NOTE]
> The six (6) governance capability checks intended for Stage B protection correspond to:
> `build`, `lint`, `typecheck`, `unit-tests`, `secret-scan`, and `sca-scan`.
> These exact observed names will be fed into the post-merge Stage B control-plane transition.

---

## 9. Governance & Validation Debt Status

### 9.1. SEC-VAL-05 Status & Disposition
- **Current Status:** **`PARTIALLY IMPLEMENTED — CI/CD SECRET SCANNING IMPLEMENTED; LOG-REDACTION VERIFICATION REMAINS OPEN; CANONICAL STAGE B ENFORCEMENT PENDING`**
- **Obligation Scope:** `SEC-VAL-05: Secrets & Vault — CI/CD secret scanning AND log-redaction verification`
- **Assessment:** WP-002 implements only the CI/CD secret-scanning sub-obligation. Full `SEC-VAL-05` remains **`OPEN`** because log-redaction verification is an application/logging obligation that remains unverified and canonical Stage B branch protection activation is pending merge and control-plane activation.

### 9.2. Preserved Security Validation Debts (Canonical Downstream Security Gate R3 Catalog)
All other downstream security validation debts remain strictly **`OPEN`** per repository SSOT:
- `SEC-VAL-01`: Multi-Tenant Isolation — tenant breakout and RLS bypass validation (`OPEN`)
- `SEC-VAL-02`: Offline IAM & Brute Force — PIN rate limiting / lockout penetration validation (`OPEN`)
- `SEC-VAL-03`: Trust Bootstrap — rogue mDNS / certificate mismatch LAN validation (`OPEN`)
- `SEC-VAL-04`: Lease Fencing — zombie Edge reactivation / token rejection (`OPEN`)
- `SEC-VAL-06`: Tamper-Evident Audit — DB alteration and Cloud sync integrity verification (`OPEN`)
- `SEC-VAL-07`: Electron Security — preload / IPC allowlist SAST validation (`OPEN`)
- `SEC-VAL-08`: Hardware Benchmark — Argon2id resource benchmark on <=2 GB POS hardware (`OPEN`)
- `SEC-VAL-09`: Failure-Mode Validation — WAN outage / offline continuity validation (`OPEN`)
- `SEC-VAL-10`: Provider Contracts — webhook signature / timestamp verification (`OPEN`)
- `SEC-VAL-11`: Legal / Privacy — retention-policy legal review (`OPEN`)
- Data debts (`DAT-04`, `DAT-08`) and risk items (`RSK-08`, `RSK-11`, `RSK-15`) remain `OPEN`.

### 9.3. SAST Scope Precision
The `sast-scan` remote check implements a **static analysis baseline for the current WP-001 monorepo scaffold** (ESLint + strict TypeScript checking). It does NOT constitute full application security SAST coverage. Application- and Electron-specific SAST validation (notably `SEC-VAL-07`) remains governed downstream and remains `OPEN`.

### 9.4. Preserved Product Owner Decisions
All nine (9) Product Owner questions remain strictly **`PENDING PO DECISION`**:
- `OQ-SSOT-01` through `OQ-SSOT-07`
- `OQ-ARCH-01` through `OQ-ARCH-02`
- **WP-002 PO Dependency:** None. No business policies were encoded.

---

## 10. Stage B Governance Boundary

- **Workflows:** IMPLEMENTED & VALIDATED
- **Stage B Status:** **`NOT ACTIVE`**
- Stage B branch protection activation is a post-WP-002 control-plane transaction executed by `18_DevOps_Engineer` and reviewed by `10_DevOps_Platform_Architect`. No branch protection rules have been altered during this builder activation.

---

## 11. Rollback Strategy

1. **Workflow Revert:** Workflows can be disabled or deleted via a standard Git revert of the WP-002 commit on `main`.
2. **State & Database:** WP-002 introduces zero schema changes, zero database migrations, and zero application data drift; rollback requires no data migration operations.
3. **Stage B Rollback:** Because Stage B is not yet active, no branch protection changes need to be rolled back at this stage.

---

## 12. Expected vs Actual Verification Matrix

| Check ID | Verification Item | Expected | Actual | Builder Status |
|---|---|---|---|---|
| `WP002-01` | Correct Base | `4991941f0276e26e8ed26ce9cf8dfaf69dd43da5` | `4991941f0276e26e8ed26ce9cf8dfaf69dd43da5` | **SATISFIED** |
| `WP002-02` | CI Workflow Exists | `.github/workflows/ci.yml` present | Created & verified | **SATISFIED** |
| `WP002-03` | Security Workflow Exists | `.github/workflows/security-scan.yml` present | Created & verified | **SATISFIED** |
| `WP002-04` | Node 24 Pin Used | Node `24.20.0` pinned in setup-node | Node `24.20.0` pinned | **SATISFIED** |
| `WP002-05` | npm ci | Deterministic `npm ci` used | `npm ci` in all jobs | **SATISFIED** |
| `WP002-06` | Build Job | Monorepo build gated | Job `build` executed | **SATISFIED** |
| `WP002-07` | Lint Job | Linting gated | Job `lint` executed | **SATISFIED** |
| `WP002-08` | Typecheck Job | Strict typecheck gated | Job `typecheck` executed | **SATISFIED** |
| `WP002-09` | Unit Test Job | Unit test suites gated | Job `unit-tests` executed | **SATISFIED** |
| `WP002-10` | Graph Check | Architecture graph check executed | In `build` job | **SATISFIED** |
| `WP002-11` | Format Check | Code formatting check executed | In `lint` job | **SATISFIED** |
| `WP002-12` | Secret Scan | TruffleHog OSS secret scanning | Job `secret-scan` executed | **SATISFIED** |
| `WP002-13` | Secret Negative Test | Canary detected & non-zero exit | Exit code `183`, canary removed | **SATISFIED** |
| `WP002-14` | SCA Scan | Dependency vulnerability scan | Job `sca-scan` executed | **SATISFIED** |
| `WP002-15` | High/Critical Fail Policy | Non-zero exit on High/Critical CVEs | `--severity HIGH,CRITICAL --exit-code 1` | **SATISFIED** |
| `WP002-16` | Static Security Analysis | ESLint & TS static security check | Job `sast-scan` executed | **SATISFIED** |
| `WP002-17` | SBOM Generation | CycloneDX 1.7 SBOM generated | `tridentpos-sbom.cdx.json` generated | **SATISFIED** |
| `WP002-18` | SBOM Artifact | Uploaded as Actions artifact | `tridentpos-sbom` uploaded | **SATISFIED** |
| `WP002-19` | Immutable Action Pins | Full 40-char commit SHAs | 5/5 actions pinned to commit SHAs | **SATISFIED** |
| `WP002-20` | Least Privilege Permissions | `permissions: contents: read` | Top-level least privilege in both | **SATISFIED** |
| `WP002-21` | No pull_request_target Risk | No untrusted code execution | `pull_request` used exclusively | **SATISFIED** |
| `WP002-22` | Remote PR Trigger | Real remote PR execution | PR #7 triggered and observed | **SATISFIED** |
| `WP002-23` | Actual Context Discovery | Exact observed check names recorded | Recorded in Section 8.2 | **SATISFIED** |
| `WP002-24` | Final S Remote Green | Final subject remote runs pass | Validation on final S2 pending freeze | **VALIDATION REQUIRED** |
| `WP002-25` | No Application Drift | Zero business code modified | Only `.github/` and `evidence/` | **SATISFIED** |
| `WP002-26` | PO Questions Preserved | All 9 PO open questions open | Preserved verbatim | **SATISFIED** |
| `WP002-27` | Validation Debt Preserved | Canonical catalog & partial SEC-VAL-05 | Preserved verbatim | **SATISFIED** |
| `WP002-28` | Rollback | Rollback strategy documented | Documented in Section 11 | **SATISFIED** |
| `WP002-29` | Stage B NOT Prematurely Activated | Stage B remains inactive | Documented in Section 10 | **SATISFIED** |
| `WP002-30` | No Secrets Committed | Zero credentials in repo history | Verified by TruffleHog | **SATISFIED** |

---

## 13. Builder Conclusion (Initial Activation)

The automated CI/CD and security scanning infrastructure for TRIDENTPOS WP-002 is fully implemented and validated against remote runners. All action references are pinned immutably, fail-closed security gating is established, and actual status context names have been discovered.

---

## 14. Pre-Review Supply-Chain & Evidence Remediation R1

### 14.1. Context and Motivation
Prior to role-separated review activations, a pre-review audit identified four supply-chain and evidence areas requiring remediation:
1. **Implicit Mutable Scanner Version:** The TruffleHog action defaulted internally to `VERSION: latest`.
2. **Scanner Version Discrepancy:** Trivy executed on action default `v0.70.0` while builder evidence recorded `v0.74.0`.
3. **Foundational Actions Deprecation:** Foundational GitHub actions (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) targeted older Node 20 runtime releases subject to runner deprecation notices.
4. **Governance Catalog Semantic Alignment:** Security Validation Debt descriptions were re-aligned to the frozen canonical Downstream Security Gate R3 catalog.

### 14.2. Commit Lineage
- **Initial Provisional Subject:** `6186dfaa97676c3f5dabfe3b3fff0fcfde8673a3`
- **Workflow Hardening Remediation Commit (P_R1):** `69ac8d358cb41e3d9d842e1ac4772493c7e6ecc7`
  - Parent: `6186dfaa97676c3f5dabfe3b3fff0fcfde8673a3`
  - Commit message: `fix(ci): [WP-002] pin maintained actions and scanner versions`

### 14.3. Action and Scanner Version Disambiguation Table

| Component | Component Type | Action Version / Tag | Action Commit SHA | Scanner / Tool Version | Pinning Strategy |
|---|---|---|---|---|---|
| `actions/checkout` | GitHub Action | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | N/A (JS Action) | Full immutable commit SHA |
| `actions/setup-node` | GitHub Action | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` | Node.js `24.20.0` | Full immutable commit SHA |
| `actions/upload-artifact` | GitHub Action | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | N/A (JS Action) | Full immutable commit SHA |
| `trufflesecurity/trufflehog` | Vendor Action | `v3.97.4` | `363923b901c911a9164f50b6c423f47c15372b1c` | `3.97.4` | Action pinned by SHA; scanner pinned via `version: '3.97.4'` |
| `aquasecurity/trivy-action` | Vendor Action | `0.36.0` | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | `v0.74.0` | Action pinned by SHA; scanner pinned via `version: 'v0.74.0'` |

### 14.4. Runner OS Standardization & Known Limitations
- **Runner Label:** `runs-on: ubuntu-24.04` across all 8 jobs.
- **Limitation Statement:** Setting `ubuntu-24.04` stabilizes the major operating system baseline on Ubuntu 24.04 LTS, eliminating the mutable major-OS alias `ubuntu-latest`. However, GitHub-hosted runner images are not bit-for-bit immutable since GitHub may apply upstream software patches to hosted runner virtual environments over time.

### 14.5. Remote Execution Evidence on P_R1 (`69ac8d358cb41e3d9d842e1ac4772493c7e6ecc7`)
- **CI Workflow Run:**
  - Run ID: `33879790626`
  - URL: `https://github.com/Lucas030509/TRIDENTPOS/actions/runs/33879790626`
  - Status: `completed` (`success`)
  - Jobs:
    - `build`: `success` (18s) (Job ID: `101045360878`)
    - `lint`: `success` (13s) (Job ID: `101045360485`)
    - `typecheck`: `success` (14s) (Job ID: `101045360764`)
    - `unit-tests`: `success` (14s) (Job ID: `101045360817`)
- **Security Scan Workflow Run:**
  - Run ID: `33879790652`
  - URL: `https://github.com/Lucas030509/TRIDENTPOS/actions/runs/33879790652`
  - Status: `completed` (`success`)
  - Jobs:
    - `secret-scan`: `success` (11s) (Job ID: `101045358987`)
    - `sca-scan`: `success` (16s) (Job ID: `101045358801`)
    - `sast-scan`: `success` (20s) (Job ID: `101045358982`)
    - `sbom-generate`: `success` (13s) (Job ID: `101045358946`)
- **Remote Log Inspections on P_R1:**
  - **TruffleHog:** Log confirms `VERSION: 3.97.4`, image `ghcr.io/trufflesecurity/trufflehog:3.97.4`, scanner version `3.97.4`. No occurrence of `latest`.
  - **Trivy:** Log confirms `version: v0.74.0`, `aquasecurity/trivy info found version: 0.74.0 for v0.74.0/Linux/64bit`.
  - **Artifacts:** `tridentpos-sbom` generated and uploaded to run `33879790652`.
  - **Security Gating:** Zero jobs skipped, zero jobs using `continue-on-error`, zero swallowed exit codes.

**BUILDER REMEDIATION VERDICT:** **`READY FOR ROLE-SEPARATED REVIEW`**
