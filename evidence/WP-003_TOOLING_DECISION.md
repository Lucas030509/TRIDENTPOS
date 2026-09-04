# WP-003 — POSTGRESQL MIGRATION ENGINE TOOLING DECISION

- **Work Package:** WP-003 — Cloud PostgreSQL Database Scaffolding & Migration Engine
- **Builder:** `17_Database_Engineer`
- **Framework:** EAAF v1.2.0
- **Base Commit:** `675e3bfc90becdc4fcc90fd5b58c6e16076d003a`
- **Date:** 2026-09-04
- **Artifact Type:** Implementation Tooling Decision Record (Implementation Level)

---

## 1. Context & Objectives

The frozen architectural roadmap (DATA_ARCHITECTURE.md, DATA_MIGRATION_STRATEGY.md, TECH_STACK_DECISIONS.md) requires WP-003 to establish the foundational PostgreSQL 16 database scaffolding, connection harness, migration tracking ledger (`_migrations`), and migration engine for Platform Core.

The repository's frozen plan explicitly states:
> `ORM / Migration Tooling = IMPLEMENTATION TOOLING DECISION — MUST BE SELECTED BEFORE WP-003 START`

The mandate is to select or construct a tooling solution that:
1. Targets PostgreSQL 16 and Supabase PostgreSQL.
2. Runs cleanly on Node.js 24 LTS and strict TypeScript.
3. Provides deterministic migration ordering and cryptographic SHA-256 checksum tracking with drift detection.
4. Enforces transactional execution (`BEGIN` ... `COMMIT` / `ROLLBACK`).
5. Supports the Expand → Transition → Contract migration discipline.
6. Implements controlled forward (`up`) and non-production backward (`down`) migrations with programmatic guards against destructive production rollback.
7. Retains the smallest sufficient supply-chain footprint with minimal runtime coupling to future domain layers.

---

## 2. Evaluation Criteria

Each candidate tooling option was evaluated against the 15 governed criteria:
1. **PostgreSQL 16 compatibility**: Native support for PostgreSQL 16 syntax, catalogs, and extensions (`uuid-ossp`, `pgcrypto`).
2. **Node.js 24 compatibility**: ESM support without legacy polyfills or deprecation warnings.
3. **TypeScript compatibility**: Native type safety without `@ts-ignore` or loose type overrides.
4. **Migration transaction support**: Explicit transactional boundaries per migration file (`BEGIN` ... `COMMIT` / `ROLLBACK`).
5. **Deterministic ordering**: Lexicographical/numerical sequencing without ambiguity.
6. **Checksum support & drift detection**: SHA-256 hash tracking of migration contents to detect tampering or drift.
7. **Controlled up/down migration model**: Forward execution by default, controlled down execution for test/dev only.
8. **Raw SQL support**: Direct execution of native PostgreSQL DDL.
9. **Supabase compatibility**: Connection pooling compatibility and standard PostgreSQL wire protocol.
10. **CI friendliness**: Fast execution in CI containers without background daemons or external proprietary services.
11. **Minimal runtime coupling**: Zero premature domain ORM abstractions.
12. **Package maintenance status**: Active maintenance, low vulnerability history.
13. **Supply-chain footprint**: Minimal transitive dependencies, low attack surface.
14. **Compatibility with Expand-Transition-Contract**: Allows non-breaking additive changes, decoupled from domain models.
15. **Disposable PostgreSQL 16 testing**: Trivially testable against local/ephemeral PostgreSQL containers.

---

## 3. Evaluated Candidates

### Candidate A: Prisma (`prisma` / `@prisma/client`)
- **Pros**: Popular DX, schema definition language.
- **Cons**: Requires binary query engines, high memory footprint, shadow database requirement for shadow migrations, opaque ledger, tightly couples migration tooling to an application ORM, poor alignment with raw PostgreSQL 16 DDL requirements. High supply-chain footprint.
- **Verdict**: REJECTED.

### Candidate B: Drizzle ORM / Drizzle Kit (`drizzle-orm` / `drizzle-kit`)
- **Pros**: Lightweight TypeScript-first ORM, SQL-like syntax.
- **Cons**: `drizzle-kit` CLI contains closed-source components, lacks a robust built-in programmatic down-step runner, does not enforce SHA-256 drift verification natively on raw SQL migrations, couples migration execution to schema code generation.
- **Verdict**: REJECTED.

### Candidate C: Knex.js (`knex`)
- **Pros**: Mature query builder and migration runner.
- **Cons**: Multi-dialect abstraction introduces unnecessary overhead for PostgreSQL 16, default migration table does not compute cryptographic checksums without custom wrapper hooks, large dependency tree.
- **Verdict**: REJECTED.

