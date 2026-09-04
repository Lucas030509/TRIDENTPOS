import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadMigrationFiles } from './parser.js';
import type {
  MigrationFile,
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
const MIGRATION_LOCK_NAME = 'tridentpos_cloud_migrations_v1';

function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid migration table name: ${name}`);
  }
  return name;
}

async function acquireMigrationLock(client: pg.PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint);', [MIGRATION_LOCK_NAME]);
}

async function releaseMigrationLock(client: pg.PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint);', [MIGRATION_LOCK_NAME]);
}

function assertAppliedSequence(applied: MigrationRecord[], files: MigrationFile[]): void {
  if (applied.length > files.length) {
    throw new Error(
      'Migration order drift detected: ledger contains more applied migrations than the migration directory.',
    );
  }

  for (let index = 0; index < applied.length; index++) {
    const record = applied[index];
    const expectedFile = files[index];
    if (!record || !expectedFile || record.id !== expectedFile.id || record.name !== expectedFile.name) {
      throw new Error(
        `Migration order drift detected at execution order ${index + 1}. New Cloud migrations must be appended after the latest applied YYYYMMDDHHMMSS migration; retroactive insertion or rename is prohibited.`,
      );
    }
  }
}

/** Ensures the migration ledger table and execution-order invariant exist. */
export async function ensureMigrationTable(
  client: pg.PoolClient,
  tableName = DEFAULT_TABLE_NAME,
): Promise<void> {
  const safeTable = sanitizeTableName(tableName);
  const safeIndex = sanitizeTableName(`${safeTable}_execution_order_uidx`);
  const sql = `
    CREATE TABLE IF NOT EXISTS ${safeTable} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_order INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ${safeIndex}
      ON ${safeTable} (execution_order);
  `;
  await client.query(sql);
}

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
 * Executes forward migrations in timestamp order under a PostgreSQL advisory lock.
 * Applied history is immutable: checksum, filename identity and append-only order are verified.
 */
export async function migrateUp(pool: pg.Pool, options?: RunnerOptions): Promise<MigrationResult> {
  const migrationsDir = options?.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const tableName = options?.tableName || DEFAULT_TABLE_NAME;
  const files = loadMigrationFiles(migrationsDir);

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await acquireMigrationLock(client);
    lockAcquired = true;
    await ensureMigrationTable(client, tableName);
    const applied = await getAppliedMigrations(client, tableName);

    for (const record of applied) {
      const matchingFile = files.find((f) => f.id === record.id);
      if (!matchingFile) {
        throw new Error(
          `Migration drift detected: Applied migration '${record.id}_${record.name}' is missing from migrations directory.`,
        );
      }
      if (matchingFile.name !== record.name) {
        throw new Error(
          `Migration drift detected: Applied migration '${record.id}_${record.name}' was renamed to '${matchingFile.filename}'.`,
        );
      }
      if (matchingFile.checksum !== record.checksum) {
        throw new Error(
          `Migration drift detected: Checksum mismatch for applied migration '${record.id}_${record.name}'. Recorded: ${record.checksum}, Current File: ${matchingFile.checksum}. Execution halted.`,
        );
      }
    }

    assertAppliedSequence(applied, files);

    const appliedIds = new Set(applied.map((a) => a.id));
    const pending = files.filter((f) => !appliedIds.has(f.id));

    if (pending.length === 0) {
      return { applied: [], alreadyUpToDate: true };
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

    return { applied: newlyApplied, alreadyUpToDate: false };
  } finally {
    if (lockAcquired) {
      try {
        await releaseMigrationLock(client);
      } finally {
        client.release();
      }
    } else {
      client.release();
    }
  }
}

/**
 * Executes a controlled down-step for test/development only under the same migration lock.
 * Production is always rejected and non-production requires explicit authorization.
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
  let lockAcquired = false;
  try {
    await acquireMigrationLock(client);
    lockAcquired = true;
    await ensureMigrationTable(client, tableName);
    const safeTable = sanitizeTableName(tableName);

    const applied = await getAppliedMigrations(client, tableName);
    for (const record of applied) {
      const matchingFile = files.find((f) => f.id === record.id);
      if (!matchingFile || matchingFile.name !== record.name || matchingFile.checksum !== record.checksum) {
        throw new Error(
          `Migration drift detected before down-step for '${record.id}_${record.name}'. Down execution is prohibited against mutated history.`,
        );
      }
    }
    assertAppliedSequence(applied, files);

    const lastRecord = applied[applied.length - 1];
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
    if (lockAcquired) {
      try {
        await releaseMigrationLock(client);
      } finally {
        client.release();
      }
    } else {
      client.release();
    }
  }
}

/** Returns migration status for all files and applied records. */
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
          checksumMatches: f.checksum === record.checksum && f.name === record.name,
        };
      }
      return { id: f.id, name: f.name, applied: false };
    });
  } finally {
    client.release();
  }
}
