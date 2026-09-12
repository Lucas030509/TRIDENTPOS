# WP-010 S10-R4 INDEPENDENT SECURITY REVIEW

**Work Package:** WP-010 Edge Offline IAM & Floor PIN Authentication Engine  
**Review Subject:** `S10-R4 = adc64951a941157304dffea2846e5b4866d58202`  
**Reviewer Agent:** `08_Security_Architect`  
**Review Branch:** `review/wp-010-s10-r4-security`  
**Parent / Base Commit:** `adc64951a941157304dffea2846e5b4866d58202`  
**Date:** 2026-09-12  
**Framework:** `EAAF v1.2.0` (Pinned Framework SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Canonical Main / Ratified ACR Baseline:** `a142c87c46c89585cd76768a8ced9f0a926c396a` (`G10-ACR`)  
**Canonical Architecture Change:** `ACR-2026-012`  
**Implementation PR:** #32 (Open, Unmerged)  

---

## 1. Executive Summary & Security Assessment

As independent `08_Security_Architect`, a comprehensive, zero-trust, source-level security audit was executed on the frozen implementation subject `S10-R4` (`adc64951a941157304dffea2846e5b4866d58202`).

The review was performed without reliance on Builder claims, Coordinator Quick Integrity verdicts, or CI/Security scan summaries as substitutes for direct code inspection. The candidate incorporates the ratified architecture changes from `ACR-2026-012` into `@trident/edge`.

### Security Audit Headline:
- **Canonical RBAC Capability:** Early station unlock is authorized strictly and exclusively by the canonical capability `estacion.desbloquear` or the approved transitional functional role codes `ROLE-001` (Administrador) and `ROLE-002` (Gerente / Supervisor).
- **Zero Display-Name Authorization:** All display names and unratified aliases (`ADMIN`, `MANAGER`, `ADMINISTRADOR`, `GERENTE`, `SUPERVISOR`, `Cajero`, `Mesero`, `STAFF`, etc.) strictly fail closed with `INSUFFICIENT_PERMISSIONS` unless the cached user explicitly holds `estacion.desbloquear`.
- **Atomic SQLite WAL Audit:** Lockout state clearance and the forensic `SupervisorStationUnlocked` audit event are committed in a single atomic SQLite WAL transaction. Any failure rolls back both without leaving an unlocked station or missing audit record.
- **Strict Public Trust Boundary:** Internal persistence, lockout state machines, private test tokens, and cached user mutation methods remain strictly unexported from `@trident/edge`.
- **Zero Blocking Findings (0):** Implementation satisfies all governed security invariants.

---

## 2. In-Depth Security Verification Matrix

| # | Security Invariant | Code Inspection & Verification Evidence | Verdict |
|---|---|---|---|
| **1** | **ACR-2026-012 Compliance** | In `packages/edge/src/iam/offline-iam-service.ts` (lines 610–630), authorization is evaluated via `const CANONICAL_UNLOCK_PERMISSION = 'estacion.desbloquear'` and `const TRANSITIONAL_CANONICAL_ROLES = new Set(['ROLE-001', 'ROLE-002'])`. All other role names, operational roles (`ROLE-003`, `ROLE-004`, `Cajero`, `Mesero`), and display aliases (`ADMIN`, `MANAGER`, `ADMINISTRADOR`, `GERENTE`, `SUPERVISOR`) strictly fail closed with `INSUFFICIENT_PERMISSIONS`. | **PASS** |
| **2** | **Custom RBAC Behavior** | In `offline-iam-service.ts` line 613, `roles.some((r) => r.trim().toLowerCase() === CANONICAL_UNLOCK_PERMISSION)` allows arbitrary custom roles (e.g., `['CUSTOM_ROLE_AUDITOR', 'estacion.desbloquear']`) to authorize early unlock without code modification. Verified in `WP010-T30` (Condition 1). | **PASS** |
| **3** | **Tenant Isolation** | In `offline-iam-service.ts` lines 514–523, `supervisor.organizationId !== this.#organizationId` fails closed with `AUTHENTICATION_FAILED` before role evaluation or PIN verification, and increments the station failure counter. Verified in `WP010-T26` and `WP010-T30` (Condition 10). | **PASS** |
| **4** | **Branch / Local-Cache Isolation** | Stations belong to `this.#branchId`. An attempt to target a station outside the branch or not registered in local SQLite fails closed with `STATION_NOT_FOUND` (`offline-iam-service.ts` lines 473–499). User credentials must exist in the edge station's local `cached_users` table. | **PASS** |
| **5** | **Credential Lifecycle** | In `offline-iam-service.ts` lines 502–570: revoked supervisor (`isRevoked === 1`) throws `AUTHENTICATION_FAILED`; expired credential (`expiresAtSec <= now`) throws `CREDENTIAL_EXPIRED`; future credential (`issuedAtSec > now + 300`) throws `CREDENTIAL_FUTURE_TIMESTAMP`; corrupted timestamp or malformed roles JSON throws `CREDENTIAL_CORRUPT`; non-Argon2id hash prefix throws `CREDENTIAL_CORRUPT`. Every condition increments failure counters and preserves lockout. | **PASS** |
| **6** | **Supervisor PIN Brute-Force Protection** | In `offline-iam-service.ts` lines 633–645, invalid PIN attempts call `this.#lockoutManager.recordFailure(request.stationId, now)`. Consecutive failures enforce progressive delays (attempt 3: 2s, attempt 4: 5s, attempt 5: 300s `STATION_LOCKED`). Lockout state is never cleared on failed attempts; locked stations remain locked. | **PASS** |
| **7** | **Authorization Oracle Analysis** | In `offline-iam-service.ts` lines 602–645, role parsing & capability check precedes Argon2id verification (`verifyBranchPin`). This ordering is strictly mandated by `ACR-2026-012` and protects the POS terminal CPU against Argon2id computation exhaustion DoS attacks by non-supervisors. Because every unauthorized attempt increments `consecutive_failures` and enforces progressive delays/lockouts on the station, and because employee role titles are publicly visible shift assignments, this ordering introduces zero material or exploitable information disclosure. | **PASS** |
| **8** | **Trusted Time & Clock Rollback** | In `offline-iam-service.ts` lines 457–468, `this.#trustedTimeManager.getTrustedEffectiveTime()` is retrieved; if the edge node is in `CLOCK_ROLLBACK_LOCKED`, `supervisorUnlockStation` immediately throws `CLOCK_ROLLBACK_LOCKED` fail-closed. Credential validity is checked against trusted time, preventing local time manipulation. | **PASS** |
| **9** | **Atomic Unlock & Audit** | In `packages/edge/src/db/iam-persistence.ts` lines 317–343, `unlockStationWithAudit` executes inside `this.#edgeDb.runInTransaction(() => { ... })`. The lockout state reset (`consecutive_failures = 0, locked_until = NULL`) and the `SupervisorStationUnlocked` audit insertion execute in the same SQLite transaction. In `WP010-T29` and `WP010-T30` (Condition 16), simulated audit failure causes immediate rollback, leaving the station locked with failures intact. | **PASS** |
| **10** | **Canonical Forensic Audit Event** | The audit event written by `unlockStationWithAudit` sets `eventType: 'SupervisorStationUnlocked'`, `action: 'SUPERVISOR_UNLOCK'`, `severity: 'WARN'`, with `metadata: { stationId, unlockedByUserId, actorId, success: 1, reason }`. Sensitive plaintext PINs are never passed or recorded. Chained into `edge_security_audit` with RFC 8785 canonical JSON and SHA-256 hash chaining. | **PASS** |
| **11** | **Public Trust Boundary** | `packages/edge/src/index.ts` and `packages/edge/src/iam/index.ts` export only `OfflineIamService`, `EdgeAuthRouter`, `SESSION_TOKEN_TTL_SECONDS`, and public types. `IamPersistence`, `LockoutManager`, PIN verification primitives, and test tokens are unexported. `OfflineIamService` exposes zero cache manipulation methods (`cacheUser`, `invalidateUser`, `getCachedUser` are absent). Verified in `WP010-T25` and `WP010-T28`. | **PASS** |
| **12** | **Test Authenticity** | Comprehensive review of `packages/edge/src/offline-iam.test.ts` confirms 0 `.skip`, 0 `.only`, and 0 `.todo`. All tests execute real Argon2id hashing, real SQLite transactions, and real crypto operations. Tests `WP010-T22` through `WP010-T30` rigorously validate real behavioral contracts without string-inspection mocks. | **PASS** |

---

## 3. Detailed Technical Analysis

### 3.1 Authorization Oracle Analysis
The security reviewer inspected the execution sequence in `OfflineIamService.prototype.supervisorUnlockStation`:
```
Step 1: Validate station ID and format
Step 2: Validate supervisor user ID and format
Step 3: Retrieve trusted time; reject if CLOCK_ROLLBACK_LOCKED
Step 4: Retrieve station credentials from SQLite; reject if missing or revoked
Step 5: Retrieve cached supervisor user from SQLite; reject if missing, revoked, cross-tenant, or expired
Step 6: Evaluate RBAC capability (estacion.desbloquear or ROLE-001/ROLE-002)
        -> If false: record failure on station, emit audit if lockout, throw INSUFFICIENT_PERMISSIONS
Step 7: Verify supervisor PIN via verifyBranchPin (Argon2id)
        -> If false: record failure on station, apply progressive delay, emit audit if lockout, throw AUTHENTICATION_FAILED
Step 8: Atomically commit lockout reset and SupervisorStationUnlocked audit event in single transaction
```

**Security Analysis Findings:**
1. Evaluating RBAC capability (Step 6) prior to Argon2id computation (Step 7) is a deliberate and necessary defensive mechanism against resource exhaustion attacks. Argon2id baseline (`m=65536, t=3, p=4`) requires ~65ms of CPU time and 64 MB RAM per call. Executing Argon2id for non-supervisory accounts would expose resource-constrained POS hardware to denial-of-service degradation.
2. Step 6 explicitly records a station failure (`recordFailure(request.stationId, now)`), meaning any attempt to probe roles via Step 6 incurs progressive delays and locks the terminal after 5 attempts, neutralizing automated enumeration attacks.
3. Employee operational roles in restaurant environments are not high-secrecy cryptographic values; they are organizational attributes known to restaurant staff.
4. Conforms strictly to the failure semantics mandated in ratified `ACR-2026-012`.
5. **Conclusion:** Not a security vulnerability. Finding is closed / non-blocking.

### 3.2 Audit & Lockout Atomicity
Inspection of `IamPersistence.prototype.unlockStationWithAudit` in `packages/edge/src/db/iam-persistence.ts`:
```typescript
public unlockStationWithAudit(stationId: string, currentEffectiveTime: number, auditInput: ...): { audit: EdgeSecurityAuditRecord } {
  return this.#edgeDb.runInTransaction(() => {
    this.resetLockoutState(stationId, currentEffectiveTime);
    if (this.#simulateAuditInsertFailure) {
      throw new Error('SIMULATED_AUDIT_INSERT_FAILURE');
    }
    const audit = this.#appendAuditEventInternal(auditInput);
    return { audit };
  });
}
```
`EdgeDatabaseService.prototype.runInTransaction` uses SQLite `BEGIN IMMEDIATE` and automatically issues `ROLLBACK` if an exception occurs. Because SQLite WAL enforces atomic commits, it is impossible for the lockout state to be cleared while the audit record fails. This provides airtight forensic accountability.

---

## 4. Security Validation Debt & PO Decisions Audit

### 4.1 Security Validation Debt `SEC-VAL-02`
- **Current Builder Status:** `CLOSURE CANDIDATE`
- **Security Architect Recommendation:** **`CLOSE`**
- **Justification:** All security controls required for offline IAM brute-force protection and lockout have been completely implemented and deterministically verified:
  - 5-attempt threshold with 300-second lockout enforced locally and persisted in SQLite.
  - Progressive artificial delays (attempt 3: 2s, attempt 4: 5s) verified in live router (`WP010-T22`).
  - Lockout survives process restarts (`WP010-T11`).
  - Supervisory early unlock requires ratified canonical capability `estacion.desbloquear` or transitional `ROLE-001`/`ROLE-002` (`WP010-T30`).
  - Unlock and audit commitment are atomic with rollback (`WP010-T29`, `WP010-T30`).
  - All display-name aliases fail closed with `INSUFFICIENT_PERMISSIONS`.
  - Recommendation to Coordinator: Formally mark `SEC-VAL-02` as **CLOSED**.

### 4.2 Security Validation Debt `SEC-VAL-08` and `SEC-VAL-03`
- **`SEC-VAL-08`:** Retained as **`OPEN / PARTIAL — TARGET HARDWARE BENCHMARK REQUIRED`** (software benchmark on constrained process completed; POS physical terminal qualification required).
- **`SEC-VAL-03`:** Retained as **`OPEN / PARTIAL — TARGET HARDWARE / LAN EVIDENCE REQUIRED`** (deferred to WP-028 per governance).

### 4.3 Protected Product Owner Decisions
All nine (9) protected Product Owner decisions (`OQ-SSOT-01` through `OQ-SSOT-07`, `OQ-ARCH-01`, `OQ-ARCH-02`) remain strictly **`PENDING PO DECISION`**. Zero architectural usurpation detected.

---

## 5. Security Review Verdict

- **Blocking Security Findings:** 0
- **Advisory Security Findings:** 0

WP-010 S10-R4 INDEPENDENT SECURITY REVIEW — PASS
