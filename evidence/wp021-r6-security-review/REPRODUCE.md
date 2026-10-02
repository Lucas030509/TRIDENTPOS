# Reproduce independent R6 review

Preserve the attached original bundle. Create a review directory with this layout:
- subject/: checkout detached 83dd38b9773acee4d5a56d439ad2d3e959b000d2 from the verified bundle.
- adversarial.mjs: independent script from this packet.
- sql-runtime/adapter.mjs: adapter from this packet.

From subject/: npm ci --ignore-scripts --no-audit --no-fund; npm run build; npm test --workspace=@trident/billing.
From review/: npm install --prefix sql-runtime --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8; node adversarial.mjs.
Adversarial exit 0 means A1-A4 reproduced the defects and A5 verified opaque sanitizer behavior, NOT Security PASS.
From subject/: set WP021_TEST_DATABASE_ADAPTER to the absolute file:// URI of review/sql-runtime/adapter.mjs and execute node --test --test-concurrency=1 tests/integration/wp021-security-remediation.test.mjs.
Never point these tests at production. SQL target tests create/drop a dedicated schema; independent adversarial script uses fresh in-memory PGlite.
Native tests require an isolated PostgreSQL test database and appropriate migration role; not executed successfully in this review. No native concurrency, physical crash or PITR claim.
