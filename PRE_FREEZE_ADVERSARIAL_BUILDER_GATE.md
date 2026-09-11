# PRE-FREEZE ADVERSARIAL BUILDER GATE v1.0
## TRIDENTPOS Governed Engineering Extension under EAAF v1.2.0 Baseline

**Document Status:** `APPROVED & MANDATORY FOR ALL BUILDER WORK PACKAGES WP-009+`  
**Effective Date:** 2026-09-10  
**Authority:** Product Owner / EAAF Governance Coordinator  
**Operating Mode:** `SOLO_MAINTAINER`  
**Governing Framework:** `EAAF v1.2.0` (Pinned SHA: `7e036f43240b3dc28ccb996e350263598275b2cd`)  
**Scope:** `WP-009 and every subsequent Builder Work Package unless superseded by formally approved governance`

---

## 1. Purpose and Operational Philosophy

The **Pre-Freeze Adversarial Builder Gate** establishes a mandatory, stack-agnostic self-audit protocol that every Builder Agent must execute and document **prior to freezing an implementation subject SHA**.

Historically, builders may fall prey to "confirmation bias" — writing unit tests that only exercise happy paths, leaving privileged native handles accessible via reflection or prototype leakage, swallowing errors in critical failure branches, or conflating software crash simulations with physical electrical hardware validation.

This gate enforces a systematic adversarial mindset: **the Builder must act as an attacker against their own code before claiming that the work package is ready for freeze and independent role-separated review.**

```text
================================================================================
                    CANONICAL EAAF IMPLEMENTATION LIFECYCLE
================================================================================
  IMPLEMENTATION
       ↓
  BUILDER TESTS (Unit, Integration, Negative)
       ↓
  PRE-FREEZE ADVERSARIAL BUILDER GATE (Gates A through L)
       ↓
  BUILDER EVIDENCE REPORT (WP-xxx_BUILDER_EVIDENCE.md)
       ↓
  FREEZE EXACT IMPLEMENTATION SUBJECT SHA (S)
       ↓
  QUICK INTEGRITY CHECK
       ↓
  ROLE-SEPARATED INDEPENDENT REVIEWS (Specialist + Code Reviewer)
       ↓
  FINAL GATE & GOVERNED MERGE
================================================================================
```

> [!IMPORTANT]
> **CRITICAL INDEPENDENCE RULE:**
> **THE PRE-FREEZE ADVERSARIAL BUILDER GATE IS A BUILDER SELF-AUDIT AND DOES NOT CONSTITUTE INDEPENDENT REVIEW.**  
> Passing this gate does NOT authorize merging. It authorizes ONLY the freezing of candidate subject `S` for handoff to independent, role-separated Specialist Reviewers and Code Reviewers under EAAF v1.2.0. The Builder cannot review their own implementation for merge authorization. Any review findings that require code changes return ownership to the Builder, creating a new candidate SHA that invalidates all prior reviews.

> [!NOTE]
> This policy is a TRIDENTPOS project-level governance extension operating under the pinned EAAF v1.2.0 baseline. It does NOT alter the upstream EAAF Framework repository or the pinned framework SHA (`7e036f43240b3dc28ccb996e350263598275b2cd`).

---

## 2. The 12 Mandatory Pre-Freeze Builder Gates

Every Builder evidence report beginning with `WP-009` must include a dedicated section evaluating each of the following 12 gates.

---

### Gate A — SSOT & Scope Traceability
**Core Question:** *Does every implemented behavior map strictly to approved requirements without scope creep?*

Before freezing, the Builder must verify:
1. Every new class, function, database table, IPC channel, or configuration field maps directly to an approved requirement in `IMPLEMENTATION_PLAN.md`, `SYSTEM_CONTEXT.md`, `FUNCTIONAL_ARCHITECTURE.md`, `SOLUTION_ARCHITECTURE.md`, `DATA_ARCHITECTURE.md`, `SECURITY_ARCHITECTURE.md`, or an approved `ADR`.
2. No protected Product Owner decision was unilaterally resolved or invented.
3. No responsibility assigned to a future Work Package was absorbed.
4. No adjacent feature or convenience abstraction was implemented without formal authorization.
5. **Verdict Rule:** Any material unmapped behavior results in `BLOCKED — DO NOT FREEZE`.

---

### Gate B — Public Boundary & Escape-Hatch Audit
**Core Question:** *Can another developer or consumer bypass the governed control while still using technically valid code?*