### Candidate D: node-pg-migrate (`node-pg-migrate`)
- **Pros**: PostgreSQL-focused, supports JS/TS migrations and raw SQL.
- **Cons**: Default migration table stores only timestamps and names, lacking native cryptographic SHA-256 checksums and tamper detection; requires external transpilation tooling or wrapper scripts for strict ESM TypeScript; larger transitive dependency footprint than raw driver.
- **Verdict**: REJECTED.

### Candidate E: Dedicated TypeScript Migration Engine via `pg` (node-postgres)
- **Driver / Library**: `pg` (`^8.13.3`), `@types/pg` (`^8.11.11`), `dotenv` (`^16.4.7`).
- **Architecture**: A lean, purpose-built TypeScript migration engine housed in `packages/database`.
- **Pros**:
  - Direct wire communication with PostgreSQL 16 using the industry-standard node-postgres driver.
  - Native Node.js 24 ESM execution in strict TypeScript.
  - Complete control over the `_migrations` ledger schema (`id`, `name`, `checksum`, `applied_at`, `execution_order`).
  - Native SHA-256 cryptographic hashing of canonical migration files to enforce strict drift prevention.
  - Guaranteed atomic transactional boundaries (`BEGIN` ... `COMMIT` / `ROLLBACK`).
  - Built-in programmatic guard refusing destructive `down` executions when `NODE_ENV === 'production'` or `ALLOW_DESTRUCTIVE_DOWN !== 'true'`.
  - Minimal supply-chain attack surface: only the foundational driver and types.
  - Zero premature coupling to business models or application ORMs.
- **Verdict**: SELECTED.

---

## 4. Comparison Matrix

| Criterion | Prisma | Drizzle Kit | Knex | node-pg-migrate | Dedicated `pg` Engine |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 1. PostgreSQL 16 Compatibility | Yes | Yes | Yes | Yes | **Yes** |
| 2. Node.js 24 LTS & ESM | Complex | Yes | Fair | Fair | **Native** |
| 3. Strict TypeScript | Yes | Yes | Fair | Fair | **Strict** |
| 4. Transaction Rollback on Failure | Partial | Tooling-dependent | Yes | Yes | **Deterministic** |
| 5. Deterministic Ordering | Yes | Yes | Yes | Yes | **Yes** |
| 6. SHA-256 Checksum & Drift Guard | Internal hash | No | No | No | **Native SHA-256** |
| 7. Controlled Up/Down Model | Up only | Up only | Up/Down | Up/Down | **Up + Guarded Down** |
| 8. Raw SQL & Extensions Support | Limited | Good | Good | Good | **Direct Native** |
| 9. Supabase Compatibility | Yes | Yes | Yes | Yes | **Direct Wire** |
| 10. CI Friendliness | Heavy | Good | Good | Good | **Optimal** |
| 11. Minimal Coupling | Poor (Full ORM) | Moderate (ORM) | Moderate (QB) | Good | **Optimal (Zero ORM)** |
| 12. Supply-chain Footprint | Heavy (>100MB) | Moderate | Moderate | Moderate | **Minimal (~2 deps)** |
| 13. Expand-Transition-Contract | Cumbersome | Fair | Good | Good | **Native** |
| 14. Disposable DB Testing | Slow | Good | Good | Good | **Fast & Isolated** |

---

## 5. Selected Implementation Specification

- **Selected Tooling**: Dedicated TypeScript PostgreSQL Migration Engine using `pg`
- **Runtime Packages**:
  - `pg`: `^8.13.3` (Production dependency in `packages/database`)
  - `dotenv`: `^16.4.7` (Production dependency in `packages/database`)
- **Development Packages**:
  - `@types/pg`: `^8.11.11` (Dev dependency in `packages/database`)
- **Package Location**: `packages/database` in TRIDENTPOS monorepo
- **Migration Ledger Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS _migrations (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_order INTEGER NOT NULL
  );
  ```

---

## 6. Architecture Impact Assessment

- **Frozen Architecture Compliance**: The selected engine implements the exact requirements of `DATA_ARCHITECTURE.md`, `DATA_MIGRATION_STRATEGY.md`, and `TECH_STACK_DECISIONS.md`.
- **Zero Architectural Alteration**: This selection does NOT alter or conflict with any frozen architecture document, ADR, or manifest entry.
- **Architectural Change Status**: `ARCHITECTURE_CHANGE REQUIRED: NO`. Implementation proceeds under approved WP-003 authority.
