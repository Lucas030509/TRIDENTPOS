import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadMigrationFiles } from './parser.js';
import type {
  MigrationRecord,
  MigrationStatus,
  MigrationResult,
  RevertResult,
  RunnerOptions,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
export const DEFAULT_TABLE_NAME = '_migrations';

/**
 * Validates table name to prevent SQL injection in internal ledger queries.
 */
function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid migration table name: ${name}`);
  }
  return name;
}

/**
 * Ensures the migration ledger table exists.
 */
export async function ensureMigrationTable(
  client: pg.PoolClient,
  tableName = DEFAULT_TABLE_NAME,
): Promise<void> {
  const safeTable = sanitizeTableName(tableName);
  const sql = `
    CREATE TABLE IF NOT EXISTS ${safeTable} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_order INTEGER NOT NULL
    );
  `;
  await client.query(sql);
}

/**
 * Retrieves all applied migration records ordered by execution_order.
 */
export async function getAppliedMigrations(
  client: pg.PoolClient,
  tableName = DEFAULT_TABLE_NAME,
): Promise<MigrationRecord[]> {
  const safeTable = sanitizeTableName(tableName);
  const result = await client.query<MigrationRecord>(`
    SELECT id, name, checksum, applied_at, execution_order
    FROM ${safeTable}
    ORDER BY execution_order ASC, id ASC;
  `);
  return result.rows;
}

/**
 * Executes forward migrations (up) in sequential transactional order.
 * Strictly verifies SHA-256 checksums of already applied migrations against local files.
 * If drift or mismatch is detected, halts execution immediately.
 */
export async function migrateUp(pool: pg.Pool, options?: RunnerOptions): Promise<MigrationResult> {
  const migrationsDir = options?.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const tableName = options?.tableName || DEFAULT_TABLE_NAME;
  const files = loadMigrationFiles(migrationsDir);

  const client = await pool.connect();
  try {
    await ensureMigrationTable(client, tableName);
    const applied = await getAppliedMigrations(client, tableName);

    // Verify drift on previously applied migrations
    for (const record of applied) {
      const matchingFile = files.find((f) => f.id === record.id);
      if (!matchingFile) {
        throw new Error(
          `Migration drift detected: Applied migration '${record.id}_${record.name}' is missing from migrations directory.`,
        );
      }
      if (matchingFile.checksum !== record.checksum) {
        throw new Error(
          `Migration drift detected: Checksum mismatch for applied migration '${record.id}_${record.name}'. Recorded: ${record.checksum}, Current File: ${matchingFile.checksum}. Execution halted.`,
        );
      }
    }

    const appliedIds = new Set(applied.map((a) => a.id));
    const pending = files.filter((f) => !appliedIds.has(f.id));

    if (pending.length === 0) {
      return {
        applied: [],
        alreadyUpToDate: true,
      };
    }

    let nextOrder = applied.length > 0 ? Math.max(...applied.map((a) => a.execution_order)) + 1 : 1;

    const newlyApplied: string[] = [];

    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(migration.upSql);

        const safeTable = sanitizeTableName(tableName);
        await client.query(
          `INSERT INTO ${safeTable} (id, name, checksum, applied_at, execution_order)
           VALUES ($1, $2, $3, NOW(), $4);`,
          [migration.id, migration.name, migration.checksum, nextOrder],
        );

        await client.query('COMMIT');
        newlyApplied.push(`${migration.id}_${migration.name}`);
        nextOrder++;
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Migration failed for '${migration.filename}': ${msg}`);
      }
    }

    return {
      applied: newlyApplied,
      alreadyUpToDate: false,
    };
  } finally {
    client.release();
  }
}

/**
 * Executes a controlled down-step migration for test and development environments only.
 * Contains explicit programmatic guard rejecting execution in production or when
 * ALLOW_DESTRUCTIVE_DOWN is not set to true.
 */
export async function migrateDown(pool: pg.Pool, options?: RunnerOptions): Promise<RevertResult> {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const allowDestructive =
    options?.allowDestructiveDown ?? process.env['ALLOW_DESTRUCTIVE_DOWN'] === 'true';

  if (isProduction || !allowDestructive) {
    throw new Error(
      'Destructive down migration rejected: Operation blocked in production or without explicit non-production authorization (ALLOW_DESTRUCTIVE_DOWN=true).',
    );
  }

  const migrationsDir = options?.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const tableName = options?.tableName || DEFAULT_TABLE_NAME;
  const files = loadMigrationFiles(migrationsDir);

  const client = await pool.connect();
  try {
    await ensureMigrationTable(client, tableName);
    const safeTable = sanitizeTableName(tableName);

    const lastResult = await client.query<MigrationRecord>(`
      SELECT id, name, checksum, applied_at, execution_order
      FROM ${safeTable}
      ORDER BY execution_order DESC, id DESC
      LIMIT 1;
    `);

    const lastRecord = lastResult.rows[0];
    if (!lastRecord) {
      return { reverted: 'none' };
    }

    const matchingFile = files.find((f) => f.id === lastRecord.id);
    if (!matchingFile) {
      throw new Error(
        `Cannot revert migration '${lastRecord.id}_${lastRecord.name}': Corresponding file not found.`,
      );
    }

    if (!matchingFile.downSql) {
      throw new Error(
        `Cannot revert migration '${matchingFile.filename}': File does not define a '-- Down' section.`,
      );
    }

    await client.query('BEGIN');
    try {
      await client.query(matchingFile.downSql);
      await client.query(`DELETE FROM ${safeTable} WHERE id = $1;`, [lastRecord.id]);
      await client.query('COMMIT');

      return { reverted: `${lastRecord.id}_${lastRecord.name}` };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Rollback failed for '${matchingFile.filename}': ${msg}`);
    }
  } finally {
    client.release();
  }
}

/**
 * Returns migration status for all files and applied records.
 */
export async function getMigrationStatus(
  pool: pg.Pool,
  options?: RunnerOptions,
): Promise<MigrationStatus[]> {
  const migrationsDir = options?.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const tableName = options?.tableName || DEFAULT_TABLE_NAME;
  const files = loadMigrationFiles(migrationsDir);

  const client = await pool.connect();
  try {
    await ensureMigrationTable(client, tableName);
    const applied = await getAppliedMigrations(client, tableName);
    const appliedMap = new Map(applied.map((a) => [a.id, a]));

    return files.map((f) => {
      const record = appliedMap.get(f.id);
      if (record) {
        return {
          id: f.id,
          name: f.name,
          applied: true,
          appliedAt: record.applied_at,
          executionOrder: record.execution_order,
          checksumMatches: f.checksum === record.checksum,
        };
      }
      return {
        id: f.id,
        name: f.name,
        applied: false,
      };
    });
  } finally {
    client.release();
  }
}