The Builder must adversarially inspect the entire exposed surface:
1. **Public API Surface:** Are internal native handles (e.g. SQLite database connections, raw sockets, unhardened IPC dispatchers) exposed via public methods, properties, or prototypes?
2. **Runtime Reflection:** Can native objects be accessed via `Object.getOwnPropertyNames()`, `Reflect.ownKeys()`, or prototype traversal? (Use true ECMAScript `#private` state where language permits).
3. **Symbol Leakage:** Are test hooks or escape hatches exposed on global symbol registries (e.g. `Symbol.for(...)`) or prototype symbol properties?
4. **Package Exports:** Does `package.json` restrict exports exclusively to the governed public entrypoint, strictly omitting internal test helpers and private modules?
5. **Negative Boundary Tests:** The Builder must author automated negative tests explicitly proving that privileged handles cannot be retrieved through public surfaces.
6. **Verdict Rule:** Any public escape hatch capable of bypassing a governed architectural or security invariant results in `BLOCKED`.

---

### Gate C — Failure Semantics & Error Paths
**Core Question:** *Can any failure occur while the caller is allowed to believe the operation succeeded?*

The Builder must audit every error-handling construct:
1. **Zero False-Green Success:** No critical failure path may log an error and return a normal success value or default.
2. **Explicit Fail-Closed State:** If an atomic boundary, rollback, commit, or state restoration fails, the service or connection must permanently transition to an untrusted, compromised state that rejects subsequent operations fail-closed.
3. **Dual Cause Preservation:** Composite failures (e.g. operation failure + cleanup/restoration failure, or commit failure + rollback failure) must preserve both primary and secondary error contexts in `error.cause`.
4. **Bounded Operations:** No unbounded retry loops, infinite polling, or unhandled promise rejections.
5. **Verdict Rule:** Any swallowed critical error or ambiguous success result is a blocking defect.

---

### Gate D — Negative Acceptance Criteria
**Core Question:** *Are critical requirements paired with their corresponding forbidden-state tests?*

For each critical positive capability, the Builder must define and test the corresponding negative invariant:
- *Positive:* Authorized operation succeeds.  
  *Negative:* Unauthorized caller cannot reach the same capability through an alternative public interface.
- *Positive:* Atomic transaction commits and persists changes.  
  *Negative:* Failed commit rolls back changes and never returns success to the caller.
- *Positive:* Durability mode dynamically escalates for critical transactions.  
  *Negative:* Restoration failure fails closed and invalidates subsequent operations.
- *Positive:* Hardened boundary isolates runtime primitives.  
  *Negative:* Script injection in untrusted renderers cannot access Node.js or OS primitives.

Critical invariants without automated negative acceptance criteria require explicit written justification.

---

### Gate E — Test Reality & Environment Authenticity
**Core Question:** *Do automated tests validate real system behavior or merely confirm mock definitions?*

1. **Real Infrastructure:** Where acceptance criteria require database durability, file persistence, cryptographic operations, IPC communication, or process lifecycle management, tests must run against real disk files, real database engines, real cryptographic primitives, and real runtimes.
2. **Mocks Boundary:** Mocks and stubs are permissible *only* for controlled fault injection (e.g. simulating disk write I/O failure during commit/rollback) where the production failure logic is under test, or for external third-party network dependencies. Mocks may never replace the core behavior being validated.
3. **Verdict Rule:** If a Work Package claims engine durability or process isolation, a test suite relying solely on in-memory mocks is invalid.

---

### Gate F — False-Green Audit
**Core Question:** *Is the test suite genuinely green, or are checks being bypassed?*

The Builder must run an explicit scan across the codebase and CI configuration for:
- `test.skip`, `describe.skip`, `it.skip`
- `.only(`, `test.only`, `it.only`
- `test.todo`, `it.todo`, `TODO`
- `@ts-ignore`, `@ts-nocheck` (Monorepo requires strict TypeScript with `skipLibCheck = false`)
- `continue-on-error`, `allow-failure` in CI workflows
- `|| true` in gate-relevant test scripts
- Empty catch blocks swallowing operational exceptions
- Self-confirming assertions that only test their own test-harness helpers

All scan results must be classified in the evidence report. Benign non-gate exceptions (e.g. test directory teardown unlinking) must be explicitly documented.

---

### Gate G — Security Adversarial Check
**Core Question:** *Does the implementation resist common attack vectors and honor zero-trust invariants?*

Where applicable, the Builder must review:
1. **Authentication & Identity:** Mutual handshake verification, non-replayable credentials, cryptographic signing.
2. **Authorization & Boundaries:** Tenant isolation, least privilege, absence of privilege escalation paths.
3. **Data Protection:** Redaction of secrets, PINs, and PII prior to logging or persistence.
4. **Input Validation & Sanitization:** Strict schema validation, rejection of unapproved pragmas, commands, or parameters.
5. **Verdict Rule:** A passing unit test suite does not override a violated security invariant.

---

### Gate H — Data & Concurrency Invariants
**Core Question:** *Are transactional atomicity, concurrency, and persistence semantics guaranteed?*

Where applicable, the Builder must verify:
1. **Atomicity:** Complete commit or zero-persistence rollback.
2. **Concurrency Control:** Single-writer FIFO serialization, non-blocking concurrent readers under WAL, absence of race conditions.
3. **Idempotency:** Replay resistance and duplicate message handling.
4. **Durability Restorability:** Dynamic durability switches restore prior baseline safely under all exit paths.
5. **Verdict Rule:** Any ambiguous persisted state that can be reported as successful is blocking.

---

### Gate I — Architecture Conformance & Dependency Direction
**Core Question:** *Does the code respect package boundaries and dependency flow?*

1. **Dependency Invariants:** Dependencies must flow according to the frozen architecture graph (e.g. `@trident/edge` depends on `@trident/core`, never circular).
2. **Bounded Context Integrity:** Platform Core modules must not absorb domain-specific logic.
3. **Exact Dependency Pinning:** Dependencies must be pinned to exact versions (no `^`, no `~`), matching `package-lock.json` with zero unrelated drift.
4. **Verdict Rule:** Successful compilation does not prove architectural compliance.

---

### Gate J — Evidence Honesty & Debt Separation
**Core Question:** *Does the Builder evidence report accurately reflect the boundary between software proof and physical reality?*

1. **Reconciliation Traceability:**
   $$\text{REQUIREMENT} \longrightarrow \text{CODE} \longrightarrow \text{TEST} \longrightarrow \text{EVIDENCE}$$
2. **Software vs. Hardware Distinction:** Software simulations (e.g. process `SIGKILL` mid-transaction) must NEVER be claimed as physical hardware validation (e.g. electrical power loss against volatile SSD write caches).
3. **Debt Classification:** Validations that require target hardware, external certification, or subsequent work packages must be explicitly recorded as `OPEN` or `OPEN / PARTIAL`. Never upgrade absence of evidence into a PASS.

---

### Gate K — CI & Security Pipeline Validity
**Core Question:** *Did all required automated checks execute against the exact candidate subject?*

The Builder must verify:
1. GitHub Actions CI workflow executed all required jobs (`build`, `lint`, `typecheck`, `unit-tests`) with `conclusion: success`.
2. GitHub Actions Security Scan workflow executed all required jobs (`secret-scan`, `sca-scan`, `sast-scan`, `sbom-generate`) with `conclusion: success`.
3. Checks ran against the exact candidate commit or its formally verified PR integration merge reference.

---

### Gate L — Freeze Integrity & Immutability
**Core Question:** *Is the repository working tree clean and the candidate commit immutable?*

Before freezing:
1. Working tree is clean (`git status` shows nothing to commit).
2. All implementation code, negative tests, and builder evidence are committed.
3. The exact candidate commit SHA `S` is captured.
4. Once frozen, **zero further commits may be added to the feature branch**. Any subsequent modification invalidates `S` and requires generating a new candidate subject (`S2`, `S3`, etc.) with full re-execution of this gate and downstream reviews.

---

## 3. Mandatory Builder Gate Verdict Format

The Builder must conclude their self-audit in `WP-xxx_BUILDER_EVIDENCE.md` with exactly one of the following verdicts:

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: PASS
                     AUTHORIZED TO FREEZE CANDIDATE SHA
================================================================================
```

or:

```text
================================================================================
          PRE-FREEZE ADVERSARIAL BUILDER GATE VERDICT: FAIL
                      BLOCKED — REMEDIATION REQUIRED
================================================================================
```

There are no conditional passes, provisional passes, or soft passes. Any unresolved blocking finding requires code remediation and re-running the gate under a new commit.

---

## 4. Traceability & Governance Authority

- **Introduced By:** WP-008 Metadata Closure & Governance Promotion.
- **Authority:** Product Owner & EAAF Governance Coordinator.
- **Effective Work Packages:** `WP-009`, `WP-010`, `WP-011`, `WP-012`, `WP-013`, `WP-014`, `WP-015`, `WP-016`, `WP-017`, `WP-018`, `WP-019`, `WP-020`, `WP-021`, `WP-022`, `WP-023`, `WP-024`, `WP-025`, `WP-026`, `WP-027`, `WP-028`.
- **Framework Compliance:** Operates as a project-level quality control extension fully compatible with EAAF v1.2.0.
